// The service worker of the installed app (phase 3a design 7.6, ADR 0012). Hand-written, no
// library. `buildSw.ts` copies this file into the build with the two placeholders below replaced by
// the build id and the list of files to keep; nothing else in the file changes. The worker is a
// classic script: it cannot import anything, so every rule it needs is written here, and
// `tests/unit/shared/sw.test.ts` runs the file in a sandbox to pin each of them.
//
// What it does:
// - Shell. The page, its scripts and styles (the lazy chunks too), the icons and the latin fonts
//   are kept in `rl-shell-<build id>` at install. Two builds are kept: a page that is still open on
//   the old build finds its lazy chunks after an update, because `/assets/*` is served from any
//   kept build. Files of the shell are answered from the cache first.
// - Network first, with a 2.5 s limit, for navigations and for five API reads: the network's
//   answer, else the copy kept on the phone when the request fails, answers 502 to 504 or is not
//   answered in time. A navigation falls back to the kept page.
// - The API reads are exactly the allowlist below. Only a 200 answer to a GET is kept, in
//   `rl-api-v1`, for 36 hours (14 days for the research parameters). A 401 empties the cache,
//   because the session is gone and the copies are health data of that session.
// - Today's copy is picked by the server's day: the kept answer whose date is today in the
//   `tz` it carries, else the newest older one. The page marks that answer `servedFromCache`. The
//   watch slot is stripped from every kept copy, because a saved "On your watch" would be false.
// - A throttled warm (once in ten minutes) keeps the allowlist filled and fetches tomorrow's
//   preview, so the app opens offline at a trailhead with the next day's session.
//
// Cache names: `rl-shell-<build id>`, `rl-api-v1` and `rl-meta` (the time of the last warm). The
// page empties `rl-api-v1` and `rl-meta` on sign-out (`purgeDeviceData`), and the worker does the
// same on a 401.

'use strict'

const BUILD_ID = '__BUILD_ID__'
const PRECACHE = ['__PRECACHE__']

const SHELL_PREFIX = 'rl-shell-'
const SHELL_CACHE = SHELL_PREFIX + BUILD_ID
const API_CACHE = 'rl-api-v1'
const META_CACHE = 'rl-meta'

/** Builds kept: the current one and the one before it. */
const SHELL_GENERATIONS = 2
const NETWORK_TIMEOUT_MS = 2500
const HOUR_MS = 60 * 60 * 1000
const API_TTL_MS = 36 * HOUR_MS
const RESEARCH_TTL_MS = 14 * 24 * HOUR_MS
const WARM_INTERVAL_MS = 10 * 60 * 1000

/** The header that carries the time (epoch milliseconds) a kept answer was saved. */
const SAVED_AT = 'x-rl-saved-at'
/** The key in `rl-meta` that holds the time of the last warm. */
const WARM_STAMP = '/__rl/warm'

const TODAY_PATH = '/api/today'
/** The API reads that are kept: these paths, and nothing else. */
const API_ROUTES = [
  { path: '/api/auth/me', ttlMs: API_TTL_MS },
  { path: '/api/setup', ttlMs: API_TTL_MS },
  { path: '/api/settings', ttlMs: API_TTL_MS },
  { path: TODAY_PATH, ttlMs: API_TTL_MS },
  { path: '/api/research/params', ttlMs: RESEARCH_TTL_MS },
]
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** The one query string a route takes: today's payload for a day ahead. */
const DATE_QUERY = /^\?date=\d{4}-\d{2}-\d{2}$/

/** The route a URL is kept under, or null when the worker leaves the request alone. */
function apiRoute(url) {
  const route = API_ROUTES.find((candidate) => candidate.path === url.pathname)
  if (route === undefined) return null
  if (url.search === '') return route
  return route.path === TODAY_PATH && DATE_QUERY.test(url.search) ? route : null
}

const absolute = (path) => new URL(path, self.location.origin).href

// ---- Shell -----------------------------------------------------------------------------------

/** Names of the shell caches, this build first and then the older ones, newest first. */
async function shellNames() {
  // Cache Storage lists caches in the order they were created.
  const names = (await caches.keys()).filter((name) => name.startsWith(SHELL_PREFIX))
  const older = names.filter((name) => name !== SHELL_CACHE).reverse()
  return names.includes(SHELL_CACHE) ? [SHELL_CACHE, ...older] : older
}

/** The kept file for a URL from any kept build, or undefined. */
async function fromShell(key) {
  for (const name of await shellNames()) {
    const hit = await (await caches.open(name)).match(key)
    if (hit !== undefined) return hit
  }
  return undefined
}

async function shellFirst(request) {
  const hit = await fromShell(request.url)
  return hit === undefined ? fetch(request) : hit
}

// ---- Network first ---------------------------------------------------------------------------

const isGatewayError = (response) =>
  response.status === 502 || response.status === 503 || response.status === 504

/**
 * The network's answer, unless the request fails, comes back as a gateway error (a proxy in front
 * of a server that is down) or is not answered within `NETWORK_TIMEOUT_MS`; then `readCopy()`'s
 * answer, when there is one. `keep` sees every answer that came from the network and returns what
 * the page gets, so an answer that arrives after the copy was served is still kept. With no copy
 * the worker waits for the network and passes its failure on.
 */
async function networkFirst(event, readCopy, keep) {
  const attempt = fetch(event.request).then(
    (response) => ({ response }),
    (error) => ({ error }),
  )
  let timer
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ timedOut: true })
    }, NETWORK_TIMEOUT_MS)
  })
  const first = await Promise.race([attempt, limit])
  clearTimeout(timer)
  if (first.response !== undefined && !isGatewayError(first.response)) return keep(first.response)

  const copy = await readCopy()
  if (copy !== undefined) {
    if (first.timedOut === true) {
      event.waitUntil(
        attempt.then((late) => {
          if (late.response !== undefined) keep(late.response)
        }),
      )
    }
    return copy
  }
  const last = first.timedOut === true ? await attempt : first
  if (last.response !== undefined) return keep(last.response)
  throw last.error
}

function answerNavigation(event) {
  return networkFirst(
    event,
    () => fromShell(absolute('/index.html')),
    (response) => response,
  )
}

// ---- API reads -------------------------------------------------------------------------------

/** The kept answer for a key, unless it is older than `ttlMs` (then it is dropped). */
async function fresh(cache, key, ttlMs) {
  const hit = await cache.match(key, { ignoreVary: true })
  if (hit === undefined) return undefined
  const savedAt = Number(hit.headers.get(SAVED_AT))
  if (!(savedAt > 0) || Date.now() - savedAt > ttlMs) {
    await cache.delete(key)
    return undefined
  }
  return hit
}

/**
 * The calendar date of an instant in an IANA zone as YYYY-MM-DD, or null for a zone that is not
 * known. The same reading as `isoDateInZone` in `shared/dates.ts`, which `useServerToday` uses, so
 * the page and the worker agree on when the server's day ends.
 */
function dayInZone(ms, tz) {
  if (typeof tz !== 'string') return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms))
    const part = (type) => (parts.find((p) => p.type === type) || { value: '' }).value
    return part('year').padStart(4, '0') + '-' + part('month') + '-' + part('day')
  } catch {
    return null
  }
}

function nextDay(iso) {
  const day = new Date(iso + 'T00:00:00Z')
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

/**
 * Today's copy for a request without a date: among the kept answers, the one whose date is today
 * in its own `tz` (an answer for a plain request before one for a day ahead that has since become
 * today, then the newest saved); failing that the newest older day. A day that has not come yet
 * is never today.
 */
async function todayCopy(cache, route) {
  const now = Date.now()
  const found = []
  for (const key of await cache.keys()) {
    if (new URL(key.url).pathname !== TODAY_PATH) continue
    const response = await fresh(cache, key.url, route.ttlMs)
    if (response === undefined) continue
    let body
    try {
      body = await response.clone().json()
    } catch {
      continue
    }
    const today = dayInZone(now, body && body.tz)
    if (today === null || typeof body.date !== 'string') continue
    found.push({
      response,
      date: body.date,
      today,
      preview: Boolean(body.coach && body.coach.preview === true),
      savedAt: Number(response.headers.get(SAVED_AT)),
    })
  }
  const bySaving = (a, b) => Number(a.preview) - Number(b.preview) || b.savedAt - a.savedAt
  const current = found.filter((entry) => entry.date === entry.today).sort(bySaving)
  if (current.length > 0) return current[0].response
  const older = found
    .filter((entry) => entry.date < entry.today)
    .sort((a, b) => (a.date === b.date ? bySaving(a, b) : a.date < b.date ? 1 : -1))
  return older.length > 0 ? older[0].response : undefined
}

/** A copy of Today's answer that tells the page it is the phone's own. */
async function marked(response) {
  try {
    const body = await response.json()
    body.servedFromCache = true
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  } catch {
    return undefined
  }
}

/** The kept copy for a request, in the form the page gets it. */
async function readCopy(url, route) {
  const cache = await caches.open(API_CACHE)
  if (route.path !== TODAY_PATH) return fresh(cache, url.href, route.ttlMs)
  const copy =
    url.search === '' ? await todayCopy(cache, route) : await fresh(cache, url.href, route.ttlMs)
  return copy === undefined ? undefined : marked(copy)
}

/** Drops the kept answers of Today that are older than their time limit. */
async function dropExpiredToday(cache) {
  for (const key of await cache.keys()) {
    if (new URL(key.url).pathname === TODAY_PATH) await fresh(cache, key.url, API_TTL_MS)
  }
}

/**
 * Keeps a 200 answer under its URL, stamped with the time. Today's payload loses its watch slot
 * first. Resolves to the parsed payload of Today, else undefined; a cache that will not take the
 * answer (storage full) leaves the page unaffected.
 */
async function save(key, response, route) {
  try {
    const cache = await caches.open(API_CACHE)
    let payload
    let body
    if (route.path === TODAY_PATH) {
      body = await response.json()
      const slots = body && body.coach && body.coach.slots
      if (slots && slots.watch !== undefined) slots.watch = null
      payload = JSON.stringify(body)
    } else {
      payload = await response.arrayBuffer()
    }
    await cache.put(
      key,
      new Response(payload, {
        status: 200,
        headers: {
          'Content-Type': response.headers.get('content-type') || 'application/json',
          [SAVED_AT]: String(Date.now()),
        },
      }),
    )
    if (route.path === TODAY_PATH) await dropExpiredToday(cache)
    return body
  } catch {
    return undefined
  }
}

/** Empties the kept answers and the warm stamp: the session they belong to is gone. */
async function purgeApi() {
  await caches.delete(API_CACHE)
  await caches.delete(META_CACHE)
}

function apiRead(event, url, route) {
  const keep = (response) => {
    if (response.status === 401) {
      event.waitUntil(purgeApi())
    } else if (response.status === 200) {
      event.waitUntil(
        save(url.href, response.clone(), route).then((body) => {
          // A fresh answer for today starts a warm; one for a day ahead (the warm's own) does not.
          const date = route.path === TODAY_PATH && url.search === '' ? dateOf(body) : null
          return date === null ? undefined : warmIfDue(date)
        }),
      )
    }
    return response
  }
  return networkFirst(event, () => readCopy(url, route), keep)
}

// ---- Warm ------------------------------------------------------------------------------------

let warming = null

/** True when ten minutes have passed since the last completed warm. */
async function warmIsDue() {
  const hit = await (await caches.open(META_CACHE)).match(absolute(WARM_STAMP))
  const last = hit === undefined ? 0 : Number(await hit.text())
  const age = Date.now() - last
  return !(age >= 0 && age < WARM_INTERVAL_MS)
}

async function stampWarm() {
  await (await caches.open(META_CACHE)).put(absolute(WARM_STAMP), new Response(String(Date.now())))
}

/**
 * Fetches one API path into the cache. `reached` is true when the server answered at all, and
 * `unauthorized` when the session is gone (the cache is emptied then).
 */
async function refresh(path) {
  try {
    const url = new URL(absolute(path))
    const route = apiRoute(url)
    const response = await fetch(url.href)
    if (response.status === 401) {
      await purgeApi()
      return { reached: true, unauthorized: true }
    }
    if (response.status !== 200 || route === null) return { reached: true }
    return { reached: true, body: await save(url.href, response, route) }
  } catch {
    return { reached: false }
  }
}

/** The `date` of a Today payload when it is a calendar date, else null. */
function dateOf(body) {
  return body && typeof body.date === 'string' && ISO_DATE.test(body.date) ? body.date : null
}

/**
 * Fills the cache for offline use: the allowlist, and tomorrow's preview of Today. `todayDate` is
 * today's date when the caller has just kept today's payload (it is not fetched again), else null.
 * Resolves to true when the server was reached and the session is still there, so a warm that got no
 * answer (no signal) or met a 401 does not use up the ten minutes.
 */
async function warmCache(todayDate) {
  let reached = false
  const ask = async (path) => {
    const answer = await refresh(path)
    if (answer.reached) reached = true
    return answer
  }
  let date = todayDate
  if (date === null) {
    const answer = await ask(TODAY_PATH)
    if (answer.unauthorized === true) return false
    date = dateOf(answer.body)
  }
  for (const path of ['/api/auth/me', '/api/setup', '/api/settings']) {
    if ((await ask(path)).unauthorized === true) return false
  }
  // The research parameters hardly change; they are fetched when none are kept.
  const research = API_ROUTES.find((route) => route.path === '/api/research/params')
  const kept = await fresh(await caches.open(API_CACHE), absolute(research.path), research.ttlMs)
  if (kept === undefined && (await ask(research.path)).unauthorized === true) return false
  if (date !== null) await ask(TODAY_PATH + '?date=' + nextDay(date))
  return reached
}

/** Warms the cache unless it was warmed in the last ten minutes. Never rejects. */
function warmIfDue(todayDate) {
  if (warming === null) {
    warming = (async () => {
      if ((await warmIsDue()) && (await warmCache(todayDate))) await stampWarm()
    })()
      .catch(() => {})
      .finally(() => {
        warming = null
      })
  }
  return warming
}

// ---- Events ----------------------------------------------------------------------------------

async function install() {
  const cache = await caches.open(SHELL_CACHE)
  await cache.addAll(PRECACHE.map(absolute))
  await self.skipWaiting()
}

async function activate() {
  const names = (await caches.keys()).filter((name) => name.startsWith(SHELL_PREFIX))
  const older = names.filter((name) => name !== SHELL_CACHE)
  const dropped = older.slice(0, Math.max(0, older.length - (SHELL_GENERATIONS - 1)))
  await Promise.all(dropped.map((name) => caches.delete(name)))
  await self.clients.claim()
}

self.addEventListener('install', (event) => {
  event.waitUntil(install())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(activate())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    if (!/^\/api(\/|$)/.test(url.pathname)) event.respondWith(answerNavigation(event))
    return
  }
  const route = apiRoute(url)
  if (route !== null) {
    event.respondWith(apiRead(event, url, route))
    return
  }
  if (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(shellFirst(request))
  }
})

// The page asks for a warm when it opens, which is how the first visit after an install fills the
// cache: that visit's own requests went out before the worker took the page over.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'rl:warm') event.waitUntil(warmIfDue(null))
})
