import { useState } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { Checkin, Units } from '../../../shared/types.ts'
import { checkinUrl, useSaveCheckin, type CheckinInput } from '../../api/checkins.ts'
import { getOutbox, useOutboxState } from '../../pwa/outbox.ts'
import { Button } from '../Button.tsx'
import { Segmented } from '../Segmented.tsx'
import { useToast } from '../Toast.tsx'
import { CheckinSheet, NotFullSheet } from '../lazySheets.tsx'
import { StrengthLogNotices } from '../strength/StrengthLogNotices.tsx'
import styles from './CheckinRow.module.css'

/** The fatigue row's answers, 1 (fresh) to 5 (drained): the word, then the line the row folds to. */
const ANSWERS = [
  {
    label: 'today.checkin.answer-fresh',
    sent: 'today.checkin.sent-fresh',
    queued: 'today.checkin.queued-fresh',
  },
  {
    label: 'today.checkin.answer-good',
    sent: 'today.checkin.sent-good',
    queued: 'today.checkin.queued-good',
  },
  {
    label: 'today.checkin.answer-normal',
    sent: 'today.checkin.sent-normal',
    queued: 'today.checkin.queued-normal',
  },
  {
    label: 'today.checkin.answer-tired',
    sent: 'today.checkin.sent-tired',
    queued: 'today.checkin.queued-tired',
  },
  {
    label: 'today.checkin.answer-drained',
    sent: 'today.checkin.sent-drained',
    queued: 'today.checkin.queued-drained',
  },
] as const

export interface CheckinRowProps {
  date: string
  /** The check-in the server holds for the day, or null. */
  checkin: Checkin | null
  /** The engine still counts an earlier report of point tenderness on a bone. */
  boneActive: boolean
  /**
   * A window is open today (`isOpen`). The plan already holds the illness or the pain, so a second
   * report would repeat it: the second button then reads as adding a window and opens the "Not
   * 100%" sheet, where pain and illness get their own dates.
   */
  windowOpen: boolean
  units: Units
  /**
   * Called when an answer is tapped, before it is saved. The row folds away, and the focused
   * answer with it, so Today moves focus to the verdict that the answer re-reads.
   */
  onAnswered: () => void
}

/**
 * The one-row check-in: "How do you feel today?" and five answers, Fresh to Drained. One tap saves
 * `{ fatigue }` through the outbox and folds the row into "Checked in: normal." with "Add more".
 * Pain and illness are one tap away at all times ("Something hurts, or I'm ill"), and both open
 * the check-in sheet; while a window is open the same place says "Add a pain or illness window" and
 * opens the sheet that makes one. With no connection the answer is kept on this phone and the line
 * says so.
 * The arrow keys move between the answers and Space or Enter chooses, because choosing saves.
 */
export function CheckinRow({
  date,
  checkin,
  boneActive,
  windowOpen,
  units,
  onAnswered,
}: CheckinRowProps) {
  const url = checkinUrl(date)
  const outbox = useOutboxState()
  const save = useSaveCheckin()
  const toast = useToast()
  const [sheet, setSheet] = useState<'feel' | 'hurt' | 'window' | null>(null)
  // The answer just tapped holds the fold until the server's own check-in arrives and replaces
  // it, unless the server turned the answer down after all (a notice for this day).
  const [chosen, setChosen] = useState<{ fatigue: number | null; seen: Checkin | null } | null>(
    null,
  )

  const pending = outbox.entries.find((entry) => entry.url === url)
  const notices = outbox.notices.filter((notice) => notice.url === url)
  const rejected = save.data?.status === 'rejected' ? save.data.reason : null

  let fatigue: number | null
  if (pending !== undefined && 'fatigue' in pending.body) {
    fatigue = typeof pending.body['fatigue'] === 'number' ? pending.body['fatigue'] : null
  } else if (chosen !== null && chosen.seen === checkin && notices.length === 0) {
    fatigue = chosen.fatigue
  } else {
    fatigue = checkin?.fatigue ?? null
  }
  const answer = fatigue === null ? undefined : ANSWERS[Math.round(fatigue) - 1]

  // What the sheet starts from: the saved answers with any still-queued write laid over them.
  const effective: Checkin | null =
    pending === undefined
      ? checkin
      : {
          date,
          fatigue: null,
          soreness: null,
          sleepQuality: null,
          mood: null,
          stress: null,
          illness: false,
          painScore: null,
          painArea: null,
          painFocalBone: boneActive,
          ...checkin,
          ...(pending.body as CheckinInput),
        }

  function dismissNotices() {
    for (const notice of notices) getOutbox().dismissNotice(notice.id)
  }

  function choose(value: string) {
    const picked = Number(value)
    dismissNotices()
    onAnswered()
    setChosen({ fatigue: picked, seen: checkin })
    save.mutate(
      { date, input: { fatigue: picked } },
      {
        onSuccess: (result) => {
          if (result.status === 'rejected') setChosen(null)
        },
        onError: () => {
          setChosen(null)
        },
      },
    )
  }

  function open(lead: 'feel' | 'hurt' | 'window') {
    dismissNotices()
    setSheet(lead)
  }

  const question = render(TEMPLATES['today.checkin.question'], {}, units)
  const hurt = render(
    TEMPLATES[windowOpen ? 'today.checkin.hurt-window' : 'today.checkin.hurt'],
    {},
    units,
  )
  const failure = rejected ?? (save.isError ? 'Something went wrong.' : null)

  return (
    <div className={styles.row}>
      {answer === undefined ? (
        <div className={styles.ask}>
          <p className={styles.question}>{question}</p>
          <Segmented
            label={question}
            options={ANSWERS.map((entry, index) => ({
              value: String(index + 1),
              label: render(TEMPLATES[entry.label], {}, units),
            }))}
            value=""
            arrows="focus"
            dense
            onChange={choose}
          />
        </div>
      ) : (
        <p className={styles.line}>
          {render(TEMPLATES[pending === undefined ? answer.sent : answer.queued], {}, units)}
        </p>
      )}
      <div className={styles.more}>
        {answer === undefined ? null : (
          <Button
            variant="quiet"
            onClick={() => {
              open('feel')
            }}
          >
            Add more
          </Button>
        )}
        <Button
          variant="quiet"
          onClick={() => {
            open(windowOpen ? 'window' : 'hurt')
          }}
        >
          {hurt}
        </Button>
      </div>
      {failure === null ? null : (
        <p role="alert" className={styles.notice}>
          {render(TEMPLATES['today.checkin.not-saved'], { reason: failure }, units)}
        </p>
      )}
      {/* What the outbox sent later and the server refused, one time each: the check-in's own go
          when the runner answers again; a strength log has no such next step (the sheet that made
          it is closed), so its notice has a control of its own (design 9.6). */}
      {notices.map((notice) => (
        <p key={notice.id} role="alert" className={styles.notice}>
          {notice.message}
        </p>
      ))}
      <StrengthLogNotices />
      {sheet === 'window' ? (
        <NotFullSheet
          today={date}
          onClose={() => {
            setSheet(null)
          }}
        />
      ) : null}
      {sheet === null || sheet === 'window' ? null : (
        <CheckinSheet
          date={date}
          checkin={effective}
          boneActive={boneActive}
          lead={sheet}
          units={units}
          onClose={() => {
            setSheet(null)
          }}
          onSaved={(result, saved) => {
            setChosen({ fatigue: saved, seen: checkin })
            toast.show(
              render(
                TEMPLATES[
                  result === 'sent' ? 'today.checkin.toast-sent' : 'today.checkin.toast-queued'
                ],
                {},
                units,
              ),
            )
            setSheet(null)
          }}
        />
      )}
    </div>
  )
}
