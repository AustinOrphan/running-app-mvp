import type { ParsedActivity, WellnessInput } from '../types.ts'
import { parseGpx } from './files/gpx.ts'

/**
 * Apple Health `export.xml` as an event-driven reducer, plus the small helpers the Health Auto
 * Export push mapper shares (dates, units, haversine). Pure code: the browser worker feeds it
 * SAX events, tests feed it the same events through `saxes` in Node.
 */

/** A workout found in pass one of the Apple Health export; pass two adds its heart rate. */
export interface AppleWorkout {
  providerKey: string
  startUtc: string
  endUtc: string
  /** The activity as far as pass one can build it, with empty samples. Pass two fills them in. */
  base?: ParsedActivity
}

export interface AppleExportReducer {
  onOpenTag(name: string, attrs: Record<string, string>): void
  onCloseTag(name: string): void
  passOneResult(): { workouts: AppleWorkout[]; wellness: WellnessInput[] }
  startPassTwo(workouts: AppleWorkout[]): void
  passTwoResult(): ParsedActivity[]
}

// ---------------------------------------------------------------------------------------------
// Dates

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/

export interface AppleDate {
  /** The instant, in milliseconds since the epoch. */
  ms: number
  /** Minutes east of UTC at that instant. */
  offsetMin: number
  /** The wall clock read as if it were UTC; shifting it by hours gives local calendar dates. */
  localMs: number
  /** The local calendar date, `YYYY-MM-DD`. */
  date: string
}

function zoneOffsetMin(ms: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms))
  const field = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const wall = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  )
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000)
}

/**
 * Reads `2026-03-02 08:00:00 -0500` or `2026-03-02T08:00:00-05:00`. Text without an offset is
 * read as wall-clock time in `timezone`. Returns `null` for anything else.
 */
export function parseAppleDate(text: string | undefined, timezone: string): AppleDate | null {
  if (text === undefined) return null
  const match = DATE_RE.exec(text.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s, zone] = match
  const localMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  )
  if (Number.isNaN(localMs)) return null
  let offsetMin: number
  let ms: number
  if (zone === undefined) {
    offsetMin = zoneOffsetMin(localMs, timezone)
    ms = localMs - offsetMin * 60_000
    const again = zoneOffsetMin(ms, timezone)
    if (again !== offsetMin) {
      offsetMin = again
      ms = localMs - offsetMin * 60_000
    }
  } else if (zone === 'Z') {
    offsetMin = 0
    ms = localMs
  } else {
    const digits = zone.replace(':', '')
    const sign = digits.startsWith('-') ? -1 : 1
    const hours = Number(digits.slice(1, 3))
    const minutes = Number(digits.slice(3, 5) || 0)
    offsetMin = sign * (hours * 60 + minutes)
    ms = localMs - offsetMin * 60_000
  }
  return { ms, offsetMin, localMs, date: `${y}-${mo}-${d}` }
}

// ---------------------------------------------------------------------------------------------
// Units and geometry

const M_PER_UNIT: Record<string, number> = {
  m: 1,
  meter: 1,
  meters: 1,
  km: 1000,
  cm: 0.01,
  mi: 1609.344,
  mile: 1609.344,
  miles: 1609.344,
  yd: 0.9144,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
}

/** Converts a length to metres; `null` for an unknown unit or a non-finite value. */
export function toMetres(value: number, unit: string): number | null {
  const factor = M_PER_UNIT[unit.trim().toLowerCase()]
  if (factor === undefined || !Number.isFinite(value)) return null
  return value * factor
}

const EARTH_RADIUS_M = 6_371_008.8

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Start coordinates are stored to 0.01 degrees. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100
}

/** Total of the positive steps of `alt` that exceed a 3 m swing (ignores sensor noise). */
export function climbAndDescent(alt: number[]): { gain: number; loss: number } {
  const threshold = 3
  let gain = 0
  let loss = 0
  let anchor = alt[0]
  if (anchor === undefined) return { gain, loss }
  for (const value of alt) {
    if (value - anchor >= threshold) {
      gain += value - anchor
      anchor = value
    } else if (anchor - value >= threshold) {
      loss += anchor - value
      anchor = value
    }
  }
  return { gain, loss }
}

/** For each time in `targets`, the value of the nearest source time. `sourceT` is ascending. */
export function nearestValues(targets: number[], sourceT: number[], sourceV: number[]): number[] {
  const out: number[] = []
  let j = 0
  for (const t of targets) {
    while (
      j + 1 < sourceT.length &&
      Math.abs((sourceT[j + 1] ?? 0) - t) <= Math.abs((sourceT[j] ?? 0) - t)
    ) {
      j++
    }
    out.push(sourceV[j] ?? 0)
  }
  return out
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

// ---------------------------------------------------------------------------------------------
// Workout mapping

export function emptySamples(): ParsedActivity['samples'] {
  return { t: [], d: null, hr: null, alt: null, cad: null, pwr: null }
}

const STRENGTH_TYPES = new Set([
  'TraditionalStrengthTraining',
  'FunctionalStrengthTraining',
  'CoreTraining',
])

function workoutType(activityType: string | undefined): {
  type: ParsedActivity['type']
  subtype: string | null
} {
  const name = (activityType ?? '').replace(/^HKWorkoutActivityType/, '')
  if (name === 'Running') return { type: 'run', subtype: null }
  if (STRENGTH_TYPES.has(name)) return { type: 'strength', subtype: null }
  return { type: 'cross', subtype: null }
}

function parseQuantity(text: string | undefined): { value: number; unit: string } | null {
  if (text === undefined) return null
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z]*)/.exec(text)
  if (!match) return null
  return { value: Number(match[1]), unit: match[2] ?? '' }
}

function deviceName(attrs: Record<string, string>): string | null {
  const device = attrs['device']
  const name = device === undefined ? null : /name:([^,>]+)/.exec(device)?.[1]?.trim()
  return name || attrs['sourceName'] || null
}

const DURATION_SEC: Record<string, number> = { sec: 1, s: 1, min: 60, hr: 3600, h: 3600 }

interface OpenWorkout {
  attrs: Record<string, string>
  meta: Record<string, string>
  stats: Array<Record<string, string>>
}

function buildWorkout(open: OpenWorkout, timezone: string): AppleWorkout | null {
  const start = parseAppleDate(open.attrs['startDate'], timezone)
  const end = parseAppleDate(open.attrs['endDate'], timezone)
  if (!start || !end) return null
  const elapsedSec = Math.round((end.ms - start.ms) / 1000)
  if (elapsedSec <= 0) return null
  const startUtc = new Date(start.ms).toISOString()
  const endUtc = new Date(end.ms).toISOString()

  const { type, subtype } = workoutType(open.attrs['workoutActivityType'])
  const indoor = open.meta['HKIndoorWorkout'] === '1'

  let distanceM: number | null = null
  const distanceStat = open.stats.find(
    (s) => s['type']?.startsWith('HKQuantityTypeIdentifierDistance') && s['sum'] !== undefined,
  )
  if (distanceStat) {
    distanceM = toMetres(Number(distanceStat['sum']), distanceStat['unit'] ?? 'm')
  } else if (open.attrs['totalDistance'] !== undefined) {
    distanceM = toMetres(
      Number(open.attrs['totalDistance']),
      open.attrs['totalDistanceUnit'] ?? 'm',
    )
  }

  const hrStat = open.stats.find((s) => s['type'] === 'HKQuantityTypeIdentifierHeartRate')
  const avgHr = hrStat?.['average'] === undefined ? null : Math.round(Number(hrStat['average']))
  const maxHr = hrStat?.['maximum'] === undefined ? null : Math.round(Number(hrStat['maximum']))
  const powerStat = open.stats.find((s) => s['type'] === 'HKQuantityTypeIdentifierRunningPower')
  const avgPowerW =
    powerStat?.['average'] === undefined ? null : Math.round(Number(powerStat['average']))

  const ascent = parseQuantity(open.meta['HKElevationAscended'])
  const elevationGainM = ascent ? toMetres(ascent.value, ascent.unit || 'cm') : null

  const durationUnit = DURATION_SEC[open.attrs['durationUnit'] ?? 'min']
  const duration = Number(open.attrs['duration'])
  const movingSec =
    durationUnit !== undefined && Number.isFinite(duration) && duration > 0
      ? Math.min(elapsedSec, Math.round(duration * durationUnit))
      : null

  const finite = (value: number | null): number | null =>
    value !== null && Number.isFinite(value) ? value : null
  const distanceRounded = finite(distanceM)

  const base: ParsedActivity = {
    providerKey: `apple:export:${startUtc}`,
    startUtc,
    utcOffsetMin: start.offsetMin,
    type,
    subtype: type === 'run' && indoor ? 'treadmill' : subtype,
    elapsedSec,
    movingSec,
    distanceM: distanceRounded === null ? null : Math.round(distanceRounded),
    elevationGainM: elevationGainM === null ? null : Math.round(elevationGainM),
    elevationLossM: null,
    avgHr: finite(avgHr),
    maxHr: finite(maxHr),
    avgCadence: null,
    avgPowerW: finite(avgPowerW),
    deviceName: deviceName(open.attrs),
    startLat: null,
    startLng: null,
    samples: emptySamples(),
    laps: [],
  }
  return { providerKey: base.providerKey, startUtc, endUtc, base }
}

// ---------------------------------------------------------------------------------------------
// The reducer

const T_RESTING = 'HKQuantityTypeIdentifierRestingHeartRate'
const T_HRV = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
const T_MASS = 'HKQuantityTypeIdentifierBodyMass'
const T_VO2 = 'HKQuantityTypeIdentifierVO2Max'
const T_SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis'
const T_HEART_RATE = 'HKQuantityTypeIdentifierHeartRate'

/**
 * Kilograms in one body-mass unit, by the lower-case unit name. The export parser here and the
 * Health Auto Export provider (`server/providers/appleHealth.ts`) both convert through it; a unit
 * missing from the table is skipped, never guessed.
 */
export const KG_PER: Record<string, number> = { kg: 1, lb: 0.45359237, lbs: 0.45359237, g: 0.001 }

interface DayFields {
  restingHr?: { ms: number; value: number }
  hrv: number[]
  weight?: { ms: number; value: number }
  vo2?: { ms: number; value: number }
}

const round1 = (value: number): number => Math.round(value * 10) / 10

function unionSeconds(segments: Array<[number, number]>): number {
  const sorted = [...segments].sort((a, b) => a[0] - b[0])
  let total = 0
  let curStart = -Infinity
  let curEnd = -Infinity
  for (const [s, e] of sorted) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart
      curStart = s
      curEnd = e
    } else if (e > curEnd) {
      curEnd = e
    }
  }
  if (curEnd > curStart) total += curEnd - curStart
  return Math.round(total / 1000)
}

/** An event-driven reducer fed by the SAX events of `export.xml`, in two passes. */
export function createAppleExportReducer(opts: { timezone: string }): AppleExportReducer {
  const { timezone } = opts
  let pass: 1 | 2 = 1
  let open: OpenWorkout | null = null
  const workouts: AppleWorkout[] = []
  /** Pass-one activities by key, so pass two works when the caller passes back only the keys. */
  const passOne = new Map<string, ParsedActivity>()
  const days = new Map<string, DayFields>()
  const sleep = new Map<string, Array<[number, number]>>()

  const day = (date: string): DayFields => {
    let fields = days.get(date)
    if (!fields) {
      fields = { hrv: [] }
      days.set(date, fields)
    }
    return fields
  }

  // Pass two state.
  let windows: Array<{ index: number; startMs: number; endMs: number; workout: AppleWorkout }> = []
  let maxWindowMs = 0
  let heartRates: Array<Array<{ t: number; hr: number }>> = []

  function recordPassOne(attrs: Record<string, string>): void {
    const type = attrs['type']
    if (type === T_SLEEP) {
      if (!/SleepAnalysisAsleep/.test(attrs['value'] ?? '')) return
      const start = parseAppleDate(attrs['startDate'], timezone)
      const end = parseAppleDate(attrs['endDate'], timezone)
      if (!start || !end || end.ms <= start.ms) return
      const key = new Date(end.localMs + 6 * 3_600_000).toISOString().slice(0, 10)
      const list = sleep.get(key) ?? []
      list.push([start.ms, end.ms])
      sleep.set(key, list)
      return
    }
    if (type !== T_RESTING && type !== T_HRV && type !== T_MASS && type !== T_VO2) return
    const when = parseAppleDate(attrs['startDate'], timezone)
    const value = Number(attrs['value'])
    if (!when || !Number.isFinite(value)) return
    const fields = day(when.date)
    if (type === T_RESTING) {
      if (!fields.restingHr || when.ms >= fields.restingHr.ms)
        fields.restingHr = { ms: when.ms, value }
    } else if (type === T_HRV) {
      fields.hrv.push(value)
    } else if (type === T_MASS) {
      const factor = KG_PER[(attrs['unit'] ?? 'kg').toLowerCase()]
      if (factor === undefined) return
      if (!fields.weight || when.ms >= fields.weight.ms) {
        fields.weight = { ms: when.ms, value: value * factor }
      }
    } else if (!fields.vo2 || when.ms >= fields.vo2.ms) {
      fields.vo2 = { ms: when.ms, value }
    }
  }

  function recordPassTwo(attrs: Record<string, string>): void {
    if (attrs['type'] !== T_HEART_RATE || windows.length === 0) return
    const when = parseAppleDate(attrs['startDate'], timezone)
    const value = Number(attrs['value'])
    if (!when || !Number.isFinite(value) || value <= 0) return
    // Last window starting at or before the record, then back while a window could still hold it.
    let lo = 0
    let hi = windows.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((windows[mid]?.startMs ?? 0) <= when.ms) lo = mid + 1
      else hi = mid
    }
    for (let i = lo - 1; i >= 0; i--) {
      const w = windows[i]
      if (!w || w.startMs < when.ms - maxWindowMs) break
      if (when.ms <= w.endMs) {
        heartRates[w.index]?.push({
          t: Math.round((when.ms - w.startMs) / 1000),
          hr: Math.round(value),
        })
      }
    }
  }

  return {
    onOpenTag(name, attrs) {
      if (name === 'Workout') {
        if (pass === 1) open = { attrs, meta: {}, stats: [] }
        return
      }
      if (name === 'Record') {
        if (pass === 1) recordPassOne(attrs)
        else recordPassTwo(attrs)
        return
      }
      if (pass !== 1 || !open) return
      if (name === 'MetadataEntry' && attrs['key'] !== undefined) {
        open.meta[attrs['key']] = attrs['value'] ?? ''
      } else if (name === 'WorkoutStatistics') {
        open.stats.push(attrs)
      }
    },

    onCloseTag(name) {
      if (name !== 'Workout' || pass !== 1 || !open) return
      const workout = buildWorkout(open, timezone)
      open = null
      if (workout?.base) {
        workouts.push(workout)
        passOne.set(workout.providerKey, workout.base)
      }
    },

    passOneResult() {
      const dates = new Set<string>([...days.keys(), ...sleep.keys()])
      const wellness: WellnessInput[] = [...dates].sort().map((date) => {
        const fields = days.get(date)
        const segments = sleep.get(date)
        const sleepSec = segments ? unionSeconds(segments) : 0
        return {
          date,
          restingHr: fields?.restingHr ? Math.round(fields.restingHr.value) : null,
          hrvRmssd: null,
          hrvSdnn: fields && fields.hrv.length > 0 ? round1(mean(fields.hrv)) : null,
          sleepSec: sleepSec > 0 ? sleepSec : null,
          sleepScore: null,
          weightKg: fields?.weight ? round1(fields.weight.value) : null,
          vo2max: fields?.vo2 ? round1(fields.vo2.value) : null,
        }
      })
      return {
        workouts: [...workouts].sort((a, b) => a.startUtc.localeCompare(b.startUtc)),
        wellness,
      }
    },

    startPassTwo(list) {
      pass = 2
      open = null
      windows = list
        .map((workout) => ({
          startMs: Date.parse(workout.startUtc),
          endMs: Date.parse(workout.endUtc),
          workout,
        }))
        .filter((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs))
        .sort((a, b) => a.startMs - b.startMs)
        .map((w, index) => ({ ...w, index }))
      maxWindowMs = windows.reduce((max, w) => Math.max(max, w.endMs - w.startMs), 0)
      heartRates = windows.map(() => [])
    },

    passTwoResult() {
      const out: ParsedActivity[] = []
      for (const w of windows) {
        const base = w.workout.base ?? passOne.get(w.workout.providerKey)
        if (!base) {
          throw new Error(`Workout ${w.workout.providerKey} was not found in pass one.`)
        }
        const points = (heartRates[w.index] ?? []).sort((a, b) => a.t - b.t)
        if (points.length === 0) {
          out.push(base)
          continue
        }
        const hr = points.map((p) => p.hr)
        out.push({
          ...base,
          avgHr: base.avgHr ?? Math.round(mean(hr)),
          maxHr: base.maxHr ?? hr.reduce((m, v) => Math.max(m, v), -Infinity),
          samples: { ...emptySamples(), t: points.map((p) => p.t), hr },
        })
      }
      return out
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Routes

/**
 * Adds the altitude, distance and start location of a `workout-routes/*.gpx` to an activity.
 * A route file the GPX parser rejects (`RangeError`), or one with no points inside the workout,
 * leaves the activity unchanged: the workout still imports without its route.
 */
export function attachRoute(activity: ParsedActivity, gpxText: string): ParsedActivity {
  let route: ParsedActivity | undefined
  try {
    // Only the shape matters here, so the zone used to read local times is irrelevant.
    route = parseGpx(new TextEncoder().encode(gpxText), { timezone: 'UTC' })[0]
  } catch (error) {
    if (error instanceof RangeError) return activity
    throw error
  }
  if (!route || route.samples.t.length === 0) return activity

  const shiftSec = (Date.parse(route.startUtc) - Date.parse(activity.startUtc)) / 1000
  if (!Number.isFinite(shiftSec)) return activity
  const keep: number[] = []
  route.samples.t.forEach((t, i) => {
    const shifted = t + shiftSec
    if (shifted >= 0 && shifted <= activity.elapsedSec) keep.push(i)
  })
  if (keep.length === 0) return activity

  const pick = (values: number[] | null): number[] | null =>
    values === null ? null : keep.map((i) => values[i] ?? 0)
  const t = keep.map((i) => Math.round((route.samples.t[i] ?? 0) + shiftSec))
  const hr =
    activity.samples.hr && activity.samples.hr.length > 0
      ? nearestValues(t, activity.samples.t, activity.samples.hr)
      : null

  return {
    ...activity,
    distanceM: activity.distanceM ?? route.distanceM,
    elevationGainM: activity.elevationGainM ?? route.elevationGainM,
    elevationLossM: activity.elevationLossM ?? route.elevationLossM,
    startLat: route.startLat === null ? null : roundCoordinate(route.startLat),
    startLng: route.startLng === null ? null : roundCoordinate(route.startLng),
    samples: {
      t,
      d: pick(route.samples.d),
      hr,
      alt: pick(route.samples.alt),
      cad: null,
      pwr: null,
    },
  }
}
