// Session targets as every surface shows them [design 4.6, rules C4, H4, I7, I9]. The hero, the
// session sheet, the workout steps, the calendar text and the weekly brief all render from
// `resolveTargets`, so the ceiling, band, pace and effort are the same everywhere. Pure: zones and
// the heat verdict arrive as arguments, nothing reads a clock.
//
// Current zones beat the stored target: an accepted zone change does not re-plan, so a stored
// heart rate can be older than the zones. Work paced from critical speed and D' (threshold,
// intervals, race pace) keeps its stored pace band, which the zones cannot rebuild. The watch-only
// floor (`o1.hrFloorBpm`) and short-step rule belong to the step mapping, not here.
import { NO_HEAT_NOTE_KINDS } from './heat.ts'
import { P } from './params/index.ts'
import type { ResolvedTargets, SessionKind, SessionSpec, ZoneSet } from './types.ts'

/** The part of a session that targets are read from. */
type TargetSource = Pick<SessionSpec, 'kind' | 'target'>
type Range = [number, number]

/** Kinds that are steered by effort; a heart rate the stored target carries stays as secondary text. */
const EFFORT_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'hills',
  'hike',
  'cross',
  'strength',
  'mobility',
  'rest',
])
/** Kinds that keep the stored work pace band. */
const WORK_PACE_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'race',
])
const HOT_NOTE = 'Hot day: go by effort. Heart rate runs high in heat, so use it as a guide only.'
const ZONES_NOTE =
  'Heart rate and pace use your zones as they are now, which changed after this session was planned.'
const CLIMB_NOTE =
  'This run climbs a good deal. Climb by effort rather than by speed, and hike the steep parts when that keeps the effort steady.'

const copy = (range: Range): Range => [range[0], range[1]]
const sameRange = (a: Range | null, b: Range | null): boolean =>
  a !== null && b !== null && a[0] === b[0] && a[1] === b[1]

/**
 * The targets of a session [design 4.6].
 *
 * - Z1 with a heart rate: `hr-ceiling` at the top of the current Z1. Z2 and Z3: `hr-band` from
 *   the current zones. Without zones for it the stored heart rate stands, then pace, then effort.
 * - Threshold, intervals, race pace and the race: `pace`, the stored work band.
 * - Hills, hike, cross-training and strength: `effort`. A hike or cross-training session still
 *   carries the stored Z1 ceiling, and a threshold session the current Z2 band, as secondary text;
 *   intervals and hill repeats carry none, because heart rate lags the work.
 * - `hot` makes `effort` lead and sets `hotNote`; the figures stay as secondary text. A strength,
 *   mobility or rest day is never hot.
 */
export function resolveTargets(
  session: TargetSource,
  zones: ZoneSet | null,
  options: { hot: boolean },
): ResolvedTargets {
  const { kind, target } = session
  const hrZone =
    target.zone === 'z1' || target.zone === 'z2' || target.zone === 'z3' ? target.zone : null
  // Z1 to Z3 sessions of other kinds lead with their heart rate and pace guide from the zones;
  // effort and work-pace sessions show heart rate only when the stored target carries one.
  const leadsWithZones = !EFFORT_KINDS.has(kind) && !WORK_PACE_KINDS.has(kind)

  let fromZones = false
  let changed = false

  let hr: Range | null = null
  if (hrZone !== null && (leadsWithZones || target.hr !== null)) {
    const current = zones?.hr?.[hrZone] ?? null
    if (current !== null) {
      hr = copy(current)
      fromZones = true
      changed ||= target.hr !== null && !sameRange(target.hr, current)
    } else if (target.hr !== null) {
      hr = copy(target.hr)
    }
  }
  const hrCeiling = hrZone === 'z1' && hr !== null ? hr[1] : null
  const hrRange = (hrZone === 'z2' || hrZone === 'z3') && hr !== null ? hr : null

  let pace: Range | null = target.paceSecPerKm === null ? null : copy(target.paceSecPerKm)
  if (hrZone !== null && leadsWithZones) {
    const current = zones?.pace?.[hrZone] ?? null
    if (current !== null) {
      pace = copy(current)
      fromZones = true
      changed ||= target.paceSecPerKm !== null && !sameRange(target.paceSecPerKm, current)
    }
  }

  const byHeartRate: ResolvedTargets['mode'] | null =
    hrCeiling !== null ? 'hr-ceiling' : hrRange !== null ? 'hr-band' : null
  let mode: ResolvedTargets['mode']
  if (EFFORT_KINDS.has(kind)) mode = 'effort'
  else if (WORK_PACE_KINDS.has(kind)) mode = pace !== null ? 'pace' : (byHeartRate ?? 'effort')
  else mode = byHeartRate ?? (pace !== null ? 'pace' : 'effort')

  const hot = options.hot && !NO_HEAT_NOTE_KINDS.has(kind)
  if (hot) mode = 'effort'

  return {
    zone: target.zone,
    mode,
    hrCeiling,
    hrRange,
    paceSecPerKm: pace,
    rpe: copy(target.rpe),
    hot,
    hotNote: hot ? HOT_NOTE : null,
    zonesNote: changed ? ZONES_NOTE : null,
    source: fromZones ? 'zones' : 'plan',
  }
}

/**
 * The climbing line for a session whose planned gain per hour of running reaches
 * `h4.climbNoteGainPerHourM` [rules H4]: climb by effort, never by vertical speed. It names no
 * figure, so it reads the same in metres and in feet.
 */
export function climbNote(session: Pick<SessionSpec, 'gainM' | 'durationMin'>): string | null {
  if (session.gainM === null || !(session.durationMin > 0)) return null
  const perHour = session.gainM / (session.durationMin / 60)
  return perHour >= P.h4.climbNoteGainPerHourM.value ? CLIMB_NOTE : null
}
