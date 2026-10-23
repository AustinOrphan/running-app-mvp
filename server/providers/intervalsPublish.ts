// The intervals.icu publish channel [ADR 0008, design 4.4 and 6.6]. A planned run becomes a WORKOUT
// event in the runner's intervals.icu calendar, and intervals.icu's own Garmin upload (which the
// runner switches on there) carries it to the watch. This module only talks to intervals.icu:
// `server/services/publish.ts` owns the publication rows, and nothing here touches the database.
//
// Network goes through `ctx.fetch`. The API key is read from `ctx.secret` for the Authorization
// header and nowhere else: no message, outcome or return value carries it, and a remote answer is
// stripped of any echo of it before it is kept.
import {
  httpStatusSentence,
  publishSentence,
  rejectedReasonSentence,
  rejectedSentence,
} from '../../shared/copy/publish.ts'
import type { Units } from '../../shared/types.ts'
import { easedLine, effortPhrase, targetPhrase } from '../../shared/workouts/plan.ts'
import type {
  StepTarget,
  WorkoutNode,
  WorkoutPlan,
  WorkoutStep,
} from '../../shared/workouts/types.ts'
import { authHeader, BASE_URL, credentials } from './intervals.ts'
import {
  PublishError,
  PublishPause,
  RateLimitPause,
  type OutboundWorkout,
  type ProviderCtx,
  type PublishFailCode,
  type PublishProvider,
  type PublishReference,
  type RemoteWorkout,
  type UpsertOutcome,
} from './types.ts'

/** Events per bulk call. A run of 14 days is one create call and one delete call at most. */
const CHUNK_SIZE = 50
/** The longest message kept: the column limit of `WristPublication.failMessage`. */
const MESSAGE_MAX = 200
/** The key limit is 2,500 calls per 15 minutes, so a 429 without `Retry-After` waits that long. */
const DEFAULT_RETRY_AFTER_SEC = 15 * 60
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Warning codes of an `UpsertOutcome`; the service words them. */
export const WARNING_UNPARSED_STEPS = 'unparsed-steps'
export const WARNING_NO_MAX_HR = 'no-max-hr'
export const WARNING_NO_THRESHOLD_PACE = 'no-threshold-pace'

// ---------------------------------------------------------------------------------------------
// The description [design 6.5]
// ---------------------------------------------------------------------------------------------

export interface IntervalsDescription {
  /** The text of the event: a header of absolute figures, then steps in intervals.icu's syntax. */
  text: string
  /** `no-max-hr` and `no-threshold-pace`: a step that needed a figure the remote does not hold. */
  warnings: string[]
}

/** Heart rate as a percentage of maximum, rounded down so the watch never alerts early. */
const percentOfMaxHr = (bpm: number, maxHr: number): number => Math.floor((bpm * 100) / maxHr)

/** Pace as a percentage of threshold pace (speed, so a faster pace is a larger percentage). */
const percentOfThreshold = (secPerKm: number, thresholdPaceMps: number): number =>
  Math.round(100000 / (thresholdPaceMps * secPerKm))

const hasMaxHr = (ref: PublishReference): ref is PublishReference & { maxHr: number } =>
  ref.maxHr !== null && ref.maxHr > 0

const hasThreshold = (
  ref: PublishReference,
): ref is PublishReference & { thresholdPaceMps: number } =>
  ref.thresholdPaceMps !== null && ref.thresholdPaceMps > 0

/** The phrase of a figure for the header line: the words of the description, capitalised. */
function headerPhrase(target: StepTarget, units: Units): string {
  const phrase = targetPhrase(target, units) ?? ''
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`
}

/** `21-74% HR`, or `74% HR` when the two edges meet. */
const percentRange = (low: number, high: number, unit: string): string =>
  low < high ? `${String(low)}-${String(high)}% ${unit}` : `${String(high)}% ${unit}`

interface RenderedTarget {
  /** The target in intervals.icu syntax; null for an open step or a missing reference value. */
  token: string | null
  /** The same figures in the runner's units, for the header line. */
  absolute: string | null
  warning: string | null
}

function renderTarget(target: StepTarget, ref: PublishReference, units: Units): RenderedTarget {
  switch (target.kind) {
    case 'open':
      return { token: null, absolute: null, warning: null }
    case 'hr-ceiling': {
      const absolute = headerPhrase(target, units)
      if (!hasMaxHr(ref)) return { token: null, absolute, warning: WARNING_NO_MAX_HR }
      const high = percentOfMaxHr(target.ceilingBpm, ref.maxHr)
      const low = percentOfMaxHr(target.floorBpm, ref.maxHr)
      return { token: percentRange(low, high, 'HR'), absolute, warning: null }
    }
    case 'hr-band': {
      const absolute = headerPhrase(target, units)
      if (!hasMaxHr(ref)) return { token: null, absolute, warning: WARNING_NO_MAX_HR }
      const low = percentOfMaxHr(target.lowBpm, ref.maxHr)
      const high = percentOfMaxHr(target.highBpm, ref.maxHr)
      return { token: percentRange(low, high, 'HR'), absolute, warning: null }
    }
    case 'pace': {
      const absolute = headerPhrase(target, units)
      if (!hasThreshold(ref)) return { token: null, absolute, warning: WARNING_NO_THRESHOLD_PACE }
      const slow = percentOfThreshold(target.slowSecPerKm, ref.thresholdPaceMps)
      const fast = percentOfThreshold(target.fastSecPerKm, ref.thresholdPaceMps)
      return { token: percentRange(slow, fast, 'Pace'), absolute, warning: null }
    }
  }
}

/** `1h`, `45m`, `1h5m`, `2m30s`: the durations intervals.icu reads. */
function durationToken(sec: number): string {
  const total = Math.max(1, Math.round(sec))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${hours > 0 ? `${String(hours)}h` : ''}${minutes > 0 ? `${String(minutes)}m` : ''}${seconds > 0 ? `${String(seconds)}s` : ''}`
}

/** The step name written before the duration; "pace" is a target keyword there, so "Race pace" is "Race". */
const cueOf = (label: string): string =>
  label
    .replace(/\bpace\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The text of the event: lines that describe (the eased line, the heat note, one header line with
 * "By effort" on a day run by effort and the figures in the runner's units), then the steps as `- Cue 10m 55-70% HR` lines, a `4x` line
 * before the steps of a repeat, and the fuel line last. Heart rate is a percentage of maximum
 * rounded down and pace a percentage of threshold pace, because those are what the watch is given;
 * a step that needs a figure the remote does not hold is written open, and the header still
 * carries the absolute figure. Every number is a number of a step of `plan`.
 */
export function renderIntervalsDescription(
  plan: WorkoutPlan,
  ref: PublishReference,
): IntervalsDescription {
  const header = new Set<string>()
  const warnings = new Set<string>()
  // A day run by effort says so first, as the workout file does in its notes; on a hot day the
  // heat note below already says it. The figures that follow are guides.
  if (plan.targets.mode === 'effort' && !plan.targets.hot) {
    const phrase = effortPhrase(plan.units)
    header.add(`${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`)
  }

  const stepLine = (step: WorkoutStep): string => {
    const rendered = renderTarget(step.target, ref, plan.units)
    if (rendered.absolute !== null) header.add(rendered.absolute)
    if (rendered.warning !== null) warnings.add(rendered.warning)
    const cue = cueOf(step.label)
    const parts = [cue, durationToken(step.durationSec), rendered.token].filter(
      (part): part is string => part !== null && part !== '',
    )
    return `- ${parts.join(' ')}`
  }

  // Consecutive single steps share a block; a repeat is a block of its own, set off by blank lines.
  const blocks: string[] = []
  let singles: string[] = []
  const flush = (): void => {
    if (singles.length > 0) blocks.push(singles.join('\n'))
    singles = []
  }
  const place = (node: WorkoutNode): void => {
    if (node.type === 'step') {
      singles.push(stepLine(node))
      return
    }
    flush()
    blocks.push([`${String(node.count)}x`, ...node.steps.map(stepLine)].join('\n'))
  }
  plan.nodes.forEach(place)
  flush()

  const preface = [
    ...(plan.eased ? [easedLine(plan.units)] : []),
    ...(plan.targets.hot && plan.targets.hotNote !== null ? [plan.targets.hotNote] : []),
    ...(header.size > 0 ? [[...header].join('; ')] : []),
  ]
  const sections = [
    ...(preface.length > 0 ? [preface.join('\n')] : []),
    ...blocks,
    ...(plan.fuelLine === null ? [] : [plan.fuelLine]),
  ]
  return { text: sections.join('\n\n'), warnings: [...warnings].sort() }
}

// ---------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------

interface Credentials {
  athleteId: string
  apiKey: string
}

const NOT_CONNECTED = publishSentence('publish.not-connected')
const UNREACHABLE = publishSentence('publish.unreachable')
const NO_EVENT = publishSentence('publish.no-event')

function credentialsOrNull(ctx: ProviderCtx): Credentials | null {
  try {
    return credentials(ctx)
  } catch {
    return null
  }
}

function credentialsOf(ctx: ProviderCtx): Credentials {
  const found = credentialsOrNull(ctx)
  if (found === null) throw new PublishError('not-connected', NOT_CONNECTED)
  return found
}

/** A remote text with the key (and the header built from it) removed, on one line, capped. */
function clean(text: string, apiKey: string): string {
  let out = text
  // The longest forms first, so a header is removed whole and not just its encoded key.
  const secrets = [authHeader(apiKey), Buffer.from(`API_KEY:${apiKey}`).toString('base64'), apiKey]
  for (const secret of secrets) {
    if (secret !== '') out = out.split(secret).join('[removed]')
  }
  return capped(
    out
      .replace(/\p{Cc}+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

/** A text cut to the longest message kept. */
function capped(text: string): string {
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1).trimEnd()}…` : text
}

interface Call {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  body?: unknown
}

/** One authenticated call; null when the request never got an answer. */
async function transport(
  ctx: ProviderCtx,
  apiKey: string,
  request: Call,
): Promise<Response | null> {
  const headers: Record<string, string> = {
    authorization: authHeader(apiKey),
    accept: 'application/json',
  }
  const init: RequestInit = { method: request.method, headers }
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(request.body)
  }
  try {
    return await ctx.fetch(`${BASE_URL}${request.path}`, init)
  } catch {
    // The error text of a transport failure can name the URL; none of it is kept.
    return null
  }
}

/** `transport` for the calls that throw: an unanswered request is a `network` error. */
async function call(ctx: ProviderCtx, apiKey: string, request: Call): Promise<Response> {
  const response = await transport(ctx, apiKey, request)
  if (response === null) throw new PublishError('network', UNREACHABLE)
  return response
}

function retryAfterSec(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SEC
}

/** The reason of a 400 or 422: the remote's own words, or null when it gives none. */
async function remoteReason(response: Response, apiKey: string): Promise<string | null> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>
      for (const key of ['error', 'message', 'detail']) {
        if (typeof record[key] === 'string') {
          text = record[key]
          break
        }
      }
    }
  } catch {
    // Not JSON: the text itself is the message.
  }
  return clean(text, apiKey) || null
}

/**
 * What a response that is not a success means [design 6.6]: 401 and 403 ask for a reconnect, 400
 * and 422 are `rejected` with the remote's words, a server error is `network` (try again later),
 * any other status is `rejected`. A 429 throws.
 */
async function problemOf(
  response: Response,
  apiKey: string,
): Promise<{ code: PublishFailCode; message: string }> {
  const status = response.status
  if (status === 429) {
    throw new RateLimitPause(publishSentence('publish.rate-limited'), {
      retryAfterSec: retryAfterSec(response),
    })
  }
  if (status === 401 || status === 403) {
    return { code: 'auth', message: publishSentence('publish.auth') }
  }
  if (status === 400 || status === 422) {
    const reason = await remoteReason(response, apiKey)
    return {
      code: 'rejected',
      message: reason === null ? rejectedSentence(status) : capped(rejectedReasonSentence(reason)),
    }
  }
  return {
    code: status >= 500 ? 'network' : 'rejected',
    message: httpStatusSentence(status),
  }
}

async function failed(response: Response, apiKey: string): Promise<PublishError> {
  const { code, message } = await problemOf(response, apiKey)
  return new PublishError(code, message)
}

/** The JSON body of an answer, or null when it is not JSON. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

/** The JSON body of a call that must have one. */
async function requireJson(response: Response): Promise<unknown> {
  const body = await readJson(response)
  if (body === null) {
    throw new PublishError('rejected', publishSentence('publish.unreadable'))
  }
  return body
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function numberIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

const athletePath = (athleteId: string): string => `/athlete/${encodeURIComponent(athleteId)}`

// ---------------------------------------------------------------------------------------------
// reference
// ---------------------------------------------------------------------------------------------

/** Whether a sport settings entry is for running; `Run` is preferred over its variants. */
function runRank(entry: Record<string, unknown>): number {
  const types = Array.isArray(entry['types']) ? entry['types'] : []
  const names = types.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase())
  if (names.includes('run')) return 0
  if (names.includes('virtualrun') || names.includes('trailrun')) return 1
  return 2
}

/**
 * The Run entry of the athlete's sport settings. Defensive about names (`max_hr` or `maxHr`) and
 * about nonsense values, which read as missing; the first live run checks the real field names.
 * Threshold pace is metres per second.
 */
export function parseReference(raw: unknown): PublishReference {
  const entries: unknown[] = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw['sportSettings'])
      ? raw['sportSettings']
      : []
  const run = entries
    .filter(isRecord)
    .map((entry) => ({ entry, rank: runRank(entry) }))
    .filter(({ rank }) => rank < 2)
    .sort((a, b) => a.rank - b.rank)[0]?.entry
  if (run === undefined) return { maxHr: null, lthr: null, thresholdPaceMps: null }
  return {
    maxHr: numberIn(run['max_hr'] ?? run['maxHr'], 100, 240),
    lthr: numberIn(run['lthr'], 80, 230),
    thresholdPaceMps: numberIn(run['threshold_pace'] ?? run['thresholdPace'], 1, 9),
  }
}

// ---------------------------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------------------------

/** What `push_errors` says about the watch upload, or null when it is empty. */
function deviceMessageOf(pushErrors: unknown, apiKey: string): string | null {
  if (!Array.isArray(pushErrors)) return null
  const messages = pushErrors
    .map((item: unknown) => {
      if (typeof item === 'string') return item
      if (isRecord(item)) {
        const text = item['message'] ?? item['error']
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .map((text) => clean(text, apiKey))
    .filter((text) => text !== '')
  return messages.length === 0 ? null : clean(messages.join('; '), apiKey)
}

/** Whether intervals.icu read at least one step out of the text. */
function stepsParsed(event: Record<string, unknown>): boolean {
  const doc = event['workout_doc']
  return isRecord(doc) && Array.isArray(doc['steps']) && doc['steps'].length > 0
}

const remoteIdOf = (value: unknown): string | null =>
  typeof value === 'number' || (typeof value === 'string' && value !== '') ? String(value) : null

interface Prepared {
  index: number
  workout: OutboundWorkout
  body: Record<string, unknown>
  warnings: string[]
}

/**
 * The event as intervals.icu takes it. `start_date_local` is the day alone, so the workout has no
 * start time. The type is `Run` for every kind, the hike too, because the heart-rate percentages
 * come from the Run settings.
 */
function prepare(workout: OutboundWorkout, index: number, ref: PublishReference): Prepared {
  const { text, warnings } = renderIntervalsDescription(workout.plan, ref)
  return {
    index,
    workout,
    warnings,
    body: {
      category: 'WORKOUT',
      start_date_local: workout.date,
      type: 'Run',
      name: workout.name,
      description: text,
      external_id: workout.externalId,
    },
  }
}

/** The outcome of a send intervals.icu accepted; `event` is its answer, null when unreadable. */
function succeeded(
  item: Prepared,
  event: Record<string, unknown> | null,
  apiKey: string,
): UpsertOutcome {
  const { externalId, remoteId: known } = item.workout
  const remoteId = remoteIdOf(event?.['id']) ?? known
  if (remoteId === null) {
    return failure(item.workout, 'rejected', NO_EVENT)
  }
  // An unreadable answer says nothing about the steps, so only a readable one can warn.
  const warnings =
    event === null || stepsParsed(event)
      ? item.warnings
      : [...item.warnings, WARNING_UNPARSED_STEPS]
  return {
    externalId,
    ok: true,
    remoteId,
    warnings: [...new Set(warnings)].sort(),
    deviceMessage: deviceMessageOf(event?.['push_errors'], apiKey),
  }
}

const failure = (
  workout: OutboundWorkout,
  code: PublishFailCode,
  message: string,
): UpsertOutcome => ({ externalId: workout.externalId, ok: false, code, message })

/**
 * The created events of a bulk answer, matched to the chunk by `external_id`, then by position. An
 * event that echoes no `external_id` (absent or null) takes its position; one that echoes some other
 * id never does.
 */
function matchCreated(chunk: Prepared[], answer: unknown): Array<Record<string, unknown> | null> {
  const events = Array.isArray(answer) ? answer.filter(isRecord) : []
  const byExternalId = new Map<string, Record<string, unknown>>()
  for (const event of events) {
    if (typeof event['external_id'] === 'string') byExternalId.set(event['external_id'], event)
  }
  const positional = events.length === chunk.length
  return chunk.map((item, i) => {
    const matched = byExternalId.get(item.workout.externalId)
    if (matched !== undefined) return matched
    const same = positional ? events[i] : undefined
    return same !== undefined && (same['external_id'] ?? null) === null ? same : null
  })
}

async function upsert(
  workouts: OutboundWorkout[],
  ref: PublishReference,
  ctx: ProviderCtx,
): Promise<UpsertOutcome[]> {
  const creds = credentialsOrNull(ctx)
  if (creds === null)
    return workouts.map((workout) => failure(workout, 'not-connected', NOT_CONNECTED))
  const { athleteId, apiKey } = creds
  const base = athletePath(athleteId)
  const prepared = workouts.map((workout, index) => prepare(workout, index, ref))
  const outcomes = new Map<number, UpsertOutcome>()
  /** Fails every workout that has no outcome yet, for one reason that ends the run. */
  const stop = (code: PublishFailCode, message: string): void => {
    for (const item of prepared) {
      if (!outcomes.has(item.index)) outcomes.set(item.index, failure(item.workout, code, message))
    }
  }

  try {
    // New events first, in bulk; `upsert=true` lets a retry find an event it already created.
    const creates = prepared.filter((item) => item.workout.remoteId === null)
    for (let from = 0; from < creates.length; from += CHUNK_SIZE) {
      const chunk = creates.slice(from, from + CHUNK_SIZE)
      const response = await transport(ctx, apiKey, {
        method: 'POST',
        path: `${base}/events/bulk?upsert=true`,
        body: chunk.map((item) => item.body),
      })
      if (response === null) {
        stop('network', UNREACHABLE)
        break
      }
      if (!response.ok) {
        const { code, message } = await problemOf(response, apiKey)
        if (code === 'auth') {
          stop(code, message)
          break
        }
        for (const item of chunk) outcomes.set(item.index, failure(item.workout, code, message))
        continue
      }
      const created = matchCreated(chunk, await readJson(response))
      chunk.forEach((item, i) => {
        const event = created[i]
        outcomes.set(
          item.index,
          event === null || event === undefined
            ? failure(item.workout, 'rejected', NO_EVENT)
            : succeeded(item, event, apiKey),
        )
      })
    }

    // Known events one by one: the documented upsert matches only events made by the same OAuth
    // application, so the stored event id is the key. A changed date moves the event in place.
    for (const item of prepared) {
      const { remoteId } = item.workout
      if (remoteId === null || outcomes.has(item.index)) continue
      const response = await transport(ctx, apiKey, {
        method: 'PUT',
        path: `${base}/events/${encodeURIComponent(remoteId)}`,
        body: item.body,
      })
      if (response === null) {
        stop('network', UNREACHABLE)
        break
      }
      if (response.status === 404) {
        const message = publishSentence('publish.event-removed')
        outcomes.set(item.index, failure(item.workout, 'owner-removed', message))
        continue
      }
      if (!response.ok) {
        const { code, message } = await problemOf(response, apiKey)
        if (code === 'auth') {
          stop(code, message)
          break
        }
        outcomes.set(item.index, failure(item.workout, code, message))
        continue
      }
      const event = await readJson(response)
      outcomes.set(item.index, succeeded(item, isRecord(event) ? event : null, apiKey))
    }
  } catch (error) {
    // A 429 ends the run, but the events created before it keep their ids.
    if (error instanceof RateLimitPause) {
      throw new PublishPause(error.message, {
        retryAfterSec: error.retryAfterSec,
        outcomes: [...outcomes.values()],
      })
    }
    throw error
  }
  return workouts.map(
    (workout, index) => outcomes.get(index) ?? failure(workout, 'network', UNREACHABLE),
  )
}

// ---------------------------------------------------------------------------------------------
// withdraw and list
// ---------------------------------------------------------------------------------------------

/** intervals.icu ids are numbers; the stored id is text, so a digit string goes back as a number. */
const idForBody = (remoteId: string): string | number =>
  /^\d{1,15}$/.test(remoteId) ? Number(remoteId) : remoteId

async function withdraw(
  refs: Array<{ externalId: string; remoteId: string | null }>,
  ctx: ProviderCtx,
): Promise<void> {
  if (refs.length === 0) return
  const { athleteId, apiKey } = credentialsOf(ctx)
  const items = refs.map((ref) =>
    ref.remoteId === null ? { external_id: ref.externalId } : { id: idForBody(ref.remoteId) },
  )
  for (let from = 0; from < items.length; from += CHUNK_SIZE) {
    const response = await call(ctx, apiKey, {
      method: 'PUT',
      path: `${athletePath(athleteId)}/events/bulk-delete`,
      body: items.slice(from, from + CHUNK_SIZE),
    })
    if (!response.ok) throw await failed(response, apiKey)
  }
}

async function list(
  range: { from: string; to: string },
  ctx: ProviderCtx,
): Promise<RemoteWorkout[]> {
  if (!DATE.test(range.from) || !DATE.test(range.to)) {
    throw new Error(`Unreadable range: ${range.from} to ${range.to}`)
  }
  const { athleteId, apiKey } = credentialsOf(ctx)
  const response = await call(ctx, apiKey, {
    method: 'GET',
    path: `${athletePath(athleteId)}/events?oldest=${range.from}&newest=${range.to}&category=WORKOUT`,
  })
  if (!response.ok) throw await failed(response, apiKey)
  const events = await requireJson(response)
  const out: RemoteWorkout[] = []
  for (const event of Array.isArray(events) ? events : []) {
    if (!isRecord(event)) continue
    const remoteId = remoteIdOf(event['id'])
    const start = event['start_date_local']
    const date = typeof start === 'string' ? start.slice(0, 10) : ''
    if (remoteId === null || !DATE.test(date)) continue
    out.push({
      remoteId,
      externalId: typeof event['external_id'] === 'string' ? event['external_id'] : null,
      date,
      name: typeof event['name'] === 'string' ? clean(event['name'], apiKey) : '',
      deviceMessage: deviceMessageOf(event['push_errors'], apiKey),
    })
  }
  return out
}

async function reference(ctx: ProviderCtx): Promise<PublishReference> {
  const { athleteId, apiKey } = credentialsOf(ctx)
  const response = await call(ctx, apiKey, {
    method: 'GET',
    path: `${athletePath(athleteId)}/sport-settings`,
  })
  if (!response.ok) throw await failed(response, apiKey)
  return parseReference(await requireJson(response))
}

export const intervalsPublish: PublishProvider = { reference, upsert, withdraw, list }
