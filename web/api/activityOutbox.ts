import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { useToast } from '../components/Toast.tsx'
import {
  getOutbox,
  refreshAfterSend,
  useOutboxState,
  type OutboxEntry,
  type OutboxNotice,
} from '../pwa/outbox.ts'
import { invalidateActivityData, type ActivityInput, type FeedbackPatch } from './activities.ts'

/**
 * Done and the rating of a run through the outbox (ADR 0012, queued writes). A runner often logs at
 * a trailhead with no signal, so both are idempotent PUTs kept on the phone first and sent when a
 * connection allows. They live apart from `activities.ts`, which the outbox itself imports.
 */

/** What a Done sends: the activity and the session it marks done. */
export type DoneBody = ActivityInput & { sessionId?: string }

/** The URL of one Done: the key of its entry in the outbox. The id is the activity's id. */
export function doneUrl(activityId: string): string {
  return `/api/activities/done/${encodeURIComponent(activityId)}`
}

/** The URL of one run's rating: the key of its entry in the outbox. */
export function ratingUrl(activityId: string): string {
  return `/api/activities/${encodeURIComponent(activityId)}/feedback`
}

const DONE_URL_PREFIX = '/api/activities/done/'
const isDoneEntry = (entry: Pick<OutboxEntry, 'url'>) => entry.url.startsWith(DONE_URL_PREFIX)

/** A new id for the run a sheet is about to log: the key of the write, whatever happens to its answer. */
export function newActivityId(): string {
  return crypto.randomUUID()
}

/** The server refused the write, in these words. `conflict` is a session that was already logged. */
export class WriteRefused extends Error {
  readonly conflict: boolean
  constructor(reason: string, conflict: boolean) {
    super(reason)
    this.name = 'WriteRefused'
    this.conflict = conflict
  }
}

/** Where a saved write ended up: with the server, or kept on this phone until a connection allows. */
export type Landed = 'sent' | 'queued'

/**
 * Logs a run as done. `sent` when the server has it, `queued` when it waits on the phone; a refusal
 * throws `WriteRefused`. Activity data is read again once the server has the run: by the listener in
 * `useOutboxReplay`, which also covers a run sent later, and here, joining that read. A refusal for
 * a conflict reads Today again too, since the session is then logged by the other phone's run.
 */
export function useSaveDone() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: DoneBody }): Promise<Landed> => {
      const result = await getOutbox().save(doneUrl(id), { ...body })
      if (result.status === 'rejected') {
        if (result.conflict === true) void invalidateActivityData(queryClient)
        throw new WriteRefused(result.reason, result.conflict === true)
      }
      return result.status
    },
    onSuccess: (landed, { id }) =>
      landed === 'sent'
        ? refreshAfterSend(queryClient, doneUrl(id), { cancelRefetch: false })
        : undefined,
  })
}

/** Rates a run (effort, feel, pain). Same answers as `useSaveDone`. */
export function useSaveRating(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: FeedbackPatch): Promise<Landed> => {
      const result = await getOutbox().save(ratingUrl(activityId), { ...patch })
      if (result.status === 'rejected') throw new WriteRefused(result.reason, false)
      return result.status
    },
    onSuccess: (landed) =>
      landed === 'sent'
        ? refreshAfterSend(queryClient, ratingUrl(activityId), { cancelRefetch: false })
        : undefined,
  })
}

/**
 * The Done of a session that waits on this phone, or null. An entry counts once a send of it has
 * failed (`held`): while its first send is still on the way the sheet that made it shows the wait.
 */
export function useQueuedDone(sessionId: string): OutboxEntry | null {
  const { entries } = useOutboxState()
  return (
    entries.find(
      (entry) => isDoneEntry(entry) && entry.held === true && entry.body.sessionId === sessionId,
    ) ?? null
  )
}

/** True while a rating for this run waits on this phone (see `useQueuedDone`). */
export function useQueuedRating(activityId: string): boolean {
  const { entries } = useOutboxState()
  const url = ratingUrl(activityId)
  return entries.some((entry) => entry.url === url && entry.held === true)
}

/**
 * What waits on this phone that the server has not got and that cannot be made again from the
 * server: runs and ratings, in words ("1 run and 2 ratings"), or null when none. Signing out
 * clears them, so the Settings page names them first.
 */
export function useWaitingRecords(): string | null {
  const { entries } = useOutboxState()
  const runs = entries.filter(isDoneEntry).length
  const ratings = entries.filter((entry) =>
    /^\/api\/activities\/[^/]+\/feedback$/.test(entry.url),
  ).length
  const parts = [
    runs === 0 ? null : `${String(runs)} ${runs === 1 ? 'run' : 'runs'}`,
    ratings === 0 ? null : `${String(ratings)} ${ratings === 1 ? 'rating' : 'ratings'}`,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join(' and ')
}

/**
 * The refusals of Done and ratings found when the outbox sent them later, to show on Today (a
 * session logged on another phone meanwhile). The runner dismisses each.
 */
export function useActivityNotices(): { notices: OutboxNotice[]; dismiss: (id: number) => void } {
  const { notices } = useOutboxState()
  return {
    notices: notices.filter((notice) => notice.url.startsWith('/api/activities/')),
    dismiss: (id) => {
      getOutbox().dismissNotice(id)
    },
  }
}

/**
 * Says when a run or rating that waited on the phone has gone up. Only an entry that was held
 * (a send had failed and the runner was told it was saved on the phone) is announced; one that
 * went out at once was announced by the sheet that saved it.
 */
export function useQueuedSentToasts(): void {
  const toast = useToast()
  useEffect(
    () =>
      getOutbox().onSent((entry) => {
        if (entry.held !== true) return
        if (isDoneEntry(entry)) toast.show(render(TEMPLATES['today.done.sent-later'], {}, 'mi'))
        else if (/^\/api\/activities\/[^/]+\/feedback$/.test(entry.url))
          toast.show(render(TEMPLATES['today.rate.sent-later'], {}, 'mi'))
      }),
    [toast],
  )
}
