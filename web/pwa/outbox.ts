// The outbox (spec 7.6 and 7.7): a queue of idempotent PUTs that survives a reload and a lost
// connection. A write the runner makes on a phone with no signal is kept in IndexedDB
// (`rl-outbox`), shown as "saved on this phone", and sent when the connection returns.
//
// Rules, in the order the spec gives them:
// - Only PUTs to a URL in `OUTBOX_ROUTES` are queued, and a PUT is idempotent by construction, so
//   a second send of the same entry (two tabs, a reply lost on the way back) changes nothing.
// - One entry per URL. A second write to the same URL is combined with the queued one: merged
//   where the PUT itself merges (a check-in keeps the keys it does not mention), replaced where it
//   replaces. The entry keeps its place in the queue.
// - Entries are sent oldest first, one run at a time. A run stops at the first entry that cannot
//   be sent now (no connection, a 5xx, a 408 or 429) and leaves everything queued.
// - A 4xx (any other) drops the entry with one message. A 401 clears the whole queue, and so does
//   sign-out and a new sign-in: the queue holds health data (ADR 0012). An entry older than 7 days
//   is dropped.
// - Replays start on `online`, on a return to the foreground and when the app opens.
// - The queue belongs to the signed-in user. Each entry carries the id it was queued under, and
//   `adopt` drops the entries of anyone else before the first replay, so a queue that outlived a
//   failed purge is never sent under another account.
// - Order is last arrival wins. A PUT carries no write time and the server stores whatever reaches
//   it last, so a check-in queued on this phone and replayed after a newer one from another device
//   replaces it. That is accepted: one runner, rarely two devices at once, and no server change.
//   What the client can close, it does: a send that runs out of time is aborted, so it cannot
//   arrive after the entry's next send (see `OUTBOX_SEND_TIMEOUT_MS`).
import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { ACTIVITY_DATA_KEYS } from '../api/activities.ts'
import { api, ApiError, keys, UNAUTHORIZED_EVENT } from '../api/client.ts'
import { purgeDrafts } from './drafts.ts'
import { purgeApiCache } from './register.ts'

/** A write the outbox may hold: an idempotent PUT to a URL this route matches. */
export interface OutboxRoute {
  /** What the entry is called in a message: "check-in". */
  label: string
  /** True for a URL (path without a query) this route owns. */
  matches: (url: string) => boolean
  /**
   * How a second write to the same URL joins the queued one: `merge` for a PUT that leaves absent
   * keys alone, `replace` for a PUT that stores its whole body.
   */
  combine: 'merge' | 'replace'
  /** The query keys that read what the write changes, refreshed once the server has it. */
  invalidates: readonly string[]
}

/**
 * The allowlist. Nothing else is queued: a POST is not idempotent, and a write whose answer the
 * page needs before it can go on must not be sent later. A later task that has an idempotent PUT
 * to queue appends an entry here and saves through `getOutbox().save(url, body)`.
 */
export const OUTBOX_ROUTES: readonly OutboxRoute[] = [
  {
    label: 'check-in',
    matches: (url) => /^\/api\/checkins\/\d{4}-\d{2}-\d{2}$/.test(url),
    combine: 'merge',
    invalidates: [keys.today, keys.wellness],
  },
  {
    // `PUT /api/fuel/logs/:activityId` stores the whole log, so a second write replaces the first.
    // The `/skip` sibling is a POST with another path and is not matched.
    label: 'fuel log',
    matches: (url) => /^\/api\/fuel\/logs\/[\w%-]+$/.test(url),
    combine: 'replace',
    invalidates: [keys.fuel, keys.today],
  },
  {
    // `PUT /api/strength/logs/:logId` stores the whole session under the id the sheet chose, so a
    // second write replaces the first and a replay changes nothing (strength design 9.6). The log
    // creates an activity linked to the planned session, so the readers of activity data go with the
    // strength readers and Today.
    label: 'strength log',
    matches: (url) => /^\/api\/strength\/logs\/[\w-]{8,64}$/.test(url),
    combine: 'replace',
    invalidates: [keys.strength, ...ACTIVITY_DATA_KEYS],
  },
]

/** An entry older than this is dropped unsent. */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * How long one send may take before it counts as a connection that is not there. A request that
 * hangs (a captive portal, one bar of signal) must not hold the queue, or a sheet waiting for its
 * answer, for as long as the browser cares to wait. At the limit the request is aborted, so it
 * cannot be delivered after the entry's next send and overwrite a newer write; the entry is sent
 * again later. Bytes that had already reached the server before the abort may still be applied,
 * and a PUT of the same body sent again changes nothing.
 */
export const OUTBOX_SEND_TIMEOUT_MS = 10_000

/** One queued PUT. `url` is the key; a write to the same URL updates the entry. */
export interface OutboxEntry {
  url: string
  body: Readonly<Record<string, unknown>>
  /** When the entry was first queued, in epoch milliseconds: its age and its place in the queue. */
  queuedAt: number
  /** The place in the queue: the order the entries were first queued in. */
  seq: number
  /** Counts the writes the entry has taken, so a send never removes a write made while it ran. */
  version: number
  /** The user the entry was queued under; absent only if it was queued before `adopt` ran. */
  userId?: string
}

/** A refusal the page shows once, inline, near what was lost. */
export interface OutboxNotice {
  id: number
  url: string
  message: string
}

export interface OutboxState {
  /** The queue as last stored, oldest first. */
  entries: readonly OutboxEntry[]
  /** Entries the server refused after they were queued, until dismissed. */
  notices: readonly OutboxNotice[]
}

export type SaveResult =
  /** The server has it. `response` is what it answered with, when it answered with something. */
  | { status: 'sent'; response?: unknown }
  /** It is kept on this phone and goes out when a connection allows. */
  | { status: 'queued' }
  /** The server refused it, in these words; it is not queued. */
  | { status: 'rejected'; reason: string }

/** What one attempt to send an entry came to. */
export type SendResult =
  | { kind: 'sent'; response?: unknown }
  /** No connection, a 5xx, a 408 or a 429: keep the entry and try again later. */
  | { kind: 'retry' }
  /** Any other 4xx: the entry will never be accepted. */
  | { kind: 'refused'; reason: string }
  | { kind: 'unauthorized' }

// ---- Storage ---------------------------------------------------------------------------------

/** Where the queue lives. One transaction reads it, changes it and writes the result back. */
export interface OutboxStore {
  read(): Promise<OutboxEntry[]>
  /**
   * Runs `change` on the stored entries inside one transaction and stores what it returns. Returning
   * the array it was given leaves the store as it is. Resolves to the stored entries.
   */
  transact(change: (entries: OutboxEntry[]) => OutboxEntry[]): Promise<OutboxEntry[]>
  /** Removes everything stored, by whatever means the store has. */
  clear(): Promise<void>
}

/** A queue in memory: for tests, and for a browser that will not open IndexedDB. */
export function memoryStore(): OutboxStore {
  let stored: OutboxEntry[] = []
  return {
    read: () => Promise.resolve([...stored]),
    transact: (change) => {
      const next = change([...stored])
      stored = [...next]
      return Promise.resolve([...stored])
    },
    clear: () => {
      stored = []
      return Promise.resolve()
    },
  }
}

const DB_NAME = 'rl-outbox'
const DB_STORE = 'entries'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE, { keyPath: 'url' })
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB did not open.'))
    }
    request.onblocked = () => {
      reject(new Error('IndexedDB is blocked.'))
    }
  })
}

/** The queue in IndexedDB, which can also be deleted outright (see `destroy`). */
export interface IndexedDbStore extends OutboxStore {
  /**
   * Deletes the database itself. It works when a transaction does not (a connection the browser
   * closed while the page was in the background), so it is the second try at emptying the queue.
   */
  destroy(): Promise<void>
}

/** The queue in IndexedDB: database `rl-outbox`, store `entries`, keyed by URL. */
export function indexedDbStore(): IndexedDbStore {
  let opened: Promise<IDBDatabase> | null = null
  const database = (): Promise<IDBDatabase> => {
    opened ??= openDatabase().then((db) => {
      // Another tab deleting the database, or the browser upgrading it, must not be held up by
      // this connection; the next operation opens a new one.
      db.onversionchange = () => {
        db.close()
        opened = null
      }
      return db
    })
    return opened
  }
  const store: IndexedDbStore = {
    async read() {
      const db = await database()
      return new Promise<OutboxEntry[]>((resolve, reject) => {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll()
        request.onsuccess = () => {
          resolve(request.result as OutboxEntry[])
        }
        request.onerror = () => {
          reject(request.error ?? new Error('IndexedDB did not read.'))
        }
      })
    },
    async transact(change) {
      const db = await database()
      return new Promise<OutboxEntry[]>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite')
        const objects = tx.objectStore(DB_STORE)
        const request = objects.getAll()
        let result: OutboxEntry[] = []
        request.onsuccess = () => {
          const current = request.result as OutboxEntry[]
          try {
            const next = change([...current])
            result = next
            if (next.length !== current.length || next.some((entry, i) => entry !== current[i])) {
              objects.clear()
              for (const entry of next) objects.put(entry)
            }
          } catch (error) {
            tx.abort()
            reject(error instanceof Error ? error : new Error('The outbox could not change.'))
          }
        }
        tx.oncomplete = () => {
          resolve(result)
        }
        tx.onerror = () => {
          reject(tx.error ?? new Error('IndexedDB did not write.'))
        }
        tx.onabort = () => {
          reject(tx.error ?? new Error('IndexedDB stopped the write.'))
        }
      })
    },
    async clear() {
      await store.transact(() => [])
    },
    async destroy() {
      const connection = opened
      opened = null
      try {
        ;(await connection)?.close()
      } catch {
        // It never opened, so there is nothing to close.
      }
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME)
        request.onsuccess = () => {
          resolve()
        }
        request.onerror = () => {
          reject(request.error ?? new Error('IndexedDB did not delete.'))
        }
        // Another tab still holds the database: the browser deletes it as soon as that tab lets
        // go, which is all that can be done from here, so the sign-out does not wait for it.
        request.onblocked = () => {
          resolve()
        }
      })
    },
  }
  return store
}

/**
 * The store the app uses: IndexedDB, and memory when IndexedDB is missing or fails (a private
 * window in some browsers, a blocked database). The queue then lasts as long as the page does.
 */
export function defaultStore(): OutboxStore {
  if (typeof indexedDB === 'undefined') return memoryStore()
  const primary = indexedDbStore()
  const fallback = memoryStore()
  let broken = false
  return {
    async read() {
      if (!broken) {
        try {
          return await primary.read()
        } catch {
          broken = true
        }
      }
      return fallback.read()
    },
    async transact(change) {
      if (!broken) {
        try {
          return await primary.transact(change)
        } catch {
          broken = true
        }
      }
      return fallback.transact(change)
    },
    async clear() {
      await fallback.clear()
      if (!broken) {
        try {
          await primary.clear()
          return
        } catch {
          broken = true
        }
      }
      // IndexedDB failed this clear or an earlier call, so rows may still be on disk, and the next
      // visit would read them. Deleting the database does not depend on the transaction that failed.
      try {
        await primary.destroy()
        broken = false
      } catch {
        // Nothing more can be done from the page. Entries carry their user (`adopt`), so a later
        // sign-in as someone else drops them unsent.
      }
    },
  }
}

// ---- The queue -------------------------------------------------------------------------------

export interface OutboxDeps {
  store: OutboxStore
  routes: readonly OutboxRoute[]
  /** Sends one entry. The signal fires when the send has run out of time: stop the request. */
  send: (entry: OutboxEntry, signal: AbortSignal) => Promise<SendResult>
  now: () => number
  isOnline: () => boolean
  /** Milliseconds one send may take; `OUTBOX_SEND_TIMEOUT_MS` when absent. */
  sendTimeoutMs?: number
}

export interface Outbox {
  getState: () => OutboxState
  subscribe: (listener: () => void) => () => void
  /**
   * Queues an idempotent PUT and tries to send it at once. The answer says where the write is:
   * with the server, kept on this phone, or refused. A URL outside the allowlist throws.
   */
  save(url: string, body: Readonly<Record<string, unknown>>): Promise<SaveResult>
  /** Sends what is queued, oldest first. One run at a time; a call during a run joins it. */
  flush(): Promise<void>
  /**
   * Binds the queue to the signed-in user: entries queued under another user are dropped unsent,
   * entries with no user (queued in the moment before the user was known) are taken over, and what
   * is queued from now on carries this user's id. Call it before the first `flush` of a session.
   */
  adopt(userId: string): Promise<void>
  /** Forgets everything queued: sign-out, a new sign-in and a 401. */
  clear(): Promise<void>
  dismissNotice(id: number): void
  /** Called after each entry the server accepted. Returns the way to stop listening. */
  onSent(listener: (entry: OutboxEntry) => void): () => void
}

const bySeq = (a: OutboxEntry, b: OutboxEntry): number => a.seq - b.seq

function withoutUndefined(body: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined))
}

/** The queue with this write in it: merged into the entry for its URL, or a new last entry. */
function queueWrite(
  entries: OutboxEntry[],
  route: OutboxRoute,
  url: string,
  body: Readonly<Record<string, unknown>>,
  at: number,
  userId: string | null,
): OutboxEntry[] {
  const incoming = withoutUndefined(body)
  const owner = userId === null ? {} : { userId }
  const existing = entries.find((entry) => entry.url === url)
  if (existing !== undefined) {
    const joined = route.combine === 'merge' ? { ...existing.body, ...incoming } : incoming
    return entries.map((entry) =>
      entry === existing
        ? { ...existing, ...owner, body: joined, version: existing.version + 1 }
        : entry,
    )
  }
  const seq = entries.reduce((highest, entry) => Math.max(highest, entry.seq), 0) + 1
  return [...entries, { url, body: incoming, queuedAt: at, seq, version: 1, ...owner }]
}

/** The queue without this send: an entry written to again while it was sent stays. */
function withoutSent(entries: OutboxEntry[], sent: OutboxEntry): OutboxEntry[] {
  return entries.filter((entry) => !(entry.url === sent.url && entry.version === sent.version))
}

/**
 * What a run of `flush` tells the `save` that waited on it: the URLs the server refused, what it
 * answered for the ones it took, and whether the run ended because the session is gone (a 401),
 * which empties the queue.
 */
interface Report {
  refused: Map<string, string>
  responses: Map<string, unknown>
  signedOut: boolean
}

const newReport = (): Report => ({ refused: new Map(), responses: new Map(), signedOut: false })

/**
 * The send's own answer, or `retry` when it fails outright or takes longer than `ms`. At the limit
 * the request is aborted, so a reply or a delivery that is late cannot land after the next send.
 */
function sendWithTimeout(
  send: OutboxDeps['send'],
  entry: OutboxEntry,
  ms: number,
): Promise<SendResult> {
  const controller = new AbortController()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort()
      resolve({ kind: 'retry' })
    }, ms)
    new Promise<SendResult>((started) => {
      started(send(entry, controller.signal))
    }).then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      () => {
        clearTimeout(timer)
        resolve({ kind: 'retry' })
      },
    )
  })
}

export function createOutbox(deps: OutboxDeps): Outbox {
  const { store, routes, send, now, isOnline } = deps
  const sendTimeoutMs = deps.sendTimeoutMs ?? OUTBOX_SEND_TIMEOUT_MS
  const listeners = new Set<() => void>()
  const sentListeners = new Set<(entry: OutboxEntry) => void>()
  let state: OutboxState = { entries: [], notices: [] }
  let nextNoticeId = 1
  let running: Promise<Report> | null = null
  let again = false
  let halted = false
  let report: Report = newReport()
  /** The signed-in user the queue belongs to; null until `adopt` (tests that never sign in). */
  let owner: string | null = null
  /** URLs a `save` is waiting on: their refusal goes to that caller, not to a notice. */
  const waiting = new Map<string, number>()

  function publish(next: Partial<OutboxState>): void {
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener()
  }

  const routeOf = (url: string): OutboxRoute | undefined =>
    routes.find((route) => route.matches(url))

  /** Drops what is too old, and publishes the queue as stored. */
  async function expire(): Promise<OutboxEntry[]> {
    const cutoff = now() - OUTBOX_MAX_AGE_MS
    const entries = await store.transact((current) => {
      const fresh = current.filter((entry) => entry.queuedAt >= cutoff)
      return fresh.length === current.length ? current : fresh
    })
    publish({ entries: [...entries].sort(bySeq) })
    return entries
  }

  async function remove(sent: OutboxEntry): Promise<OutboxEntry[]> {
    const entries = await store.transact((current) => withoutSent(current, sent))
    publish({ entries: [...entries].sort(bySeq) })
    return entries
  }

  async function pass(): Promise<void> {
    let entries = await expire()
    const tried = new Set<string>()
    for (;;) {
      const next = [...entries]
        .sort(bySeq)
        .find((entry) => !tried.has(`${entry.url}#${String(entry.version)}`))
      if (next === undefined) return
      if (!isOnline()) {
        halted = true
        return
      }
      tried.add(`${next.url}#${String(next.version)}`)
      const result = await sendWithTimeout(send, next, sendTimeoutMs)
      if (result.kind === 'retry') {
        halted = true
        return
      }
      if (result.kind === 'unauthorized') {
        halted = true
        report.signedOut = true
        await clear()
        return
      }
      entries = await remove(next)
      if (result.kind === 'sent') {
        if (result.response !== undefined) report.responses.set(next.url, result.response)
        for (const listener of [...sentListeners]) listener(next)
        continue
      }
      report.refused.set(next.url, result.reason)
      if (!waiting.has(next.url)) {
        const label = routeOf(next.url)?.label ?? 'entry'
        publish({
          notices: [
            ...state.notices,
            {
              id: nextNoticeId++,
              url: next.url,
              message: render(TEMPLATES['today.outbox.dropped'], { what: label }, 'mi'),
            },
          ],
        })
      }
    }
  }

  function flush(): Promise<Report> {
    if (running !== null) {
      again = true
      return running
    }
    halted = false
    report = newReport()
    const current = report
    const run = (async (): Promise<Report> => {
      try {
        do {
          again = false
          await pass()
        } while (again && !halted)
      } finally {
        running = null
      }
      return current
    })()
    running = run
    return run
  }

  async function clear(): Promise<void> {
    await store.clear()
    publish({ entries: [], notices: [] })
  }

  async function adopt(userId: string): Promise<void> {
    owner = userId
    const entries = await store.transact((current) => {
      if (current.every((entry) => entry.userId === userId)) return current
      return current
        .filter((entry) => entry.userId === undefined || entry.userId === userId)
        .map((entry) => (entry.userId === userId ? entry : { ...entry, userId }))
    })
    publish({ entries: [...entries].sort(bySeq) })
  }

  // The queue left by an earlier visit is read at once, so the page can show it.
  void expire().catch(() => {})

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async save(url, body) {
      const route = routeOf(url)
      if (route === undefined) throw new Error(`${url} is not in the outbox allowlist.`)
      waiting.set(url, (waiting.get(url) ?? 0) + 1)
      try {
        const entries = await store.transact((current) =>
          queueWrite(current, route, url, body, now(), owner),
        )
        publish({ entries: [...entries].sort(bySeq) })
        const finished = await flush()
        const reason = finished.refused.get(url)
        if (reason !== undefined) return { status: 'rejected', reason }
        if (finished.signedOut) {
          return {
            status: 'rejected',
            reason: render(TEMPLATES['today.outbox.signed-out'], {}, 'mi'),
          }
        }
        if (state.entries.some((entry) => entry.url === url)) return { status: 'queued' }
        const response = finished.responses.get(url)
        return response === undefined ? { status: 'sent' } : { status: 'sent', response }
      } finally {
        const left = (waiting.get(url) ?? 1) - 1
        if (left <= 0) waiting.delete(url)
        else waiting.set(url, left)
      }
    },
    async flush() {
      await flush()
    },
    adopt,
    clear,
    dismissNotice(id) {
      publish({ notices: state.notices.filter((notice) => notice.id !== id) })
    },
    onSent(listener) {
      sentListeners.add(listener)
      return () => {
        sentListeners.delete(listener)
      }
    },
  }
}

// ---- The app's outbox ------------------------------------------------------------------------

/** Sends one entry through the same client as every other request. */
export async function sendEntry(entry: OutboxEntry, signal?: AbortSignal): Promise<SendResult> {
  try {
    const response = await api<unknown>('PUT', entry.url, entry.body, signal)
    return response === undefined ? { kind: 'sent' } : { kind: 'sent', response }
  } catch (error) {
    if (!(error instanceof ApiError)) return { kind: 'retry' }
    const { status } = error
    if (status === 401) return { kind: 'unauthorized' }
    if (status === 0 || status >= 500 || status === 408 || status === 429) return { kind: 'retry' }
    return { kind: 'refused', reason: error.message }
  }
}

let shared: Outbox | null = null

/** The page's outbox, made on first use. */
export function getOutbox(): Outbox {
  shared ??= createOutbox({
    store: defaultStore(),
    routes: OUTBOX_ROUTES,
    send: sendEntry,
    now: () => Date.now(),
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
  })
  return shared
}

/** Starts again with an empty memory-backed outbox, so one test's queue does not reach the next. */
export function resetOutboxForTests(outbox: Outbox | null = null): void {
  shared = outbox
}

/** The queue and the refusals, kept up to date. */
export function useOutboxState(): OutboxState {
  const outbox = getOutbox()
  return useSyncExternalStore(outbox.subscribe, outbox.getState)
}

/**
 * Reads again what a sent write to `url` changed: the queries its route lists. Two things start
 * this for one write sent at once: the listener in `useOutboxReplay`, which also covers a replay,
 * and the mutation that saved it, which waits for the fresh data before it reports back. The route
 * is the only list of what to read. The mutation passes `cancelRefetch: false` so that its call
 * joins the read the listener has just started instead of cancelling it and starting a second
 * one: one write, one request per query.
 */
export function refreshAfterSend(
  queryClient: QueryClient,
  url: string,
  options: { cancelRefetch?: boolean } = {},
): Promise<unknown> {
  const route = OUTBOX_ROUTES.find((candidate) => candidate.matches(url))
  return Promise.all(
    (route?.invalidates ?? []).map((key) =>
      queryClient.invalidateQueries(
        { queryKey: [key] },
        { cancelRefetch: options.cancelRefetch ?? true },
      ),
    ),
  )
}

/**
 * Everything this device keeps for the signed-in session: the unsent drafts in local storage, the
 * writes waiting in the outbox and the service worker's copy of the server's answers
 * (`rl-api-v1`). Sign-out and a 401 call it, so no health data outlives the session (ADR 0012).
 * Local storage is purged first and synchronously, because it cannot fail halfway; the outbox and
 * the cache follow side by side, and neither waits on the other.
 */
export async function purgeDeviceData(): Promise<void> {
  purgeDrafts()
  await Promise.all([getOutbox().clear(), purgeApiCache()])
}

/**
 * Keeps the queue moving for as long as the signed-in app is open: binds it to the user, sends it
 * when the app opens, on `online` and on a return to the foreground, purges it on a 401, and
 * refreshes what an entry changed once the server has it (`refreshAfterSend`). With no user (not
 * yet known, or signed out) it does nothing.
 */
export function useOutboxReplay(userId: string | null): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (userId === null) return undefined
    const outbox = getOutbox()
    // Nothing is sent before the queue has been checked against the user, or an entry left by
    // someone else could go out under this session.
    let ready = false
    const flush = () => {
      if (ready) void outbox.flush()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush()
    }
    const onUnauthorized = () => {
      void purgeDeviceData()
    }
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    const stopListening = outbox.onSent((entry) => {
      void refreshAfterSend(queryClient, entry.url)
    })
    void outbox.adopt(userId).then(() => {
      ready = true
      flush()
    })
    return () => {
      ready = false
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
      stopListening()
    }
  }, [queryClient, userId])
}
