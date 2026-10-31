import { useId, useState } from 'react'
import { isToRun } from '../../../shared/domain/sessionStatus.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { PlanSessionView } from '../../../shared/types.ts'
import { useStrengthUnits } from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import { ExplainButton } from '../ExplainButton.tsx'
import { StrengthSheet } from '../lazySheets.tsx'
import sheetStyles from '../SessionSheet.module.css'
import styles from './SessionStrengthSection.module.css'
import { strengthWords } from './strengthText.ts'
import { useSessionStrength } from './strengthToday.ts'
import { workoutRows } from './workoutRows.ts'

/**
 * The Strength section of the session sheet (design 11.2): the template and the week of the block,
 * the lifts with their loads and the reps left, the jumps and the trunk movements, "Why" for each
 * lift, the separation from a run and "Log sets" for a session on today's date or an earlier one.
 * A session ahead shows the workout as the rules give it now, and says so, because the loads depend
 * on sessions not yet done. The rows are the Today hero's (`workoutRows`), so the two surfaces say
 * one thing. The sheet mounts it for a strength session only.
 */
export function SessionStrengthSection({ session }: { session: PlanSessionView }) {
  const headingId = useId()
  const [logging, setLogging] = useState(false)
  // What the sheet saved, so the session says so and does not offer to log it again: the plan the
  // sheet was opened on does not change until the next read, and a save kept on the phone changes
  // it only when it is sent.
  const [saved, setSaved] = useState<'sent' | 'queued' | null>(null)
  const units = useStrengthUnits().data
  const { workout, failed, ahead, loggable } = useSessionStrength(session)
  // No load is drawn before the weight unit is known: it would be off by a factor of 2.2.
  if (units === undefined) return null
  const words = strengthWords(units.units, units.weightUnit)

  if (workout === null) {
    return failed ? (
      <section aria-labelledby={headingId} className={sheetStyles.section}>
        <h3 id={headingId} className={sheetStyles.heading}>
          {session.title}
        </h3>
        <p className={sheetStyles.muted}>{words.say('strength.session.unavailable')}</p>
      </section>
    ) : null
  }

  const rows = workoutRows(workout, units.units, units.weightUnit)
  const { block } = workout
  return (
    <>
      <section aria-labelledby={headingId} className={sheetStyles.section}>
        <h3 id={headingId} className={sheetStyles.heading}>
          {words.heading(workout.template, workout.variant)}
        </h3>
        {block === null ? null : (
          <p>
            {words.say('strength.session.week', {
              week: words.count(block.week),
              of: words.count(block.of),
            })}
          </p>
        )}
        {ahead ? (
          <p className={sheetStyles.muted}>{words.say('strength.session.as-of-today')}</p>
        ) : null}
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.key} className={styles.row}>
              <span className={styles.text}>{row.text}</span>
              {row.exerciseId === null || row.rule === null ? null : (
                <ExplainButton
                  subject={words.name(row.exerciseId)}
                  rules={[row.rule]}
                  explain={{ subject: 'strength', id: workout.sessionId, exercise: row.exerciseId }}
                />
              )}
            </li>
          ))}
        </ul>
        <p className={sheetStyles.muted}>
          {words.say('strength.separation', {
            hours: words.count(P.f4.strengthSeparationHours.value),
          })}
        </p>
        {saved !== null ? (
          <p className={sheetStyles.muted} role="status">
            {words.say(saved === 'queued' ? 'strength.sheet.saved-queued' : 'strength.sheet.saved')}
          </p>
        ) : loggable && isToRun(session.status) ? (
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setLogging(true)
              }}
            >
              {words.say('strength.label.log-sets')}
            </Button>
          </div>
        ) : null}
      </section>
      {logging ? (
        <StrengthSheet
          workout={workout}
          date={session.date}
          sessionId={session.id}
          onClose={() => {
            setLogging(false)
          }}
          onSaved={(result) => {
            setSaved(result.status === 'queued' ? 'queued' : 'sent')
            setLogging(false)
          }}
        />
      ) : null}
    </>
  )
}
