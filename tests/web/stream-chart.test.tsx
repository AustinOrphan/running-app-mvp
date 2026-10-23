import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ActivityStreamData } from '../../shared/types.ts'
import { StreamChart, yAxisWidth } from '../../web/components/charts/StreamChart.tsx'
import {
  buildSeries,
  streamXAxis,
  type StreamData,
} from '../../web/components/charts/streamSeries.ts'

/** Twelve 10-second buckets at 3 m/s: 30 m per bucket, 5:33 per km. */
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

describe('streamXAxis', () => {
  test('uses distance when the stream has it', () => {
    expect(streamXAxis(makeStream())).toBe('distance')
  })

  test('falls back to time without a distance channel', () => {
    expect(streamXAxis(makeStream({ d: null }))).toBe('time')
  })

  test('falls back to time when every distance bucket is empty', () => {
    expect(streamXAxis(makeStream({ d: Array.from({ length: 12 }, () => null) }))).toBe('time')
  })
})

describe('yAxisWidth', () => {
  test('leaves room for a four-digit elevation label and never goes below three characters', () => {
    expect(yAxisWidth(['420', '800', '1180'])).toBeGreaterThanOrEqual(48)
    expect(yAxisWidth(['1180'])).toBeGreaterThan(yAxisWidth(['180']))
    expect(yAxisWidth(['5'])).toBe(yAxisWidth(['180']))
  })
})

describe('buildSeries', () => {
  test('pace in seconds per km, x in km', () => {
    const points = buildSeries(makeStream(), 'pace', 'km')
    expect(points).toHaveLength(12)
    expect(points[11]?.x).toBeCloseTo(0.36, 5)
    for (const point of points) expect(point.y).toBeCloseTo(333.33, 1)
  })

  test('pace in seconds per mile, x in miles', () => {
    const points = buildSeries(makeStream(), 'pace', 'mi')
    expect(points[11]?.x).toBeCloseTo(360 / 1609.344, 5)
    expect(points[5]?.y).toBeCloseTo(536.45, 1)
  })

  test('a standing-still stretch is a gap, not an enormous pace', () => {
    const d = [30, 60, 90, 120, 150, 180, 180, 180, 180, 180, 180, 180, 180, 180]
    const t = d.map((_, i) => i * 10)
    const points = buildSeries(makeStream({ t, d, hr: null, alt: null }), 'pace', 'km')
    expect(points[5]?.y).not.toBeNull()
    expect(points.slice(11).every((p) => p.y === null)).toBe(true)
  })

  test('null buckets are gaps and keep the line broken', () => {
    const hr = [140, 141, null, null, 144, 145, 146, 147, 148, 149, 150, 151]
    const points = buildSeries(makeStream({ hr }), 'hr', 'km')
    expect(points.map((p) => p.y).slice(0, 5)).toEqual([140, 141, null, null, 144])
  })

  test('drops points whose distance is missing', () => {
    const d = [30, null, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]
    const points = buildSeries(makeStream({ d }), 'hr', 'km')
    expect(points).toHaveLength(11)
  })

  test('x is minutes when there is no distance', () => {
    const points = buildSeries(makeStream({ d: null }), 'hr', 'km')
    expect(points[6]?.x).toBe(1)
  })

  test('elevation is feet for miles and metres for km', () => {
    const feet = buildSeries(makeStream(), 'alt', 'mi')
    expect(feet[0]?.y).toBeCloseTo(328.08, 1)
    expect(buildSeries(makeStream(), 'alt', 'km')[0]?.y).toBe(100)
  })

  test('a channel the stream lacks gives no points', () => {
    expect(buildSeries(makeStream({ hr: null }), 'hr', 'km')).toEqual([])
  })
})

describe('StreamChart', () => {
  test('describes the series for screen readers and lists a data table', () => {
    render(<StreamChart stream={makeStream()} channel="hr" units="km" />)
    const chart = screen.getByRole('img', { name: /Heart rate, average 146 bpm, highest 151 bpm/ })
    expect(chart).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /Heart rate/ })
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(2)
  })

  test('pace chart label gives average and fastest pace in the display unit', () => {
    render(<StreamChart stream={makeStream()} channel="pace" units="km" />)
    expect(
      screen.getByRole('img', { name: /Pace, average 5:33 \/km, fastest 5:33 \/km/ }),
    ).toBeInTheDocument()
  })

  test('renders nothing when the channel has no values', () => {
    const { container } = render(
      <StreamChart stream={makeStream({ hr: null })} channel="hr" units="km" />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
