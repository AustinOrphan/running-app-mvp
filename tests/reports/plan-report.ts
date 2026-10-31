// Plan report (`npm run plan:report`; evaluation harness, proposal
// `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` sections 5.1 and 5.5,
// task H1): the plan metrics of `describePlan` over the twelve matrix athletes, the 150 runners of
// the history sweep and the 576 rest-window combinations, as Markdown on stdout.
//
// Report only. Nothing here is a target, a limit or a verdict, and it is not part of
// `npm run check`: it is run by hand at every `PARAMS_VERSION` bump, before and after, and the
// delta of the two outputs goes into the pull request (proposal decision 9). No figure is called
// safe, behind or missed (G5); there is no overall score and no acute:chronic ratio (G-5).
// Every figure carries the grade and rule id of the Params it rests on, read from the figure
// itself and never typed here, and the sweeps are stratified by the sweeps' own axes.
//
// Deterministic: no clock, no randomness, no run time in the text (the time goes to stderr), so the
// same input gives the same text and a digest of the matrix section is pinned in
// `tests/unit/reports/plan-report.test.ts`. Outside the Vitest include. Nothing under `shared/`,
// `server/`, `web/` or `scripts/` may import this file (`harness-isolation.test.ts`).
//
//   npm run plan:report                 # the whole report
//   npm run plan:report -- --matrix-only # the matrix, its bands and scorecards, without the sweeps
import { pathToFileURL } from 'node:url'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { daysBetween } from '../../shared/dates.ts'
import { buildPlan, PARAMS_VERSION } from '../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../shared/engine/types.ts'
import { withWindows } from '../unit/engine/disruption-fixtures.ts'
import { at } from '../unit/engine/history-fixtures.ts'
import { POSITIONS, type Position } from '../unit/engine/history-properties.ts'
import { SWEEP_COUNT, SWEEP_SEED, sweepCases } from '../unit/engine/history-sweep.ts'
import { athletes, TODAY } from '../unit/engine/matrix-fixtures.ts'
import {
  describePlan,
  type Figure,
  type HeadroomFigure,
  type PlanDescription,
  type ZoneShares,
} from '../unit/engine/plan-metrics.ts'
import {
  REST_SWEEP_KINDS,
  REST_SWEEP_ROUNDS,
  REST_SWEEP_SEED,
  restWindowCombos,
} from '../unit/engine/rest-window-sweep.ts'
import {
  BAND_LABEL,
  KNOPP,
  knoppBand,
  knoppRows,
  PROGRAMMES,
  programmeRows,
  type Band,
  type BandPlan,
  type BandRow,
} from './bands.ts'

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

/** One plan of the report with its figures and the slice of it the bands read. */
export interface PlanRow {
  id: string
  label: string
  input: EngineInput
  plan: PlanDraft
  d: PlanDescription
  bands: BandPlan
}

function planRow(id: string, label: string, input: EngineInput): PlanRow {
  const plan = buildPlan(input)
  const d = describePlan(plan, input)
  const bands: BandPlan = {
    goalClass: input.goal.distanceClass,
    goalDate: input.goal.date,
    weeks: d.weeks,
    sessions: plan.sessions,
  }
  return { id, label, input, plan, d, bands }
}

/** The twelve athletes of the plan matrix. */
export function matrixRows(): PlanRow[] {
  return athletes().map((a) => planRow(a.id, a.label, a.input))
}

export interface HistoryRow extends PlanRow {
  kind: string
  years: number
  position: Position
}

/** The years of running of a sweep runner, which its name carries: `#12 half 3y block ...`. */
export function yearsOfRunner(name: string): number {
  return Number(/^#\d+ \S+ (\d+)y /.exec(name)?.[1])
}

/** The runners of the history sweep at steady, standard and upper. */
export function historyRows(count: number = SWEEP_COUNT): HistoryRow[] {
  return sweepCases(SWEEP_SEED, count).flatMap((c) =>
    POSITIONS.map((position) => ({
      ...planRow(`${c.name} ${position}`, c.name, at(c.input, position)),
      kind: c.input.goal.distanceClass,
      years: yearsOfRunner(c.name),
      position,
    })),
  )
}

export interface WindowRow extends PlanRow {
  reasonMode: string
  lengthBucket: string
  startBucket: string
}

const START_BUCKETS = ['before today', 'in the first week', 'in the second week']

/** Where a window starts, in days from today: 14 back to 14 ahead in the sample. */
export function startBucket(offset: number): string {
  if (offset < 0) return START_BUCKETS[0]!
  return offset <= 6 ? START_BUCKETS[1]! : START_BUCKETS[2]!
}

const LENGTH_BUCKETS = ['1 day', '2 to 3 days', '4 to 7 days', '8 to 14 days', '15 to 28 days']

export function lengthBucket(days: number): string {
  if (days <= 1) return LENGTH_BUCKETS[0]!
  if (days <= 3) return LENGTH_BUCKETS[1]!
  if (days <= 7) return LENGTH_BUCKETS[2]!
  if (days <= 14) return LENGTH_BUCKETS[3]!
  return LENGTH_BUCKETS[4]!
}

/** The first `limit` combinations of the rest-window sweep (all of them by default). */
export function windowRows(limit = Infinity): WindowRow[] {
  return restWindowCombos(athletes())
    .slice(0, limit)
    .map((c) => ({
      ...planRow(c.name, c.name, withWindows(c.athlete, c.window)),
      reasonMode: `${c.window.reason} / ${c.window.mode}`,
      lengthBucket: lengthBucket(daysBetween(c.window.startDate, c.window.endDate) + 1),
      startBucket: startBucket(daysBetween(TODAY, c.window.startDate)),
    }))
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

const NA = 'n/a'

/** `toFixed` without a negative zero. */
export function fix(n: number, digits = 1): string {
  const s = n.toFixed(digits)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}
const num = (n: number | null, digits = 1): string => (n === null ? NA : fix(n, digits))
const pct = (share: number | null, digits = 1): string =>
  share === null ? NA : `${fix(share * 100, digits)}%`
const signed = (n: number): string => (n > 0 ? `+${fix(n)}` : fix(n))
const zones = (z: ZoneShares | null): string =>
  z === null ? NA : `${fix(z.z1)} / ${fix(z.z2)} / ${fix(z.z3)}`

/** The label of a figure: its weakest grade and its rule ids, or "no rule". */
const label = (f: Figure<unknown>): string =>
  f.grade === null ? 'no rule' : `${f.grade}, ${f.rule}`

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n')
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length
const present = (values: ReadonlyArray<number | null>): number[] =>
  values.flatMap((v) => (v === null ? [] : [v]))

/** `median (low to high)` of the values that exist, with how many there are when some do not. */
export function spread(values: ReadonlyArray<number | null>, fmt: (n: number) => string): string {
  const have = present(values)
  if (have.length === 0) return NA
  const text = `${fmt(median(have)!)} (${fmt(Math.min(...have))} to ${fmt(Math.max(...have))})`
  return have.length < values.length ? `${text} [${have.length} of ${values.length}]` : text
}

// ---------------------------------------------------------------------------------------------
// Figures as numbers
// ---------------------------------------------------------------------------------------------

/** The `describePlan` figure each column reads, for its grade and rule. */
const FIGURES = {
  steps: (d: PlanDescription) => d.steps,
  softHeadroom: (d: PlanDescription) => d.headroom.soft,
  ceilingHeadroom: (d: PlanDescription) => d.headroom.ceiling,
  plateau: (d: PlanDescription) => d.plateau,
  peak: (d: PlanDescription) => d.peak,
  longRun: (d: PlanDescription) => d.longRunShare,
  runDays: (d: PlanDescription) => d.runDays,
  distribution: (d: PlanDescription) => d.distribution,
  polarization: (d: PlanDescription) => d.polarization,
  load: (d: PlanDescription) => d.load,
  monotony: (d: PlanDescription) => d.monotony,
  cycle: (d: PlanDescription) => d.cycle,
  taper: (d: PlanDescription) => d.taper,
} satisfies Record<string, (d: PlanDescription) => Figure<unknown>>

type FigureKey = keyof typeof FIGURES

interface Metric {
  head: string
  figure: FigureKey | null
  get: (r: PlanRow) => number | null
  fmt: (n: number) => string
}

const whole = (n: number) => fix(n, 0)
const share = (n: number) => pct(n)
const rowsOver = (h: HeadroomFigure): number => h.rows.filter((r) => r.headroomMin < 0).length

const METRICS = {
  weeks: { head: 'Weeks', figure: null, get: (r) => r.d.weeks.length, fmt: whole },
  peakMin: {
    head: 'Peak min',
    figure: 'peak',
    get: (r) => r.d.peak.value?.targetMin ?? null,
    fmt: whole,
  },
  peakPosition: {
    head: 'First at highest (week)',
    figure: 'peak',
    get: (r) => r.d.peak.value?.position ?? null,
    fmt: whole,
  },
  peakWeeksOut: {
    head: 'Peak weeks before race week',
    figure: 'peak',
    get: (r) => r.d.peak.value?.weeksBeforeRace ?? null,
    fmt: whole,
  },
  plateauShare: {
    head: 'Loading weeks within 5% of peak',
    figure: 'plateau',
    get: (r) => {
      const p = r.d.plateau.value
      return p === null || p.loadingWeeks === 0 ? null : p.weeksWithin / p.loadingWeeks
    },
    fmt: share,
  },
  longestPlateau: {
    head: 'Longest run of weeks within 5%',
    figure: 'plateau',
    get: (r) => r.d.plateau.value?.longestRun ?? null,
    fmt: whole,
  },
  medianStep: {
    head: 'Median step',
    figure: 'steps',
    get: (r) => r.d.steps.value.median,
    fmt: share,
  },
  maxStep: { head: 'Max step', figure: 'steps', get: (r) => r.d.steps.value.max, fmt: share },
  softTightest: {
    head: 'Soft step, tightest headroom (min)',
    figure: 'softHeadroom',
    get: (r) => r.d.headroom.soft.value.tightestMin,
    fmt: whole,
  },
  ceilingTightest: {
    head: 'Two-week ceiling, tightest headroom (min)',
    figure: 'ceilingHeadroom',
    get: (r) => r.d.headroom.ceiling.value.tightestMin,
    fmt: whole,
  },
  longRunMean: {
    head: 'Long run share, mean',
    figure: 'longRun',
    get: (r) => r.d.longRunShare.value.mean,
    fmt: share,
  },
  longRunMax: {
    head: 'Long run share, max',
    figure: 'longRun',
    get: (r) => r.d.longRunShare.value.max,
    fmt: share,
  },
  runDaysMedian: {
    head: 'Run days, median',
    figure: 'runDays',
    get: (r) => r.d.runDays.value.median,
    fmt: (n) => fix(n, 1),
  },
  peakLoad: {
    head: 'Peak planned load',
    figure: 'load',
    get: (r) => {
      const loads = r.d.load.value.map((l) => l.load)
      return loads.length === 0 ? null : Math.max(...loads)
    },
    fmt: whole,
  },
  monotonyMean: {
    head: 'Monotony, mean',
    figure: 'monotony',
    get: (r) => mean(present(r.d.monotony.value.map((m) => m.monotony))),
    fmt: (n) => fix(n, 2),
  },
  strainMax: {
    head: 'Strain, max',
    figure: 'monotony',
    get: (r) => {
      const strains = present(r.d.monotony.value.map((m) => m.strain))
      return strains.length === 0 ? null : Math.max(...strains)
    },
    fmt: whole,
  },
  cycleLongest: {
    head: 'Loading weeks between recovery weeks, longest',
    figure: 'cycle',
    get: (r) => r.d.cycle.value.longestRun,
    fmt: whole,
  },
  cycleCut: {
    head: 'Recovery week cut, mean',
    figure: 'cycle',
    get: (r) => r.d.cycle.value.meanCutShare,
    fmt: share,
  },
  taperWeeks: {
    head: 'Taper weeks',
    figure: 'taper',
    get: (r) => r.d.taper.value?.weeks ?? null,
    fmt: whole,
  },
  taperDays: {
    head: 'Taper days',
    figure: 'taper',
    get: (r) => r.d.taper.value?.days ?? null,
    fmt: whole,
  },
  taperFraction: {
    head: 'Taper mean fraction of last loading week',
    figure: 'taper',
    get: (r) => r.d.taper.value?.meanFraction ?? null,
    fmt: (n) => fix(n, 2),
  },
} satisfies Record<string, Metric>

type MetricKey = keyof typeof METRICS

/** A column head with the grade and rule of its figure, read from the first plan. */
function head(key: MetricKey, first: PlanRow): string {
  const metric: Metric = METRICS[key]
  return metric.figure === null
    ? metric.head
    : `${metric.head} (${label(FIGURES[metric.figure](first.d))})`
}

function cell(key: MetricKey, r: PlanRow): string {
  const metric: Metric = METRICS[key]
  const value = metric.get(r)
  return value === null ? NA : metric.fmt(value)
}

// ---------------------------------------------------------------------------------------------
// The matrix: one row per athlete (5.1)
// ---------------------------------------------------------------------------------------------

const NOTES = [
  // 1
  "Headroom is the soft step or the two-week ceiling of G-2 minus the week's target, against the highest of the preceding loading weeks, as a pure ratio (`limit - target`). It does not model the novice minimum step (`g2.noviceMinStepMin`), the rebuild zone of the load setting (G-8), the tightened ramps of G-3 (a bone stress injury in the profile), the start-path exemptions (the E6 ladder and restart floor weeks) or the return weeks after a rest window (J7), so a plan built under one of them reads a negative figure here: novice-5k and post-marathon-short-run do, by design. A negative figure describes the formula, not the plan; the engine applies the limits and `matrix.test.ts` asserts them.",
  // 2
  "Declared is the week's `tid` weighted by target minutes. Realised is read from the sessions' steps: strides count in zone 3, and race pace counts in zone 2 above 10 km and in zone 3 at 5 and 10 km. Those are two choices of this report that rule E4 does not make, so the two distributions differ on real plans.",
  // 3
  'The first week of a draft starts before today when the plan is made in mid-week. Its whole-week target is used, a step from it is counted as a step from a part week, and monotony and strain are not computed for it.',
  // 4
  "Peak week is the first loading week with the plan's highest target. The plateau, the loading weeks within 5% of that peak, is a preference of this report; no rule sets it.",
  // 5
  "Treff's polarization index is a value with the order of the zones, never a label: its 2.00 cut-off has no engine rule, and Treff calls a distribution polarized only when Z1 > Z3 > Z2 [treff-2019-polarization-index, a hypothesis paper].",
  // 6
  'Planned load is the minutes of a session times the midpoint of `expectedRpe` for its kind, in relative units. Monotony and strain come from the seven daily loads of a whole week through `monotonyStrain` and carry no flag, as a plan has no range of its own [foster-1998-monotony-strain].',
  // 7
  `A band row is a published plan's figure, labelled "${BAND_LABEL}": a convention, not evidence, and no engine rule rests on it. The distance from the band is printed beside the figure (0 inside the band, else signed to the nearest edge) and is never minimised.`,
] as const

const noteRef = (n: number): string => `note ${n}`

function shapeTable(rows: readonly PlanRow[]): string {
  const first = rows[0]!
  const keys: MetricKey[] = [
    'weeks',
    'peakMin',
    'peakPosition',
    'peakWeeksOut',
    'plateauShare',
    'longestPlateau',
    'medianStep',
    'maxStep',
  ]
  return table(
    [
      'Athlete',
      'Goal',
      ...keys.map((k) => head(k, first)),
      `Steps from a part week (${label(first.d.steps)}; ${noteRef(3)})`,
    ],
    rows.map((r) => [
      r.id,
      r.input.goal.distanceClass,
      ...keys.map((k) => {
        if (k !== 'plateauShare') return cell(k, r)
        const p = r.d.plateau.value
        return p === null ? NA : `${p.weeksWithin} of ${p.loadingWeeks}`
      }),
      String(r.d.steps.value.rows.filter((s) => s.fromPartial).length),
    ]),
  )
}

function headroomTable(rows: readonly PlanRow[]): string {
  const first = rows[0]!
  const over = (h: HeadroomFigure) => `${rowsOver(h)} of ${h.rows.length}`
  return table(
    [
      'Athlete',
      head('softTightest', first),
      `Weeks over the soft figure (${label(first.d.headroom.soft)})`,
      head('ceilingTightest', first),
      `Weeks over the ceiling figure (${label(first.d.headroom.ceiling)})`,
    ],
    rows.map((r) => [
      r.id,
      cell('softTightest', r),
      over(r.d.headroom.soft.value),
      cell('ceilingTightest', r),
      over(r.d.headroom.ceiling.value),
    ]),
  )
}

function compositionTable(rows: readonly PlanRow[]): string {
  const first = rows[0]!
  const index = (i: { value: number | null; order: string } | null): string =>
    i === null ? NA : `${num(i.value, 2)} (${i.order})`
  return table(
    [
      'Athlete',
      head('longRunMean', first),
      head('longRunMax', first),
      `Run days, min / median / max (${label(first.d.runDays)})`,
      `Declared Z1 / Z2 / Z3 % (${label(first.d.distribution)})`,
      `Realised Z1 / Z2 / Z3 % (${label(first.d.distribution)}; ${noteRef(2)})`,
      `Treff index, declared (${label(first.d.polarization)}; ${noteRef(5)})`,
      `Treff index, realised (${label(first.d.polarization)}; ${noteRef(5)})`,
    ],
    rows.map((r) => {
      const days = r.d.runDays.value
      const pol = r.d.polarization.value
      return [
        r.id,
        cell('longRunMean', r),
        cell('longRunMax', r),
        `${num(days.min, 0)} / ${num(days.median)} / ${num(days.max, 0)}`,
        zones(r.d.distribution.value.declared),
        zones(r.d.distribution.value.realised),
        index(pol.declared),
        index(pol.realised),
      ]
    }),
  )
}

function loadTable(rows: readonly PlanRow[]): string {
  const first = rows[0]!
  const keys: MetricKey[] = [
    'peakLoad',
    'monotonyMean',
    'strainMax',
    'cycleLongest',
    'cycleCut',
    'taperWeeks',
    'taperDays',
    'taperFraction',
  ]
  return table(
    ['Athlete', ...keys.map((k) => head(k, first))],
    rows.map((r) => [r.id, ...keys.map((k) => cell(k, r))]),
  )
}

// ---------------------------------------------------------------------------------------------
// Bands (5.2)
// ---------------------------------------------------------------------------------------------

const range = (band: Band): string => `${band.lo} to ${band.hi}`
const withDistance = (value: number | null, distance: number | null, digits = 1): string =>
  value === null || distance === null ? NA : `${fix(value, digits)} (${signed(distance)})`

function knoppSection(rows: readonly PlanRow[]): string {
  const marathons = rows.flatMap((r) => {
    const result = knoppRows(r.bands)
    return result === null ? [] : [{ r, result }]
  })
  const keys = ['build', 'peak-first', 'peak-last', 'taper', 'final-week', 'runs'] as const
  const intro = [
    `### Knopp et al. 2024: marathon plans, last 12 weeks`,
    '',
    `Source ${KNOPP.source} (DOI ${KNOPP.doi}, ${KNOPP.licence}), read ${KNOPP.readOn} from the Europe PMC full text ${KNOPP.fullText}: Results "Progression of Training Plan" (build-up, taper and final week), Table 4 (peak week) and Table 3 (runs a week). Label on every row: ${BAND_LABEL} (${noteRef(7)}).`,
    '',
    "A band is the range of the three tier means (plans with a peak week over 90 km, 65 to 90 km and under 65 km). The spread between the paper's plans is wider, with standard deviations of 1 to 24 points, so a plan outside a band is not an outlier. The window is the last 12 weeks before the race week (weeks 11 to 0, whole weeks of the plan only). Minutes stand in for kilometres, the race itself is left out of the race week as in the paper, and a tie at the highest week is read at both ends: the build-up is measured to the first, the taper from the last. Each cell is the plan's figure with its distance from the band in brackets.",
    '',
  ]
  if (marathons.length === 0) return [...intro, 'No marathon plan in this set.'].join('\n')
  return [
    ...intro,
    table(
      [
        'Plan',
        'Window weeks',
        'Build-up (% a week)',
        'Peak, first (weeks before race week)',
        'Peak, last',
        'Taper (% a week)',
        'Final week (%)',
        'Run days a week',
        'Label',
      ],
      [
        [
          'band',
          String(KNOPP.windowWeeks),
          range(knoppBand('buildPctPerWeek')),
          range(knoppBand('peakWeeksBeforeRace')),
          range(knoppBand('peakWeeksBeforeRace')),
          range(knoppBand('taperMeanDecreasePct')),
          range(knoppBand('finalWeekDecreasePct')),
          range(knoppBand('runsPerWeek')),
          BAND_LABEL,
        ],
        ...marathons.map(({ r, result }) => [
          r.id,
          String(result.windowWeeks),
          ...keys.map((k) => {
            const b = result.rows.find((x) => x.key === k)!
            return withDistance(b.value, b.distance, k === 'runs' ? 2 : 1)
          }),
          BAND_LABEL,
        ]),
      ],
    ),
  ].join('\n')
}

function programmeSection(rows: readonly PlanRow[]): string {
  const found = rows.flatMap((r) => {
    const result = programmeRows(r.bands)
    return result === null ? [] : [{ r, result }]
  })
  const intro = [
    '### 5 and 10 km programme pages and the start ladder',
    '',
    `Records with a week table: ${PROGRAMMES.map((p) => p.id).join(', ')}. Each is a corpus record of grade D (a published programme, a convention). The start ladder is the NHS and Clark Couch-to-5K tables, which rule E6 follows: a plan with a run-walk session is read against the start records, any other plan against the records for a runner who already runs. A figure is compared only where a record states it in the plan's unit, so a long run a record gives in miles is listed and not turned into minutes. Galloway's run-walk schedule (no goal race) and Johnson's article (no table) are not used, and book descriptors belong to task S3. Label on every row: ${BAND_LABEL} (${noteRef(7)}).`,
    '',
  ]
  if (found.length === 0) return [...intro, 'No 5 or 10 km plan in this set.'].join('\n')
  const body = found.flatMap(({ r, result }) => {
    const goal = r.input.goal.distanceClass
    if (result.rows.length === 0) {
      return [[r.id, goal, result.audience, NA, NA, NA, NA, 'no record in the corpus', BAND_LABEL]]
    }
    return result.rows.map((b) => [
      r.id,
      goal,
      result.audience,
      b.figure,
      b.value === null ? NA : `${fix(b.value)} ${b.unit}`,
      `${range(b.band)} ${b.unit}`,
      b.distance === null ? NA : signed(b.distance),
      b.source,
      BAND_LABEL,
    ])
  })
  const milesOnly = [...new Set(found.flatMap(({ result }) => result.milesOnly))]
  return [
    ...intro,
    table(
      ['Plan', 'Goal', 'Read against', 'Figure', 'Value', 'Band', 'Distance', 'Records', 'Label'],
      body,
    ),
    '',
    milesOnly.length === 0
      ? ''
      : `Long run stated in miles only, not compared: ${milesOnly.join(', ')}.`,
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// Scorecards (5.5)
// ---------------------------------------------------------------------------------------------

type Score = readonly [figure: string, value: string, grade: string, rule: string]

function split(f: Figure<unknown>): [string, string] {
  return f.grade === null ? ['-', 'no rule'] : [f.grade, f.rule ?? 'no rule']
}

function scoreRows(r: PlanRow): Score[] {
  const d = r.d
  const out: Score[] = []
  const add = (figure: string, value: string, f: Figure<unknown> | null) => {
    const [grade, rule] = f === null ? ['-', 'no rule'] : split(f)
    out.push([figure, value, grade, rule])
  }
  const count = (type: string) => d.weeks.filter((w) => w.type === type).length
  add(
    'Weeks (loading / recovery / taper / race / post-race)',
    `${d.weeks.length} (${count('loading')} / ${count('recovery')} / ${count('taper')} / ${count('race')} / ${count('post-race')})`,
    null,
  )
  const peak = d.peak.value
  add(
    'Peak week',
    peak === null
      ? NA
      : `${peak.targetMin} min, week ${peak.position} of ${d.weeks.length}, ${peak.weeksBeforeRace} weeks before the race week (${noteRef(4)})`,
    d.peak,
  )
  const plateau = d.plateau.value
  add(
    'Plateau: loading weeks within 5% of the peak',
    plateau === null
      ? NA
      : `${plateau.weeksWithin} of ${plateau.loadingWeeks}; longest run of consecutive weeks ${plateau.longestRun}`,
    d.plateau,
  )
  const steps = d.steps.value
  add(
    'Steps between loading weeks: median / max',
    `${pct(steps.median)} / ${pct(steps.max)} over ${steps.rows.length} steps, ${steps.rows.filter((s) => s.fromPartial).length} from a part week`,
    d.steps,
  )
  const headroom = (name: string, f: Figure<HeadroomFigure>) =>
    add(
      `G-2 ${name}: tightest headroom (${noteRef(1)})`,
      f.value.tightestMin === null
        ? NA
        : `${signed(f.value.tightestMin)} min; ${rowsOver(f.value)} of ${f.value.rows.length} weeks over the figure`,
      f,
    )
  headroom('soft step', d.headroom.soft)
  headroom('two-week ceiling', d.headroom.ceiling)
  add(
    'Long run, share of the week: mean / max',
    `${pct(d.longRunShare.value.mean)} / ${pct(d.longRunShare.value.max)}`,
    d.longRunShare,
  )
  add(
    'Intensity distribution, declared Z1 / Z2 / Z3 %',
    zones(d.distribution.value.declared),
    d.distribution,
  )
  add(
    `Intensity distribution, realised Z1 / Z2 / Z3 % (${noteRef(2)})`,
    zones(d.distribution.value.realised),
    d.distribution,
  )
  const pol = d.polarization.value
  const index = (i: { value: number | null; order: string } | null): string =>
    i === null ? NA : `${num(i.value, 2)} (${i.order})`
  add(
    `Treff polarization index, declared / realised (${noteRef(5)})`,
    `${index(pol.declared)} / ${index(pol.realised)}`,
    d.polarization,
  )
  add(
    `Planned load, relative units: peak week / mean (${noteRef(6)})`,
    `${cell('peakLoad', r)} / ${fix(mean(d.load.value.map((l) => l.load)) ?? 0, 0)}`,
    d.load,
  )
  add(
    `Monotony mean, strain max (whole weeks; ${noteRef(6)})`,
    `${cell('monotonyMean', r)}, ${cell('strainMax', r)}`,
    d.monotony,
  )
  const cycle = d.cycle.value
  add(
    'Recovery cycle: loading weeks between recovery weeks (longest), mean cut',
    `${num(cycle.longestRun, 0)}, ${pct(cycle.meanCutShare)}; declared ${cycle.declared ?? 'automatic'}; rule values ${cycle.reference.defaultWorkWeeks} work weeks (${cycle.reference.flaggedWorkWeeks} when flagged), cut ${cycle.reference.cutPct}%`,
    d.cycle,
  )
  const taper = d.taper.value
  add(
    'Taper: weeks / days / mean fraction of the last loading week',
    taper === null
      ? 'no taper weeks'
      : `${taper.weeks} / ${taper.days} / ${num(taper.meanFraction, 2)}; rule values up to ${taper.reference.maxDays} days, mean fraction ${taper.reference.meanVolumeFraction[0]} to ${taper.reference.meanVolumeFraction[1]}`,
    d.taper,
  )
  const days = d.runDays.value
  add(
    'Run days a week, loading weeks: min / median / max',
    `${num(days.min, 0)} / ${num(days.median)} / ${num(days.max, 0)}`,
    d.runDays,
  )
  for (const b of bandRowsOf(r)) {
    out.push([
      b.figure,
      b.value === null || b.distance === null
        ? `${NA} (the plan has no such figure)`
        : `${fix(b.value)} ${b.unit}; band ${range(b.band)}; distance ${signed(b.distance)}`,
      'D',
      `practice source: ${b.source}`,
    ])
  }
  return out
}

function bandRowsOf(r: PlanRow): BandRow[] {
  return [...(knoppRows(r.bands)?.rows ?? []), ...(programmeRows(r.bands)?.rows ?? [])]
}

/** One block per plan: figure, value, grade and rule. No overall score. */
export function scorecard(r: PlanRow): string {
  const first = r.plan.weeks[0]?.weekStart ?? NA
  return [
    `### Scorecard: ${r.id} (${r.label})`,
    '',
    `Goal ${r.input.goal.distanceClass} on ${r.input.goal.date}; ${r.plan.weeks.length} weeks from ${first}. No overall score.`,
    '',
    table(
      ['Figure', 'Value', 'Grade', 'Rule'],
      scoreRows(r).map((s) => [...s]),
    ),
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/** The matrix: the 5.1 tables, the bands and a scorecard per athlete. Its digest is pinned. */
export function renderMatrixSection(rows: readonly PlanRow[] = matrixRows()): string {
  return [
    '## Matrix: twelve athletes',
    '',
    '### Shape and steps',
    '',
    shapeTable(rows),
    '',
    '### G-2 headroom',
    '',
    `A pure ratio: read ${noteRef(1)} before reading a negative figure.`,
    '',
    headroomTable(rows),
    '',
    '### Composition',
    '',
    compositionTable(rows),
    '',
    '### Load, recovery cycle and taper',
    '',
    loadTable(rows),
    '',
    '## Reference bands: matrix',
    '',
    knoppSection(rows),
    '',
    programmeSection(rows),
    '',
    '## Scorecards: matrix',
    '',
    rows.map(scorecard).join('\n\n'),
  ].join('\n')
}

type Metrics = readonly MetricKey[]
const SHAPE_STRATA: Metrics = ['weeks', 'peakWeeksOut', 'plateauShare', 'medianStep', 'maxStep']
const COMPOSITION_STRATA: Metrics = [
  'softTightest',
  'ceilingTightest',
  'longRunMean',
  'runDaysMedian',
  'monotonyMean',
]

/** Strata as rows: `n`, then the median with the range of each metric over the stratum's plans. */
function strataTable(
  title: string,
  groups: ReadonlyArray<readonly [string, readonly PlanRow[]]>,
  metrics: Metrics,
): string {
  const kept = groups.filter(([, rows]) => rows.length > 0)
  if (kept.length === 0) return ''
  const first = kept[0]![1][0]!
  return table(
    [title, 'Plans', ...metrics.map((k) => head(k, first))],
    kept.map(([name, rows]) => [
      name,
      String(rows.length),
      ...metrics.map((k) => spread(rows.map(METRICS[k].get), METRICS[k].fmt)),
    ]),
  )
}

function knoppStrata(
  groups: ReadonlyArray<readonly [string, readonly PlanRow[]]>,
  title: string,
): string {
  const keys = ['build', 'peak-first', 'peak-last', 'taper', 'final-week', 'runs'] as const
  const body: string[][] = []
  for (const [name, rows] of groups) {
    const results = rows.flatMap((r) => {
      const result = knoppRows(r.bands)
      return result === null ? [] : [result]
    })
    if (results.length === 0) continue
    body.push([
      name,
      String(results.length),
      ...keys.map((k) =>
        spread(
          results.map((res) => res.rows.find((x) => x.key === k)!.distance),
          signed,
        ),
      ),
      BAND_LABEL,
    ])
  }
  if (body.length === 0) return 'No marathon plan in this set.'
  return [
    `Distance from the Knopp band (${noteRef(7)}), median with the range over the plans; 0 is inside the band.`,
    '',
    table(
      [
        title,
        'Plans',
        'Build-up',
        'Peak, first',
        'Peak, last',
        'Taper',
        'Final week',
        'Run days',
        'Label',
      ],
      body,
    ),
  ].join('\n')
}

const groupBy = <T extends PlanRow>(
  rows: readonly T[],
  order: readonly string[],
  keyOf: (r: T) => string,
): Array<readonly [string, T[]]> =>
  order.map((name) => [name, rows.filter((r) => keyOf(r) === name)] as const)

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort()

/** The history sweep, stratified by goal kind and load position, and by years of running. */
export function renderHistorySection(rows: readonly HistoryRow[]): string {
  const kinds = sortedUnique(rows.map((r) => r.kind))
  const byKindPosition = kinds.flatMap((kind) =>
    POSITIONS.map(
      (position) =>
        [
          `${kind} / ${position}`,
          rows.filter((r) => r.kind === kind && r.position === position),
        ] as const,
    ),
  )
  const years = sortedUnique(rows.map((r) => String(r.years)))
  const byYears = groupBy(rows, years, (r) => String(r.years)).map(
    ([name, list]) => [`${name} year${name === '1' ? '' : 's'} of running`, list] as const,
  )
  const byPosition = groupBy(rows, POSITIONS, (r) => r.position)
  const runners = new Set(rows.map((r) => r.label)).size
  return [
    `## History sweep: ${runners} runners`,
    '',
    `Seed ${SWEEP_SEED}: a block of steady weeks of random size and age, sparse weeks since, and a goal of random kind and distance in time (\`tests/unit/engine/history-sweep.ts\`), each planned at ${POSITIONS.join(', ')}: ${rows.length} plans. Every cell is the median with the range (low to high) over the plans of the stratum; a cell with fewer values than plans says how many there are. The runners' history is synthetic.`,
    '',
    '### By goal kind and load position',
    '',
    strataTable('Stratum', byKindPosition, SHAPE_STRATA),
    '',
    strataTable('Stratum', byKindPosition, COMPOSITION_STRATA),
    '',
    '### By years of running',
    '',
    strataTable('Stratum', byYears, SHAPE_STRATA),
    '',
    strataTable('Stratum', byYears, COMPOSITION_STRATA),
    '',
    '### Marathon runners against the Knopp bands, by load position',
    '',
    knoppStrata(byPosition, 'Stratum'),
  ].join('\n')
}

/** The rest-window sweep, stratified by reason and mode and by the length of the window. */
export function renderWindowSection(rows: readonly WindowRow[]): string {
  const reasons = REST_SWEEP_KINDS.map((k) => `${k.reason} / ${k.mode}`)
  const byReason = groupBy(rows, reasons, (r) => r.reasonMode)
  const byLength = groupBy(rows, LENGTH_BUCKETS, (r) => r.lengthBucket)
  const byStart = groupBy(rows, START_BUCKETS, (r) => r.startBucket)
  return [
    `## Rest-window sweep: ${rows.length} plans`,
    '',
    `Seed ${REST_SWEEP_SEED}: every matrix athlete takes every reason and mode, ${REST_SWEEP_ROUNDS} times, at a start from 14 days back to 14 days ahead and in a length of 1, 3, 7, 14 or 28 days (\`tests/unit/engine/rest-window-sweep.ts\`). The window is read through the engine's \`Disruption\` path, and a window that ends at the race is shorter than its nominal length. The weeks around a window follow the restart share of J7, so steps out of a window week are large and the headroom reads negative by construction (note 1). Cells as in the history sweep.`,
    '',
    '### By reason and mode',
    '',
    strataTable('Stratum', byReason, SHAPE_STRATA),
    '',
    strataTable('Stratum', byReason, COMPOSITION_STRATA),
    '',
    '### By length of the window',
    '',
    strataTable('Stratum', byLength, SHAPE_STRATA),
    '',
    strataTable('Stratum', byLength, COMPOSITION_STRATA),
    '',
    '### By start of the window',
    '',
    strataTable('Stratum', byStart, SHAPE_STRATA),
    '',
    strataTable('Stratum', byStart, COMPOSITION_STRATA),
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

function renderHeader(): string {
  return [
    '# Plan report',
    '',
    'Report only. No figure below is a target, a limit or a verdict: it gates, caps and justifies nothing, there is no overall score and no acute:chronic ratio (G-5), and a change that moves a figure still enters through `research-update`. Each figure carries the grade and rule id of the Params it rests on, read from the registry ("no rule": the figure describes the draft and no engine rule rests on it).',
    '',
    `Params version ${PARAMS_VERSION}. Plans: the twelve athletes of the plan matrix (today ${TODAY}), the runners of the history sweep (seed ${SWEEP_SEED}) and the combinations of the rest-window sweep (seed ${REST_SWEEP_SEED}). The same input gives the same text: no clock and no run time is printed.`,
    '',
    'Notes',
    '',
    ...NOTES.map((text, i) => `${i + 1}. ${text}`),
  ].join('\n')
}

export interface ReportOptions {
  /** Runners of the history sweep (default: all of them). */
  history?: number
  /** Combinations of the rest-window sweep (default: all of them). */
  windows?: number
  /** Leave the two sweeps out. */
  matrixOnly?: boolean
}

/** Words the report must not contain: the G5 lint, and the words of the proposal's section 5. */
const FORBIDDEN = /\b(?:safe|safely|safety|unsafe)\b/i

/** Throws when `text` breaks the G5 lint or uses a word the report promises not to use. */
export function assertReportClean(text: string): void {
  assertCleanCopy(text, 'The plan report')
  const hit = FORBIDDEN.exec(text)
  if (hit !== null) throw new Error(`The plan report uses "${hit[0]}" at ${hit.index}`)
}

export function renderReport(options: ReportOptions = {}): string {
  const sections = [renderHeader(), renderMatrixSection()]
  if (options.matrixOnly !== true) {
    sections.push(
      renderHistorySection(historyRows(options.history)),
      renderWindowSection(windowRows(options.windows)),
    )
  }
  const text = `${sections.join('\n\n')}\n`
  assertReportClean(text)
  return text
}

function main(): void {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a !== '--matrix-only')
  if (unknown.length > 0) {
    console.error(
      `unknown argument ${unknown.join(' ')}\nusage: npm run plan:report [-- --matrix-only]`,
    )
    process.exit(2)
  }
  const started = Date.now()
  process.stdout.write(renderReport({ matrixOnly: args.includes('--matrix-only') }))
  console.error(`plan:report finished in ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
