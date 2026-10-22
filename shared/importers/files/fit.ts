import FitParser from 'fit-file-parser'
import type { ParsedFit } from 'fit-file-parser'
import type { Lap, ParsedActivity } from '../../types.ts'
import {
  classifySport,
  elevationGainLoss,
  fillSamples,
  isFootActivity,
  mean,
  msToUtcIso,
  offsetMinFor,
  roundCoord,
  shaProviderKey,
  toNumber,
  withIndex,
} from './summarize.ts'
import type { RawPoint } from './summarize.ts'

type Message = Record<string, unknown>

/** The largest UTC offset in use is +14:00; anything beyond is a corrupt timestamp pair. */
const MAX_OFFSET_MIN = 14 * 60

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function decode(bytes: Uint8Array): ParsedFit {
  if (bytes.length === 0) throw new RangeError('Unreadable FIT file: it is empty')
  const out: { error?: unknown; data?: ParsedFit; finished: boolean } = { finished: false }
  try {
    // A copy, because the parser reads the whole buffer it is given.
    const copy = new Uint8Array(bytes).buffer
    // The callback runs before `parse` returns; the parser has no asynchronous step.
    new FitParser({ force: false, mode: 'list' }).parse(copy, (error, data) => {
      out.finished = true
      out.error = error
      out.data = data
    })
  } catch (e) {
    throw new RangeError(`Unreadable FIT file: ${reason(e)}`)
  }
  if (!out.finished) throw new RangeError('Unreadable FIT file: the parser did not finish')
  if (out.error || !out.data) throw new RangeError(`Unreadable FIT file: ${reason(out.error)}`)
  return out.data
}

function ms(value: unknown): number | null {
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  return null
}

function num(message: Message, key: string): number | null {
  return toNumber(message[key])
}

function text(message: Message, key: string): string | null {
  const v = message[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** Per-leg cadence plus its fractional part, or null. */
function cadenceOf(message: Message, key: string, fractionKey: string): number | null {
  const base = num(message, key)
  if (base === null) return null
  return base + (num(message, fractionKey) ?? 0)
}

function deviceName(infos: Message[]): string | null {
  const named = (m: Message): string | null => {
    const product = text(m, 'product_name')
    if (product) return product
    const maker = text(m, 'manufacturer')
    return maker ? maker.charAt(0).toUpperCase() + maker.slice(1).replace(/_/g, ' ') : null
  }
  const creator = infos.find((m) => m['device_index'] === 'creator' || m['device_index'] === 0)
  return (
    (creator && named(creator)) ?? infos.map(named).find((n): n is string => n !== null) ?? null
  )
}

function lapsOf(laps: Message[], startMs: number, endMs: number, foot: boolean): Lap[] {
  const out: Lap[] = []
  for (const lap of laps) {
    const start = ms(lap['start_time'])
    if (start === null || start < startMs || start >= endMs) continue
    const duration = num(lap, 'total_elapsed_time') ?? num(lap, 'total_timer_time')
    if (duration === null) continue
    const cadence = cadenceOf(lap, 'avg_cadence', 'avg_fractional_cadence')
    out.push({
      startSec: Math.round((start - startMs) / 1000),
      durationSec: Math.round(duration),
      distanceM: num(lap, 'total_distance'),
      avgHr: num(lap, 'avg_heart_rate'),
      maxHr: num(lap, 'max_heart_rate'),
      avgCadence: cadence === null ? null : Math.round(foot ? cadence * 2 : cadence),
    })
  }
  return out
}

/** One activity per FIT session. Throws `RangeError` with a reason for an unreadable file. */
export function parseFit(bytes: Uint8Array, opts: { timezone: string }): ParsedActivity[] {
  const fit = decode(bytes)
  const sessions = ((fit.sessions ?? []) as Message[])
    .map((session) => ({ session, startMs: ms(session['start_time']) }))
    .filter((s): s is { session: Message; startMs: number } => s.startMs !== null)
    .sort((a, b) => a.startMs - b.startMs)
  if (sessions.length === 0) return []

  const records = (fit.records ?? []) as Message[]
  const laps = (fit.laps ?? []) as Message[]
  const infos = (fit.device_infos ?? []) as Message[]
  const fileId = ((fit.file_ids ?? []) as Message[])[0]
  const activity = (fit.activity ?? {}) as Message

  // Sessions are sequential; a record belongs to the last session that started before it.
  const sessionOf = (time: number): number => {
    let index = 0
    for (let i = 0; i < sessions.length; i++) if (sessions[i]!.startMs <= time) index = i
    return index
  }
  const recordsBySession: Message[][] = sessions.map(() => [])
  for (const record of records) {
    const time = ms(record['timestamp'])
    if (time !== null) recordsBySession[sessionOf(time)]!.push(record)
  }

  const serial = fileId ? num(fileId, 'serial_number') : null
  const created = fileId ? ms(fileId['time_created']) : null
  const baseKey =
    serial !== null && created !== null ? `fit:${serial}-${Math.floor(created / 1000)}` : null

  const stamp = ms(activity['timestamp'])
  const local = ms(activity['local_timestamp'])
  const fileOffset = stamp !== null && local !== null ? Math.round((local - stamp) / 60_000) : null

  const result: ParsedActivity[] = []
  sessions.forEach(({ session, startMs }, index) => {
    const endMs = sessions[index + 1]?.startMs ?? Number.POSITIVE_INFINITY
    const sport = classifySport(text(session, 'sport'), text(session, 'sub_sport'))
    const foot = isFootActivity(sport.type, sport.subtype)
    const cadenceScale = foot ? 2 : 1

    const points: RawPoint[] = recordsBySession[index]!.flatMap((record) => {
      const time = ms(record['timestamp'])
      if (time === null) return []
      const cadence = cadenceOf(record, 'cadence', 'fractional_cadence')
      return [
        {
          t: Math.max(0, (time - startMs) / 1000),
          d: num(record, 'distance'),
          hr: num(record, 'heart_rate'),
          alt: num(record, 'enhanced_altitude') ?? num(record, 'altitude'),
          cad: cadence === null ? null : cadence * cadenceScale,
          pwr: num(record, 'power'),
        },
      ]
    })
    const samples = fillSamples(points)

    const elapsed = num(session, 'total_elapsed_time') ?? num(session, 'total_timer_time')
    const lastT = samples.t[samples.t.length - 1] ?? 0
    // Timer time includes stops unless auto-pause was on, so only a recorded moving time counts;
    // without one, summarize derives it from speed.
    const moving = num(session, 'total_moving_time')
    const lastDistance = samples.d ? samples.d[samples.d.length - 1]! : null
    const distance = num(session, 'total_distance') ?? lastDistance

    const change = samples.alt ? elevationGainLoss(samples.alt) : null
    const ascent = num(session, 'total_ascent')
    const descent = num(session, 'total_descent')

    const sessionCadence = cadenceOf(session, 'avg_cadence', 'avg_fractional_cadence')
    const avgCadence =
      sessionCadence !== null
        ? sessionCadence * cadenceScale
        : samples.cad
          ? mean(samples.cad)
          : null
    const lat = num(session, 'start_position_lat')
    const lng = num(session, 'start_position_long')
    const firstPositioned = recordsBySession[index]!.find(
      (r) => num(r, 'position_lat') !== null && num(r, 'position_long') !== null,
    )
    const startLat = lat ?? (firstPositioned ? num(firstPositioned, 'position_lat') : null)
    const startLng = lng ?? (firstPositioned ? num(firstPositioned, 'position_long') : null)

    const startUtc = msToUtcIso(startMs)
    const utcOffsetMin =
      fileOffset !== null && Math.abs(fileOffset) <= MAX_OFFSET_MIN
        ? fileOffset
        : offsetMinFor(startUtc, opts.timezone)

    const avgHr = num(session, 'avg_heart_rate') ?? mean(samples.hr ?? [])
    const maxHr =
      num(session, 'max_heart_rate') ??
      (samples.hr ? samples.hr.reduce((m, v) => Math.max(m, v), 0) : null)
    const avgPower = num(session, 'avg_power') ?? mean(samples.pwr ?? [])

    result.push({
      providerKey: baseKey ? withIndex(baseKey, index) : shaProviderKey(bytes, index),
      startUtc,
      utcOffsetMin,
      type: sport.type,
      subtype: sport.subtype,
      elapsedSec: Math.round(elapsed ?? lastT),
      movingSec: moving === null ? null : Math.round(moving),
      distanceM: distance === null ? null : Math.round(distance),
      elevationGainM: ascent ?? change?.gain ?? null,
      elevationLossM: descent ?? change?.loss ?? null,
      avgHr: avgHr === null ? null : Math.round(avgHr),
      maxHr: maxHr === null ? null : Math.round(maxHr),
      avgCadence: avgCadence === null ? null : Math.round(avgCadence),
      avgPowerW: avgPower === null ? null : Math.round(avgPower),
      deviceName: deviceName(infos),
      startLat: startLat === null ? null : roundCoord(startLat),
      startLng: startLng === null ? null : roundCoord(startLng),
      samples,
      laps: lapsOf(laps, startMs, endMs, foot),
    })
  })
  return result
}
