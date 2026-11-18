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
  // What reads the race heat, and so is left out while it is unknown.
  'race-heat.left-out': tpl(
    'Until it is known, the plan holds no heat acclimation block (rule I8), no hot-race lines and no earlier nausea plan.',
  ),
  // How to fix it.
  'race-heat.how-set': tpl(
    'Set the race place on the goal. Without one, the plan reads the home place on Profile when the weather switch there is on.',
  ),
  'race-heat.how-unread': tpl('The weather is read in the background, about every 10 minutes.'),
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
  return state === 'no-place' ? 'race-heat.no-place' : 'race-heat.unread'
}

/** The template id of the way to fix the gap. */
export function raceHeatHowId(state: RaceHeatGap): RaceHeatId {
  return state === 'unread' ? 'race-heat.how-unread' : 'race-heat.how-set'
}

/** The three sentences of the notice, in reading order: the fact, what it leaves out, how to fix it. */
export function raceHeatSentences(state: RaceHeatGap): string[] {
  return [
    raceHeatText(raceHeatGapId(state)),
    raceHeatText('race-heat.left-out'),
    raceHeatText(raceHeatHowId(state)),
  ]
}

/** The value of the home-place row: not set, set and in use, or set with the switch off. */
export function homePlaceValue(places: RaceHeatPlaces): string {
  if (!places.homePlaceSet) return raceHeatText('race-heat.places.not-set')
  return raceHeatText(
    places.homeWeatherOn ? 'race-heat.places.home-in-use' : 'race-heat.places.home-off',
  )
}
