// The shape a plan week was drawn under [rules P1 to P4]: the method preset that applied when the
// week was drawn (`resolveMethod(...).effective`), written on the week as a flag so that a re-plan
// can tell the shape of the week it replaces from the shape that applies now. The plan's own shape
// carries no flag, so a week of the default plan is the week it always was and the history oracle
// does not move. Pure; it reads no Param and imports only the types and the light `startWeeks.ts`.
import { isProgrammeWeek } from './startWeeks.ts'
import { isPresetId, type PresetId } from './types.ts'

/** The start of a shape flag: `shape-three-run-days`, `shape-longer-base`. */
const PREFIX = 'shape-'

/**
 * Whether a week with these flags is drawn under a shape. A week a start programme sets (a ladder,
 * an injury return, the floor week) is the programme's whatever the shape, and carries no flag.
 */
export const takesShape = (flags: readonly string[]): boolean =>
  !isProgrammeWeek(flags) && !flags.includes('restart-floor')

/** The flag a week drawn under `shape` carries; the plan's own shape has none. */
export function shapeFlag(shape: PresetId): string | null {
  return shape === 'default' ? null : `${PREFIX}${shape}`
}

/** The shape a week's flags say it was drawn under: the plan's own when none is named. */
export function shapeOfFlags(flags: readonly string[]): PresetId {
  for (const flag of flags) {
    if (!flag.startsWith(PREFIX)) continue
    const id = flag.slice(PREFIX.length)
    if (isPresetId(id) && id !== 'default') return id
  }
  return 'default'
}

/** The week with the flag of `shape` in place of any other shape flag. */
export function withShape<W extends { flags: string[] }>(week: W, shape: PresetId): W {
  const flag = shapeFlag(shape)
  const rest = week.flags.filter((f) => !f.startsWith(PREFIX))
  return flag === null && rest.length === week.flags.length
    ? week
    : { ...week, flags: flag === null ? rest : [...rest, flag] }
}
