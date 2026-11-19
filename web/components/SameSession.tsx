import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  mergeConfirmLines,
  mergeEmptyText,
  mergeFailedText,
  mergeLabel,
  separateFailedText,
} from '../../shared/copy/manualMerge.ts'
import { pickDuplicate } from '../../shared/domain/duplicates.ts'
import type { MergeCandidate } from '../../shared/domain/manualMerge.ts'
import type { Activity } from '../../shared/types.ts'
import {
  useActivityDetail,
  useMergeActivity,
  useMergeCandidates,
  useResolveDuplicate,
} from '../api/activities.ts'
import { ApiError } from '../api/client.ts'
import { ErrorState } from './ErrorState.tsx'
import { formatLongDate } from './format.ts'
import { Button } from './Button.tsx'
import { Sheet } from './Sheet.tsx'
import { Skeleton } from './Skeleton.tsx'
import { useToast } from './Toast.tsx'
import { sourceLabel, TYPE_LABELS } from '../pages/ActivityForm.tsx'
import styles from './SameSession.module.css'

const HAND_ENTERED = 'Entered by hand'

function minutes(durationSec: number): string {
  return `${String(Math.round(durationSec / 60))} min`
}

/** One line for a candidate: kind, day and time, length, heart rate and where it came from. */
function candidateLine(entry: MergeCandidate): string {
  return [
    TYPE_LABELS[entry.type],
    `${formatLongDate(entry.date)}${entry.startTime === null ? '' : `, ${entry.startTime}`}`,
    minutes(entry.durationSec),
    entry.avgHr === null ? null : `${String(entry.avgHr)} bpm`,
    sourceLabel(entry.source) ?? HAND_ENTERED,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/**
 * "This entry (intervals.icu, Wed 18 Nov 2026, 07:12, 46 min)" or "The one you chose (...)": which
 * of the two a sentence of the confirm step means, told apart by the role and by day and time, so
 * two entries of one source never read alike.
 */
function entryName(
  entry: { source: string; date: string; startTime: string | null; durationSec: number },
  role: 'this' | 'chosen',
): string {
  const when = `${formatLongDate(entry.date)}${entry.startTime === null ? '' : `, ${entry.startTime}`}`
  const who = role === 'this' ? 'This entry' : 'The one you chose'
  return `${who} (${sourceLabel(entry.source) ?? 'entered by hand'}, ${when}, ${minutes(entry.durationSec)})`
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong.'
}

/**
 * "Same session as…" (MM1): the runner picks the other entry of a session the automatic pass did
 * not pair, a sheet names which copy stays and what moves, and `POST /api/activities/:id/merge` does
 * it. A quiet action: pairing is rare, and the pass is the usual way.
 */
export function SameSessionAction({ activity }: { activity: Activity }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<MergeCandidate | null>(null)
  const candidates = useMergeCandidates(activity.id, open)
  const merge = useMergeActivity()
  const toast = useToast()

  function close() {
    setOpen(false)
    setChosen(null)
    merge.reset()
  }

  async function run(entry: MergeCandidate) {
    try {
      await merge.mutateAsync({ id: activity.id, withId: entry.id })
    } catch {
      return
    }
    toast.show(mergeLabel('merge.toast.merged'))
    close()
  }

  const kind = activity.type === 'strength' ? 'strength' : 'run'
  // The same pick the server makes: the richer source stays, and on equal ranks this page's entry goes.
  const sides =
    chosen === null
      ? null
      : pickDuplicate(
          { id: activity.id, source: activity.source },
          { id: chosen.id, source: chosen.source },
        )
  const lines =
    chosen === null || sides === null
      ? null
      : mergeConfirmLines(
          sides.original.id === chosen.id
            ? entryName(chosen, 'chosen')
            : entryName(activity, 'this'),
          sides.duplicate.id === chosen.id
            ? entryName(chosen, 'chosen')
            : entryName(activity, 'this'),
        )

  // Focus follows the step: Merge when the confirm step opens, the first choice when Back returns.
  const firstChoice = useRef<HTMLButtonElement>(null)
  const mergeButton = useRef<HTMLButtonElement>(null)
  const chosenBefore = useRef(false)
  useEffect(() => {
    const isChosen = chosen !== null
    if (isChosen !== chosenBefore.current) {
      ;(isChosen ? mergeButton : firstChoice).current?.focus()
    }
    chosenBefore.current = isChosen
  }, [chosen])

  return (
    <>
      <Button
        variant="quiet"
        onClick={() => {
          setOpen(true)
        }}
      >
        {mergeLabel('merge.action')}
      </Button>
      <Sheet
        open={open}
        onClose={close}
        busy={merge.isPending}
        title={mergeLabel(chosen === null ? 'merge.picker.title' : 'merge.confirm.title')}
      >
        {chosen === null || lines === null ? (
          <>
            <p className={styles.lead}>{mergeLabel('merge.picker.lead')}</p>
            {candidates.isPending ? <Skeleton lines={3} /> : null}
            {candidates.isError ? (
              <ErrorState
                subject="The other entries"
                retrying={candidates.isFetching}
                onRetry={() => candidates.refetch()}
                error={candidates.error}
              />
            ) : null}
            {candidates.data?.length === 0 ? (
              <p className={styles.lead}>{mergeEmptyText(kind)}</p>
            ) : null}
            {candidates.data !== undefined && candidates.data.length > 0 ? (
              <ul className={styles.list}>
                {candidates.data.map((entry, index) => (
                  <li key={entry.id}>
                    <Button
                      ref={index === 0 ? firstChoice : undefined}
                      className={styles.choice}
                      onClick={() => {
                        setChosen(entry)
                      }}
                    >
                      {candidateLine(entry)}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.lead}>{lines[0]}</p>
            <p className={styles.lead}>{lines[1]}</p>
            <p className={styles.lead}>{lines[2]}</p>
            <p className={styles.lead}>{mergeLabel('merge.confirm.undo')}</p>
            {merge.isError ? (
              <p role="alert" className={styles.error}>
                {mergeFailedText(reasonOf(merge.error))}
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button
                ref={mergeButton}
                variant="primary"
                busy={merge.isPending}
                onClick={() => {
                  void run(chosen)
                }}
              >
                {mergeLabel('merge.confirm.merge')}
              </Button>
              <Button
                variant="quiet"
                busy={merge.isPending}
                onClick={() => {
                  merge.reset()
                  setChosen(null)
                }}
              >
                {mergeLabel('merge.confirm.back')}
              </Button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}

/**
 * On a confirmed duplicate: where it went ("Merged into <link>") and Separate, which sets it back
 * to dismissed (`POST /:id/duplicate`), so the pass leaves the pair alone and the entry counts
 * again. Logs that moved to the original stay there.
 */
export function MergedNote({ activity }: { activity: Activity }) {
  const originalId = activity.duplicateOfId
  const original = useActivityDetail(originalId ?? undefined)
  const resolve = useResolveDuplicate()
  const toast = useToast()
  if (originalId === null) return null
  const target = original.data?.activity
  const name =
    target === undefined
      ? mergeLabel('merge.merged-into.other')
      : `${TYPE_LABELS[target.type]}, ${sourceLabel(target.source) ?? HAND_ENTERED}`

  async function separate() {
    try {
      await resolve.mutateAsync({ id: activity.id, status: 'dismissed' })
    } catch {
      return
    }
    toast.show(mergeLabel('merge.toast.separated'))
  }

  return (
    <div className={styles.merged}>
      <p className={styles.note}>
        {mergeLabel('merge.merged-into')}{' '}
        <Link to={`/activities/${encodeURIComponent(originalId)}`}>{name}</Link>.{' '}
        {mergeLabel('merge.not-counted')}
      </p>
      <p className={styles.note}>{mergeLabel('merge.unavailable.note')}</p>
      <p className={styles.note}>{mergeLabel('merge.separate.note')}</p>
      <div className={styles.actions}>
        <Button variant="secondary" loading={resolve.isPending} onClick={() => void separate()}>
          {mergeLabel('merge.separate')}
        </Button>
      </div>
      {resolve.isError ? (
        <p role="alert" className={styles.error}>
          {separateFailedText(reasonOf(resolve.error))}
        </p>
      ) : null}
    </div>
  )
}
