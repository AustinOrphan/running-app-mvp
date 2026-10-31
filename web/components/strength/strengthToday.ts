// Where the Today hero gets the workout of a strength session. Today carries it as
// `coach.slots.strength` (design 11.1, 9.6), so the hero reads the payload the page already holds and
// asks for nothing: the first screen keeps to its two requests, and a phone with no connection opens
// the hero and the sheet from the copy the worker kept (ADR 0012).
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_WEIGHT_UNIT, isWeightUnit } from '../../../shared/domain/weight.ts'
import type { StrengthWorkout, TodayView, UserSettings, WeightUnit } from '../../../shared/types.ts'
import { keys } from '../../api/client.ts'
import { dayState, usePhoneCopy, type DayState } from '../today/phoneCopy.ts'

/**
 * A query the page has already loaded, read without asking again: this observer never fetches (not
 * on mount, not on focus) and it re-renders when the page's own query changes the cache. The hero
 * opens on the first screen, which keeps to its two requests.
 */
function useLoaded<T>(key: string): T | undefined {
  return useQuery<T>({ queryKey: [key], enabled: false }).data
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
