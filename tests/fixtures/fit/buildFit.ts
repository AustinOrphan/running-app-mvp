// Writes small synthetic FIT files for the parser tests: file_id, device_info, record, lap,
// session and activity messages with a valid header and CRC. No real recordings are involved.
import { FitBaseType, FitEncoder } from 'fit-file-parser'
import type { FitEncoderField } from 'fit-file-parser'

export interface FitRecordInput {
  /** Seconds from the session start. */
  t: number
  /** Cumulative metres. */
  distanceM?: number
  speedMps?: number
  hr?: number
  cadence?: number
  powerW?: number
  altitudeM?: number
  lat?: number
  lng?: number
}

export interface FitLapInput {
  startSec: number
  durationSec: number
  distanceM?: number
  avgHr?: number
  maxHr?: number
  avgCadence?: number
}

export interface FitSessionInput {
  /** FIT sport enum: 1 running, 2 cycling, 10 training, 11 walking, 17 hiking, 5 swimming. */
  sport: number
  /** FIT sub-sport enum: 0 generic, 1 treadmill, 3 trail, 4 track, 20 strength training. */
  subSport?: number
  /** Unix seconds of the first record. */
  startUnix: number
  durationSec: number
  timerSec?: number
  /** Written as `session.total_moving_time` when given. */
  movingSec?: number
  distanceM?: number
  ascentM?: number
  descentM?: number
  avgHr?: number
  maxHr?: number
  avgCadence?: number
  avgPowerW?: number
  lat?: number
  lng?: number
  records: FitRecordInput[]
  laps?: FitLapInput[]
}

export interface BuildFitOptions {
  serial?: number
  /** Unix seconds written as `file_id.time_created`. */
  timeCreatedUnix?: number
  /** Offset written as `activity.local_timestamp - timestamp`, in minutes. */
  utcOffsetMin?: number
  productName?: string
  /** Leaves out the file_id message. */
  omitFileId?: boolean
  sessions: FitSessionInput[]
}

const SEMICIRCLES_PER_DEG = 2 ** 31 / 180

const u8 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 1,
  baseType: FitBaseType.Uint8,
  value,
})
const e8 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 1,
  baseType: FitBaseType.Enum,
  value,
})
const u16 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 2,
  baseType: FitBaseType.Uint16,
  value: Math.round(value),
})
const u32 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 4,
  baseType: FitBaseType.Uint32,
  value: Math.round(value),
})
const s32 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 4,
  baseType: FitBaseType.Sint32,
  value: Math.round(value),
})
const u32z = (number: number, value: number): FitEncoderField => ({
  number,
  size: 4,
  baseType: FitBaseType.Uint32z,
  value,
})

function fitTime(unix: number): number {
  return FitEncoder.toFitTimestamp(new Date(unix * 1000))
}

function semicircles(deg: number): number {
  return Math.round(deg * SEMICIRCLES_PER_DEG)
}

/** Encodes a FIT activity file. Message numbers: 0 file_id, 18 session, 19 lap, 20 record. */
export function buildFit(options: BuildFitOptions): Uint8Array {
  const first = options.sessions[0]
  if (!first) throw new RangeError('buildFit needs at least one session')
  const enc = new FitEncoder()
  const created = options.timeCreatedUnix ?? first.startUnix
  if (!options.omitFileId) {
    enc.writeMessage(
      0,
      [
        e8(0, 4),
        u16(1, 1),
        u16(2, 1234),
        u32z(3, options.serial ?? 3_000_000_001),
        u32(4, fitTime(created)),
      ],
      0,
    )
  }
  if (options.productName) {
    enc.writeMessage(
      23,
      [
        u32(253, fitTime(first.startUnix)),
        u16(2, 1),
        u16(4, 1234),
        {
          number: 27,
          size: options.productName.length + 1,
          baseType: FitBaseType.String,
          value: FitEncoder.string(options.productName),
        },
      ],
      1,
    )
  }
  let lastEnd = first.startUnix
  for (const s of options.sessions) {
    for (const r of s.records) {
      const f: FitEncoderField[] = [u32(253, fitTime(s.startUnix + r.t))]
      if (r.lat !== undefined && r.lng !== undefined) {
        f.push(s32(0, semicircles(r.lat)), s32(1, semicircles(r.lng)))
      }
      if (r.altitudeM !== undefined) f.push(u16(2, (r.altitudeM + 500) * 5))
      if (r.hr !== undefined) f.push(u8(3, r.hr))
      if (r.cadence !== undefined) f.push(u8(4, r.cadence))
      if (r.distanceM !== undefined) f.push(u32(5, r.distanceM * 100))
      if (r.speedMps !== undefined) f.push(u16(6, r.speedMps * 1000))
      if (r.powerW !== undefined) f.push(u16(7, r.powerW))
      // The encoder re-emits a definition only when the field shape changes.
      enc.writeMessage(20, f, 2)
    }
    for (const l of s.laps ?? []) {
      const f: FitEncoderField[] = [
        u32(253, fitTime(s.startUnix + l.startSec + l.durationSec)),
        u32(2, fitTime(s.startUnix + l.startSec)),
        u32(7, l.durationSec * 1000),
        u32(8, l.durationSec * 1000),
      ]
      if (l.distanceM !== undefined) f.push(u32(9, l.distanceM * 100))
      if (l.avgHr !== undefined) f.push(u8(15, l.avgHr))
      if (l.maxHr !== undefined) f.push(u8(16, l.maxHr))
      if (l.avgCadence !== undefined) f.push(u8(17, l.avgCadence))
      enc.writeMessage(19, f, 3)
    }
    const f: FitEncoderField[] = [
      u32(253, fitTime(s.startUnix + s.durationSec)),
      u32(2, fitTime(s.startUnix)),
      u32(7, s.durationSec * 1000),
      u32(8, (s.timerSec ?? s.durationSec) * 1000),
      e8(5, s.sport),
      e8(6, s.subSport ?? 0),
    ]
    if (s.lat !== undefined && s.lng !== undefined) {
      f.push(s32(3, semicircles(s.lat)), s32(4, semicircles(s.lng)))
    }
    if (s.distanceM !== undefined) f.push(u32(9, s.distanceM * 100))
    if (s.movingSec !== undefined) f.push(u32(59, s.movingSec * 1000))
    if (s.avgHr !== undefined) f.push(u8(16, s.avgHr))
    if (s.maxHr !== undefined) f.push(u8(17, s.maxHr))
    if (s.avgCadence !== undefined) f.push(u8(18, s.avgCadence))
    if (s.avgPowerW !== undefined) f.push(u16(20, s.avgPowerW))
    if (s.ascentM !== undefined) f.push(u16(22, s.ascentM))
    if (s.descentM !== undefined) f.push(u16(23, s.descentM))
    enc.writeMessage(18, f, 4)
    lastEnd = s.startUnix + s.durationSec
  }
  const offsetSec = (options.utcOffsetMin ?? 0) * 60
  enc.writeMessage(
    34,
    [
      u32(253, fitTime(lastEnd)),
      u32(5, fitTime(lastEnd + offsetSec)),
      u16(1, options.sessions.length),
      e8(2, 0),
      e8(3, 26),
      e8(4, 1),
    ],
    5,
  )
  return enc.close()
}
