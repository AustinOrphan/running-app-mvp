// The facts of the Monday brief (phase 3a design 8.5, 8.8): pure and deterministic, a cause on every
// change, at most four noticed facts with the sources they rest on, a key session picked from the
// sessions still to run with the resolver's targets, and a prediction line that waits for two
// weekly estimates a week apart.
import { describe, expect, test } from 'vitest'
import { BRIEF_MAX_NOTICED, KEY_LOOKAHEAD_DAYS } from '../../../shared/copy/limits.ts'
import { renderFact } from '../../../shared/copy/templates.ts'
import { addDays } from '../../../shared/dates.ts'
import {
  BRIEF_VERSION,
  buildBriefFacts,
  isKeyKind,
  keySessionFacts,
  pickKeySession,
} from '../../../shared/engine/brief.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type { BriefFacts, EngineInput, SessionKind } from '../../../shared/engine/types.ts'
import { roundEstimateSec } from '../../../shared/units.ts'
import { activity } from './e8-fixtures.ts'
import {
  briefArgs,
  checkin,
  decisionOf,
  emptyDiff,
  GOAL,
  LAST_MONDAY,
  mixedDiff,
  MONDAY,
  plan,
  revisionOf,
  runnerInput,
} from './brief-fixtures.ts'
import { SESSION_KINDS, zoneSetFixture } from './fixtures.ts'

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/** Every string in a value, with the path it was found at. */
function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value))
    return value.flatMap((item, i) => strings(item, `${path}[${String(i)}]`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => strings(child, `${path}.${key}`))
  }
  return []
}

const kindsOf = (facts: BriefFacts): string[] =>
  facts.noticed.map((fact) => fact.id.slice(fact.id.indexOf('.') + 1))

/** A run on a day of last week. */
const lastWeekRun = (dayOfWeek: number, over: Parameters<typeof activity>[1] = {}) =>
  activity(addDays(LAST_MONDAY, dayOfWeek), { id: `last-${String(dayOfWeek)}`, ...over })

// ---------------------------------------------------------------------------------------------

describe('buildBriefFacts', () => {
  test('is deterministic, leaves its arguments alone and returns plain data', () => {
    const args = briefArgs({
      decision: decisionOf('hold', ['sleep-warning', 'subjective-decline']),
      revision: revisionOf(mixedDiff()),
      predictions: [
        { weekStart: MONDAY, predictedSec: 7500 },
        { weekStart: LAST_MONDAY, predictedSec: 7620 },
      ],
    })
    const frozen = deepFreeze(args)
    const first = buildBriefFacts(frozen)
    const second = buildBriefFacts(frozen)
    expect(second).toStrictEqual(first)
    // nothing undefined, no function, no date object: it survives the JSON column unchanged
    expect(JSON.parse(JSON.stringify(first))).toStrictEqual(first)
    expect(first.weekStart).toBe(MONDAY)
    expect(BRIEF_VERSION).toBe(1)
  })

  test('stores codes, template ids and slots, never a sentence', () => {
    const facts = buildBriefFacts(
      briefArgs(
        {
          decision: decisionOf('reduce', ['sleep-warning']),
          revision: revisionOf(mixedDiff()),
        },
        {
          wellness: [checkin(2, { painScore: 4 }), checkin(3, { illness: true })],
          activities: [...runnerInput().activities, lastWeekRun(5, { distanceM: 21_000 })],
        },
      ),
    )
    expect(facts.noticed.length).toBeGreaterThan(0)
    // the goal's name is the runner's own words; a source's label is the kind of record
    const free = strings(facts).filter(
      ([path, value]) => !path.endsWith('.name') && !path.endsWith('.label') && value !== '',
    )
    for (const [path, value] of free) expect(value, path).toMatch(/^[\w.-]+$/)
    // every slot of a fact is a quantity, so no sentence hides in a text slot
    for (const fact of facts.noticed) {
      for (const [name, slot] of Object.entries(fact.slots)) {
        expect(typeof slot, `${fact.id} ${name}`).toBe('object')
      }
    }
  })

  test('states last week as minutes run and planned, and nothing when there is nothing to say', () => {
    const planned = runnerInput({
      existing: plan(4),
      activities: [
        ...runnerInput().activities,
        lastWeekRun(1, { durationSec: 40 * 60, movingSec: 40 * 60 }),
      ],
    })
    // the plan covers only this week and after: last week had no plan, but a run was logged
    expect(buildBriefFacts(briefArgs({}, { activities: planned.activities })).lastWeek).toEqual({
      weekStart: LAST_MONDAY,
      ranMin: 210 + 40,
      plannedMin: null,
    })
    // a plan that started a week early plans last week
    const early = plan(5).weeks.map((week, i) => ({
      ...week,
      weekStart: addDays(LAST_MONDAY, 7 * i),
    }))
    const sessions = plan(5).sessions.map((session) => ({
      ...session,
      date: addDays(session.date, -7),
    }))
    const withPlan = buildBriefFacts(briefArgs({}, { existing: { weeks: early, sessions } }))
    expect(withPlan.lastWeek).toMatchObject({ weekStart: LAST_MONDAY, ranMin: 210 })
    expect(withPlan.lastWeek?.plannedMin).toBe(45 + 50 + 90 + 45)
    // no run and no plan for last week: the brief does not open with a nothing
    const none = buildBriefFacts(briefArgs({}, { activities: [] }))
    expect(none.lastWeek).toBeNull()
  })

  test('does not state zero planned minutes: a week planned at nothing reads as unplanned', () => {
    // A plan that started a week early whose first week is the rest after a race: target 0, no run.
    const early = plan(5, [{ targetRunMin: 0 }]).weeks.map((week, i) => ({
      ...week,
      weekStart: addDays(LAST_MONDAY, 7 * i),
    }))
    const sessions = plan(5)
      .sessions.map((session) => ({ ...session, date: addDays(session.date, -7) }))
      .filter((session) => session.date >= MONDAY)
    const existing = { weeks: early, sessions }
    // the runner jogged anyway: the week is stated by what was run
    const jogged = buildBriefFacts(briefArgs({}, { existing }))
    expect(jogged.lastWeek).toEqual({ weekStart: LAST_MONDAY, ranMin: 210, plannedMin: null })
    // nothing run and nothing planned: no last week at all
    expect(buildBriefFacts(briefArgs({}, { existing, activities: [] })).lastWeek).toBeNull()
  })

  test('states the weekly decision, and none after a note that the update did not run', () => {
    const ran = buildBriefFacts(briefArgs({ decision: decisionOf('hold', [], 210) }))
    expect(ran.decision).toEqual({ kind: 'hold', nextWeekTargetMin: 210 })
    for (const kind of ['progress', 'reduce'] as const) {
      expect(buildBriefFacts(briefArgs({ decision: decisionOf(kind) })).decision?.kind).toBe(kind)
    }
    const postRace = {
      ...decisionOf('hold'),
      postRace: {
        label: 'After the race, step 2 of 3',
        phase: 'step' as const,
        step: 2,
        steps: 3,
        holdUntil: addDays(MONDAY, -10),
        quietUntil: addDays(MONDAY, 4),
        extensionDays: 0,
      },
    }
    expect(buildBriefFacts(briefArgs({ decision: postRace })).decision?.kind).toBe('post-race')
    expect(buildBriefFacts(briefArgs({})).decision).toBeNull()
    // an update that did not run made no decision the brief can state
    for (const replan of ['goal-passed', 'checklist', 'no-plan', 'not-run', 'error'] as const) {
      const failed = buildBriefFacts(briefArgs({ decision: decisionOf('hold'), replan }))
      expect(failed.decision).toBeNull()
      expect(failed.replan).toBe(replan)
      expect(failed.changes).toBeNull()
    }
  })
})

describe('the changes of the update', () => {
  test('give every change at least one cause and count a moved session once', () => {
    const facts = buildBriefFacts(briefArgs({ revision: revisionOf(mixedDiff()) }))
    const changes = facts.changes!
    // a week line, a hold, a session changed in place and a session moved from Thursday to Friday
    expect(changes.lines.map((line) => line.type).sort()).toEqual([
      'changed',
      'hold',
      'moved',
      'week',
    ])
    expect(changes.count).toBe(2)
    for (const line of changes.lines) expect(line.causes.length, line.type).toBeGreaterThan(0)
    expect(changes.lines.find((line) => line.type === 'hold')?.causes).toEqual(['disruption'])
    expect(changes.runMinBefore).toBe(240)
    expect(changes.runMinAfter).toBe(220)
  })

  test('name the plan reading new figures when the revision gave a line no cause', () => {
    const facts = buildBriefFacts(
      briefArgs({ revision: { diff: mixedDiff(), causes: { sessions: {}, weeks: {} } } }),
    )
    const session = facts.changes!.lines.filter((line) => line.type === 'changed')
    expect(session.map((line) => line.causes)).toEqual([['state-update']])
    const noCauses = buildBriefFacts(briefArgs({ revision: { diff: mixedDiff(), causes: null } }))
    for (const line of noCauses.changes!.lines.filter((l) => l.type !== 'hold')) {
      expect(line.causes).toEqual(['state-update'])
    }
  })

  test('are empty for a quiet week, and absent without a revision', () => {
    expect(buildBriefFacts(briefArgs({ revision: revisionOf(emptyDiff()) })).changes).toEqual({
      count: 0,
      lines: [],
      runMinBefore: 0,
      runMinAfter: 0,
    })
    expect(
      buildBriefFacts(briefArgs({ revision: { diff: null, causes: null } })).changes?.count,
    ).toBe(0)
    expect(buildBriefFacts(briefArgs({})).changes).toBeNull()
  })
})

describe('what the plan noticed', () => {
  test('is empty for an ordinary week', () => {
    expect(buildBriefFacts(briefArgs({})).noticed).toEqual([])
  })

  test('puts pain first with the check-in or run it rests on, and tells mild pain from pain at the flag', () => {
    const flag = P.pain.flagScore.value
    const hard = buildBriefFacts(briefArgs({}, { wellness: [checkin(2, { painScore: flag + 1 })] }))
    expect(hard.noticed).toHaveLength(1)
    const fact = hard.noticed[0]!
    expect(fact).toMatchObject({
      id: 'n-2.pain',
      template: 'brief.noticed-pain',
      rule: 'n-2',
      state: 'used',
      window: { from: LAST_MONDAY, to: addDays(MONDAY, -1) },
    })
    expect(fact.slots.pain).toEqual({ kind: 'count', n: flag + 1 })
    expect(fact.sources).toEqual([
      {
        kind: 'check-in',
        id: addDays(LAST_MONDAY, 2),
        date: addDays(LAST_MONDAY, 2),
        label: 'Check-in',
      },
    ])
    // the run's own rating counts too, and the worst figure names its day
    const onRun = buildBriefFacts(
      briefArgs({}, { activities: [...runnerInput().activities, lastWeekRun(3, { pain: flag })] }),
    )
    expect(onRun.noticed[0]).toMatchObject({ id: 'n-2.pain' })
    expect(onRun.noticed[0]!.sources[0]).toMatchObject({
      kind: 'activity',
      date: addDays(LAST_MONDAY, 3),
    })
    const mild = buildBriefFacts(briefArgs({}, { wellness: [checkin(2, { painScore: 1 })] }))
    expect(mild.noticed[0]).toMatchObject({
      id: 'n-2.pain-mild',
      template: 'brief.noticed-pain-mild',
    })
    // focal bone pain is its own sentence, whatever the score
    const bone = buildBriefFacts(
      briefArgs(
        {},
        { wellness: [checkin(1, { painScore: 2 }), checkin(4, { painFocalBone: true })] },
      ),
    )
    expect(bone.noticed[0]).toMatchObject({ id: 'n-1.pain-bone', rule: 'n-1' })
    expect(bone.noticed[0]!.slots.date).toMatchObject({ iso: addDays(LAST_MONDAY, 4) })
    // a week before last does not count
    const old = buildBriefFacts(briefArgs({}, { wellness: [checkin(-3, { painScore: flag + 2 })] }))
    expect(old.noticed).toEqual([])
  })

  test('reports illness on its day, and the energy-availability screen at the count that holds progression', () => {
    const ill = buildBriefFacts(briefArgs({}, { wellness: [checkin(4, { illness: true })] }))
    expect(ill.noticed[0]).toMatchObject({ id: 'n-3.illness', rule: 'n-3' })
    expect(ill.noticed[0]!.slots.date).toMatchObject({ iso: addDays(LAST_MONDAY, 4) })
    const flags = P.j5.redsHoldFlags.value
    expect(buildBriefFacts(briefArgs({}, { screeningFlags: flags - 1 })).noticed).toEqual([])
    const reds = buildBriefFacts(briefArgs({}, { screeningFlags: flags }))
    expect(reds.noticed[0]).toMatchObject({ id: 'n-4.reds', rule: 'n-4' })
    expect(reds.noticed[0]!.slots.n).toEqual({ kind: 'count', n: flags })
  })

  test('takes what the weekly decision acted on from its signals', () => {
    const facts = (codes: string[], inputOver: Partial<EngineInput> = {}) =>
      buildBriefFacts(briefArgs({ decision: decisionOf('hold', codes) }, inputOver))
    expect(kindsOf(facts(['persistent-suppression']))).toEqual(['readiness-low'])
    expect(facts(['persistent-suppression']).noticed[0]!.slots.days).toEqual({
      kind: 'count',
      n: P.j8.deloadSuggestDays.value,
    })
    expect(kindsOf(facts(['readiness-flag']))).toEqual(['readiness-flag'])
    // a signal the brief has no sentence for, and the completion the headline states, add nothing
    expect(facts(['completion-low', 'post-race-stage', 'heat', 'disruption']).noticed).toEqual([])

    // sleep needs the nights it was read from; the sentence restates the Params
    const sleepy = Array.from({ length: P.j5.sleepWarnNights.value }, (_, i) =>
      checkin(6 - i, { sleepSec: Math.round((P.j5.sleepWarnHours.value - 1) * 3600) }),
    )
    const sleep = facts(['sleep-warning'], { wellness: sleepy })
    expect(kindsOf(sleep)).toEqual(['sleep'])
    expect(sleep.noticed[0]!.slots).toMatchObject({
      nights: { kind: 'count', n: P.j5.sleepWarnNights.value },
      floor: { kind: 'duration', sec: P.j5.sleepWarnHours.value * 3600 },
    })
    expect(facts(['sleep-warning']).noticed).toEqual([])

    // low check-ins are the sources of the subjective-decline sentence
    const low = { fatigue: 5, soreness: 5, stress: 5, sleepQuality: 1, mood: 1 }
    const subjective = facts(['subjective-decline'], {
      wellness: [checkin(2, low), checkin(3, low), checkin(4, { fatigue: 3 })],
    })
    expect(subjective.noticed[0]).toMatchObject({ id: 'j2.subjective' })
    expect(subjective.noticed[0]!.sources.map((s) => s.date).sort()).toEqual([
      addDays(LAST_MONDAY, 2),
      addDays(LAST_MONDAY, 3),
    ])
  })

  test('says so when efficiency moved by the size the weekly decision acts on', () => {
    const size = P.j5.efficiencyDeclinePct.value
    const withTrend = (trendPct: number | null) => {
      const args = briefArgs({})
      return buildBriefFacts({
        ...args,
        state: { ...args.state, efficiency: { current: 1.1, trendPct, samples: 6 } },
      })
    }
    expect(withTrend(null).noticed).toEqual([])
    expect(withTrend(size - 0.1).noticed).toEqual([])
    expect(withTrend(-(size - 0.1)).noticed).toEqual([])
    const down = withTrend(-(size + 2.04))
    expect(down.noticed[0]).toMatchObject({
      id: 'a8.efficiency',
      template: 'brief.noticed-efficiency-down',
    })
    expect(down.noticed[0]!.slots.pct).toEqual({ kind: 'percent', pct: size + 2 })
    const up = withTrend(size + 2.04)
    expect(up.noticed[0]).toMatchObject({ template: 'brief.noticed-efficiency-up' })
  })

  test('names the longest run of the look-back when last week held it, by distance and else by time', () => {
    const base = runnerInput().activities
    const weeks = P.standout.longestLookbackWeeks.value
    // the longest of the loaded runs is 12.8 km; last week's 15 km run beats it
    const far = buildBriefFacts(
      briefArgs({}, { activities: [...base, lastWeekRun(5, { id: 'big', distanceM: 15_000 })] }),
    )
    const fact = far.noticed.find((f) => f.id === 'a3.longest')!
    expect(fact.template).toBe('brief.noticed-longest-distance')
    expect(fact.slots).toMatchObject({
      distance: { kind: 'distance', m: 15_000 },
      date: { iso: addDays(LAST_MONDAY, 5) },
      weeks: { kind: 'count', n: weeks },
    })
    expect(fact.sources).toHaveLength(2)
    expect(fact.sources[0]).toMatchObject({ kind: 'activity' })
    expect(fact.window?.to).toBe(addDays(MONDAY, -1))
    // no distance on the run: it is the longest by time
    const long = buildBriefFacts(
      briefArgs(
        {},
        {
          activities: [
            ...base,
            lastWeekRun(5, {
              id: 'long',
              distanceM: null,
              durationSec: 4 * 3600,
              movingSec: 4 * 3600,
            }),
          ],
        },
      ),
    )
    expect(long.noticed.find((f) => f.id === 'a3.longest')?.template).toBe(
      'brief.noticed-longest-duration',
    )
    // a tie is not a record, and the usual week holds none
    const tied = buildBriefFacts(
      briefArgs({}, { activities: [...base, lastWeekRun(5, { id: 'same', distanceM: 12_800 })] }),
    )
    expect(tied.noticed.find((f) => f.id === 'a3.longest')).toBeUndefined()
    expect(buildBriefFacts(briefArgs({})).noticed).toEqual([])
    // runs from last week alone have nothing to be longer than
    const only = buildBriefFacts(
      briefArgs({}, { activities: [lastWeekRun(5, { distanceM: 30_000 })] }),
    )
    expect(only.noticed.find((f) => f.id === 'a3.longest')).toBeUndefined()
  })

  test('says where the plan stands in its calendar', () => {
    const week = (over: object, previous: object = {}) =>
      buildBriefFacts(briefArgs({ goal: GOAL }, { existing: plan(4, [over, previous]) }))
    expect(week({ isRecovery: true, flags: ['recovery'] }).noticed[0]).toMatchObject({
      id: 'e3.recovery-week',
      slots: { minutes: { kind: 'minutes', min: 230 } },
    })
    expect(week({ isTaper: true, flags: ['taper'] }).noticed[0]).toMatchObject({ id: 'k1.taper' })
    // only the first week of the taper begins it
    const second = buildBriefFacts(
      briefArgs(
        {},
        {
          existing: {
            ...plan(4),
            weeks: plan(4).weeks.map((w, i) =>
              i <= 1 ? { ...w, isTaper: true, flags: ['taper'] } : w,
            ),
          },
        },
      ),
    )
    expect(second.noticed.map((f) => f.id)).toEqual(['k1.taper'])
    const secondWeek = buildBriefFacts({
      ...briefArgs({}, { existing: plan(4) }),
      weekStart: addDays(MONDAY, 7),
      asOf: addDays(MONDAY, 7),
      input: runnerInput({
        today: addDays(MONDAY, 7),
        existing: {
          ...plan(4),
          weeks: plan(4).weeks.map((w, i) =>
            i <= 1 ? { ...w, isTaper: true, flags: ['taper'] } : w,
          ),
        },
      }),
    })
    expect(secondWeek.noticed.map((f) => f.id)).not.toContain('k1.taper')
    const race = week({ flags: ['race-week', 'taper'], isTaper: true })
    expect(race.noticed.map((f) => f.id)).toEqual(['k6.race-week', 'k1.taper'])
    expect(race.noticed[0]!.slots.date).toMatchObject({ iso: GOAL.date })
    // a week of the return after a race is the decision's, not the calendar's
    expect(week({ isRecovery: true, flags: ['recovery', 'post-race'] }).noticed).toEqual([])
    // nothing about the calendar without a plan
    expect(buildBriefFacts(briefArgs({}, { existing: null })).noticed).toEqual([])
  })

  test('shows at most four facts, safety first, each with its window and sources', () => {
    const flag = P.pain.flagScore.value
    const input: Partial<EngineInput> = {
      wellness: [checkin(1, { illness: true }), checkin(2, { painScore: flag + 1 })],
      screeningFlags: P.j5.redsHoldFlags.value,
      activities: [...runnerInput().activities, lastWeekRun(5, { id: 'big', distanceM: 21_000 })],
      existing: plan(4, [{ isRecovery: true, flags: ['recovery'] }]),
    }
    const args = briefArgs(
      { decision: decisionOf('reduce', ['persistent-suppression', 'readiness-flag']) },
      input,
    )
    const facts = buildBriefFacts(args)
    expect(BRIEF_MAX_NOTICED).toBe(4)
    expect(facts.noticed.map((f) => f.id)).toEqual([
      'n-2.pain',
      'n-3.illness',
      'n-4.reds',
      'j8.readiness-low',
    ])
    for (const fact of facts.noticed) {
      expect(fact.window, fact.id).toBeDefined()
      expect(fact.state).toBe('used')
    }
    // every fact renders as a sentence in both units (the templates exist and the slots fit)
    for (const fact of facts.noticed) {
      expect(renderFact(fact, 'km')).toBe(renderFact(fact, 'km'))
      expect(renderFact(fact, 'mi').length).toBeGreaterThan(10)
    }
    // dropping the leading ones lets the next in line in
    const calmer = buildBriefFacts({
      ...args,
      input: { ...args.input, wellness: [], screeningFlags: 0 },
    })
    expect(calmer.noticed.map((f) => f.id)).toEqual([
      'j8.readiness-low',
      'j3.readiness-flag',
      'a3.longest',
      'e3.recovery-week',
    ])
  })
})

describe('the key session', () => {
  const sessions = plan(2).sessions
  const at = (dayOfWeek: number) => addDays(MONDAY, dayOfWeek)

  test('is the first key session still to run within the look-ahead, today included', () => {
    expect(pickKeySession(sessions, MONDAY)?.kind).toBe('threshold')
    expect(pickKeySession(sessions, MONDAY)?.date).toBe(at(3))
    // on the day itself the session still counts; a day later it does not
    expect(pickKeySession(sessions, at(3))?.date).toBe(at(3))
    expect(pickKeySession(sessions, at(4))?.kind).toBe('long')
    // the look-ahead is KEY_LOOKAHEAD_DAYS days, today included
    expect(KEY_LOOKAHEAD_DAYS).toBe(7)
    const far = [{ ...sessions[2]!, date: at(KEY_LOOKAHEAD_DAYS), id: 'far' }]
    expect(pickKeySession(far, MONDAY)).toBeNull()
    expect(pickKeySession([{ ...far[0]!, date: at(KEY_LOOKAHEAD_DAYS - 1) }], MONDAY)?.id).toBe(
      'far',
    )
  })

  test('asks isToRun: a settled session is not next, a moved, trimmed or shortened one is', () => {
    const threshold = sessions.find((s) => s.kind === 'threshold')!
    const settle = (status: string) => sessions.map((s) => (s === threshold ? { ...s, status } : s))
    for (const status of ['completed', 'partial', 'skipped']) {
      expect(pickKeySession(settle(status), MONDAY)?.kind, status).toBe('long')
    }
    for (const status of ['planned', 'moved', 'downgraded', 'adjusted']) {
      expect(pickKeySession(settle(status), MONDAY)?.kind, status).toBe('threshold')
    }
  })

  test('ties on a day go by the plan order, easy running is no key session, and a race is one', () => {
    const day = at(2)
    const make = (id: string, kind: SessionKind, order: number) => ({
      ...sessions[0]!,
      id,
      kind,
      date: day,
      order,
    })
    expect(pickKeySession([make('b', 'intervals', 2), make('a', 'hills', 1)], MONDAY)?.id).toBe('a')
    const easy: SessionKind[] = [
      'easy',
      'recovery',
      'strides',
      'hike',
      'strength',
      'mobility',
      'rest',
      'cross',
    ]
    expect(
      pickKeySession(
        easy.map((kind, i) => make(`e${String(i)}`, kind, i)),
        MONDAY,
      ),
    ).toBeNull()
    expect(pickKeySession([make('r', 'race', 1)], MONDAY)?.kind).toBe('race')
    expect(SESSION_KINDS.filter(isKeyKind).sort()).toEqual(
      [
        'b2b',
        'hills',
        'intervals',
        'long',
        'long-fast-finish',
        'race',
        'race-pace',
        'threshold',
      ].sort(),
    )
  })

  test('carries the resolver’s targets, hot or not, for every kind', () => {
    const zones = zoneSetFixture()
    for (const kind of SESSION_KINDS) {
      for (const hot of [false, true]) {
        const session = { ...sessions[0]!, kind }
        const key = keySessionFacts(session, zones, hot, null)
        const t = resolveTargets(session, zones, { hot })
        expect(key.target, `${kind} hot=${String(hot)}`).toEqual({
          zone: t.zone,
          mode: t.mode,
          hrCeiling: t.hrCeiling,
          hrRange: t.hrRange,
          paceSecPerKm: t.paceSecPerKm,
          rpe: t.rpe,
          hot: t.hot,
        })
        expect(key).toMatchObject({
          sessionId: session.id,
          externalId: session.externalId,
          date: session.date,
          kind,
          durationMin: session.durationMin,
        })
      }
    }
    // hot weather puts effort first for a run and never for a strength day
    expect(keySessionFacts({ ...sessions[1]! }, zones, true, null).target.mode).toBe('effort')
    expect(
      keySessionFacts({ ...sessions[1]!, kind: 'strength' }, zones, true, null).target.hot,
    ).toBe(false)
  })

  test('is read through the forecast the caller supplies and stored with the facts', () => {
    const facts = buildBriefFacts(briefArgs({ isHot: (s) => s.kind === 'threshold' }))
    expect(facts.keySession).toMatchObject({
      kind: 'threshold',
      date: at(3),
      target: { mode: 'effort', hot: true },
    })
    expect(buildBriefFacts(briefArgs({})).keySession?.target.hot).toBe(false)
    // an easy week has none
    const easy = plan(1).sessions.filter((s) => !isKeyKind(s.kind))
    expect(
      buildBriefFacts(briefArgs({}, { existing: { weeks: plan(1).weeks, sessions: easy } }))
        .keySession,
    ).toBeNull()
  })
})

describe('the countdown and the prediction', () => {
  test('count the days to the goal race, and say nothing once it is over', () => {
    expect(buildBriefFacts(briefArgs({})).countdown).toEqual({
      name: GOAL.name,
      date: GOAL.date,
      days: 146,
    })
    expect(buildBriefFacts(briefArgs({ goal: null })).countdown).toBeNull()
    expect(
      buildBriefFacts(briefArgs({ goal: { name: 'Past', date: addDays(MONDAY, -1) } })).countdown,
    ).toBeNull()
    expect(
      buildBriefFacts(briefArgs({ goal: { name: 'Today', date: MONDAY } })).countdown?.days,
    ).toBe(0)
  })

  test('wait for this week’s estimate and last week’s, and round them as Today does', () => {
    const rows = (...entries: Array<[string, number]>) =>
      entries.map(([weekStart, predictedSec]) => ({ weekStart, predictedSec }))
    const line = (predictions: ReturnType<typeof rows>) =>
      buildBriefFacts(briefArgs({ predictions })).prediction
    expect(line([])).toBeNull()
    expect(line(rows([MONDAY, 7500]))).toBeNull()
    expect(line(rows([LAST_MONDAY, 7500]))).toBeNull()
    // two rows that are not a week apart are no comparison
    expect(line(rows([MONDAY, 7500], [addDays(MONDAY, -14), 7600]))).toBeNull()
    expect(line(rows([MONDAY, Number.NaN], [LAST_MONDAY, 7600]))).toBeNull()
    expect(line(rows([MONDAY, 7511], [LAST_MONDAY, 7629]))).toEqual({
      nowSec: roundEstimateSec(7511),
      priorSec: roundEstimateSec(7629),
    })
    expect(roundEstimateSec(7511)).toBe(7500)
  })
})

describe('the facts of a week', () => {
  test('are one shape whatever the week held', () => {
    const empty = buildBriefFacts(briefArgs({}, { activities: [], existing: null }))
    expect(Object.keys(empty).sort()).toEqual(
      [
        'asOf',
        'changes',
        'countdown',
        'decision',
        'keySession',
        'lastWeek',
        'noticed',
        'prediction',
        'replan',
        'weekStart',
      ].sort(),
    )
    expect(empty).toMatchObject({
      lastWeek: null,
      decision: null,
      replan: null,
      changes: null,
      noticed: [],
      keySession: null,
    })
  })
})
