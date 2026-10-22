// Derived fields for a parsed activity, plus the small helpers the FIT, GPX and TCX parsers share.
// Everything here is pure and free of Node-only imports so the web bundle can use it too.
import { gradeAdjustedSpeed } from '../../engine/terrain.ts'
import { MAX_DURATION_SEC } from '../../limits.ts'
import type { ActivityStreamData, ActivityType, HrHistogram, ParsedActivity } from '../../types.ts'

export interface ActivitySummary {
  movingSec: number | null
  hrHistogram: HrHistogram | null
  decouplingPct: number | null
  gapDistanceM: number | null
  stream: ActivityStreamData & { sampleSec: number }
}

type Samples = ParsedActivity['samples']

/** Bucket width of the stream, in seconds, for any activity short enough to fit `MAX_STREAM_BUCKETS`. */
export const STREAM_SAMPLE_SEC = 10
/**
 * Most buckets a stream holds: 24 hours at 10 seconds. A longer activity gets wider buckets (a
 * multiple of 10 seconds, reported as `sampleSec`), so a multi-day file stays a bounded payload.
 */
export const MAX_STREAM_BUCKETS = 8640
/** Heart-rate histogram range: 1 bpm bins from 40 to 220 inclusive. */
export const HR_HIST_START = 40
export const HR_HIST_END = 220
/** A gap between two samples longer than this is a pause and counts as no time at all. */
export const MAX_GAP_SEC = 30
/** Speed above which a sample counts as moving. */
export const MOVING_SPEED_MPS = 0.5
/** Shortest run, in seconds, that gets an aerobic decoupling figure. */
export const DECOUPLING_MIN_SEC = 40 * 60
/** Width of the window the grade is smoothed over, in seconds. */
const GRADE_WINDOW_SEC = 30
const MAX_GRADE = 0.45

// ---------------------------------------------------------------------------------------------
// Numbers and times

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Rounds to the 0.01 degree the app stores for coordinates; never returns negative zero. */
export function roundCoord(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}

export function mean(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/** A finite number from a value that might be a number or a numeric string, else null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const ISO_ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i

/**
 * Normalises an ISO 8601 timestamp to `YYYY-MM-DDTHH:MM:SSZ`. A timestamp without a zone is read
 * as UTC (GPX and TCX define their times that way). Returns null when it does not parse.
 */
export function toUtcIso(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return null
  const ms = Date.parse(ISO_ZONE.test(text) ? text : `${text}Z`)
  if (Number.isNaN(ms)) return null
  return msToUtcIso(ms)
}

export function msToUtcIso(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timezone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timezone, f)
  }
  return f
}

/** Minutes the IANA `timezone` is ahead of UTC at `startUtc`, or null for an unknown zone. */
export function offsetMinFor(startUtc: string, timezone: string): number | null {
  const ms = Date.parse(startUtc)
  if (Number.isNaN(ms)) return null
  try {
    const parts = zoneFormatter(timezone).formatToParts(new Date(ms))
    const get = (type: string): number =>
      Number(parts.find((p) => p.type === type)?.value ?? Number.NaN)
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    )
    if (Number.isNaN(asUtc)) return null
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000)
  } catch {
    return null
  }
}

/**
 * The runner's local calendar date and start time (`YYYY-MM-DD`, `HH:MM`). The offset the file
 * recorded wins; otherwise the IANA `timezone` decides, and an unknown zone reads as UTC.
 */
export function localDateTime(
  startUtc: string,
  utcOffsetMin: number | null,
  timezone: string,
): { date: string; startTime: string } {
  const ms = Date.parse(startUtc)
  if (Number.isNaN(ms)) throw new RangeError(`Invalid start time: ${JSON.stringify(startUtc)}`)
  const offset = utcOffsetMin ?? offsetMinFor(startUtc, timezone) ?? 0
  const iso = new Date(ms + offset * 60_000).toISOString()
  return { date: iso.slice(0, 10), startTime: iso.slice(11, 16) }
}

/** Great-circle distance in metres between two coordinates. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Elevation gain and loss in whole metres. A change counts only once it passes `threshold`
 * metres from the last counted level, which keeps barometer and GPS wobble out of the totals.
 */
export function elevationGainLoss(
  altitudes: ReadonlyArray<number>,
  threshold = 1,
): { gain: number; loss: number } {
  let gain = 0
  let loss = 0
  let ref = altitudes[0]
  for (const alt of altitudes) {
    if (ref === undefined) break
    if (alt - ref >= threshold) {
      gain += alt - ref
      ref = alt
    } else if (ref - alt >= threshold) {
      loss += ref - alt
      ref = alt
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) }
}

// ---------------------------------------------------------------------------------------------
// SHA-256, for the `sha:` provider keys. Synchronous and dependency-free so it runs in a browser.

const SHA_K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/** Lower-case hex SHA-256 of `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  const h = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const bitLength = bytes.length * 8
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32))
  view.setUint32(padded.length - 4, bitLength >>> 0)
  const w = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!
      const w2 = w[i - 2]!
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + SHA_K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
    h[5] = (h[5]! + f) >>> 0
    h[6] = (h[6]! + g) >>> 0
    h[7] = (h[7]! + hh) >>> 0
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

/** `sha:<first 16 hex digits of the SHA-256 of the file>`, with `#n` for the n-th activity (n > 0). */
export function shaProviderKey(bytes: Uint8Array, index: number): string {
  return withIndex(`sha:${sha256Hex(bytes).slice(0, 16)}`, index)
}

/** Keeps the first activity of a file on the plain key and numbers the others. */
export function withIndex(key: string, index: number): string {
  return index === 0 ? key : `${key}#${index}`
}

// ---------------------------------------------------------------------------------------------
// Sport classification and samples, shared by the three parsers

export interface Sport {
  type: ActivityType
  subtype: string | null
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Maps a sport (and sub-sport) name from a FIT, GPX or TCX file to the app's type and subtype.
 * Unknown sports become cross-training "other"; the caller decides what a missing sport means.
 */
export function classifySport(sport: string | null, subSport: string | null = null): Sport {
  const s = normalizeName(sport)
  const ss = normalizeName(subSport)
  const both = `${s}|${ss}`
  const has = (word: string): boolean => both.includes(word)

  if (has('elliptical')) return { type: 'cross', subtype: 'elliptical' }
  if (s.includes('strength') || s === 'training' || ss.includes('strength') || has('weight')) {
    return { type: 'strength', subtype: null }
  }
  const runLike =
    s === 'running' || s === 'run' || s.endsWith('_running') || s === 'trail' || s === 'racing'
  if (runLike || (s === 'fitness_equipment' && ss === 'treadmill')) {
    let subtype: string | null = null
    if (has('trail')) subtype = 'trail'
    else if (has('treadmill') || has('indoor') || ss === 'virtual_activity') subtype = 'treadmill'
    else if (has('track')) subtype = 'track'
    else if (has('street') || has('road')) subtype = 'road'
    return { type: 'run', subtype }
  }
  if (s.includes('walk')) return { type: 'cross', subtype: 'walk' }
  if (s.includes('hik')) return { type: 'cross', subtype: 'hike' }
  if (s.includes('swim')) return { type: 'cross', subtype: 'swim' }
  if (s.includes('ski') || s.includes('snowboard')) return { type: 'cross', subtype: 'ski' }
  if (
    s.includes('cycl') ||
    s.includes('bik') ||
    s.includes('ride') ||
    s === 'e_biking' ||
    s.includes('cyclocross')
  ) {
    return { type: 'cross', subtype: 'bike' }
  }
  return { type: 'cross', subtype: 'other' }
}

/** Running, walking and hiking record cadence per leg; the app stores steps per minute. */
export function isFootActivity(type: ActivityType, subtype: string | null): boolean {
  return type === 'run' || type === 'race' || subtype === 'walk' || subtype === 'hike'
}

export interface RawPoint {
  /** Seconds from the start. */
  t: number
  d?: number | null
  hr?: number | null
  alt?: number | null
  cad?: number | null
  pwr?: number | null
}

/** Longest stretch, in seconds, a heart rate stands in for samples that recorded none. */
export const MAX_HR_FILL_SEC = 10

/**
 * Turns points with possibly missing values into aligned sample arrays. A channel nothing
 * recorded is null; otherwise gaps repeat the last value, and a gap at the start takes the first
 * value that exists. Heart rates at or below zero count as missing, and a heart rate is carried
 * across a gap of at most `MAX_HR_FILL_SEC` only: beyond that the sample holds 0, which every
 * consumer reads as no heart rate, so a dropped strap is not reported as a steady heart rate.
 */
export function fillSamples(points: ReadonlyArray<RawPoint>): Samples {
  const column = (
    pick: (p: RawPoint) => number | null | undefined,
    valid: (v: number) => boolean,
    maxFillSec = Number.POSITIVE_INFINITY,
  ) => {
    const raw = points.map((p) => {
      const v = pick(p)
      return typeof v === 'number' && Number.isFinite(v) && valid(v) ? v : null
    })
    const firstKnown = raw.findIndex((v) => v !== null)
    if (firstKnown < 0) return null
    let last = raw[firstKnown]!
    let lastT = points[firstKnown]!.t
    return raw.map((v, i) => {
      const t = points[i]!.t
      if (v !== null) {
        last = v
        lastT = t
        return v
      }
      return Math.abs(t - lastT) <= maxFillSec ? last : 0
    })
  }
  return {
    t: points.map((p) => Math.round(p.t * 1000) / 1000),
    d: column(
      (p) => p.d,
      () => true,
    ),
    hr: column(
      (p) => p.hr,
      (v) => v > 0,
      MAX_HR_FILL_SEC,
    ),
    alt: column(
      (p) => p.alt,
      () => true,
    ),
    cad: column(
      (p) => p.cad,
      () => true,
    ),
    pwr: column(
      (p) => p.pwr,
      () => true,
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// summarize

/**
 * Seconds each sample stands for: the time to the next sample, 0 across a pause longer than
 * `MAX_GAP_SEC`, and for the last sample the length of the interval before it.
 */
function sampleDurations(t: ReadonlyArray<number>): number[] {
  const n = t.length
  const out = new Array<number>(n).fill(0)
  let lastValid = 1
  for (let i = 0; i < n - 1; i++) {
    const gap = t[i + 1]! - t[i]!
    if (gap > 0 && gap <= MAX_GAP_SEC) {
      out[i] = gap
      lastValid = gap
    }
  }
  if (n > 0) out[n - 1] = lastValid
  return out
}

function buildStream(s: Samples): ActivitySummary['stream'] {
  const n = s.t.length
  if (n === 0)
    return {
      sampleSec: STREAM_SAMPLE_SEC,
      t: [],
      d: null,
      hr: null,
      alt: null,
      cad: null,
      pwr: null,
    }
  // A sample past the cap is a corrupt timestamp (the stream's bucket arrays are sized from the
  // last sample time): it neither sizes the stream nor lands in it.
  const inRange = (i: number): boolean => s.t[i]! <= MAX_DURATION_SEC
  let maxT = 0
  for (let i = 0; i < n; i++) if (inRange(i)) maxT = Math.max(maxT, s.t[i]!)
  const sampleSec =
    STREAM_SAMPLE_SEC * Math.max(1, Math.ceil(maxT / (MAX_STREAM_BUCKETS - 1) / STREAM_SAMPLE_SEC))
  const buckets = Math.floor(maxT / sampleSec) + 1
  const bucketOf = (i: number): number => Math.max(0, Math.floor(s.t[i]! / sampleSec))

  const means = (values: number[] | null, keep = (_v: number) => true): number[] | null => {
    if (!values) return null
    const sum = new Array<number>(buckets).fill(0)
    const count = new Array<number>(buckets).fill(0)
    for (let i = 0; i < n; i++) {
      if (!inRange(i) || !keep(values[i]!)) continue
      const b = bucketOf(i)
      sum[b]! += values[i]!
      count[b]! += 1
    }
    // An empty bucket (a pause) is NaN, which JSON stores as null.
    return sum.map((v, b) => (count[b]! > 0 ? round1(v / count[b]!) : Number.NaN))
  }

  let d: number[] | null = null
  if (s.d) {
    const ends = new Array<number | null>(buckets).fill(null)
    for (let i = 0; i < n; i++) if (inRange(i)) ends[bucketOf(i)] = s.d[i]!
    let last = s.d[0]!
    d = ends.map((v) => {
      if (v !== null) last = v
      return round1(last)
    })
  }
  return {
    sampleSec,
    t: Array.from({ length: buckets }, (_, b) => b * sampleSec),
    d,
    hr: means(s.hr, (v) => v > 0),
    alt: means(s.alt),
    cad: means(s.cad),
    pwr: means(s.pwr),
  }
}

function computeMovingSec(s: Samples): number | null {
  if (!s.d) return null
  let moving = 0
  for (let i = 0; i < s.t.length - 1; i++) {
    const gap = s.t[i + 1]! - s.t[i]!
    if (gap <= 0 || gap > MAX_GAP_SEC) continue
    if ((s.d[i + 1]! - s.d[i]!) / gap > MOVING_SPEED_MPS) moving += gap
  }
  return Math.round(moving)
}

function computeHistogram(s: Samples): HrHistogram | null {
  if (!s.hr) return null
  const durations = sampleDurations(s.t)
  const sec = new Array<number>(HR_HIST_END - HR_HIST_START + 1).fill(0)
  let total = 0
  for (let i = 0; i < s.t.length; i++) {
    const hr: number = s.hr[i]!
    if (!(hr > 0)) continue
    const bin = Math.min(HR_HIST_END, Math.max(HR_HIST_START, Math.round(hr))) - HR_HIST_START
    sec[bin]! += durations[i]!
    total += durations[i]!
  }
  if (total === 0) return null
  return { start: HR_HIST_START, width: 1, sec: sec.map((v) => Math.round(v * 1000) / 1000) }
}

/**
 * Heart rate per unit of speed in the second half of the run over the first half, minus 1, in
 * percent. Positive means drift: the same pace cost more heartbeats later on.
 */
function computeDecoupling(a: ParsedActivity): number | null {
  const s = a.samples
  if (a.type !== 'run' && a.type !== 'race') return null
  if (!s.hr || !s.d || s.t.length < 2) return null
  const first = s.t[0]!
  const span = s.t[s.t.length - 1]! - first
  if (span < DECOUPLING_MIN_SEC) return null
  const mid = first + span / 2
  const sumT = [0, 0]
  const sumD = [0, 0]
  const sumHr = [0, 0]
  for (let i = 0; i < s.t.length - 1; i++) {
    const gap = s.t[i + 1]! - s.t[i]!
    if (gap <= 0 || gap > MAX_GAP_SEC) continue
    const dd = s.d[i + 1]! - s.d[i]!
    if (dd / gap <= MOVING_SPEED_MPS) continue
    const hr = s.hr[i]!
    if (!(hr > 0)) continue
    const half = s.t[i]! < mid ? 0 : 1
    sumT[half]! += gap
    sumD[half]! += dd
    sumHr[half]! += hr * gap
  }
  if (sumT[0]! <= 0 || sumT[1]! <= 0 || sumD[0]! <= 0 || sumD[1]! <= 0) return null
  const costFirst = sumHr[0]! / sumT[0]! / (sumD[0]! / sumT[0]!)
  const costSecond = sumHr[1]! / sumT[1]! / (sumD[1]! / sumT[1]!)
  return Math.round((costSecond / costFirst - 1) * 10_000) / 100
}

/**
 * Distance scaled by the cost of the terrain relative to the flat, on a grade smoothed over
 * 30 seconds and clamped to plus or minus 45%. Downhill credit stops at the -20% minimum of the
 * cost curve (`gradeAdjustedSpeed`, rules I11).
 */
function computeGapDistance(a: ParsedActivity): number | null {
  const s = a.samples
  if (a.type !== 'run' && a.type !== 'race') return null
  if (!s.d || !s.alt || s.t.length < 2) return null
  const half = GRADE_WINDOW_SEC / 2
  let lo = 0
  let hi = 0
  let sumDist = 0
  let sumAdjusted = 0
  for (let i = 0; i < s.t.length - 1; i++) {
    const t = s.t[i]!
    while (s.t[lo]! < t - half) lo++
    if (hi < i) hi = i
    while (hi + 1 < s.t.length && s.t[hi + 1]! <= t + half) hi++
    const run = s.d[hi]! - s.d[lo]!
    let grade = run > 1 ? (s.alt[hi]! - s.alt[lo]!) / run : 0
    grade = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, grade))
    const dd = s.d[i + 1]! - s.d[i]!
    if (dd <= 0) continue
    sumDist += dd
    sumAdjusted += gradeAdjustedSpeed(dd, grade)
  }
  if (sumDist <= 0) return null
  const factor = sumAdjusted / sumDist
  return Math.round((a.distanceM ?? sumDist) * factor)
}

/** Derived fields and the 10-second stream for a parsed activity. */
export function summarize(parsed: ParsedActivity): ActivitySummary {
  return {
    movingSec: parsed.movingSec ?? computeMovingSec(parsed.samples),
    hrHistogram: computeHistogram(parsed.samples),
    decouplingPct: computeDecoupling(parsed),
    gapDistanceM: computeGapDistance(parsed),
    stream: buildStream(parsed.samples),
  }
}
