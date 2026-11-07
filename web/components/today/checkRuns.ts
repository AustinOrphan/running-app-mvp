import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { IntegrationStatus, SyncRunView } from '../../../shared/types.ts'
import { invalidateActivityData } from '../../api/activities.ts'
import { ApiError, api } from '../../api/client.ts'
import { useIntegrations, useSyncIntegration } from '../../api/integrations.ts'
import { useToast } from '../Toast.tsx'
import { useOnline } from '../useOnline.ts'

/** A pull when Today opens or regains focus only if the last one is older than this. */
export const CHECK_STALE_MS = 15 * 60_000
/** A pull that has not shown a newer `lastSyncAt` after this long is no longer waited for. */
export const CHECK_WAIT_MS = 90_000

const UNITS = 'km'

/**
 * The services that can be asked now: connected (or `error`, as after one failed pull, which the
 * scheduler and the Integrations page still try), able to pull, and not inside a rate-limit pause
 * (`pausedUntil`, the server's own end of it).
 */
export function pullTargets(
  list: readonly IntegrationStatus[] | undefined,
  now: number = Date.now(),
): IntegrationStatus[] {
  return (list ?? []).filter(
    (item) =>
      (item.status === 'connected' || item.status === 'error') &&
      item.info.channels.includes('pull') &&
      (item.pausedUntil === null ||
        item.pausedUntil === undefined ||
        new Date(item.pausedUntil).getTime() <= now),
  )
}

/** Whether any of `targets` has never pulled or last pulled longer ago than the gate. */
export function isStale(targets: readonly IntegrationStatus[], now: number): boolean {
  return targets.some(
    (item) =>
      item.lastSyncAt === null || now - new Date(item.lastSyncAt).getTime() > CHECK_STALE_MS,
  )
}

/** "Intervals.icu", "Intervals.icu and Strava", "A, B and C". */
export function joinSources(names: readonly string[]): string {
  const last = names[names.length - 1]
  if (last === undefined) return ''
  return names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`
}

interface Pending {
  startedAt: number
  auto: boolean
  /** Per service: the `lastSyncAt` it had when asked, and its label. */
  asked: Record<string, { before: string | null; label: string }>
  /** Services whose request was refused, with the server's words. */
  refused: Record<string, string>
  /**
   * Every sync request has been answered (202 or refusal). The finish waits for this: a status
   * list that already shows a newer pull while a request is still in flight must not end the
   * check early, or the late answer would start a second one and announce the same runs twice.
   */
  answered: boolean
}

export interface CheckRuns {
  /** Whether there is anything to ask: at least one connected pull service. */
  available: boolean
  online: boolean
  phase: 'idle' | 'checking'
  /** Why the last check that was asked for failed or is slow, in words; null otherwise. */
  problem: string | null
  check: () => void
}

/**
 * Asks every connected pull service for new activities through the sync route that the
 * Integrations page uses, and says what arrived. The route answers 202 at once, so the finish is
 * read from the status list (`lastSyncAt` moves when a run ends) and the run's own counts. A check
 * the runner starts always ends in a toast or a line saying why not; the automatic one (Today
 * opened or focused with a pull older than `CHECK_STALE_MS`) is quiet unless something arrived.
 */
export function useCheckRuns(): CheckRuns {
  const queryClient = useQueryClient()
  const toast = useToast()
  const online = useOnline()
  const integrations = useIntegrations()
  const sync = useSyncIntegration()
  const list = integrations.data
  const [pending, setPending] = useState<Pending | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const busy = useRef(false)
  const listRef = useRef(list)
  useEffect(() => {
    listRef.current = list
  }, [list])

  const { mutateAsync } = sync
  const start = useCallback(
    async (auto: boolean) => {
      const targets = pullTargets(listRef.current)
      if (busy.current || targets.length === 0) return
      busy.current = true
      setProblem(null)
      const next: Pending = {
        startedAt: Date.now(),
        auto,
        asked: Object.fromEntries(
          targets.map((item) => [
            item.provider,
            { before: item.lastSyncAt, label: item.info.label },
          ]),
        ),
        refused: {},
        answered: false,
      }
      setPending(next)
      const answers = await Promise.allSettled(
        targets.map((item) => mutateAsync({ provider: item.provider })),
      )
      answers.forEach((answer, index) => {
        if (answer.status === 'fulfilled') return
        const reason: unknown = answer.reason
        next.refused[targets[index]!.provider] =
          reason instanceof ApiError ? reason.message : 'Something went wrong.'
      })
      setPending({ ...next, refused: { ...next.refused }, answered: true })
    },
    [mutateAsync],
  )

  // The finish: every asked service has refused, shown a newer `lastSyncAt`, or run out of wait.
  // Then the runs that ended are read for their counts, and the page is told.
  useEffect(() => {
    if (pending === null || !pending.answered) return
    const open = Object.keys(pending.asked).filter((key) => pending.refused[key] === undefined)
    const itemOf = (key: string) => list?.find((candidate) => candidate.provider === key)
    const finished = (key: string) => {
      const item = itemOf(key)
      return item !== undefined && item.lastSyncAt !== pending.asked[key]!.before
    }
    const left = CHECK_WAIT_MS - (Date.now() - pending.startedAt)
    if (open.length > 0 && !open.every(finished) && left > 0) {
      const timer = setTimeout(() => {
        setPending({ ...pending })
      }, left)
      return () => {
        clearTimeout(timer)
      }
    }
    let cancelled = false
    void (async () => {
      let arrived = 0
      const arrivedFrom: string[] = []
      const failures: string[] = []
      const slow: string[] = []
      for (const [key, { label }] of Object.entries(pending.asked)) {
        const refusal = pending.refused[key]
        if (refusal !== undefined) {
          failures.push(
            render(TEMPLATES['today.check.failed'], { source: label, reason: refusal }, UNITS),
          )
          continue
        }
        const item = itemOf(key)
        if (item === undefined || !finished(key)) {
          slow.push(label)
          continue
        }
        if (item.lastSyncStatus === 'error' || item.status === 'needs_auth') {
          failures.push(
            render(
              TEMPLATES['today.check.failed'],
              { source: label, reason: item.lastError ?? 'Something went wrong.' },
              UNITS,
            ),
          )
          continue
        }
        let run: SyncRunView | undefined
        try {
          const runs = await api<SyncRunView[]>(
            'GET',
            `/integrations/${encodeURIComponent(key)}/runs?limit=5`,
          )
          run = runs.find(
            (candidate) =>
              item.lastSyncAt !== null &&
              new Date(candidate.startedAt).getTime() === new Date(item.lastSyncAt).getTime(),
          )
        } catch {
          // The counts are a nicety: the status list already says the run ended.
        }
        if (run !== undefined && run.accepted > 0) {
          arrived += run.accepted
          arrivedFrom.push(label)
        }
        // A run that stopped on a rate limit or lost items is not "no new runs": say what the
        // service said.
        const ended = run?.status ?? item.lastSyncStatus
        if (ended === 'paused' || ended === 'partial') {
          failures.push(
            render(
              TEMPLATES['today.check.partial'],
              {
                source: label,
                reason: item.lastError ?? run?.message ?? 'Some items were not read.',
              },
              UNITS,
            ),
          )
        }
      }
      if (cancelled) return
      void invalidateActivityData(queryClient)
      if (arrived > 0) {
        const source = joinSources(arrivedFrom)
        toast.show(
          arrived === 1
            ? render(TEMPLATES['today.check.arrived-one'], { source }, UNITS)
            : render(
                TEMPLATES['today.check.arrived-many'],
                { count: { kind: 'count', n: arrived }, source },
                UNITS,
              ),
        )
      } else if (!pending.auto && failures.length === 0 && slow.length === 0) {
        toast.show(render(TEMPLATES['today.check.none'], {}, UNITS))
      }
      if (!pending.auto) {
        const lines = [
          ...failures,
          ...(slow.length === 0
            ? []
            : [render(TEMPLATES['today.check.slow'], { source: joinSources(slow) }, UNITS)]),
        ]
        setProblem(lines.length === 0 ? null : lines.join(' '))
      }
      busy.current = false
      setPending(null)
    })()
    return () => {
      cancelled = true
    }
  }, [pending, list, queryClient, toast])

  // One pull when Today opens or the app comes back to the front, if the last is old enough. It
  // runs again once the status list first arrives, so a Today opened before that still pulls.
  const listed = integrations.isSuccess
  useEffect(() => {
    if (!online) return
    const maybe = () => {
      if (document.visibilityState === 'hidden') return
      const targets = pullTargets(listRef.current)
      if (targets.length > 0 && isStale(targets, Date.now())) void start(true)
    }
    maybe()
    document.addEventListener('visibilitychange', maybe)
    window.addEventListener('focus', maybe)
    return () => {
      document.removeEventListener('visibilitychange', maybe)
      window.removeEventListener('focus', maybe)
    }
  }, [online, start, listed])

  return {
    available: pullTargets(list).length > 0,
    online,
    phase: pending === null ? 'idle' : 'checking',
    problem,
    check: () => {
      void start(false)
    },
  }
}
