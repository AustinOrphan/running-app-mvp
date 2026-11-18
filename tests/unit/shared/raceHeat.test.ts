// Whether the plan can know the race heat (rule I8, RH1): the state from the places and the cache,
// and the one set of sentences the Race page, Explain and "What the plan can see" share.
import { describe, expect, test } from 'vitest'
import {
  homePlaceValue,
  raceHeatSentences,
  raceHeatText,
  RACE_HEAT_TEMPLATES,
} from '../../../shared/copy/raceHeat.ts'
import { raceHeatPlaces, type RaceHeatInput } from '../../../shared/domain/raceHeat.ts'

const TODAY = '2026-06-01'

function input(
  over: Omit<Partial<RaceHeatInput>, 'goal'> & { goal?: Partial<RaceHeatInput['goal']> } = {},
): RaceHeatInput {
  const { goal, ...rest } = over
  return {
    goal: { raceLat: null, raceLng: null, targetDate: '2026-08-01', ...goal },
    model: { isUltra: false, distanceClass: 'marathon' },
    home: { lat: null, lng: null, use: false },
    climateKnown: false,
    today: TODAY,
    ...rest,
  }
}

describe('raceHeatPlaces', () => {
  test('no race place and no home place in use: no place, so the heat is unknown', () => {
    expect(raceHeatPlaces(input())).toMatchObject({ using: null, state: 'no-place' })
    // a home place with its weather switch off is not used
    expect(raceHeatPlaces(input({ home: { lat: 46.8, lng: 7.1, use: false } }))).toMatchObject({
      using: null,
      homePlaceSet: true,
      homeWeatherOn: false,
      state: 'no-place',
    })
  })

  test('the race place is used first, then home when its switch is on', () => {
    const race = raceHeatPlaces(
      input({
        goal: { raceLat: 40.1, raceLng: -105.2 },
        home: { lat: 46.8, lng: 7.1, use: true },
      }),
    )
    expect(race).toMatchObject({ using: 'race', racePlaceSet: true, state: 'unread' })
    const home = raceHeatPlaces(input({ home: { lat: 46.8, lng: 7.1, use: true } }))
    expect(home).toMatchObject({ using: 'home', racePlaceSet: false, state: 'unread' })
  })

  test('one coordinate is not a place', () => {
    expect(raceHeatPlaces(input({ goal: { raceLat: 40.1 } }))).toMatchObject({
      racePlaceSet: false,
      state: 'no-place',
    })
    expect(raceHeatPlaces(input({ home: { lat: 46.8, lng: null, use: true } }))).toMatchObject({
      homePlaceSet: false,
      state: 'no-place',
    })
  })

  test('a cached climate makes the heat known, whatever the places', () => {
    expect(raceHeatPlaces(input({ climateKnown: true }))?.state).toBe('known')
  })

  test('nothing for a goal the race plan does not cover or a race that is past', () => {
    expect(raceHeatPlaces(input({ model: { isUltra: false, distanceClass: '5k' } }))).toBeNull()
    expect(raceHeatPlaces(input({ goal: { targetDate: '2026-05-31' } }))).toBeNull()
    // race day itself still counts
    expect(raceHeatPlaces(input({ goal: { targetDate: TODAY } }))).not.toBeNull()
    for (const model of [
      { isUltra: true, distanceClass: 'ultra100mi' },
      { isUltra: false, distanceClass: '10k' },
      { isUltra: false, distanceClass: 'half' },
    ] as const) {
      expect(raceHeatPlaces(input({ model }))).not.toBeNull()
    }
  })
})

describe('the shared sentences', () => {
  test('a gap names what reads the race heat and how to set a place', () => {
    for (const state of ['no-place', 'unread', undefined] as const) {
      const lines = raceHeatSentences(state)
      expect(lines).toHaveLength(3)
      expect(lines[1]).toContain('heat acclimation block')
      expect(lines[1]).toContain('hot-race lines')
      expect(lines[1]).toContain('earlier nausea plan')
    }
    expect(raceHeatSentences('no-place')[2]).toContain('race place on the goal')
    expect(raceHeatSentences('no-place')[2]).toContain('home place on Profile')
    expect(raceHeatSentences('unread')[0]).toContain('has not been read yet')
  })

  test('the home row says set and in use, set and off, or not set', () => {
    const places = raceHeatPlaces(input({ home: { lat: 1, lng: 2, use: true } }))!
    expect(homePlaceValue(places)).toBe('Set, weather switch on')
    expect(homePlaceValue({ ...places, homeWeatherOn: false })).toBe('Set, weather switch off')
    expect(homePlaceValue({ ...places, homePlaceSet: false })).toBe('Not set')
  })

  test('every template is a plain sentence or label', () => {
    for (const id of Object.keys(RACE_HEAT_TEMPLATES) as Array<keyof typeof RACE_HEAT_TEMPLATES>) {
      expect(raceHeatText(id).length).toBeGreaterThan(0)
    }
  })
})
