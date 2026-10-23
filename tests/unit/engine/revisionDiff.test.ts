import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { pairSessions } from '../../../shared/domain/sessionIdentity.ts'
import {
  diffPlans,
  type DiffSessionRow,
  type DiffWeekRow,
  type PlanWrites,
} from '../../../shared/engine/diff.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import {
  attributeChange,
  attributionContext,
  CAUSE_ORDER,
  causesOf,
  entryCauses,
  presentDiff,
  type RevisionFacts,
} from '../../../shared/engine/revisionDiff.ts'
import type {
  DisruptionWindow,
  EngineInput,
  PlanDraft,
  SessionSpec,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import type { PlanDiff, SessionDiffLine, WeekDiffLine } from '../../../shared/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

// ---------------------------------------------------------------------------------------------
// Diff lines by hand
// ---------------------------------------------------------------------------------------------

const BRIEF = {
  date: '2026-10-29',
  kind: 'threshold',
  title: 'Threshold intervals',
  durationMin: 40,
  distanceM: 8000,
  gainM: null,
} as const

function session(over: Partial<SessionDiffLine> = {}): SessionDiffLine {
  return {
    change: 'changed',
    externalId: 'x1',
    sessionId: 's1',
    date: '2026-10-29',
    weekStart: '2026-10-26',
    before: BRIEF,
    after: { ...BRIEF, durationMin: 30 },
    fields: ['durationMin'],
    rules: ['f-1'],
    ...over,
  }
}

function week(over: Partial<WeekDiffLine> = {}): WeekDiffLine {
  return {
    weekStart: '2026-10-26',
    runMinBefore: 240,
    runMinAfter: 240,
    flagsAdded: [],
    flagsRemoved: [],
    ...over,
  }
}

function diffOf(
  sessions: SessionDiffLine[],
  weeks: WeekDiffLine[] = [],
  holds: PlanDiff['holds'] = [],
): PlanDiff {
  return {
    v: 1,
    sessions,
    weeks,
    holds,
    totals: {
      added: sessions.filter((l) => l.change === 'added').length,
      removed: sessions.filter((l) => l.change === 'removed').length,
      changed: sessions.filter((l) => l.change === 'changed').length,
      weeksChanged: weeks.length,
      runMinBefore: 0,
      runMinAfter: 0,
    },
    empty: sessions.length + weeks.length + holds.length === 0,
  }
}

// Written on Monday 26 Oct 2026, so the decision caps the week of 26 Oct.
const WEEKLY: RevisionFacts = {
  reason: 'weekly',
  decision: null,
  writtenOn: '2026-10-26',
  disruptionId: null,
}

function causes(line: SessionDiffLine | WeekDiffLine, facts: RevisionFacts, diff?: PlanDiff) {
  const base =
    diff ?? diffOf('externalId' in line ? [line] : [], 'externalId' in line ? [] : [line])
  return attributeChange(line, attributionContext(base, facts))
}

describe('attributeChange', () => {
  it('gives a change the runner made themselves that one cause, and no other', () => {
    const edit = { ...WEEKLY, reason: 'owner' as const, changeFields: ['session.status'] }
    // Whatever else the line carries (a window's rule, a decision), the edit is the cause.
    const noisy = { ...edit, decision: { decision: 'hold' as const } }
    expect(causes(session({ rules: ['J9', 'design-4.3'] }), noisy)).toEqual(['owner-edit'])
    expect(causes(week({ runMinAfter: 200 }), edit)).toEqual(['owner-edit'])
    expect(causes(session(), { ...WEEKLY, reason: 'undo' })).toEqual(['owner-edit'])
    // A re-plan the runner asked for is the engine's work and is attributed like the weekly one.
    const replanned = { ...WEEKLY, reason: 'owner' as const, changeFields: ['targetRunMin'] }
    expect(causes(session(), replanned)).toEqual(['state-update'])
    expect(causes(session(), { ...replanned, decision: { decision: 'hold' } })).toEqual([
      'decision-hold',
    ])
  })

  it('names a rest window from the revision, a session rule, a week flag or a hold', () => {
    expect(causes(session(), { ...WEEKLY, reason: 'disruption' })).toEqual(['disruption'])
    expect(causes(session(), { ...WEEKLY, disruptionId: 'd1' })).toEqual(['disruption'])
    expect(causes(session({ rules: ['J9', 'n-3'] }), WEEKLY)).toEqual(['disruption'])
    const flagged = week({ flagsAdded: ['disrupted'] })
    expect(causes(session(), WEEKLY, diffOf([session()], [flagged]))).toEqual(['disruption'])
    expect(causes(flagged, WEEKLY)).toEqual(['disruption'])
    const holds = [{ from: '2026-10-28', to: '2026-10-30', label: 'Rest', disruptionId: 'd1' }]
    expect(causes(session(), WEEKLY, diffOf([session()], [], holds))).toEqual(['disruption'])
    // A hold that ends before the session does not explain it.
    const early = [{ from: '2026-10-26', to: '2026-10-28', label: 'Rest', disruptionId: 'd1' }]
    expect(causes(session(), WEEKLY, diffOf([session()], [], early))).not.toContain('disruption')
  })

  it('names a restart after a break and the weeks after a race', () => {
    expect(causes(session(), { ...WEEKLY, reason: 'break' })).toEqual(['break-restart'])
    expect(causes(session({ rules: ['J7'] }), WEEKLY)).toEqual(['break-restart'])
    expect(causes(week({ flagsAdded: ['restart-floor'] }), WEEKLY)).toEqual(['break-restart'])
    expect(causes(session({ rules: ['H12', 'J8'] }), WEEKLY)).toEqual(['post-race'])
    expect(causes(week({ flagsAdded: ['post-race'] }), WEEKLY)).toEqual(['post-race'])
    const postRace = {
      decision: 'hold' as const,
      postRace: {
        label: 'After the race, step 1 of 3',
        phase: 'step' as const,
        step: 1,
        steps: 3,
        holdUntil: '2026-10-20',
        quietUntil: '2026-11-03',
        extensionDays: 0,
      },
    }
    // The decision reads "hold" inside the window; it is the window's, not a hold of the week.
    expect(causes(session(), { ...WEEKLY, decision: postRace })).toEqual(['post-race'])
  })

  it('names the weekly decision for the week it caps, and only that week', () => {
    const hold = { ...WEEKLY, decision: { decision: 'hold' as const } }
    const reduce = { ...WEEKLY, decision: { decision: 'reduce' as const } }
    const progress = { ...WEEKLY, decision: { decision: 'progress' as const } }
    expect(causes(session(), hold)).toEqual(['decision-hold'])
    expect(causes(week(), reduce)).toEqual(['decision-reduce'])
    expect(causes(session(), progress)).toEqual(['state-update'])
    const later = session({ date: '2026-11-05', weekStart: '2026-11-02' })
    expect(causes(later, hold)).not.toContain('decision-hold')
    // A catch-up written on a Thursday still caps the Monday of its week.
    expect(causes(session(), { ...hold, writtenOn: '2026-10-29' })).toEqual(['decision-hold'])
  })

  it('names a trimmed session, with the hold that trimmed it', () => {
    const trimmed = session({ rules: ['f-1', 'design-4.3'] })
    expect(causes(trimmed, WEEKLY)).toEqual(['trim'])
    expect(causes(trimmed, { ...WEEKLY, decision: { decision: 'hold' } })).toEqual([
      'trim',
      'decision-hold',
    ])
  })

  it("names the runner's own target when the engine kept it", () => {
    const owner = { ...WEEKLY, ownerWeeks: new Set(['2026-10-26']) }
    expect(causes(session(), owner)).toEqual(['owner-target-kept'])
    expect(causes(week({ runMinAfter: 200 }), owner)).toEqual(['owner-target-kept'])
    const other = { ...WEEKLY, ownerWeeks: new Set(['2026-11-02']) }
    expect(causes(session(), other)).not.toContain('owner-target-kept')
  })

  it('falls back to the calendar, the weekly build, then to the plan reading new figures', () => {
    expect(causes(week({ flagsAdded: ['recovery'] }), WEEKLY)).toEqual(['phase-calendar'])
    expect(causes(week({ flagsRemoved: ['taper'], runMinAfter: 200 }), WEEKLY)).toEqual([
      'phase-calendar',
      'ramp',
    ])
    expect(causes(week({ runMinAfter: 260 }), WEEKLY)).toEqual(['ramp'])
    // A session reads the story of its week.
    expect(causes(session(), WEEKLY, diffOf([session()], [week({ runMinAfter: 260 })]))).toEqual([
      'ramp',
    ])
    expect(causes(session(), WEEKLY)).toEqual(['state-update'])
    expect(causes(week({ flagsAdded: ['ladder-3'] }), WEEKLY)).toEqual(['state-update'])
  })

  it('hides the generic causes when a specific one applies', () => {
    const lines = week({ runMinAfter: 200, flagsAdded: ['recovery'] })
    const withHold = { ...WEEKLY, decision: { decision: 'reduce' as const } }
    expect(causes(lines, withHold)).toEqual(['decision-reduce'])
  })

  it('lists causes most specific first, in the order of CAUSE_ORDER', () => {
    const line = session({ rules: ['J9', 'J7', 'H12', 'design-4.3'] })
    const all = causes(line, {
      ...WEEKLY,
      decision: { decision: 'hold' },
      ownerWeeks: new Set(['2026-10-26']),
    })
    expect(all).toEqual([
      'disruption',
      'break-restart',
      'post-race',
      'trim',
      'decision-hold',
      'owner-target-kept',
    ])
    expect(all).toEqual(CAUSE_ORDER.filter((cause) => all.includes(cause)))
  })

  it('gives every line of a diff its causes, keyed by externalId and Monday', () => {
    const lines = [session({ externalId: 'a' }), session({ externalId: 'b', rules: ['J9'] })]
    const diff = diffOf(lines, [week({ runMinAfter: 200 })])
    expect(causesOf(diff, WEEKLY)).toEqual({
      sessions: { a: ['ramp'], b: ['disruption'] },
      weeks: { '2026-10-26': ['ramp'] },
    })
    // A previewed session has no identity yet and no entry.
    const previewed = diffOf([session({ externalId: '', sessionId: null })])
    expect(causesOf(previewed, WEEKLY).sessions).toEqual({})
  })
})

// ---------------------------------------------------------------------------------------------
// The replan-chain matrix: every line of every weekly diff has a cause
// ---------------------------------------------------------------------------------------------

type Existing = NonNullable<EngineInput['existing']>

const asExisting = (plan: PlanDraft, today: string): Existing => ({
  weeks: plan.weeks,
  sessions: plan.sessions.map((s, i) => ({
    ...s,
    id: `s${i}`,
    status: s.date < today ? 'completed' : 'planned',
    activityId: null,
  })),
})

const sessionRow = (spec: SessionSpec, externalId: string): DiffSessionRow => ({
  id: null,
  externalId,
  weekStart: mondayOf(spec.date),
  date: spec.date,
  kind: spec.kind,
  title: spec.title,
  durationMin: spec.durationMin,
  distanceM: spec.distanceM,
  gainM: spec.gainM,
  structure: JSON.stringify(spec.structure),
  target: JSON.stringify(spec.target),
  status: 'planned',
  rules: JSON.stringify(spec.rules),
})

const weekRow = (w: WeekDraft): DiffWeekRow => ({
  weekStart: w.weekStart,
  targetRunMin: w.targetRunMin,
  flags: JSON.stringify(w.flags),
})

/** The writes of replacing `before` by `after` from `today` on, paired the way the server pairs. */
function writesBetween(before: PlanDraft, after: PlanDraft, today: string): PlanWrites {
  const was = before.sessions.filter((s) => s.date >= today)
  const now = after.sessions.filter((s) => s.date >= today)
  const { paired, removed, added } = pairSessions(was, now)
  const id = (spec: SessionSpec) => `e-${spec.date}-${spec.kind}-${String(spec.order)}`
  const updated = paired
    .map(({ before: b, after: a }) => ({
      before: sessionRow(b, id(b)),
      after: sessionRow(a, id(b)),
    }))
    .filter(({ before: b, after: a }) => JSON.stringify(b) !== JSON.stringify(a))
  const monday = mondayOf(today)
  const oldWeeks = new Map(
    before.weeks.filter((w) => w.weekStart >= monday).map((w) => [w.weekStart, w]),
  )
  const newWeeks = new Map(
    after.weeks.filter((w) => w.weekStart >= monday).map((w) => [w.weekStart, w]),
  )
  const weeks: PlanWrites['weeks'] = { created: [], deleted: [], updated: [] }
  for (const [start, w] of newWeeks) {
    const old = oldWeeks.get(start)
    if (old === undefined) weeks.created.push(weekRow(w))
    else if (
      old.targetRunMin !== w.targetRunMin ||
      JSON.stringify(old.flags) !== JSON.stringify(w.flags)
    ) {
      weeks.updated.push({ before: weekRow(old), after: weekRow(w) })
    }
  }
  for (const [start, w] of oldWeeks) if (!newWeeks.has(start)) weeks.deleted.push(weekRow(w))
  return {
    sessions: {
      created: added.map((spec) => sessionRow(spec, `n-${id(spec)}`)),
      deleted: removed.map((spec) => sessionRow(spec, id(spec))),
      updated,
    },
    weeks,
  }
}

/**
 * A Monday re-plan every week up to the race, each week run as planned: the diff of each one. The
 * plan of record is built without `windows`, which every re-plan is given, as a window the runner
 * reports after the plan was made.
 */
const plainChains = new Map<string, Array<{ diff: PlanDiff; monday: string }>>()
function chainDiffs(
  id: string,
  windows: DisruptionWindow[] = [],
): Array<{ diff: PlanDiff; monday: string }> {
  if (windows.length === 0) {
    const known = plainChains.get(id)
    if (known !== undefined) return known
    const built = buildChain(id, windows)
    plainChains.set(id, built)
    return built
  }
  return buildChain(id, windows)
}

function buildChain(
  id: string,
  windows: DisruptionWindow[],
): Array<{ diff: PlanDiff; monday: string }> {
  const a = athletes().find((x) => x.id === id)!
  const input = { ...a.input, disruptions: windows }
  let plan = buildPlan(a.input)
  let activities = a.input.activities
  let monday = addDays(mondayOf(a.input.today), 7)
  const raceMonday = mondayOf(a.input.goal.date)
  const diffs: Array<{ diff: PlanDiff; monday: string }> = []
  while (monday <= raceMonday) {
    const ran = plan.sessions
      .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
      .filter((s) => !['strength', 'race', 'mobility', 'rest'].includes(s.kind))
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}-${s.order}`,
          durationSec: s.durationMin * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
        }),
      )
    activities = [...activities, ...ran]
    const next = replan({
      ...input,
      today: monday,
      activities,
      existing: asExisting(plan, monday),
    }).draft
    diffs.push({ diff: diffPlans(writesBetween(plan, next, monday)), monday })
    plan = next
    monday = addDays(monday, 7)
  }
  return diffs
}

function expectEveryLineExplained(diffs: Array<{ diff: PlanDiff; monday: string }>): number {
  let lines = 0
  for (const { diff, monday } of diffs) {
    const facts: RevisionFacts = { ...WEEKLY, writtenOn: monday }
    const found = causesOf(diff, facts)
    for (const line of diff.sessions) {
      const own = found.sessions[line.externalId]
      expect(own, `${monday} ${line.externalId}`).toBeDefined()
      expect(own!.length, `${monday} ${line.externalId}`).toBeGreaterThan(0)
      expect(own!.every((c) => CAUSE_ORDER.includes(c))).toBe(true)
      lines += 1
    }
    for (const line of diff.weeks) {
      const own = found.weeks[line.weekStart]
      expect(own, `${monday} week ${line.weekStart}`).toBeDefined()
      expect(own!.length).toBeGreaterThan(0)
      lines += 1
    }
    // The causes of a presented entry are the union of the lines it folds, never empty.
    for (const entry of presentDiff(diff)) {
      if (entry.type !== 'hold') {
        expect(entryCauses(entry, found).length, `${monday} ${entry.key}`).toBeGreaterThan(0)
      }
    }
  }
  return lines
}

describe('attributeChange over the replan-chain matrix', () => {
  describe.each(athletes().map((a) => a.id))('weekly re-plans of %s', (id) => {
    const diffs = chainDiffs(id)

    it('re-plans more than once and some re-plans change the plan', () => {
      expect(diffs.length).toBeGreaterThan(1)
    })

    it('gives every line of every diff at least one cause', () => {
      expectEveryLineExplained(diffs)
    })

    it('gives every line a cause under a hold decision and a reduce decision too', () => {
      for (const decision of ['hold', 'reduce'] as const) {
        for (const { diff, monday } of diffs) {
          const found = causesOf(diff, { ...WEEKLY, writtenOn: monday, decision: { decision } })
          for (const line of diff.sessions) {
            expect(found.sessions[line.externalId]!.length).toBeGreaterThan(0)
          }
        }
      }
    })
  })

  it('finds lines to explain in the matrix, and they have several kinds of cause', () => {
    const tally = new Map<string, number>()
    let lines = 0
    for (const a of athletes()) {
      for (const { diff, monday } of chainDiffs(a.id)) {
        lines += diff.sessions.length + diff.weeks.length
        const found = causesOf(diff, { ...WEEKLY, writtenOn: monday })
        for (const list of [...Object.values(found.sessions), ...Object.values(found.weeks)]) {
          for (const cause of list) tally.set(cause, (tally.get(cause) ?? 0) + 1)
        }
      }
    }
    expect(lines).toBeGreaterThan(50)
    expect([...tally.keys()].sort()).toEqual(
      expect.arrayContaining(['phase-calendar', 'post-race', 'ramp', 'state-update']),
    )
  })

  it('names the rest window on the lines of a chain that has one', () => {
    const a = athletes().find((x) => x.id === 'half')!
    const start = addDays(mondayOf(a.input.today), 14)
    const window: DisruptionWindow = {
      id: 'w1',
      reason: 'illness-below-neck',
      mode: 'rest',
      startDate: start,
      endDate: addDays(start, 9),
      maxRunMin: null,
      pain: null,
      gaitChange: false,
    }
    const diffs = chainDiffs('half', [window])
    expectEveryLineExplained(diffs)
    const named = diffs.flatMap(({ diff, monday }) => {
      const found = causesOf(diff, { ...WEEKLY, writtenOn: monday })
      return Object.values(found.sessions).filter((list) => list.includes('disruption'))
    })
    expect(named.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// presentDiff
// ---------------------------------------------------------------------------------------------

describe('presentDiff', () => {
  const added = (over: Partial<SessionDiffLine>) =>
    session({ change: 'added', before: null, after: { ...BRIEF }, fields: [], ...over })
  const removed = (over: Partial<SessionDiffLine>) =>
    session({ change: 'removed', before: { ...BRIEF }, after: null, fields: [], ...over })

  it('folds the same session on another day into one moved entry', () => {
    const out = removed({ externalId: 'a', date: '2026-10-28' })
    const into = added({ externalId: 'b', date: '2026-10-30' })
    const entries = presentDiff(diffOf([out, into]))
    expect(entries.map((e) => e.type)).toEqual(['moved'])
    expect(entries[0]).toMatchObject({
      date: '2026-10-30',
      from: { externalId: 'a' },
      to: { externalId: 'b' },
    })
  })

  it('folds a session taken out and another put in its day into one replaced entry', () => {
    const out = removed({ externalId: 'a', date: '2026-10-29' })
    const into = added({
      externalId: 'b',
      date: '2026-10-29',
      after: { ...BRIEF, kind: 'easy', title: 'Easy run', durationMin: 30 },
    })
    const entries = presentDiff(diffOf([out, into]))
    expect(entries.map((e) => e.type)).toEqual(['replaced'])
  })

  it('reads a swap of two days as two moves and leaves a lone addition or removal alone', () => {
    const entries = presentDiff(
      diffOf([
        removed({ externalId: 'a', date: '2026-10-27' }),
        added({ externalId: 'b', date: '2026-10-29' }),
        removed({
          externalId: 'c',
          date: '2026-10-31',
          before: { ...BRIEF, kind: 'long', title: 'Long run', durationMin: 90 },
        }),
        added({
          externalId: 'd',
          date: '2026-11-01',
          after: { ...BRIEF, kind: 'easy', title: 'Easy run' },
        }),
      ]),
    )
    expect(entries.map((e) => e.type)).toEqual(['moved', 'removed', 'added'])
  })

  it('orders a week before its days, and the days by date', () => {
    const entries = presentDiff(
      diffOf(
        [
          session({ externalId: 'late', date: '2026-11-03', weekStart: '2026-11-02' }),
          session({ externalId: 'mon', date: '2026-10-26' }),
          session({ externalId: 'thu', date: '2026-10-29' }),
        ],
        [week({ weekStart: '2026-11-02' }), week()],
        [{ from: '2026-10-27', to: '2026-10-28', label: 'Rest', disruptionId: null }],
      ),
    )
    expect(entries.map((e) => e.key)).toEqual([
      'week:2026-10-26',
      'session:mon',
      'hold:0',
      'session:thu',
      'week:2026-11-02',
      'session:late',
    ])
  })

  it('gives every entry its own key, previewed sessions included', () => {
    const entries = presentDiff(
      diffOf([
        added({ externalId: '', sessionId: null, date: '2026-10-27' }),
        added({ externalId: '', sessionId: null, date: '2026-10-28' }),
        session({ externalId: 'a' }),
      ]),
    )
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length)
  })

  it('takes the causes of a folded entry from both its lines', () => {
    const out = removed({ externalId: 'a', date: '2026-10-28' })
    const into = added({ externalId: 'b', date: '2026-10-30' })
    const [entry] = presentDiff(diffOf([out, into]))
    expect(
      entryCauses(entry!, { sessions: { a: ['ramp'], b: ['disruption'] }, weeks: {} }),
    ).toEqual(['disruption', 'ramp'])
    expect(entryCauses(entry!, null)).toEqual([])
  })
})
