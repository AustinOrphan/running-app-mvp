import type { PlanChange } from '../../shared/engine/types.ts'
import type { PlanPhase } from '../../shared/types.ts'
import { phaseLabel } from './format.ts'

/** A plan change in words: the label of the field and its two values with units. */
export interface ChangeText {
  label: string
  from: string
  to: string
  /** "Weekly running time 320 min to 280 min" */
  text: string
}

type Format = (value: unknown) => string

const NONE = 'none'

const plain: Format = (value) => {
  if (value === null || value === undefined) return NONE
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}
const withUnit =
  (unit: string): Format =>
  (value) =>
    value === null || value === undefined ? NONE : `${plain(value)} ${unit}`
const word: Format = (value) => {
  const text = plain(value)
  return text === NONE ? text : text.charAt(0).toUpperCase() + text.slice(1)
}
const PHASES: readonly string[] = [
  'restart',
  'base1',
  'base2',
  'endurance',
  'specific',
  'peak',
  'taper',
  'race',
  'base',
  'build',
] satisfies PlanPhase[]
/** A phase as the Plan page names it ("Race week", "Base 1"); anything else as a capitalised word. */
const phase: Format = (value) =>
  typeof value === 'string' && PHASES.includes(value) ? phaseLabel(value as PlanPhase) : word(value)
const yesNo: Format = (value) => {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return plain(value)
}

/** Engine fields (see `replan` in `shared/engine/index.ts`) with the label and unit they show. */
const FIELDS: Record<string, { label: string; format: Format }> = {
  targetRunMin: { label: 'Weekly running time', format: withUnit('min') },
  longRunMin: { label: 'Long run', format: withUnit('min') },
  runDays: { label: 'Run days', format: plain },
  phase: { label: 'Phase', format: phase },
  isRecovery: { label: 'Recovery week', format: yesNo },
  strengthSessions: { label: 'Strength sessions', format: plain },
  qualitySessions: { label: 'Quality sessions', format: plain },
  gainTargetM: { label: 'Gain target', format: withUnit('m') },
  plannedMin: { label: 'Planned minutes', format: withUnit('min') },
}

/**
 * One plan change as words, for the Plan and Review pages. A whole week that appears or goes
 * (field `week`, the values being its phase) reads as added or removed; a field the helper does
 * not know keeps its name and a plain value.
 */
export function describeChange(change: PlanChange): ChangeText {
  if (change.field === 'week') {
    const added = change.from === null || change.from === undefined
    const name = phase(added ? change.to : change.from)
    const text = `Week ${added ? 'added' : 'removed'}${name === NONE ? '' : ` (${name})`}`
    return { label: 'Week', from: phase(change.from), to: phase(change.to), text }
  }
  const known = FIELDS[change.field]
  const label = known?.label ?? change.field
  const format = known?.format ?? plain
  const from = format(change.from)
  const to = format(change.to)
  return { label, from, to, text: `${label} ${from} to ${to}` }
}
