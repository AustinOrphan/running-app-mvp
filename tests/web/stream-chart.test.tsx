import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ActivityStreamData } from '../../shared/types.ts'
import { StreamChart, yAxisWidth } from '../../web/components/charts/StreamChart.tsx'
import { createDistanceCursor } from '../../web/components/map/distanceCursor.ts'
import {
  alignSeries,
  buildSeries,
  nearestRowIndex,
  plannedPaceBand,
  distanceLabelToMetres,
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

describe('distanceLabelToMetres', () => {
  test('turns the chart distance into metres in the unit the chart is drawn in', () => {
    expect(distanceLabelToMetres(0.25, 'mi')).toBeCloseTo(402.336, 3)
    expect(distanceLabelToMetres(1, 'mi')).toBeCloseTo(1609.344, 3)
    expect(distanceLabelToMetres(0.25, 'km')).toBe(250)
    expect(distanceLabelToMetres(0, 'km')).toBe(0)
    // recharts may hand the label over as text
    expect(distanceLabelToMetres('0.5', 'km')).toBe(500)
  })

  test('is null for anything that is not a finite number', () => {
    for (const label of [undefined, null, '', 'far', Number.NaN, Infinity]) {
      expect(distanceLabelToMetres(label, 'km')).toBeNull()
    }
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

describe('StreamChart as one panel', () => {
  const panel = () => screen.getByRole('group', { name: /Pace, heart rate and elevation/ })
  const readout = () => screen.getByRole('status', { name: 'Value at the cursor' })

  test('stacks the three plots with one fixed readout row and one table each', () => {
    render(<StreamChart stream={makeStream()} units="km" />)
    expect(screen.getByRole('img', { name: /^Pace, average/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Heart rate, average/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Elevation, from/ })).toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(3)
    expect(readout()).toBeInTheDocument()
    expect(screen.queryByText(/Faster is higher/)).toBeInTheDocument()
  })

  test('the arrow keys move the cursor and the readout names the values there', () => {
    render(<StreamChart stream={makeStream()} units="km" />)
    const group = panel()
    expect(group).toHaveAttribute('tabindex', '0')
    act(() => group.focus())
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(readout()).toHaveTextContent('Distance 0.03 km')
    expect(readout()).toHaveTextContent('Heart rate 140 bpm')
    expect(readout()).toHaveTextContent('Elevation 100 m')
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(readout()).toHaveTextContent('Distance 0.06 km')
    expect(readout()).toHaveTextContent('Heart rate 141 bpm')
    fireEvent.keyDown(group, { key: 'End' })
    expect(readout()).toHaveTextContent('Distance 0.36 km')
    expect(readout()).toHaveTextContent('Pace 5:33 /km')
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(readout()).toHaveTextContent('Distance 0.33 km')
    fireEvent.keyDown(group, { key: 'Escape' })
    expect(readout()).not.toHaveTextContent('Distance')
  })

  test('a channel with no value at the cursor reads as a dash', () => {
    render(<StreamChart stream={makeStream()} units="km" />)
    fireEvent.keyDown(panel(), { key: 'Home' })
    expect(readout()).toHaveTextContent('Pace —')
  })

  test('the cursor reports metres to the map without the panel knowing the map', () => {
    const cursor = createDistanceCursor()
    render(<StreamChart stream={makeStream()} units="km" cursor={cursor} />)
    fireEvent.keyDown(panel(), { key: 'End' })
    expect(cursor.get()).toBeCloseTo(360, 5)
    fireEvent.keyDown(panel(), { key: 'Escape' })
    expect(cursor.get()).toBeNull()
  })

  test('against time there is no distance to report', () => {
    const cursor = createDistanceCursor()
    render(<StreamChart stream={makeStream({ d: null })} units="km" cursor={cursor} />)
    fireEvent.keyDown(panel(), { key: 'End' })
    expect(readout()).toHaveTextContent('Time')
    expect(cursor.get()).toBeNull()
  })

  test('the planned band and the easy ceiling appear only with their inputs', () => {
    const { rerender } = render(<StreamChart stream={makeStream()} units="km" />)
    expect(screen.queryByText(/dashed band/)).not.toBeInTheDocument()
    expect(screen.queryByText(/is hatched/)).not.toBeInTheDocument()
    rerender(
      <StreamChart
        stream={makeStream()}
        units="km"
        plannedPaceSecPerKm={[345, 320]}
        easyCeilingBpm={145}
      />,
    )
    expect(
      screen.getByText(/Heart rate above the easy ceiling of 145 bpm is hatched\./),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/The dashed band is the pace the session planned\./),
    ).toBeInTheDocument()
  })
})
