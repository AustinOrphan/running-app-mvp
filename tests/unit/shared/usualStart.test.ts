import { describe, expect, test } from 'vitest'
import { roundToCell, usualStart, type RunStart } from '../../../shared/domain/usualStart.ts'

// Synthetic cells: arbitrary points, no real place.
const run = (lat: number, lng: number, date: string): RunStart => ({ lat, lng, date })

describe('roundToCell', () => {
  test('rounds to 0.01 degrees and never returns -0', () => {
    expect(roundToCell(45.0049)).toBe(45)
    expect(roundToCell(45.005)).toBe(45.01)
    expect(roundToCell(-93.0049)).toBe(-93)
    expect(Object.is(roundToCell(-0.001), 0)).toBe(true)
  })
})

describe('usualStart', () => {
  test('is null without a run', () => {
    expect(usualStart([])).toBeNull()
  })

  test('is the one cell of a single run, with one run of one', () => {
    expect(usualStart([run(45.004, -93.004, '2026-10-01')])).toEqual({
      lat: 45,
      lng: -93,
      runs: 1,
      of: 1,
    })
  })

  test('takes the most common cell and counts every run', () => {
    const starts = [
      run(45.001, -93.001, '2026-10-01'),
      run(45.002, -92.998, '2026-10-02'),
      run(45.004, -93.004, '2026-10-03'),
      run(46.2, -92.0, '2026-10-04'),
    ]
    expect(usualStart(starts)).toEqual({ lat: 45, lng: -93, runs: 3, of: 4 })
  })

  test('breaks a tie by the cell with the most recent run', () => {
    const starts = [
      run(45.0, -93.0, '2026-10-01'),
      run(45.0, -93.0, '2026-10-02'),
      run(46.0, -92.0, '2026-09-01'),
      run(46.0, -92.0, '2026-10-09'),
    ]
    expect(usualStart(starts)).toEqual({ lat: 46, lng: -92, runs: 2, of: 4 })
    expect(usualStart([...starts].reverse())).toEqual({ lat: 46, lng: -92, runs: 2, of: 4 })
  })

  test('breaks a tie on the same latest day by position, whatever the input order', () => {
    const a = run(46.0, -92.0, '2026-10-09')
    const b = run(45.0, -93.0, '2026-10-09')
    expect(usualStart([a, b])).toEqual(usualStart([b, a]))
    expect(usualStart([a, b])).toEqual({ lat: 45, lng: -93, runs: 1, of: 2 })
  })

  test('puts an unwrapped longitude back into -180..180', () => {
    expect(usualStart([run(10, 180.004, '2026-10-01')])).toEqual({
      lat: 10,
      lng: -180,
      runs: 1,
      of: 1,
    })
  })
})
