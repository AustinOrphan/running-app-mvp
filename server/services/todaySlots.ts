// The named slots of the Today payload (phase 3a design 7.4 and 7.6). Each owning epic gives its
// slot a type in `TodaySlots` and a provider here: the disruption banner (E5), the fuel target
// line and the fuel prompt (E6), the watch line (E1) and the brief line (E4). Until its epic
// lands, a provider answers null and the slot takes no height. The disruption slot (E5-5) holds
// the window in effect, else an offer to set one (`disruptionSlot`).
//
// The providers run side by side under `Promise.allSettled`. A provider that throws, or whose
// promise rejects, leaves its slot null and is logged; the page still loads. A provider receives
// the viewed date, reads the snapshot or a table of its own, and never the network.
import type { EngineInput } from '../../shared/engine/types.ts'
import type { TodaySlots } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { createLogger } from '../logger.ts'
import type { AthleteContext } from './athleteState.ts'
import { disruptionSlot } from './disruptions.ts'
import { todayFuelPromptSlot, todayFuelSlot } from './fuel.ts'
import { safeMessage } from './syncLog.ts'

export type SlotName = keyof TodaySlots

export interface SlotArgs {
  deps: Deps
  userId: string
  /** The viewed day: today, or a day ahead for a preview. */
  date: string
  /** The snapshot's day. */
  today: string
  /** True for a day after today: read-only, so a provider writes nothing. */
  preview: boolean
  context: AthleteContext
  /** The cached home forecast the page already read (null without one): a provider reuses it. */
  forecast: EngineInput['forecast']
}

export type SlotProvider<K extends SlotName> = (
  args: SlotArgs,
) => TodaySlots[K] | Promise<TodaySlots[K]>

/**
 * One provider per slot. The type is a mapped record, so a slot added to `TodaySlots` is a compile
 * error here until it has a provider. A provider that reads a table the data version does not cover
 * registers a change stamp too (`registerTodayStamp` in `today.ts`), or the page's ETag would hide
 * its changes.
 */
export const slotProviders: { [K in SlotName]: SlotProvider<K> } = {
  disruption: ({ context, date, preview }) => disruptionSlot({ context, date, preview }),
  // Fuel reads state only (the logs, the switches, the plan) and the cached home forecast, so the
  // data version and the forecast stamp in the page's ETag already cover it: no stamp of its own.
  fuel: ({ deps, userId, date, today, context, forecast }) =>
    todayFuelSlot(deps, { userId, today, date, context, forecast }),
  watch: () => null,
  brief: () => null,
  fuelPrompt: ({ deps, userId, today, preview, context }) =>
    todayFuelPromptSlot(deps, { userId, today, preview, context }),
}

/** Every slot with its provider's answer; a failed provider's slot is null. */
export async function buildSlots(args: SlotArgs): Promise<TodaySlots> {
  const names = Object.keys(slotProviders) as SlotName[]
  const settled = await Promise.allSettled(
    // The async wrapper turns a synchronous throw into a rejection.
    names.map(async (name) => (slotProviders[name] as SlotProvider<SlotName>)(args)),
  )
  const slots = Object.fromEntries(names.map((name) => [name, null])) as Record<SlotName, unknown>
  settled.forEach((result, index) => {
    const name = names[index]!
    if (result.status === 'fulfilled') {
      slots[name] = result.value ?? null
    } else {
      createLogger(args.deps.config).warn(
        { slot: name, reason: safeMessage(result.reason) },
        'a Today slot provider failed',
      )
    }
  })
  return slots as TodaySlots
}
