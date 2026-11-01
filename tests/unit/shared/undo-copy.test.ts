import { describe, expect, expectTypeOf, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy, lintText } from '../../../shared/copy/lint.ts'
import { describeUndoFinding } from '../../../shared/copy/revision.ts'
import {
  causeSentence,
  describeEntry,
  newMarker,
  nextWeeklyUpdate,
  reasonLabel,
  UNDO_REASON_FALLBACKS,
  undoDoneText,
  undoReasonLine,
  undoWords,
} from '../../../shared/copy/revisionView.ts'
import { type Template } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { CAUSE_ORDER, presentDiff } from '../../../shared/engine/revisionDiff.ts'
import type { UndoFinding } from '../../../shared/engine/undoGuard.ts'
import type {
  CauseCode,
  PlanDiff,
  PlanRevisionReason,
  SessionDiffLine,
  UndoReasonCode,
  Units,
  WeekDiffLine,
} from '../../../shared/types.ts'
import { REPLAN_SLOT } from '../../../server/jobs/scheduler.ts'

const UNITS: Units[] = ['km', 'mi']

/** One entry for every code: a code added to the type fails the build here until it is listed. */
const CODES = {
  'already-undone': true,
  'is-undo': true,
  'not-undoable': true,
  'window-passed': true,
  'plan-archived': true,
  'edited-since': true,
  'session-run': true,
  'safety-rule': true,
  checklist: true,
} satisfies Record<UndoReasonCode, true>
const ALL_CODES = Object.keys(CODES) as UndoReasonCode[]

describe('the exhaustive record of undo reasons', () => {
  it('has a template for exactly the codes of the type', () => {
    expectTypeOf<keyof typeof UNDO_REASON_FALLBACKS>().toEqualTypeOf<UndoReasonCode>()
    expect(Object.keys(UNDO_REASON_FALLBACKS).sort()).toEqual([...ALL_CODES].sort())
  })

  it('fails the build for a record that lacks a code', () => {
    // @ts-expect-error a code with no copy is a compile error
    const incomplete: Record<UndoReasonCode, Template> = {
      'already-undone': UNDO_REASON_FALLBACKS['already-undone'],
    }
    expect(Object.keys(incomplete)).toHaveLength(1)
  })

  it.each(ALL_CODES)('words %s plainly, in both unit systems, short and finished', (code) => {
    for (const units of UNITS) {
      const line = undoReasonLine({ code, message: '' }, units)
      expect(line, code).not.toBe('')
      expect(lintText(line), line).toEqual([])
      expect(line.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
      expect(line).toMatch(/\.$/)
      expect(line).not.toMatch(/\{|\}|NaN|undefined|null/)
    }
  })

  it('shows the sentence the server gave, and the plain one only when there is none', () => {
    const given = 'Thu 29 Oct was changed after this update.'
    expect(undoReasonLine({ code: 'edited-since', message: given }, 'km')).toBe(given)
    expect(undoReasonLine({ code: 'edited-since', message: '  ' }, 'km')).toBe(
      'The plan changed after this update, so it cannot be restored.',
    )
  })

  it('shows a line for a code this build does not know, never an empty one', () => {
    const line = undoReasonLine({ code: 'from-a-newer-build' as UndoReasonCode, message: '' }, 'km')
    expect(line).toBe('This update cannot be undone right now.')
    expect(lintText(line)).toEqual([])
  })

  it('agrees with the server on the codes that need no row', () => {
    const findings: UndoFinding[] = ALL_CODES.map((code) => ({ code }))
    for (const finding of findings) {
      const served = describeUndoFinding(finding, 7)
      expect(served.message, finding.code).not.toBe('')
      expect(undoReasonLine(served, 'km')).toBe(served.message)
      assertCleanCopy(served.message, finding.code)
    }
  })

  it('registers its templates, so the shared lint test renders each one', () => {
    for (const template of Object.values(UNDO_REASON_FALLBACKS)) {
      expect(Object.values(TEMPLATES)).toContain(template)
    }
  })
})

describe('reason labels and the New marker', () => {
  const LABELS: Record<PlanRevisionReason, string> = {
    generate: 'Plan generated',
    weekly: 'Weekly update',
    review: 'After a review',
    owner: 'Your edit',
    break: 'Restart after a break',
    disruption: 'Rest window',
    undo: 'Undo',
    'goal-switch': 'New plan for another goal',
    'method-change': 'Plan shape changed',
  }

  it.each(Object.entries(LABELS))('labels %s as "%s"', (reason, label) => {
    for (const units of UNITS) expect(reasonLabel(reason as PlanRevisionReason, units)).toBe(label)
  })

  it('labels a reason a newer server adds, and marks a new revision', () => {
    expect(reasonLabel('later' as PlanRevisionReason, 'km')).toBe('Plan update')
    expect(newMarker('km')).toBe('New')
  })
})

describe('cause sentences', () => {
  it.each([...CAUSE_ORDER])('words %s as a clean sentence with no figure', (cause) => {
    for (const units of UNITS) {
      const text = causeSentence(cause, units)
      expect(lintText(text), text).toEqual([])
      expect(text).toMatch(/\.$/)
      expect(text).not.toMatch(/\d/)
      expect(text.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
    }
  })

  it('has a sentence for every cause of the type', () => {
    const all = {
      'owner-edit': true,
      'decision-hold': true,
      'decision-reduce': true,
      'owner-target-kept': true,
      'break-restart': true,
      'post-race': true,
      disruption: true,
      trim: true,
      ramp: true,
      'phase-calendar': true,
      'state-update': true,
    } satisfies Record<CauseCode, true>
    expect([...CAUSE_ORDER].sort()).toEqual(Object.keys(all).sort())
  })

  it('does not say the runner was away: a plan can open at a low level for a runner who never stopped', () => {
    for (const units of UNITS) {
      expect(causeSentence('break-restart', units)).toBe(
        'The plan restarts gently from where your running is now.',
      )
      expect(causeSentence('break-restart', units)).not.toMatch(/\baway\b/i)
    }
  })

  it('falls back to the plain cause for one a newer server adds', () => {
    expect(causeSentence('later' as CauseCode, 'km')).toBe(causeSentence('state-update', 'km'))
  })
})

describe('the lines of a diff', () => {
  const brief = (over: Record<string, unknown> = {}) => ({
    date: '2026-10-29',
    kind: 'threshold' as const,
    title: 'Threshold',
    durationMin: 40,
    distanceM: 8000,
    gainM: null,
    ...over,
  })
  const line = (over: Partial<SessionDiffLine>): SessionDiffLine => ({
    change: 'changed',
    externalId: 'x',
    sessionId: 's',
    date: '2026-10-29',
    weekStart: '2026-10-26',
    before: brief(),
    after: brief({ kind: 'easy', title: 'Easy', durationMin: 30 }),
    fields: ['kind', 'durationMin'],
    rules: [],
    ...over,
  })
  const diff = (sessions: SessionDiffLine[], weeks: WeekDiffLine[] = []): PlanDiff => ({
    v: 1,
    sessions,
    weeks,
    holds: [],
    totals: {
      added: 0,
      removed: 0,
      changed: 0,
      weeksChanged: weeks.length,
      runMinBefore: 0,
      runMinAfter: 0,
    },
    empty: false,
  })
  const text = (lines: SessionDiffLine[], units: Units = 'km', weeks: WeekDiffLine[] = []) =>
    presentDiff(diff(lines, weeks)).map((entry) => describeEntry(entry, units))

  it('reads from and to, added and taken out, as the design shows them', () => {
    expect(text([line({})])).toEqual(['Thu 29 Oct: Threshold 40 min to Easy 30 min'])
    expect(
      text([
        line({
          change: 'added',
          date: '2026-10-31',
          before: null,
          after: brief({ date: '2026-10-31', kind: 'long', title: 'Long run', durationMin: 105 }),
        }),
      ]),
    ).toEqual(['Sat 31 Oct: Long run 105 min, added'])
    expect(
      text([
        line({
          change: 'removed',
          date: '2026-11-01',
          before: brief({ date: '2026-11-01', kind: 'easy', title: 'Easy', durationMin: 45 }),
          after: null,
        }),
      ]),
    ).toEqual(['Sun 1 Nov: Easy 45 min, taken out'])
  })

  it('reads a week as running time before and after, with the stage it moved to', () => {
    const week: WeekDiffLine = {
      weekStart: '2026-10-26',
      runMinBefore: 240,
      runMinAfter: 220,
      flagsAdded: ['recovery', 'unknown-flag'],
      flagsRemoved: ['peak'],
    }
    expect(text([], 'km', [week])).toEqual([
      'Week of 26 Oct: running time 4.0 h to 3.7 h, now a recovery week, no longer a peak week',
    ])
    expect(
      text([], 'km', [{ ...week, runMinAfter: 240, flagsAdded: ['x'], flagsRemoved: [] }]),
    ).toEqual(['Week of 26 Oct: updated'])
  })

  it('reads a week taken as run as run past its plan, not as a target that rose', () => {
    const week: WeekDiffLine = {
      weekStart: '2026-10-26',
      runMinBefore: 79,
      runMinAfter: 144,
      flagsAdded: ['overshoot', 'planned-79'],
      flagsRemoved: [],
    }
    expect(text([], 'km', [week])).toEqual([
      'Week of 26 Oct: run past its plan, 2.4 h against 1.3 h',
    ])
    expect(text([], 'mi', [week])).toEqual([
      'Week of 26 Oct: run past its plan, 2.4 h against 1.3 h',
    ])
    // The other flags of the line still read as before, after the words for the week as run.
    expect(text([], 'km', [{ ...week, flagsAdded: [...week.flagsAdded, 'disrupted'] }])).toEqual([
      'Week of 26 Oct: run past its plan, 2.4 h against 1.3 h, now touched by a rest window',
    ])
    for (const units of UNITS) {
      assertCleanCopy(text([], units, [week])[0]!, 'overshoot diff line')
    }
  })

  it('keeps the running-time line for a week whose flags do not say it was taken as run', () => {
    const week: WeekDiffLine = {
      weekStart: '2026-10-26',
      runMinBefore: 79,
      runMinAfter: 144,
      flagsAdded: [],
      flagsRemoved: [],
    }
    expect(text([], 'km', [week])).toEqual(['Week of 26 Oct: running time 1.3 h to 2.4 h'])
    // A flag without the planned minutes, or a plan not under the minutes run, says nothing new.
    expect(text([], 'km', [{ ...week, flagsAdded: ['overshoot'] }])).toEqual([
      'Week of 26 Oct: running time 1.3 h to 2.4 h',
    ])
  })

  it('reads a session on another day as moved, the same way for a folded pair and a changed row', () => {
    const out = line({
      change: 'removed',
      externalId: 'a',
      date: '2026-10-28',
      before: brief({ date: '2026-10-28' }),
      after: null,
    })
    const into = line({
      change: 'added',
      externalId: 'b',
      date: '2026-10-30',
      before: null,
      after: brief({ date: '2026-10-30' }),
    })
    expect(text([out, into])).toEqual(['Fri 30 Oct: Threshold 40 min, moved from Wed 28 Oct'])
    const updated = line({
      before: brief({ date: '2026-10-28' }),
      after: brief({ date: '2026-10-30' }),
      fields: ['date'],
    })
    expect(text([updated])).toEqual(['Fri 30 Oct: Threshold 40 min, moved from Wed 28 Oct'])
    const resized = line({
      before: brief({ date: '2026-10-28' }),
      after: brief({ date: '2026-10-30', durationMin: 35 }),
      fields: ['date', 'durationMin'],
    })
    expect(text([resized])).toEqual([
      'Fri 30 Oct: Threshold 40 min to Threshold 35 min, moved from Wed 28 Oct',
    ])
  })

  it("shows the distance, in the runner's units, when length and title read the same", () => {
    const longer = line({
      before: brief({ distanceM: 8000 }),
      after: brief({ distanceM: 9000 }),
      fields: ['distanceM'],
    })
    expect(text([longer], 'km')).toEqual([
      'Thu 29 Oct: Threshold 40 min, 8 km to Threshold 40 min, 9 km',
    ])
    expect(text([longer], 'mi')).toEqual([
      'Thu 29 Oct: Threshold 40 min, 5 mi to Threshold 40 min, 5.6 mi',
    ])
    const climbs = line({
      before: brief({ gainM: 100 }),
      after: brief({ gainM: 200 }),
      fields: ['gainM'],
    })
    expect(text([climbs], 'mi')).toEqual([
      'Thu 29 Oct: Threshold 40 min, 5 mi, 328 ft to Threshold 40 min, 5 mi, 656 ft',
    ])
  })

  it('says so when only the status of a session changed', () => {
    expect(text([line({ after: brief(), fields: ['status'] })])).toEqual([
      'Thu 29 Oct: Threshold 40 min, status changed',
    ])
  })

  it('says so when a row changed without a difference the lines can show', () => {
    expect(text([line({ after: brief(), fields: ['structure'] })])).toEqual([
      'Thu 29 Oct: Threshold 40 min, steps changed',
    ])
    expect(text([line({ after: brief(), fields: [] })])).toEqual([
      'Thu 29 Oct: Threshold 40 min, updated',
    ])
  })

  it('renders a rest window hold under the label the server stores, with no second colon', () => {
    const withHold: PlanDiff = {
      ...diff([]),
      holds: [
        { from: '2026-10-28', to: '2026-10-30', label: 'Rest: illness', disruptionId: 'd1' },
        {
          from: '2026-10-29',
          to: '2026-10-31',
          label: 'Runs up to 30 min: travel',
          disruptionId: 'd2',
        },
      ],
    }
    expect(presentDiff(withHold).map((entry) => describeEntry(entry, 'km'))).toEqual([
      'Rest: illness, Wed 28 Oct to Fri 30 Oct',
      'Runs up to 30 min: travel, Thu 29 Oct to Sat 31 Oct',
    ])
  })

  it('names the one day of a one-day hold once', () => {
    const withHold: PlanDiff = {
      ...diff([]),
      holds: [{ from: '2026-10-28', to: '2026-10-28', label: 'Rest: illness', disruptionId: 'd1' }],
    }
    expect(presentDiff(withHold).map((entry) => describeEntry(entry, 'mi'))).toEqual([
      'Rest: illness, on Wed 28 Oct',
    ])
  })

  it('stays clean in both unit systems', () => {
    for (const units of UNITS) {
      for (const value of text([line({}), line({ change: 'added', before: null })], units)) {
        assertCleanCopy(value, 'a diff line')
      }
    }
  })
})

describe('the undo words', () => {
  it('adds the next-update sentence for a revision the scheduler wrote, and only for it', () => {
    const auto = undoWords({ auto: true, today: '2026-10-28', units: 'km' })
    expect(auto.nextUpdate).toBe(
      'The next weekly update on Mon 2 Nov may make the same change if your data still points that way.',
    )
    expect(undoWords({ auto: false, today: '2026-10-28', units: 'km' }).nextUpdate).toBeNull()
  })

  it('words the question, what stays, the buttons and the toast as the design does', () => {
    const words = undoWords({ auto: false, today: '2026-10-28', units: 'km' })
    expect(words.question).toBe('Put the plan back as it was before this update?')
    expect(words.stays).toBe(
      'Sessions you have run since stay as they are. Sessions before today stay as they are.',
    )
    expect([words.button, words.keep]).toEqual(['Undo update', 'Keep'])
    expect(undoDoneText('2026-10-26', 'km')).toBe('Plan restored to how it was on Mon 26 Oct.')
    const sentences = [
      words.button,
      words.keep,
      words.close,
      words.heading,
      words.question,
      words.stays,
      words.restores,
      words.loading,
      words.previewError,
      words.error,
      words.blocked,
      words.whyNot,
    ]
    for (const value of sentences) assertCleanCopy(value, 'the undo words')
  })
})

describe('the next weekly update', () => {
  it('is the next day the scheduler runs the weekly re-plan', () => {
    for (let day = 0; day < 14; day += 1) {
      const today = new Date(Date.UTC(2026, 9, 19 + day)).toISOString().slice(0, 10)
      const next = nextWeeklyUpdate(today)
      const weekday = new Date(`${next}T00:00:00Z`).getUTCDay()
      expect(weekday, `after ${today}`).toBe(REPLAN_SLOT.weekday)
      expect(next > today, `after ${today}`).toBe(true)
      expect(
        (Date.parse(`${next}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
        `after ${today}`,
      ).toBeLessThanOrEqual(7)
    }
  })
})
