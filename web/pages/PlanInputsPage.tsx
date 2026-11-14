import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  planInputsCount as count,
  planInputsLine as line,
  planInputsText as text,
} from '../../shared/copy/planInputs.ts'
import { plural } from '../../shared/copy/quantity.ts'
import { PACES_TEMPLATES } from '../../shared/copy/myPaces.ts'
import { render } from '../../shared/copy/template.ts'
import type { PlanInputsView } from '../../shared/domain/planInputs.ts'
import { usePlanInputs } from '../api/planInputs.ts'
import { ErrorState } from '../components/ErrorState.tsx'
import { useLoadView } from '../components/loadView.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { boundarySourceText, ZONE_BOUNDARY_LABELS } from '../components/zoneFormat.ts'
import styles from '../components/paces/Paces.module.css'

const number = (n: number) => line('plan-inputs.value', { n: count(n) })

/** A heading, optional sentences, and rows of a label and a figure. */
function Section(props: {
  heading: string
  notes?: readonly string[]
  rows?: ReadonlyArray<readonly [label: string, value: string]>
  children?: ReactNode
}) {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {props.heading}
      </h2>
      {props.notes?.map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}
      {props.rows === undefined ? null : (
        <dl className={styles.scenarios}>
          {props.rows.map(([label, value]) => (
            <div key={label} className={styles.scenario}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {props.children}
    </section>
  )
}

function hrvNotes(view: PlanInputsView['hrv']): string[] {
  const used = {
    rmssd: 'plan-inputs.hrv.used-rmssd',
    sdnn: 'plan-inputs.hrv.used-sdnn',
    both: 'plan-inputs.hrv.used-both',
    none: 'plan-inputs.hrv.none',
  } as const
  const notes: string[] = [text(used[view.kind])]
  if (view.kind === 'rmssd' || view.kind === 'both') {
    notes.push(
      view.baselineKeeps === null
        ? line('plan-inputs.hrv.keeps-cycle', {
            lookback: count(view.lookbackDays),
            min: count(view.minReadings),
          })
        : line('plan-inputs.hrv.keeps', {
            keeps: count(view.baselineKeeps),
            lookback: count(view.lookbackDays),
            min: count(view.minReadings),
          }),
    )
  }
  return notes
}

function Body({ view }: { view: PlanInputsView }) {
  const { hrv, restingHr, sleep, runs, zones, sources } = view
  const named = sources.named.map((s) =>
    line('plan-inputs.sources.line', {
      label: s.label,
      activities: count(s.activities),
      wellness: count(s.wellnessDays),
    }),
  )
  const other =
    sources.other.activities + sources.other.wellnessDays > 0
      ? [
          line('plan-inputs.sources.other', {
            activities: count(sources.other.activities),
            wellness: count(sources.other.wellnessDays),
          }),
        ]
      : []
  const sourceLines = [...named, ...other]
  return (
    <div className={styles.page}>
      <Section
        heading={text('plan-inputs.hrv.heading')}
        notes={[line('plan-inputs.hrv.window', { days: count(view.wellnessWindowDays) })]}
        rows={[
          [text('plan-inputs.hrv.rmssd-days'), number(hrv.rmssdDays)],
          [text('plan-inputs.hrv.sdnn-days'), number(hrv.sdnnDays)],
          [text('plan-inputs.hrv.baseline'), number(hrv.baselineReadings)],
        ]}
      >
        {hrvNotes(hrv).map((note) => (
          <p key={note} className={styles.note}>
            {note}
          </p>
        ))}
      </Section>
      <Section
        heading={text('plan-inputs.rest.heading')}
        notes={[
          line('plan-inputs.rest.keeps', {
            keeps: count(restingHr.baselineKeeps),
            lookback: count(restingHr.lookbackDays),
            min: count(restingHr.minReadings),
          }),
        ]}
        rows={[
          [text('plan-inputs.rest.days'), number(restingHr.days)],
          [text('plan-inputs.rest.baseline'), number(restingHr.baselineReadings)],
        ]}
      />
      <Section
        heading={text('plan-inputs.sleep.heading')}
        notes={[
          line('plan-inputs.sleep.reads', {
            window: count(sleep.windowNights),
            min: count(sleep.minNights),
          }),
        ]}
        rows={[
          [
            line('plan-inputs.sleep.nights', {
              window: plural(sleep.windowNights, 'night'),
            }),
            number(sleep.nights),
          ],
        ]}
      />
      <Section
        heading={text('plan-inputs.runs.heading')}
        notes={[
          line('plan-inputs.runs.window', { days: count(runs.windowDays) }),
          text('plan-inputs.runs.note-stream'),
          text('plan-inputs.runs.note-checks'),
          runs.hrLine.fitted
            ? text('plan-inputs.runs.line-fitted')
            : line('plan-inputs.runs.line-open', { need: count(runs.hrLine.need) }),
        ]}
        rows={[
          [text('plan-inputs.runs.count'), number(runs.count)],
          [text('plan-inputs.runs.stream'), number(runs.withStream)],
          [text('plan-inputs.runs.altitude'), number(runs.withAltitude)],
          [text('plan-inputs.runs.strap'), number(runs.strap)],
          [text('plan-inputs.runs.wrist'), number(runs.wrist)],
          [text('plan-inputs.runs.unknown'), number(runs.unknown)],
          [text('plan-inputs.runs.passing'), number(runs.passing)],
          [
            line('plan-inputs.runs.line', { weeks: count(runs.hrLine.windowWeeks) }),
            line('plan-inputs.of', { n: count(runs.hrLine.runs), need: count(runs.hrLine.need) }),
          ],
        ]}
      />
      <Section
        heading={text('plan-inputs.zones.heading')}
        notes={[text('plan-inputs.zones.context')]}
        rows={zones.map(
          ({ key, boundary }) =>
            [
              ZONE_BOUNDARY_LABELS[key],
              boundary === null
                ? text('plan-inputs.zones.none')
                : `${boundarySourceText(boundary)}, as of ${boundary.asOf}`,
            ] as const,
        )}
      />
      <Section
        heading={text('plan-inputs.sources.heading')}
        notes={[text('plan-inputs.sources.context')]}
      >
        {sourceLines.length === 0 ? (
          <p className={styles.text}>{text('plan-inputs.sources.none')}</p>
        ) : (
          <ul className={styles.howList}>
            {sourceLines.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        )}
      </Section>
      <p className={styles.note}>{text('plan-inputs.how')}</p>
      <div className={styles.actions}>
        <Link to="/paces" className={styles.link}>
          {render(PACES_TEMPLATES['paces.link.from-profile'], {}, 'km')}
        </Link>
      </div>
    </div>
  )
}

/**
 * What the plan can see (rule T2): the data the engine reads for this runner and how much of it
 * there is, as counts from the same snapshot the engine reads. It sets no target and gives no
 * verdict on the data; the words are `shared/copy/planInputs.ts`.
 */
export function PlanInputsPage() {
  const inputs = usePlanInputs()
  const title = text('plan-inputs.title')
  const context = text('plan-inputs.context')
  const loaded = useLoadView({
    data: inputs.data,
    isError: inputs.isError,
    isFetching: inputs.isFetching,
  })
  if (loaded === 'failed' || loaded === 'retrying') {
    return (
      <>
        <PageHeader title={title} />
        <ErrorState
          subject={title}
          retrying={loaded === 'retrying'}
          onRetry={() => inputs.refetch()}
        />
      </>
    )
  }
  return (
    <>
      <PageHeader title={title} context={context} />
      {inputs.data === undefined ? <Skeleton lines={6} /> : <Body view={inputs.data} />}
    </>
  )
}
