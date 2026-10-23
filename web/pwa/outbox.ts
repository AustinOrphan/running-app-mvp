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
//   sign-out: the queue holds health data (ADR 0012). An entry older than 7 days is dropped.
// - Replays start on `online`, on a return to the foreground and when the app opens.
import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { api, ApiError, keys, UNAUTHORIZED_EVENT } from '../api/client.ts'

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
    invalidates: [keys.checkins, keys.today, keys.wellness],
  },
  {
    // `PUT /api/fuel/logs/:activityId` stores the whole log, so a second write replaces the first.
    // The `/skip` sibling is a POST with another path and is not matched.
    label: 'fuel log',
    matches: (url) => /^\/api\/fuel\/logs\/[\w%-]+$/.test(url),
    combine: 'replace',
    invalidates: [keys.fuel, keys.today],
  },
]

/** An entry older than this is dropped unsent. */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * How long one send may take before it counts as a connection that is not there. A request that
 * hangs (a captive portal, one bar of signal) must not hold the queue, or a sheet waiting for its
 * answer, for as long as the browser cares to wait. The late reply, if one comes, is ignored: the
 * entry is sent again later, and a PUT sent twice changes nothing.
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
  /** The server has it. */
  | { status: 'sent' }
  /** It is kept on this phone and goes out when a connection allows. */
  | { status: 'queued' }
  /** The server refused it, in these words; it is not queued. */
  | { status: 'rejected'; reason: string }

/** What one attempt to send an entry came to. */
export type SendResult =
  | { kind: 'sent' }
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

/** The queue in IndexedDB: database `rl-outbox`, store `entries`, keyed by URL. */
export function indexedDbStore(): OutboxStore {
  let opened: Promise<IDBDatabase> | null = null
  const database = (): Promise<IDBDatabase> => {
    opened ??= openDatabase()
    return opened
  }
  return {
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
  }
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
  }
}

// ---- The queue -------------------------------------------------------------------------------

export interface OutboxDeps {
  store: OutboxStore
  routes: readonly OutboxRoute[]
  send: (entry: OutboxEntry) => Promise<SendResult>
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
  /** Forgets everything queued: sign-out and a 401. */
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
): OutboxEntry[] {
  const incoming = withoutUndefined(body)
  const existing = entries.find((entry) => entry.url === url)
  if (existing !== undefined) {
    const joined = route.combine === 'merge' ? { ...existing.body, ...incoming } : incoming
    return entries.map((entry) =>
      entry === existing ? { ...existing, body: joined, version: existing.version + 1 } : entry,
    )
  }
  const seq = entries.reduce((highest, entry) => Math.max(highest, entry.seq), 0) + 1
  return [...entries, { url, body: incoming, queuedAt: at, seq, version: 1 }]
}

/** The queue without this send: an entry written to again while it was sent stays. */
function withoutSent(entries: OutboxEntry[], sent: OutboxEntry): OutboxEntry[] {
  return entries.filter((entry) => !(entry.url === sent.url && entry.version === sent.version))
}

/**
 * What a run of `flush` tells the `save` that waited on it: the URLs the server refused, and
 * whether the run ended because the session is gone (a 401), which empties the queue.
 */
interface Report {
  refused: Map<string, string>
  signedOut: boolean
}

/** The send's own answer, or `retry` when it fails outright or takes longer than `ms`. */
function withTimeout(attempt: Promise<SendResult>, ms: number): Promise<SendResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ kind: 'retry' })
    }, ms)
    attempt.then(
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
  let report: Report = { refused: new Map(), signedOut: false }
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
      const result = await withTimeout(send(next), sendTimeoutMs)
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
    report = { refused: new Map(), signedOut: false }
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
    const entries = await store.transact(() => [])
    publish({ entries: [...entries], notices: [] })
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
          queueWrite(current, route, url, body, now()),
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
        return state.entries.some((entry) => entry.url === url)
          ? { status: 'queued' }
          : { status: 'sent' }
      } finally {
        const left = (waiting.get(url) ?? 1) - 1
        if (left <= 0) waiting.delete(url)
        else waiting.set(url, left)
      }
    },
    async flush() {
      await flush()
    },
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
export async function sendEntry(entry: OutboxEntry): Promise<SendResult> {
  try {
    await api('PUT', entry.url, entry.body)
    return { kind: 'sent' }
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
 * Keeps the queue moving for as long as the signed-in app is open: sends it when the app opens, on
 * `online` and on a return to the foreground, clears it on a 401, and refreshes what an entry
 * changed once the server has it.
 */
export function useOutboxReplay(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const outbox = getOutbox()
    const flush = () => {
      void outbox.flush()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush()
    }
    const onUnauthorized = () => {
      void outbox.clear()
    }
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    const stopListening = outbox.onSent((entry) => {
      const route = OUTBOX_ROUTES.find((candidate) => candidate.matches(entry.url))
      for (const key of route?.invalidates ?? []) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    })
    flush()
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
      stopListening()
    }
  }, [queryClient])
}
