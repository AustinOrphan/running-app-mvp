// The words a revision is shown in (phase 3a design 8.6): its reason, the lines of its diff, the
// cause of each, the undo confirm and the muted line that says why an undo is not offered. Plan
// page, Today's change sheet, the review page and the weekly brief render a revision through these,
// so a sentence is worded once.
//
// `revision.ts` words what is stored with a revision (its summary, written before anyone knows the
// runner's units, so no distance or climb in a slot). Everything here is worded when the revision
// is shown, in the runner's units, from the figures of the stored diff.
//
// Ids are `<area>.<name>`; every template is spread into `TEMPLATES`, so the copy-lint test renders
// each one in both unit systems.
import { addDays, mondayOf } from '../dates.ts'
import { plannedMinOf } from '../engine/limits.ts'
import type { DiffEntry } from '../engine/revisionDiff.ts'
import type { SessionBrief } from '../engine/types.ts'
import type {
  CauseCode,
  PlanRevisionReason,
  SessionDiffLine,
  UndoReason,
  UndoReasonCode,
  Units,
  WeekDiffLine,
} from '../types.ts'
import { REVISION_TEMPLATES } from './revision.ts'
import { render, tpl, type Template } from './template.ts'

export const REVISION_VIEW_TEMPLATES = {
  // What made the revision.
  'revision-view.reason.generate': tpl('Plan generated', {}, { shape: 'label' }),
  'revision-view.reason.weekly': tpl('Weekly update', {}, { shape: 'label' }),
  'revision-view.reason.review': tpl('After a review', {}, { shape: 'label' }),
  'revision-view.reason.owner': tpl('Your edit', {}, { shape: 'label' }),
  'revision-view.reason.break': tpl('Restart after a break', {}, { shape: 'label' }),
  'revision-view.reason.disruption': tpl('Rest window', {}, { shape: 'label' }),
  'revision-view.reason.undo': tpl('Undo', {}, { shape: 'label' }),
  'revision-view.reason.goal-switch': tpl('New plan for another goal', {}, { shape: 'label' }),
  'revision-view.reason.method-change': tpl('Plan shape changed', {}, { shape: 'label' }),
  /** For a reason a newer server may add. */
  'revision-view.reason.other': tpl('Plan update', {}, { shape: 'label' }),
  /** The one marker of a revision the runner has not opened yet. */
  'revision-view.new': tpl('New', {}, { shape: 'label' }),

  // A session as it reads in a line: its title and length, then the distance and the climb when
  // the two sides of a line would otherwise read the same.
  'diff.session': tpl('{title} {length}', { title: 'text', length: 'minutes' }, { shape: 'label' }),
  'diff.session.distance': tpl(
    '{title} {length}, {distance}',
    { title: 'text', length: 'minutes', distance: 'distance' },
    { shape: 'label' },
  ),
  'diff.session.climb': tpl(
    '{title} {length}, {distance}, {climb}',
    { title: 'text', length: 'minutes', distance: 'distance', climb: 'climb' },
    { shape: 'label' },
  ),
  'diff.session.climb-only': tpl(
    '{title} {length}, {climb}',
    { title: 'text', length: 'minutes', climb: 'climb' },
    { shape: 'label' },
  ),

  // The lines of a diff.
  'diff.changed': tpl(
    '{day}: {before} to {after}',
    { day: 'date', before: 'text', after: 'text' },
    { shape: 'label' },
  ),
  'diff.added': tpl(
    '{day}: {session}, added',
    { day: 'date', session: 'text' },
    { shape: 'label' },
  ),
  'diff.removed': tpl(
    '{day}: {session}, taken out',
    { day: 'date', session: 'text' },
    { shape: 'label' },
  ),
  'diff.moved': tpl(
    '{day}: {session}, moved from {from}',
    { day: 'date', session: 'text', from: 'date' },
    { shape: 'label' },
  ),
  'diff.moved-changed': tpl(
    '{day}: {before} to {after}, moved from {from}',
    { day: 'date', before: 'text', after: 'text', from: 'date' },
    { shape: 'label' },
  ),
  'diff.reshaped': tpl(
    '{day}: {session}, steps changed',
    { day: 'date', session: 'text' },
    { shape: 'label' },
  ),
  'diff.status': tpl(
    '{day}: {session}, status changed',
    { day: 'date', session: 'text' },
    { shape: 'label' },
  ),
  'diff.updated': tpl(
    '{day}: {session}, updated',
    { day: 'date', session: 'text' },
    { shape: 'label' },
  ),
  'diff.week': tpl('Week of {week}: {what}', { week: 'date', what: 'text' }, { shape: 'label' }),
  'diff.week.minutes': tpl(
    'running time {before} to {after}',
    { before: 'weekMinutes', after: 'weekMinutes' },
    { shape: 'label' },
  ),
  // A week the re-plan took as run (rules g-2, g-6): the plan stays what it was, and the minutes run
  // are the record beside it, where the line would otherwise read as a target that rose.
  'diff.week.overshoot': tpl(
    'run past its plan, {ran} against {planned}',
    { ran: 'weekMinutes', planned: 'weekMinutes' },
    { shape: 'label' },
  ),
  'diff.week.updated': tpl('updated', {}, { shape: 'label' }),
  'diff.week.now': tpl('now {what}', { what: 'text' }, { shape: 'label' }),
  'diff.week.no-longer': tpl('no longer {what}', { what: 'text' }, { shape: 'label' }),
  'diff.week.flag.recovery': tpl('a recovery week', {}, { shape: 'label' }),
  'diff.week.flag.peak': tpl('a peak week', {}, { shape: 'label' }),
  'diff.week.flag.taper': tpl('a taper week', {}, { shape: 'label' }),
  'diff.week.flag.race-week': tpl('the race week', {}, { shape: 'label' }),
  'diff.week.flag.post-race': tpl('in the weeks after the race', {}, { shape: 'label' }),
  'diff.week.flag.disrupted': tpl('touched by a rest window', {}, { shape: 'label' }),
  // The label of a window already holds a colon ("Rest: illness"), so the dates follow a comma.
  'diff.hold': tpl(
    '{label}, {from} to {to}',
    { label: 'text', from: 'date', to: 'date' },
    { shape: 'label' },
  ),
  'diff.hold.day': tpl('{label}, on {day}', { label: 'text', day: 'date' }, { shape: 'label' }),
  'diff.list': tpl('Changes in this update', {}, { shape: 'label' }),
  'diff.empty': tpl('No changes to the plan.'),
  'diff.show-all': tpl('Show all {n} changes', { n: 'count' }, { shape: 'label' }),
  'diff.show-fewer': tpl('Show fewer changes', {}, { shape: 'label' }),

  // Why a line is there. One sentence per cause, none with a figure: the figures are in the line.
  'cause.owner-edit': tpl('You made this change yourself.'),
  'cause.decision-hold': tpl('Last week called for holding steady, so the plan did not step up.'),
  'cause.decision-reduce': tpl('Last week called for an easier week, so this week eases.'),
  'cause.owner-target-kept': tpl("You set this week's target, so the plan works inside it."),
  // A restart is also a plan that opens at a low level for a runner who never stopped, so the
  // sentence does not say the runner was away.
  'cause.break-restart': tpl('The plan restarts gently from where your running is now.'),
  'cause.post-race': tpl('These days follow your race, which has a set way back.'),
  'cause.disruption': tpl('A rest window you reported changes these days.'),
  'cause.trim': tpl('The next quality session is a little shorter.'),
  'cause.ramp': tpl('The weekly build moved with your recent running.'),
  'cause.phase-calendar': tpl('The calendar moved this week to another stage of the plan.'),
  'cause.state-update': tpl('Your recent runs and check-ins changed the figures the plan reads.'),

  // The undo control.
  'undo.button': tpl('Undo update', {}, { shape: 'label' }),
  'undo.keep': tpl('Keep', {}, { shape: 'label' }),
  'undo.close': tpl('Close', {}, { shape: 'label' }),
  'undo.heading': tpl('Undo this update', {}, { shape: 'label' }),
  'undo.question': tpl('Put the plan back as it was before this update?'),
  'undo.stays': tpl(
    'Sessions you have run since stay as they are. Sessions before today stay as they are.',
  ),
  'undo.next-update': tpl(
    'The next weekly update on {date} may make the same change if your data still points that way.',
    { date: 'date' },
  ),
  'undo.restores': tpl('What would change back', {}, { shape: 'label' }),
  'undo.loading': tpl('Checking what undoing would change.'),
  'undo.preview-error': tpl('The preview could not be loaded. Close this and try again.'),
  'undo.error': tpl('The plan could not be restored. Try again.'),
  'undo.blocked': tpl('This update cannot be undone right now.'),
  'undo.why-not': tpl('Why this cannot be undone', {}, { shape: 'label' }),
  'undo.done': tpl('Plan restored to how it was on {date}.', { date: 'date' }),

  // Why an undo is not offered, when a reason arrives without a sentence of its own. The five
  // reasons whose wording needs no row are the revision templates; the others have a plain form.
  'undo.reason.window-passed': tpl('The window for undoing this update has passed.'),
  'undo.reason.session-run': tpl('A run is linked to a session in this update, so it stays.'),
  'undo.reason.safety-rule': tpl(
    'This update followed a safety rule that still applies, so it stays.',
  ),
  'undo.reason.checklist': tpl(
    'The restored plan does not meet the quality checklist, so the plan stays as it is.',
  ),
  'undo.reason.unknown': tpl('This update cannot be undone right now.'),
} satisfies Record<string, Template>

type ViewId = keyof typeof REVISION_VIEW_TEMPLATES

const text = (id: ViewId, units: Units): string => render(REVISION_VIEW_TEMPLATES[id], {}, units)

const count = (n: number) => ({ kind: 'count', n }) as const
const day = (iso: string) => ({ kind: 'date', iso, style: 'weekday' }) as const
const short = (iso: string) => ({ kind: 'date', iso, style: 'short' }) as const
const mins = (min: number) => ({ kind: 'minutes', min }) as const

// ---------------------------------------------------------------------------------------------
// Reasons, causes and the marker
// ---------------------------------------------------------------------------------------------

/** One template for each reason a revision is written for; a new reason fails the build here. */
const REASON_IDS = {
  generate: 'revision-view.reason.generate',
  weekly: 'revision-view.reason.weekly',
  review: 'revision-view.reason.review',
  owner: 'revision-view.reason.owner',
  break: 'revision-view.reason.break',
  disruption: 'revision-view.reason.disruption',
  undo: 'revision-view.reason.undo',
  'goal-switch': 'revision-view.reason.goal-switch',
  'method-change': 'revision-view.reason.method-change',
} as const satisfies Record<PlanRevisionReason, ViewId>

/** "Weekly update", "Your edit": the label of what made a revision. */
export function reasonLabel(reason: PlanRevisionReason, units: Units): string {
  const id: ViewId = Object.hasOwn(REASON_IDS, reason)
    ? REASON_IDS[reason]
    : 'revision-view.reason.other'
  return text(id, units)
}

/** The "New" marker of a revision the runner has not opened. */
export function newMarker(units: Units): string {
  return text('revision-view.new', units)
}

const CAUSE_IDS = {
  'owner-edit': 'cause.owner-edit',
  'decision-hold': 'cause.decision-hold',
  'decision-reduce': 'cause.decision-reduce',
  'owner-target-kept': 'cause.owner-target-kept',
  'break-restart': 'cause.break-restart',
  'post-race': 'cause.post-race',
  disruption: 'cause.disruption',
  trim: 'cause.trim',
  ramp: 'cause.ramp',
  'phase-calendar': 'cause.phase-calendar',
  'state-update': 'cause.state-update',
} as const satisfies Record<CauseCode, ViewId>

/** The sentence that says why a line is there. */
export function causeSentence(cause: CauseCode, units: Units): string {
  const id: ViewId = Object.hasOwn(CAUSE_IDS, cause) ? CAUSE_IDS[cause] : 'cause.state-update'
  return text(id, units)
}

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

type Side = 'plain' | 'distance' | 'climb'

/** "Threshold intervals 40 min", with the distance and the climb when `side` asks for them. */
function sessionText(brief: SessionBrief, side: Side, units: Units): string {
  const t = REVISION_VIEW_TEMPLATES
  const title = brief.title
  const length = mins(brief.durationMin)
  const distance =
    side !== 'plain' && brief.distanceM !== null && brief.distanceM > 0
      ? ({ kind: 'distance', m: brief.distanceM } as const)
      : null
  const climb =
    side === 'climb' && brief.gainM !== null && brief.gainM > 0
      ? ({ kind: 'climb', m: brief.gainM } as const)
      : null
  if (distance !== null && climb !== null) {
    return render(t['diff.session.climb'], { title, length, distance, climb }, units)
  }
  if (distance !== null) {
    return render(t['diff.session.distance'], { title, length, distance }, units)
  }
  if (climb !== null) {
    return render(t['diff.session.climb-only'], { title, length, climb }, units)
  }
  return render(t['diff.session'], { title, length }, units)
}

/**
 * The two sides of a changed session as text. They show the title and the length; when that reads
 * the same on both sides (only the distance or the climb moved) the distance, then the climb, is
 * added until they differ. The pair is equal only when nothing visible changed.
 */
function sidesOf(
  before: SessionBrief,
  after: SessionBrief,
  units: Units,
): { before: string; after: string; same: boolean } {
  for (const side of ['plain', 'distance', 'climb'] as const) {
    const a = sessionText(before, side, units)
    const b = sessionText(after, side, units)
    if (a !== b) return { before: a, after: b, same: false }
  }
  return {
    before: sessionText(before, 'plain', units),
    after: sessionText(after, 'plain', units),
    same: true,
  }
}

const NO_SESSION: SessionBrief = {
  date: '',
  kind: 'rest',
  title: 'A session',
  durationMin: 0,
  distanceM: null,
  gainM: null,
}

/**
 * One session's before and after as a line. `moved` is true when the two sit on different days;
 * `fields` are the columns the diff says changed (a changed row with no visible difference is said
 * to have its steps changed, or to be updated).
 */
function changedLine(
  before: SessionBrief,
  after: SessionBrief,
  fields: SessionDiffLine['fields'],
  units: Units,
): string {
  const t = REVISION_VIEW_TEMPLATES
  const moved = before.date !== after.date
  const sides = sidesOf(before, after, units)
  if (!sides.same) {
    return moved
      ? render(
          t['diff.moved-changed'],
          {
            day: day(after.date),
            before: sides.before,
            after: sides.after,
            from: day(before.date),
          },
          units,
        )
      : render(
          t['diff.changed'],
          { day: day(after.date), before: sides.before, after: sides.after },
          units,
        )
  }
  if (moved) {
    return render(
      t['diff.moved'],
      { day: day(after.date), session: sides.after, from: day(before.date) },
      units,
    )
  }
  const id = fields.includes('structure')
    ? 'diff.reshaped'
    : fields.length === 1 && fields[0] === 'status'
      ? 'diff.status'
      : 'diff.updated'
  return render(t[id], { day: day(after.date), session: sides.after }, units)
}

const FLAG_IDS: Record<string, ViewId> = {
  recovery: 'diff.week.flag.recovery',
  peak: 'diff.week.flag.peak',
  taper: 'diff.week.flag.taper',
  'race-week': 'diff.week.flag.race-week',
  'post-race': 'diff.week.flag.post-race',
  'post-race-restart': 'diff.week.flag.post-race',
  disrupted: 'diff.week.flag.disrupted',
  'disruption-return': 'diff.week.flag.disrupted',
}

function flagPhrases(flags: readonly string[], units: Units): string[] {
  const seen = new Set<ViewId>()
  for (const flag of flags) {
    const id = Object.hasOwn(FLAG_IDS, flag) ? FLAG_IDS[flag] : undefined
    if (id !== undefined) seen.add(id)
  }
  return [...seen].map((id) => text(id, units))
}

/**
 * The minutes a week was planned at when the write took it as run: read from the flags the line
 * says were added (`overshoot` and `planned-<n>`, through `plannedMinOf`), and null when the line
 * adds no such flag or the planned minutes are not under the minutes run.
 */
function plannedWhenTakenAsRun(week: WeekDiffLine): number | null {
  if (!week.flagsAdded.includes('overshoot')) return null
  const planned = plannedMinOf({ targetRunMin: week.runMinAfter, flags: week.flagsAdded })
  return planned < week.runMinAfter ? planned : null
}

function weekLine(week: WeekDiffLine, units: Units): string {
  const t = REVISION_VIEW_TEMPLATES
  const pieces: string[] = []
  const planned = plannedWhenTakenAsRun(week)
  if (planned !== null) {
    pieces.push(
      render(
        t['diff.week.overshoot'],
        { ran: mins(week.runMinAfter), planned: mins(planned) },
        units,
      ),
    )
  } else if (week.runMinBefore !== week.runMinAfter) {
    pieces.push(
      render(
        t['diff.week.minutes'],
        { before: mins(week.runMinBefore), after: mins(week.runMinAfter) },
        units,
      ),
    )
  }
  for (const what of flagPhrases(week.flagsAdded, units)) {
    pieces.push(render(t['diff.week.now'], { what }, units))
  }
  for (const what of flagPhrases(week.flagsRemoved, units)) {
    pieces.push(render(t['diff.week.no-longer'], { what }, units))
  }
  const what = pieces.length > 0 ? pieces.join(', ') : text('diff.week.updated', units)
  return render(t['diff.week'], { week: short(week.weekStart), what }, units)
}

/**
 * A row of a displayed diff as one line in the runner's units: "Thu 29 Oct: Threshold 40 min to
 * Easy 30 min", "Sat 31 Oct: Long run 105 min, added", "Sun 1 Nov: Easy 45 min, taken out",
 * "Sat 31 Oct: Long run 105 min, moved from Fri 30 Oct", "Week of 26 Oct: running time 240 min to
 * 220 min".
 */
export function describeEntry(entry: DiffEntry, units: Units): string {
  const t = REVISION_VIEW_TEMPLATES
  switch (entry.type) {
    case 'week':
      return weekLine(entry.week, units)
    case 'hold':
      if (entry.hold.from === entry.hold.to) {
        return render(
          t['diff.hold.day'],
          { label: entry.hold.label, day: day(entry.hold.from) },
          units,
        )
      }
      return render(
        t['diff.hold'],
        { label: entry.hold.label, from: day(entry.hold.from), to: day(entry.hold.to) },
        units,
      )
    case 'added':
      return render(
        t['diff.added'],
        {
          day: day(entry.line.date),
          session: sessionText(entry.line.after ?? NO_SESSION, 'plain', units),
        },
        units,
      )
    case 'removed':
      return render(
        t['diff.removed'],
        {
          day: day(entry.line.date),
          session: sessionText(entry.line.before ?? NO_SESSION, 'plain', units),
        },
        units,
      )
    case 'changed': {
      const { before, after } = entry.line
      if (before === null || after === null) {
        return render(
          t['diff.updated'],
          {
            day: day(entry.line.date),
            session: sessionText(after ?? before ?? NO_SESSION, 'plain', units),
          },
          units,
        )
      }
      return changedLine(before, after, entry.line.fields, units)
    }
    case 'moved': {
      const from = entry.from.before ?? NO_SESSION
      const to = entry.to.after ?? NO_SESSION
      return render(
        t['diff.moved'],
        { day: day(entry.to.date), session: sessionText(to, 'plain', units), from: day(from.date) },
        units,
      )
    }
    case 'replaced': {
      const from = entry.from.before ?? NO_SESSION
      const to = entry.to.after ?? NO_SESSION
      const sides = sidesOf(from, to, units)
      return render(
        t['diff.changed'],
        { day: day(entry.to.date), before: sides.before, after: sides.after },
        units,
      )
    }
  }
}

/** The name of the list of a diff's lines, for assistive technology. */
export function diffListLabel(units: Units): string {
  return text('diff.list', units)
}

/** "No changes to the plan." for a diff with nothing in it. */
export function emptyDiffText(units: Units): string {
  return text('diff.empty', units)
}

/** "Show all 12 changes". */
export function showAllText(n: number, units: Units): string {
  return render(REVISION_VIEW_TEMPLATES['diff.show-all'], { n: count(n) }, units)
}

export function showFewerText(units: Units): string {
  return text('diff.show-fewer', units)
}

// ---------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------

/**
 * The weekly update that follows `today` (Mondays, 03:00; `REPLAN_SLOT` in
 * `server/jobs/scheduler.ts`, whose weekday a test compares with this).
 */
export function nextWeeklyUpdate(today: string): string {
  return addDays(mondayOf(today), 7)
}

/** The words of the undo control, in the order it shows them. */
export interface UndoWords {
  button: string
  keep: string
  close: string
  heading: string
  question: string
  stays: string
  /** Only for a revision the scheduler wrote: the update that may make the same change. */
  nextUpdate: string | null
  restores: string
  loading: string
  previewError: string
  error: string
  blocked: string
  whyNot: string
}

export function undoWords(args: { auto: boolean; today: string; units: Units }): UndoWords {
  const { auto, today, units } = args
  return {
    button: text('undo.button', units),
    keep: text('undo.keep', units),
    close: text('undo.close', units),
    heading: text('undo.heading', units),
    question: text('undo.question', units),
    stays: text('undo.stays', units),
    nextUpdate: auto
      ? render(
          REVISION_VIEW_TEMPLATES['undo.next-update'],
          { date: day(nextWeeklyUpdate(today)) },
          units,
        )
      : null,
    restores: text('undo.restores', units),
    loading: text('undo.loading', units),
    previewError: text('undo.preview-error', units),
    error: text('undo.error', units),
    blocked: text('undo.blocked', units),
    whyNot: text('undo.why-not', units),
  }
}

/** "Plan restored to how it was on Thu 29 Oct." The day is the one the undone update was made. */
export function undoDoneText(date: string, units: Units): string {
  return render(REVISION_VIEW_TEMPLATES['undo.done'], { date: day(date) }, units)
}

/**
 * The plain sentence for each reason an undo is not offered, used when the reason arrives without
 * one. The record has a key for every `UndoReasonCode`, so a code added to the type fails the
 * build here until it is worded.
 */
export const UNDO_REASON_FALLBACKS = {
  'already-undone': REVISION_TEMPLATES['revision.undo.already-undone'],
  'is-undo': REVISION_TEMPLATES['revision.undo.is-undo'],
  'not-undoable': REVISION_TEMPLATES['revision.undo.not-undoable'],
  'window-passed': REVISION_VIEW_TEMPLATES['undo.reason.window-passed'],
  'plan-archived': REVISION_TEMPLATES['revision.undo.plan-archived'],
  'edited-since': REVISION_TEMPLATES['revision.undo.edited-since.plan'],
  'session-run': REVISION_VIEW_TEMPLATES['undo.reason.session-run'],
  'safety-rule': REVISION_VIEW_TEMPLATES['undo.reason.safety-rule'],
  checklist: REVISION_VIEW_TEMPLATES['undo.reason.checklist'],
} as const satisfies Record<UndoReasonCode, Template>

/**
 * The muted line for a reason an undo is not offered. The server words the reason from the row, the
 * rule or the check it names; a reason that arrives without a sentence, or with a code this build
 * does not know, gets the plain sentence of its code, never an empty line.
 */
export function undoReasonLine(reason: Pick<UndoReason, 'code' | 'message'>, units: Units): string {
  const message = typeof reason.message === 'string' ? reason.message.trim() : ''
  if (message !== '') return message
  const template: Template = Object.hasOwn(UNDO_REASON_FALLBACKS, reason.code)
    ? UNDO_REASON_FALLBACKS[reason.code]
    : REVISION_VIEW_TEMPLATES['undo.reason.unknown']
  return render(template, {}, units)
}
