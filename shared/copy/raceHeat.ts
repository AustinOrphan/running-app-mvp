// The words for "the plan cannot see the race heat" (rule I8, batch RH1). One set of sentences is
// read by the Race page, the I8 fact in Explain and the places row of "What the plan can see", so
// the three say the same thing. A fact and how to set it, no verdict; `RACE_HEAT_TEMPLATES` is
// spread into `TEMPLATES`. The state comes from `raceHeatPlaces` (`shared/domain/raceHeat.ts`).
import type { RaceHeatPlaces, RaceHeatState } from '../domain/raceHeat.ts'
import { render, tpl, type Template } from './template.ts'

export const RACE_HEAT_TEMPLATES = {
  // The fact: what is missing, by what the code can tell.
  'race-heat.no-place': tpl(
    'Race heat is unknown, because the goal has no race place and no home place is in use.',
  ),
  'race-heat.unknown': tpl('Race heat is unknown, because the race climate is not saved.'),
  'race-heat.unread': tpl(
    'The place for the race heat is set, but the usual weather for the race date has not been read yet.',
  ),
  'race-heat.failed': tpl(
    'The place for the race heat is set, but the last read of the usual weather for the race date got no answer.',
  ),
  // What reads the race heat, and so is left out while it is unknown. The nausea plan comes
  // forward on a hot race only where the plan has a fuel block, so a goal without one leaves it out.
  'race-heat.left-out': tpl(
    'Until it is known, the plan holds no heat acclimation block (rule I8), no hot-race lines and no earlier nausea plan.',
  ),
  'race-heat.left-out-no-fuel': tpl(
    'Until it is known, the plan holds no heat acclimation block (rule I8) and no hot-race lines.',
  ),
  // How to fix it.
  'race-heat.how-set': tpl(
    'Set the race place on the goal. Without one, the plan reads the home place on Profile when the weather switch there is on.',
  ),
  'race-heat.how-unread': tpl('The weather is read in the background.'),
  'race-heat.how-failed': tpl('The app tries the read again later.'),
  'race-heat.link.race': tpl('Set the race place', {}, { shape: 'label' }),
  'race-heat.link.home': tpl('Set the home place', {}, { shape: 'label' }),

  // The places row of "What the plan can see".
  'race-heat.places.heading': tpl('Race heat', {}, { shape: 'label' }),
  'race-heat.places.context': tpl(
    'The plan reads the usual weather for the race date at one place: the race place when it is set, else the home place when its weather switch is on.',
  ),
  'race-heat.places.race': tpl('Race place on the goal', {}, { shape: 'label' }),
  'race-heat.places.home': tpl('Home place on Profile', {}, { shape: 'label' }),
  'race-heat.places.set': tpl('Set', {}, { shape: 'label' }),
  'race-heat.places.not-set': tpl('Not set', {}, { shape: 'label' }),
  'race-heat.places.home-in-use': tpl('Set, weather switch on', {}, { shape: 'label' }),
  'race-heat.places.home-off': tpl('Set, weather switch off', {}, { shape: 'label' }),
  'race-heat.places.known-race': tpl(
    'The usual weather for the race date is read, at the race place.',
  ),
  'race-heat.places.known-home': tpl(
    'The usual weather for the race date is read, at the home place.',
  ),
} satisfies Record<string, Template>

export type RaceHeatId = keyof typeof RACE_HEAT_TEMPLATES

/** A sentence or label of the notice or the row; none takes a slot. */
export function raceHeatText(id: RaceHeatId): string {
  return render(RACE_HEAT_TEMPLATES[id], {}, 'km')
}

/** The state of a plan kept before the field existed: the heat is missing and the cause is not known. */
export type RaceHeatGap = Exclude<RaceHeatState, 'known'> | undefined

/** The template id of the gap fact. */
export function raceHeatGapId(state: RaceHeatGap): RaceHeatId {
  if (state === undefined) return 'race-heat.unknown'
  if (state === 'no-place') return 'race-heat.no-place'
  return state === 'failed' ? 'race-heat.failed' : 'race-heat.unread'
}

/** The template id of the way to fix the gap. */
export function raceHeatHowId(state: RaceHeatGap): RaceHeatId {
  if (state === 'unread') return 'race-heat.how-unread'
  return state === 'failed' ? 'race-heat.how-failed' : 'race-heat.how-set'
}

/**
 * The template id of what the gap leaves out. `nausea` is whether the goal's plan has a fuel block
 * (an ultra, or a road race long enough for the ladder), the only plan the earlier nausea plan is in.
 */
export function raceHeatLeftOutId(nausea: boolean): RaceHeatId {
  return nausea ? 'race-heat.left-out' : 'race-heat.left-out-no-fuel'
}

/** The three sentences of the notice, in reading order: the fact, what it leaves out, how to fix it. */
export function raceHeatSentences(state: RaceHeatGap, nausea: boolean): string[] {
  return [
    raceHeatText(raceHeatGapId(state)),
    raceHeatText(raceHeatLeftOutId(nausea)),
    raceHeatText(raceHeatHowId(state)),
  ]
}

/**
 * The Race page's line: the three sentences, and the link to the goal when no place is set (a place
 * that is set leaves nothing for the runner to add).
 */
export function raceHeatNotice(
  state: RaceHeatGap,
  nausea: boolean,
): { text: string; link: string | null; to: 'goals' | null } {
  const placeSet = state === 'unread' || state === 'failed'
  return {
    text: raceHeatSentences(state, nausea).join(' '),
    link: placeSet ? null : raceHeatText('race-heat.link.race'),
    to: placeSet ? null : 'goals',
  }
}

/** The value of the home-place row: not set, set and in use, or set with the switch off. */
export function homePlaceValue(places: RaceHeatPlaces): string {
  if (!places.homePlaceSet) return raceHeatText('race-heat.places.not-set')
  return raceHeatText(
    places.homeWeatherOn ? 'race-heat.places.home-in-use' : 'race-heat.places.home-off',
  )
}
