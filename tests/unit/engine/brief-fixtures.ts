// Synthetic inputs for the weekly brief tests (phase 3a design 8.5): a runner with ten weeks of
// history, a plan that starts on `MONDAY`, and the pieces `buildBriefFacts` is handed. No personal
// data; dates are fixed so the facts are stable.
import { addDays } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import type { BriefArgs, BriefRevision } from '../../../shared/engine/brief.ts'
import { causesOf } from '../../../shared/engine/revisionDiff.ts'
import type {
  EngineInput,
  SessionKind,
  WeekDraft,
  WeeklyDecision,
} from '../../../shared/engine/types.ts'
import type { Activity, PlanDiff, SessionDiffLine, WeekDiffLine } from '../../../shared/types.ts'
import {
  activity,
  input as baseInput,
  planned,
  wellnessDay,
  type ExistingSession,
} from './e8-fixtures.ts'
import { weekFixture, zoneSetFixture } from './fixtures.ts'

/** The Monday the brief opens. */
export const MONDAY = '2026-10-19'
export const LAST_MONDAY = addDays(MONDAY, -7)
export const GOAL = { name: 'Synthetic half', date: '2027-03-14' }

type Existing = NonNullable<EngineInput['existing']>

/** Four runs a week for the ten weeks before `MONDAY`: 45, 45, 40 and 80 minutes. */
export function history(): Activity[] {
  const week = [
    { dow: 0, min: 45, distanceM: 7200 },
    { dow: 2, min: 45, distanceM: 7200 },
    { dow: 4, min: 40, distanceM: 6400 },
    { dow: 6, min: 80, distanceM: 12_800 },
  ]
  const out: Activity[] = []
  for (let w = 10; w >= 1; w--) {
    for (const run of week) {
      const date = addDays(MONDAY, -7 * w + run.dow)
      out.push(
        activity(date, {
          id: `run-${date}`,
          durationSec: run.min * 60,
          movingSec: run.min * 60,
          distanceM: run.distanceM,
          rpe: 3,
        }),
      )
    }
  }
  return out
}

/** One week of the plan: its draft and an easy run, a threshold run, a long run and an easy run. */
function planWeek(weekStart: string, index: number, over: Partial<WeekDraft> = {}) {
  const week = weekFixture({ weekStart, index, targetRunMin: 230, ...over })
  const id = (n: number) => `s-${weekStart}-${String(n)}`
  const sessions: ExistingSession[] = [
    planned(id(1), addDays(weekStart, 1), 'easy', { durationMin: 45 }),
    planned(id(2), addDays(weekStart, 3), 'threshold', { durationMin: 50 }),
    planned(id(3), addDays(weekStart, 5), 'long', { durationMin: 90, distanceM: 15_000 }),
    planned(id(4), addDays(weekStart, 6), 'easy', { durationMin: 45 }),
  ]
  return { week, sessions }
}

/** The stored plan: `weeks` weeks from `MONDAY`, each with its draft overridden by `over[i]`. */
export function plan(weeks = 4, over: Array<Partial<WeekDraft>> = []): Existing {
  const parts = Array.from({ length: weeks }, (_, i) =>
    planWeek(addDays(MONDAY, 7 * i), i, over[i] ?? {}),
  )
  return {
    weeks: parts.map((part) => part.week),
    sessions: parts.flatMap((part) =>
      part.sessions.map((session) => ({ ...session, externalId: `ext-${session.id}` })),
    ),
  }
}

/** The runner on `MONDAY` with the history, the plan and a goal. */
export function runnerInput(over: Partial<EngineInput> = {}): EngineInput {
  return baseInput({
    today: MONDAY,
    activities: history(),
    existing: plan(),
    ...over,
  })
}

export function decisionOf(
  decision: WeeklyDecision['decision'],
  codes: string[] = [],
  nextWeekTargetMin = 220,
): WeeklyDecision {
  return {
    decision,
    signals: codes.map((code) => ({ code, detail: `Synthetic ${code}.`, rules: ['J5'] })),
    nextWeekTargetMin,
  }
}

/** The arguments for a plain Monday: nothing to notice, no revision, no prediction. */
export function briefArgs(over: Partial<BriefArgs> = {}, inputOver: Partial<EngineInput> = {}) {
  const input = runnerInput(inputOver)
  const args: BriefArgs = {
    weekStart: MONDAY,
    asOf: MONDAY,
    input,
    state: estimateState(input),
    zones: zoneSetFixture(),
    decision: null,
    revision: null,
    replan: null,
    goal: GOAL,
    predictions: [],
    isHot: () => false,
    ...over,
  }
  return args
}

/** A check-in on a day of last week. */
export function checkin(dayOfLastWeek: number, over: Parameters<typeof wellnessDay>[1] = {}) {
  return wellnessDay(addDays(LAST_MONDAY, dayOfLastWeek), over)
}

// ---------------------------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------------------------

const brief = (date: string, kind: SessionKind, durationMin: number) => ({
  date,
  kind,
  title: kind,
  durationMin,
  distanceM: null,
  gainM: null,
})

function sessionLine(
  change: SessionDiffLine['change'],
  externalId: string,
  date: string,
  before: ReturnType<typeof brief> | null,
  after: ReturnType<typeof brief> | null,
  rules: string[] = [],
): SessionDiffLine {
  return {
    change,
    externalId,
    sessionId: `row-${externalId}`,
    date,
    weekStart: addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7)),
    before,
    after,
    fields: [],
    rules,
  }
}

/**
 * A diff of every shape `presentDiff` folds: one session changed in place, one moved to another
 * day (a removed line and an added one), one week line and one hold. Four lines to read, of which
 * two are session changes.
 */
export function mixedDiff(): PlanDiff {
  const thu = addDays(MONDAY, 3)
  const fri = addDays(MONDAY, 4)
  const sat = addDays(MONDAY, 5)
  const week: WeekDiffLine = {
    weekStart: MONDAY,
    runMinBefore: 240,
    runMinAfter: 220,
    flagsAdded: [],
    flagsRemoved: [],
  }
  return {
    v: 1,
    sessions: [
      sessionLine('changed', 'ext-a', sat, brief(sat, 'long', 100), brief(sat, 'long', 90)),
      sessionLine('removed', 'ext-b', thu, brief(thu, 'threshold', 50), null),
      sessionLine('added', 'ext-c', fri, null, brief(fri, 'threshold', 50)),
    ],
    weeks: [week],
    holds: [{ from: thu, to: fri, label: 'Rest window', disruptionId: 'w1' }],
    totals: {
      added: 1,
      removed: 1,
      changed: 1,
      weeksChanged: 1,
      runMinBefore: 240,
      runMinAfter: 220,
    },
    empty: false,
  }
}

export function emptyDiff(): PlanDiff {
  return {
    v: 1,
    sessions: [],
    weeks: [],
    holds: [],
    totals: { added: 0, removed: 0, changed: 0, weeksChanged: 0, runMinBefore: 0, runMinAfter: 0 },
    empty: true,
  }
}

/** A revision of `diff` with the causes the server gives it. */
export function revisionOf(diff: PlanDiff, decision: WeeklyDecision | null = null): BriefRevision {
  return {
    diff,
    causes: causesOf(diff, {
      reason: 'weekly',
      decision,
      writtenOn: MONDAY,
      disruptionId: null,
    }),
  }
}
