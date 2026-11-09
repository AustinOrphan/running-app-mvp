import { act, fireEvent, render, screen } from '@testing-library/react'
import { cloneElement, Profiler, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ActivityStreamData } from '../../shared/types.ts'
import { StreamChart, yScale } from '../../web/components/charts/StreamChart.tsx'
import type { StreamData } from '../../web/components/charts/streamSeries.ts'
import { createDistanceCursor } from '../../web/components/map/distanceCursor.ts'

// jsdom has no size for a chart to measure, so the container is replaced by one that gives its
// chart a size and the plots draw their real SVG: the band, the ceiling and the hatch are asserted
// as elements, not only as captions.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    // counts how often a plot (a ComposedChart) renders
    ComposedChart: (props: object) => {
      ;(globalThis as { __plotRenders?: number }).__plotRenders =
        ((globalThis as { __plotRenders?: number }).__plotRenders ?? 0) + 1
      return createElement(actual.ComposedChart, props as never)
    },
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 96 } as never),
  }
})

/** Twelve 10-second buckets at 3 m/s: 30 m per bucket, 5:33 per km; heart rate 140 to 151 bpm. */
function makeStream(over: Partial<Record<keyof ActivityStreamData, unknown>> = {}): StreamData {
  const t = Array.from({ length: 12 }, (_, i) => i * 10)
  return {
    sampleSec: 10,
    t,
    d: t.map((_, i) => (i + 1) * 30),
    hr: t.map((_, i) => 140 + i),
    alt: t.map((_, i) => 100 + i),
    cad: null,
    pwr: null,
    ...over,
  } as StreamData
}

const hatched = (container: HTMLElement) => container.querySelectorAll('[fill^="url(#hatch"]')

describe('what the plots draw', () => {
  test('the planned pace band is a reference area on the pace plot, and only with a planned pace', () => {
    const none = render(<StreamChart stream={makeStream()} units="km" />)
    expect(none.container.querySelectorAll('.recharts-reference-area')).toHaveLength(0)
    none.unmount()
    const some = render(
      <StreamChart stream={makeStream()} units="km" plannedPaceSecPerKm={[345, 320]} />,
    )
    expect(some.container.querySelectorAll('.recharts-reference-area')).toHaveLength(1)
    expect(screen.getByText('Planned pace')).toBeInTheDocument()
  })

  test('the easy ceiling is a reference line on the heart-rate plot, and only with a ceiling', () => {
    const none = render(<StreamChart stream={makeStream()} units="km" />)
    expect(none.container.querySelectorAll('.recharts-reference-line')).toHaveLength(0)
    expect(hatched(none.container)).toHaveLength(0)
    none.unmount()
    const some = render(<StreamChart stream={makeStream()} units="km" easyCeilingBpm={145} />)
    expect(some.container.querySelectorAll('.recharts-reference-line')).toHaveLength(1)
    expect(screen.getByText('Easy ceiling 145 bpm')).toBeInTheDocument()
  })

  test('heart rate is hatched only where some value is above the ceiling', () => {
    const above = render(<StreamChart stream={makeStream()} units="km" easyCeilingBpm={145} />)
    expect(hatched(above.container).length).toBeGreaterThan(0)
    above.unmount()
    const never = render(<StreamChart stream={makeStream()} units="km" easyCeilingBpm={200} />)
    expect(never.container.querySelectorAll('.recharts-reference-line')).toHaveLength(1)
    expect(hatched(never.container)).toHaveLength(0)
  })

  test('the note and the closed how-to-read line say what is drawn, and nothing more', () => {
    const { rerender } = render(<StreamChart stream={makeStream()} units="km" />)
    expect(screen.getByText('Faster is higher.')).toBeInTheDocument()
    expect(screen.queryByText(/planned pace/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/easy ceiling/i)).not.toBeInTheDocument()
    expect(screen.getByText('How to read this').closest('details')).not.toHaveAttribute('open')
    rerender(
      <StreamChart
        stream={makeStream()}
        units="km"
        plannedPaceSecPerKm={[345, 320]}
        easyCeilingBpm={145}
      />,
    )
    expect(screen.getByText(/The dashed band is the planned pace\./)).toBeInTheDocument()
    expect(
      screen.getByText(/Heart rate above the easy ceiling of 145 bpm is hatched\./),
    ).toBeInTheDocument()
  })
})

describe('axes', () => {
  test('every pace tick lands on a round figure, whatever the span', () => {
    for (const values of [
      [330, 350],
      [330, 380],
      [331, 372],
      [500, 500],
    ]) {
      const { domain, ticks } = yScale(values, 'pace', [])
      expect((domain[1] - domain[0]) % 30).toBe(0)
      for (const tick of ticks) expect(tick % 15).toBe(0)
    }
  })

  test('a very short run labels its 0.25 tick as 0.25', () => {
    const t = Array.from({ length: 12 }, (_, i) => i * 10)
    const stream = makeStream({ d: t.map((_, i) => (i + 1) * 50) })
    render(<StreamChart stream={stream} channels={['hr']} units="km" />)
    const ticks = Array.from(document.querySelectorAll('tspan')).map((n) => n.textContent)
    expect(ticks).toContain('0.25')
    expect(ticks).not.toContain('0.3')
  })
})

describe('the cursor', () => {
  const panel = () => screen.getByRole('group', { name: /Pace, heart rate and elevation/ })
  const status = () => screen.getByRole('status', { name: 'Value at the cursor' })

  /** jsdom has no PointerEvent; a mouse event with a pointer type does for the handlers. */
  function pointer(
    element: Element,
    type: 'pointerdown' | 'pointermove' | 'pointerleave',
    clientX: number,
    pointerType = 'mouse',
  ) {
    if (type === 'pointerleave') {
      fireEvent.pointerLeave(element)
      return
    }
    const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 5 })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    fireEvent(element, event)
  }
  const move = (container: HTMLElement, x: number) => {
    pointer(plots(container), 'pointermove', x)
    act(() => {
      vi.advanceTimersByTime(300)
    })
  }
  const plots = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[class*="plots"]') as HTMLElement

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const wide = String(this.className).includes('plots')
      const width = wide ? 400 : 0
      return { x: 0, y: 0, left: 0, top: 0, width, height: 0, right: width, bottom: 0 } as DOMRect
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('a pointer position maps to the nearest row, left to right', () => {
    vi.useFakeTimers()
    const cursor = createDistanceCursor()
    const { container } = render(<StreamChart stream={makeStream()} units="km" cursor={cursor} />)
    move(container, -50)
    expect(status()).toHaveTextContent('Distance 0.03 km')
    move(container, 5000)
    expect(status()).toHaveTextContent('Distance 0.36 km')
    expect(cursor.get()).toBeCloseTo(360, 5)
    // the middle of the plot area reads the middle of the run
    move(container, 200 + 18)
    const metres = cursor.get() ?? 0
    expect(metres).toBeGreaterThan(150)
    expect(metres).toBeLessThan(240)
    pointer(plots(container), 'pointerleave', 0)
    expect(cursor.get()).toBeNull()
    expect(status()).toBeEmptyDOMElement()
  })

  test('the crosshair is one overlay that follows the cursor and hides with it', () => {
    const { container } = render(<StreamChart stream={makeStream()} units="km" />)
    const line = container.querySelector<HTMLElement>('[class*="cross"]:not([class*="crossWrap"])')!
    expect(line.hidden).toBe(true)
    fireEvent.keyDown(panel(), { key: 'End' })
    expect(line.hidden).toBe(false)
    expect(line.style.left).toBe('100%')
    fireEvent.keyDown(panel(), { key: 'Home' })
    expect(Number.parseFloat(line.style.left)).toBeCloseTo((0.03 / 0.36) * 100, 3)
    fireEvent.keyDown(panel(), { key: 'Escape' })
    expect(line.hidden).toBe(true)
  })

  test('the visible readout is written at once on every move; the announcement waits', () => {
    vi.useFakeTimers()
    const { container } = render(<StreamChart stream={makeStream()} units="km" />)
    const visible = () => container.querySelector('[class*="readout"]')?.textContent
    pointer(plots(container), 'pointermove', 5000)
    expect(status()).toHaveTextContent('Distance 0.36 km')
    pointer(plots(container), 'pointermove', -50)
    expect(visible()).toContain('0.03')
    // a second announcement inside 250 ms is held back, then made once
    expect(status()).toHaveTextContent('Distance 0.36 km')
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(status()).toHaveTextContent('Distance 0.36 km')
    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(status()).toHaveTextContent('Distance 0.03 km')
  })

  test('a long press on a touch screen pins the reading; a tap elsewhere or Escape releases it', () => {
    vi.useFakeTimers()
    const { container } = render(<StreamChart stream={makeStream()} units="km" />)
    const readout = container.querySelector<HTMLElement>('[class*="readout"]')!
    pointer(plots(container), 'pointerdown', 5000, 'touch')
    expect(readout.dataset.pinned).toBe('false')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(readout.dataset.pinned).toBe('true')
    expect(status()).toHaveTextContent('Pinned. Distance 0.36 km')
    // a pinned reading does not follow the finger
    pointer(plots(container), 'pointermove', -50, 'touch')
    expect(status()).toHaveTextContent('Distance 0.36 km')
    pointer(plots(container), 'pointerleave', 0, 'mouse')
    expect(readout.dataset.pinned).toBe('true')
    // a tap elsewhere releases it and reads there
    pointer(plots(container), 'pointerdown', -50, 'touch')
    expect(readout.dataset.pinned).toBe('false')
    expect(status()).toHaveTextContent('Distance 0.03 km')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(readout.dataset.pinned).toBe('true')
    fireEvent.keyDown(panel(), { key: 'Escape' })
    expect(readout.dataset.pinned).toBe('false')
    expect(status()).toBeEmptyDOMElement()
  })

  test('a finger that moves before half a second is scrubbing, not pressing', () => {
    vi.useFakeTimers()
    const { container } = render(<StreamChart stream={makeStream()} units="km" />)
    const readout = container.querySelector<HTMLElement>('[class*="readout"]')!
    pointer(plots(container), 'pointerdown', 100, 'touch')
    pointer(plots(container), 'pointermove', 160, 'touch')
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(readout.dataset.pinned).toBe('false')
  })

  test('keys with a modifier are left to the browser, and Escape is kept unless a cursor is set', () => {
    render(<StreamChart stream={makeStream()} units="km" />)
    expect(fireEvent.keyDown(panel(), { key: 'ArrowRight', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(panel(), { key: 'Home', metaKey: true })).toBe(true)
    expect(fireEvent.keyDown(panel(), { key: 'ArrowLeft', altKey: true })).toBe(true)
    expect(status()).toBeEmptyDOMElement()
    expect(fireEvent.keyDown(panel(), { key: 'Escape' })).toBe(true)
    expect(fireEvent.keyDown(panel(), { key: 'ArrowRight' })).toBe(false)
    expect(fireEvent.keyDown(panel(), { key: 'Escape' })).toBe(false)
  })

  test('a parent that renders again with a fresh band array re-renders no plot', () => {
    const renders = () => (globalThis as { __plotRenders?: number }).__plotRenders ?? 0
    const stream = makeStream()
    const view = (band: [number, number]) => (
      <StreamChart stream={stream} units="km" plannedPaceSecPerKm={band} easyCeilingBpm={145} />
    )
    const { rerender } = render(view([345, 320]))
    const before = renders()
    expect(before).toBeGreaterThan(0)
    rerender(view([345, 320])) // the same figures in a new array
    expect(renders()).toBe(before)
    rerender(view([350, 320])) // a different band does draw
    expect(renders()).toBeGreaterThan(before)
  })

  test('moving the cursor commits nothing: no plot and no parent renders again', () => {
    let commits = 0
    const { container } = render(
      <Profiler
        id="panel"
        onRender={() => {
          commits += 1
        }}
      >
        <StreamChart stream={makeStream()} units="km" easyCeilingBpm={145} />
      </Profiler>,
    )
    const before = commits
    expect(before).toBeGreaterThan(0)
    for (const x of [10, 100, 200, 300, 390]) pointer(plots(container), 'pointermove', x)
    fireEvent.keyDown(panel(), { key: 'ArrowRight' })
    fireEvent.keyDown(panel(), { key: 'End' })
    fireEvent.keyDown(panel(), { key: 'Escape' })
    expect(commits).toBe(before)
  })
})
