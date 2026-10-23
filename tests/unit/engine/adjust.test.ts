// The owner's edits of one session as one guarded action [phase 3a design 9.4, 9.5; task E5-6]:
// the guards moved out of the plan engine (availability, one run a day, spacing), the new ones
// (long run, rest windows, spike, weekly target, back-to-back pairs) and the shorten builder. Pure:
// every case hands `adjustCheck` plain sessions.
import { afterAll, describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { isToRun } from '../../../shared/domain/sessionStatus.ts'
import { weekStrip } from '../../../shared/domain/weekStrip.ts'
import {
  adjustCheck,
  shortenedSession,
  type AdjustCheck,
  type AdjustContext,
} from '../../../shared/engine/adjust.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import type { DayRule } from '../../../shared/engine/disruption.ts'
import { matchSessions } from '../../../shared/engine/execution.ts'
import { fuelTargetFor, replayLadder } from '../../../shared/engine/fuel.ts'
import { minSize } from '../../../shared/engine/guards.ts'
import { buildPlan, keptByReplan } from '../../../shared/engine/index.ts'
import {
  completedReference,
  injuryTight,
  VOLUME_KINDS,
  type RunRecord,
} from '../../../shared/engine/limits.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { PlanDraft, SessionKind, Step } from '../../../shared/engine/types.ts'
import type {
  AdjustGuardCode,
  PlanAdjustment,
  PlanGuardView,
  PlanSession,
  PlanSessionStatus,
} from '../../../shared/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes, TODAY, type MatrixAthlete } from './matrix-fixtures.ts'

// TODAY is Wednesday 21 Oct 2026. The week of Monday 26 Oct is the next one: Tue 27, Wed 28,
// Thu 29, Fri 30, Sat 31 Oct, Sun 1 Nov.
const WEEK = '2026-10-26'
const [MON, TUE, WED, THU, FRI, SAT, SUN] = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(WEEK, i)) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]

const TITLES: Partial<Record<SessionKind, string>> = {
  easy: 'Easy run',
  recovery: 'Recovery run',
  long: 'Long run',
  threshold: 'Threshold',
  intervals: 'Intervals',
  hills: 'Hills',
  b2b: 'Back-to-back run',
  strength: 'Strength',
  mobility: 'Mobility',
  race: 'Race',
}

const STEADY = (min: number): Step[] => [
  { kind: 'steady', reps: 1, durationSec: min * 60, distanceM: null, zone: 'z1' },
]

function session(
  id: string,
  date: string,
  kind: SessionKind,
  durationMin: number,
  over: Partial<PlanSession> = {},
): PlanSession {
  return {
    id,
    externalId: `ext-${id}`,
    planId: 'plan-1',
    weekStart: mondayOf(date),
    date,
    order: 0,
    kind,
    title: TITLES[kind] ?? kind,
    durationMin,
    distanceM: null,
    gainM: null,
    structure: STEADY(durationMin),
    target: { zone: 'z1', rpe: [2, 3], hr: null, paceSecPerKm: null, heatNote: null },
    purpose: 'Synthetic.',
    rules: ['F-lib'],
    flags: [],
    status: 'planned',
    activityId: null,
    linkSource: null,
    execution: null,
    original: null,
    updatedAt: '2026-10-21T00:00:00.000Z',
    ...over,
  }
}

const OPEN_WEEK = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
    d,
    { available: true, maxMin: null },
  ]),
) as AdjustContext['availability']

function context(sessions: PlanSession[], over: Partial<AdjustContext> = {}): AdjustContext {
  return {
    today: TODAY,
    availability: OPEN_WEEK,
    sessions,
    weekTargetMin: null,
    dayRules: [],
    completedRuns: [],
    injuryTight: false,
    ...over,
  }
}

function rule(date: string, over: Partial<DayRule> = {}): DayRule {
  return {
    date,
    held: false,
    gate: false,
    maxRunMin: null,
    quality: true,
    reason: 'travel',
    windowIds: ['w1'],
    ...over,
  }
}

function run(date: string, min: number, over: Partial<RunRecord> = {}): RunRecord {
  return { date, min, distanceM: null, gainM: null, lossM: null, ...over }
}

// Every guard code the cases below reach, to prove the list is covered.
const seen = new Set<AdjustGuardCode>()
function check(
  target: PlanSession,
  adjustment: PlanAdjustment,
  sessions: PlanSession[],
  over: Partial<AdjustContext> = {},
): AdjustCheck {
  const result = adjustCheck(target, adjustment, context(sessions, over))
  for (const guard of result.guards) seen.add(guard.code)
  return result
}

const codes = (result: AdjustCheck): AdjustGuardCode[] => result.guards.map((g) => g.code)
const blocking = (result: AdjustCheck): PlanGuardView[] =>
  result.guards.filter((g) => g.effect === 'blocks')

describe('move', () => {
  const easy = session('easy', TUE, 'easy', 40)

  it('moves a session to a free day of its week and keeps the first plan', () => {
    const result = check(easy, { type: 'move', date: FRI }, [easy])
    expect(result).toMatchObject({ allowed: true, noop: false, guards: [] })
    expect(result.edits).toEqual([
      { sessionId: 'easy', patch: { date: FRI, status: 'moved' }, remember: true },
    ])
    expect(result.changes).toEqual([
      { weekStart: WEEK, field: 'session.date', from: TUE, to: FRI, rules: ['F1'] },
    ])
    expect(result.summary).toBe('Moved Easy run from Tue 27 Oct to Fri 30 Oct.')
  })

  it('changes nothing when the day is the same', () => {
    expect(check(easy, { type: 'move', date: TUE }, [easy])).toMatchObject({
      allowed: true,
      noop: true,
      edits: [],
      guards: [],
    })
  })

  it('keeps a session in its week and out of the past', () => {
    const other = check(easy, { type: 'move', date: addDays(WEEK, 8) }, [easy])
    expect(other.allowed).toBe(false)
    expect(codes(other)).toEqual(['other-week'])
    expect(other.guards[0]!.message).toBe(
      'A session moves within its own week. Re-plan to change weeks.',
    )

    const current = session('c', '2026-10-23', 'easy', 40)
    const past = check(current, { type: 'move', date: '2026-10-20' }, [current])
    expect(codes(past)).toEqual(['past-date'])
    expect(past.guards[0]!.message).toBe('A session cannot move to a day that has passed.')
  })

  it('refuses a session that cannot be changed: the race, the past, a linked or done or skipped one', () => {
    const cases: Array<[PlanSession, AdjustGuardCode, string]> = [
      [session('r', SAT, 'race', 180), 'race-day', 'The race day stays where it is.'],
      [
        session('p', '2026-10-20', 'easy', 40),
        'past-session',
        'A session in the past stays as it was.',
      ],
      [
        session('l', TUE, 'easy', 40, { activityId: 'a1', status: 'completed' }),
        'linked',
        'This session is linked to an activity, so it stays as it is. Unlink the activity first to change it.',
      ],
      [
        session('d', TUE, 'easy', 40, { status: 'partial' }),
        'settled',
        'This session is already done, so it stays as it is.',
      ],
      [
        session('s', TUE, 'easy', 40, { status: 'skipped' }),
        'skipped',
        'This session is skipped. Restore it before changing it.',
      ],
    ]
    for (const [target, code, message] of cases) {
      const result = check(target, { type: 'move', date: FRI }, [target])
      expect(codes(result), target.id).toEqual([code])
      expect(result.guards[0]!.message, target.id).toBe(message)
      expect(result).toMatchObject({ allowed: false, edits: [], summary: '' })
    }
  })

  it('offers the restore for a skipped session', () => {
    const skipped = session('s', TUE, 'easy', 40, { status: 'skipped' })
    const result = check(skipped, { type: 'move', date: FRI }, [skipped])
    expect(result.guards[0]!.suggest).toEqual({
      label: 'Restore it first',
      adjustment: { type: 'restore' },
    })
  })

  it('lets a done session through for every status that is still to run', () => {
    for (const status of ['planned', 'moved', 'downgraded', 'adjusted'] as PlanSessionStatus[]) {
      const target = session('t', TUE, 'easy', 40, { status })
      expect(check(target, { type: 'move', date: FRI }, [target]).allowed, status).toBe(true)
    }
  })

  it('refuses a closed day and a day with too little room', () => {
    const closed = check(easy, { type: 'move', date: SAT }, [easy], {
      availability: { ...OPEN_WEEK, sat: { available: false, maxMin: null } },
    })
    expect(codes(closed)).toEqual(['closed-day'])
    expect(closed.guards[0]!.message).toBe(
      'Sat 31 Oct is not a day you run, so Easy run cannot go there.',
    )

    const short = check(easy, { type: 'move', date: SAT }, [easy], {
      availability: { ...OPEN_WEEK, sat: { available: true, maxMin: 30 } },
    })
    expect(codes(short)).toEqual(['day-limit'])
    expect(short.guards[0]!.message).toBe('Easy run is 40 min and Sat 31 Oct allows 30 min.')
  })

  it('keeps one run a day and offers the swap that works', () => {
    const thu = session('thu', THU, 'easy', 45)
    const result = check(easy, { type: 'move', date: THU }, [easy, thu])
    expect(codes(result)).toEqual(['one-run-a-day'])
    expect(result.guards[0]).toMatchObject({
      effect: 'blocks',
      rules: ['F1'],
      message: "Thu 29 Oct already has a run; one run a day keeps the week's spacing (rule F1).",
      suggest: {
        label: 'Swap with Easy run 45 min instead',
        adjustment: { type: 'swap', withSessionId: 'thu' },
      },
    })
    // the suggested swap is allowed
    expect(check(easy, result.guards[0]!.suggest!.adjustment, [easy, thu]).allowed).toBe(true)
  })

  it('offers no swap when the other run cannot be swapped or the swap breaks a rule', () => {
    const linked = session('thu', THU, 'easy', 45, { activityId: 'a1', status: 'completed' })
    expect(check(easy, { type: 'move', date: THU }, [easy, linked]).guards[0]!.suggest).toBeNull()

    // two runs share the day: no single swap
    const two = [session('a', THU, 'easy', 30), session('b', THU, 'strides', 20)]
    expect(check(easy, { type: 'move', date: THU }, [easy, ...two]).guards[0]!.suggest).toBeNull()

    // the swap would put a threshold run next to intervals
    const threshold = session('th', TUE, 'threshold', 40)
    const intervals = session('iv', THU, 'intervals', 40)
    const wed = session('wed', WED, 'easy', 40)
    const hard = check(threshold, { type: 'move', date: WED }, [threshold, intervals, wed])
    expect(codes(hard)).toContain('one-run-a-day')
    expect(hard.guards[0]!.suggest).toBeNull()
  })

  it('keeps an easy day between two hard sessions', () => {
    const threshold = session('th', TUE, 'threshold', 40)
    const intervals = session('iv', THU, 'intervals', 40)
    const result = check(threshold, { type: 'move', date: WED }, [threshold, intervals])
    expect(codes(result)).toEqual(['hard-spacing'])
    expect(result.guards[0]!.message).toBe(
      'Threshold next to Intervals would leave no easy day between two hard sessions (rule F1).',
    )
    // an easy run next to a hard session is fine
    expect(check(easy, { type: 'move', date: WED }, [easy, intervals]).allowed).toBe(true)
    // the two days of a back-to-back pair are one block
    const day1 = session('d1', FRI, 'b2b', 120, { flags: ['b2b-day1'] })
    const day2 = session('d2', SAT, 'b2b', 90, { flags: ['b2b-day2'] })
    const restoring = session('d2', SAT, 'b2b', 90, { flags: ['b2b-day2'], status: 'skipped' })
    expect(check(restoring, { type: 'restore' }, [day1, restoring]).allowed).toBe(true)
    void day2
  })

  it('keeps the long run out of the middle of two quality days, and does not blame an old break', () => {
    const long = session('long', THU, 'long', 90)
    const threshold = session('th', TUE, 'threshold', 40)
    const hills = session('hl', FRI, 'hills', 40)
    // Tuesday: threshold; Thursday: long; Friday: hills. Moving the threshold to Wednesday puts it
    // next to the long run, which then sits between two quality days.
    const result = check(threshold, { type: 'move', date: WED }, [threshold, long, hills])
    expect(codes(result)).toContain('long-run-between')
    expect(result.guards.find((g) => g.code === 'long-run-between')).toMatchObject({
      rules: ['F3'],
      message: 'The long run on Thu 29 Oct would sit between two quality days (rule F3).',
    })

    // The plan already breaks it: Wednesday threshold, Thursday long, Friday hills. A move that
    // leaves them alone does not add the finding.
    const wed = session('wed', WED, 'threshold', 40)
    const fri = session('fri', FRI, 'hills', 40)
    const aside = session('aside', MON, 'easy', 30)
    expect(codes(check(aside, { type: 'move', date: TUE }, [aside, wed, long, fri]))).not.toContain(
      'long-run-between',
    )
  })

  it('keeps a back-to-back pair on its days', () => {
    const day1 = session('d1', SAT, 'b2b', 120, { flags: ['b2b-day1'] })
    const result = check(day1, { type: 'move', date: FRI }, [day1])
    expect(codes(result)).toEqual(['b2b-pair'])
    expect(result.guards[0]!.message).toBe(
      'Back-to-back run is one day of a back-to-back pair, so it stays on its day (rule H3).',
    )
  })
})

describe('rest windows [rule J9]', () => {
  const easy = session('easy', TUE, 'easy', 40)

  it('refuses a held day for a run, a hike or strength, and lets a mobility session through', () => {
    const dayRules = [rule(FRI, { held: true, maxRunMin: 0, quality: false })]
    const run = check(easy, { type: 'move', date: FRI }, [easy], { dayRules })
    expect(codes(run)).toEqual(['rest-window'])
    expect(run.guards[0]).toMatchObject({
      rules: ['J9'],
      message: 'Running is on hold on Fri 30 Oct, so Easy run cannot go there (rule J9).',
    })
    const strength = session('st', TUE, 'strength', 30)
    expect(codes(check(strength, { type: 'move', date: FRI }, [strength], { dayRules }))).toEqual([
      'rest-window',
    ])
    const mobility = session('mo', TUE, 'mobility', 20)
    expect(check(mobility, { type: 'move', date: FRI }, [mobility], { dayRules }).allowed).toBe(
      true,
    )
  })

  it('holds a run to the cap of its day and offers the shorter run', () => {
    const dayRules = [rule(FRI, { maxRunMin: 30 })]
    const result = check(easy, { type: 'move', date: FRI }, [easy], { dayRules })
    expect(codes(result)).toEqual(['day-cap'])
    expect(result.guards[0]).toMatchObject({
      message: 'Runs on Fri 30 Oct are held to 30 min, and Easy run is 40 min (rule J9).',
      suggest: {
        label: 'Shorten it to 30 min first',
        adjustment: { type: 'shorten', durationMin: 30 },
      },
    })
    // a cap under the shortest run leaves nothing to offer
    const tiny = check(easy, { type: 'move', date: FRI }, [easy], {
      dayRules: [rule(FRI, { maxRunMin: 10 })],
    })
    expect(tiny.guards[0]!.suggest).toBeNull()
    // a run within the cap goes
    const within = session('w', TUE, 'easy', 25)
    expect(check(within, { type: 'move', date: FRI }, [within], { dayRules }).allowed).toBe(true)
  })

  it('keeps quality sessions off a day that windows keep easy', () => {
    const dayRules = [rule(FRI, { quality: false })]
    const threshold = session('th', TUE, 'threshold', 40)
    const quiet = check(threshold, { type: 'move', date: FRI }, [threshold], { dayRules })
    expect(codes(quiet)).toEqual(['quiet-day'])
    expect(quiet.guards[0]!.message).toBe(
      'Fri 30 Oct is for easy running only, so Threshold cannot go there (rule J9).',
    )
    expect(check(easy, { type: 'move', date: FRI }, [easy], { dayRules }).allowed).toBe(true)
    const strides = session('sd', TUE, 'strides', 20)
    expect(codes(check(strides, { type: 'move', date: FRI }, [strides], { dayRules }))).toEqual([
      'quiet-day',
    ])
  })

  it('does not put a skipped session back on a day a window holds', () => {
    const skipped = session('s', TUE, 'easy', 40, { status: 'skipped' })
    const result = check(skipped, { type: 'restore' }, [skipped], {
      dayRules: [rule(TUE, { held: true, maxRunMin: 0, quality: false })],
    })
    expect(codes(result)).toEqual(['rest-window'])
    expect(result.allowed).toBe(false)
  })
})

describe('the session spike limit [rule G-1]', () => {
  const skipped = (min: number) => session('long', SAT, 'long', min, { status: 'skipped' })
  const completed = [run('2026-10-12', 60)]

  it('refuses a run above 2.00x the longest completed run of the 30 days', () => {
    const target = skipped(130)
    const result = check(target, { type: 'restore' }, [target], { completedRuns: completed })
    expect(codes(result)).toEqual(['spike'])
    expect(result.guards[0]).toMatchObject({
      effect: 'blocks',
      rules: ['g-1'],
      message:
        'Long run on Sat 31 Oct would be above 200% of the longest run of the last 30 days, so it stays as it is (rule G-1).',
    })
  })

  it('warns between 1.10x and 2.00x and lets the edit through', () => {
    const target = skipped(100)
    const result = check(target, { type: 'restore' }, [target], { completedRuns: completed })
    expect(result.allowed).toBe(true)
    expect(result.guards).toHaveLength(1)
    expect(result.guards[0]).toMatchObject({
      code: 'spike',
      effect: 'warns',
      message:
        'Long run on Sat 31 Oct is above 110% of the longest run of the last 30 days. Check that it feels right (rule G-1).',
    })
    expect(result.edits).toHaveLength(1)
  })

  it('makes 1.10x a hard limit with the recent-injury profile [rule g-3]', () => {
    const target = skipped(70)
    const result = check(target, { type: 'restore' }, [target], {
      completedRuns: completed,
      injuryTight: true,
    })
    expect(result.allowed).toBe(false)
    expect(result.guards[0]).toMatchObject({
      code: 'spike',
      effect: 'blocks',
      rules: ['g-1', 'g-3'],
    })
  })

  it('compares with completed runs only for a refusal: planned runs alone only warn', () => {
    const target = skipped(130)
    const before = session('before', THU, 'easy', 45)
    const result = check(target, { type: 'restore' }, [target, before])
    expect(result.allowed).toBe(true)
    expect(result.guards[0]).toMatchObject({ code: 'spike', effect: 'warns' })
  })

  it('is within the band for a run the plan already held, and does not blame a move that makes it no worse', () => {
    const long = session('long', SAT, 'long', 100)
    const result = check(long, { type: 'move', date: FRI }, [long], { completedRuns: completed })
    expect(result.guards).toEqual([])
    expect(result.allowed).toBe(true)
  })

  it('counts the planned runs before a session as runs done', () => {
    // 100 min is above 1.10x of 60, but the 95 min run on Thursday comes first
    const target = skipped(100)
    const thu = session('thu', THU, 'easy', 95)
    const result = check(target, { type: 'restore' }, [target, thu], { completedRuns: completed })
    expect(result.guards).toEqual([])
  })
})

describe('the weekly target [rules G-2, G-6]', () => {
  it('refuses a restore that takes the week above its target and allows one inside it', () => {
    const tue = session('tue', TUE, 'easy', 40)
    const thu = session('thu', THU, 'easy', 45)
    const skipped = session('long', SAT, 'long', 90, { status: 'skipped' })
    const sessions = [tue, thu, skipped]
    // a longest run of 100 min in the last 30 days, so the 90 min run is inside the spike limit
    const LONG_RUN = [run('2026-10-12', 100)]
    const over = check(skipped, { type: 'restore' }, sessions, {
      weekTargetMin: 150,
      completedRuns: LONG_RUN,
    })
    expect(codes(over)).toEqual(['weekly-cap'])
    expect(over.guards[0]).toMatchObject({
      rules: ['G-2', 'G-6'],
      message:
        'The week of Mon 26 Oct would hold 175 min of running, above its 150 min target (rules G-2, G-6).',
    })
    expect(
      check(skipped, { type: 'restore' }, sessions, { weekTargetMin: 175, completedRuns: LONG_RUN })
        .allowed,
    ).toBe(true)
    // a minute of rounding is allowed, two are not
    expect(
      check(skipped, { type: 'restore' }, sessions, { weekTargetMin: 174, completedRuns: LONG_RUN })
        .allowed,
    ).toBe(true)
    expect(
      check(skipped, { type: 'restore' }, sessions, { weekTargetMin: 173, completedRuns: LONG_RUN })
        .allowed,
    ).toBe(false)
    // a week with no stored target has no cap
    expect(check(skipped, { type: 'restore' }, sessions, { completedRuns: LONG_RUN }).allowed).toBe(
      true,
    )
  })

  it('does not count skipped sessions, hikes or strength', () => {
    const tue = session('tue', TUE, 'easy', 40)
    const gone = session('gone', WED, 'easy', 60, { status: 'skipped' })
    const hike = session('hike', FRI, 'hike', 120)
    const strength = session('str', THU, 'strength', 30)
    const skipped = session('long', SAT, 'long', 90, { status: 'skipped' })
    const result = check(skipped, { type: 'restore' }, [tue, gone, hike, strength, skipped], {
      weekTargetMin: 130,
    })
    expect(result.allowed).toBe(true)
  })

  it('does not check the target for a move, which adds no minutes', () => {
    const tue = session('tue', TUE, 'easy', 40)
    expect(check(tue, { type: 'move', date: FRI }, [tue], { weekTargetMin: 10 }).allowed).toBe(true)
  })
})

describe('swap', () => {
  const tue = session('tue', TUE, 'easy', 40)
  const sat = session('sat', SAT, 'long', 90)

  it('trades the days of two sessions and keeps their prescriptions', () => {
    const result = check(tue, { type: 'swap', withSessionId: 'sat' }, [tue, sat])
    expect(result.allowed).toBe(true)
    expect(result.edits).toEqual([
      { sessionId: 'tue', patch: { date: SAT, status: 'moved' }, remember: true },
      { sessionId: 'sat', patch: { date: TUE, status: 'moved' }, remember: true },
    ])
    expect(result.changes).toEqual([
      { weekStart: WEEK, field: 'session.date', from: TUE, to: SAT, rules: ['F1'] },
      { weekStart: WEEK, field: 'session.date', from: SAT, to: TUE, rules: ['F1'] },
    ])
    expect(result.summary).toBe('Swapped Easy run on Tue 27 Oct with Long run on Sat 31 Oct.')
  })

  it('needs a partner in the same week, still to run and not linked', () => {
    const next = session('next', addDays(SAT, 7), 'easy', 40)
    const linked = session('lk', FRI, 'easy', 40, { activityId: 'a1', status: 'completed' })
    const skipped = session('sk', FRI, 'easy', 40, { status: 'skipped' })
    const race = session('race', SUN, 'race', 180)
    const pair = session('pair', FRI, 'b2b', 100, { flags: ['b2b-day1'] })
    const past = session('past', '2026-10-20', 'easy', 40)
    for (const partner of [next, linked, skipped, race, pair, past, tue]) {
      const result = check(tue, { type: 'swap', withSessionId: partner.id }, [tue, partner])
      expect(codes(result), partner.id).toEqual(['partner-unavailable'])
    }
    const none = check(tue, { type: 'swap', withSessionId: 'nobody' }, [tue])
    expect(none.guards[0]!.message).toBe(
      'That session cannot be swapped with. It must be in the same week, still to run and not linked to an activity.',
    )
  })

  it('checks both new places', () => {
    const intervals = session('iv', WED, 'intervals', 40)
    const threshold = session('th', FRI, 'threshold', 40)
    const easy = session('e', SAT, 'easy', 40)
    // swapping Friday's threshold with Saturday's easy run puts it next to nothing hard; swapping
    // it with Monday's easy run puts it on Monday; swapping the Wednesday intervals to Thursday ...
    const result = check(intervals, { type: 'swap', withSessionId: 'th' }, [
      intervals,
      threshold,
      easy,
    ])
    expect(result.allowed).toBe(true)
    const thu = session('thu', THU, 'easy', 40)
    // intervals Wednesday <-> easy Thursday would put the intervals next to the Friday threshold
    const clash = check(intervals, { type: 'swap', withSessionId: 'thu' }, [
      intervals,
      thu,
      threshold,
    ])
    expect(codes(clash)).toEqual(['hard-spacing'])
  })

  it('changes nothing for two sessions on one day, and cannot move a back-to-back day', () => {
    const strength = session('st', TUE, 'strength', 30, { order: 1 })
    expect(check(tue, { type: 'swap', withSessionId: 'st' }, [tue, strength]).noop).toBe(true)
    const day1 = session('d1', SAT, 'b2b', 120, { flags: ['b2b-day1'] })
    expect(codes(check(day1, { type: 'swap', withSessionId: 'tue' }, [day1, tue]))).toEqual([
      'b2b-pair',
    ])
  })
})

describe('swap-kind', () => {
  const tue = session('tue', TUE, 'easy', 40, { distanceM: 6000 })
  const thu = session('thu', THU, 'threshold', 50, { rules: ['F-lib', 'C5'], distanceM: 9000 })
  const sat = session('sat', SAT, 'threshold', 30, { order: 0 })

  it('takes the next session of that kind in the week and trades prescriptions, not days', () => {
    const result = check(tue, { type: 'swap-kind', kind: 'threshold' }, [tue, sat, thu])
    expect(result.allowed).toBe(true)
    // the earliest threshold of the week is Thursday's
    expect(result.edits.map((e) => e.sessionId)).toEqual(['tue', 'thu'])
    expect(result.edits[0]).toMatchObject({
      sessionId: 'tue',
      remember: true,
      patch: {
        kind: 'threshold',
        title: 'Threshold',
        durationMin: 50,
        distanceM: 9000,
        status: 'moved',
      },
    })
    expect(result.edits[0]!.patch.date).toBeUndefined()
    expect(result.edits[1]).toMatchObject({
      sessionId: 'thu',
      patch: { kind: 'easy', title: 'Easy run', durationMin: 40, distanceM: 6000, status: 'moved' },
    })
    expect(result.changes).toEqual([
      { weekStart: WEEK, field: 'session.kind', from: 'easy', to: 'threshold', rules: ['F1'] },
    ])
    expect(result.summary).toBe('Swapped Easy run on Tue 27 Oct with Threshold on Thu 29 Oct.')
  })

  it('names what is missing when there is nothing to swap with', () => {
    const result = check(tue, { type: 'swap-kind', kind: 'long' }, [tue, thu])
    expect(codes(result)).toEqual(['no-partner'])
    expect(result.guards[0]!.message).toBe(
      'There is no Long run left this week to swap with. A swap never adds a session or raises load.',
    )
    // a partner that is linked, skipped or in the past does not count
    const linked = session('lk', FRI, 'long', 90, { activityId: 'a1', status: 'completed' })
    expect(codes(check(tue, { type: 'swap-kind', kind: 'long' }, [tue, linked]))).toEqual([
      'no-partner',
    ])
  })

  it('words the missing kind as the plan titles it, never as its code', () => {
    const message = (kind: SessionKind) =>
      check(tue, { type: 'swap-kind', kind }, [tue, thu]).guards[0]!.message
    expect(message('long-fast-finish')).toBe(
      'There is no Long run, fast finish left this week to swap with. A swap never adds a session or raises load.',
    )
    expect(message('b2b')).toBe(
      'There is no Back-to-back run left this week to swap with. A swap never adds a session or raises load.',
    )
    for (const kind of ['long-fast-finish', 'b2b', 'race-pace', 'strides', 'hills'] as const) {
      expect(lintText(message(kind)), kind).toEqual([])
      expect(message(kind), kind).not.toContain(`no ${kind} `)
    }
  })

  it('changes nothing for the same kind and checks the two new places', () => {
    expect(check(tue, { type: 'swap-kind', kind: 'easy' }, [tue]).noop).toBe(true)
    const intervals = session('iv', WED, 'intervals', 40)
    // Thursday's threshold would come to Tuesday, next to Wednesday's intervals
    const clash = check(tue, { type: 'swap-kind', kind: 'threshold' }, [tue, intervals, thu])
    expect(codes(clash)).toEqual(['hard-spacing'])
  })
})

describe('shorten', () => {
  const structure: Step[] = [
    { kind: 'warmup', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
    { kind: 'work', reps: 4, durationSec: 240, distanceM: null, zone: 'z3' },
    { kind: 'recover', reps: 4, durationSec: 120, distanceM: null, zone: 'z1' },
    { kind: 'cooldown', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
  ]
  const long = session('thu', THU, 'long', 60, {
    distanceM: 10_000,
    gainM: 300,
    structure,
    rules: ['F-lib', 'g-1'],
  })

  it('shortens to the minutes asked for and scales steps, distance and climb with them', () => {
    const result = check(long, { type: 'shorten', durationMin: 40 }, [long])
    expect(result).toMatchObject({ allowed: true, noop: false, guards: [] })
    expect(result.edits).toHaveLength(1)
    const [edit] = result.edits
    expect(edit).toMatchObject({ sessionId: 'thu', remember: true })
    expect(edit!.patch).toMatchObject({ durationMin: 40, status: 'adjusted' })
    expect(edit!.patch.distanceM).toBe(6666)
    expect(edit!.patch.gainM).toBe(200)
    expect(edit!.patch.structure!.map((s) => [s.kind, s.reps, s.durationSec])).toEqual([
      ['warmup', 1, 400],
      ['work', 4, 160],
      ['recover', 4, 80],
      ['cooldown', 1, 400],
    ])
    // the minutes that are cut are not made up: the rule is cited and nothing else is edited
    expect(edit!.patch.rules).toEqual(['F-lib', 'g-1', 'g-6'])
    expect(result.changes).toEqual([
      { weekStart: WEEK, field: 'session.durationMin', from: 60, to: 40, rules: ['g-6'] },
    ])
    expect(result.summary).toBe('Shortened Long run on Thu 29 Oct from 60 min to 40 min.')
  })

  it('does not cite the rule twice', () => {
    const cited = session('c', THU, 'easy', 60, { rules: ['F-lib', 'g-6'] })
    const result = check(cited, { type: 'shorten', durationMin: 45 }, [cited])
    expect(result.edits[0]!.patch.rules).toEqual(['F-lib', 'g-6'])
  })

  it('never lengthens: more minutes are refused, the same minutes change nothing', () => {
    const longer = check(long, { type: 'shorten', durationMin: 61 }, [long])
    expect(codes(longer)).toEqual(['not-shorter'])
    expect(longer.guards[0]!.message).toBe(
      'Shortening only makes a session shorter. Nothing is added to it or to another day.',
    )
    expect(longer).toMatchObject({ allowed: false, edits: [] })
    expect(check(long, { type: 'shorten', durationMin: 60 }, [long])).toMatchObject({
      allowed: true,
      noop: true,
      edits: [],
    })
  })

  it('never goes below the smallest run the guards leave, and offers the skip', () => {
    const smallest = minSize(long)
    expect(smallest).toBe(P.fplace.easyRunMinMin.value)
    expect(check(long, { type: 'shorten', durationMin: smallest }, [long]).allowed).toBe(true)
    const below = check(long, { type: 'shorten', durationMin: smallest - 1 }, [long])
    expect(codes(below)).toEqual(['below-minimum'])
    expect(below.guards[0]).toMatchObject({
      message: 'A run under 20 min is not worth scheduling. Skip it instead.',
      rules: ['F5'],
      suggest: { label: 'Skip it instead', adjustment: { type: 'skip' } },
    })
    // a run already under the session minimum may go to the run day minimum
    const short = session('sh', THU, 'easy', 18)
    expect(
      check(short, { type: 'shorten', durationMin: P.fplace.minRunDayMin.value }, [short]).allowed,
    ).toBe(true)
    expect(
      check(short, { type: 'shorten', durationMin: P.fplace.minRunDayMin.value - 1 }, [short])
        .allowed,
    ).toBe(false)
  })

  it('shortens only runs', () => {
    for (const kind of ['strength', 'mobility', 'hike', 'rest', 'cross'] as SessionKind[]) {
      const target = session('t', THU, kind, 60)
      const result = check(target, { type: 'shorten', durationMin: 30 }, [target])
      expect(codes(result), kind).toEqual(['not-shortenable'])
    }
    const race = session('race', SAT, 'race', 180)
    expect(codes(check(race, { type: 'shorten', durationMin: 90 }, [race]))).toEqual(['race-day'])
  })

  it('keeps day 2 of a back-to-back pair within what day 1 allows', () => {
    const day1 = session('d1', FRI, 'b2b', 120, { flags: ['b2b-day1'] })
    const day2 = session('d2', SAT, 'b2b', 100, { flags: ['b2b-day2'] })
    const ratio = P.h3.b2bDay2MaxRatioOfDay1.value
    const fits = Math.ceil(100 / ratio)
    expect(check(day1, { type: 'shorten', durationMin: fits }, [day1, day2]).allowed).toBe(true)
    const result = check(day1, { type: 'shorten', durationMin: fits - 1 }, [day1, day2])
    expect(codes(result)).toEqual(['b2b-pair'])
    expect(result.guards[0]!.message).toBe(
      'Day 2 of the pair would be longer than day 1 allows (rule H3).',
    )
    // day 2 itself can be shortened
    expect(check(day2, { type: 'shorten', durationMin: 60 }, [day1, day2]).allowed).toBe(true)
  })

  it('shortens a session already moved or shortened, and the status becomes adjusted', () => {
    const moved = session('m', THU, 'easy', 60, { status: 'moved' })
    expect(check(moved, { type: 'shorten', durationMin: 40 }, [moved]).edits[0]!.patch.status).toBe(
      'adjusted',
    )
    const adjusted = session('a', THU, 'easy', 40, { status: 'adjusted' })
    expect(check(adjusted, { type: 'shorten', durationMin: 30 }, [adjusted]).allowed).toBe(true)
  })

  it('refuses a session that is not shortenable at all before it looks at the minutes', () => {
    const linked = session('l', THU, 'easy', 60, { activityId: 'a1', status: 'completed' })
    expect(codes(check(linked, { type: 'shorten', durationMin: 90 }, [linked]))).toEqual(['linked'])
    const skipped = session('s', THU, 'easy', 60, { status: 'skipped' })
    expect(codes(check(skipped, { type: 'shorten', durationMin: 40 }, [skipped]))).toEqual([
      'skipped',
    ])
    const past = session('p', '2026-10-20', 'easy', 60)
    expect(codes(check(past, { type: 'shorten', durationMin: 40 }, [past]))).toEqual([
      'past-session',
    ])
  })
})

describe('skip and restore', () => {
  const easy = session('easy', TUE, 'easy', 40)

  it('skips a session and keeps the first plan', () => {
    const result = check(easy, { type: 'skip' }, [easy])
    expect(result.edits).toEqual([
      { sessionId: 'easy', patch: { status: 'skipped' }, remember: true },
    ])
    expect(result.changes).toEqual([
      { weekStart: WEEK, field: 'session.status', from: 'planned', to: 'skipped', rules: ['g-6'] },
    ])
    expect(result.summary).toBe('Skipped Easy run on Tue 27 Oct.')
  })

  it('changes nothing for a skipped session, and restores only a skipped one', () => {
    const skipped = session('easy', TUE, 'easy', 40, { status: 'skipped' })
    expect(check(skipped, { type: 'skip' }, [skipped]).noop).toBe(true)
    expect(check(easy, { type: 'restore' }, [easy]).noop).toBe(true)
  })

  it('refuses to skip the race, a linked session and a done session', () => {
    const race = session('race', SAT, 'race', 180)
    const skip = check(race, { type: 'skip' }, [race])
    expect(codes(skip)).toEqual(['race-day'])
    expect(skip.guards[0]!.message).toBe('The race day cannot be skipped.')
    const linked = session('l', TUE, 'easy', 40, { activityId: 'a1', status: 'completed' })
    expect(codes(check(linked, { type: 'skip' }, [linked]))).toEqual(['linked'])
    const done = session('d', TUE, 'easy', 40, { status: 'partial' })
    expect(codes(check(done, { type: 'skip' }, [done]))).toEqual(['settled'])
  })

  it('can skip a session in the past, as a session that was not run', () => {
    const past = session('p', '2026-10-20', 'easy', 40)
    expect(check(past, { type: 'skip' }, [past]).allowed).toBe(true)
  })

  it('restores to the status that keeps what the runner changed', () => {
    const spec: NonNullable<PlanSession['original']> = { date: TUE, kind: 'easy', durationMin: 40 }
    const status = (over: Partial<PlanSession>, original: PlanSession['original']) => {
      const skipped = session('s', TUE, 'easy', 40, { status: 'skipped', original, ...over })
      return check(skipped, { type: 'restore' }, [skipped]).edits[0]!.patch.status
    }
    expect(status({}, null)).toBe('planned')
    expect(status({}, spec)).toBe('planned')
    expect(status({}, { ...spec, date: MON })).toBe('moved')
    expect(status({}, { ...spec, kind: 'long' })).toBe('moved')
    expect(status({ durationMin: 30 }, spec)).toBe('adjusted')
    expect(status({ durationMin: 30, rules: ['F-lib', 'design-4.3'] }, spec)).toBe('downgraded')
    const restored = check(
      session('s', TUE, 'easy', 40, { status: 'skipped' }),
      { type: 'restore' },
      [session('s', TUE, 'easy', 40, { status: 'skipped' })],
    )
    expect(restored.edits).toEqual([
      { sessionId: 's', patch: { status: 'planned' }, remember: false },
    ])
    expect(restored.summary).toBe('Restored Easy run on Tue 27 Oct.')
    expect(restored.changes).toEqual([
      { weekStart: WEEK, field: 'session.status', from: 'skipped', to: 'planned', rules: ['g-6'] },
    ])
  })

  it('checks the day again: a skipped run does not come back onto a day that has a run', () => {
    const skipped = session('s', TUE, 'easy', 40, { status: 'skipped' })
    const other = session('o', TUE, 'recovery', 30, { order: 1 })
    expect(codes(check(skipped, { type: 'restore' }, [skipped, other]))).toEqual(['one-run-a-day'])
  })
})

describe('the guards as copy', () => {
  it('lists guards that refuse before those that warn, each with a fixed message and its rules', () => {
    const target = session('long', SAT, 'long', 130, { status: 'skipped' })
    const hills = session('hl', FRI, 'hills', 40)
    const completedRuns = [run('2026-10-12', 60)]
    const result = check(target, { type: 'restore' }, [target, hills], {
      completedRuns,
      weekTargetMin: 60,
    })
    expect(result.guards.map((g) => g.effect)).toEqual(
      [...result.guards.map((g) => g.effect)].sort(),
    )
    expect(blocking(result).length).toBeGreaterThan(0)
    for (const guard of result.guards) {
      expect(guard.message).toMatch(/\.$/)
      expect(guard.message.length).toBeLessThanOrEqual(160)
      expect(lintText(guard.message), guard.message).toEqual([])
    }
  })

  it('never uses a word the product avoids', () => {
    // every message the cases above produced, plus the suggestion labels, through the G5 lint
    const messages: string[] = []
    const all: Array<[PlanSession, PlanAdjustment, PlanSession[], Partial<AdjustContext>]> = []
    const skipped = session('long', SAT, 'long', 130, { status: 'skipped' })
    all.push([
      skipped,
      { type: 'restore' },
      [skipped],
      { completedRuns: [run('2026-10-12', 60)], weekTargetMin: 10 },
    ])
    const easy = session('easy', TUE, 'easy', 40)
    all.push([easy, { type: 'shorten', durationMin: 5 }, [easy], {}])
    all.push([
      easy,
      { type: 'move', date: FRI },
      [easy],
      { dayRules: [rule(FRI, { maxRunMin: 30 })] },
    ])
    for (const [target, adjustment, sessions, over] of all) {
      const result = adjustCheck(target, adjustment, context(sessions, over))
      for (const guard of result.guards) {
        messages.push(guard.message)
        if (guard.suggest !== null) messages.push(guard.suggest.label)
      }
    }
    expect(messages.length).toBeGreaterThan(3)
    for (const message of messages) expect(lintText(message), message).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Plans the engine built
// ---------------------------------------------------------------------------------------------

function planSessions(plan: PlanDraft): PlanSession[] {
  return plan.sessions.map((s, i) => ({
    id: `s${String(i)}`,
    externalId: `e${String(i)}`,
    planId: 'p1',
    weekStart: mondayOf(s.date),
    ...s,
    status: 'planned',
    activityId: null,
    linkSource: null,
    execution: null,
    original: null,
    updatedAt: '2026-10-21T00:00:00.000Z',
  }))
}

function contextOf(
  athlete: MatrixAthlete,
  plan: PlanDraft,
  sessions: PlanSession[],
  weekStart: string,
): AdjustContext {
  const state = estimateState(athlete.input)
  return {
    today: TODAY,
    availability: athlete.input.profile.availability,
    sessions,
    weekTargetMin: plan.weeks.find((w) => w.weekStart === weekStart)?.targetRunMin ?? null,
    dayRules: [],
    completedRuns: completedReference(athlete.input.activities, state).runs,
    injuryTight: injuryTight(state),
  }
}

describe.each(athletes())('the plan of $id', (athlete) => {
  const plan = buildPlan(athlete.input)
  const sessions = planSessions(plan)
  const future = sessions.filter((s) => s.date >= TODAY && s.kind !== 'race')

  it('can skip any session and restore it: the engine’s own arrangement passes its guards', () => {
    expect(future.length).toBeGreaterThan(0)
    for (const target of future) {
      const skip = adjustCheck(
        target,
        { type: 'skip' },
        contextOf(athlete, plan, sessions, target.weekStart),
      )
      expect(skip.allowed, `${target.date} ${target.kind}`).toBe(true)
      const skippedSessions = sessions.map((s) =>
        s.id === target.id ? { ...s, status: 'skipped' as const } : s,
      )
      const restore = adjustCheck(
        skippedSessions.find((s) => s.id === target.id)!,
        { type: 'restore' },
        contextOf(athlete, plan, skippedSessions, target.weekStart),
      )
      expect(blocking(restore), `${target.date} ${target.kind}`).toEqual([])
      expect(restore.edits[0]!.patch.status).toBe('planned')
    }
  })

  it('shortens any run to every length from its smallest to one minute under, exactly', () => {
    for (const target of future.filter((s) => VOLUME_KINDS.has(s.kind))) {
      const ctx = contextOf(athlete, plan, sessions, target.weekStart)
      const smallest = minSize(target)
      for (let min = smallest; min < target.durationMin; min += 1) {
        const result = adjustCheck(target, { type: 'shorten', durationMin: min }, ctx)
        if (target.flags.includes('b2b-day1')) continue
        expect(result.allowed, `${target.date} ${target.kind} to ${String(min)}`).toBe(true)
        const [edit] = result.edits
        expect(result.edits).toHaveLength(1)
        expect(edit!.sessionId).toBe(target.id)
        expect(edit!.patch.durationMin).toBe(min)
        expect(edit!.patch.status).toBe('adjusted')
        if (target.distanceM !== null)
          expect(edit!.patch.distanceM!).toBeLessThanOrEqual(target.distanceM)
        if (target.gainM !== null) expect(edit!.patch.gainM!).toBeLessThanOrEqual(target.gainM)
        const seconds = (steps: Step[]) =>
          steps.reduce((n, s) => n + (s.durationSec ?? 0) * s.reps, 0)
        expect(seconds(edit!.patch.structure!)).toBeLessThanOrEqual(seconds(target.structure))
      }
      if (smallest > 1) {
        expect(
          adjustCheck(target, { type: 'shorten', durationMin: smallest - 1 }, ctx).allowed,
        ).toBe(false)
      }
      expect(
        adjustCheck(target, { type: 'shorten', durationMin: target.durationMin + 1 }, ctx).allowed,
      ).toBe(false)
    }
  })

  it('moves a session to its own day as no change and never edits another session', () => {
    for (const target of future) {
      const ctx = contextOf(athlete, plan, sessions, target.weekStart)
      expect(adjustCheck(target, { type: 'move', date: target.date }, ctx)).toMatchObject({
        allowed: true,
        noop: true,
      })
      const moves = [0, 1, 2, 3, 4, 5, 6].map((i) =>
        adjustCheck(target, { type: 'move', date: addDays(target.weekStart, i) }, ctx),
      )
      for (const result of moves) {
        if (!result.allowed || result.noop) continue
        expect(result.edits.map((e) => e.sessionId)).toEqual([target.id])
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// `adjusted` is a status the readers know
// ---------------------------------------------------------------------------------------------

describe('adjusted is still to run for every reader of a status', () => {
  const STILL_TO_RUN: Record<PlanSessionStatus, boolean> = {
    planned: true,
    moved: true,
    downgraded: true,
    adjusted: true,
    completed: false,
    partial: false,
    skipped: false,
  }
  const statuses = Object.keys(STILL_TO_RUN) as PlanSessionStatus[]
  const ladder = replayLadder({
    settings: { optIn90: true, optInAdvanced: true, giDisease: false },
    runs: [],
    gutTrainingWeeks: [],
  })

  // Every pure reader of `PlanSession.status` that decides "still to be run", with the question it
  // asks. The server readers are tested through the API: the workout download, Today's next
  // session and the re-plan in tests/api/adjusted.test.ts, the calendar feed in
  // tests/api/calendarFeed.test.ts and the fuel targets in tests/api/fuelLab.test.ts. The wrist
  // status route (the 'not-sent' item, server/services/publish.ts) has no case with an adjusted
  // session in tests/api/wristRoutes.test.ts yet. A reader added later joins this list.
  const readers: Array<{ name: string; reads: (status: PlanSessionStatus) => boolean }> = [
    { name: 'isToRun', reads: (status) => isToRun(status) },
    {
      // an activity on the next day links only to a session still to run
      name: 'matchSessions, adjacent day (shared/engine/execution.ts)',
      reads: (status) => {
        const spec = session('m', THU, 'easy', 40, { status })
        const linked = matchSessions(
          [{ ...spec, activityId: null, linkSource: null }],
          [activity(FRI, { id: 'a1', durationSec: 40 * 60, distanceM: 6000 })],
        )
        return linked.length === 1
      },
    },
    {
      // a past day with no run logged reads "planned, no run logged" only for a session to run
      name: 'weekStrip, past day (shared/domain/weekStrip.ts)',
      reads: (status) => {
        const past = '2026-10-19'
        const strip = weekStrip({
          today: TODAY,
          sessions: [session('w', past, 'easy', 40, { status, weekStart: past })],
          activities: [],
          targetRunMin: null,
        })
        return strip.days.find((d) => d.date === past)!.mark === 'unlogged'
      },
    },
    {
      name: 'fuelTargetFor (shared/engine/fuel.ts)',
      reads: (status) =>
        fuelTargetFor(
          {
            settings: { optIn90: true, optInAdvanced: true, giDisease: false },
            ladder,
            peaks: {},
          },
          { id: 'f', date: THU, kind: 'long', durationMin: 150, flags: [], status },
        ) !== null,
    },
  ]

  it.each(readers)('$name reads each status as isToRun does', ({ reads }) => {
    for (const status of statuses) expect(reads(status), status).toBe(STILL_TO_RUN[status])
  })

  it('a re-plan keeps a shortened session in the next 14 days as it keeps a moved one (keptByReplan)', () => {
    const next = { date: addDays(TODAY, 7), rules: [] }
    expect(keptByReplan({ ...next, status: 'adjusted' }, TODAY)).toBe(true)
    expect(keptByReplan({ ...next, status: 'moved' }, TODAY)).toBe(true)
    expect(keptByReplan({ ...next, status: 'planned' }, TODAY)).toBe(false)
    // beyond the keep window it is planned again, as a moved one is
    const far = { date: addDays(TODAY, P.macroDesign.keepOwnerEditsDays.value), rules: [] }
    expect(keptByReplan({ ...far, status: 'adjusted' }, TODAY)).toBe(
      keptByReplan({ ...far, status: 'moved' }, TODAY),
    )
  })
})

describe('the shorten builder', () => {
  it('returns null unless the minutes are fewer', () => {
    const spec = session('s', THU, 'easy', 60)
    expect(shortenedSession(spec, 60)).toBeNull()
    expect(shortenedSession(spec, 75)).toBeNull()
    expect(shortenedSession(spec, 59)?.durationMin).toBe(59)
  })

  it('does not change the session it is given', () => {
    const spec = session('s', THU, 'easy', 60, { distanceM: 9000 })
    const before = JSON.stringify(spec)
    shortenedSession(spec, 30)
    expect(JSON.stringify(spec)).toBe(before)
  })
})

afterAll(() => {
  // Every code of the guard list was reached by a case above.
  const all: Record<AdjustGuardCode, true> = {
    'race-day': true,
    'past-session': true,
    linked: true,
    settled: true,
    skipped: true,
    'not-shortenable': true,
    'other-week': true,
    'past-date': true,
    'no-partner': true,
    'partner-unavailable': true,
    'not-shorter': true,
    'below-minimum': true,
    'b2b-pair': true,
    'closed-day': true,
    'day-limit': true,
    'one-run-a-day': true,
    'hard-spacing': true,
    'long-run-between': true,
    'rest-window': true,
    'quiet-day': true,
    'day-cap': true,
    spike: true,
    'weekly-cap': true,
  }
  const missing = (Object.keys(all) as AdjustGuardCode[]).filter((code) => !seen.has(code))
  expect(missing).toEqual([])
})
