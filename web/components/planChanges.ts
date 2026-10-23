import type { PlanChange } from '../../shared/engine/types.ts'
import { zoneChangeOf } from '../../shared/engine/zoneChange.ts'
import type { PlanPhase, Units } from '../../shared/types.ts'
import { formatShortDate, isSessionKind, phaseLabel, sessionKindLabel } from './format.ts'
import { PROPOSAL_LABELS, proposalValueText } from './zoneFormat.ts'

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

const isoDay = /^\d{4}-\d{2}-\d{2}$/
/** A date as "19 Oct"; anything that is not a date as plain text. */
const day: Format = (value) =>
  typeof value === 'string' && isoDay.test(value) ? safeShortDate(value) : plain(value)
function safeShortDate(iso: string): string {
  try {
    return formatShortDate(iso)
  } catch {
    return iso
  }
}
/** A session kind as the Plan page names it; anything else as plain text. */
const kind: Format = (value) => (isSessionKind(value) ? sessionKindLabel(value) : plain(value))

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
  // Owner edits of single sessions (`PUT /api/plan/sessions/:id`).
  'session.status': { label: 'Session status', format: plain },
  'session.date': { label: 'Session date', format: day },
  'session.kind': { label: 'Session type', format: kind },
}

/**
 * A zone change (`zones.<boundary>`, an accepted proposal; `zones.<boundary>.declined`, a declined
 * one), in the runner's unit.
 */
function zoneField(field: string, units: Units): { label: string; format: Format } | null {
  const zone = zoneChangeOf(field)
  if (zone === null) return null
  const { boundary, outcome } = zone
  return {
    label:
      outcome === 'accepted'
        ? PROPOSAL_LABELS[boundary]
        : `Declined proposal for ${PROPOSAL_LABELS[boundary].toLowerCase()}`,
    format: (value) =>
      typeof value === 'number' ? proposalValueText(boundary, value, units) : plain(value),
  }
}

/**
 * One plan change as words: the legacy renderer for a revision whose `diff` is null (written before
 * the revision model, and the zone decisions, which change no plan row). Every revision with a diff
 * is worded by `shared/copy/revisionView.ts` through `RevisionDiff`; no other formatter of plan
 * changes exists. A whole week that appears or goes
 * (field `week`, the values being its phase) reads as added or removed; session and zone changes
 * (`session.*`, `zones.*`) are named too, zone values in `units`; a field the helper does not know
 * keeps its name and a plain value.
 */
export function describeChange(change: PlanChange, units: Units = 'km'): ChangeText {
  if (change.field === 'week') {
    const added = change.from === null || change.from === undefined
    const name = phase(added ? change.to : change.from)
    const text = `Week ${added ? 'added' : 'removed'}${name === NONE ? '' : ` (${name})`}`
    return { label: 'Week', from: phase(change.from), to: phase(change.to), text }
  }
  const known = FIELDS[change.field] ?? zoneField(change.field, units)
  const label = known?.label ?? change.field
  const format = known?.format ?? plain
  const from = format(change.from)
  const to = format(change.to)
  return { label, from, to, text: `${label} ${from} to ${to}` }
}
