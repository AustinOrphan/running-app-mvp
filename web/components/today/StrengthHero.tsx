import { Fragment } from 'react'
import { countPhrase, formatQuantity } from '../../../shared/copy/quantity.ts'
import { STRENGTH_TEMPLATES } from '../../../shared/copy/strengthTemplates.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { PlanSessionView, StrengthWorkout, Units, WeightUnit } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import { strengthWords } from '../strength/strengthText.ts'
import { minutesPhrase, workoutRows } from '../strength/workoutRows.ts'
import heroStyles from './SessionHero.module.css'
import styles from './StrengthHero.module.css'

interface WorkoutViewProps {
  workout: StrengthWorkout
  units: Units
  weightUnit: WeightUnit
  /** The usual load of a lighter day is the one shown (and the one the sheet opens with). */
  usual: boolean
}

/**
 * The workout in the place of the targets, for a day whose hero is a strength session (design
 * 11.1): one row per lift, one for the jumps and one for the trunk movements, at most five, each a
 * template over the one `StrengthWorkout` (`workoutRows`), so a load reads in the runner's weight
 * unit. On a day of lower readiness the rows are the lighter ones (or the usual ones, once the
 * runner has taken the usual load). The estimated maximum is never shown here (design 11.1, owner
 * decision 10).
 */
export function StrengthRows({ workout, units, weightUnit, usual }: WorkoutViewProps) {
  const words = strengthWords(units, weightUnit)
  const rows = workoutRows(workout, units, weightUnit, { usual })
  return (
    <ul className={styles.rows} aria-label={words.heading(workout.template, workout.variant)}>
      {rows.map((row) => (
        <li key={row.key}>{row.text}</li>
      ))}
    </ul>
  )
}

/**
 * The line of a day of lower readiness and the switch to the usual load, which the logging sheet
 * then opens with (design 11.1). It sits under the hero's actions, so the day's tallest state
 * does not push Log sets below the first screen. Nothing on an ordinary day. A day that cut only
 * sets has no usual load to offer, so its line says no more than that.
 */
export function LighterDay({
  workout,
  units,
  weightUnit,
  usual,
  onUsual,
}: WorkoutViewProps & { onUsual: (usual: boolean) => void }) {
  const words = strengthWords(units, weightUnit)
  if (!workout.lifts.some((lift) => lift.change === 'lighter-day')) return null
  const hasUsual = workout.lifts.some((lift) => lift.usualLoadG !== null)
  // The Params that cut the day: one set fewer and 10% less, in the words of the template.
  const sets = countPhrase(P.f9.lowReadinessSetsCut.value, 'set')
  const line = !hasUsual
    ? words.say('strength.lighter-today-sets', { sets })
    : usual
      ? words.say('strength.hero.usual-on', { sets })
      : words.say('strength.lighter-today', {
          sets,
          pct: { kind: 'percent', pct: P.f9.lowReadinessLoadPct.value },
        })
  return (
    <div className={styles.lighter}>
      <p className={styles.note}>{line}</p>
      {hasUsual ? (
        <Button
          variant="quiet"
          className={styles.usual}
          aria-pressed={usual}
          onClick={() => {
            onUsual(!usual)
          }}
        >
          {words.say('strength.use-usual')}
        </Button>
      ) : null}
    </div>
  )
}

/** A mark in a rendered sentence where the sessions go, so the line can hold a button. */
const SESSIONS_MARK = '\u0000'

export interface AlsoTodayProps {
  /** The day's other sessions, in the hero's order. */
  others: PlanSessionView[]
  units: Units
  /** The session whose workout the payload holds: its item opens the logging sheet. */
  strengthId: string | null
  onOpenStrength: () => void
}

/**
 * The "Also today" line under the hero's actions. A strength session the payload carries a workout
 * for is a button with its own accessible name ("Strength, 40 minutes: open the workout"), a touch
 * target wider than the words so the line is no taller for it; the rest of the line is as the
 * template words it. Without a workout the line is one plain sentence, as it was.
 */
export function AlsoToday({ others, units, strengthId, onOpenStrength }: AlsoTodayProps) {
  const label = (other: PlanSessionView) =>
    `${other.title} (${formatQuantity({ kind: 'minutes', min: other.durationMin }, units)})`
  const [before = '', after = ''] = render(
    TEMPLATES['today.hero.also'],
    { sessions: SESSIONS_MARK },
    units,
  ).split(SESSIONS_MARK)
  return (
    <p className={heroStyles.muted}>
      {before}
      {others.map((other, index) => (
        <Fragment key={other.id}>
          {index === 0 ? null : ', '}
          {other.id === strengthId ? (
            <button
              type="button"
              className={styles.also}
              aria-label={render(
                STRENGTH_TEMPLATES['strength.hero.open-workout'],
                { minutes: minutesPhrase(other.durationMin) },
                units,
              )}
              onClick={onOpenStrength}
            >
              {label(other)}
            </button>
          ) : (
            label(other)
          )}
        </Fragment>
      ))}
      {after}
    </p>
  )
}
