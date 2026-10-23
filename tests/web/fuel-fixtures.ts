import { eahCard, replayLadder } from '../../shared/engine/fuel.ts'
import { countsLine } from '../../shared/engine/fuelCopy.ts'
import type { FuelRunInput, RunWeather } from '../../shared/engine/types.ts'
import type {
  FuelHistoryRow,
  FuelLabView,
  FuelLogItem,
  FuelLogResult,
  FuelLogView,
  FuelProduct,
  FuelSettings,
} from '../../shared/types.ts'
import { stepNote } from '../../shared/engine/fuelCopy.ts'

/** Two products of a synthetic list. */
export const GEL: FuelProduct = {
  id: 'p-gel',
  name: 'Example gel',
  kind: 'gel',
  servingLabel: '1 gel',
  carbsG: 25,
  sodiumMg: 50,
  kcal: 100,
  multiCarb: true,
  archived: false,
}

export const DRINK: FuelProduct = {
  id: 'p-drink',
  name: 'Example drink mix',
  kind: 'drink',
  servingLabel: '500 mL bottle',
  carbsG: 40,
  sodiumMg: 300,
  kcal: 160,
  multiCarb: true,
  archived: false,
}

/** A cool day and a hot one for fuel (22 C at 80% humidity is a shade WBGT of about 19.7). */
export const COOL: RunWeather = { tempC: 12, humidityPct: 60, windKph: 5 }
export const HOT: RunWeather = { tempC: 22, humidityPct: 80, windKph: 0 }

export const SETTINGS: FuelSettings = {
  optIn90: false,
  optInAdvanced: false,
  giDisease: false,
  gutBlock: true,
}

/** A logged three-hour run: `servings` of the gel, and the scores. */
export function loggedRun(
  n: number,
  over: {
    servings?: number
    gut?: number
    nausea?: number | null
    activityId?: string
  } = {},
): FuelRunInput {
  return {
    activityId: over.activityId ?? `run${String(n)}`,
    date: `2026-03-${String(n).padStart(2, '0')}`,
    startTime: null,
    elapsedSec: 3 * 3600,
    weather: COOL,
    sessionFlags: null,
    log: {
      skipped: false,
      items: [
        {
          name: GEL.name,
          carbsG: GEL.carbsG,
          sodiumMg: GEL.sodiumMg,
          kcal: GEL.kcal,
          multiCarb: GEL.multiCarb,
          servings: over.servings ?? 6,
        },
      ],
      gut: over.gut ?? 0,
      nausea: over.nausea ?? null,
      hotOverride: null,
    },
  }
}

/** The lab view after `runs` were logged, newest first in the history, as the server builds it. */
export function makeLab(
  runs: FuelRunInput[] = [],
  over: Partial<FuelLabView> = {},
  fluid: Record<string, number> = {},
): FuelLabView {
  const settings = { optIn90: false, optInAdvanced: false, giDisease: false }
  const ladder = replayLadder({ settings, runs, gutTrainingWeeks: [] })
  const history: FuelHistoryRow[] = [...ladder.steps].reverse().flatMap((step) => {
    const input = runs.find((candidate) => candidate.activityId === step.activityId)
    if (input === undefined) return []
    const items: FuelLogItem[] = input.log.items.map((item) => ({ ...item, productId: GEL.id }))
    const log: FuelLogView = {
      id: `log-${step.activityId}`,
      activityId: step.activityId,
      skipped: input.log.skipped,
      items,
      fluidMl: fluid[step.activityId] ?? null,
      sodiumMg: null,
      gut: input.log.gut,
      nausea: input.log.nausea,
      hot: input.log.hotOverride,
      notes: null,
      step,
      counts: countsLine(step),
    }
    return [{ log, note: stepNote(step) }]
  })
  return {
    settings: SETTINGS,
    ladder,
    next: null,
    block: { state: 'planned', weeks: [], from: null, to: null, removalPending: false, lines: [] },
    products: [GEL, DRINK],
    history,
    prompts: [],
    eah: eahCard({ eventHours: null, hot: false }),
    disclaimers: { general: 'Fuel targets are decision support.', gutCondition: null },
    ...over,
  }
}

/** The log of a run as the server serves it after `runs` were logged. */
export function logOf(runs: FuelRunInput[], activityId: string): FuelLogView {
  const row = makeLab(runs).history.find((candidate) => candidate.log.activityId === activityId)
  if (row === undefined) throw new Error(`No log for ${activityId}.`)
  return row.log
}

/** The answer to a save: the log, the ladder and the sentence the toast shows. */
export function saved(runs: FuelRunInput[], activityId: string): FuelLogResult {
  const lab = makeLab(runs)
  const row = lab.history.find((candidate) => candidate.log.activityId === activityId)
  return { log: row?.log ?? null, ladder: lab.ladder, message: row?.note ?? null }
}
