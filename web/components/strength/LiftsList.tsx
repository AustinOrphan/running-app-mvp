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
  const change =
    lift.lastChange === null ? unchangedText(words, lift) : changeText(words, lift.lastChange)
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
        {change === null ? null : (
          <div className={styles.fact}>
            <dt>{words.say('strength.page.lift-change')}</dt>
            <dd>{change}</dd>
          </div>
        )}
        <div className={styles.fact}>
          <dt>{words.say('strength.page.lift-last')}</dt>
          <dd>{formatQuantity(words.day(lift.lastDate, 'weekday'), units, weightUnit)}</dd>
        </div>
      </dl>
    </li>
  )
}

/**
 * What the Last change row says of a lift whose working load has not moved (`lastChange` is null):
 * the same load, but only for a lift with a load that was done in two sessions or more, since a
 * comparison needs two. A lift done once has nothing to compare, and a lift with no added load has
 * no load to keep, so their rows have no Last change at all. The payload counts the sessions of
 * every mode (`sessionCount`), not only the normal ones the load is read from, so this is the
 * nearest the page can come without the engine's own count.
 */
function unchangedText(words: PageWords, lift: StrengthLiftSummary): string | null {
  return lift.workingLoadG !== null && lift.sessionCount >= 2
    ? words.say('strength.label.same-load')
    : null
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
