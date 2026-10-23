import { useQuery } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import { addDays, mondayOf, todayIso } from '../../../shared/dates.ts'
import type { TodayView, Units, UserSettings, WristItem } from '../../../shared/types.ts'
import { useBriefs } from '../../api/brief.ts'
import { keys } from '../../api/client.ts'
import { BriefLine } from '../BriefLine.tsx'
import { useInView } from '../useInView.ts'
import { useOnline } from '../useOnline.ts'
import { useWristLine, WristLineText } from '../WristLine.tsx'
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

/** The line itself, in its frame: the frame appears only while the line has something to say. */
function WatchLine({ item }: { item: WristItem | undefined }) {
  const line = useWristLine(item)
  return <SlotFrame name="watch">{line === null ? null : <WristLineText line={line} />}</SlotFrame>
}

/**
 * E1: one line about the hero's run on the watch, under the session's actions (24 px). The item
 * is the hero's entry in the payload's `watch` slot, so the line adds no request. Offline the
 * payload may come from the device's copy, and a saved "On your watch" would be false, so the
 * line renders nothing then. Keyed by the session, so the "state changed since the page loaded"
 * rule starts over for each run.
 */
function WatchMount() {
  const today = useLoaded<TodayView>(keys.today)
  const online = useOnline()
  const sessionId = today?.coach.hero?.session.id
  if (!online || sessionId === undefined) return null
  const item = today?.coach.slots.watch?.items.find((i) => i.sessionId === sessionId)
  return <WatchLine key={sessionId} item={item} />
}

/**
 * The brief line of the current week, once its marker is near the viewport. The marker is a 1 px
 * box out of the layout, so it takes no height and no grid cell, and it is always rendered so the
 * observer finds it.
 */
function BriefSlot({ units }: { units: Units }) {
  const [marker, near] = useInView<HTMLDivElement>()
  const briefs = useBriefs(1, { enabled: near })
  const newest = briefs.data?.[0]
  return (
    <>
      <div
        ref={marker}
        aria-hidden="true"
        style={{ position: 'absolute', width: 1, height: 1, pointerEvents: 'none' }}
      />
      <SlotFrame name="brief">
        {newest === undefined || newest.weekStart !== mondayOf(todayIso()) ? null : (
          <BriefLine item={newest} units={units} />
        )}
      </SlotFrame>
    </>
  )
}

/**
 * E4: the weekly brief line. `GET /api/briefs` is not part of the Today payload, so the first
 * screen keeps to its two requests: nothing is asked for until the slot scrolls near the viewport,
 * and nothing is drawn before the settings, which give the units, are in the cache. The line shows
 * the brief of the current week; an older one would say "since last week" of a week that is gone,
 * and a failed request shows nothing.
 */
function BriefMount() {
  const settings = useLoaded<UserSettings>(keys.settings)
  return settings === undefined ? null : <BriefSlot units={settings.units} />
}

/**
 * What fills a slot that its page places without content. An epic that fills its slot from the
 * Today payload adds its mount here; a slot whose content depends on the page's own state is
 * filled by the page and has no entry. A page that passes content to a slot keeps the mount out of
 * it, so the brief slot takes the brief line only where the page leaves it without content.
 */
export const SLOT_MOUNTS: Partial<Record<SlotName, ComponentType>> = {
  brief: BriefMount,
  fuel: FuelTargetMount,
  watch: WatchMount,
  fuelPrompt: FuelPromptMount,
}
