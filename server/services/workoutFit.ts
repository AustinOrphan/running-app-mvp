// A `WorkoutPlan` as a FIT workout file (phase 3a design 6.5, rule O1): the fallback that needs no
// third party. The runner copies the file to the watch by USB or imports it in the Garmin
// Connect app, so it works while intervals.icu or the Garmin upload is down. The messages are the
// workout files of the FIT SDK: `file_id` (type 5), `workout` (message 26) and one `workout_step`
// (message 27) per step, repeats included. Field numbers are those of the SDK profile that
// `fit-file-parser` carries; the round-trip test decodes every file with that profile.
//
// The units are the SDK's: time in milliseconds, speed in mm/s (the low edge is the slow pace),
// heart rate as bpm + 100 (a value of 100 or less would read as a percentage of the maximum), and
// a repeat is a step that names the first step of the block and a count. Targets arrive from
// `toWorkoutPlan`, which got them from `resolveTargets`; nothing here derives a figure. Pure and
// deterministic: the same plan, time and serial give the same bytes. It lives under `server/`
// because `fit-file-parser` must not reach the web build.
import { FitBaseType, FitEncoder } from 'fit-file-parser'
import type { FitEncoderField } from 'fit-file-parser'
import { shortTitle } from '../../shared/workouts/labels.ts'
import { easedLine, effortPhrase, isEffortStep } from '../../shared/workouts/plan.ts'
import type {
  StepIntent,
  StepTarget,
  WorkoutPlan,
  WorkoutStep,
} from '../../shared/workouts/types.ts'

/** The longest name, in bytes: the SDK's string fields are 16 bytes with the terminator. */
export const FIT_NAME_MAX_BYTES = 15
/** The longest step note, in bytes: 50 with the terminator. */
export const FIT_NOTES_MAX_BYTES = 49

// Global message numbers.
const MESG_FILE_ID = 0
const MESG_WORKOUT = 26
const MESG_WORKOUT_STEP = 27

// Local message numbers; the encoder writes a new definition whenever a message's shape changes.
const LOCAL_FILE_ID = 0
const LOCAL_WORKOUT = 1
const LOCAL_WORKOUT_STEP = 2

// Enumerations of the SDK profile.
const FILE_TYPE_WORKOUT = 5
/** The manufacturer id for files that no device maker wrote. Unverified on a watch (design 6.10). */
const MANUFACTURER_DEVELOPMENT = 255
const SPORT_RUNNING = 1
const DURATION_TIME = 0
const DURATION_REPEAT_UNTIL_STEPS_COMPLETE = 6
const TARGET_SPEED = 0
const TARGET_HEART_RATE = 1
const TARGET_OPEN = 2
const INTENSITY: Readonly<Record<StepIntent, number>> = {
  steady: 0, // active
  warmup: 2,
  cooldown: 3,
  recover: 4, // recovery
  work: 5, // interval
}

/**
 * The protocol version byte of the header: the major version in the high nibble, so 2.0 is 0x20.
 * The encoder's own default (2) reads as version 0.2, which a strict reader rejects.
 */
const PROTOCOL_VERSION_2_0 = 0x20

/** Heart rates above this are written as bpm + 100; the SDK reads lower values as a percentage. */
const HR_OFFSET_BPM = 100
const MM_PER_KM = 1_000_000

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

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
  value,
})
const u32 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 4,
  baseType: FitBaseType.Uint32,
  value,
})
const u32z = (number: number, value: number): FitEncoderField => ({
  number,
  size: 4,
  baseType: FitBaseType.Uint32z,
  value,
})

const encoder = new TextEncoder()
const byteLength = (text: string): number => encoder.encode(text).length

/** The text in Unicode normal form, on one line, without control characters. */
function fold(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The longest start of `text` that fits `maxBytes` of UTF-8 without splitting a character. */
function takeBytes(text: string, maxBytes: number): string {
  let out = ''
  let used = 0
  for (const character of text) {
    const size = byteLength(character)
    if (used + size > maxBytes) break
    out += character
    used += size
  }
  return out
}

/**
 * Text that fits `maxBytes`. A longer text loses its length first ("Easy run, 45 min" becomes
 * "Easy run"), then its last words, and is never cut inside a word or a character.
 */
function shorten(text: string, maxBytes: number): string {
  const folded = fold(text)
  if (byteLength(folded) <= maxBytes) return folded
  const comma = folded.indexOf(',')
  if (comma > 0 && byteLength(folded.slice(0, comma)) <= maxBytes) return folded.slice(0, comma)
  let cut = takeBytes(folded, maxBytes)
  if (folded.charAt(cut.length) !== ' ' && cut.includes(' ')) {
    cut = cut.slice(0, cut.lastIndexOf(' '))
  }
  return cut.replace(/[\s,;:]+$/, '')
}

/**
 * A string field. The encoder checks that the bytes it is given are exactly as many as the field
 * says, and a string field ends in a terminator, so the size is the folded text's byte length
 * (not its character count: "é" is two bytes) plus one. The text is shortened to `maxBytes` first.
 */
export function fitText(number: number, text: string, maxBytes: number): FitEncoderField {
  const value = FitEncoder.string(shorten(text, maxBytes))
  return { number, size: value.length, baseType: FitBaseType.String, value }
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

type FlatStep =
  | { type: 'step'; step: WorkoutStep }
  /** Repeats the steps from `fromIndex` (a `message_index`) up to this one, `count` times in all. */
  | { type: 'repeat'; fromIndex: number; count: number }

/** The steps in file order: a repeat's steps, then the step that repeats them. */
function flatten(plan: WorkoutPlan): FlatStep[] {
  const out: FlatStep[] = []
  for (const node of plan.nodes) {
    if (node.type === 'step') {
      out.push({ type: 'step', step: node })
      continue
    }
    const fromIndex = out.length
    for (const step of node.steps) out.push({ type: 'step', step })
    out.push({ type: 'repeat', fromIndex, count: node.count })
  }
  return out
}

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/**
 * What the step says beside its target, in whole sentences that fit: that the day was eased, that
 * the step is run by effort, and the fuel line. A part that does not fit is left out, never cut.
 */
function noteOf(plan: WorkoutPlan, step: WorkoutStep, first: boolean): string {
  const parts = [
    ...(first && plan.eased ? [easedLine(plan.units)] : []),
    ...(plan.targets.mode === 'effort' && isEffortStep(step)
      ? [capitalised(effortPhrase(plan.units))]
      : []),
    ...(first && plan.fuelLine !== null ? [plan.fuelLine] : []),
  ]
  let text = ''
  for (const part of parts) {
    const next = text === '' ? part : `${text}${text.endsWith('.') ? ' ' : '. '}${part}`
    if (byteLength(next) <= FIT_NOTES_MAX_BYTES) text = next
  }
  return text
}

/** The target fields of a step: type, value (0 for a custom range) and the range's two edges. */
function targetFields(target: StepTarget): FitEncoderField[] {
  switch (target.kind) {
    case 'open':
      return [e8(3, TARGET_OPEN), u32(4, 0)]
    case 'hr-ceiling':
      return [
        e8(3, TARGET_HEART_RATE),
        u32(4, 0),
        u32(5, hrValue(target.floorBpm)),
        u32(6, hrValue(target.ceilingBpm)),
      ]
    case 'hr-band':
      return [
        e8(3, TARGET_HEART_RATE),
        u32(4, 0),
        u32(5, hrValue(target.lowBpm)),
        u32(6, hrValue(target.highBpm)),
      ]
    case 'pace':
      // the slow pace is the low speed
      return [
        e8(3, TARGET_SPEED),
        u32(4, 0),
        u32(5, speedValue(target.slowSecPerKm)),
        u32(6, speedValue(target.fastSecPerKm)),
      ]
  }
}

function hrValue(bpm: number): number {
  const whole = Math.round(bpm)
  if (!Number.isFinite(whole) || whole < 1) {
    throw new RangeError(`A heart rate of ${String(bpm)} bpm`)
  }
  return whole + HR_OFFSET_BPM
}

function speedValue(secPerKm: number): number {
  if (!(secPerKm > 0) || !Number.isFinite(secPerKm)) {
    throw new RangeError(`A pace of ${String(secPerKm)} s/km`)
  }
  return Math.round(MM_PER_KM / secPerKm)
}

function stepFields(plan: WorkoutPlan, step: WorkoutStep, index: number): FitEncoderField[] {
  const note = noteOf(plan, step, index === 0)
  return [
    fitText(0, step.label, FIT_NAME_MAX_BYTES),
    e8(1, DURATION_TIME),
    u32(2, Math.round(step.durationSec * 1000)),
    ...targetFields(step.target),
    e8(7, INTENSITY[step.intent]),
    ...(note === '' ? [] : [fitText(8, note, FIT_NOTES_MAX_BYTES)]),
    u16(254, index),
  ]
}

function repeatFields(index: number, fromIndex: number, count: number): FitEncoderField[] {
  return [
    e8(1, DURATION_REPEAT_UNTIL_STEPS_COMPLETE),
    u32(2, fromIndex),
    // The repeat step has no target of its own; its count is the "target value" of the SDK.
    e8(3, TARGET_OPEN),
    u32(4, count),
    u16(254, index),
  ]
}

// ---------------------------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------------------------

export interface WorkoutFitOptions {
  /** When the file was made: `file_id.time_created`. Callers pass a time, so the bytes are a pure function. */
  createdAt: Date
  /**
   * Identifies the file among others made at the same time (`file_id.serial_number`, 1 to
   * 4294967295). A watch told two files apart by their identity would otherwise take the files of
   * one week for one workout.
   */
  serial?: number
}

/**
 * The FIT workout file of a plan. Time targets only: every step is a length of time, and a target
 * is a heart-rate range, a speed range or open. The sport is running for every publishable kind,
 * a hike included.
 *
 * @throws RangeError for a step without a positive length, a heart rate below 1 bpm or a pace
 *   that is not positive; `toWorkoutPlan` never produces one.
 */
export function encodeWorkoutFit(plan: WorkoutPlan, options: WorkoutFitOptions): Uint8Array {
  const steps = flatten(plan)
  const fit = new FitEncoder({ protocolVersion: PROTOCOL_VERSION_2_0 })

  fit.writeMessage(
    MESG_FILE_ID,
    [
      e8(0, FILE_TYPE_WORKOUT),
      u16(1, MANUFACTURER_DEVELOPMENT),
      u16(2, 0),
      ...(options.serial === undefined ? [] : [u32z(3, options.serial)]),
      u32(4, FitEncoder.toFitTimestamp(options.createdAt)),
    ],
    LOCAL_FILE_ID,
  )
  fit.writeMessage(
    MESG_WORKOUT,
    [
      e8(4, SPORT_RUNNING),
      u16(6, steps.length),
      fitText(8, shortTitle(plan.kind, plan.title), FIT_NAME_MAX_BYTES),
    ],
    LOCAL_WORKOUT,
  )
  steps.forEach((flat, index) => {
    if (flat.type === 'repeat') {
      fit.writeMessage(
        MESG_WORKOUT_STEP,
        repeatFields(index, flat.fromIndex, flat.count),
        LOCAL_WORKOUT_STEP,
      )
      return
    }
    if (!(flat.step.durationSec > 0)) {
      throw new RangeError(`A step of ${String(flat.step.durationSec)} s`)
    }
    fit.writeMessage(MESG_WORKOUT_STEP, stepFields(plan, flat.step, index), LOCAL_WORKOUT_STEP)
  })
  return fit.close()
}
