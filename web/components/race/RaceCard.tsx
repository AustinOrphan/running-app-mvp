import { useEffect, useId, useMemo, useState } from 'react'
import {
  describeRaceCard,
  type RaceCardBlockText,
  type RaceCardSheet,
} from '../../../shared/copy/racePlan.ts'
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
 * The split sheet: one table with a row for each stop. It is a view of the same rows as the blocks
 * below it, so the two cannot disagree. On a phone the table scrolls inside its own box if it must.
 */
function SplitSheet({ sheet }: { sheet: RaceCardSheet }) {
  return (
    <div className={styles.sheetBox}>
      <table className={styles.sheet}>
        <caption className={styles.sheetCaption}>{sheet.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{sheet.stop}</th>
            <th scope="col" className={`${styles.num} ${styles.wide}`}>
              {sheet.distance}
            </th>
            <th scope="col">{sheet.arrival}</th>
            {sheet.showCutoff ? (
              <th scope="col" className={styles.wide}>
                {sheet.cutoff}
              </th>
            ) : null}
            {sheet.showFuel ? <th scope="col">{sheet.fuel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                {row.name}
                <span className={`${styles.sub} ${styles.narrow}`}>{row.distance}</span>
              </th>
              <td className={`${styles.num} ${styles.wide}`}>{row.distance}</td>
              <td>
                {row.arrival}
                {row.cutoff.length === 0 ? null : (
                  <span className={`${styles.sub} ${styles.narrow}`}>
                    {sheet.cutoff} {row.cutoff.join(', ')}
                  </span>
                )}
              </td>
              {sheet.showCutoff ? (
                <td className={styles.wide}>
                  {row.cutoff.length === 0
                    ? sheet.noCutoff
                    : row.cutoff.map((line) => (
                        <span key={line} className={styles.cell}>
                          {line}
                        </span>
                      ))}
                </td>
              ) : null}
              {sheet.showFuel ? <td>{row.fuel ?? sheet.noFuel}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          {text.sheet === null ? null : <SplitSheet sheet={text.sheet} />}
          <ol className={styles.blocks} aria-label={text.list}>
            {text.blocks.map((block, index) => (
              <li key={`${plan.goalId}:${block.key}`} className={styles.item}>
                <article
                  className={`${styles.block} ${
                    index === 0 || index === text.blocks.length - 1 ? styles.ends : ''
                  }`}
                  aria-label={block.name}
                >
                  <div className={styles.title}>
                    <h3 className={styles.name}>{block.name}</h3>
                    {block.distance === null ? null : (
                      <p className={styles.muted}>{block.distance}</p>
                    )}
                  </div>
                  {block.window === null ? null : (
                    <div className={styles.figure}>
                      <p
                        className={`${styles.figureLabel} ${block.windowElapsed ? styles.keepLabel : ''}`}
                      >
                        {block.windowLabel}
                      </p>
                      <p className={`${styles.lead} figure-type`}>{block.window}</p>
                    </div>
                  )}
                  {block.cutoff.map((line) => (
                    <p key={line} className={`${styles.line} ${styles.screenOnly}`}>
                      {line}
                    </p>
                  ))}
                  {block.headlamp === null ? null : <p className={styles.line}>{block.headlamp}</p>}
                  {block.next === null ? null : <p className={styles.line}>{block.next}</p>}
                  {block.facts.length === 0 ? null : (
                    <dl className={styles.facts}>
                      {block.facts.map((fact) => (
                        <div key={fact.key} className={styles.fact}>
                          <dt className={styles.factLabel}>{fact.label}</dt>
                          <dd className={styles.factValue}>
                            {fact.value} <span className={styles.factNote}>{fact.note}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
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
