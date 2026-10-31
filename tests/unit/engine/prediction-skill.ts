// Prediction skill figures (evaluation harness, proposal
// `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` section 5.4, task H4;
// decision 12: descriptive only, the baseline and the interval score as back-test figures).
//
// Two figures for a back-test report, over predictions that have a recorded result:
//
//   - `baselineSkill`: the mean absolute error of the app's predictions over the mean absolute
//     error of a naive Riegel prediction made from the same prior race. 1 is no better than the
//     naive prediction, under 1 is better, over 1 is worse. Riegel is the yardstick because it
//     gave half of marathoners a time 10 minutes or more too fast [vickers-2016-race-times].
//   - `intervalScore`: the interval score of Gneiting and Raftery (2007, "Strictly proper scoring
//     rules, prediction, and estimation", JASA 102, section 6.2) for a central (1 - alpha) band,
//     averaged: the band's width plus 2 / alpha times the distance of the result outside it. It
//     is here because coverage alone rewards a wide band, and a wide band pays in the width term.
//     Not in `research/papers`: the proposal cites it for the formula only.
//
// Report only. Neither figure gates a write, changes a prediction, the minimum band (L6) or the
// back-test of rule L7 (`shared/engine/backtest.ts`), or appears on a page: showing either in the
// app would be a rule change with Params. Both are in seconds, so a long race weighs more than a
// short one; a mix of distances is read per distance.
//
// Pure and deterministic: no I/O, no clock. Nothing under `shared/`, `server/`, `web/` or
// `scripts/` may import this file (`tests/unit/reports/harness-isolation.test.ts`).

/**
 * The exponent of the naive prediction: Riegel's 1.06. A constant of its own, not
 * `P.l1.riegelExponent`, so the yardstick stays where it is if a research update moves the engine's
 * exponent. The naive prediction is plain Riegel from raw distances: no climb, no slowdown, no
 * personal exponent.
 */
export const NAIVE_RIEGEL_EXPONENT = 1.06

/**
 * One prediction held against its result, as a `PredictionLog` row after its race gives it:
 * `predictedSec`, `lowSec`, `highSec` and `actualSec` are the row's columns, `naiveSec` is the
 * naive prediction for the same course made from the same prior race (`riegelNaiveSec`). All in
 * seconds.
 */
export interface SkillRecord {
  predictedSec: number
  lowSec: number
  highSec: number
  actualSec: number
  naiveSec: number
}

/** A prior race: the anchor a prediction (and so its naive baseline) is made from. */
export interface Anchor {
  distanceM: number
  timeSec: number
}

/** The naive prediction: Riegel from the prior race, `T1 * (D2 / D1) ^ exponent`. */
export function riegelNaiveSec(
  anchor: Anchor,
  targetDistanceM: number,
  exponent: number = NAIVE_RIEGEL_EXPONENT,
): number {
  if (!(anchor.distanceM > 0) || !(anchor.timeSec > 0) || !(targetDistanceM > 0)) {
    throw new RangeError('A Riegel prediction needs a positive anchor distance, time and target.')
  }
  return anchor.timeSec * Math.pow(targetDistanceM / anchor.distanceM, exponent)
}

const FIELDS = ['predictedSec', 'lowSec', 'highSec', 'actualSec', 'naiveSec'] as const

/** Throws on a record that cannot be scored: a time that is not a positive number, or low > high. */
function assertScorable(records: readonly SkillRecord[]): void {
  records.forEach((record, i) => {
    for (const field of FIELDS) {
      const value = record[field]
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RangeError(`Record ${i}: ${field} is not a positive number (${String(value)}).`)
      }
    }
    if (record.lowSec > record.highSec) {
      throw new RangeError(
        `Record ${i}: lowSec ${record.lowSec} is above highSec ${record.highSec}.`,
      )
    }
  })
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * The skill of the app's predictions against the naive baseline: `MAE(app) / MAE(naive)`, with
 * MAE the mean of |actualSec - prediction| over the records. 1 means no better than naive, under
 * 1 better, over 1 worse. Null for no records, and for a naive baseline with no error at all (a
 * ratio to zero is undefined, and a baseline that is always right leaves nothing to beat).
 */
export function baselineSkill(records: readonly SkillRecord[]): number | null {
  if (records.length === 0) return null
  assertScorable(records)
  const naive = mean(records.map((r) => Math.abs(r.actualSec - r.naiveSec)))
  if (naive === 0) return null
  return mean(records.map((r) => Math.abs(r.actualSec - r.predictedSec))) / naive
}

/**
 * The interval score of one record for a central (1 - alpha) band [l, u] and a result x
 * (Gneiting and Raftery 2007): `(u - l) + (2 / alpha) (l - x) [x < l] + (2 / alpha) (x - u) [x > u]`.
 * A result on an edge is inside, as in `backtest.ts`.
 */
function scoreOne(record: SkillRecord, alpha: number): number {
  const { lowSec: l, highSec: u, actualSec: x } = record
  const outside = x < l ? l - x : x > u ? x - u : 0
  return u - l + (2 / alpha) * outside
}

/**
 * The mean interval score of the records' bands, read as central (1 - alpha) bands, in seconds
 * (lower is better; a band that holds every result still scores its own width). `alpha` is the
 * reader's choice, because the app's band states no probability: it is a least half-width (L2,
 * L4, L6), not a quantile. Null for no records; throws unless 0 < alpha < 1.
 */
export function intervalScore(records: readonly SkillRecord[], alpha: number): number | null {
  if (!(alpha > 0 && alpha < 1)) {
    throw new RangeError(`alpha must be between 0 and 1, exclusive (got ${String(alpha)}).`)
  }
  if (records.length === 0) return null
  assertScorable(records)
  return mean(records.map((r) => scoreOne(r, alpha)))
}
