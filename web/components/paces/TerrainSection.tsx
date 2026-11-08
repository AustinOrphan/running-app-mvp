import { useId } from 'react'
import {
  bandLabelText,
  bandWhyText,
  PACES_TEMPLATES,
  pacesText,
} from '../../../shared/copy/myPaces.ts'
import { render } from '../../../shared/copy/template.ts'
import { TERRAIN_EDGES_PCT } from '../../../shared/domain/terrainShape.ts'
import type { GradeBand, GradeCurve } from '../../../shared/engine/gradeCurve.ts'
import { minSignTestPairs } from '../../../shared/engine/gradeCurve.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'
import { ScrollTable } from '../ScrollTable.tsx'
import { HowMade } from './HowMade.tsx'
import styles from './Paces.module.css'

const T = PACES_TEMPLATES
const M_PER_KM = 1000
const PERCENT = 100

/** A fraction to whole percent, so a share reads "89%" and not "88.57%". */
function wholePercent(fraction: number): number {
  return Math.round(fraction * PERCENT) / PERCENT
}

/** A fraction floored to whole percent, so a row under "half or less" never rounds up to above it. */
function flooredPercent(fraction: number): number {
  return Math.floor(fraction * PERCENT + 1e-9) / PERCENT
}

/** Runs a grade must have been tested on: the Param, or the fewest the sign test can pass on. */
function testedRuns(): number {
  return Math.max(P.i13.minBacktestRuns.value, minSignTestPairs())
}

/** The sentence that says what is missing, or null when at least one grade shows the runner's own speed. */
function gapLine(curve: GradeCurve, units: Units): string | null {
  if (curve.eligibleRuns === 0) {
    return render(
      T['paces.terrain.none'],
      { min: { kind: 'minutes', min: P.i13.minFlatMin.value } },
      units,
    )
  }
  if (curve.bands.some((band) => band.source === 'personal')) return null
  return render(
    T['paces.terrain.sparse'],
    {
      minutes: { kind: 'minutes', min: P.i13.minBinMin.value },
      runs: { kind: 'count', n: P.i13.minBinRuns.value },
      tested: {
        kind: 'count',
        n: testedRuns(),
      },
    },
    units,
  )
}

/** The climbing grades that speak, with their walking share. */
function walkingBands(curve: GradeCurve): GradeBand[] {
  return curve.bands.filter((band) => band.midPct > 0 && band.walkShare !== null)
}

function Walking({ curve, units }: { curve: GradeCurve; units: Units }) {
  const rows = walkingBands(curve)
  return (
    <div className={styles.walk}>
      <h3 className={styles.subheading}>{pacesText('paces.terrain.walk-heading')}</h3>
      {curve.walkingFromPct !== null ? (
        <p className={styles.text}>
          {render(
            T['paces.terrain.walk-from'],
            { grade: { kind: 'percent', pct: curve.walkingFromPct } },
            units,
          )}
        </p>
      ) : rows.length > 0 ? (
        <>
          <p className={styles.text}>{pacesText('paces.terrain.walk-below')}</p>
          <dl className={styles.scenarios}>
            {rows.map((band) => (
              <div key={band.index} className={styles.scenario}>
                <dt>{bandLabelText(band, units)}</dt>
                <dd>
                  {render(
                    T['paces.terrain.walk-row'],
                    { share: { kind: 'share', fraction: flooredPercent(band.walkShare ?? 0) } },
                    units,
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className={styles.text}>
          {render(
            T['paces.terrain.walk-none'],
            {
              minutes: { kind: 'minutes', min: P.i13.minBinMin.value },
              runs: { kind: 'count', n: P.i13.minBinRuns.value },
            },
            units,
          )}
        </p>
      )}
      <p className={styles.note}>
        {render(
          T['paces.terrain.walk-floor'],
          { pace: { kind: 'pace', secPerKm: M_PER_KM / P.c9.walkingFloorMps.value } },
          units,
        )}
      </p>
    </div>
  )
}

/** What the figures are made from, one sentence each, with the rule it comes from. */
function howLines(units: Units): string[] {
  return [
    pacesText('paces.terrain.how-curve'),
    pacesText('paces.terrain.how-default'),
    render(
      T['paces.terrain.how-gate'],
      { gain: { kind: 'percent', pct: P.i13.minGainOverDefaultPct.value } },
      units,
    ),
    render(
      T['paces.terrain.how-gate-runs'],
      {
        level: { kind: 'percent', pct: P.i13.maxSignTestP.value * PERCENT },
        runs: { kind: 'count', n: testedRuns() },
      },
      units,
    ),
    render(
      T['paces.terrain.how-steep'],
      { grade: { kind: 'percent', pct: TERRAIN_EDGES_PCT[TERRAIN_EDGES_PCT.length - 1] ?? 0 } },
      units,
    ),
    render(
      T['paces.terrain.how-walk'],
      { pace: { kind: 'pace', secPerKm: M_PER_KM / P.c9.walkingFloorMps.value } },
      units,
    ),
    pacesText('paces.terrain.how-display'),
    pacesText('paces.terrain.how-grade'),
  ]
}

export interface TerrainSectionProps {
  curve: GradeCurve
  units: Units
}

/**
 * The runner's speed on each grade next to the default (rule I13, display only): what the figures
 * are, a table of every band with its source and the minutes behind it, the grade where walking
 * passes half the time, and how it is made. A band shows the runner's own speed only where the
 * engine's test passed; the table says which, and why not for the others. No verdict: the two
 * columns answer different questions and neither is called better.
 */
export function TerrainSection({ curve, units }: TerrainSectionProps) {
  const headingId = useId()
  const gap = gapLine(curve, units)
  return (
    <section id="grades" className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {pacesText('paces.terrain.heading')}
      </h2>
      <p className={styles.text}>{pacesText('paces.terrain.lead')}</p>
      {curve.eligibleRuns > 0 ? (
        <p className={styles.note}>
          {render(
            T['paces.terrain.basis'],
            {
              runs: { kind: 'count', n: curve.eligibleRuns },
              weeks: { kind: 'count', n: P.i13.windowWeeks.value },
              minutes: { kind: 'minutes', min: Math.round(curve.flatMinutes) },
            },
            units,
          )}
        </p>
      ) : null}
      {gap === null ? null : (
        <div className={styles.empty}>
          <p className={styles.text}>{gap}</p>
        </div>
      )}
      <ScrollTable label="Speed on each grade table">
        <table className={styles.table}>
          <caption className={styles.caption}>{pacesText('paces.terrain.table')}</caption>
          <thead>
            <tr>
              <th scope="col">{pacesText('paces.terrain.col-grade')}</th>
              <th scope="col">{pacesText('paces.terrain.col-speed')}</th>
              <th scope="col">{pacesText('paces.terrain.col-source')}</th>
              <th scope="col">{pacesText('paces.terrain.col-minutes')}</th>
            </tr>
          </thead>
          <tbody>
            {curve.bands.map((band) => (
              <tr key={band.index}>
                <th scope="row">{bandLabelText(band, units)}</th>
                <td className={styles.num}>
                  {render(
                    T['paces.terrain.share'],
                    { share: { kind: 'share', fraction: wholePercent(band.ratio) } },
                    units,
                  )}
                </td>
                <td>
                  <span className={styles.source}>
                    {pacesText(
                      band.reason === 'flat'
                        ? 'paces.terrain.why-flat'
                        : band.source === 'personal'
                          ? 'paces.terrain.src-personal'
                          : 'paces.terrain.src-default',
                    )}
                  </span>
                  {band.source === 'personal' || band.reason === 'flat' ? null : (
                    <span className={styles.why}>{bandWhyText(band.reason)}</span>
                  )}
                </td>
                <td className={styles.num}>
                  {render(
                    T['paces.terrain.minutes'],
                    { minutes: { kind: 'minutes', min: Math.round(band.minutes) } },
                    units,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <p className={styles.note}>{pacesText('paces.terrain.descent-note')}</p>
      <Walking curve={curve} units={units} />
      <HowMade
        lines={howLines(units)}
        subject="the speed by grade"
        rules={['I13', 'I11', 'C9', 'L5']}
      />
    </section>
  )
}
