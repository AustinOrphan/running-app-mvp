// The Monday brief as the page reads it (phase 3a design 8.6, 8.8): the sentences of the spec, the
// runner's units, the fallbacks, and fifty fuzzed weeks through the G5 lint. The facts of a fuzzed
// week come from `buildBriefFacts`, so the lint covers what the engine can actually write.
import { describe, expect, test } from 'vitest'
import {
  BRIEF_CAUSES_SHOWN,
  briefChanges,
  briefContext,
  briefHeadline,
  briefKeySession,
  briefKindName,
  briefNoticed,
  briefText,
  briefWeekLabel,
  renderBrief,
  renderBriefLine,
  renderedBriefTexts,
} from '../../../shared/copy/briefRender.ts'
import {
  BRIEF_KIND_IDS,
  BRIEF_REPLAN_IDS,
  BRIEF_TEMPLATES,
} from '../../../shared/copy/briefTemplates.ts'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy, lintText } from '../../../shared/copy/lint.ts'
import { addDays } from '../../../shared/dates.ts'
import { buildBriefFacts } from '../../../shared/engine/brief.ts'
import type {
  BriefFacts,
  EngineInput,
  SessionKind,
  WeeklyDecision,
} from '../../../shared/engine/types.ts'
import type { PlanDiff, PlanSessionStatus, Units } from '../../../shared/types.ts'
import { activity } from '../engine/e8-fixtures.ts'
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
} from '../engine/brief-fixtures.ts'
import { SESSION_KINDS } from '../engine/fixtures.ts'

const UNITS: readonly Units[] = ['km', 'mi']

/** The facts of the Monday of the spec: 212 of 240 planned minutes, a steady plan, 220 min next. */
function specFacts(over: Partial<BriefFacts> = {}): BriefFacts {
  return {
    weekStart: MONDAY,
    asOf: MONDAY,
    lastWeek: { weekStart: LAST_MONDAY, ranMin: 212, plannedMin: 240 },
    decision: { kind: 'hold', nextWeekTargetMin: 220 },
    replan: null,
    changes: { count: 0, lines: [], runMinBefore: 0, runMinAfter: 0 },
    noticed: [],
    keySession: null,
    countdown: null,
    prediction: null,
    ...over,
  }
}

describe('the headline', () => {
  test('cites last week and the decision as the spec words them', () => {
    expect(briefHeadline(specFacts(), 'km')).toEqual([
      'Last week you ran 212 of 240 planned minutes.',
      'The plan holds steady: next week is up to 220 min.',
    ])
  })

  test('has a sentence for each decision, with “eases” for a reduction', () => {
    const line = (kind: 'progress' | 'hold' | 'reduce' | 'post-race') =>
      briefHeadline(specFacts({ decision: { kind, nextWeekTargetMin: 180 } }), 'km')[1]
    expect(line('progress')).toBe('The plan moves on: next week is up to 180 min.')
    expect(line('hold')).toBe('The plan holds steady: next week is up to 180 min.')
    expect(line('reduce')).toBe('The plan eases: next week is up to 180 min.')
    expect(line('post-race')).toBe(
      'The weeks after your race follow a set return schedule: next week is up to 180 min.',
    )
  })

  test('says what was run when nothing was planned, and when nothing was run', () => {
    expect(
      briefHeadline(
        specFacts({ lastWeek: { weekStart: LAST_MONDAY, ranMin: 95, plannedMin: null } }),
        'km',
      )[0],
    ).toBe('Last week you ran 95 min.')
    expect(
      briefHeadline(
        specFacts({ lastWeek: { weekStart: LAST_MONDAY, ranMin: 0, plannedMin: 240 } }),
        'km',
      )[0],
    ).toBe('No running was logged last week.')
    expect(briefHeadline(specFacts({ lastWeek: null, decision: null }), 'km')).toEqual([])
  })

  test('never says "of 0 planned minutes", even for a brief stored with a zero plan', () => {
    const [line] = briefHeadline(
      specFacts({ lastWeek: { weekStart: LAST_MONDAY, ranMin: 25, plannedMin: 0 } }),
      'km',
    )
    expect(line).toBe('Last week you ran 25 min.')
  })

  test('leaves the number out when the suggested minutes are zero', () => {
    const line = (kind: 'progress' | 'hold' | 'reduce' | 'post-race') =>
      briefHeadline(specFacts({ decision: { kind, nextWeekTargetMin: 0 } }), 'km')[1]
    expect(line('progress')).toBe('The plan moves on to next week.')
    expect(line('hold')).toBe('The plan holds steady for next week.')
    expect(line('reduce')).toBe('The plan eases next week.')
    expect(line('post-race')).toBe('The weeks after your race follow a set return schedule.')
    for (const kind of ['progress', 'hold', 'reduce', 'post-race'] as const) {
      expect(line(kind)).not.toMatch(/\b0 min\b/)
      assertCleanCopy(line(kind) ?? '', kind)
    }
  })

  test('counts down to the race in weeks from two weeks out, then in days', () => {
    const line = (days: number) =>
      briefContext(
        specFacts({ countdown: { name: 'The Half', date: addDays(MONDAY, days), days } }),
        'km',
      )[0]
    expect(line(233)).toBe('The Half is 33 weeks away.')
    expect(line(14)).toBe('The Half is 2 weeks away.')
    expect(line(13)).toBe('The Half is 13 days away.')
    expect(line(2)).toBe('The Half is 2 days away.')
    expect(line(1)).toBe('The Half is 1 day away.')
    expect(line(0)).toBe('The Half is today.')
    expect(briefContext(specFacts(), 'km')).toEqual([])
  })

  test('shows a goal name as typed, with the punctuation it ends in, in every form of the countdown', () => {
    const line = (days: number) =>
      briefContext(
        specFacts({ countdown: { name: 'Big Day!', date: addDays(MONDAY, days), days } }),
        'km',
      )[0]
    expect(line(233)).toBe('Big Day! is 33 weeks away.')
    expect(line(13)).toBe('Big Day! is 13 days away.')
    expect(line(1)).toBe('Big Day! is 1 day away.')
    expect(line(0)).toBe('Big Day! is today.')
  })

  test('sets the finish estimate beside last week’s, and says when it did not move', () => {
    const line = (nowSec: number, priorSec: number) =>
      briefContext(specFacts({ prediction: { nowSec, priorSec } }), 'km')[0]
    expect(line(7500, 7800)).toBe(
      'The finish estimate is about 2 h 5 min, 5 min quicker than a week ago.',
    )
    expect(line(7800, 7500)).toBe(
      'The finish estimate is about 2 h 10 min, 5 min slower than a week ago.',
    )
    expect(line(7500, 7500)).toBe('The finish estimate is about 2 h 5 min, the same as a week ago.')
  })
})

describe('what changed and why', () => {
  const lines = (...causes: Array<Array<'ramp' | 'decision-hold' | 'state-update' | 'trim'>>) =>
    causes.map((found) => ({ type: 'changed' as const, date: MONDAY, causes: found }))

  test('says the plan did not change, or how many sessions did', () => {
    expect(briefChanges(specFacts(), false, 'km')).toEqual({
      text: 'The plan did not change this week.',
      causes: [],
    })
    const some = (count: number) =>
      specFacts({
        changes: {
          count,
          lines: lines(...Array.from({ length: count }, () => ['ramp' as const])),
          runMinBefore: 0,
          runMinAfter: 0,
        },
      })
    expect(briefChanges(some(1), false, 'km').text).toBe('The weekly update changed one session.')
    expect(briefChanges(some(3), false, 'km').text).toBe('The weekly update changed 3 sessions.')
    // weeks changed and no session did
    const weeksOnly = specFacts({
      changes: {
        count: 0,
        lines: [{ type: 'week', date: MONDAY, causes: ['ramp'] }],
        runMinBefore: 240,
        runMinAfter: 220,
      },
    })
    expect(briefChanges(weeksOnly, false, 'km').text).toBe(
      'The weekly update adjusted the running time of the weeks ahead.',
    )
  })

  test('names the causes, most specific first, at most two', () => {
    const facts = specFacts({
      changes: {
        count: 3,
        lines: lines(['ramp'], ['trim', 'decision-hold'], ['state-update']),
        runMinBefore: 0,
        runMinAfter: 0,
      },
    })
    const { causes } = briefChanges(facts, false, 'km')
    expect(BRIEF_CAUSES_SHOWN).toBe(2)
    expect(causes).toEqual([
      'The next quality session is a little shorter.',
      'Last week called for holding steady, so the plan did not step up.',
    ])
  })

  test('says the update has not run when the brief is provisional', () => {
    expect(briefChanges(specFacts({ changes: null }), true, 'km').text).toBe(
      "The weekly update has not run yet. This brief reads today's plan.",
    )
  })

  test('puts the reason the update wrote nothing before everything else', () => {
    const sentence = (replan: BriefFacts['replan'], provisional = false) =>
      briefChanges(specFacts({ replan, changes: null }), provisional, 'km').text
    expect(sentence('goal-passed')).toBe(
      'The plan was not updated this week: the goal date has passed. Move the date or choose another goal.',
    )
    expect(sentence('checklist')).toContain('did not meet the plan checks')
    expect(sentence('no-plan')).toBe('The plan was not updated this week: there is no active plan.')
    expect(sentence('not-run')).toBe(
      'The plan was not updated this week: the weekly update did not run.',
    )
    expect(sentence('error')).toContain('could not finish')
    expect(sentence('error', true)).toContain('The plan was not updated this week')
    // a code a newer build writes reads as the general one
    expect(sentence('later' as never)).toBe(sentence('error'))
  })
})

describe('the key session', () => {
  const key = (over: Partial<NonNullable<BriefFacts['keySession']>> = {}) => ({
    sessionId: 's1',
    externalId: 'e1',
    date: '2026-10-24',
    kind: 'long' as SessionKind,
    durationMin: 105,
    distanceM: 17_000 as number | null,
    gainM: null,
    target: {
      zone: 'z1' as const,
      mode: 'hr-ceiling' as const,
      hrCeiling: 140,
      hrRange: null,
      paceSecPerKm: [390, 340] as [number, number],
      rpe: [2, 3] as [number, number],
      hot: false,
    },
    ...over,
  })

  test('names the day, the kind, the length and the distance in the runner’s units', () => {
    expect(briefKeySession(key(), 'km')?.line).toBe('Sat 24 Oct: long run, 105 min, 17 km.')
    expect(briefKeySession(key(), 'mi')?.line).toBe('Sat 24 Oct: long run, 105 min, 10.6 mi.')
    expect(briefKeySession(key({ distanceM: null }), 'km')?.line).toBe(
      'Sat 24 Oct: long run, 105 min.',
    )
    expect(briefKeySession(key({ kind: 'race' }), 'km')?.line).toContain('race,')
    expect(briefKeySession(null, 'km')).toBeNull()
  })

  test('words the distance estimate as one, in the runner’s units, in place of the plan’s distance', () => {
    const easy = { distanceM: 16_800, basis: 'easy' as const }
    expect(briefKeySession(key({ distanceEstimate: easy }), 'km')?.line).toBe(
      'Sat 24 Oct: long run, 105 min, about 17 km at your easy pace.',
    )
    expect(briefKeySession(key({ distanceEstimate: easy }), 'mi')?.line).toBe(
      'Sat 24 Oct: long run, 105 min, about 10 mi at your easy pace.',
    )
    const paced = { distanceM: 10_900, basis: 'pace' as const }
    expect(briefKeySession(key({ kind: 'threshold', distanceEstimate: paced }), 'km')?.line).toBe(
      'Sat 24 Oct: threshold run, 105 min, about 11 km.',
    )
    // No estimate (a brief stored before it existed, or no pace data): the plan's own distance
    // stands, else none.
    expect(briefKeySession(key({ distanceEstimate: null }), 'km')?.line).toBe(
      'Sat 24 Oct: long run, 105 min, 17 km.',
    )
    expect(briefKeySession(key({ distanceEstimate: null, distanceM: null }), 'km')?.line).toBe(
      'Sat 24 Oct: long run, 105 min.',
    )
  })

  test('shows the hero’s target rows and the readiness sentence', () => {
    const rendered = briefKeySession(key(), 'km')!
    expect(rendered.targets.map((row) => `${row.term}: ${row.value}`)).toEqual([
      'Heart rate: under 140 bpm',
      'Pace: about 5:40 to 6:30 /km',
      'Effort: 2 to 3 out of 10',
    ])
    expect(rendered.readiness).toBe(
      'Readiness can only make this session easier on the day, never harder.',
    )
    const mi = briefKeySession(key(), 'mi')!
    expect(mi.targets[1]?.value).toMatch(/\/mi$/)
    const hot = briefKeySession(
      key({ target: { ...key().target, hot: true, mode: 'effort' } }),
      'km',
    )!
    // The key session is on a day ahead: the note does not say "today".
    expect(hot.targets[0]).toMatchObject({ term: 'Effort', note: 'Go by this when you run it.' })
  })

  test('names every kind, and a kind a newer build adds as a session', () => {
    for (const kind of SESSION_KINDS) {
      expect(Object.hasOwn(BRIEF_KIND_IDS, kind), kind).toBe(true)
      expect(briefKindName(kind, 'km').length).toBeGreaterThan(0)
    }
    expect(briefKindName('long-fast-finish', 'km')).toBe('long run with a fast finish')
    expect(briefKindName('teleport' as SessionKind, 'km')).toBe('session')
  })
})

describe('what the plan noticed', () => {
  test('renders each stored fact with its rule and sources, and says when there is none', () => {
    const facts = buildBriefFacts(
      briefArgs({}, { wellness: [checkin(2, { painScore: 5 })], screeningFlags: 3 }),
    )
    const noticed = briefNoticed(facts, 'km')
    expect(noticed.map((n) => n.rule)).toEqual(['n-2', 'n-4'])
    expect(noticed[0]).toMatchObject({
      text: 'Pain of 5 out of 10 was reported on Wed 14 Oct. See the guidance on warning signs before the next run.',
      sources: [{ kind: 'check-in', date: '2026-10-14' }],
      moreSources: 0,
    })
    expect(renderBrief({ facts: specFacts(), provisional: false }, 'km').noticed).toMatchObject({
      items: [],
      empty: 'Nothing stood out this week.',
    })
  })
})

describe('the brief line of Today', () => {
  test('reads as the spec words it, for none, one and many changes', () => {
    const next = { date: '2026-10-24', kind: 'long' as SessionKind }
    expect(renderBriefLine({ changeCount: 3, nextKey: next }, 'km')).toBe(
      'Since last week: 3 changes, next key session Saturday (long run).',
    )
    expect(renderBriefLine({ changeCount: 1, nextKey: next }, 'km')).toBe(
      'Since last week: 1 change, next key session Saturday (long run).',
    )
    expect(renderBriefLine({ changeCount: 0, nextKey: next }, 'km')).toBe(
      'Since last week: no changes, next key session Saturday (long run).',
    )
    expect(renderBriefLine({ changeCount: 3, nextKey: null }, 'km')).toBe(
      'Since last week: 3 changes, no key session this week.',
    )
    expect(renderBriefLine({ changeCount: 1, nextKey: null }, 'km')).toBe(
      'Since last week: 1 change, no key session this week.',
    )
    expect(renderBriefLine({ changeCount: 0, nextKey: null }, 'km')).toBe(
      'Since last week: no changes, no key session this week.',
    )
  })

  test('adds the distance estimate to the next key session when there is one', () => {
    const next = {
      date: '2026-10-24',
      kind: 'long' as SessionKind,
      distanceEstimate: { distanceM: 16_800, basis: 'easy' as const },
    }
    expect(renderBriefLine({ changeCount: 3, nextKey: next }, 'km')).toBe(
      'Since last week: 3 changes, next key session Saturday (long run, about 17 km).',
    )
    expect(renderBriefLine({ changeCount: 1, nextKey: next }, 'mi')).toBe(
      'Since last week: 1 change, next key session Saturday (long run, about 10 mi).',
    )
    expect(
      renderBriefLine({ changeCount: 0, nextKey: { ...next, distanceEstimate: null } }, 'km'),
    ).toBe('Since last week: no changes, next key session Saturday (long run).')
  })
})

describe('the words around the brief', () => {
  test('are the headings of the spec', () => {
    expect(briefText('brief.heading-changed', 'km')).toBe('What changed and why')
    expect(briefText('brief.heading-noticed', 'km')).toBe('What the plan noticed')
    expect(briefText('brief.heading-key', 'km')).toBe('Next key session')
    expect(briefText('brief.heading-since', 'km')).toBe('Since this brief')
    expect(briefText('brief.key-none', 'km')).toBe(
      'No key session this week. The week is easy running.',
    )
    expect(briefWeekLabel('2026-10-19', 'km')).toBe('Week of 19 Oct')
  })

  test('cover every reason the update wrote nothing', () => {
    for (const id of Object.values(BRIEF_REPLAN_IDS))
      expect(Object.hasOwn(BRIEF_TEMPLATES, id)).toBe(true)
    expect(Object.keys(BRIEF_REPLAN_IDS).sort()).toEqual(
      ['checklist', 'error', 'goal-passed', 'no-plan', 'not-run'].sort(),
    )
  })
})

// ---------------------------------------------------------------------------------------------
// Fifty fuzzed weeks
// ---------------------------------------------------------------------------------------------

/** A small seeded generator, so a failing week can be rebuilt from its number. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STATUSES: readonly PlanSessionStatus[] = [
  'planned',
  'moved',
  'downgraded',
  'adjusted',
  'completed',
  'partial',
  'skipped',
]
const SIGNALS = [
  'persistent-suppression',
  'readiness-flag',
  'sleep-warning',
  'subjective-decline',
  'completion-low',
  'heat',
  'illness',
  'pain',
]

function fuzzedFacts(n: number): { facts: BriefFacts; provisional: boolean } {
  const rand = seeded(n * 7919 + 13)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
  const chance = (p: number) => rand() < p

  const wellness = [
    ...(chance(0.4)
      ? [checkin(Math.floor(rand() * 7), { painScore: Math.floor(rand() * 9) + 1 })]
      : []),
    ...(chance(0.2) ? [checkin(Math.floor(rand() * 7), { painFocalBone: true })] : []),
    ...(chance(0.25) ? [checkin(Math.floor(rand() * 7), { illness: true })] : []),
    ...(chance(0.4)
      ? Array.from({ length: 7 }, (_, d) =>
          checkin(d, {
            sleepSec: Math.round((5 + rand() * 4) * 3600),
            fatigue: 1 + Math.floor(rand() * 5),
          }),
        )
      : []),
  ]
  const lastWeekRuns = chance(0.8)
    ? [
        activity(addDays(LAST_MONDAY, Math.floor(rand() * 7)), {
          id: `fuzz-${String(n)}`,
          durationSec: Math.round((20 + rand() * 280) * 60),
          distanceM: chance(0.8) ? Math.round(3000 + rand() * 40_000) : null,
          pain: chance(0.1) ? Math.floor(rand() * 9) : null,
        }),
      ]
    : []
  const base = plan(4, [
    {
      isRecovery: chance(0.2),
      isTaper: chance(0.15),
      flags: [
        ...(chance(0.15) ? ['race-week'] : []),
        ...(chance(0.1) ? ['post-race'] : []),
        ...(chance(0.2) ? ['recovery'] : []),
      ],
      targetRunMin: Math.round(60 + rand() * 400),
    },
  ])
  const existing: EngineInput['existing'] = {
    weeks: base.weeks,
    sessions: base.sessions.map((session) =>
      chance(0.5)
        ? {
            ...session,
            kind: pick(SESSION_KINDS),
            status: pick(STATUSES),
            durationMin: Math.round(20 + rand() * 200),
            distanceM: chance(0.7) ? Math.round(3000 + rand() * 45_000) : null,
            gainM: chance(0.3) ? Math.round(rand() * 2000) : null,
          }
        : session,
    ),
  }
  const input = runnerInput({
    wellness: [...wellness].sort((a, b) => a.date.localeCompare(b.date)),
    activities: [...runnerInput().activities, ...lastWeekRuns],
    existing,
    screeningFlags: chance(0.2) ? 1 + Math.floor(rand() * 3) : 0,
  })

  const kind = pick(['progress', 'hold', 'reduce'] as const)
  const decision: WeeklyDecision | null = chance(0.85)
    ? {
        ...decisionOf(
          kind,
          SIGNALS.filter(() => chance(0.3)),
          Math.round(rand() * 400),
        ),
        ...(chance(0.15)
          ? {
              postRace: {
                label: 'After the race, step 1 of 3',
                phase: 'step' as const,
                step: 1,
                steps: 3,
                holdUntil: LAST_MONDAY,
                quietUntil: MONDAY,
                extensionDays: 0,
              },
            }
          : {}),
      }
    : null

  const diffs: Array<PlanDiff | null> = [null, emptyDiff(), mixedDiff()]
  const diff = pick(diffs)
  const revision = chance(0.7) && diff !== null ? revisionOf(diff, decision) : null
  const args = briefArgs(
    {
      decision,
      revision: chance(0.1) && diff !== null ? { diff, causes: null } : revision,
      replan: chance(0.2)
        ? pick(['goal-passed', 'checklist', 'no-plan', 'not-run', 'error'] as const)
        : null,
      goal: chance(0.8)
        ? {
            name: pick([GOAL.name, 'Synthetic ultra 100', 'Synthetic 10 km']),
            date: addDays(MONDAY, Math.floor(rand() * 300)),
          }
        : null,
      predictions: chance(0.5)
        ? [
            { weekStart: MONDAY, predictedSec: Math.round(1800 + rand() * 90_000) },
            { weekStart: LAST_MONDAY, predictedSec: Math.round(1800 + rand() * 90_000) },
          ]
        : [],
      isHot: () => chance(0.4),
    },
    input,
  )
  const state = {
    ...args.state,
    efficiency: { current: 1.1, trendPct: chance(0.6) ? (rand() - 0.5) * 24 : null, samples: 6 },
  }
  const facts = buildBriefFacts({ ...args, state })
  return { facts, provisional: chance(0.3) }
}

const NO_LEAK = [/undefined/, /NaN/, /\b\d{4}-\d{2}-\d{2}\b/, /[{}]/, /\[object/, /null/]

describe('fifty fuzzed weeks', () => {
  test('render in both units without a banned word, a leaked value or an over-long sentence', () => {
    let noticed = 0
    let keys = 0
    let replans = 0
    let causes = 0
    for (let n = 1; n <= 50; n++) {
      const { facts, provisional } = fuzzedFacts(n)
      noticed += facts.noticed.length
      keys += facts.keySession === null ? 0 : 1
      replans += facts.replan === null ? 0 : 1
      causes += facts.changes?.lines.length ?? 0
      for (const units of UNITS) {
        const rendered = renderBrief({ facts, provisional }, units)
        const texts = renderedBriefTexts(rendered)
        expect(texts.length, `week ${String(n)}`).toBeGreaterThan(3)
        for (const text of texts) {
          const where = `week ${String(n)} in ${units}: ${JSON.stringify(text)}`
          expect(text.trim().length, where).toBeGreaterThan(0)
          expect(lintText(text), where).toEqual([])
          assertCleanCopy(text, where)
          for (const leak of NO_LEAK) expect(text, where).not.toMatch(leak)
          expect(text.length, where).toBeLessThanOrEqual(COPY_MAX_CHARS)
        }
        // Today's line too
        const line = renderBriefLine(
          {
            changeCount: facts.changes?.count ?? 0,
            nextKey: facts.keySession && {
              date: facts.keySession.date,
              kind: facts.keySession.kind,
            },
          },
          units,
        )
        assertCleanCopy(line, `line of week ${String(n)}`)
        for (const leak of NO_LEAK) expect(line).not.toMatch(leak)
      }
    }
    // the fuzz reaches what it is meant to: facts, key sessions, notes and changes
    expect(noticed).toBeGreaterThan(40)
    expect(keys).toBeGreaterThan(20)
    expect(replans).toBeGreaterThan(3)
    expect(causes).toBeGreaterThan(20)
  })

  test('are the same twice: a rendered brief depends on its facts and units alone', () => {
    for (let n = 1; n <= 10; n++) {
      const { facts, provisional } = fuzzedFacts(n)
      expect(renderBrief({ facts, provisional }, 'mi')).toEqual(
        renderBrief({ facts, provisional }, 'mi'),
      )
      expect(fuzzedFacts(n).facts).toStrictEqual(facts)
    }
  })
})
