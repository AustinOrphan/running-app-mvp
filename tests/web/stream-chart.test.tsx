import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ActivityStreamData } from '../../shared/types.ts'
import { StreamChart, yAxisWidth } from '../../web/components/charts/StreamChart.tsx'
import { createDistanceCursor } from '../../web/components/map/distanceCursor.ts'
import {
  alignSeries,
  buildSeries,
  nearestRowIndex,
  overCeiling,
  xTicks,
  plannedPaceBand,
  drawablePoints,
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
    for (const point of points.slice(5)) expect(point.y).toBeCloseTo(333.33, 1)
  })

  test('the first minute has no pace: less than a window of running is a start from standing', () => {
    const points = buildSeries(makeStream(), 'pace', 'km')
    expect(points.slice(0, 5).every((p) => p.y === null)).toBe(true)
    expect(points[5]?.y).not.toBeNull()
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

describe('drawablePoints', () => {
  test('a channel sampled every sixth bucket stays one line', () => {
    const hr = Array.from({ length: 60 }, (_, i) => (i % 6 === 0 ? 140 + i : null))
    const t = hr.map((_, i) => i * 10)
    const points = buildSeries(makeStream({ t, d: t.map((_, i) => (i + 1) * 30), hr }), 'hr', 'km')
    const drawn = drawablePoints(points, 10)
    expect(drawn).toHaveLength(10)
    expect(drawn.every((p) => p.y !== null)).toBe(true)
  })

  test('a pause of more than five minutes breaks the line once', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({
      x: i,
      y: i < 10 || i >= 60 ? 150 : null,
    }))
    const drawn = drawablePoints(points, 10)
    expect(drawn.filter((p) => p.y === null)).toHaveLength(1)
    expect(drawn).toHaveLength(10 + 1 + 40)
  })
})

describe('StreamChart', () => {
  test('describes the series for screen readers and lists a data table', () => {
    render(<StreamChart stream={makeStream()} channels={['hr']} units="km" />)
    const chart = screen.getByRole('img', { name: /Heart rate, average 146 bpm, highest 151 bpm/ })
    expect(chart).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /Heart rate/ })
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(2)
  })

  test('pace chart label gives average and fastest pace in the display unit', () => {
    render(<StreamChart stream={makeStream()} channels={['pace']} units="km" />)
    expect(
      screen.getByRole('img', { name: /Pace, average 5:33 \/km, fastest 5:33 \/km/ }),
    ).toBeInTheDocument()
  })

  test('renders nothing when the channel has no values', () => {
    const { container } = render(
      <StreamChart stream={makeStream({ hr: null })} channels={['hr']} units="km" />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('alignSeries', () => {
  test('puts the three channels on one row per bucket', () => {
    const rows = alignSeries(makeStream(), 'km')
    expect(rows).toHaveLength(12)
    expect(rows[11]).toMatchObject({ hr: 151, alt: 111 })
    expect(rows[11]?.x).toBeCloseTo(0.36, 5)
    expect(rows[0]?.pace).toBeNull()
    expect(rows[8]?.pace).toBeCloseTo(333.33, 1)
  })

  test('a channel the stream lacks is null in every row', () => {
    const rows = alignSeries(makeStream({ hr: null }), 'km')
    expect(rows.every((row) => row.hr === null)).toBe(true)
    expect(rows.every((row) => row.alt !== null)).toBe(true)
  })

  test('no channel at all gives no rows', () => {
    expect(alignSeries(makeStream({ d: null, hr: null, alt: null }), 'km')).toEqual([])
  })
})

describe('nearestRowIndex', () => {
  const rows = [0, 1, 2, 4].map((x) => ({ x, pace: null, hr: null, alt: null }))
  test('finds the row nearest the x, ties going to the earlier one', () => {
    expect(nearestRowIndex(rows, -3)).toBe(0)
    expect(nearestRowIndex(rows, 1.4)).toBe(1)
    expect(nearestRowIndex(rows, 3)).toBe(2)
    expect(nearestRowIndex(rows, 3.1)).toBe(3)
    expect(nearestRowIndex(rows, 99)).toBe(3)
  })
  test('is -1 for no rows or a value that is no number', () => {
    expect(nearestRowIndex([], 1)).toBe(-1)
    expect(nearestRowIndex(rows, Number.NaN)).toBe(-1)
  })
})

describe('plannedPaceBand', () => {
  test('converts the stored slow-first seconds per km into the chart unit, fast end first', () => {
    expect(plannedPaceBand([330, 310], 'km')).toEqual({ fast: 310, slow: 330 })
    const mi = plannedPaceBand([330, 310], 'mi')
    expect(mi?.fast).toBeCloseTo(498.9, 1)
    expect(mi?.slow).toBeCloseTo(531.1, 1)
  })
  test('is null without a pace target or with a bad one', () => {
    expect(plannedPaceBand(null, 'km')).toBeNull()
    expect(plannedPaceBand(undefined, 'km')).toBeNull()
    expect(plannedPaceBand([0, 300], 'km')).toBeNull()
  })
})

describe('xTicks', () => {
  test('round steps, at most five labels, the end of the run last', () => {
    expect(xTicks(2.88, 'distance')).toEqual([0, 1, 2, 2.88])
    expect(xTicks(3.4, 'distance')).toEqual([0, 1, 2, 3.4])
    expect(xTicks(13.1, 'distance')).toEqual([0, 5, 10, 13.1])
    expect(xTicks(0.36, 'distance')).toEqual([0, 0.1, 0.2, 0.3, 0.36])
    expect(xTicks(26, 'time')).toEqual([0, 10, 20, 26])
    for (const max of [0.2, 1, 7.7, 26.2, 62, 100.4]) {
      const ticks = xTicks(max, 'distance')
      expect(ticks.length).toBeLessThanOrEqual(5)
      expect(ticks.at(-1)).toBe(max)
      expect(ticks[0]).toBe(0)
    }
  })

  test('no run length gives the origin alone', () => {
    expect(xTicks(0, 'distance')).toEqual([0])
    expect(xTicks(Number.NaN, 'time')).toEqual([0])
  })
})

describe('overCeiling', () => {
  const pt = (x: number, y: number | null) => ({ x, y })

  test('the hatch starts and ends on the crossing, not on the first sample above', () => {
    const out = overCeiling([pt(0, 140), pt(1, 150), pt(2, 140)], 145)
    expect(out.map((p) => [p.x, p.y])).toEqual([
      [0, 140],
      [0.5, 145],
      [1, 150],
      [1.5, 145],
      [2, 140],
    ])
    expect(out.map((p) => p.over)).toEqual([null, [145, 145], [145, 150], [145, 145], null])
  })

  test('one sample above the ceiling still draws a stretch', () => {
    const out = overCeiling([pt(0, 100), pt(1, 160), pt(2, 100)], 145)
    expect(out.filter((p) => p.over !== null && p.over[1] > p.over[0])).toHaveLength(1)
    expect(out).toHaveLength(5)
  })

  test('a gap is not bridged, and no ceiling marks nothing', () => {
    const out = overCeiling([pt(0, 140), pt(1, null), pt(2, 150)], 145)
    expect(out).toHaveLength(3)
    expect(out.map((p) => p.over)).toEqual([null, null, [145, 150]])
    expect(overCeiling([pt(0, 140), pt(1, 150)], null).every((p) => p.over === null)).toBe(true)
  })
})
