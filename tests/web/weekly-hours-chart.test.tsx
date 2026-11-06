import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import { WeeklyHoursChart } from '../../web/components/charts/WeeklyHoursChart.tsx'

// jsdom has no layout, so the chart's container measures 0 by 0 and draws nothing. The box is a
// phone's chart as the first frame draws it: 640 px wide and 80 px (5rem) high.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 640,
    height: 80,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 640,
    bottom: 80,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const START = '2027-01-04'
const weeks = (count: number, runMin = 0) =>
  Array.from({ length: count }, (_, i) => ({ weekStart: addDays(START, 7 * i), runMin }))
const planned = (count: number, targetRunMin = 300) =>
  Array.from({ length: count }, (_, i) => ({ weekStart: addDays(START, 7 * i), targetRunMin }))

/** The outlined bars (unfilled rectangles) and the solid ones, as the chart draws them. */
function bars(container: HTMLElement) {
  const rects = [...container.querySelectorAll<SVGRectElement>('svg rect[height]')]
  return {
    outlined: rects.filter((rect) => rect.getAttribute('fill') === 'none'),
    solid: rects.filter((rect) => rect.getAttribute('fill') === 'var(--chart-actual)'),
  }
}

describe('WeeklyHoursChart, the default chart', () => {
  test('keeps its axes, caption and table, and draws bars of 22 and 12 px', () => {
    const { container } = render(
      <WeeklyHoursChart
        weeks={weeks(3, 120)}
        planned={planned(3)}
        ariaLabel="Run hours per week"
      />,
    )
    expect(screen.getByRole('img', { name: 'Run hours per week' })).toBeInTheDocument()
    expect(screen.getByText('Solid is actual, outline is planned.')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(container.querySelector('.recharts-cartesian-axis')).not.toBeNull()
    expect(container.querySelector('.recharts-cartesian-grid')).not.toBeNull()
    const widths = [...container.querySelectorAll('.recharts-bar-rectangle path')].map((path) =>
      path.getAttribute('width'),
    )
    expect(new Set(widths)).toEqual(new Set(['22', '12']))
  })

  test('takes the bar widths as props', () => {
    const { container } = render(
      <WeeklyHoursChart
        weeks={weeks(3, 120)}
        planned={planned(3)}
        plannedBarSize={30}
        actualBarSize={10}
        ariaLabel="Run hours per week"
      />,
    )
    const widths = [...container.querySelectorAll('.recharts-bar-rectangle path')].map((path) =>
      path.getAttribute('width'),
    )
    expect(new Set(widths)).toEqual(new Set(['30', '10']))
  })
})

describe('WeeklyHoursChart, the Tab stop of the picture', () => {
  const draw = (compact: boolean) =>
    render(
      <WeeklyHoursChart
        compact={compact}
        weeks={weeks(5, 120)}
        planned={planned(5)}
        ariaLabel="Run hours per week"
      />,
    )

  test("the default chart keeps the chart library's own stop: its svg takes Tab", () => {
    const { container } = draw(false)
    expect(container.querySelector('svg')).toHaveAttribute('tabindex', '0')
    expect(container.querySelector('[role="application"]')).not.toBeNull()
  })

  test('the compact chart adds no Tab stop and no application role: it is a picture under buttons', () => {
    const { container } = draw(true)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('[tabindex="0"]')).toBeNull()
    expect(container.querySelector('[role="application"]')).toBeNull()
  })
})

describe('WeeklyHoursChart, compact', () => {
  test('is the bars alone: one image with the given name, no axes, grid, caption or table', () => {
    const { container } = render(
      <WeeklyHoursChart
        compact
        weeks={weeks(30, 120)}
        planned={planned(30)}
        ariaLabel="A 30-week plan"
      />,
    )
    const image = screen.getByRole('img', { name: 'A 30-week plan' })
    expect(image).toHaveAttribute('data-compact', 'true')
    expect(container.querySelector('figure')).toBeNull()
    expect(container.querySelector('figcaption')).toBeNull()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(container.querySelector('.recharts-cartesian-axis')).toBeNull()
    expect(container.querySelector('.recharts-cartesian-grid')).toBeNull()
    expect(container.querySelector('.recharts-tooltip-wrapper')).toBeNull()
  })

  test('draws one outlined bar per week and a solid one only where the week has run', () => {
    const run = weeks(30).map((week, i) => ({ ...week, runMin: i % 3 === 0 ? 150 : 0 }))
    const { container } = render(
      <WeeklyHoursChart compact weeks={run} planned={planned(30)} ariaLabel="A 30-week plan" />,
    )
    const { outlined, solid } = bars(container)
    expect(outlined).toHaveLength(30)
    expect(solid).toHaveLength(10)
  })

  test('defaults to bars of 8 and 4 px, and takes both widths as props', () => {
    const first = render(
      <WeeklyHoursChart
        compact
        weeks={weeks(30, 150)}
        planned={planned(30)}
        ariaLabel="A 30-week plan"
      />,
    )
    const defaults = bars(first.container)
    expect(new Set(defaults.outlined.map((rect) => rect.getAttribute('width')))).toEqual(
      new Set(['8']),
    )
    expect(new Set(defaults.solid.map((rect) => rect.getAttribute('width')))).toEqual(
      new Set(['4']),
    )
    first.unmount()

    const second = render(
      <WeeklyHoursChart
        compact
        weeks={weeks(30, 150)}
        planned={planned(30)}
        plannedBarSize={14}
        actualBarSize={6}
        ariaLabel="A 30-week plan"
      />,
    )
    const sized = bars(second.container)
    expect(new Set(sized.outlined.map((rect) => rect.getAttribute('width')))).toEqual(
      new Set(['14']),
    )
    expect(new Set(sized.solid.map((rect) => rect.getAttribute('width')))).toEqual(new Set(['6']))
  })

  test('gives every week one equal band across the width, so a page can lay columns over it', () => {
    const { container } = render(
      <WeeklyHoursChart
        compact
        weeks={weeks(20, 150)}
        planned={planned(20)}
        ariaLabel="A 20-week plan"
      />,
    )
    const { outlined } = bars(container)
    const centres = outlined.map(
      (rect) => Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2,
    )
    const steps = centres.slice(1).map((centre, i) => centre - centres[i]!)
    // 640 px at the first frame, no margin and no axis: 32 px a week, the first centred at 16
    expect(centres[0]).toBeCloseTo(16, 1)
    for (const step of steps) expect(step).toBeCloseTo(32, 1)
  })

  test('marks the current week in the accent, the race week with a flag, the weeks after muted', () => {
    const marks = {
      [addDays(START, 7)]: { current: true },
      [addDays(START, 14)]: { race: true },
      [addDays(START, 21)]: { muted: true },
    }
    const { container } = render(
      <WeeklyHoursChart
        compact
        weeks={weeks(5, 100)}
        planned={planned(5)}
        marks={marks}
        ariaLabel="A 5-week plan"
      />,
    )
    const { outlined, solid } = bars(container)
    const strokes = outlined.map((rect) => rect.getAttribute('stroke'))
    expect(strokes).toEqual([
      'var(--chart-planned)',
      'var(--accent)',
      'var(--chart-planned)',
      'var(--chart-planned)',
      'var(--chart-planned)',
    ])
    // the weeks after the race are dashed and faint, and so is their solid bar
    expect(outlined.map((rect) => rect.getAttribute('stroke-dasharray'))).toEqual([
      null,
      null,
      null,
      '2 2',
      null,
    ])
    expect(solid[3]).toHaveAttribute('opacity')
    expect(solid[2]).not.toHaveAttribute('opacity')
    expect(container.querySelectorAll('[data-mark="race"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-mark="current"]')).toHaveLength(1)
    // the flag stands on the race week's bar and the triangle sits under the current week's
    const flag = container.querySelector('[data-mark="race"]')!
    const race = outlined[2]!
    expect(flag.getAttribute('d')).toMatch(
      new RegExp(`^M${String(Number(race.getAttribute('x')) + 4)} `),
    )
    const triangle = container.querySelector('[data-mark="current"]')!
    const current = outlined[1]!
    const baseline = Number(current.getAttribute('y')) + Number(current.getAttribute('height'))
    expect(triangle.getAttribute('d')).toContain(
      `M${String(Number(current.getAttribute('x')) + 4)} ${String(baseline + 3)}`,
    )
  })

  test('shows a week that ran a few minutes as a sliver, not as nothing', () => {
    const run = [{ weekStart: START, runMin: 5 }, ...weeks(9, 0).slice(1)]
    const { container } = render(
      <WeeklyHoursChart
        compact
        weeks={run}
        planned={[{ weekStart: START, targetRunMin: 600 }]}
        ariaLabel="A plan"
      />,
    )
    const { solid } = bars(container)
    expect(solid).toHaveLength(1)
    expect(Number(solid[0]!.getAttribute('height'))).toBeGreaterThanOrEqual(2)
  })

  test('tells two weeks apart by their date, not by the label they would print', () => {
    // 53 weeks on, the same Monday has the same short label
    const long = [
      { weekStart: '2027-01-04', runMin: 60 },
      { weekStart: '2028-01-04', runMin: 60 },
      { weekStart: '2028-01-10', runMin: 60 },
    ]
    const { container } = render(
      <WeeklyHoursChart
        compact
        weeks={long}
        planned={long.map((w) => ({ weekStart: w.weekStart, targetRunMin: 120 }))}
        ariaLabel="A long plan"
      />,
    )
    expect(bars(container).outlined).toHaveLength(3)
  })
})
