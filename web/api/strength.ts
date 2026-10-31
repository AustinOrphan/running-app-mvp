import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { DEFAULT_WEIGHT_UNIT, isWeightUnit } from '../../shared/domain/weight.ts'
import type {
  EquipmentConfig,
  PinnedSlot,
  StrengthExerciseView,
  StrengthLift,
  StrengthNextLoad,
  StrengthSettings,
  StrengthSnapshot,
  StrengthView,
  StrengthWorkout,
  Units,
  WeightUnit,
} from '../../shared/types.ts'
import { getOutbox, refreshAfterSend, useOutboxState, type OutboxNotice } from '../pwa/outbox.ts'
import { ACTIVITY_DATA_KEYS } from './activities.ts'
import { api, keys, qs } from './client.ts'
import { useSettings } from './settings.ts'

// ---- Reads -------------------------------------------------------------------------------------

/**
 * The Strength page as one view: the setup, the block position, the next workouts, the recent logs
 * with their sets, the lifts with their summaries and the weeks. The logging sheet reads its
 * equipment (for "Swap" and "Always use this") and the last sets of each lift from it. It is not one
 * of the reads the service worker keeps (ADR 0012), so offline it fails and the sheet says what then
 * needs a connection.
 */
export function useStrengthView(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.strength, 'view'],
    queryFn: () => api<StrengthView>('GET', '/strength'),
    enabled: options.enabled ?? true,
  })
}

/**
 * The workouts of the active plan's strength sessions from `from` to `to` (at most 62 days), each as
 * the rules give it now: a future session is "as of today" (design 5.1).
 */
export function useStrengthWorkouts(from: string, to: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.strength, 'workouts', from, to],
    queryFn: () => api<StrengthWorkout[]>('GET', `/strength/workouts${qs({ from, to })}`),
    enabled: options.enabled ?? true,
  })
}

/** The history of one exercise: its sessions, their sets and the estimated maximum of each. */
export function useExerciseHistory(
  exerciseId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [keys.strength, 'exercise', exerciseId],
    queryFn: () =>
      api<StrengthExerciseView>(
        'GET',
        `/strength/exercises/${encodeURIComponent(exerciseId ?? '')}`,
      ),
    enabled: (options.enabled ?? true) && exerciseId !== undefined && exerciseId !== '',
  })
}

/** The two units every strength figure is shown in. */
export interface StrengthUnits {
  /** What a load reads in: a setting of its own, not derived from the distance unit (design 5.2). */
  weightUnit: WeightUnit
  /** The distance unit, which the copy templates take for every sentence. */
  units: Units
}

/**
 * The runner's weight unit and distance unit, from `/api/settings` (one of the reads the worker
 * keeps, so a load reads in the right unit offline too). `data` is undefined until they are known: a
 * load shown in a guessed unit would be off by a factor of 2.2, so no surface draws one before it.
 * A kept answer from before the unit existed has none, and reads as the default (pounds).
 */
export function useStrengthUnits(): { data: StrengthUnits | undefined; isError: boolean } {
  const settings = useSettings()
  const data = settings.data
  return {
    data:
      data === undefined
        ? undefined
        : {
            weightUnit: isWeightUnit(data.weightUnit) ? data.weightUnit : DEFAULT_WEIGHT_UNIT,
            units: data.units,
          },
    isError: settings.isError && data === undefined,
  }
}

// ---- Writes ------------------------------------------------------------------------------------

/**
 * A change to the setup, which moves the next workout, the lifts the page lists and what Today
 * shows: the strength readers and Today are read again.
 */
function invalidateAfterSetup(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [keys.strength, keys.today].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  )
}

/**
 * The body of `PUT /api/strength/settings`: every field is optional and one that is left out keeps
 * its stored value, so each part of the setup saves on its own. The keys are exactly those of
 * `server/routes/strength.ts`, which rejects any other.
 */
export interface StrengthSettingsBody {
  equipment?: EquipmentConfig[]
  level?: StrengthSettings['level']
  currentlyLifting?: boolean
  avoid?: string[]
  pinned?: Partial<Record<PinnedSlot, string>>
  /** Null clears the note. */
  note?: string | null
}

/** Saves a part of the setup and answers with what the server kept. */
export function useSaveStrengthSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: StrengthSettingsBody) =>
      api<StrengthSettings>('PUT', '/strength/settings', body),
    onSuccess: () => invalidateAfterSetup(queryClient),
  })
}

/**
 * The body of `PUT /api/strength/lifts/:exerciseId`: a recent set (with its reps) or a maximum the
 * runner already knows (one rep, nothing left). Loads are grams.
 */
export interface StrengthLiftBody {
  kind: StrengthLift['kind']
  loadG: number
  reps?: number
  rir?: number | null
  /** YYYY-MM-DD; today when left out. */
  asOf?: string
}

/** Stores the starting point of one exercise, replacing the previous one. */
export function useSaveStrengthLift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ exerciseId, body }: { exerciseId: string; body: StrengthLiftBody }) =>
      api<StrengthLift>('PUT', `/strength/lifts/${encodeURIComponent(exerciseId)}`, body),
    onSuccess: () => invalidateAfterSetup(queryClient),
  })
}

/** Removes the starting point of one exercise. A 404 when the runner has none for it. */
export function useDeleteStrengthLift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (exerciseId: string) =>
      api<undefined>('DELETE', `/strength/lifts/${encodeURIComponent(exerciseId)}`),
    onSuccess: () => invalidateAfterSetup(queryClient),
  })
}

/** One set as the save sends it; its place in the session is its place in the list. */
export interface StrengthSetBody {
  exerciseId: string
  /** Grams; null for a movement with no added load. */
  loadG: number | null
  /** Reps, seconds or contacts, by the exercise's measure. */
  count: number
  /** Reps left, 0 to 5; null when not recorded. */
  rir: number | null
}

/**
 * The body of `PUT /api/strength/logs/:logId`: the whole session, so a repeat with the same id
 * replaces it and leaves one log. `rpe`, `pain` and `notes` left out keep what an existing
 * activity holds (an import brings its own), and `null` clears it (the edit of a saved log, whose
 * runner emptied the field); the keys are exactly those of `server/routes/strength.ts`, which
 * rejects any other and accepts a `null` for these three.
 */
export interface StrengthLogBody {
  date: string
  /** An owned strength activity that has no log yet (an import). */
  activityId?: string
  /** The planned session this one fulfils. */
  sessionId?: string
  durationMin: number
  rpe?: number | null
  pain?: number | null
  notes?: string | null
  /** What the sheet showed, kept as sent (design 9.3). */
  prescribed: StrengthSnapshot
  sets: StrengthSetBody[]
}

/** The URL of one strength log: the key of its entry in the outbox. */
export function strengthLogUrl(logId: string): string {
  return `/api/strength/logs/${encodeURIComponent(logId)}`
}

/** Where a saved strength log ended up. */
export type StrengthSaveResult =
  /** The server has it. `next` is the load now suggested for each lift of the session. */
  | { status: 'sent'; next: StrengthNextLoad[] }
  /** It is kept on this phone and goes out when a connection allows. */
  | { status: 'queued' }
  /** The server refused it, in these words; it is not queued. */
  | { status: 'rejected'; reason: string }

const isNextLoad = (value: unknown): value is StrengthNextLoad =>
  typeof value === 'object' &&
  value !== null &&
  'exerciseId' in value &&
  typeof value.exerciseId === 'string' &&
  'change' in value &&
  typeof value.change === 'string' &&
  'loadG' in value &&
  (value.loadG === null || typeof value.loadG === 'number')

/** The `next` loads of a `StrengthLogResult` in an answer the outbox handed back; none when absent. */
function nextOf(response: unknown): StrengthNextLoad[] {
  if (typeof response !== 'object' || response === null || !('next' in response)) return []
  return Array.isArray(response.next) ? response.next.filter(isNextLoad) : []
}

/**
 * Saves a session through the outbox: the request is an idempotent upsert keyed by the sheet's
 * `logId`, so it is kept on this phone first and sent at once, or later when there is no connection,
 * and a repeat or a replay changes nothing. A sent answer carries the loads suggested for next
 * time. The strength readers, Today and the activity data are read again once the server has the
 * log: by the outbox listener (`useOutboxReplay`), which also covers a log sent later, and here,
 * joining that read, so the answer comes back with the fresh data in place (`refreshAfterSend`).
 */
export function useSaveStrengthLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      logId,
      body,
    }: {
      logId: string
      body: StrengthLogBody
    }): Promise<StrengthSaveResult> => {
      const result = await getOutbox().save(strengthLogUrl(logId), { ...body })
      return result.status === 'sent' ? { status: 'sent', next: nextOf(result.response) } : result
    },
    onSuccess: (result, { logId }) =>
      result.status === 'sent'
        ? refreshAfterSend(queryClient, strengthLogUrl(logId), { cancelRefetch: false })
        : undefined,
  })
}

/**
 * Removes a log and its sets; the activity stays. The suggestions follow the remaining logs, so
 * the strength readers, Today and the activity data are read again.
 */
export function useDeleteStrengthLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (logId: string) =>
      api<undefined>('DELETE', `/strength/logs/${encodeURIComponent(logId)}`),
    onSuccess: () =>
      Promise.all(
        ACTIVITY_DATA_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
  })
}

/** The URLs of the strength log entries of the outbox: `strengthLogUrl` of any id starts with this. */
const STRENGTH_LOG_URL_PREFIX = '/api/strength/logs/'

/**
 * The one-time notices of strength logs the server refused when the outbox finally sent them (the
 * session was deleted meanwhile, or the answer was a 400): the entry is gone from the phone, and the
 * notice says so ("A strength log saved on this phone was not accepted and was removed. Enter it
 * again if it still applies."). A surface that logs sets renders them and calls `dismiss`: the
 * outbox raises one for any entry and nothing else shows it (design 9.6).
 */
export function useStrengthLogNotices(): {
  notices: OutboxNotice[]
  dismiss: (id: number) => void
} {
  const { notices } = useOutboxState()
  return {
    notices: notices.filter((notice) => notice.url.startsWith(STRENGTH_LOG_URL_PREFIX)),
    dismiss: (id) => {
      getOutbox().dismissNotice(id)
    },
  }
}
