// Grade-curve backtest report (`npm run grade:report`; rule I13, data-track batch D2-3): the
// leave-one-run-out test of the personal speed-by-grade curve against the Minetti default, on
// synthetic runners whose true curve is known, as Markdown on stdout.
//
// Report only. Nothing here is a target, a limit or a verdict, and it is not part of
// `npm run check`. The runners are made up (`tests/unit/engine/gradeCurve-fixtures.ts`); a figure
// from them says what the gate does with a known truth, never how a real runner's curve looks.
// Deterministic: seeded noise, no clock. Nothing under `shared/`, `server/`, `web/` or `scripts/`
// may import this file (`harness-isolation.test.ts`).
//
//   npm run grade:report
import { pathToFileURL } from 'node:url'
import { gradeCurve, type BandTest, type GradeCurve } from '../../shared/engine/gradeCurve.ts'
import { P } from '../../shared/engine/params/index.ts'
import {
  athlete,
  MINETTI_RATIOS,
  scaledCurve,
  syntheticRuns,
  type SyntheticAthlete,
} from '../unit/engine/gradeCurve-fixtures.ts'

/** The reference day of the synthetic runs. */
const TODAY = '2026-11-07'

interface Scenario {
  name: string
  who: SyntheticAthlete
  runs: number
  seed: number
}

export const SCENARIOS: readonly Scenario[] = [
  { name: 'A. follows Minetti, 40 runs', who: athlete(MINETTI_RATIOS), runs: 40, seed: 11 },
  { name: 'B. half of Minetti, 40 runs', who: athlete(scaledCurve(0.5)), runs: 40, seed: 12 },
  { name: 'C. 1.3 times Minetti, 40 runs', who: athlete(scaledCurve(1.3)), runs: 40, seed: 13 },
  { name: 'D. half of Minetti, 6 runs', who: athlete(scaledCurve(0.5)), runs: 6, seed: 14 },
  {
    name: 'E. half of Minetti, noisy, 40 runs',
    who: athlete(scaledCurve(0.5), 0.12),
    runs: 40,
    seed: 15,
  },
  {
    name: 'F. half of Minetti, intervals (flat variation 0.3), 40 runs',
    who: { ...athlete(scaledCurve(0.5)), flatCv: 0.3 },
    runs: 40,
    seed: 16,
  },
]

function pct(value: number): string {
  return `${value.toFixed(1)}`
}

function cells(test: BandTest | null): string {
  return test
    ? `${test.runs} | ${pct(test.maePersonalPct)} | ${pct(test.maeDefaultPct)} | ${pct(test.gainPct)}`
    : '- | - | - | -'
}

function band(curve: GradeCurve, index: number): string {
  const b = curve.bands[index]!
  const range =
    b.fromPct === null
      ? `below ${b.toPct}`
      : b.toPct === null
        ? `${b.fromPct} and up`
        : `${b.fromPct} to ${b.toPct}`
  return `| ${range} | ${b.runs} | ${b.minutes.toFixed(0)} | ${b.reason} | ${cells(b.test)} | ${b.source} |`
}

export function renderReport(): string {
  const lines: string[] = [
    '# Grade-curve backtest (report only)',
    '',
    `Rule I13, grade D. Parameters: window ${P.i13.windowWeeks.value} weeks, flat at least ${P.i13.minFlatMin.value} min, flat variation at most ${P.i13.maxFlatSpeedCv.value}, band at least ${P.i13.minBinMin.value} min in ${P.i13.minBinRuns.value} runs, prior ${P.i13.priorMin.value} min, gate: tested on ${P.i13.minBacktestRuns.value} runs and ${P.i13.minGainOverDefaultPct.value}% lower error than Minetti, with a sign test of at most ${P.i13.maxSignTestP.value} over the tested pairs.`,
    "Errors are mean absolute errors of a held-out run's band ratio, relative, in percent. Synthetic runners only.",
    '',
  ]
  for (const scenario of SCENARIOS) {
    const curve = gradeCurve(
      syntheticRuns(scenario.who, scenario.runs, TODAY, scenario.seed, 2),
      TODAY,
    )
    lines.push(
      `## ${scenario.name}`,
      '',
      `Eligible runs ${curve.eligibleRuns} of ${scenario.runs}, flat minutes ${curve.flatMinutes.toFixed(0)}.`,
      '',
      '| Grade band (%) | Runs | Minutes | Reason | Tested | Personal error | Minetti error | Gain | Shown |',
      '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |',
    )
    for (const b of curve.bands) if (b.reason !== 'flat') lines.push(band(curve, b.index))
    lines.push(
      '',
      curve.overall
        ? `All bands pooled: ${curve.overall.runs} tests, personal error ${pct(curve.overall.maePersonalPct)}, Minetti error ${pct(curve.overall.maeDefaultPct)}, gain ${pct(curve.overall.gainPct)}.`
        : 'All bands pooled: no band was tested.',
      `Bands that show the runner's own ratio: ${curve.bands.filter((b) => b.source === 'personal').length} of ${curve.bands.filter((b) => b.reason !== 'flat' && b.reason !== 'steep-end').length} (the flat band and the two open steep ends always show Minetti).`,
      '',
    )
  }
  return lines.join('\n')
}

function main(): void {
  process.stdout.write(`${renderReport()}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
