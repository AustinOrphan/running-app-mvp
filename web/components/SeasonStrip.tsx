import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import {
  seasonAxisTop,
  seasonDescription,
  seasonLegend,
  seasonMonthLabel,
  seasonTableText,
  seasonTitle,
  seasonWeekName,
  seasonWeeksName,
} from '../../shared/copy/season.ts'
import { mondayOf, todayIso } from '../../shared/dates.ts'
import { shownTargetMin } from '../../shared/domain/plannedWeek.ts'
import { minutesToHours1 } from '../../shared/units.ts'
import type { PlanWithWeeks } from '../../shared/types.ts'
import { useWeeks } from '../api/weeks.ts'
import { WeeklyHoursChart, warmWeeklyHoursChart } from './charts/lazyCharts.tsx'
import { formatShortDate, weekPhaseLabel } from './format.ts'
import {
  actualRange,
  bracketSpans,
  hourAxis,
  monthMarks,
  SEASON_PLOT_MARGIN,
  seasonBarSizes,
  seasonFigures,
  seasonMarks,
  seasonRuns,
} from './season.ts'
import styles from './SeasonStrip.module.css'

/** The width the strip is laid out for until it has been measured: a phone 390 px wide. */
const FALLBACK_WIDTH = 358
/** What a letter of a bracket's name takes at the chart's text size, and what its ends take. */
const LABEL_CHAR_PX = 7
const LABEL_PAD_PX = 6

/** The width of an element in px, measured after layout and whenever it changes. */
function useWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(FALLBACK_WIDTH)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => {
      const measured = element.getBoundingClientRect().width
      if (measured > 0) setWidth(measured)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref])
  return width
}

/** The index a key moves the roving stop to, or null for a key that does not move it. */
function movedTo(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return Math.min(count - 1, index + 1)
    case 'ArrowLeft':
      return Math.max(0, index - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The season at a glance, above the week table: one bar per plan week, from the first week to the
 * race week and the weeks after it. The outline is the plan's figure for the week and the solid
 * bar the minutes run so far; the current week has its outline in the accent and a triangle under
 * it, the race week a flag, the weeks after the race are dashed and faint. Brackets under the bars
 * name the phases as the table does, where the name fits its width. A tap on a week hands its
 * Monday to `onSelectWeek`, which the page answers by scrolling to the week's row.
 *
 * The bars say nothing to a screen reader. It reads the description of the plan and finds each
 * week as a button named with its phase and figures; the buttons are one stop of the Tab order,
 * moved with the arrow keys.
 */
export function SeasonStrip({
  plan,
  onSelectWeek,
}: {
  plan: PlanWithWeeks
  onSelectWeek: (weekStart: string) => void
}) {
  useEffect(() => {
    warmWeeklyHoursChart()
  }, [])
  const currentMonday = mondayOf(todayIso())
  const weeks = useWeeks(actualRange(plan, currentMonday))
  // the bars' own box: the plot less the axis gutter, so the weeks' columns are measured exactly
  const plotRef = useRef<HTMLDivElement>(null)
  const width = useWidth(plotRef)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const [stopped, setStopped] = useState<number | null>(null)

  const count = plan.weeks.length
  if (count === 0) return null
  const actual = new Map((weeks.data ?? []).map((w) => [w.weekStart, w.runMin]))
  const runs = seasonRuns(plan.weeks)
  const figures = seasonFigures(plan.weeks, actual)
  const marks = seasonMarks(plan.weeks, currentMonday)
  const description = seasonDescription(runs, currentMonday)

  const band = width / count
  const barSizes = seasonBarSizes(band)
  const axis = hourAxis(
    Math.max(
      0,
      ...figures.weeks.map((week) => week.runMin / 60),
      ...figures.planned.map((week) => week.targetRunMin / 60),
    ),
  )
  const months = monthMarks(
    plan.weeks.map((week) => week.weekStart),
    width,
  )
  const table = seasonTableText()

  // The one Tab stop is the week that was last on, else this week, else the first. A plan that
  // is replaced by a shorter one leaves the last week it has.
  const currentIndex = plan.weeks.findIndex((week) => week.weekStart === currentMonday)
  const stop = Math.min(count - 1, stopped ?? Math.max(0, currentIndex))

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // A key with a modifier is the browser's or the system's (history, zoom, a shortcut).
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = movedTo(event.key, index, count)
    if (next === null) return
    event.preventDefault()
    setStopped(next)
    buttons.current[next]?.focus()
  }

  // Each run starts in the column after the weeks of the runs before it.
  const spans = bracketSpans(runs)
  return (
    <section
      aria-labelledby="season-title"
      aria-describedby="season-description"
      className={styles.strip}
    >
      <h2 id="season-title" className="visually-hidden">
        {seasonTitle()}
      </h2>
      <p id="season-description" className="visually-hidden">
        {description}
      </p>
      <div
        className={styles.plot}
        style={
          {
            '--weeks': count,
            '--plot-top': `${String(SEASON_PLOT_MARGIN.top)}px`,
            '--plot-bottom': `${String(SEASON_PLOT_MARGIN.bottom)}px`,
          } as CSSProperties
        }
      >
        {/* The y axis: round ticks in hours, the unit once on the top tick. */}
        <div className={styles.axis} aria-hidden="true">
          {axis.ticks.map((tick) => (
            <span
              key={tick}
              className={styles.tick}
              style={{ '--at': tick / axis.max } as CSSProperties}
            >
              {tick === axis.max ? seasonAxisTop(String(tick)) : String(tick)}
            </span>
          ))}
        </div>
        {/* The bars say nothing to a screen reader; the description above and the buttons do. */}
        <div ref={plotRef} className={styles.bars} aria-hidden="true">
          {axis.ticks.map((tick) => (
            <span
              key={tick}
              className={styles.gridline}
              style={{ '--at': tick / axis.max } as CSSProperties}
            />
          ))}
          <WeeklyHoursChart
            compact
            weeks={figures.weeks}
            planned={figures.planned}
            marks={marks}
            yMax={axis.max}
            margin={{ ...SEASON_PLOT_MARGIN }}
            plannedBarSize={barSizes.planned}
            actualBarSize={barSizes.actual}
            ariaLabel={description}
          />
        </div>
        <div role="group" aria-label={seasonWeeksName()} className={styles.weeks}>
          {plan.weeks.map((week, index) => (
            <button
              key={week.weekStart}
              ref={(element) => {
                buttons.current[index] = element
              }}
              type="button"
              className={styles.week}
              style={{ gridColumn: index + 1 }}
              aria-label={seasonWeekName({
                weekStart: week.weekStart,
                label: weekPhaseLabel(week),
                plannedMin: shownTargetMin(week),
                ranMin:
                  week.weekStart <= currentMonday ? (actual.get(week.weekStart) ?? null) : null,
                current: week.weekStart === currentMonday,
              })}
              aria-current={week.weekStart === currentMonday ? 'date' : undefined}
              tabIndex={index === stop ? 0 : -1}
              onFocus={() => {
                setStopped(index)
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index)
              }}
              onClick={() => {
                onSelectWeek(week.weekStart)
              }}
            />
          ))}
        </div>
        <div className={styles.months} aria-hidden="true">
          {months.map((mark) => (
            <span
              key={mark.index}
              className={styles.month}
              style={{ left: `${String((mark.index / count) * 100)}%` }}
            >
              {seasonMonthLabel(mark.month)}
            </span>
          ))}
        </div>
        <div className={styles.brackets} aria-hidden="true">
          {runs.map((run, position) => {
            const start = spans[position]?.start ?? 1
            const fits = run.weeks * band >= run.label.length * LABEL_CHAR_PX + LABEL_PAD_PX
            return (
              <div
                key={run.firstWeek}
                className={styles.bracket}
                data-run={run.label}
                style={{ gridColumn: `${String(start)} / span ${String(run.weeks)}` }}
              >
                {fits ? <span className={styles.bracketLabel}>{run.label}</span> : null}
              </div>
            )
          })}
        </div>
      </div>
      <p className={styles.legend}>{seasonLegend()}</p>
      {/* a table sizes to its content whatever its box, so the box that hides it is a wrapper */}
      <div className="visually-hidden">
        <table>
          <caption>{table.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{table.week}</th>
              <th scope="col">{table.phase}</th>
              <th scope="col">{table.planned}</th>
              <th scope="col">{table.run}</th>
            </tr>
          </thead>
          <tbody>
            {plan.weeks.map((week) => (
              <tr key={week.weekStart}>
                <th scope="row">{formatShortDate(week.weekStart)}</th>
                <td>{weekPhaseLabel(week)}</td>
                <td>{minutesToHours1(shownTargetMin(week))}</td>
                <td>
                  {week.weekStart <= currentMonday
                    ? minutesToHours1(actual.get(week.weekStart) ?? 0)
                    : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
