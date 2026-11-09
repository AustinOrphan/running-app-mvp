import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { makeCoach, makeRace, makeToday } from './today-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'

beforeEach(startToday)

const COURSE = [
  { distanceM: 0, relM: 0 },
  { distanceM: 20_000, relM: 400 },
  { distanceM: 40_000, relM: 100 },
]

describe('Today: the course silhouette under the countdown', () => {
  test('draws a decorative drawing the sentence already explains', async () => {
    const { container } = renderToday(
      makeToday({ coach: makeCoach({ race: makeRace({ course: COURSE }) }) }),
    )
    const race = await screen.findByRole('region', { name: 'Race' })
    const drawing = race.querySelector('svg')
    expect(drawing).not.toBeNull()
    expect(drawing).toHaveAttribute('aria-hidden', 'true')
    expect(drawing).not.toHaveAttribute('role')
    expect(drawing!.querySelector('title, text')).toBeNull()
    expect(drawing!.querySelectorAll('path')).toHaveLength(2)
    // Hidden from the accessibility tree, and the link's name is the sentence alone.
    expect(within(race).queryByRole('img')).not.toBeInTheDocument()
    expect(within(race).getByRole('link')).toHaveAccessibleName(
      /87 days to the race\s*Example Half.*Open the race plan/,
    )
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0)
  })

  test.each([
    ['null course', { course: null }],
    ['an answer kept from before the field existed', {}],
  ])('draws nothing for %s, and no placeholder', async (_name, over) => {
    renderToday(makeToday({ coach: makeCoach({ race: makeRace(over) }) }))
    const race = await screen.findByRole('region', { name: 'Race' })
    expect(race.querySelector('svg')).toBeNull()
    expect(within(race).getByRole('link')).toBeInTheDocument()
  })
})
