// Whether the plan can know the race heat (rule I8, RH1): the state from the places and the cache,
// and the one set of sentences the Race page, Explain and "What the plan can see" share.
import { describe, expect, test } from 'vitest'
import {
  homePlaceValue,
  raceHeatNotice,
  raceHeatSentences,
  raceHeatText,
  RACE_HEAT_TEMPLATES,
} from '../../../shared/copy/raceHeat.ts'
import {
  raceHeatPlaces,
  ROAD_PLAN_CLASSES,
  type RaceHeatInput,
} from '../../../shared/domain/raceHeat.ts'
import { isRoadPlanClass } from '../../../shared/engine/racePlanRoad.ts'

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
    climateFailed: false,
    expectedSec: 4 * 3600,
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

describe('the places the plan reads the heat for, by goal', () => {
  const SUB_2H = 7_000
  const nausea = (model: RaceHeatInput['model'], expectedSec: number): boolean | undefined =>
    raceHeatPlaces(input({ model, expectedSec }))?.nausea

  test('the nausea plan is left out only where the plan has a fuel block', () => {
    // a 10 km never has fuel, however long it takes
    expect(nausea({ isUltra: false, distanceClass: '10k' }, 3 * 3600)).toBe(false)
    // a half under h7.logMinDurationMin has none, a longer one has
    expect(nausea({ isUltra: false, distanceClass: 'half' }, SUB_2H)).toBe(false)
    expect(nausea({ isUltra: false, distanceClass: 'half' }, 7_200)).toBe(true)
    expect(nausea({ isUltra: false, distanceClass: 'marathon' }, 4 * 3600)).toBe(true)
    // an ultra plan always has it
    expect(nausea({ isUltra: true, distanceClass: 'ultra100mi' }, 30 * 3600)).toBe(true)
  })

  test('the sentences name the nausea plan only for those goals', () => {
    const goals: Array<[RaceHeatInput['model'], number, boolean]> = [
      [{ isUltra: false, distanceClass: '10k' }, 3_000, false],
      [{ isUltra: false, distanceClass: 'half' }, SUB_2H, false],
      [{ isUltra: false, distanceClass: 'marathon' }, 4 * 3600, true],
      [{ isUltra: true, distanceClass: 'ultra100mi' }, 30 * 3600, true],
    ]
    for (const [model, expectedSec, named] of goals) {
      const places = raceHeatPlaces(input({ model, expectedSec }))!
      const left = raceHeatSentences('no-place', places.nausea)[1]!
      // every class that can get a heat block names it with the hot-race lines
      expect(left).toContain('heat acclimation block')
      expect(left).toContain('hot-race lines')
      expect(left.includes('earlier nausea plan')).toBe(named)
    }
  })

  test('the classes listed here are the road plan classes', () => {
    const classes = [
      '5k',
      '10k',
      'half',
      'marathon',
      'ultra50',
      'ultra100k',
      'ultra100mi',
      'beyond',
    ] as const satisfies ReadonlyArray<RaceHeatInput['model']['distanceClass']>
    for (const distanceClass of classes) {
      expect(ROAD_PLAN_CLASSES.includes(distanceClass), distanceClass).toBe(
        isRoadPlanClass(distanceClass),
      )
    }
  })
})

describe('a place whose read failed', () => {
  test('is failed, not unread, once a place is usable and nothing is cached', () => {
    expect(raceHeatPlaces(input({ climateFailed: true }))?.state).toBe('no-place')
    const failed = raceHeatPlaces(
      input({ goal: { raceLat: 40.1, raceLng: -105.2 }, climateFailed: true }),
    )
    expect(failed?.state).toBe('failed')
    expect(raceHeatPlaces(input({ climateKnown: true, climateFailed: true }))?.state).toBe('known')
  })

  test('says the read failed and that the app tries again, with no figure', () => {
    const lines = raceHeatSentences('failed', true)
    expect(lines[0]).toContain('last read')
    expect(lines[0]).toContain('got no answer')
    expect(lines[2]).toBe('The app tries the read again later.')
    expect(raceHeatSentences('unread', true)[2]).not.toMatch(/\d/)
    expect(raceHeatNotice('failed', true).link).toBeNull()
  })
})

describe('the shared sentences', () => {
  test('a gap names what reads the race heat and how to set a place', () => {
    for (const state of ['no-place', 'unread', 'failed', undefined] as const) {
      const lines = raceHeatSentences(state, true)
      expect(lines).toHaveLength(3)
      expect(lines[1]).toContain('heat acclimation block')
      expect(lines[1]).toContain('hot-race lines')
      expect(lines[1]).toContain('earlier nausea plan')
    }
    expect(raceHeatSentences('no-place', true)[2]).toContain('race place on the goal')
    expect(raceHeatSentences('no-place', true)[2]).toContain('home place on Profile')
    expect(raceHeatSentences('unread', true)[0]).toContain('has not been read yet')
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
