import { useEffect, useId, useRef } from 'react'
import { countPhrase, formatQuantity } from '../../../shared/copy/quantity.ts'
import { formatLoad, fromGrams } from '../../../shared/domain/weight.ts'
import type { HistorySession, HistorySet } from '../../../shared/engine/strength.ts'
import type { StrengthLift, Units, WeightUnit } from '../../../shared/types.ts'
import { useExerciseHistory } from '../../api/strength.ts'
import { EstimatedMaxChart } from '../charts/lazyCharts.tsx'
import { Button } from '../Button.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { measureOf } from './strengthText.ts'
import type { PageWords } from './strengthPageText.ts'
import styles from './StrengthSections.module.css'

export interface LiftHistoryProps {
  /** The exercise chosen from the list; null until one is. */
  exerciseId: string | null
  words: PageWords
  units: Units
  weightUnit: WeightUnit
}

/**
 * A set in words: "110 lb x 5, 2 left"; "110 lb, 30 seconds" for a load held; "30 seconds" with no
 * load; and no "left" without a count of reps left.
 */
function setText(words: PageWords, exerciseId: string, set: HistorySet): string {
  const kind = measureOf(exerciseId)
  const measure = words.measure(kind)
  const count = words.count(set.count)
  const left = set.rir === null ? null : words.count(set.rir)
  if (set.loadG === null) {
    return left === null
      ? words.say('strength.page.set-bare', { count, measure })
      : words.say('strength.page.set-bare-left', { count, measure, left })
  }
  const load = words.load(set.loadG)
  if (kind === 'reps') {
    return left === null
      ? words.say('strength.page.set-reps', { load, count })
      : words.say('strength.page.set-reps-left', { load, count, left })
  }
  return left === null
    ? words.say('strength.page.set-load', { load, count, measure })
    : words.say('strength.page.set-load-left', { load, count, measure, left })
}

/** The one-line starting point the runner entered, when there is one. */
function anchorText(words: PageWords, anchor: StrengthLift): string {
  return anchor.kind === 'max'
    ? words.say('strength.page.anchor-max', { load: words.load(anchor.loadG) })
    : words.say('strength.page.anchor-set', {
        load: words.load(anchor.loadG),
        reps: countPhrase(anchor.reps, 'rep'),
      })
}

function SessionRow({
  words,
  exerciseId,
  session,
  units,
  weightUnit,
}: {
  words: PageWords
  exerciseId: string
  session: HistorySession
  units: Units
  weightUnit: WeightUnit
}) {
  return (
    <tr>
      <th scope="row">
        {formatQuantity(words.day(session.date, 'weekday'), units, weightUnit)}
        <small>{words.mode(session.mode)}</small>
      </th>
      <td>
        <ul className={styles.sets}>
          {session.sets.map((set) => (
            <li key={set.position}>{setText(words, exerciseId, set)}</li>
          ))}
        </ul>
      </td>
      <td>
        {session.estimateG === null
          ? words.say('strength.page.no-estimate')
          : formatLoad(session.estimateG, weightUnit)}
      </td>
    </tr>
  )
}

/**
 * The history of one lift (design 11.3, part 5): a table by date with the load and count of each
 * set, the reps left and the mode, and the estimated maximum of each session, which a line draws
 * above it (the lazy chart module; the table is its accessible form). Everything is read from
 * `GET /api/strength/exercises/:id`: the estimates are the server's, so the page works out none.
 */
export function LiftHistory({ exerciseId, words, units, weightUnit }: LiftHistoryProps) {
  const headingId = useId()
  const history = useExerciseHistory(exerciseId ?? undefined)
  const nameRef = useRef<HTMLHeadingElement>(null)

  // Choosing a lift takes focus to its name, so a keyboard and a screen reader land on the history
  // instead of staying on the button that was pressed.
  useEffect(() => {
    if (exerciseId !== null) nameRef.current?.focus()
  }, [exerciseId])

  const data =
    exerciseId !== null && history.data?.exerciseId === exerciseId ? history.data : undefined
  const exercise = exerciseId === null ? '' : words.name(exerciseId)
  const points =
    data === undefined
      ? []
      : data.sessions
          .filter((session) => session.estimateG !== null)
          .map((session) => ({
            label: formatQuantity(words.day(session.date, 'short'), units, weightUnit),
            value: fromGrams(session.estimateG ?? 0, weightUnit),
          }))
          .reverse()

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {words.say('strength.page.history-heading')}
      </h2>
      {exerciseId === null ? (
        <p className={styles.lead}>{words.say('strength.page.history-choose')}</p>
      ) : (
        <>
          <h3 ref={nameRef} tabIndex={-1} className={styles.subheading}>
            {exercise}
          </h3>
          {history.isError && data === undefined ? (
            <>
              <p role="alert" className={styles.error}>
                {words.say('strength.page.history-error')}
              </p>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void history.refetch()
                  }}
                >
                  {words.say('strength.page.try-again')}
                </Button>
              </div>
            </>
          ) : data === undefined ? (
            <Skeleton lines={4} />
          ) : (
            <>
              {data.anchor === null ? null : (
                <p className={styles.note}>{anchorText(words, data.anchor)}</p>
              )}
              {data.sessions.length === 0 ? (
                <p className={styles.lead}>{words.say('strength.page.history-empty')}</p>
              ) : (
                <>
                  {points.length >= 2 ? (
                    <EstimatedMaxChart
                      points={points}
                      name={words.say('strength.max-label')}
                      unit={weightUnit}
                    />
                  ) : (
                    <p className={styles.note}>{words.say('strength.page.chart-none')}</p>
                  )}
                  <div
                    role="region"
                    aria-label={words.say('strength.page.history-label', { exercise })}
                    tabIndex={0}
                    className={styles.scroll}
                  >
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">{words.say('strength.page.col-date')}</th>
                          <th scope="col">{words.say('strength.page.col-sets')}</th>
                          <th scope="col">{words.say('strength.page.col-estimate')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sessions.map((session) => (
                          <SessionRow
                            key={session.logId}
                            words={words}
                            exerciseId={data.exerciseId}
                            session={session}
                            units={units}
                            weightUnit={weightUnit}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className={styles.note}>{words.say('strength.page.history-note')}</p>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
