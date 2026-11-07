import { useId } from 'react'
import { Link } from 'react-router-dom'
import { gradeLegend } from '../../../shared/copy/grades.ts'
import { PACES_TEMPLATES, pacesText } from '../../../shared/copy/myPaces.ts'
import { render } from '../../../shared/copy/template.ts'
import type { EasyPace, MyPaces } from '../../../shared/engine/myPaces.ts'
import type { Units } from '../../../shared/types.ts'
import { GradeBadge } from '../GradeBadge.tsx'
import { HowMade } from './HowMade.tsx'
import { paceBandParts } from './format.ts'
import styles from './Paces.module.css'

const T = PACES_TEMPLATES

/** The sentence that says what easy running is here, and the heart rate it answers to. */
function leadLine(pace: EasyPace, units: Units): string {
  return pace.ceilingBpm === null
    ? pacesText('paces.easy.lead-zones')
    : render(T['paces.easy.lead-hr'], { ceiling: { kind: 'bpm', bpm: pace.ceilingBpm } }, units)
}

/** Where the range came from, in words. */
function basisLine(pace: EasyPace, units: Units): string {
  if (pace.basis === 'hr-model' && pace.sample !== null) {
    return render(
      T['paces.easy.basis-hr'],
      {
        runs: { kind: 'count', n: pace.sample.runs },
        since: { kind: 'date', iso: pace.sample.since, style: 'short' },
      },
      units,
    )
  }
  return pacesText(
    pace.basis === 'threshold-pace' ? 'paces.easy.basis-threshold' : 'paces.easy.basis-cs',
  )
}

/** Why the confidence is what it is, when it is not the plain moderate. */
function confidenceLine(pace: EasyPace, units: Units): string {
  if (pace.confidence === 'moderate') return pacesText('paces.easy.confidence-moderate')
  if (pace.ceilingBandBpm === null) return pacesText('paces.easy.confidence-low-cs')
  return render(
    T['paces.easy.confidence-low-age'],
    { band: { kind: 'bpm', bpm: Math.round(pace.ceilingBandBpm) } },
    units,
  )
}

/** What the figures are made from, one sentence each, with the rule it comes from. */
function howLines(pace: EasyPace): string[] {
  return [
    pacesText(pace.basis === 'hr-model' ? 'paces.easy.how-hr' : 'paces.easy.how-zones'),
    pacesText('paces.easy.how-scenarios'),
    pacesText('paces.easy.how-grade'),
  ]
}

function Scenario({ label, value }: { label: string; value: { value: string; unit: string } }) {
  return (
    <div className={styles.scenario}>
      <dt>{label}</dt>
      <dd>{`${value.value} ${value.unit}`}</dd>
    </div>
  )
}

/** What is missing for an easy pace, and the two ways to get one. */
function NoPace({ easy, units }: { easy: MyPaces['easy']; units: Units }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{pacesText('paces.easy.none-heading')}</p>
      {easy.hr.ceiling ? (
        <p className={styles.text}>
          {render(
            T['paces.easy.none-hr'],
            {
              need: { kind: 'count', n: easy.hr.need },
              min: { kind: 'minutes', min: easy.hr.minDurationMin },
              weeks: { kind: 'count', n: easy.hr.windowWeeks },
              have: { kind: 'count', n: easy.hr.runs },
            },
            units,
          )}
        </p>
      ) : (
        <p className={styles.text}>
          {pacesText('paces.easy.none-ceiling')}{' '}
          <Link to="/profile">{pacesText('paces.link.profile')}</Link>
        </p>
      )}
      <p className={styles.note}>
        {pacesText('paces.easy.none-test')} <a href="#test">{pacesText('paces.test.heading')}</a>
      </p>
    </div>
  )
}

export interface EasyPaceSectionProps {
  easy: MyPaces['easy']
  units: Units
}

/**
 * The easy pace as a lead figure (rule C9): the range, the heart rate it answers to, where it came
 * from and how far to trust it, then the same range on a hot day and on a climb. With no basis it
 * says what would give one. Every sentence is a template under the G5 lint.
 */
export function EasyPaceSection({ easy, units }: EasyPaceSectionProps) {
  const headingId = useId()
  const { pace } = easy
  return (
    <section id="easy" className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {pacesText('paces.easy.heading')}
      </h2>
      {pace === null ? (
        <NoPace easy={easy} units={units} />
      ) : (
        <>
          <div className={styles.hero}>
            <div className={styles.lead}>
              <p className={styles.figure}>
                <span className={styles.figureValue}>{paceBandParts(pace.range, units).value}</span>{' '}
                <span className={styles.figureUnit}>{paceBandParts(pace.range, units).unit}</span>
              </p>
              <p className={styles.text}>{leadLine(pace, units)}</p>
              <p className={styles.note}>{basisLine(pace, units)}</p>
              <div className={styles.badges}>
                <GradeBadge grade={pace.grade} />
                <span className={styles.note}>{confidenceLine(pace, units)}</span>
              </div>
              <p className={styles.note}>{gradeLegend([pace.grade])}</p>
            </div>
            <div className={styles.lead}>
              <dl className={styles.scenarios}>
                <Scenario
                  label={pacesText('paces.easy.row-cool')}
                  value={paceBandParts(pace.range, units)}
                />
                {pace.hot === null ? null : (
                  <Scenario
                    label={render(
                      T['paces.easy.row-hot'],
                      { wbgt: { kind: 'temp', c: pace.hot.wbgtC } },
                      units,
                    )}
                    value={paceBandParts(pace.hot.range, units)}
                  />
                )}
                <Scenario
                  label={render(
                    T['paces.easy.row-climb'],
                    { grade: { kind: 'percent', pct: pace.climb.gradePct } },
                    units,
                  )}
                  value={paceBandParts(pace.climb.range, units)}
                />
              </dl>
              <p className={styles.note}>
                {pace.hot === null
                  ? pacesText('paces.easy.hot-none')
                  : pacesText('paces.easy.scenarios')}
              </p>
            </div>
          </div>
          {pace.basis !== 'hr-model' && easy.hr.ceiling ? (
            <p className={styles.note}>
              {render(
                T['paces.easy.upgrade'],
                {
                  need: { kind: 'count', n: easy.hr.need },
                  weeks: { kind: 'count', n: easy.hr.windowWeeks },
                  have: { kind: 'count', n: easy.hr.runs },
                },
                units,
              )}
            </p>
          ) : null}
        </>
      )}
      <HowMade
        lines={pace === null ? [pacesText('paces.easy.how-zones')] : howLines(pace)}
        subject="the easy pace"
        rules={pace === null ? ['C9', 'C2', 'C4', 'A8'] : pace.rules}
      />
    </section>
  )
}
