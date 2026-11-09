import { describe, expect, test } from 'vitest'
import {
  courseSilhouettePoints,
  MIN_SPAN_M,
  silhouettePaths,
} from '../../../shared/domain/courseSilhouette.ts'

const row = (distanceM: number, gainM: number | null, lossM: number | null) => ({
  name: 'Point',
  distanceM,
  gainM,
  lossM,
  cutoffSec: null,
})

const course = { distanceM: 50_000, gainM: 1000, lossM: 800 }

/** The y of every point the curve passes through (the last number of each segment). */
function curveYs(line: string): number[] {
  return line
    .split(/[MC]/)
    .filter((part) => part !== '')
    .map((part) => Number(part.trim().split(' ').at(-1)))
}

describe('courseSilhouettePoints', () => {
  test('accumulates the net of each leg and ends at the course net', () => {
    const points = courseSilhouettePoints([row(20_000, 500, 100), row(35_000, 100, 300)], course)
    expect(points).toEqual([
      { distanceM: 0, relM: 0 },
      { distanceM: 20_000, relM: 400 },
      { distanceM: 35_000, relM: 200 },
      { distanceM: 50_000, relM: 200 },
    ])
  })

  test('ends at the last point when the goal states no ascent and descent', () => {
    const points = courseSilhouettePoints([row(20_000, 500, 100)], {
      distanceM: 50_000,
      gainM: null,
      lossM: null,
    })
    expect(points?.at(-1)).toEqual({ distanceM: 50_000, relM: 400 })
  })

  test('treats a missing leg figure as no change and sorts by distance', () => {
    const points = courseSilhouettePoints([row(30_000, null, 100), row(10_000, 300, null)], course)
    expect(points?.map((p) => p.relM)).toEqual([0, 300, 200, 200])
  })

  test('is null without distance, without any climb or descent, or for a flat line', () => {
    expect(courseSilhouettePoints([row(10_000, 300, 0)], { ...course, distanceM: null })).toBeNull()
    expect(courseSilhouettePoints([], course)).toBeNull()
    expect(courseSilhouettePoints([row(10_000, null, null)], course)).toBeNull()
    expect(
      courseSilhouettePoints([row(10_000, 100, 100)], { distanceM: 50_000, gainM: 5, lossM: 5 }),
    ).toBeNull()
  })

  test('leaves out a point at or beyond the finish', () => {
    const points = courseSilhouettePoints([row(10_000, 100, 0), row(50_000, 900, 0)], course)
    expect(points).toHaveLength(3)
  })
})

describe('silhouettePaths', () => {
  const box = { width: 300, height: 50, pad: 5 }
  const points = [
    { distanceM: 0, relM: 0 },
    { distanceM: 10_000, relM: 400 },
    { distanceM: 20_000, relM: 100 },
  ]

  test('draws a curve across the whole width and closes the area on the floor', () => {
    const { line, area } = silhouettePaths(points, box)
    expect(line.startsWith('M0 45C')).toBe(true)
    expect(line.split(' ').at(-2)).toBe('300')
    expect(area).toBe(`${line}L300 50L0 50Z`)
  })

  test('puts the highest point at the top pad and the lowest at the bottom pad', () => {
    const ys = curveYs(silhouettePaths(points, box).line)
    expect(Math.min(...ys)).toBeCloseTo(5, 1)
    expect(Math.max(...ys)).toBeCloseTo(45, 1)
  })

  test('keeps a gentle course gentle: the span never drops under the floor', () => {
    const gentle = [
      { distanceM: 0, relM: 0 },
      { distanceM: 10_000, relM: 15 },
    ]
    const ys = curveYs(silhouettePaths(gentle, box).line)
    const drawn = Math.max(...ys) - Math.min(...ys)
    expect(drawn).toBeCloseTo((15 / MIN_SPAN_M) * (box.height - 2 * box.pad), 1)
  })

  test('does not overshoot between points (a monotone curve)', () => {
    const numbers = [...silhouettePaths(points, box).line.matchAll(/-?[\d.]+/g)].map((m) =>
      Number(m[0]),
    )
    const ys = numbers.filter((_n, i) => i % 2 === 1)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(5 - 0.01)
    expect(Math.max(...ys)).toBeLessThanOrEqual(45 + 0.01)
  })

  test('is empty for fewer than two points', () => {
    expect(silhouettePaths([{ distanceM: 0, relM: 0 }], box)).toEqual({ line: '', area: '' })
  })
})
