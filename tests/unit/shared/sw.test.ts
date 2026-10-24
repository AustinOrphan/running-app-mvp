// The service worker's rules (phase 3a design 7.6, ADR 0012), run as the build ships it: `sw.js`
// rendered with a build id and a list of files, evaluated in a `vm` sandbox with a fake Cache
// Storage, a fake network and a clock the test moves. Each rule of the design has its own test.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, test } from 'vitest'
import { isoDateInZone } from '../../../shared/dates.ts'
import { renderSw, SW_SOURCE } from '../../../web/sw/buildSw.ts'
import { API_CACHE_NAME, META_CACHE_NAME } from '../../../web/pwa/register.ts'

const ORIGIN = 'https://run.example.com'
const TEMPLATE = readFileSync(SW_SOURCE, 'utf8')
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000
/** Thursday 2026-10-22, 09:00 in Chicago (CDT) and 14:00 UTC. */
const START = Date.UTC(2026, 9, 22, 14, 0, 0)
const CHICAGO = 'America/Chicago'

// ---- The sandbox -----------------------------------------------------------------------------

const urlOf = (key: string | { url: string }): string => (typeof key === 'string' ? key : key.url)

interface StoredResponse {
  status: number
  headers: Array<[string, string]>
  body: ArrayBuffer
}

/** The part of the Cache interface the worker uses, over a map. Lists keys in insertion order. */
class FakeCache {
  readonly entries = new Map<string, StoredResponse>()
  constructor(private readonly network: (url: string) => Promise<Response>) {}

  match(key: string | { url: string }): Promise<Response | undefined> {
    const stored = this.entries.get(urlOf(key))
    return Promise.resolve(
      stored === undefined
        ? undefined
        : new Response(stored.body, { status: stored.status, headers: stored.headers }),
    )
  }
  async put(key: string | { url: string }, response: Response): Promise<void> {
    this.entries.set(urlOf(key), {
      status: response.status,
      headers: [...response.headers.entries()],
      body: await response.arrayBuffer(),
    })
  }
  delete(key: string | { url: string }): Promise<boolean> {
    return Promise.resolve(this.entries.delete(urlOf(key)))
  }
  keys(): Promise<Array<{ url: string }>> {
    return Promise.resolve([...this.entries.keys()].map((url) => ({ url })))
  }
  /** Like the real one: every file is fetched and must answer 2xx, or nothing is kept. */
  async addAll(urls: string[]): Promise<void> {
    const answers = await Promise.all(urls.map((url) => this.network(url)))
    if (answers.some((answer) => !answer.ok)) throw new TypeError('A file did not load.')
    await Promise.all(urls.map((url, i) => this.put(url, answers[i] as Response)))
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()
  constructor(private readonly network: (url: string) => Promise<Response>) {}
  open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name)
    if (cache === undefined) {
      cache = new FakeCache(this.network)
      this.caches.set(name, cache)
    }
    return Promise.resolve(cache)
  }
  keys(): Promise<string[]> {
    return Promise.resolve([...this.caches.keys()])
  }
  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.caches.delete(name))
  }
}

interface SwEvent {
  request?: { url: string; method: string; mode: string }
  data?: unknown
  waitUntil: (promise: Promise<unknown>) => void
  respondWith: (promise: Promise<Response>) => void
}

/** Lets pending promise work finish: Node's body streams need a few turns of the event loop. */
async function ticks(count = 8): Promise<void> {
  for (let i = 0; i < count; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Dispatched {
  /** False when the worker left the request alone (no `respondWith`). */
  responded: boolean
  response: Promise<Response> | undefined
  /** Waits for everything the worker handed to `waitUntil`, including what it added meanwhile. */
  settle: () => Promise<void>
}

interface Options {
  buildId?: string
  precache?: string[]
}

function loadWorker(options: Options = {}) {
  const clock = { now: START }
  const timers = new Map<number, { at: number; run: () => void }>()
  let nextTimer = 1
  const requested: string[] = []
  const listeners = new Map<string, (event: SwEvent) => void>()
  const state = { skipped: 0, claimed: 0 }
  let network: (url: URL) => Response | Promise<Response> = () => {
    throw new TypeError('Failed to fetch')
  }

  const fetchStub = (input: string | { url: string }): Promise<Response> => {
    const url = urlOf(input)
    requested.push(url)
    return Promise.resolve().then(() => network(new URL(url)))
  }
  const caches = new FakeCacheStorage(fetchStub)

  class SandboxDate extends Date {
    constructor(...args: unknown[]) {
      super(...((args.length === 0 ? [clock.now] : args) as [number]))
    }
    static override now(): number {
      return clock.now
    }
  }

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: SwEvent) => void) => {
      listeners.set(type, listener)
    },
    skipWaiting: () => {
      state.skipped += 1
      return Promise.resolve()
    },
    clients: {
      claim: () => {
        state.claimed += 1
        return Promise.resolve()
      },
    },
  }
  const sandbox = {
    self,
    caches,
    fetch: fetchStub,
    Request,
    Response,
    Headers,
    URL,
    Date: SandboxDate,
    setTimeout: (run: () => void, ms: number): number => {
      const id = nextTimer++
      timers.set(id, { at: clock.now + ms, run })
      return id
    },
    clearTimeout: (id: number): void => {
      timers.delete(id)
    },
  }
  const precache = options.precache ?? [
    '/index.html',
    '/assets/app-aaa.js',
    '/manifest.webmanifest',
  ]
  vm.runInNewContext(renderSw(TEMPLATE, options.buildId ?? 'b1', precache), sandbox, {
    filename: 'sw.js',
  })

  function dispatch(type: string, init: Partial<SwEvent>): Dispatched {
    const waits: Array<Promise<unknown>> = []
    let response: Promise<Response> | undefined
    const event: SwEvent = {
      ...init,
      waitUntil: (promise) => {
        waits.push(Promise.resolve(promise))
      },
      respondWith: (promise) => {
        response = Promise.resolve(promise)
        // A test that never reads the answer must not leave a rejection unhandled.
        response.catch(() => {})
      },
    }
    const listener = listeners.get(type)
    if (listener === undefined) throw new Error(`The worker has no ${type} listener.`)
    listener(event)
    return {
      responded: response !== undefined,
      response,
      settle: async () => {
        // The event lives until the answer is given and everything handed to `waitUntil` is done.
        await response?.catch(() => {})
        for (let seen = 0; seen < waits.length; seen = waits.length) {
          await Promise.all(waits.slice(seen))
          await ticks(2)
        }
      },
    }
  }

  return {
    clock,
    caches,
    requested,
    state,
    setNetwork: (handler: (url: URL) => Response | Promise<Response>) => {
      network = handler
    },
    /** Moves the clock and runs the timers that fall due. */
    advance: async (ms: number) => {
      clock.now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= clock.now) {
          timers.delete(id)
          timer.run()
        }
      }
      await ticks()
    },
    request(path: string, init: { method?: string; mode?: string } = {}): Dispatched {
      return dispatch('fetch', {
        request: {
          url: new URL(path, ORIGIN).href,
          method: init.method ?? 'GET',
          mode: init.mode ?? 'cors',
        },
      })
    },
    navigate: (path: string): Dispatched =>
      dispatch('fetch', {
        request: { url: new URL(path, ORIGIN).href, method: 'GET', mode: 'navigate' },
      }),
    install: () => dispatch('install', {}),
    activate: () => dispatch('activate', {}),
    message: (data: unknown) => dispatch('message', { data }),
    /** Seeds a cache with a file, as an earlier run of the worker would have left it. */
    async keep(cacheName: string, path: string, body: unknown, savedAt?: number): Promise<void> {
      const cache = await caches.open(cacheName)
      await cache.put(
        new URL(path, ORIGIN).href,
        new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...(savedAt === undefined ? {} : { 'x-rl-saved-at': String(savedAt) }),
          },
        }),
      )
    },
    kept(cacheName: string): Promise<string[]> {
      return Promise.resolve(
        [...(caches.caches.get(cacheName)?.entries.keys() ?? [])].map((url) =>
          url.replace(ORIGIN, ''),
        ),
      )
    },
    async read(cacheName: string, path: string): Promise<unknown> {
      const hit = await (await caches.open(cacheName)).match(new URL(path, ORIGIN).href)
      return hit?.json()
    },
    async pending(promise: Promise<unknown>): Promise<boolean> {
      const waiting = Symbol('waiting')
      const first = await Promise.race([
        promise.then(
          () => 'done',
          () => 'done',
        ),
        ticks().then(() => waiting),
      ])
      return first === waiting
    },
  }
}

type Worker = ReturnType<typeof loadWorker>

/** A Today payload as the server composes one, for the fields the worker reads. */
function today(
  date: string,
  options: {
    tz?: string
    preview?: boolean
    watch?: boolean
    mark?: string
    /** The codes of the health notes the payload carries. */
    notes?: string[]
  } = {},
) {
  return {
    date,
    tz: options.tz ?? CHICAGO,
    mark: options.mark ?? date,
    coach: {
      generatedAt: '2026-10-22T11:12:00.000Z',
      preview: options.preview ?? false,
      slots: {
        watch: options.watch === true ? { items: [{ sessionId: 's1', state: 'on-watch' }] } : null,
        brief: null,
      },
      health: {
        notes: (options.notes ?? []).map((code) => ({
          code,
          template: 'x',
          slots: {},
          href: null,
        })),
      },
    },
  }
}

/** A network that answers the allowlist with these bodies and fails everything else. */
function answering(bodies: Record<string, unknown>) {
  return (url: URL): Response => {
    const body = bodies[`${url.pathname}${url.search}`]
    if (body === undefined) return new Response('not found', { status: 404 })
    return json(body)
  }
}

/** The response the worker gave the page for a dispatched request. */
function answer(dispatched: Dispatched): Promise<Response> {
  if (dispatched.response === undefined) throw new Error('The worker did not answer.')
  return dispatched.response
}

// ---- Shell: install, update safety -----------------------------------------------------------

describe('the shell cache', () => {
  test('install keeps every file of the list in a cache named for the build, then takes over', async () => {
    const sw = loadWorker({ buildId: 'b7', precache: ['/index.html', '/assets/a.js'] })
    sw.setNetwork(() => new Response('file'))
    const install = sw.install()
    await install.settle()
    expect(await sw.kept('rl-shell-b7')).toEqual(['/index.html', '/assets/a.js'])
    expect(sw.state.skipped).toBe(1)
  })

  test('install fails, and keeps nothing, when a file of the list does not load', async () => {
    const sw = loadWorker({ buildId: 'b7', precache: ['/index.html', '/assets/a.js'] })
    sw.setNetwork((url) =>
      url.pathname === '/assets/a.js'
        ? new Response('gone', { status: 404 })
        : new Response('file'),
    )
    await expect(sw.install().settle()).rejects.toThrow()
    expect(await sw.kept('rl-shell-b7')).toEqual([])
    expect(sw.state.skipped).toBe(0)
  })

  test('a failed install leaves no cache behind, so it never counts as a generation', async () => {
    const sw = loadWorker({ buildId: 'b7', precache: ['/index.html', '/assets/a.js'] })
    sw.setNetwork(() => {
      throw new TypeError('The network dropped.')
    })
    await expect(sw.install().settle()).rejects.toThrow('The network dropped.')
    expect(sw.caches.caches.has('rl-shell-b7')).toBe(false)
  })

  test('a failed install between two deploys does not push out the last complete build', async () => {
    // Build A and B are installed. C's install fails; D is the next deploy.
    const failing = loadWorker({ buildId: 'c', precache: ['/index.html'] })
    failing.setNetwork(() => {
      throw new TypeError('The network dropped.')
    })
    await failing.keep('rl-shell-a', '/index.html', 'a')
    await failing.keep('rl-shell-b', '/index.html', 'b')
    await expect(failing.install().settle()).rejects.toThrow()
    expect([...failing.caches.caches.keys()]).toEqual(['rl-shell-a', 'rl-shell-b'])

    const next = loadWorker({ buildId: 'd', precache: ['/index.html'] })
    next.setNetwork(() => new Response('file'))
    await next.keep('rl-shell-a', '/index.html', 'a')
    await next.keep('rl-shell-b', '/index.html', 'b')
    await next.install().settle()
    await next.activate().settle()
    expect([...next.caches.caches.keys()]).toEqual(['rl-shell-b', 'rl-shell-d'])
  })

  test('activation also drops an empty shell cache that an earlier worker left behind', async () => {
    const sw = loadWorker({ buildId: 'd', precache: ['/index.html'] })
    sw.setNetwork(() => new Response('file'))
    await sw.keep('rl-shell-a', '/index.html', 'a')
    await sw.keep('rl-shell-b', '/index.html', 'b')
    // The worker that was installing C was stopped before it could delete its cache.
    await sw.caches.open('rl-shell-c')
    await sw.install().settle()
    await sw.activate().settle()
    expect([...sw.caches.caches.keys()].sort()).toEqual(['rl-shell-b', 'rl-shell-d'])
  })

  test('two builds are kept: the third install removes the oldest and nothing else', async () => {
    const sw = loadWorker({ buildId: 'new', precache: ['/index.html'] })
    sw.setNetwork(() => new Response('file'))
    await sw.keep('rl-shell-old1', '/index.html', 'a')
    await sw.keep('rl-shell-old2', '/index.html', 'b')
    await sw.keep(API_CACHE_NAME, '/api/settings', {})
    await sw.keep(META_CACHE_NAME, '/__rl/warm', 1)
    await sw.install().settle()
    const activation = sw.activate()
    await activation.settle()
    expect([...sw.caches.caches.keys()].sort()).toEqual(
      [META_CACHE_NAME, API_CACHE_NAME, 'rl-shell-new', 'rl-shell-old2'].sort(),
    )
    expect(sw.state.claimed).toBe(1)
  })

  test('with one earlier build only, both are kept', async () => {
    const sw = loadWorker({ buildId: 'new', precache: ['/index.html'] })
    sw.setNetwork(() => new Response('file'))
    await sw.keep('rl-shell-old', '/index.html', 'a')
    await sw.install().settle()
    await sw.activate().settle()
    expect([...sw.caches.caches.keys()]).toEqual(['rl-shell-old', 'rl-shell-new'])
  })

  test('/assets/* is served from any kept build, the newest first, without the network', async () => {
    const sw = loadWorker({ buildId: 'new', precache: ['/index.html'] })
    await sw.keep('rl-shell-old', '/assets/chart-old.js', 'old chunk')
    await sw.keep('rl-shell-old', '/assets/shared.js', 'from the old build')
    await sw.keep('rl-shell-new', '/assets/shared.js', 'from the new build')
    sw.setNetwork(() => {
      throw new TypeError('offline')
    })
    for (const [path, body] of [
      ['/assets/chart-old.js', 'old chunk'],
      ['/assets/shared.js', 'from the new build'],
    ] as const) {
      const request = sw.request(path)
      expect(request.responded).toBe(true)
      expect(await (await answer(request)).json()).toBe(body)
    }
    expect(sw.requested).toEqual([])
  })

  test('a file that no kept build holds comes from the network', async () => {
    const sw = loadWorker({ buildId: 'new', precache: ['/index.html'] })
    sw.setNetwork(() => new Response('fresh file'))
    const request = sw.request('/assets/unknown.js')
    expect(await (await answer(request)).text()).toBe('fresh file')
    expect(sw.requested).toEqual([`${ORIGIN}/assets/unknown.js`])
  })

  test('a root file of the list (the manifest, an icon) is answered from the shell', async () => {
    const sw = loadWorker({ buildId: 'b1', precache: ['/index.html', '/manifest.webmanifest'] })
    await sw.keep('rl-shell-b1', '/manifest.webmanifest', { name: 'kept' })
    const request = sw.request('/manifest.webmanifest')
    expect(await (await answer(request)).json()).toEqual({ name: 'kept' })
    expect(sw.requested).toEqual([])
  })
})

// ---- Strategies ------------------------------------------------------------------------------

describe('navigations are network first, with a limit of 2.5 s', () => {
  test('the network answers: its page is shown and nothing is kept', async () => {
    const sw = loadWorker()
    await sw.keep('rl-shell-b1', '/index.html', 'kept page')
    sw.setNetwork(() => new Response('live page'))
    const nav = sw.navigate('/plan')
    expect(await (await answer(nav)).text()).toBe('live page')
    await nav.settle()
    expect(await sw.kept('rl-api-v1')).toEqual([])
  })

  test('no connection: the kept page answers, whatever the path', async () => {
    const sw = loadWorker()
    await sw.keep('rl-shell-b1', '/index.html', { page: 'kept' })
    const nav = sw.navigate('/activities?new=1')
    expect(await (await answer(nav)).json()).toEqual({ page: 'kept' })
  })

  test('no answer in 2.5 s: the kept page answers, not before', async () => {
    const sw = loadWorker()
    await sw.keep('rl-shell-b1', '/index.html', { page: 'kept' })
    sw.setNetwork(() => new Promise<Response>(() => {}))
    const nav = sw.navigate('/')
    await ticks()
    expect(await sw.pending(answer(nav))).toBe(true)
    await sw.advance(2499)
    expect(await sw.pending(answer(nav))).toBe(true)
    await sw.advance(1)
    expect(await (await answer(nav)).json()).toEqual({ page: 'kept' })
  })

  test('the page of an older build is used when the current one holds none', async () => {
    const sw = loadWorker({ buildId: 'new' })
    await sw.keep('rl-shell-old', '/index.html', { page: 'old build' })
    const nav = sw.navigate('/')
    expect(await (await answer(nav)).json()).toEqual({ page: 'old build' })
  })

  test('with no kept page the failure is passed on', async () => {
    const sw = loadWorker()
    const nav = sw.navigate('/')
    await expect(answer(nav)).rejects.toThrow('Failed to fetch')
  })

  test('with no kept page a slow network is waited for', async () => {
    const sw = loadWorker()
    let respond: (response: Response) => void = () => {}
    sw.setNetwork(() => new Promise<Response>((resolve) => (respond = resolve)))
    const nav = sw.navigate('/')
    await ticks()
    await sw.advance(5000)
    respond(new Response('slow page'))
    expect(await (await answer(nav)).text()).toBe('slow page')
  })

  test('downloads under /api, other methods and other origins are left to the browser', () => {
    const sw = loadWorker()
    expect(sw.navigate('/api/activities/export.csv').responded).toBe(false)
    expect(sw.navigate('/api/calendar/abc/plan.ics').responded).toBe(false)
    expect(sw.request('/plan', { method: 'POST', mode: 'navigate' }).responded).toBe(false)
    expect(sw.navigate('https://other.example.com/plan').responded).toBe(false)
    expect(sw.request('https://other.example.com/assets/x.js').responded).toBe(false)
    expect(sw.request('/anything-else.json').responded).toBe(false)
  })
})

describe('the API allowlist is exactly five reads', () => {
  test.each([
    '/api/auth/me',
    '/api/setup',
    '/api/settings',
    '/api/today',
    '/api/today?date=2026-10-23',
    '/api/research/params',
  ])('%s is handled', (path) => {
    const sw = loadWorker()
    expect(sw.request(path).responded).toBe(true)
  })

  test.each([
    '/api/wrist/status',
    '/api/plan',
    '/api/activities',
    '/api/checkins/2026-10-22',
    '/api/explain/rule/h4',
    '/api/briefs',
    '/api/today/extra',
    '/api/today/',
    '/api/today?date=tomorrow',
    '/api/today?date=2026-10-23&x=1',
    '/api/today?x=1',
    '/api/settings?x=1',
    '/api/auth/login',
    '/api/auth/me/',
    '/api/research/params?v=2',
    '/api/research',
    '/api/setup?x=1',
  ])('%s is left alone', (path) => {
    const sw = loadWorker()
    expect(sw.request(path).responded).toBe(false)
  })

  test('only a GET is handled', () => {
    const sw = loadWorker()
    for (const method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
      expect(sw.request('/api/settings', { method }).responded).toBe(false)
      expect(sw.request('/api/today', { method }).responded).toBe(false)
    }
  })
})

describe('API reads are network first, and only a 200 is kept', () => {
  test('the network answer is returned and kept, stamped with the time', async () => {
    const sw = loadWorker()
    sw.setNetwork(answering({ '/api/settings': { units: 'mi' } }))
    const read = sw.request('/api/settings')
    expect(await (await answer(read)).json()).toEqual({ units: 'mi' })
    await read.settle()
    expect(await sw.kept('rl-api-v1')).toEqual(['/api/settings'])
    const hit = await (await sw.caches.open('rl-api-v1')).match(`${ORIGIN}/api/settings`)
    expect(hit?.headers.get('x-rl-saved-at')).toBe(String(START))
  })

  test('the network wins over a kept copy, and replaces it', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START - HOUR)
    sw.setNetwork(answering({ '/api/settings': { units: 'mi' } }))
    const read = sw.request('/api/settings')
    expect(await (await answer(read)).json()).toEqual({ units: 'mi' })
    await read.settle()
    expect(await sw.read('rl-api-v1', '/api/settings')).toEqual({ units: 'mi' })
  })

  test.each([404, 400, 403, 500])('a %s answer is returned and not kept', async (status) => {
    const sw = loadWorker()
    sw.setNetwork(() => new Response('no', { status }))
    const read = sw.request('/api/settings')
    expect((await answer(read)).status).toBe(status)
    await read.settle()
    expect(await sw.kept('rl-api-v1')).toEqual([])
  })

  test('a 500 does not replace a kept copy, and is not served in place of one', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START)
    sw.setNetwork(() => new Response('no', { status: 500 }))
    const read = sw.request('/api/settings')
    expect((await answer(read)).status).toBe(500)
    await read.settle()
    expect(await sw.read('rl-api-v1', '/api/settings')).toEqual({ units: 'km' })
  })

  test('no connection: the kept copy answers', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START - HOUR)
    const read = sw.request('/api/settings')
    expect(await (await answer(read)).json()).toEqual({ units: 'km' })
  })

  test('no answer in 2.5 s: the kept copy answers; the late answer is kept when it comes', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START - HOUR)
    let respond: (response: Response) => void = () => {}
    sw.setNetwork(() => new Promise<Response>((resolve) => (respond = resolve)))
    const read = sw.request('/api/settings')
    await ticks()
    await sw.advance(2499)
    expect(await sw.pending(answer(read))).toBe(true)
    await sw.advance(1)
    expect(await (await answer(read)).json()).toEqual({ units: 'km' })
    respond(json({ units: 'mi' }))
    await read.settle()
    expect(await sw.read('rl-api-v1', '/api/settings')).toEqual({ units: 'mi' })
  })

  test.each([502, 503, 504])('a gateway error (%s) falls back to the kept copy', async (status) => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START)
    sw.setNetwork(() => new Response('bad gateway', { status }))
    const read = sw.request('/api/settings')
    expect(await (await answer(read)).json()).toEqual({ units: 'km' })
  })

  test('a gateway error with no kept copy is returned as it is', async () => {
    const sw = loadWorker()
    sw.setNetwork(() => new Response('bad gateway', { status: 502 }))
    const read = sw.request('/api/settings')
    expect((await answer(read)).status).toBe(502)
  })

  test('no connection and no kept copy: the failure is passed on', async () => {
    const sw = loadWorker()
    await expect(answer(sw.request('/api/settings'))).rejects.toThrow('Failed to fetch')
  })

  test('each path keeps its own copy, including each day of Today', async () => {
    const sw = loadWorker()
    sw.setNetwork(
      answering({
        '/api/today': today('2026-10-22'),
        '/api/today?date=2026-10-23': today('2026-10-23', { preview: true }),
        '/api/auth/me': { id: 'u1' },
      }),
    )
    for (const path of ['/api/today', '/api/today?date=2026-10-23', '/api/auth/me']) {
      await sw.request(path).settle()
    }
    expect((await sw.kept('rl-api-v1')).sort()).toEqual([
      '/api/auth/me',
      '/api/today',
      '/api/today?date=2026-10-23',
    ])
  })
})

describe('time limits of a kept copy', () => {
  test('a copy is served for 36 hours and dropped after', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START - 36 * HOUR)
    expect(await (await answer(sw.request('/api/settings'))).json()).toEqual({ units: 'km' })
    await sw.advance(1)
    await expect(answer(sw.request('/api/settings'))).rejects.toThrow()
    expect(await sw.kept('rl-api-v1')).toEqual([])
  })

  test('the research parameters last 14 days', async () => {
    const sw = loadWorker()
    const day = 24 * HOUR
    await sw.keep('rl-api-v1', '/api/research/params', { params: [] }, START - 14 * day)
    expect(await (await answer(sw.request('/api/research/params'))).json()).toEqual({
      params: [],
    })
    await sw.advance(1)
    await expect(answer(sw.request('/api/research/params'))).rejects.toThrow()
  })

  test('a copy with no time stamp is not served', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' })
    await expect(answer(sw.request('/api/settings'))).rejects.toThrow()
  })

  test('saving Today drops the copies of Today that have expired', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/today?date=2026-10-20', today('2026-10-20'), START - 40 * HOUR)
    sw.setNetwork(answering({ '/api/today': today('2026-10-22') }))
    await sw.request('/api/today').settle()
    expect(await sw.kept('rl-api-v1')).toEqual(['/api/today'])
  })

  describe('an expired copy is deleted at the first request of the worker, read or not', () => {
    const day = 24 * HOUR

    /** A cache that holds copies of every age, as a phone left alone for two days would. */
    async function agedWorker() {
      const sw = loadWorker()
      await sw.keep('rl-api-v1', '/api/auth/me', { email: 'runner@example.com' }, START - 40 * HOUR)
      await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START - 37 * HOUR)
      await sw.keep('rl-api-v1', '/api/today', today('2026-10-20'), START - 50 * HOUR)
      await sw.keep(
        'rl-api-v1',
        '/api/today?date=2026-10-21',
        today('2026-10-21'),
        START - 40 * HOUR,
      )
      await sw.keep('rl-api-v1', '/api/research/params', { params: [] }, START - 15 * day)
      await sw.keep('rl-api-v1', '/api/setup', { needsSetup: false })
      return sw
    }

    test('whatever the request: expired answers of every route and unstamped ones are gone', async () => {
      const sw = await agedWorker()
      await sw.keep('rl-api-v1', '/api/today?date=2026-10-23', today('2026-10-23'), START - HOUR)
      // A request the worker leaves alone is still the worker's first.
      const first = sw.request('/anything-else.json')
      expect(first.responded).toBe(false)
      await first.settle()
      expect(await sw.kept('rl-api-v1')).toEqual(['/api/today?date=2026-10-23'])
    })

    test('a copy that is still inside its limit stays, the research parameters for 14 days', async () => {
      const sw = loadWorker()
      await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START - 35 * HOUR)
      await sw.keep('rl-api-v1', '/api/research/params', { params: [] }, START - 13 * day)
      const first = sw.request('/anything-else.json')
      await first.settle()
      expect(await sw.kept('rl-api-v1')).toEqual(['/api/settings', '/api/research/params'])
    })

    test('once in a worker life: the second request sweeps nothing', async () => {
      const sw = await agedWorker()
      await sw.request('/anything-else.json').settle()
      await sw.keep('rl-api-v1', '/api/settings', { units: 'mi' }, START - 99 * HOUR)
      await sw.request('/anything-else.json').settle()
      expect(await sw.kept('rl-api-v1')).toEqual(['/api/settings'])
    })

    test('a worker with no kept answers makes no cache for them', async () => {
      const sw = loadWorker()
      await sw.request('/anything-else.json').settle()
      expect(sw.caches.caches.has('rl-api-v1')).toBe(false)
    })

    test('a sweep that cannot read the cache leaves the request alone', async () => {
      const sw = await agedWorker()
      sw.caches.keys = () => Promise.reject(new Error('storage is blocked'))
      const request = sw.request('/anything-else.json')
      expect(request.responded).toBe(false)
      await expect(request.settle()).resolves.toBeUndefined()
    })
  })
})

describe('a 401 empties the kept answers', () => {
  test('the answer is passed on and rl-api-v1 and the warm stamp are gone', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START)
    await sw.keep('rl-api-v1', '/api/today', today('2026-10-22'), START)
    await sw.keep('rl-meta', '/__rl/warm', 1)
    await sw.keep('rl-shell-b1', '/index.html', 'page')
    sw.setNetwork(() => json({ error: { code: 'unauthorized', message: 'Sign in.' } }, 401))
    const read = sw.request('/api/today')
    expect((await answer(read)).status).toBe(401)
    await read.settle()
    expect([...sw.caches.caches.keys()]).toEqual(['rl-shell-b1'])
  })

  test('a 401 from any allowlisted read does it, and is never answered from the copy', async () => {
    for (const path of ['/api/auth/me', '/api/settings', '/api/research/params']) {
      const sw = loadWorker()
      await sw.keep('rl-api-v1', path, { stale: true }, START)
      sw.setNetwork(() => json({}, 401))
      const read = sw.request(path)
      expect((await answer(read)).status).toBe(401)
      await read.settle()
      expect(sw.caches.caches.has('rl-api-v1')).toBe(false)
    }
  })

  test('the cache names agree with the page that empties them', () => {
    expect(TEMPLATE).toContain(`const API_CACHE = '${API_CACHE_NAME}'`)
    expect(TEMPLATE).toContain(`const META_CACHE = '${META_CACHE_NAME}'`)
  })
})

// ---- Today ----------------------------------------------------------------------------------

describe("Today's copy", () => {
  test("is marked as the phone's own, and the watch slot is stripped from what is kept", async () => {
    const sw = loadWorker()
    sw.setNetwork(answering({ '/api/today': today('2026-10-22', { watch: true }) }))
    const online = sw.request('/api/today')
    const live = (await (await answer(online)).json()) as ReturnType<typeof today>
    expect(live.coach.slots.watch).not.toBeNull()
    expect('servedFromCache' in live).toBe(false)
    await online.settle()
    expect(
      ((await sw.read('rl-api-v1', '/api/today')) as ReturnType<typeof today>).coach.slots.watch,
    ).toBeNull()

    sw.setNetwork(() => {
      throw new TypeError('offline')
    })
    const offline = (await (await answer(sw.request('/api/today'))).json()) as ReturnType<
      typeof today
    > & { servedFromCache?: boolean }
    expect(offline.servedFromCache).toBe(true)
    expect(offline.coach.slots.watch).toBeNull()
    expect(offline.date).toBe('2026-10-22')
  })

  test('the health note about the watch is stripped from what is kept, the other notes stay', async () => {
    const sw = loadWorker()
    const notes = ['wrist-tomorrow', 'sync-paused']
    sw.setNetwork(answering({ '/api/today': today('2026-10-22', { watch: true, notes }) }))
    const online = sw.request('/api/today')
    const live = (await (await answer(online)).json()) as ReturnType<typeof today>
    // The page that has the server's answer still sees the note, as it sees the watch slot.
    expect(live.coach.health.notes.map((note) => note.code)).toEqual(notes)
    await online.settle()
    const kept = (await sw.read('rl-api-v1', '/api/today')) as ReturnType<typeof today>
    expect(kept.coach.health.notes.map((note) => note.code)).toEqual(['sync-paused'])

    sw.setNetwork(() => {
      throw new TypeError('offline')
    })
    const offline = (await (await answer(sw.request('/api/today'))).json()) as ReturnType<
      typeof today
    >
    expect(offline.coach.health.notes.map((note) => note.code)).toEqual(['sync-paused'])
  })

  test('a payload with no health block is kept as it is', async () => {
    const sw = loadWorker()
    const bare = { date: '2026-10-22', tz: CHICAGO, coach: { preview: false, slots: {} } }
    sw.setNetwork(answering({ '/api/today': bare }))
    const online = sw.request('/api/today')
    await answer(online)
    await online.settle()
    expect(await sw.read('rl-api-v1', '/api/today')).toEqual(bare)
  })

  test('the code of the note the worker strips is the one the server writes', () => {
    const server = readFileSync('server/services/todayHealth.ts', 'utf8')
    expect(server).toContain("code: 'wrist-tomorrow'")
    expect(TEMPLATE).toContain("const WATCH_NOTE_CODES = ['wrist-tomorrow']")
  })

  test('the other answers are served as they were kept, with no mark', async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START)
    const copy: unknown = await (await answer(sw.request('/api/settings'))).json()
    expect(copy).toEqual({ units: 'km' })
  })

  test("a request for a day ahead is answered by that day's own copy, and by nothing else", async () => {
    const sw = loadWorker()
    await sw.keep('rl-api-v1', '/api/today', today('2026-10-22'), START)
    await sw.keep(
      'rl-api-v1',
      '/api/today?date=2026-10-23',
      today('2026-10-23', { preview: true }),
      START,
    )
    const ahead = (await (
      await answer(sw.request('/api/today?date=2026-10-23'))
    ).json()) as ReturnType<typeof today>
    expect(ahead.date).toBe('2026-10-23')
    await expect(answer(sw.request('/api/today?date=2026-10-24'))).rejects.toThrow()
  })

  describe("picks the copy whose date is today in the server's zone", () => {
    const dateOf = async (sw: Worker): Promise<string> =>
      ((await (await answer(sw.request('/api/today'))).json()) as { mark: string }).mark

    test("today's own copy over an older one", async () => {
      const sw = loadWorker()
      await sw.keep(
        'rl-api-v1',
        '/api/today?date=2026-10-21',
        today('2026-10-21', { mark: 'yesterday' }),
        START - 20 * HOUR,
      )
      await sw.keep(
        'rl-api-v1',
        '/api/today',
        today('2026-10-22', { mark: 'today' }),
        START - 2 * HOUR,
      )
      expect(await dateOf(sw)).toBe('today')
    })

    test("yesterday's preview of today answers when no plain copy is of today", async () => {
      const sw = loadWorker()
      await sw.keep(
        'rl-api-v1',
        '/api/today',
        today('2026-10-21', { mark: 'plain, yesterday' }),
        START - 14 * HOUR,
      )
      await sw.keep(
        'rl-api-v1',
        '/api/today?date=2026-10-22',
        today('2026-10-22', { preview: true, mark: 'preview of today' }),
        START - 14 * HOUR,
      )
      expect(await dateOf(sw)).toBe('preview of today')
    })

    test('a plain copy of today wins over a preview of today', async () => {
      const sw = loadWorker()
      await sw.keep(
        'rl-api-v1',
        '/api/today?date=2026-10-22',
        today('2026-10-22', { preview: true, mark: 'preview' }),
        START - 1 * HOUR,
      )
      await sw.keep(
        'rl-api-v1',
        '/api/today',
        today('2026-10-22', { mark: 'plain' }),
        START - 5 * HOUR,
      )
      expect(await dateOf(sw)).toBe('plain')
    })

    test('with none for today, the newest earlier day answers (the page says it is older)', async () => {
      const sw = loadWorker()
      await sw.keep(
        'rl-api-v1',
        '/api/today?date=2026-10-20',
        today('2026-10-20', { mark: 'two days ago' }),
        START - 30 * HOUR,
      )
      await sw.keep(
        'rl-api-v1',
        '/api/today',
        today('2026-10-21', { mark: 'yesterday' }),
        START - 20 * HOUR,
      )
      expect(await dateOf(sw)).toBe('yesterday')
    })

    test('a day that has not come yet is never today', async () => {
      const sw = loadWorker()
      await sw.keep(
        'rl-api-v1',
        '/api/today?date=2026-10-23',
        today('2026-10-23', { preview: true }),
        START - 2 * HOUR,
      )
      await expect(answer(sw.request('/api/today'))).rejects.toThrow()
    })

    test('a copy past its time limit is not used, even if it is the only one of today', async () => {
      const sw = loadWorker()
      await sw.keep('rl-api-v1', '/api/today', today('2026-10-22'), START - 36 * HOUR - 1)
      await expect(answer(sw.request('/api/today'))).rejects.toThrow()
    })

    test('a copy with an unknown zone or no date is skipped', async () => {
      const sw = loadWorker()
      await sw.keep(
        'rl-api-v1',
        '/api/today',
        today('2026-10-22', { tz: 'Not/AZone', mark: 'broken' }),
        START,
      )
      await sw.keep(
        'rl-api-v1',
        '/api/today?date=2026-10-21',
        { tz: CHICAGO, mark: 'no date' },
        START,
      )
      await expect(answer(sw.request('/api/today'))).rejects.toThrow()
    })

    test("the day turns over at the server's midnight, not the phone's", async () => {
      const sw = loadWorker()
      await sw.keep('rl-api-v1', '/api/today', today('2026-10-22', { mark: 'thursday' }), START)
      await sw.keep(
        'rl-api-v1',
        '/api/today?date=2026-10-23',
        today('2026-10-23', { preview: true, mark: 'friday preview' }),
        START,
      )
      expect(await dateOf(sw)).toBe('thursday')
      // 23:59 in Chicago is 04:59 UTC the next day: the phone's UTC clock already says Friday.
      sw.clock.now = Date.UTC(2026, 9, 23, 4, 59, 0)
      expect(await dateOf(sw)).toBe('thursday')
      sw.clock.now = Date.UTC(2026, 9, 23, 5, 0, 0)
      expect(await dateOf(sw)).toBe('friday preview')
    })

    test.each([
      CHICAGO,
      'America/Los_Angeles',
      'Pacific/Auckland',
      'Asia/Kolkata',
      'Europe/London',
      'UTC',
    ])('agrees with isoDateInZone around midnight in %s', async (tz) => {
      // The instants a minute either side of midnight in the zone, on three days (one has a change of clocks).
      const instants: number[] = []
      for (const day of [Date.UTC(2026, 2, 8), Date.UTC(2026, 9, 22), Date.UTC(2026, 10, 1)]) {
        for (let minutes = 0; minutes < 48 * 60; minutes += 1) {
          const at = day + minutes * MINUTE
          if (isoDateInZone(new Date(at - MINUTE), tz) !== isoDateInZone(new Date(at), tz)) {
            instants.push(at - MINUTE, at)
          }
        }
      }
      expect(instants.length).toBeGreaterThan(0)
      for (const at of instants) {
        const sw = loadWorker()
        sw.clock.now = at
        const expected = isoDateInZone(new Date(at), tz)
        // One kept copy for each day around the instant; the worker must pick the day the page's own rule picks.
        for (const offset of [-1, 0, 1]) {
          const date = isoDateInZone(new Date(at + offset * 24 * HOUR), tz)
          await sw.keep(
            'rl-api-v1',
            offset === 0 ? '/api/today' : `/api/today?date=${date}`,
            today(date, { tz, mark: date, preview: offset > 0 }),
            at - HOUR,
          )
        }
        expect(await dateOf(sw), `${tz} at ${new Date(at).toISOString()}`).toBe(expected)
      }
    })
  })
})

// ---- The throttled warm ---------------------------------------------------------------------

describe('the warm', () => {
  const NETWORK = {
    '/api/today': today('2026-10-22'),
    '/api/auth/me': { id: 'u1' },
    '/api/setup': { needsSetup: false },
    '/api/settings': { units: 'mi' },
    '/api/research/params': { params: [] },
    '/api/today?date=2026-10-23': today('2026-10-23', { preview: true }),
  }

  test("after today's payload, it keeps the rest of the allowlist and tomorrow's preview", async () => {
    const sw = loadWorker()
    sw.setNetwork(answering(NETWORK))
    const read = sw.request('/api/today')
    await answer(read)
    await read.settle()
    expect((await sw.kept('rl-api-v1')).sort()).toEqual([
      '/api/auth/me',
      '/api/research/params',
      '/api/settings',
      '/api/setup',
      '/api/today',
      '/api/today?date=2026-10-23',
    ])
    // Today was fetched once, by the page; the warm did not ask for it again.
    expect(sw.requested.filter((url) => url === `${ORIGIN}/api/today`)).toHaveLength(1)
  })

  test('once in ten minutes: not again before, again at ten', async () => {
    const sw = loadWorker()
    sw.setNetwork(answering(NETWORK))
    await sw.request('/api/today').settle()
    const afterFirst = sw.requested.length
    expect(afterFirst).toBe(6)

    await sw.advance(10 * MINUTE - 1)
    await sw.request('/api/today').settle()
    expect(sw.requested.length).toBe(afterFirst + 1) // the page's own read, no warm

    await sw.advance(1)
    await sw.request('/api/today').settle()
    // The page's read, then the warm: me, setup, settings and the preview (the research parameters are kept).
    expect(sw.requested.length).toBe(afterFirst + 1 + 1 + 4)
  })

  test("the day ahead is the day after the payload's date, across a month and a year", async () => {
    for (const [date, next] of [
      ['2026-10-31', '2026-11-01'],
      ['2026-12-31', '2027-01-01'],
      ['2028-02-28', '2028-02-29'],
    ] as const) {
      const sw = loadWorker()
      sw.setNetwork(answering({ '/api/today': today(date) }))
      await sw.request('/api/today').settle()
      expect(sw.requested).toContain(`${ORIGIN}/api/today?date=${next}`)
    }
  })

  test('a read of a day ahead, a failed read and a 401 do not start one', async () => {
    const sw = loadWorker()
    sw.setNetwork(answering(NETWORK))
    await sw.request('/api/today?date=2026-10-23').settle()
    expect(sw.requested).toHaveLength(1)

    sw.setNetwork(() => new Response('no', { status: 500 }))
    await sw.request('/api/today').settle()
    sw.setNetwork(() => json({}, 401))
    await sw.request('/api/today').settle()
    expect(sw.requested).toHaveLength(3)
  })

  test('a 401 during the warm stops it and empties the cache', async () => {
    const sw = loadWorker()
    sw.setNetwork((url) =>
      url.pathname === '/api/auth/me' ? json({}, 401) : answering(NETWORK)(url),
    )
    await sw.request('/api/today').settle()
    expect(sw.caches.caches.has('rl-api-v1')).toBe(false)
    // Nor is the turn used up: a new session is warmed at once.
    expect(sw.caches.caches.has('rl-meta')).toBe(false)
    expect(sw.requested).not.toContain(`${ORIGIN}/api/setup`)
  })

  test('a warm that reached nothing does not use up the ten minutes', async () => {
    const sw = loadWorker()
    await sw.message({ type: 'rl:warm' }).settle() // no signal: every fetch fails
    expect(await sw.kept('rl-meta')).toEqual([])
    expect(await sw.kept('rl-api-v1')).toEqual([])

    sw.setNetwork(answering(NETWORK))
    await sw.message({ type: 'rl:warm' }).settle() // the signal is back, a moment later
    expect(await sw.kept('rl-api-v1')).toHaveLength(6)
    expect(await sw.kept('rl-meta')).toEqual(['/__rl/warm'])
  })

  test('a payload with no calendar date starts no warm', async () => {
    const sw = loadWorker()
    sw.setNetwork(answering({ '/api/today': today('someday') }))
    await sw.request('/api/today').settle()
    expect(sw.requested).toEqual([`${ORIGIN}/api/today`])
  })

  test('the page can ask for one: it fetches today as well, and is throttled the same way', async () => {
    const sw = loadWorker()
    sw.setNetwork(answering(NETWORK))
    await sw.message({ type: 'rl:warm' }).settle()
    expect(sw.requested).toContain(`${ORIGIN}/api/today`)
    expect((await sw.kept('rl-api-v1')).sort()).toHaveLength(6)
    const first = sw.requested.length
    await sw.message({ type: 'rl:warm' }).settle()
    expect(sw.requested.length).toBe(first)
    await sw.advance(10 * MINUTE)
    await sw.message({ type: 'rl:warm' }).settle()
    expect(sw.requested.length).toBeGreaterThan(first)
  })

  test('other messages are ignored', async () => {
    const sw = loadWorker()
    sw.setNetwork(answering(NETWORK))
    await sw.message({ type: 'something else' }).settle()
    await sw.message(undefined).settle()
    expect(sw.requested).toEqual([])
  })

  test('a failing fetch in the warm does not reach the page', async () => {
    const sw = loadWorker()
    sw.setNetwork((url) => {
      if (url.pathname === '/api/today' && url.search === '') return json(NETWORK['/api/today'])
      throw new TypeError('offline')
    })
    const read = sw.request('/api/today')
    expect((await answer(read)).status).toBe(200)
    await expect(read.settle()).resolves.toBeUndefined()
  })
})

// ---- The file as shipped ---------------------------------------------------------------------

describe('the source', () => {
  test('keeps its two markers until the build fills them in', () => {
    expect(TEMPLATE).toContain("'__BUILD_ID__'")
    expect(TEMPLATE).toContain("['__PRECACHE__']")
  })

  test('uses no import, no page global and no library', () => {
    expect(TEMPLATE).not.toMatch(/^\s*import\s/m)
    expect(TEMPLATE).not.toMatch(/importScripts|workbox|\bwindow\b|\bdocument\b|localStorage/)
  })
})

// ---- Which answers are kept ------------------------------------------------------------------

describe('no answer but a 200 is kept, in a page read or in the warm', () => {
  /** An answer that the server could give with this status; the null-body statuses carry none. */
  const answeredWith = (status: number): Response =>
    new Response(status === 204 || status === 304 ? null : JSON.stringify({ units: 'mi' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  const STATUSES = [201, 202, 204, 206, 304, 422]

  test.each(STATUSES)(
    'a %s answer to a read is returned as it is, and is neither kept nor put over a kept copy',
    async (status) => {
      const sw = loadWorker()
      sw.setNetwork(() => answeredWith(status))
      const read = sw.request('/api/settings')
      expect((await answer(read)).status).toBe(status)
      await read.settle()
      expect(await sw.kept('rl-api-v1')).toEqual([])

      await sw.keep('rl-api-v1', '/api/settings', { units: 'km' }, START)
      const again = sw.request('/api/settings')
      expect((await answer(again)).status).toBe(status)
      await again.settle()
      expect(await sw.read('rl-api-v1', '/api/settings')).toEqual({ units: 'km' })
    },
  )

  test.each(STATUSES)(
    'a %s answer to a read of the warm is not kept; the 200 of Today is',
    async (status) => {
      const sw = loadWorker()
      sw.setNetwork((url) =>
        url.pathname === '/api/today' && url.search === ''
          ? json(today('2026-10-22'))
          : answeredWith(status),
      )
      const read = sw.request('/api/today')
      await answer(read)
      await read.settle()
      // The warm asked for the rest of the allowlist and for tomorrow, and kept none of it.
      expect(sw.requested).toContain(`${ORIGIN}/api/settings`)
      expect(sw.requested).toContain(`${ORIGIN}/api/today?date=2026-10-23`)
      expect(await sw.kept('rl-api-v1')).toEqual(['/api/today'])
    },
  )
})
