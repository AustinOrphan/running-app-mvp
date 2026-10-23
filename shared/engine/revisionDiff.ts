// Reading a revision's diff for people (phase 3a design 8.5 and 8.6). Two pure pieces:
//
// - `attributeChange` gives one line of a diff its causes, and `causesOf` does it for every line of
//   a revision. The causes are derived from what the stored revision already holds (its reason,
//   its weekly decision, the rules and flags on its lines, its rest-window holds) and from the
//   weeks whose target the runner set; none is stored, and none pairs lines or looks at undo.
// - `presentDiff` orders a diff for display and folds a removed session and an added one that are
//   the same session on another day into one "moved" entry, and a removed and an added session on
//   one day into one "replaced" entry. Pairing sessions is the identity rule of
//   `shared/domain/sessionIdentity.ts` (a change of day or kind is a removal plus an addition);
//   this is the presentation of that pair, and nothing reads it back.
//
// Pure: no I/O, no clock, no randomness.
import { addDays, mondayOf } from '../dates.ts'
import type {
  CauseCode,
  PlanDiff,
  PlanRevisionReason,
  RevisionCauses,
  SessionDiffLine,
  WeekDiffLine,
} from '../types.ts'
import type { WeeklyDecision } from './types.ts'

/** Every cause, most specific first: the order a line's causes are listed in. */
export const CAUSE_ORDER: readonly CauseCode[] = [
  'owner-edit',
  'disruption',
  'break-restart',
  'post-race',
  'trim',
  'decision-hold',
  'decision-reduce',
  'owner-target-kept',
  'phase-calendar',
  'ramp',
  'state-update',
]

/** Week flags the calendar sets (the race date and the recovery cycle), not the runner's data. */
const CALENDAR_FLAGS: ReadonlySet<string> = new Set([
  'recovery',
  'peak',
  'taper',
  'race-week',
  'strength-block',
  'heat-acclimation',
  'gut-training',
  'night',
  'downhill',
  'b2b',
])
const POST_RACE_FLAGS: ReadonlySet<string> = new Set(['post-race', 'post-race-restart'])
const DISRUPTION_FLAGS: ReadonlySet<string> = new Set([
  'disrupted',
  'disruption-return',
  'rest-window',
])
const RESTART_FLAGS: ReadonlySet<string> = new Set(['restart-floor'])

/** The rule that marks a session the engine trimmed (`TRIM_RULE` in `server/serialize.ts`). */
const TRIM_RULE = 'design-4.3'

/** What the stored revision says about itself. */
export interface RevisionFacts {
  reason: PlanRevisionReason
  /** The weekly decision the revision acted on, or null. */
  decision: Pick<WeeklyDecision, 'decision' | 'postRace'> | null
  /**
   * The local day the revision was written on. The decision of the week that had just finished
   * caps the week this day falls in, so that week's lines are the decision's.
   */
  writtenOn: string
  /** The rest window the revision created, changed or removed. */
  disruptionId: string | null
  /** The `field` of each week-level change the revision stored; `session.*` marks an edit of one session. */
  changeFields?: readonly string[]
  /**
   * Mondays of the weeks whose working target the runner set (a week override or a review's
   * number), which a re-plan keeps. Omitted when the caller cannot know them.
   */
  ownerWeeks?: ReadonlySet<string>
}

/** What `attributeChange` reads besides the line: one revision's facts and its week lines. */
export interface AttributionContext {
  reason: PlanRevisionReason
  decision: RevisionFacts['decision']
  /** Monday of the week the decision caps. */
  cappedWeek: string
  disruptionId: string | null
  /** The runner made the change: an edit of one session, or an undo. */
  byRunner: boolean
  holds: PlanDiff['holds']
  ownerWeeks: ReadonlySet<string>
  /** The diff's week lines by Monday, so a session reads the story of its week. */
  weeks: ReadonlyMap<string, WeekDiffLine>
}

/** The context for the lines of `diff`, from the revision that holds it. */
export function attributionContext(diff: PlanDiff, facts: RevisionFacts): AttributionContext {
  return {
    reason: facts.reason,
    decision: facts.decision,
    cappedWeek: mondayOf(facts.writtenOn),
    disruptionId: facts.disruptionId,
    // A re-plan the runner asked for (reason 'owner' with no session edit among its changes) is
    // the engine's own work and is attributed like the weekly one.
    byRunner:
      facts.reason === 'undo' ||
      (facts.reason === 'owner' &&
        (facts.changeFields ?? []).some((field) => field.startsWith('session.'))),
    holds: diff.holds,
    ownerWeeks: facts.ownerWeeks ?? new Set(),
    weeks: new Map(diff.weeks.map((week) => [week.weekStart, week])),
  }
}

function isSessionLine(change: SessionDiffLine | WeekDiffLine): change is SessionDiffLine {
  return 'externalId' in change
}

/** True when a rest-window hold covers any of the days. */
function held(holds: PlanDiff['holds'], days: readonly string[]): boolean {
  return holds.some((hold) => days.some((day) => hold.from <= day && day <= hold.to))
}

/**
 * The causes of one line of a diff, most specific first, never empty. A change the runner made
 * themselves (an edit of one session, an undo) has that one cause. Otherwise a specific cause (a rest
 * window, a restart, the weeks after a race, a trim, the weekly decision, the runner's own target)
 * hides the generic ones; with none of them the line is the calendar's (a flag such as recovery
 * or taper moved), the weekly build's (the week's running time moved) or, failing both, the plan
 * reading new figures.
 */
export function attributeChange(
  change: SessionDiffLine | WeekDiffLine,
  ctx: AttributionContext,
): CauseCode[] {
  if (ctx.byRunner) return ['owner-edit']
  const session = isSessionLine(change) ? change : null
  const weekStart = change.weekStart
  const week = session === null ? (change as WeekDiffLine) : ctx.weeks.get(weekStart)
  const rules = new Set((session?.rules ?? []).map((rule) => rule.toLowerCase()))
  const flags = week === undefined ? [] : [...week.flagsAdded, ...week.flagsRemoved]
  const days =
    session === null
      ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
      : [session.date, session.before?.date, session.after?.date].filter(
          (day): day is string => day !== undefined,
        )
  const inDecisionWeek = weekStart === ctx.cappedWeek
  const postRaceDecision = ctx.decision?.postRace !== undefined

  const found = new Set<CauseCode>()
  if (
    ctx.reason === 'disruption' ||
    ctx.disruptionId !== null ||
    rules.has('j9') ||
    flags.some((flag) => DISRUPTION_FLAGS.has(flag)) ||
    held(ctx.holds, days)
  ) {
    found.add('disruption')
  }
  if (ctx.reason === 'break' || rules.has('j7') || flags.some((flag) => RESTART_FLAGS.has(flag))) {
    found.add('break-restart')
  }
  if (
    rules.has('h12') ||
    flags.some((flag) => POST_RACE_FLAGS.has(flag)) ||
    (postRaceDecision && inDecisionWeek)
  ) {
    found.add('post-race')
  }
  if (rules.has(TRIM_RULE)) found.add('trim')
  // The decision of a week inside the post-race window reads "hold" for callers that look only at
  // that word; it is the window's, not a hold of the runner's week.
  if (inDecisionWeek && !postRaceDecision) {
    if (ctx.decision?.decision === 'hold') found.add('decision-hold')
    if (ctx.decision?.decision === 'reduce') found.add('decision-reduce')
  }
  if (ctx.ownerWeeks.has(weekStart)) found.add('owner-target-kept')

  if (found.size === 0) {
    if (flags.some((flag) => CALENDAR_FLAGS.has(flag))) found.add('phase-calendar')
    if (week !== undefined && week.runMinBefore !== week.runMinAfter) found.add('ramp')
    if (found.size === 0) found.add('state-update')
  }
  return CAUSE_ORDER.filter((cause) => found.has(cause))
}

/**
 * The causes of every line of a revision's diff. A session is keyed by its `externalId` and a week
 * by its Monday; a line without an `externalId` (a session only previewed) has no key and no entry.
 */
export function causesOf(diff: PlanDiff, facts: RevisionFacts): RevisionCauses {
  const ctx = attributionContext(diff, facts)
  const causes: RevisionCauses = { sessions: {}, weeks: {} }
  for (const line of diff.sessions) {
    if (line.externalId !== '') causes.sessions[line.externalId] = attributeChange(line, ctx)
  }
  for (const line of diff.weeks) causes.weeks[line.weekStart] = attributeChange(line, ctx)
  return causes
}

// ---------------------------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------------------------

type Hold = PlanDiff['holds'][number]

/**
 * One row of a displayed diff. `added`, `removed` and `changed` show a single session line;
 * `moved` is the same session on another day, `replaced` is one session taken out and another put
 * in its day, each folded from a removed line and an added line.
 */
export type DiffEntry =
  | { type: 'week'; key: string; date: string; week: WeekDiffLine }
  | { type: 'hold'; key: string; date: string; hold: Hold }
  | { type: 'added' | 'removed' | 'changed'; key: string; date: string; line: SessionDiffLine }
  | {
      type: 'moved' | 'replaced'
      key: string
      date: string
      from: SessionDiffLine
      to: SessionDiffLine
    }

/** The same session by what the runner reads: kind, title and length. */
function sameSession(a: SessionDiffLine, b: SessionDiffLine): boolean {
  const before = a.before
  const after = b.after
  return (
    before !== null &&
    after !== null &&
    before.kind === after.kind &&
    before.title === after.title &&
    before.durationMin === after.durationMin
  )
}

const RANK = { week: 0, hold: 1 } as const
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The rows of a diff in the order a reader follows: by day, each week's line before its days. A
 * removed session and an added one fold into a `moved` entry when they are the same session
 * (kind, title and length) on different days, and into a `replaced` entry when they share a day;
 * what is left stays a plain `added` or `removed`. Each entry has a key unique within the diff.
 */
export function presentDiff(diff: PlanDiff): DiffEntry[] {
  const keyed = diff.sessions.map((line, index) => ({
    line,
    key: `session:${line.externalId === '' ? `new-${String(index)}` : line.externalId}`,
  }))
  const entries: DiffEntry[] = []
  for (const week of diff.weeks) {
    entries.push({ type: 'week', key: `week:${week.weekStart}`, date: week.weekStart, week })
  }
  diff.holds.forEach((hold, index) => {
    entries.push({ type: 'hold', key: `hold:${String(index)}`, date: hold.from, hold })
  })

  const removed = keyed.filter(({ line }) => line.change === 'removed')
  const added = keyed.filter(({ line }) => line.change === 'added')
  const open = [...added]
  const unpaired: typeof removed = []
  const take = (match: (candidate: SessionDiffLine) => boolean) => {
    const at = open.findIndex(({ line }) => match(line))
    return at < 0 ? null : open.splice(at, 1)[0]!
  }
  // The same session on another day first, so that a swap of two days reads as two moves.
  const rest: typeof removed = []
  for (const out of removed) {
    const into = take((line) => line.date !== out.line.date && sameSession(out.line, line))
    if (into === null) rest.push(out)
    else {
      entries.push({
        type: 'moved',
        key: `${out.key}>${into.key}`,
        date: into.line.date,
        from: out.line,
        to: into.line,
      })
    }
  }
  for (const out of rest) {
    const into = take((line) => line.date === out.line.date)
    if (into === null) unpaired.push(out)
    else {
      entries.push({
        type: 'replaced',
        key: `${out.key}>${into.key}`,
        date: into.line.date,
        from: out.line,
        to: into.line,
      })
    }
  }
  for (const { line, key } of unpaired)
    entries.push({ type: 'removed', key, date: line.date, line })
  for (const { line, key } of open) entries.push({ type: 'added', key, date: line.date, line })
  for (const { line, key } of keyed) {
    if (line.change === 'changed') entries.push({ type: 'changed', key, date: line.date, line })
  }

  return entries.sort(
    (a, b) =>
      compareText(a.date, b.date) ||
      (RANK[a.type as keyof typeof RANK] ?? 2) - (RANK[b.type as keyof typeof RANK] ?? 2) ||
      compareText(a.key, b.key),
  )
}

/** The causes of an entry: those of every line it folds, most specific first, each once. */
export function entryCauses(entry: DiffEntry, causes: RevisionCauses | null): CauseCode[] {
  if (causes === null) return []
  let found: CauseCode[] = []
  switch (entry.type) {
    case 'week':
      found = causes.weeks[entry.week.weekStart] ?? []
      break
    case 'hold':
      return []
    case 'added':
    case 'removed':
    case 'changed':
      found = causes.sessions[entry.line.externalId] ?? []
      break
    case 'moved':
    case 'replaced':
      found = [
        ...(causes.sessions[entry.from.externalId] ?? []),
        ...(causes.sessions[entry.to.externalId] ?? []),
      ]
      break
  }
  return CAUSE_ORDER.filter((cause) => found.includes(cause))
}
