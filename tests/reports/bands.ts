// Reference bands for the plan report (evaluation harness, proposal
// `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` section 5.2, task H1).
//
// A band is where published plans sit, not where a plan should sit. Every row carries the label
// "D, practice source": a published plan's figure is a convention, never evidence, and no engine
// rule stands behind it. The distance from a band is printed beside the figure and is never
// minimised, never a verdict and never a limit (G5, ADR 0005). Nothing under `shared/`, `server/`,
// `web/` or `scripts/` may import this file (`harness-isolation.test.ts`).
//
// (a) Knopp et al. 2024, the last 12 weeks of 92 sub-elite marathon plans, applied only to marathon
//     plans and only to the last 12 weeks before the race week.
// (b) The corpus's 5 and 10 km programme records that carry a week table, and the start ladder
//     (the NHS and Clark Couch-to-5K tables, which E6 follows).
// (c) Book descriptors (Daniels, Pfitzinger) are task S3's and are not here.
import { daysBetween, mondayOf } from '../../shared/dates.ts'
import { RUN_KINDS } from '../../shared/engine/adjust.ts'
import type { SessionSpec } from '../../shared/engine/types.ts'
import type { WeekFigure } from '../unit/engine/plan-metrics.ts'

/** The label every band row prints. */
export const BAND_LABEL = 'D, practice source'

/** A closed range of figures; the distance from it is 0 anywhere inside. */
export interface Band {
  lo: number
  hi: number
}

/** 0 inside the band (edges included), else the signed distance to the nearest edge. */
export function distanceFromBand(value: number, band: Band): number {
  if (value < band.lo) return value - band.lo
  if (value > band.hi) return value - band.hi
  return 0
}

// ---------------------------------------------------------------------------------------------
// (a) Knopp et al. 2024
// ---------------------------------------------------------------------------------------------

export type Tier = 'high' | 'middle' | 'low'

export interface TierFigure {
  mean: number
  sd: number
}

export interface KnoppFigure {
  /** Where the three tier figures stand in the full text. */
  where: string
  tiers: Record<Tier, TierFigure>
}

/**
 * Knopp M, Appelhans D, Schonfelder M, Seiler S, Wackerhage H. Sports Med Open 2024 (CC BY 4.0).
 * Read on 2026-10-31 from the Europe PMC full text of PMC11065819 (JATS XML), not from the
 * proposal. Weeks are labelled 11 to 0 in the paper, week 0 being the race week with the race
 * itself left out. A tier is the plan's peak week: high over 90 km, middle 65 to 90 km, low under
 * 65 km (Methods, "Coding of Training Plans"). Each figure is a mean over the plans of a tier with
 * the standard deviation between those plans; the band printed is the range of the three tier
 * means, so it is narrower than the spread of the plans and a plan outside it is not an outlier.
 */
export const KNOPP = {
  source: 'knopp-2024-marathon-plans',
  doi: '10.1186/s40798-024-00717-5',
  fullText: 'PMC11065819',
  licence: 'CC BY 4.0',
  readOn: '2026-10-31',
  /** Weeks 11 to 0. */
  windowWeeks: 12,
  /**
   * Weekly change is a mean of the week-to-week changes between consecutive weeks, recovery weeks
   * included. Whether the taper mean includes the final-week drop is not stated; the text reads as
   * a mean over the weeks from the peak week to the race week, so it does.
   */
  figures: {
    /** Results, "Progression of Training Plan": the weekly increase up to the peak week. */
    buildPctPerWeek: {
      where: 'Results, Progression of Training Plan',
      tiers: {
        high: { mean: 5, sd: 3 },
        middle: { mean: 7, sd: 3 },
        low: { mean: 9, sd: 4 },
      },
    },
    /** Table 4, "Peak week (week)": the peak week's label, counted back from the race week. */
    peakWeeksBeforeRace: {
      where: 'Table 4, Peak week',
      tiers: {
        high: { mean: 4.4, sd: 1.4 },
        middle: { mean: 4.0, sd: 1.5 },
        low: { mean: 3.6, sd: 1.4 },
      },
    },
    /** Results, "Progression of Training Plan": the weekly reduction from peak to race week. */
    taperMeanDecreasePct: {
      where: 'Results, Progression of Training Plan; Conclusions, finding 5',
      tiers: {
        high: { mean: 22, sd: 12 },
        middle: { mean: 28, sd: 12 },
        low: { mean: 31, sd: 13 },
      },
    },
    /** Results, "Progression of Training Plan": the last week against the one before it (Fig. 1). */
    finalWeekDecreasePct: {
      where: 'Results, Progression of Training Plan',
      tiers: {
        high: { mean: 46, sd: 17 },
        middle: { mean: 54, sd: 16 },
        low: { mean: 50, sd: 24 },
      },
    },
    /** Table 3, "Run Sessions (runs/week)": the mean over the last 12 weeks. */
    runsPerWeek: {
      where: 'Table 3, Run Sessions',
      tiers: {
        high: { mean: 6.8, sd: 1.4 },
        middle: { mean: 4.9, sd: 0.9 },
        low: { mean: 4.1, sd: 0.9 },
      },
    },
  },
} as const satisfies {
  source: string
  doi: string
  fullText: string
  licence: string
  readOn: string
  windowWeeks: number
  figures: Record<string, KnoppFigure>
}

export type KnoppFigureKey = keyof typeof KNOPP.figures

/** The range of the three tier means of a Knopp figure. */
export function knoppBand(key: KnoppFigureKey): Band {
  const tiers: Record<Tier, TierFigure> = KNOPP.figures[key].tiers
  const means = [tiers.high.mean, tiers.middle.mean, tiers.low.mean]
  return { lo: Math.min(...means), hi: Math.max(...means) }
}

// ---------------------------------------------------------------------------------------------
// The plan side
// ---------------------------------------------------------------------------------------------

/** What the band rows read of a plan: its weeks (from `describePlan`), sessions and goal. */
export interface BandPlan {
  goalClass: string
  goalDate: string
  weeks: ReadonlyArray<
    Pick<WeekFigure, 'weekStart' | 'type' | 'partial' | 'plannedMin' | 'longRunMin' | 'runDays'>
  >
  sessions: ReadonlyArray<Pick<SessionSpec, 'date' | 'kind' | 'flags' | 'durationMin'>>
}

/** One figure of a plan beside its band. `distance` is null when the plan has no such figure. */
export interface BandRow {
  key: string
  figure: string
  unit: string
  value: number | null
  band: Band
  distance: number | null
  /** The record id or ids the band comes from. */
  source: string
  label: typeof BAND_LABEL
}

function row(
  key: string,
  figure: string,
  unit: string,
  value: number | null,
  band: Band,
  source: string,
): BandRow {
  return {
    key,
    figure,
    unit,
    value,
    band,
    distance: value === null ? null : distanceFromBand(value, band),
    source,
    label: BAND_LABEL,
  }
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Sessions that are running training: a run kind that is not a race, a hike or a return step. */
const isTrainingRun = (s: BandPlan['sessions'][number]): boolean =>
  RUN_KINDS.has(s.kind) && s.kind !== 'race' && s.kind !== 'hike' && !s.flags.includes('post-race')

export interface KnoppResult {
  /** Weeks of the last 12 before the race week that the plan holds in full. */
  windowWeeks: number
  rows: BandRow[]
}

/**
 * The plan beside Knopp's bands, or null when it is not a marathon plan. The window is the plan's
 * whole weeks from 11 weeks before the race week to the race week; a part week and the weeks after
 * the race are left out. Weekly volume is the planned minutes of the run sessions with the race
 * itself left out, as Knopp leaves it out (the target of a race week is above the minutes of its
 * run sessions). A tie at the highest week is read at both ends: the build-up is measured to the
 * first week at the highest, the taper from the last, and the peak position is printed for both.
 * Minutes stand in for Knopp's kilometres, so only relative figures and counts are compared.
 */
export function knoppRows(plan: BandPlan): KnoppResult | null {
  if (plan.goalClass !== 'marathon') return null
  const raceMonday = mondayOf(plan.goalDate)
  const span = plan.weeks
    .filter((w) => !w.partial)
    .map((w) => ({
      weekStart: w.weekStart,
      weeksOut: daysBetween(w.weekStart, raceMonday) / 7,
      min: w.plannedMin,
    }))
    .filter((w) => w.weeksOut >= 0 && w.weeksOut < KNOPP.windowWeeks)
    .sort((a, b) => b.weeksOut - a.weeksOut)

  const peakMin = span.reduce((best, w) => Math.max(best, w.min), 0)
  const firstAt = span.findIndex((w) => w.min === peakMin)
  const lastAt = span.findLastIndex((w) => w.min === peakMin)

  const changes = (from: number, to: number, sign: 1 | -1): number[] => {
    const out: number[] = []
    for (let i = from + 1; i <= to; i += 1) {
      const before = span[i - 1]!.min
      if (before > 0) out.push(sign * (span[i]!.min / before - 1) * 100)
    }
    return out
  }
  const lastWeek = span[span.length - 1]
  const reachesRace = lastWeek !== undefined && lastWeek.weeksOut === 0
  const build = firstAt > 0 ? mean(changes(0, firstAt, 1)) : null
  const taper =
    reachesRace && lastAt < span.length - 1 ? mean(changes(lastAt, span.length - 1, -1)) : null
  const weekBefore = span.find((w) => w.weeksOut === 1)
  const final =
    reachesRace && weekBefore !== undefined && weekBefore.min > 0
      ? (1 - lastWeek.min / weekBefore.min) * 100
      : null

  const inWindow = new Set(span.map((w) => w.weekStart))
  const runDates = new Map<string, Set<string>>()
  for (const s of plan.sessions) {
    const monday = mondayOf(s.date)
    if (!inWindow.has(monday) || !isTrainingRun(s)) continue
    const dates = runDates.get(monday) ?? new Set<string>()
    dates.add(s.date)
    runDates.set(monday, dates)
  }
  const runs = mean(span.map((w) => runDates.get(w.weekStart)?.size ?? 0))

  const id = KNOPP.source
  const peakFirst = span[firstAt]?.weeksOut ?? null
  const peakLast = span[lastAt]?.weeksOut ?? null
  return {
    windowWeeks: span.length,
    rows: [
      row(
        'build',
        'Build-up: mean weekly change up to the first peak week',
        'percent a week',
        build,
        knoppBand('buildPctPerWeek'),
        id,
      ),
      row(
        'peak-first',
        'Peak week, first week at the highest: weeks before the race week',
        'weeks',
        peakFirst,
        knoppBand('peakWeeksBeforeRace'),
        id,
      ),
      row(
        'peak-last',
        'Peak week, last week at the highest: weeks before the race week',
        'weeks',
        peakLast,
        knoppBand('peakWeeksBeforeRace'),
        id,
      ),
      row(
        'taper',
        'Taper: mean weekly decrease from the last peak week to the race week',
        'percent a week',
        taper,
        knoppBand('taperMeanDecreasePct'),
        id,
      ),
      row(
        'final-week',
        'Final week: decrease on the week before',
        'percent',
        final,
        knoppBand('finalWeekDecreasePct'),
        id,
      ),
      row(
        'runs',
        'Run days a week, mean over the window',
        'days',
        runs,
        knoppBand('runsPerWeek'),
        id,
      ),
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// (b) 5 and 10 km programme records, and the start ladder
// ---------------------------------------------------------------------------------------------

export interface Programme {
  /** The corpus record (`research/papers/<id>.json`), grade D. */
  id: string
  goalClass: '5k' | '10k'
  /** `start`: a first programme (a run-walk ladder); `experienced`: for a runner who already runs. */
  audience: 'start' | 'experienced'
  weeks: number
  /** Run days in a typical week of the table. */
  runDaysPerWeek: number
  /** The longest single run the table states in minutes; null when it states miles. */
  longestRunMin: number | null
  /** The longest run when the table states miles. */
  longestRunMiles: number | null
  /** The week of the first continuous 20 minute run, in the ladder tables. */
  firstContinuous20Week: number | null
  /** The week in which every run is 30 minutes of continuous running, in the ladder tables. */
  allRuns30Week: number | null
}

/**
 * The records with a week table, read from their `findings` (re-fetched pages, checked 2026-10-22).
 * The Galloway record is a run-walk schedule with no goal race and is left out, and the Johnson
 * article gives distances without a table.
 */
export const PROGRAMMES: readonly Programme[] = [
  {
    id: 'higdon-2024-novice-5k',
    goalClass: '5k',
    audience: 'start',
    weeks: 8,
    runDaysPerWeek: 3,
    longestRunMin: null,
    longestRunMiles: 3,
    firstContinuous20Week: null,
    allRuns30Week: null,
  },
  {
    id: 'nhs-2026-couch-to-5k',
    goalClass: '5k',
    audience: 'start',
    weeks: 9,
    runDaysPerWeek: 3,
    longestRunMin: 30,
    longestRunMiles: null,
    firstContinuous20Week: 5,
    allRuns30Week: 9,
  },
  {
    id: 'clark-2026-couch-to-5k-original',
    goalClass: '5k',
    audience: 'start',
    weeks: 9,
    runDaysPerWeek: 3,
    longestRunMin: 30,
    longestRunMiles: null,
    firstContinuous20Week: 5,
    allRuns30Week: 9,
  },
  {
    id: 'higdon-2024-intermediate-5k',
    goalClass: '5k',
    audience: 'experienced',
    weeks: 8,
    runDaysPerWeek: 5,
    longestRunMin: null,
    longestRunMiles: 7,
    firstContinuous20Week: null,
    allRuns30Week: null,
  },
  {
    id: 'higdon-2024-advanced-5k',
    goalClass: '5k',
    audience: 'experienced',
    weeks: 8,
    runDaysPerWeek: 6,
    longestRunMin: 90,
    longestRunMiles: null,
    firstContinuous20Week: null,
    allRuns30Week: null,
  },
  {
    id: 'higdon-2024-advanced-10k',
    goalClass: '10k',
    audience: 'experienced',
    weeks: 8,
    runDaysPerWeek: 7,
    longestRunMin: null,
    longestRunMiles: 10,
    firstContinuous20Week: null,
    allRuns30Week: null,
  },
]

export interface ProgrammeResult {
  /** `start` when the plan opens on a run-walk ladder, else `experienced`. */
  audience: Programme['audience']
  /** The records the rows are read against; empty when the corpus has none for this goal. */
  records: string[]
  /** Records that state the longest run in miles, which are not turned into minutes. */
  milesOnly: string[]
  rows: BandRow[]
}

const bandOf = (values: readonly number[]): Band => ({
  lo: Math.min(...values),
  hi: Math.max(...values),
})

/**
 * A 5 or 10 km plan beside the programme records of its goal class, or null for another goal. The
 * plan is read against the start records when it has a run-walk session, else against the records
 * for a runner who already runs. A figure is compared only where a record states it in the plan's
 * unit: the miles of a long run are an estimate in minutes, so they are listed and not compared.
 */
export function programmeRows(plan: BandPlan): ProgrammeResult | null {
  if (plan.goalClass !== '5k' && plan.goalClass !== '10k') return null
  const onLadder = plan.sessions.some((s) => s.flags.includes('run-walk'))
  const audience = onLadder ? 'start' : 'experienced'
  const records = PROGRAMMES.filter(
    (p) => p.goalClass === plan.goalClass && p.audience === audience,
  )
  const result: ProgrammeResult = {
    audience,
    records: records.map((p) => p.id),
    milesOnly: records.filter((p) => p.longestRunMin === null).map((p) => p.id),
    rows: [],
  }
  if (records.length === 0) return result

  const loading = plan.weeks.filter((w) => w.type === 'loading' && !w.partial)
  const source = (list: readonly Programme[]) => list.map((p) => p.id).join(', ')
  result.rows.push(
    row(
      'run-days',
      'Run days a week, median of the loading weeks',
      'days',
      median(loading.map((w) => w.runDays)),
      bandOf(records.map((p) => p.runDaysPerWeek)),
      source(records),
    ),
  )
  const withMinutes = records.filter((p) => p.longestRunMin !== null)
  if (withMinutes.length > 0) {
    result.rows.push(
      row(
        'longest-run',
        'Longest run of the plan, minutes',
        'min',
        loading.length === 0 ? null : Math.max(...loading.map((w) => w.longRunMin)),
        bandOf(withMinutes.map((p) => p.longestRunMin!)),
        source(withMinutes),
      ),
    )
  }

  // The start ladder: the week, counted from the plan's first week (a part week counts as week 1),
  // of the first continuous run of 20 minutes and of the first week in which every run is 30.
  const ladder = records.filter((p) => p.firstContinuous20Week !== null)
  if (onLadder && ladder.length > 0) {
    const continuous = plan.sessions.filter(
      (s) =>
        isTrainingRun(s) && !s.flags.includes('run-walk') && !s.flags.includes('injury-return'),
    )
    const weekIndex = (date: string): number =>
      plan.weeks.findIndex((w) => w.weekStart === mondayOf(date)) + 1
    const first20 = continuous.filter((s) => s.durationMin >= 20).map((s) => weekIndex(s.date))
    const runsByWeek = new Map<number, number[]>()
    for (const s of plan.sessions.filter(isTrainingRun)) {
      const index = weekIndex(s.date)
      const list = runsByWeek.get(index) ?? []
      list.push(s.flags.includes('run-walk') ? 0 : s.durationMin)
      runsByWeek.set(index, list)
    }
    const all30 = [...runsByWeek]
      .filter(([, list]) => list.length > 0 && list.every((m) => m >= 30))
      .map(([index]) => index)
    const smallest = (values: readonly number[]): number | null =>
      values.length === 0 ? null : Math.min(...values)
    result.rows.push(
      row(
        'ladder-20',
        'Start ladder: week of the first continuous run of 20 minutes',
        'weeks',
        smallest(first20.filter((i) => i > 0)),
        bandOf(ladder.map((p) => p.firstContinuous20Week!)),
        source(ladder),
      ),
      row(
        'ladder-30',
        'Start ladder: first week in which every run is 30 minutes continuous',
        'weeks',
        smallest(all30.filter((i) => i > 0)),
        bandOf(ladder.map((p) => p.allRuns30Week!)),
        source(ladder),
      ),
    )
  }
  return result
}
