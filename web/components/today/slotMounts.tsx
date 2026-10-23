import { useQuery } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import { addDays } from '../../../shared/dates.ts'
import type { TodayView, UserSettings } from '../../../shared/types.ts'
import { keys } from '../../api/client.ts'
import { FuelPromptCard } from '../fuel/FuelPromptCard.tsx'
import { FuelTargetLine } from '../fuel/FuelTargetLine.tsx'
import { SlotFrame } from './SlotFrame.tsx'
import type { SlotName } from './slots.ts'

/**
 * A query the page has already loaded, read without asking again: this observer never fetches (not
 * on mount, not on focus), and it re-renders when the page's own query changes the cache. The page
 * owns the request, so a mount adds none and the request counts of its tests stay as they were.
 */
function useLoaded<T>(key: string): T | undefined {
  return useQuery<T>({ queryKey: [key], enabled: false }).data
}

/**
 * The target of the hero's session, else the one for the day after the viewed day (labelled as
 * tomorrow's), else nothing. The payload holds both days; a line that is not about the session the
 * runner is looking at says whose day it is.
 */
function fuelLine(view: TodayView): ReactNode {
  const fuel = view.coach.slots.fuel
  if (fuel === null) return null
  const sessionId = view.coach.hero?.session.id
  const own = fuel.targets.find((target) => target.session.id === sessionId)
  if (own !== undefined) return <FuelTargetLine key={own.session.id} view={own} eah={fuel.eah} />
  const following = addDays(view.date, 1)
  const next = fuel.targets.find((target) => target.session.date === following)
  return next === undefined ? null : (
    <FuelTargetLine key={next.session.id} view={next} eah={fuel.eah} tomorrow />
  )
}

/** E6: the fuel target line beside the session's targets (26 px; opens to the reason). */
function FuelTargetMount() {
  const today = useLoaded<TodayView>(keys.today)
  return <SlotFrame name="fuel">{today === undefined ? null : fuelLine(today)}</SlotFrame>
}

/** E6: the fuel log card below the fold, for the recent runs that have no log yet. */
function FuelPromptMount() {
  const today = useLoaded<TodayView>(keys.today)
  const settings = useLoaded<UserSettings>(keys.settings)
  const prompts = today?.coach.slots.fuelPrompt?.prompts ?? []
  return (
    <SlotFrame name="fuelPrompt">
      {prompts.length === 0 || settings === undefined ? null : (
        <FuelPromptCard prompts={prompts} units={settings.units} />
      )}
    </SlotFrame>
  )
}

/**
 * What fills a slot that its page places without content. An epic that fills its slot from the
 * Today payload adds its mount here; a slot whose content depends on the page's own state (the
 * brief line) is filled by the page and has no entry.
 */
export const SLOT_MOUNTS: Partial<Record<SlotName, ComponentType>> = {
  fuel: FuelTargetMount,
  fuelPrompt: FuelPromptMount,
}
