// Reads a FIT workout file with the project's FIT parser (`fit-file-parser`, the profile that
// `shared/importers/files/fit.ts` reads activities with), so a test that writes a file with
// `encodeWorkoutFit` finds out what the SDK profile makes of it: a wrong field number shows up as a
// missing or misnamed field. Written independently of the writer: the unit conventions below
// (milliseconds, mm/s, bpm + 100) are the SDK's, restated here from the profile.
import FitParser from 'fit-file-parser'
import type { ParsedFit } from 'fit-file-parser'

/** What a step asks, decoded from the SDK's fields. */
export type ReadTarget =
  | { type: 'open' }
  | { type: 'heart_rate'; lowBpm: number; highBpm: number }
  /** Speeds are mm/s as written; the low edge is the slow one. */
  | { type: 'speed'; lowMmPerSec: number; highMmPerSec: number }

export type ReadStep =
  | {
      type: 'time'
      index: number
      name: string | null
      durationMs: number
      target: ReadTarget
      intensity: string | null
      notes: string | null
    }
  | {
      type: 'repeat'
      index: number
      /** `message_index` of the first step of the block. */
      fromIndex: number
      count: number
    }

export interface ReadWorkout {
  file: {
    type: string
    manufacturer: string
    product: number | null
    serial: number | null
    timeCreated: Date
  }
  workout: { sport: string; name: string | null; numValidSteps: number }
  /** In file order; a repeat follows the steps it repeats. */
  steps: ReadStep[]
  /** The number of `workout`, `workout_step` and `file_id` messages. */
  counts: { fileIds: number; workouts: number; steps: number }
}

/** A step with its repeats written out, as the watch runs it. */
export interface ExpandedStep {
  name: string | null
  durationSec: number
  target: ReadTarget
  intensity: string | null
  notes: string | null
}

type Message = Record<string, unknown>

/** The SDK writes a heart rate above 100 as bpm + 100; a lower value is a percentage of maximum. */
const HR_OFFSET = 100

function str(message: Message, key: string): string | null {
  const value = message[key]
  return typeof value === 'string' ? value : null
}

function num(message: Message, key: string): number | null {
  const value = message[key]
  return typeof value === 'number' ? value : null
}

function required(message: Message, key: string): number {
  const value = num(message, key)
  if (value === null) throw new Error(`The workout step has no ${key}`)
  return value
}

function indexOf(message: Message): number {
  const raw = message['message_index']
  const value = typeof raw === 'object' && raw !== null ? (raw as { value?: unknown }).value : raw
  if (typeof value !== 'number') throw new Error('A workout step has no message_index')
  return value
}

function targetOf(message: Message): ReadTarget {
  const type = str(message, 'target_type')
  if (type === 'open') return { type: 'open' }
  const low = required(message, 'custom_target_value_low')
  const high = required(message, 'custom_target_value_high')
  if (type === 'heart_rate') {
    if (low <= HR_OFFSET || high <= HR_OFFSET) {
      throw new Error(`A heart-rate target of ${String(low)} to ${String(high)} is a percentage`)
    }
    return { type: 'heart_rate', lowBpm: low - HR_OFFSET, highBpm: high - HR_OFFSET }
  }
  if (type === 'speed') return { type: 'speed', lowMmPerSec: low, highMmPerSec: high }
  throw new Error(`Unexpected target type ${String(type)}`)
}

function stepOf(message: Message): ReadStep {
  const index = indexOf(message)
  const duration = str(message, 'duration_type')
  if (duration === 'repeat_until_steps_cmplt') {
    return {
      type: 'repeat',
      index,
      fromIndex: required(message, 'duration_value'),
      count: required(message, 'target_value'),
    }
  }
  if (duration !== 'time') throw new Error(`Unexpected duration type ${String(duration)}`)
  return {
    type: 'time',
    index,
    name: str(message, 'wkt_step_name'),
    durationMs: required(message, 'duration_value'),
    target: targetOf(message),
    intensity: str(message, 'intensity'),
    notes: str(message, 'notes'),
  }
}

/**
 * Decodes a FIT workout file. Throws when the parser rejects it (a bad header or CRC) or when a
 * message is not one the writer produces.
 */
export function readWorkout(bytes: Uint8Array): ReadWorkout {
  const out: { error?: unknown; data?: ParsedFit; finished: boolean } = { finished: false }
  // A copy, because the parser reads the whole buffer it is given. The callback runs before
  // `parse` returns: the parser has no asynchronous step.
  new FitParser({ force: false, mode: 'list' }).parse(
    new Uint8Array(bytes).buffer,
    (error, data) => {
      out.finished = true
      out.error = error
      out.data = data
    },
  )
  if (!out.finished || out.error || !out.data) {
    throw new Error(`The parser rejected the file: ${String(out.error)}`)
  }
  const messages = (out.data.messages ?? {}) as Record<string, Message[] | undefined>
  const fileIds = messages['file_id'] ?? []
  const workouts = messages['workout'] ?? []
  const stepMessages = messages['workout_step'] ?? []
  const fileId = fileIds[0]
  const workout = workouts[0]
  if (!fileId || !workout) throw new Error('The file has no file_id or no workout message')
  const created = fileId['time_created']
  if (!(created instanceof Date)) throw new Error('file_id has no time_created')
  return {
    file: {
      type: str(fileId, 'type') ?? '',
      manufacturer: str(fileId, 'manufacturer') ?? '',
      product: num(fileId, 'product'),
      serial: num(fileId, 'serial_number'),
      timeCreated: created,
    },
    workout: {
      sport: str(workout, 'sport') ?? '',
      name: str(workout, 'wkt_name'),
      numValidSteps: required(workout, 'num_valid_steps'),
    },
    steps: stepMessages.map(stepOf),
    counts: { fileIds: fileIds.length, workouts: workouts.length, steps: stepMessages.length },
  }
}

/**
 * The steps as the watch runs them: every repeat unrolled, `count` rounds of the steps from its
 * first step up to the repeat itself. Throws for a repeat that points forward or at itself.
 */
export function expandWorkout(read: ReadWorkout): ExpandedStep[] {
  const out: ExpandedStep[] = []
  // Positions in `out` where each file step began, so a repeat can copy what it covers.
  const startOf = new Map<number, number>()
  for (const step of read.steps) {
    startOf.set(step.index, out.length)
    if (step.type === 'time') {
      out.push({
        name: step.name,
        durationSec: step.durationMs / 1000,
        target: step.target,
        intensity: step.intensity,
        notes: step.notes,
      })
      continue
    }
    const start = startOf.get(step.fromIndex)
    if (start === undefined || step.fromIndex >= step.index) {
      throw new Error(`A repeat at ${String(step.index)} points at ${String(step.fromIndex)}`)
    }
    const block = out.slice(start)
    for (let round = 1; round < step.count; round += 1) out.push(...block)
  }
  return out
}
