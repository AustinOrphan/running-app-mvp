import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { addDays, isIsoDate } from '../../../shared/dates.ts'
import { STRENGTH_BACKDATE_DAYS } from '../../../shared/limits.ts'
import type { StrengthWorkout, WorkoutLift } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import { Field, Input } from '../Field.tsx'
import type { PageWords } from './strengthPageText.ts'
import styles from './StrengthSections.module.css'

export interface WorkoutCardProps {
  /** The workout of the next planned strength session; null when none is planned. */
  workout: StrengthWorkout | null
  /** The server's day: the past session may be dated up to it, and a year back. */
  asOf: string
  words: PageWords
  /** The separation line, worded from the Param by the page (design 11.6); null when the view has none. */
  separation: string | null
  /**
   * "Log sets": the sheet opens on the workout. With no session planned the button reads "Log a
   * session" and the workout is null: the sheet then reads the day's own start (design 9.1).
   */
  onLog: (workout: StrengthWorkout | null) => void
  /**
   * "Add a past session": the sheet opens on the workout at a day in the last year, or, with none
   * planned (null), reads the start of that day.
   */
  onPast: (workout: StrengthWorkout | null, date: string) => void
}

/** A word for what the rules did to a lift's load, where there is one: never colour alone. */
function changeWord(words: PageWords, lift: WorkoutLift): string | null {
  // a movement with no added load has no load to move or to hold
  if (lift.loadG === null) return null
  switch (lift.change) {
    case 'increase':
      return words.say('strength.label.up-one-step')
    case 'hold':
      return words.say('strength.label.load-holds')
    case 'lighter-day':
      return words.say('strength.label.lighter-day')
    case 'start':
    case 'reduce':
    case 'return':
    case 'variation':
      return null
  }
}

/** One lift or trunk movement: its name, the suggestion and a word for the change. */
function LiftRow({ words, lift }: { words: PageWords; lift: WorkoutLift }) {
  const tag = changeWord(words, lift)
  return (
    <li className={styles.item}>
      <span className={styles.rowName}>{words.name(lift.exerciseId)}</span>
      <span className={styles.rowText}>{words.suggestion(lift)}</span>
      {tag === null ? null : <span className={styles.tag}>{tag}</span>}
    </li>
  )
}

/**
 * The next session's workout (design 11.3, part 2): the lifts with their loads and efforts, the jump
 * dose and the trunk movements, as the rules give them now, with "Log sets" and "Add a past
 * session". It shows the one workout every surface shows (design 5.1) and works out nothing. A log
 * made without a planned session starts from this workout (design 9.1); with none planned the card
 * says how to get one and offers "Log a session" and "Add a past session" all the same, and the
 * sheet reads the start of the day (the next planned session, else the week's maintenance session).
 */
export function WorkoutCard({ workout, asOf, words, separation, onLog, onPast }: WorkoutCardProps) {
  const headingId = useId()
  const [pastOpen, setPastOpen] = useState(false)
  const [date, setDate] = useState('')
  const [invalid, setInvalid] = useState(false)
  const oldest = addDays(asOf, -STRENGTH_BACKDATE_DAYS)

  function submitPast(event: FormEvent): void {
    event.preventDefault()
    if (!isIsoDate(date) || date > asOf || date < oldest) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    // The form stays, and with it the focused Continue button: the sheet is lazy and mounts a moment
    // later, and a sheet records the control that is focused when it opens as the one to give focus
    // back to. A form closed here would have taken that control with it, and focus would be lost.
    onPast(workout, date)
  }

  const pastButton = (
    <Button
      variant="secondary"
      aria-expanded={pastOpen}
      onClick={() => {
        setPastOpen((open) => !open)
      }}
    >
      {words.say('strength.page.past')}
    </Button>
  )
  const pastForm = pastOpen ? (
    <form className={styles.past} onSubmit={submitPast} noValidate>
      <Field
        label={words.say('strength.page.past-date')}
        hint={words.say('strength.page.past-hint')}
        error={invalid ? words.say('strength.page.past-invalid') : undefined}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            min={oldest}
            max={asOf}
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
            }}
          />
        )}
      </Field>
      <div>
        <Button type="submit" variant="secondary">
          {words.say('strength.page.past-continue')}
        </Button>
      </div>
    </form>
  ) : null

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {words.say('strength.page.next-heading')}
      </h2>
      {workout === null ? (
        <>
          <p className={styles.lead}>{words.say('strength.page.next-empty')}</p>
          <p className={styles.lead}>
            <Link to="/profile" className={styles.link}>
              {words.say('strength.page.profile-link')}
            </Link>
          </p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => {
                onLog(null)
              }}
            >
              {words.say('strength.page.log-session')}
            </Button>
            {pastButton}
          </div>
          {pastForm}
        </>
      ) : (
        <>
          <p className={styles.run}>{words.heading(workout.template, workout.variant)}</p>
          <p className={styles.note}>
            {words.say('strength.page.next-when', {
              date: words.day(workout.date, 'weekday'),
              minutes: words.minutes(workout.budgetMin),
            })}
          </p>
          {workout.setupSaved ? null : (
            <p className={styles.note}>{words.say('strength.page.bodyweight-only')}</p>
          )}
          <ul className={styles.list}>
            {workout.lifts.map((lift) => (
              <LiftRow key={lift.exerciseId} words={words} lift={lift} />
            ))}
            {workout.plyo === null
              ? null
              : workout.plyo.movements.map((movement) => (
                  <li key={movement} className={styles.item}>
                    <span className={styles.rowText}>
                      {words.say('strength.hero.plyo-row', {
                        movement: words.name(movement),
                        contacts: words.count(workout.plyo?.contacts ?? 0),
                      })}
                    </span>
                  </li>
                ))}
            {workout.trunk.map((lift) => (
              <LiftRow key={lift.exerciseId} words={words} lift={lift} />
            ))}
          </ul>
          {separation === null ? null : <p className={styles.note}>{separation}</p>}
          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => {
                onLog(workout)
              }}
            >
              {words.say('strength.label.log-sets')}
            </Button>
            {pastButton}
          </div>
          {pastForm}
        </>
      )}
    </section>
  )
}
