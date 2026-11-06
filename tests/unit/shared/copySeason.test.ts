import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import {
  SEASON_TEMPLATES,
  seasonDescription,
  seasonLegend,
  seasonTitle,
  seasonWeekName,
  seasonWeeksName,
  type SeasonRun,
} from '../../../shared/copy/season.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

const run = (
  label: string,
  kind: SeasonRun['kind'],
  firstWeek: string,
  lastWeek: string,
  weeks: number,
): SeasonRun => ({ label, kind, firstWeek, lastWeek, weeks })

/** A plan of 25 weeks from Monday 9 Nov: the brief's season, the shape the strip describes. */
const SEASON: SeasonRun[] = [
  run('Base', 'phase', '2026-11-09', '2026-12-07', 5),
  run('Build', 'phase', '2026-12-14', '2027-02-01', 8),
  run('Specific', 'phase', '2027-02-08', '2027-04-12', 10),
  run('Taper', 'phase', '2027-04-19', '2027-04-19', 1),
  run('Race week', 'race', '2027-04-26', '2027-04-26', 1),
]

describe('the words of the season strip', () => {
  it('registers every template, so the shared lint test renders it', () => {
    for (const id of Object.keys(SEASON_TEMPLATES)) {
      expect(TEMPLATES[id as keyof typeof TEMPLATES], id).toBe(
        SEASON_TEMPLATES[id as keyof typeof SEASON_TEMPLATES],
      )
    }
  })

  it('names the region, the group of weeks and the legend', () => {
    expect(seasonTitle()).toBe('Season')
    expect(seasonWeeksName()).toBe('Weeks of the plan')
    expect(seasonLegend()).toBe('Solid is actual, outline is planned.')
  })
})

describe('seasonDescription', () => {
  it('reads the phases in order, each to the Monday of its last week, the race week by its own', () => {
    expect(seasonDescription(SEASON, '2026-11-09')).toBe(
      'A 25-week plan: base to 7 Dec, build to 1 Feb, specific to 12 Apr, taper, race week of 26 Apr. This week is the week of 9 Nov.',
    )
  })

  it('leaves the date off the phase just before the race week, and keeps it when none follows', () => {
    const noTaper = [SEASON[0]!, SEASON[2]!, SEASON[4]!]
    expect(seasonDescription(noTaper, '2026-11-09')).toContain(
      'base to 7 Dec, specific, race week of 26 Apr.',
    )
    const unfinished = [SEASON[0]!, SEASON[1]!]
    expect(seasonDescription(unfinished, '2026-11-09')).toContain(
      'A 13-week plan: base to 7 Dec, build to 1 Feb.',
    )
  })

  it('counts the weeks after the race, one or many, and names them as the table does', () => {
    const after = (weeks: number) =>
      seasonDescription(
        [...SEASON, run('After the race', 'after', '2027-05-03', '2027-05-03', weeks)],
        '2026-11-09',
      )
    expect(after(3)).toContain('race week of 26 Apr, then 3 weeks after the race.')
    expect(after(1)).toContain('race week of 26 Apr, then 1 week after the race.')
    expect(after(3)).toContain('A 28-week plan')
  })

  it('names the version-1 phases as the table does, in lower case', () => {
    const v1 = [
      run('Restart', 'phase', '2026-11-09', '2026-11-16', 2),
      run('Base 1', 'phase', '2026-11-23', '2026-12-07', 3),
      run('Endurance', 'phase', '2026-12-14', '2026-12-28', 3),
      run('Peak', 'phase', '2027-01-04', '2027-01-11', 2),
      run('Race week', 'race', '2027-01-18', '2027-01-18', 1),
    ]
    expect(seasonDescription(v1, '2026-11-09')).toContain(
      'restart to 16 Nov, base 1 to 7 Dec, endurance to 28 Dec, peak, race week of 18 Jan.',
    )
  })

  it('says where today stands: in the plan, before it, or after it', () => {
    expect(seasonDescription(SEASON, '2027-01-11')).toMatch(/This week is the week of 11 Jan\.$/)
    expect(seasonDescription(SEASON, '2026-11-02')).toMatch(/The plan starts the week of 9 Nov\.$/)
    expect(seasonDescription(SEASON, '2027-05-03')).toMatch(/The plan ended the week of 26 Apr\.$/)
  })

  it('is empty for a plan with no weeks', () => {
    expect(seasonDescription([], '2026-11-09')).toBe('')
  })

  it('keeps each sentence within the length of a template, and breaks no word of the G5 lint', () => {
    const full = seasonDescription(
      [...SEASON, run('After the race', 'after', '2027-05-03', '2027-05-17', 3)],
      '2026-11-09',
    )
    for (const sentence of full.split(/(?<=\.) /)) {
      expect(sentence.length, sentence).toBeLessThanOrEqual(COPY_MAX_CHARS)
    }
    assertCleanCopy(full, 'the season description')
  })

  it('has no word for a target and says "this week" in the plan', () => {
    const text = seasonDescription(SEASON, '2027-01-11')
    expect(text).not.toMatch(/target/i)
    expect(text).toMatch(/this week/i)
  })
})

describe('seasonWeekName', () => {
  const week = {
    weekStart: '2026-11-09',
    label: 'Base',
    plannedMin: 312,
    ranMin: null,
    current: false,
  }

  it('names the week, its phase and the minutes planned', () => {
    expect(seasonWeekName(week)).toBe('Week of 9 Nov, base, 5.2 h planned')
  })

  it('adds the minutes run where the week has been read, even none', () => {
    expect(seasonWeekName({ ...week, ranMin: 150 })).toBe(
      'Week of 9 Nov, base, 5.2 h planned, 2.5 h run',
    )
    expect(seasonWeekName({ ...week, ranMin: 0 })).toBe(
      'Week of 9 Nov, base, 5.2 h planned, 0.0 h run',
    )
  })

  it('opens with "This week" for the current week', () => {
    expect(seasonWeekName({ ...week, current: true, ranMin: 150 })).toBe(
      'This week, week of 9 Nov, base, 5.2 h planned, 2.5 h run',
    )
  })

  it('says no running is planned for a week planned at none, never "0.0 h planned"', () => {
    const none = seasonWeekName({ ...week, label: 'After the race', plannedMin: 0 })
    expect(none).toBe('Week of 9 Nov, after the race, no running planned')
    expect(seasonWeekName({ ...week, plannedMin: 0.4 })).toContain('no running planned')
  })

  it('never grades a week: clean of the G5 lint whatever was run', () => {
    for (const ranMin of [null, 0, 60, 600]) {
      assertCleanCopy(seasonWeekName({ ...week, ranMin }), 'a week name')
    }
  })
})
