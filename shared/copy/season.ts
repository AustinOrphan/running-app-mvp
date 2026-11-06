// The words of the season strip on the Plan page: one bar per plan week with the phase brackets
// under it. A screen reader gets the shape from a short description of the plan (its phases, its
// race week and which week is this one) and a name for each week; the bars themselves say nothing
// to it. The figures are the plan's, as the week table prints them, so no sentence here grades a
// week or calls a figure a minimum.
//
// A phase is named as the week table names it ("Base", "Specific", "Taper", "Race week", "After the
// race"); the page passes the names, so this file knows no phase. The dates are the Mondays the
// table rows carry.
import { addDays } from '../dates.ts'
import { render, tpl, type Template } from './template.ts'
import { weekRanText } from './pageCopy.ts'

export const SEASON_TEMPLATES = {
  // The heading of the strip's region, and the name of the group of week buttons.
  'season.title': tpl('Season', {}, { shape: 'label' }),
  'season.weeks': tpl('Weeks of the plan', {}, { shape: 'label' }),
  // The line under the bars.
  'season.legend': tpl('Solid is actual, outline is planned.'),
  // The description: the plan's phases in order, then where today stands in it.
  'season.summary': tpl(
    'A {weeks}-week plan: {phases}.',
    { weeks: 'count', phases: 'text' },
    { fallback: 'A plan of weekly running time.' },
  ),
  'season.run-to': tpl(
    '{phase} to {date}',
    { phase: 'text', date: 'date' },
    { fallback: 'a phase', shape: 'label' },
  ),
  'season.race-week': tpl(
    'race week of {date}',
    { date: 'date' },
    { fallback: 'race week', shape: 'label' },
  ),
  'season.after-one': tpl('then 1 week after the race', {}, { shape: 'label' }),
  'season.after': tpl(
    'then {weeks} weeks after the race',
    { weeks: 'count' },
    { fallback: 'then the weeks after the race', shape: 'label' },
  ),
  'season.now-in': tpl(
    'This week is the week of {date}.',
    { date: 'date' },
    { fallback: 'This week is in the plan.' },
  ),
  'season.now-before': tpl(
    'The plan starts the week of {date}.',
    { date: 'date' },
    { fallback: 'The plan has not started.' },
  ),
  'season.now-after': tpl(
    'The plan ended the week of {date}.',
    { date: 'date' },
    { fallback: 'The plan has ended.' },
  ),
  // The name of one week's button: the week, its phase and its figures.
  'season.week': tpl(
    'Week of {date}, {phase}',
    { date: 'date', phase: 'text' },
    { fallback: 'A week of the plan', shape: 'label' },
  ),
  'season.week-now': tpl(
    'This week, week of {date}, {phase}',
    { date: 'date', phase: 'text' },
    { fallback: 'This week', shape: 'label' },
  ),
  'season.planned': tpl(
    '{planned} planned',
    { planned: 'weekMinutes' },
    { fallback: 'planned', shape: 'label' },
  ),
  'season.planned-none': tpl('no running planned', {}, { shape: 'label' }),
} satisfies Record<string, Template>

/**
 * A run of consecutive weeks that read the same phase name, as the week table groups them. `kind`
 * says what the run is to the sentence: a phase of the build, the race week itself, or the weeks
 * after it.
 */
export interface SeasonRun {
  /** The name the week table prints for the run: "Base", "Race week", "After the race". */
  label: string
  kind: 'phase' | 'race' | 'after'
  /** Monday of the run's first week. */
  firstWeek: string
  /** Monday of the run's last week. */
  lastWeek: string
  weeks: number
}

const STORED_UNITS = 'km'

/**
 * The strip's description: "A 25-week plan: base to 13 Dec, build to 7 Feb, specific to 18 Apr,
 * taper, race week of 26 Apr. This week is the week of 9 Nov." A phase reads "to" the Sunday that
 * ends its last week, as a block of plan weeks does elsewhere (the gut-training weeks); the race
 * week and this week are named by their Monday, as the week table names a row. The phase just
 * before the race week reads bare, since the race week's own date follows it, and a plan with one
 * taper week then does not read as one with two. `thisMonday` is the Monday of today.
 */
export function seasonDescription(runs: readonly SeasonRun[], thisMonday: string): string {
  const first = runs[0]
  const last = runs[runs.length - 1]
  if (first === undefined || last === undefined) return ''
  const phases = runs.map((run, index) => {
    if (run.kind === 'race') {
      return render(
        SEASON_TEMPLATES['season.race-week'],
        { date: { kind: 'date', iso: run.firstWeek } },
        STORED_UNITS,
      )
    }
    if (run.kind === 'after') {
      return run.weeks === 1
        ? render(SEASON_TEMPLATES['season.after-one'], {}, STORED_UNITS)
        : render(
            SEASON_TEMPLATES['season.after'],
            { weeks: { kind: 'count', n: run.weeks } },
            STORED_UNITS,
          )
    }
    const phase = run.label.toLowerCase()
    if (runs[index + 1]?.kind === 'race') return phase
    return render(
      SEASON_TEMPLATES['season.run-to'],
      { phase, date: { kind: 'date', iso: addDays(run.lastWeek, 6) } },
      STORED_UNITS,
    )
  })
  const weeks = runs.reduce((sum, run) => sum + run.weeks, 0)
  const summary = render(
    SEASON_TEMPLATES['season.summary'],
    { weeks: { kind: 'count', n: weeks }, phases: phases.join(', ') },
    STORED_UNITS,
  )
  const now =
    thisMonday < first.firstWeek
      ? render(
          SEASON_TEMPLATES['season.now-before'],
          { date: { kind: 'date', iso: first.firstWeek } },
          STORED_UNITS,
        )
      : thisMonday > last.lastWeek
        ? render(
            SEASON_TEMPLATES['season.now-after'],
            { date: { kind: 'date', iso: last.lastWeek } },
            STORED_UNITS,
          )
        : render(
            SEASON_TEMPLATES['season.now-in'],
            { date: { kind: 'date', iso: thisMonday } },
            STORED_UNITS,
          )
  return `${summary} ${now}`
}

/** What a week's button says about the week. Minutes are the plan's and the runner's, whole. */
export interface SeasonWeekName {
  weekStart: string
  /** The week table's name for the week's phase. */
  label: string
  plannedMin: number
  /** Minutes run so far, or null for a week that has not been read (a future week, or no data). */
  ranMin: number | null
  current: boolean
}

/**
 * The name of one week's button: "This week, week of 9 Nov, base, 5.2 h planned, 2.5 h run". A week
 * planned at no running says so instead of "0.0 h planned".
 */
export function seasonWeekName(week: SeasonWeekName): string {
  const head = render(
    SEASON_TEMPLATES[week.current ? 'season.week-now' : 'season.week'],
    { date: { kind: 'date', iso: week.weekStart }, phase: week.label.toLowerCase() },
    STORED_UNITS,
  )
  const planned =
    Math.round(week.plannedMin) > 0
      ? render(
          SEASON_TEMPLATES['season.planned'],
          { planned: { kind: 'minutes', min: week.plannedMin } },
          STORED_UNITS,
        )
      : render(SEASON_TEMPLATES['season.planned-none'], {}, STORED_UNITS)
  return [head, planned, ...(week.ranMin === null ? [] : [weekRanText(week.ranMin)])].join(', ')
}

/** The heading of the strip's region. */
export const seasonTitle = (): string => render(SEASON_TEMPLATES['season.title'], {}, STORED_UNITS)

/** The name of the group of week buttons. */
export const seasonWeeksName = (): string =>
  render(SEASON_TEMPLATES['season.weeks'], {}, STORED_UNITS)

/** The line under the bars. */
export const seasonLegend = (): string =>
  render(SEASON_TEMPLATES['season.legend'], {}, STORED_UNITS)
