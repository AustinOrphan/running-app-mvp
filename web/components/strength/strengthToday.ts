// Where the Today hero and the session sheet get the workout of a strength session. Today carries it
// as `coach.slots.strength` (design 11.1, 9.6), so both read the payload the page already holds and
// ask for nothing: the first screen keeps to its two requests, and a phone with no connection opens
// the hero and the sheet from the copy the worker kept (ADR 0012).
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_WEIGHT_UNIT, isWeightUnit } from '../../../shared/domain/weight.ts'
import type {
  PlanSession,
  StrengthWorkout,
  TodayView,
  UserSettings,
  WeightUnit,
} from '../../../shared/types.ts'
import { keys } from '../../api/client.ts'
import { useStrengthWorkouts } from '../../api/strength.ts'
import { useToday } from '../../api/today.ts'
import { dayState, serverToday, usePhoneCopy, type DayState } from '../today/phoneCopy.ts'

/**
 * A query the page has already loaded, read without asking again: this observer never fetches (not
 * on mount, not on focus) and it re-renders when the page's own query changes the cache. The hero
 * opens on the first screen, which keeps to its two requests.
 */
function useLoaded<T>(key: string): T | undefined {
  return useQuery<T>({ queryKey: [key], enabled: false }).data
}

/** The workout the payload holds for the session, else null (another session, or none). */
function workoutOf(view: TodayView | undefined, sessionId: string): StrengthWorkout | null {
  const workout = view?.coach.slots.strength ?? null
  return workout !== null && workout.sessionId === sessionId ? workout : null
}

/**
 * The workout of the viewed day's strength session, from the payload the page holds, with the
 * weight unit of the settings it holds and which day the payload is for. The workout is null when
 * the payload carries none (a day with no strength session, a day of the illness rest phase, an
 * answer from before strength existed); the unit is undefined until the settings are in, and no
 * load is drawn before it. `day` is `ahead` for a preview and `past` for a copy of a day that is
 * over: neither can be logged against.
 */
export function useTodayStrength(): {
  workout: StrengthWorkout | null
  weightUnit: WeightUnit | undefined
  day: DayState
} {
  const view = useLoaded<TodayView>(keys.today)
  const settings = useLoaded<UserSettings>(keys.settings)
  const phoneCopy = usePhoneCopy(view)
  return {
    workout: view?.coach.slots.strength ?? null,
    // a kept answer from before the unit existed has none, and reads as the default
    weightUnit:
      settings === undefined
        ? undefined
        : isWeightUnit(settings.weightUnit)
          ? settings.weightUnit
          : DEFAULT_WEIGHT_UNIT,
    day: view === undefined ? 'today' : dayState(view, phoneCopy),
  }
}

/** What the session sheet knows about a strength session. */
export interface SessionStrength {
  /** The workout as the rules give it now; null while it loads, when it fails, and for a run. */
  workout: StrengthWorkout | null
  /** The workout could not be read and Today's copy does not hold it. */
  failed: boolean
  /** The session is later than the server's day: its loads are as of today (design 11.2). */
  ahead: boolean
  /** The server's day is known and the session is on it or earlier: "Log sets" applies. */
  loggable: boolean
}

/**
 * The workout of a strength session opened from the Plan page or the week strip. The Today payload
 * the page holds answers when it carries this session's workout; otherwise the workouts of the
 * session's own day are read (`GET /api/strength/workouts`), once the sheet is open on a strength
 * session. The server's day comes from the same payload (`TodayView.date` and `tz`), never from the
 * phone's calendar, so a session is "ahead" by the server's reckoning.
 */
export function useSessionStrength(
  session: Pick<PlanSession, 'id' | 'kind' | 'date'>,
): SessionStrength {
  const isStrength = session.kind === 'strength'
  const today = useToday({ enabled: isStrength })
  const view = today.data
  const phoneCopy = usePhoneCopy(view)
  const kept = workoutOf(view, session.id)
  const fetched = useStrengthWorkouts(session.date, session.date, {
    enabled: isStrength && kept === null && !today.isPending,
  })
  const workout =
    kept ?? fetched.data?.find((candidate) => candidate.sessionId === session.id) ?? null
  // A live answer gives the day as `date`, except a preview, which is a day later than today; a
  // copy kept on the phone is judged by the phone's clock in the server's zone.
  const day =
    view === undefined
      ? null
      : phoneCopy
        ? serverToday(view)
        : view.coach.preview
          ? null
          : view.date
  return {
    workout: isStrength ? workout : null,
    // only the workouts read can fail the section: while it is on its way (and Today's own read
    // has failed, which is why it was needed) nothing is wrong yet
    failed: isStrength && workout === null && fetched.isError,
    ahead: day !== null && session.date > day,
    loggable: day !== null && session.date <= day,
  }
}
