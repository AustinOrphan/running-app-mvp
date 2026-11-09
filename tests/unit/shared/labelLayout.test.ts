import { describe, expect, test } from 'vitest'
import { placeLabels, textWidth } from '../../../shared/domain/labelLayout.ts'

const options = { rows: 2, gap: 4 }

/** Whether any two placed labels share a row and overlap. */
function collide(
  placed: ReturnType<typeof placeLabels>,
  labels: ReadonlyArray<{ width: number }>,
): boolean {
  return placed.some((a) =>
    placed.some(
      (b) =>
        a !== b &&
        a.row === b.row &&
        a.left < b.left + labels[b.index]!.width &&
        b.left < a.left + labels[a.index]!.width,
    ),
  )
}

describe('placeLabels', () => {
  test('keeps every label that fits on the first row, centred on its point', () => {
    const labels = [
      { x: 50, width: 40 },
      { x: 150, width: 40 },
    ]
    expect(placeLabels(labels, 300, options)).toEqual([
      { index: 0, row: 0, left: 30 },
      { index: 1, row: 0, left: 130 },
    ])
  })

  test('staggers a label that would cover the one before it onto the second row', () => {
    const labels = [
      { x: 100, width: 60 },
      { x: 120, width: 60 },
    ]
    const placed = placeLabels(labels, 300, options)
    expect(placed.map((p) => p.row)).toEqual([0, 1])
  })

  test('drops a label that fits on no row rather than draw it over another', () => {
    const labels = [
      { x: 100, width: 60 },
      { x: 110, width: 60 },
      { x: 120, width: 60 },
    ]
    const placed = placeLabels(labels, 300, options)
    expect(placed.map((p) => p.index)).toEqual([0, 1])
    expect(collide(placed, labels)).toBe(false)
  })

  test('keeps a label at either end inside the plot', () => {
    const labels = [
      { x: 2, width: 50 },
      { x: 298, width: 50 },
    ]
    const placed = placeLabels(labels, 300, options)
    expect(placed.map((p) => p.left)).toEqual([0, 250])
  })

  test('never overlaps at 360 px with five names, whatever their spacing', () => {
    const plot = 360 - 40 - 12
    for (let seed = 1; seed <= 200; seed += 1) {
      let state = seed
      const next = () => {
        state = (state * 1103515245 + 12345) % 2147483648
        return state / 2147483648
      }
      const labels = Array.from({ length: 6 }, () => next() * plot)
        .sort((a, b) => a - b)
        .map((x) => ({ x, width: textWidth('Aid station', 13) }))
      expect(collide(placeLabels(labels, plot, options), labels)).toBe(false)
    }
  })

  test('shows nothing for a label wider than the plot', () => {
    expect(placeLabels([{ x: 10, width: 400 }], 300, options)).toEqual([])
  })
})
