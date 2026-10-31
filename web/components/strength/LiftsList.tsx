import { useId } from 'react'
import { formatQuantity } from '../../../shared/copy/quantity.ts'
import { formatLoad } from '../../../shared/domain/weight.ts'
import type { StrengthLiftSummary, Units, WeightUnit } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import type { PageWords } from './strengthPageText.ts'
import styles from './StrengthSections.module.css'

export interface LiftsListProps {
  /** The exercises with a logged set, the latest first. */
  lifts: readonly StrengthLiftSummary[]
  /** The exercise whose history is open, if any. */
  selected: string | null
  words: PageWords
  units: Units
  weightUnit: WeightUnit
  /** "History": the history section shows this exercise. */
  onSelect: (exerciseId: string) => void
}

/** The last move of a working load in words: "Up from 105 lb to 110 lb, Thu 12 Mar". */
function changeText(words: PageWords, change: NonNullable<StrengthLiftSummary['lastChange']>) {
  const slots = {
    from: words.load(change.fromG),
    to: words.load(change.toG),
    date: words.day(change.date, 'weekday'),
  }
  return words.say(
    change.toG >= change.fromG ? 'strength.page.change-up' : 'strength.page.change-down',
    slots,
  )
}

function LiftRow({
  words,
  lift,
  selected,
  units,
  weightUnit,
  onSelect,
}: {
  words: PageWords
  lift: StrengthLiftSummary
  selected: boolean
  units: Units
  weightUnit: WeightUnit
  onSelect: () => void
}) {
  const exercise = words.name(lift.exerciseId)
  return (
    <li className={styles.item}>
      <div className={styles.head}>
        <span className={styles.rowName}>{exercise}</span>
        <Button
          variant="quiet"
          aria-pressed={selected}
          aria-label={words.say('strength.page.lift-history-for', { exercise })}
          onClick={onSelect}
        >
          {words.say('strength.page.lift-history')}
        </Button>
      </div>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{words.say('strength.page.lift-last-load')}</dt>
          <dd>
            {lift.workingLoadG === null
              ? words.say('strength.page.lift-no-load')
              : formatLoad(lift.workingLoadG, weightUnit)}
          </dd>
        </div>
        {lift.estimateG === null ? null : (
          <div className={styles.fact}>
            <dt>{words.say('strength.page.lift-estimate')}</dt>
            <dd>{words.say('strength.page.about-load', { load: words.load(lift.estimateG) })}</dd>
          </div>
        )}
        <div className={styles.fact}>
          <dt>{words.say('strength.page.lift-change')}</dt>
          <dd>
            {lift.lastChange === null
              ? words.say('strength.page.change-none')
              : changeText(words, lift.lastChange)}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>{words.say('strength.page.lift-last')}</dt>
          <dd>{formatQuantity(words.day(lift.lastDate, 'weekday'), units, weightUnit)}</dd>
        </div>
      </dl>
    </li>
  )
}

/**
 * The lifts (design 11.3, part 4): each exercise with a logged set, its last load, its estimated
 * maximum (always an estimate, never on Today) and the last change in words. "History" chooses the
 * lift whose sessions the next section lists.
 */
export function LiftsList({ lifts, selected, words, units, weightUnit, onSelect }: LiftsListProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {words.say('strength.page.lifts-heading')}
      </h2>
      {lifts.length === 0 ? (
        <p className={styles.lead}>{words.say('strength.page.lifts-empty')}</p>
      ) : (
        <>
          <ul className={styles.list}>
            {lifts.map((lift) => (
              <LiftRow
                key={lift.exerciseId}
                words={words}
                lift={lift}
                selected={selected === lift.exerciseId}
                units={units}
                weightUnit={weightUnit}
                onSelect={() => {
                  onSelect(lift.exerciseId)
                }}
              />
            ))}
          </ul>
          {lifts.some((lift) => lift.estimateG !== null) ? (
            <p className={styles.note}>{words.say('strength.page.estimate-note')}</p>
          ) : null}
        </>
      )}
    </section>
  )
}
