import { useId } from 'react'
import { Link } from 'react-router-dom'
import { gradeLegend } from '../../../shared/copy/grades.ts'
import { PACES_TEMPLATES, pacesText } from '../../../shared/copy/myPaces.ts'
import { render } from '../../../shared/copy/template.ts'
import type { MyPaces } from '../../../shared/engine/myPaces.ts'
import type { OwnCeilingReading } from '../../../shared/engine/ownCeiling.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'
import { GradeBadge } from '../GradeBadge.tsx'
import { HowMade } from './HowMade.tsx'
import styles from './Paces.module.css'

const T = PACES_TEMPLATES

type Ready = Extract<OwnCeilingReading, { status: 'ready' }>

/** How far the ceiling in use sits from the range the runs give, in words. */
function relationLine(reading: Ready, units: Units): string {
  const one = reading.low === reading.high
  if (reading.relation === 'within') {
    return pacesText(one ? 'paces.ceiling.within-one' : 'paces.ceiling.within')
  }
  const id = `paces.ceiling.${reading.relation}${one ? '-one' : ''}` as const
  return render(T[id], { gap: { kind: 'bpm', bpm: reading.gapBpm } }, units)
}

/** The runs a reading stands on: how many, and in which window; the range line only for a range. */
function basisLines(reading: Ready, units: Units): string[] {
  return [
    render(
      T['paces.ceiling.basis'],
      {
        runs: { kind: 'count', n: reading.runs },
        weeks: { kind: 'count', n: reading.windowWeeks },
      },
      units,
    ),
    ...(reading.low === reading.high ? [] : [pacesText('paces.ceiling.range')]),
  ]
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.scenario}>
      <dt>{label}</dt>
      <dd className="figure-type">{value}</dd>
    </div>
  )
}

function ReadingRows({ reading, units }: { reading: Ready; units: Units }) {
  const bpm = (n: number) => ({ kind: 'bpm', bpm: n }) as const
  return (
    <dl className={styles.scenarios}>
      <Row
        label={pacesText('paces.ceiling.row-in-use')}
        value={render(
          T['paces.ceiling.value-band'],
          { bpm: bpm(reading.inUse.bpm), band: bpm(Math.round(reading.inUse.bandBpm)) },
          units,
        )}
      />
      {reading.low === reading.high ? (
        // Three readings that round to the same figure are one figure, not a range.
        <Row
          label={pacesText('paces.ceiling.row-range')}
          value={render(T['paces.ceiling.value-one'], { bpm: bpm(reading.mid) }, units)}
        />
      ) : (
        <>
          <Row
            label={pacesText('paces.ceiling.row-range')}
            value={render(
              T['paces.ceiling.value-range'],
              { low: bpm(reading.low), high: bpm(reading.high) },
              units,
            )}
          />
          <Row
            label={pacesText('paces.ceiling.row-mid')}
            value={render(T['paces.ceiling.value-one'], { bpm: bpm(reading.mid) }, units)}
          />
        </>
      )}
    </dl>
  )
}

/** The state most runners see first: how many runs qualify of how many are needed, and what makes one qualify. */
function Needs({ reading, units }: { reading: OwnCeilingReading; units: Units }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{pacesText('paces.ceiling.few-heading')}</p>
      <p className={styles.text}>
        {render(
          T['paces.ceiling.few-count'],
          {
            have: { kind: 'count', n: reading.runs },
            need: { kind: 'count', n: reading.need },
            weeks: { kind: 'count', n: reading.windowWeeks },
          },
          units,
        )}
      </p>
      <WhatQualifies reading={reading} units={units} />
    </div>
  )
}

function WhatQualifies({ reading, units }: { reading: OwnCeilingReading; units: Units }) {
  return (
    <p className={styles.note}>
      {render(
        T['paces.ceiling.few-what'],
        {
          wbgt: { kind: 'temp', c: reading.maxWbgtC },
          min: { kind: 'minutes', min: reading.minDurationMin },
        },
        units,
      )}{' '}
      {pacesText('paces.ceiling.few-weather')}
    </p>
  )
}

function Body({ reading, units }: { reading: OwnCeilingReading; units: Units }) {
  switch (reading.status) {
    case 'missing':
      return (
        <div className={styles.empty}>
          {reading.missing.includes('maximum') ? (
            <p className={styles.text}>
              {pacesText('paces.ceiling.missing-maximum')}{' '}
              <Link to="/profile">{pacesText('paces.link.profile')}</Link>
            </p>
          ) : null}
          {reading.missing.includes('pace') ? (
            <p className={styles.text}>
              {pacesText('paces.ceiling.missing-pace')}{' '}
              <a href="#test">{pacesText('paces.test.heading')}</a>
            </p>
          ) : null}
        </div>
      )
    case 'too-few':
      return <Needs reading={reading} units={units} />
    case 'unclear':
      return (
        <div className={styles.empty}>
          <p className={styles.text}>{pacesText('paces.ceiling.unclear')}</p>
          <WhatQualifies reading={reading} units={units} />
        </div>
      )
    case 'ready':
      return (
        <div className={styles.lead}>
          <ReadingRows reading={reading} units={units} />
          <p className={styles.text}>{relationLine(reading, units)}</p>
          {basisLines(reading, units).map((line) => (
            <p key={line} className={styles.note}>
              {line}
            </p>
          ))}
        </div>
      )
  }
}

export interface OwnCeilingSectionProps {
  ownCeiling: MyPaces['easy']['ownCeiling']
  units: Units
}

/**
 * What the runner's own cool runs say about the top of zone 1 (rules C4, C8), beside the ceiling in
 * use: a range and its middle when the runs are enough, else how many qualify of how many are
 * needed and what makes a run qualify, or what is missing. Display only: applying a change stays
 * the offer on the review page. Every sentence is a template under the G5 lint.
 */
export function OwnCeilingSection({ ownCeiling, units }: OwnCeilingSectionProps) {
  const headingId = useId()
  const { reading, grade, rules } = ownCeiling
  return (
    <section id="ceiling" className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {pacesText('paces.ceiling.heading')}
      </h2>
      <p className={styles.note}>{pacesText('paces.ceiling.context')}</p>
      <Body reading={reading} units={units} />
      {reading.since === null ? null : (
        // Only runs after the last accepted change count, in every state.
        <p className={styles.note}>
          {render(
            T['paces.ceiling.since'],
            { date: { kind: 'date', iso: reading.since, style: 'short' } },
            units,
          )}
        </p>
      )}
      {reading.status === 'ready' ? (
        <>
          <div className={styles.badges}>
            <GradeBadge grade={grade} />
            <span className={styles.note}>{gradeLegend([grade])}</span>
          </div>
          <p className={styles.note}>
            {render(
              T['paces.ceiling.offer'],
              {
                lower: { kind: 'count', n: reading.needLower },
                higher: { kind: 'count', n: reading.needHigher },
              },
              units,
            )}{' '}
            {render(
              T['paces.ceiling.offer-gates'],
              {
                under: { kind: 'bpm', bpm: P.c8.ownLt1MinDeltaLowerBpm.value },
                over: { kind: 'bpm', bpm: P.c8.ownLt1MinDeltaRaiseBpm.value },
              },
              units,
            )}{' '}
            <Link to="/review">{pacesText('paces.link.review')}</Link>
          </p>
        </>
      ) : null}
      <HowMade
        lines={[
          pacesText('paces.ceiling.how-line'),
          pacesText('paces.ceiling.how-nested'),
          pacesText('paces.ceiling.how-cool'),
          pacesText('paces.ceiling.how-offer'),
          pacesText('paces.ceiling.how-raise'),
        ]}
        subject="the easy ceiling from your runs"
        rules={rules}
      />
    </section>
  )
}
