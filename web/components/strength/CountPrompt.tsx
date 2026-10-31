import { useEffect, useId, useRef, useState } from 'react'
import { countPhrase, numberWord } from '../../../shared/copy/quantity.ts'
import type { StrengthView } from '../../../shared/types.ts'
import { useProfile, useUpdateProfile } from '../../api/profile.ts'
import { readCountNotNow, writeCountNotNow } from '../../pwa/drafts.ts'
import { Button } from '../Button.tsx'
import styles from './CountPrompt.module.css'
import type { PageWords } from './strengthPageText.ts'
import { COUNT_PROMPT_FEWER, COUNT_QUIET_WEEKS, countToAsk } from './weeklyCount.ts'

export interface CountPromptProps {
  view: StrengthView
  words: PageWords
}

/** "two" as "Two": the sentence starts with the count. */
const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** What the runner answered; the answer takes the question's place and says what follows. */
type Answer = 'planned' | 'kept'

function Question({ view, words }: CountPromptProps) {
  const textId = useId()
  const profile = useProfile()
  const update = useUpdateProfile()
  const [notNowOn, setNotNowOn] = useState(readCountNotNow)
  const [answer, setAnswer] = useState<Answer | null>(null)
  // The count the question named when "Plan 1 a week" was pressed, until the save has settled.
  const [saving, setSaving] = useState<number | null>(null)
  const answerLine = useRef<HTMLParagraphElement>(null)

  // The question's buttons are gone when it is answered; focus goes to the answer in their place.
  useEffect(() => {
    if (answer !== null) answerLine.current?.focus()
  }, [answer])

  if (answer !== null) {
    return (
      <div className={styles.prompt}>
        <p ref={answerLine} role="status" tabIndex={-1} className={styles.text}>
          {answer === 'planned'
            ? words.say('strength.count.planned', {
                sessions: countPhrase(COUNT_PROMPT_FEWER, 'strength session'),
              })
            : words.say('strength.count.kept', { weeks: countPhrase(COUNT_QUIET_WEEKS, 'week') })}
        </p>
      </div>
    )
  }

  const saved = profile.data
  const asked = saved === undefined ? null : countToAsk(view, saved.strengthPreference, notNowOn)
  // A saved choice shows in the Profile at once, a moment before the save has settled (the plan and
  // Today are read again first), and the question would end with it. It stays, naming the count it
  // asked about, until the line that answers it takes its place.
  const planned = saving ?? asked
  if (planned === null) return null

  const fewer = numberWord(COUNT_PROMPT_FEWER)
  const text = `${words.say('strength.count.line', {
    planned: capitalised(numberWord(planned)),
    fewer,
  })} ${words.say('strength.count.ask', { fewer })}`

  const plan = (): void => {
    // The Profile is the one place the choice lives, and the route keeps every field that is not
    // sent, so the choice is the one field written. The plan follows it at the next weekly update as
    // a revision the runner can read and undo (ADR 0007).
    setSaving(planned)
    update.mutateAsync({ strengthPreference: COUNT_PROMPT_FEWER }).then(
      () => {
        setAnswer('planned')
      },
      () => {
        // the failure shows under the question, and the choice stays as it was
        setSaving(null)
      },
    )
  }

  const later = (): void => {
    writeCountNotNow(view.asOf)
    setNotNowOn(view.asOf)
    setAnswer('kept')
  }

  return (
    <div role="group" aria-labelledby={textId} className={styles.prompt}>
      <p id={textId} className={styles.text}>
        {text}
      </p>
      {update.isError ? (
        <p role="alert" className={styles.error}>
          {words.say('strength.count.error')}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button variant="primary" loading={update.isPending} onClick={plan}>
          {words.say('strength.count.plan', { n: { kind: 'count', n: COUNT_PROMPT_FEWER } })}
        </Button>
        <Button variant="quiet" disabled={update.isPending} onClick={later}>
          {words.say('strength.count.later')}
        </Button>
      </div>
    </div>
  )
}

/**
 * The question about a lower weekly count (design 12.4): after `f9.countPromptWeeks` finished weeks
 * with fewer strength sessions logged than planned, one line and two buttons. "Plan 1 a week" saves
 * the Profile's strength choice and nothing else, and "Not now" keeps the day in this browser, so
 * the question stays away for four weeks. It is a question and never a change of its own, and it is
 * never asked when the plan or the Profile already asks for one a week. The Profile is read only when
 * the server calls for the question.
 */
export function CountPrompt({ view, words }: CountPromptProps) {
  return view.countPrompt ? <Question view={view} words={words} /> : null
}
