import { useId } from 'react'
import { Button } from '../Button.tsx'
import type { SetupPart } from './setupForm.ts'
import type { PageWords } from './strengthPageText.ts'
import styles from './StrengthSections.module.css'

export interface SetupCardProps {
  words: PageWords
  /** A part's button opens its sheet. */
  onOpen: (part: SetupPart) => void
}

/** The five parts of the setup in the order of design 6.2, each with what it is for. */
const PARTS = [
  { part: 'unit', name: 'strength.page.part-unit', note: 'strength.page.part-unit-note' },
  {
    part: 'equipment',
    name: 'strength.page.part-equipment',
    note: 'strength.page.part-equipment-note',
  },
  { part: 'history', name: 'strength.page.part-history', note: 'strength.page.part-history-note' },
  {
    part: 'exercises',
    name: 'strength.page.part-exercises',
    note: 'strength.page.part-exercises-note',
  },
  { part: 'anchors', name: 'strength.page.part-anchors', note: 'strength.page.part-anchors-note' },
] as const

/**
 * Set up strength (design 6.1, 11.3 part 1), shown only while the setup is not saved: one sentence on
 * what it changes and the five parts of design 6.2, each its own short sheet and each optional. The
 * first save of any part ends the offer; the parts then stay under "Equipment and units".
 */
export function SetupCard({ words, onOpen }: SetupCardProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {words.say('strength.page.setup-heading')}
      </h2>
      <p className={styles.lead}>{words.say('strength.page.setup-lead')}</p>
      <ul className={styles.list}>
        {PARTS.map(({ part, name, note }) => (
          <li key={part} className={styles.item}>
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  onOpen(part)
                }}
              >
                {words.say(name)}
              </Button>
            </div>
            <span className={styles.note}>{words.say(note)}</span>
          </li>
        ))}
      </ul>
      <p className={styles.note}>{words.say('strength.page.setup-optional')}</p>
    </section>
  )
}
