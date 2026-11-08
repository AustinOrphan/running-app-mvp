import { useEffect, useId, useMemo, useState } from 'react'
import { describeRaceCard, type RaceCardBlockText } from '../../../shared/copy/racePlan.ts'
import type { RacePlan } from '../../../shared/engine/racePlan.ts'
import type { Units } from '../../../shared/types.ts'
import { RACE_CREW_NOTE_MAX, readCrewNote, writeCrewNote } from '../../pwa/drafts.ts'
import { Button } from '../Button.tsx'
import { Field, Textarea } from '../Field.tsx'
import styles from './RaceCard.module.css'

export interface RaceCardProps {
  plan: RacePlan
  units: Units
}

/**
 * One stop's note for the crew, kept on this device only (`web/pwa/drafts.ts`). The field is for the
 * screen; the printed card shows the same words as plain text, because a text box prints badly and
 * cuts a long note off.
 */
function CrewNote({
  block,
  noteId,
  hintId,
  unsavedText,
  printLabel,
}: {
  block: RaceCardBlockText
  noteId: string
  hintId: string
  unsavedText: string
  printLabel: string
}) {
  const [value, setValue] = useState(() => readCrewNote(noteId))
  const [kept, setKept] = useState(true)
  return (
    <>
      <div className={styles.noteField}>
        <Field label={block.noteLabel} error={kept ? undefined : unsavedText}>
          {(a) => (
            <Textarea
              {...a}
              aria-describedby={a['aria-describedby'] ?? hintId}
              rows={2}
              maxLength={RACE_CREW_NOTE_MAX}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setKept(writeCrewNote(noteId, event.target.value))
              }}
            />
          )}
        </Field>
      </div>
      {value === '' ? null : (
        <p className={styles.notePrint}>
          <span className={styles.notePrintLabel}>{printLabel}:</span> {value}
        </p>
      )}
    </>
  )
}

/**
 * The race card (rule H14, ADR 0018): one block for the start, each checkpoint and the finish, built
 * from the rows of the table by `describeRaceCard`, with a crew note for each stop and a print layout
 * (black on white, two columns, no navigation) that fits one or two pages. It works from the phone's
 * copy of the plan with no signal. It holds no pace, split or rate above the tolerated rung.
 */
export function RaceCard({ plan, units }: RaceCardProps) {
  const text = useMemo(() => describeRaceCard(plan, units), [plan, units])
  const hintId = useId()

  // The print rules in `RaceCard.module.css` hide the app's navigation and set the page to black on
  // white only while the card is on screen, so printing another page is left as it was.
  useEffect(() => {
    document.documentElement.dataset['print'] = 'race-card'
    return () => {
      delete document.documentElement.dataset['print']
    }
  }, [])

  return (
    <section className={styles.card} aria-labelledby="race-card-heading">
      <div className={styles.head}>
        <h2 id="race-card-heading" className={styles.heading}>
          {text.heading}
        </h2>
        <div className={styles.noPrint}>
          <Button
            onClick={() => {
              window.print()
            }}
          >
            {text.print}
          </Button>
        </div>
      </div>
      {text.blocks.length === 0 ? (
        <p className={styles.text}>{text.empty}</p>
      ) : (
        <>
          <p className={styles.note}>{text.intro}</p>
          <p id={hintId} className={`${styles.note} ${styles.noPrint}`}>
            {text.noteHint}
          </p>
          <ol className={styles.blocks} aria-label={text.list}>
            {text.blocks.map((block) => (
              <li key={`${plan.goalId}:${block.key}`} className={styles.item}>
                <article className={styles.block} aria-label={block.name}>
                  <div className={styles.title}>
                    <h3 className={styles.name}>{block.name}</h3>
                    {block.distance === null ? null : (
                      <p className={styles.muted}>{block.distance}</p>
                    )}
                  </div>
                  {block.arrival === null ? null : <p className={styles.lead}>{block.arrival}</p>}
                  {block.cutoff.map((line) => (
                    <p key={line} className={styles.line}>
                      {line}
                    </p>
                  ))}
                  {block.headlamp === null ? null : <p className={styles.line}>{block.headlamp}</p>}
                  {block.next === null ? null : <p className={styles.line}>{block.next}</p>}
                  {block.fuel === null ? null : <p className={styles.line}>{block.fuel}</p>}
                  {block.climb === null ? null : <p className={styles.line}>{block.climb}</p>}
                  <CrewNote
                    block={block}
                    noteId={`${plan.goalId}:${block.key}`}
                    hintId={hintId}
                    unsavedText={text.noteUnsaved}
                    printLabel={text.notePrint}
                  />
                </article>
              </li>
            ))}
          </ol>
          {text.notes.map((note) => (
            <p key={note} className={styles.note}>
              {note}
            </p>
          ))}
        </>
      )}
    </section>
  )
}
