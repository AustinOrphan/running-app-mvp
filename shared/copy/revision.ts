// The words of the revision log (phase 3a design 4.2, ADR 0007): the summary line of a revision
// and the reason an undo is refused. Every sentence is a template, so the shared G5 lint covers it;
// the helpers below fill one from the figures of the stored diff or write, never from free prose.
//
// A summary is stored with its revision, before anyone knows which units the runner reads, so no
// slot here is a distance, a pace or a climb: dates, counts, minutes and the session's own title
// read the same in kilometres and in miles.
import { render, tpl, type Template } from './template.ts'

export const REVISION_TEMPLATES = {
  // The summary of a re-plan: how many week-level changes it made, then the weekly decision.
  'revision.changes.none': tpl('No changes to the plan.'),
  'revision.changes.one': tpl('1 change across 1 week.'),
  'revision.changes.one-week': tpl('{changes} changes across 1 week.', { changes: 'count' }),
  'revision.changes.many': tpl('{changes} changes across {weeks} weeks.', {
    changes: 'count',
    weeks: 'count',
  }),
  'revision.decision': tpl("Last week's decision: {decision}, next week up to {minutes}.", {
    decision: 'text',
    minutes: 'minutes',
  }),

  // The summary of the owner's edit of one session.
  'revision.owner.skipped': tpl('Skipped {title} on {date}.', { title: 'text', date: 'date' }),
  'revision.owner.restored': tpl('Restored {title} on {date}.', { title: 'text', date: 'date' }),
  'revision.owner.moved': tpl('Moved {title} from {from} to {to}.', {
    title: 'text',
    from: 'date',
    to: 'date',
  }),
  'revision.owner.swapped': tpl('Swapped {title} on {date} with {other} on {otherDate}.', {
    title: 'text',
    date: 'date',
    other: 'text',
    otherDate: 'date',
  }),

  // The summary of a new plan.
  'revision.generated': tpl('Plan generated for {goal}: {weeks} weeks, {sessions} sessions.', {
    goal: 'text',
    weeks: 'count',
    sessions: 'count',
  }),

  // Why an undo is refused, for the reasons that need only the revision itself.
  'revision.undo.already-undone': tpl('This update was already undone.'),
  'revision.undo.is-undo': tpl('An undo cannot be undone.'),
  'revision.undo.not-undoable': tpl('This update has nothing to restore.'),
  'revision.undo.window-passed': tpl('The {days}-day window for undoing this update has passed.', {
    days: 'count',
  }),
} satisfies Record<string, Template>

/** No slot of the revision templates depends on the units, so any units give the same text. */
const STORED_UNITS = 'km'

const count = (n: number) => ({ kind: 'count', n }) as const
const day = (iso: string) => ({ kind: 'date', iso, style: 'weekday' }) as const

/** "3 changes across 2 weeks." for the week-level changes of a re-plan. */
export function changesSummary(changes: number, weeks: number): string {
  if (changes === 0) return render(REVISION_TEMPLATES['revision.changes.none'], {}, STORED_UNITS)
  if (weeks <= 1) {
    return changes === 1
      ? render(REVISION_TEMPLATES['revision.changes.one'], {}, STORED_UNITS)
      : render(
          REVISION_TEMPLATES['revision.changes.one-week'],
          { changes: count(changes) },
          STORED_UNITS,
        )
  }
  return render(
    REVISION_TEMPLATES['revision.changes.many'],
    { changes: count(changes), weeks: count(weeks) },
    STORED_UNITS,
  )
}

/** The weekly decision a re-plan acted on, and the target it set for the week after. */
export function decisionSummary(decision: string, nextWeekTargetMin: number): string {
  return render(
    REVISION_TEMPLATES['revision.decision'],
    { decision, minutes: { kind: 'minutes', min: nextWeekTargetMin } },
    STORED_UNITS,
  )
}

export function skippedSummary(title: string, date: string): string {
  return render(
    REVISION_TEMPLATES['revision.owner.skipped'],
    { title, date: day(date) },
    STORED_UNITS,
  )
}

export function restoredSummary(title: string, date: string): string {
  return render(
    REVISION_TEMPLATES['revision.owner.restored'],
    { title, date: day(date) },
    STORED_UNITS,
  )
}

export function movedSummary(title: string, from: string, to: string): string {
  return render(
    REVISION_TEMPLATES['revision.owner.moved'],
    { title, from: day(from), to: day(to) },
    STORED_UNITS,
  )
}

export function swappedSummary(
  title: string,
  date: string,
  other: string,
  otherDate: string,
): string {
  return render(
    REVISION_TEMPLATES['revision.owner.swapped'],
    { title, date: day(date), other, otherDate: day(otherDate) },
    STORED_UNITS,
  )
}

export function generatedSummary(goal: string, weeks: number, sessions: number): string {
  return render(
    REVISION_TEMPLATES['revision.generated'],
    { goal, weeks: count(weeks), sessions: count(sessions) },
    STORED_UNITS,
  )
}

/**
 * The message of an undo reason that needs only the revision itself. The reasons that name a row,
 * a rule or a check arrive with the undo itself.
 */
export function undoReasonMessage(
  code: 'already-undone' | 'is-undo' | 'not-undoable' | 'window-passed',
  undoWindowDays: number,
): string {
  switch (code) {
    case 'already-undone':
      return render(REVISION_TEMPLATES['revision.undo.already-undone'], {}, STORED_UNITS)
    case 'is-undo':
      return render(REVISION_TEMPLATES['revision.undo.is-undo'], {}, STORED_UNITS)
    case 'not-undoable':
      return render(REVISION_TEMPLATES['revision.undo.not-undoable'], {}, STORED_UNITS)
    case 'window-passed':
      return render(
        REVISION_TEMPLATES['revision.undo.window-passed'],
        { days: count(undoWindowDays) },
        STORED_UNITS,
      )
  }
}
