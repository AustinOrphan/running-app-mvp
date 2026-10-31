import { useId, useMemo, useState } from 'react'
import { formatLoad } from '../../../shared/domain/weight.ts'
import type { Activity, StrengthLog, StrengthSet, WeightUnit } from '../../../shared/types.ts'
import { usePlan } from '../../api/plan.ts'
import { useStrengthLogOf, useStrengthUnits, useStrengthView } from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import { StrengthSheet } from '../lazySheets.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { workoutOfLog } from './strengthForm.ts'
import { pageWords, type PageWords } from './strengthPageText.ts'
import { measureOf } from './strengthText.ts'
import styles from './ActivitySets.module.css'

/** The sets of a log in the order they were done, each with its number among the sets of its exercise. */
function numbered(log: StrengthLog): Array<{ set: StrengthSet; number: number }> {
  const seen = new Map<string, number>()
  return [...log.sets]
    .sort((a, b) => a.position - b.position)
    .map((set) => {
      const number = (seen.get(set.exerciseId) ?? 0) + 1
      seen.set(set.exerciseId, number)
      return { set, number }
    })
}

/** A count in its measure: reps are the number, seconds and contacts say so. */
function countText(words: PageWords, set: StrengthSet): string {
  return measureOf(set.exerciseId) === 'reps'
    ? String(set.count)
    : words.say('strength.page.set-bare', {
        count: words.count(set.count),
        measure: words.measure(measureOf(set.exerciseId)),
      })
}

function SetsTable({
  log,
  words,
  weightUnit,
}: {
  log: StrengthLog
  words: PageWords
  weightUnit: WeightUnit
}) {
  return (
    <div
      className={styles.scroll}
      role="region"
      aria-label={words.say('strength.page.sets-label')}
      tabIndex={0}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{words.say('strength.page.col-exercise')}</th>
            <th scope="col">{words.say('strength.page.col-set')}</th>
            <th scope="col">{words.say('strength.page.col-load')}</th>
            <th scope="col">{words.say('strength.page.col-reps')}</th>
            <th scope="col">{words.say('strength.label.reps-left')}</th>
          </tr>
        </thead>
        <tbody>
          {numbered(log).map(({ set, number }) => (
            <tr key={set.position}>
              <th scope="row" className={styles.exercise}>
                {words.name(set.exerciseId)}
              </th>
              <td>{number}</td>
              <td className={styles.load}>
                {set.loadG === null
                  ? words.say('strength.page.lift-no-load')
                  : formatLoad(set.loadG, weightUnit)}
              </td>
              <td>{countText(words, set)}</td>
              <td className={styles.left}>
                {set.rir === null ? words.say('strength.page.sets-not-recorded') : set.rir}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The sets of a strength activity (design 11.4): a labelled table of its exercise, set, load in the
 * runner's weight unit, reps and reps left, with "Edit sets"; or, when the activity has no log
 * (an import, or a session saved without sets), "Add the sets". Both open the logging sheet: the
 * edit on the log as it was saved, the addition on the workout of the planned session the activity
 * is linked to, else the start of its day (the next planned session, else the week's maintenance
 * session), and attached to this activity. Nothing is worked out here: the sets and the workout are
 * the server's.
 */
export function ActivitySets({ activity }: { activity: Pick<Activity, 'id' | 'date'> }) {
  const headingId = useId()
  const units = useStrengthUnits()
  const log = useStrengthLogOf(activity.id)
  const view = useStrengthView()
  const plan = usePlan()
  const [sheet, setSheet] = useState<'edit' | 'add' | null>(null)
  const words = useMemo(
    () => (units.data === undefined ? null : pageWords(units.data.units, units.data.weightUnit)),
    [units.data],
  )
  const heading = pageWords('km', 'lb').say('strength.page.sets-heading')
  // the planned session this activity fulfils, whose workout "Add the sets" starts from
  const linked =
    plan.data?.sessions.find(
      (session) => session.activityId === activity.id && session.kind === 'strength',
    ) ?? null

  const loading = log.isPending || (units.data === undefined && !units.isError) || view.isPending
  const failed = (log.isError && log.data === undefined) || units.isError

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {heading}
      </h2>
      {failed ? (
        <>
          <p role="alert" className={styles.error}>
            {pageWords('km', 'lb').say('strength.page.sets-error')}
          </p>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                void log.refetch()
              }}
            >
              {pageWords('km', 'lb').say('strength.page.try-again')}
            </Button>
          </div>
        </>
      ) : loading || words === null || units.data === undefined ? (
        <Skeleton lines={3} />
      ) : (
        <>
          {log.data === null || log.data === undefined ? (
            <p className={styles.note}>{words.say('strength.page.sets-none')}</p>
          ) : (
            <SetsTable log={log.data} words={words} weightUnit={units.data.weightUnit} />
          )}
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                setSheet(log.data === null || log.data === undefined ? 'add' : 'edit')
              }}
            >
              {words.say(
                log.data === null || log.data === undefined
                  ? 'strength.label.add-sets'
                  : 'strength.label.edit-sets',
              )}
            </Button>
          </div>
        </>
      )}

      {sheet === 'edit' && log.data !== null && log.data !== undefined ? (
        <StrengthSheet
          workout={workoutOfLog(
            log.data,
            view.data?.settings.equipment ?? null,
            units.data?.weightUnit ?? 'lb',
          )}
          date={log.data.date}
          sessionId={null}
          log={log.data}
          onClose={() => {
            setSheet(null)
          }}
          onSaved={() => {
            setSheet(null)
          }}
        />
      ) : null}
      {sheet === 'add' ? (
        <StrengthSheet
          read={
            linked === null ? { date: activity.date } : { date: linked.date, sessionId: linked.id }
          }
          date={activity.date}
          sessionId={null}
          activityId={activity.id}
          onClose={() => {
            setSheet(null)
          }}
          onSaved={() => {
            setSheet(null)
          }}
        />
      ) : null}
    </section>
  )
}
