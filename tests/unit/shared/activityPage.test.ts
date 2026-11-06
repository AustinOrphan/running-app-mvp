import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_PAGE_TEMPLATES,
  againstThePlanHeading,
  movingPaceLabel,
  noLinkedSession,
  paceLabel,
  planNotLoaded,
  plannedAgainstRan,
} from '../../../shared/copy/activityPage.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

const LONG = { title: 'Long run', durationMin: 175 }
const RAN = { type: 'run', durationSec: 3 * 3600 + 5 * 60, distanceM: 28_100 } as const

describe('the sentences of the activity page', () => {
  it('registers every template, so the copy lint renders each one', () => {
    for (const [id, template] of Object.entries(ACTIVITY_PAGE_TEMPLATES)) {
      expect(id).toMatch(/^activity-page\./)
      expect(TEMPLATES[id as keyof typeof TEMPLATES], id).toBe(template)
    }
  })

  it('sets the planned session beside the run, in the runner’s units', () => {
    expect(plannedAgainstRan(LONG, RAN, 'mi')).toBe(
      'Planned: Long run, 2 h 55 min. Ran: 3 h 5 min, 17.5 mi.',
    )
    expect(plannedAgainstRan(LONG, RAN, 'km')).toBe(
      'Planned: Long run, 2 h 55 min. Ran: 3 h 5 min, 28.1 km.',
    )
  })

  it('names a short session in minutes, and a race as a run', () => {
    expect(
      plannedAgainstRan(
        { title: 'Easy run', durationMin: 45 },
        { type: 'race', durationSec: 2700, distanceM: 8000 },
        'km',
      ),
    ).toBe('Planned: Easy run, 45 min. Ran: 45 min, 8 km.')
  })

  it('states the time alone for a run with no distance', () => {
    expect(plannedAgainstRan(LONG, { ...RAN, distanceM: null }, 'mi')).toBe(
      'Planned: Long run, 2 h 55 min. Ran: 3 h 5 min.',
    )
    expect(plannedAgainstRan(LONG, { ...RAN, distanceM: 0 }, 'mi')).toBe(
      'Planned: Long run, 2 h 55 min. Ran: 3 h 5 min.',
    )
  })

  it('says "Did", not "Ran", and gives no distance, for an activity that is not a run', () => {
    expect(
      plannedAgainstRan(
        { title: 'Strength', durationMin: 40 },
        { type: 'strength', durationSec: 2400, distanceM: null },
        'mi',
      ),
    ).toBe('Planned: Strength, 40 min. Did: 40 min.')
    expect(
      plannedAgainstRan(LONG, { type: 'cross', durationSec: 3600, distanceM: 20_000 }, 'mi'),
    ).toBe('Planned: Long run, 2 h 55 min. Did: 1 h.')
  })

  it('says of the current plan that no session was planned, or that the activity is not linked to the one that was', () => {
    expect(noLinkedSession('no-session', 'mi')).toBe(
      'No session of the current plan was planned for this day.',
    )
    expect(noLinkedSession('other-session', 'mi')).toBe(
      'This activity is not linked to a session of the current plan.',
    )
    expect(noLinkedSession('no-plan', 'mi')).toBe(
      'There is no current plan to set this activity against.',
    )
  })

  it('says the plan could not be loaded, and states nothing about the plan', () => {
    expect(planNotLoaded('mi')).toBe(
      'The plan could not be loaded, so this activity is not set against it. Reload the page to try again.',
    )
  })

  it('labels the paces: "Pace" alone, and "Elapsed pace" beside "Moving pace"', () => {
    expect(paceLabel(false, 'mi')).toBe('Pace')
    expect(paceLabel(true, 'mi')).toBe('Elapsed pace')
    expect(movingPaceLabel('km')).toBe('Moving pace')
  })

  it('heads the block "Against the plan"', () => {
    expect(againstThePlanHeading('km')).toBe('Against the plan')
  })

  it('grades nothing: every line passes the G5 lint', () => {
    for (const line of [
      plannedAgainstRan(LONG, RAN, 'mi'),
      plannedAgainstRan(LONG, { ...RAN, distanceM: null }, 'km'),
      plannedAgainstRan(LONG, { type: 'strength', durationSec: 2400, distanceM: null }, 'km'),
      noLinkedSession('no-session', 'km'),
      noLinkedSession('other-session', 'km'),
      noLinkedSession('no-plan', 'km'),
      planNotLoaded('km'),
      againstThePlanHeading('km'),
      paceLabel(true, 'km'),
      movingPaceLabel('km'),
    ]) {
      assertCleanCopy(line, 'The activity page')
    }
  })
})
