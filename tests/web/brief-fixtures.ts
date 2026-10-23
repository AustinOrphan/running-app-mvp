import type { BriefFacts, InputFact } from '../../shared/engine/types.ts'
import type { BriefListItem, BriefView, PlanRevisionView } from '../../shared/types.ts'
import {
  AVAILABLE,
  makeBrief,
  makeDiff,
  makeLine,
  makeRevision,
  makeWeekLine,
} from './plan-fixtures.ts'

// Synthetic briefs for the page and the line. The clock is Wednesday 13 Jan 2027, so the brief
// opens on Monday 11 Jan and the week before it began on Monday 4 Jan.

export const WEEK = '2027-01-11'
export const LAST_WEEK = '2027-01-04'
/** Written on Monday 11 Jan at noon UTC, which is that day in every zone a run is likely to use. */
export const WRITTEN = '2027-01-11T12:00:00.000Z'

/** "Your 16.0 km run on Sat 9 Jan was the longest in the last 12 weeks.", with the run it rests on. */
export const LONGEST: InputFact = {
  id: 'a3.longest',
  template: 'brief.noticed-longest-distance',
  slots: {
    distance: { kind: 'distance', m: 16_000 },
    date: { kind: 'date', iso: '2027-01-09', style: 'weekday' },
    weeks: { kind: 'count', n: 12 },
  },
  rule: 'a-3',
  sources: [
    {
      kind: 'activity',
      id: 'run-1',
      date: '2027-01-09',
      label: 'Run',
      distanceM: 16_000,
    },
  ],
  moreSources: 0,
  state: 'used',
  window: { from: '2026-10-19', to: '2027-01-10' },
}

export function makeFacts(over: Partial<BriefFacts> = {}): BriefFacts {
  return {
    weekStart: WEEK,
    asOf: WEEK,
    lastWeek: { weekStart: LAST_WEEK, ranMin: 212, plannedMin: 240 },
    decision: { kind: 'hold', nextWeekTargetMin: 220 },
    replan: null,
    changes: {
      count: 1,
      lines: [{ type: 'changed', date: '2027-01-14', causes: ['decision-hold'] }],
      runMinBefore: 300,
      runMinAfter: 270,
    },
    noticed: [LONGEST],
    keySession: {
      sessionId: 'long1',
      externalId: 'ext-long1',
      date: '2027-01-16',
      kind: 'long',
      durationMin: 105,
      distanceM: 16_000,
      gainM: null,
      target: {
        zone: 'z2',
        mode: 'hr-ceiling',
        hrCeiling: 149,
        hrRange: null,
        paceSecPerKm: [390, 345],
        rpe: [3, 4],
        hot: false,
      },
    },
    countdown: { name: 'Synthetic half', date: '2027-03-14', days: 60 },
    prediction: null,
    ...over,
  }
}

/** The weekly update's revision: one threshold run made easy, held by the weekly decision, unseen. */
export function makeUpdate(over: Partial<PlanRevisionView> = {}): PlanRevisionView {
  const line = makeLine({
    externalId: 'x1',
    date: '2027-01-14',
    before: makeBrief({
      date: '2027-01-14',
      kind: 'threshold',
      title: 'Threshold',
      durationMin: 40,
    }),
    after: makeBrief({ date: '2027-01-14', kind: 'easy', title: 'Easy run', durationMin: 30 }),
    fields: ['kind', 'durationMin'],
    rules: ['j-5'],
  })
  return makeRevision({
    id: 'r1',
    createdAt: WRITTEN,
    reason: 'weekly',
    auto: true,
    summary: 'Held the week after last week.',
    changes: [{ weekStart: WEEK, field: 'targetRunMin', from: 300, to: 270, rules: ['j-5'] }],
    decision: { decision: 'hold', signals: [], nextWeekTargetMin: 220 },
    diff: makeDiff([line], [makeWeekLine({ weekStart: WEEK })]),
    causes: { sessions: { x1: ['decision-hold'] }, weeks: { [WEEK]: ['decision-hold'] } },
    undo: AVAILABLE,
    seenAt: null,
    ...over,
  })
}

/** An edit made after the brief, in the same week. */
export function makeLater(over: Partial<PlanRevisionView> = {}): PlanRevisionView {
  const line = makeLine({
    externalId: 'x2',
    date: '2027-01-15',
    before: makeBrief({ date: '2027-01-15', kind: 'easy', title: 'Easy run', durationMin: 45 }),
    after: null,
    change: 'removed',
  })
  return makeRevision({
    id: 'r2',
    createdAt: '2027-01-12T12:00:00.000Z',
    reason: 'owner',
    auto: false,
    summary: 'Skipped Fri 15 Jan.',
    changes: [],
    diff: makeDiff([line]),
    causes: { sessions: { x2: ['owner-edit'] }, weeks: {} },
    undo: AVAILABLE,
    seenAt: null,
    ...over,
  })
}

export function makeView(over: Partial<BriefView> = {}): BriefView {
  return {
    weekStart: WEEK,
    planId: 'p2',
    version: 1,
    provisional: false,
    seen: false,
    generatedAt: WRITTEN,
    facts: makeFacts(),
    revision: makeUpdate(),
    since: [],
    prev: LAST_WEEK,
    next: null,
    ...over,
  }
}

export function makeItem(over: Partial<BriefListItem> = {}): BriefListItem {
  return {
    weekStart: WEEK,
    provisional: false,
    seen: false,
    generatedAt: WRITTEN,
    decision: 'hold',
    replan: null,
    changeCount: 3,
    undone: false,
    nextKey: { date: '2027-01-16', kind: 'long' },
    ...over,
  }
}
