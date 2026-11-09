import { describe, expect, test } from 'vitest'
import {
  BARS_CAPTION,
  BARS_OVERSHOOT_CAPTION,
  barFigure,
  barPairName,
  easyCeilingLabel,
  easyCeilingNote,
  FASTER_IS_HIGHER,
  PLANNED_PACE_LABEL,
  PLANNED_PACE_NOTE,
  STREAM_HINT,
  STREAM_PANEL_NAME,
} from '../../../shared/copy/runCharts.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { planBarGeometry } from '../../../shared/domain/planBars.ts'

describe('planBarGeometry', () => {
  test('a run shorter than the plan: the outline is the track, the solid bar is part of it', () => {
    expect(planBarGeometry(200, 150)).toEqual({ planned: 1, ran: 0.75, overshoot: null })
  })

  test('a run past the plan: the solid bar stops at the outline and the rest is hatched', () => {
    expect(planBarGeometry(100, 125)).toEqual({
      planned: 0.8,
      ran: 0.8,
      overshoot: { from: 0.8, to: 1 },
    })
  })

  test('a run of exactly the planned figure has no hatching', () => {
    expect(planBarGeometry(60, 60)).toEqual({ planned: 1, ran: 1, overshoot: null })
  })

  test('nothing to set side by side when either figure is missing or not positive', () => {
    expect(planBarGeometry(0, 10)).toBeNull()
    expect(planBarGeometry(10, 0)).toBeNull()
    expect(planBarGeometry(10, Number.NaN)).toBeNull()
    expect(planBarGeometry(Number.POSITIVE_INFINITY, 10)).toBeNull()
  })

  test('every fraction stays within the track', () => {
    for (const [planned, ran] of [
      [1, 1000],
      [1000, 1],
      [3, 7],
    ] as const) {
      const g = planBarGeometry(planned, ran)
      expect(g).not.toBeNull()
      for (const f of [g?.planned, g?.ran, g?.overshoot?.from, g?.overshoot?.to]) {
        if (f !== undefined) {
          expect(f).toBeGreaterThan(0)
          expect(f).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('the words of the run charts', () => {
  test('figures read in the runner units', () => {
    expect(barFigure(12_000, 'km')).toBe('3 h 20 min')
    expect(barPairName(12_000, 12_600, 'km')).toBe('Time: planned 3 h 20 min, ran 3 h 30 min.')
  })

  test('every line is clean under G5 and none states a percentage or a verdict', () => {
    const lines = [
      STREAM_HINT,
      STREAM_PANEL_NAME,
      FASTER_IS_HIGHER,
      PLANNED_PACE_NOTE,
      PLANNED_PACE_LABEL,
      easyCeilingNote(142),
      easyCeilingLabel(142),
      BARS_CAPTION,
      BARS_OVERSHOOT_CAPTION,
      barPairName(10_000, 12_000, 'mi'),
    ]
    for (const line of lines) {
      assertCleanCopy(line, 'run charts')
      expect(line).not.toMatch(/%|\bmet\b|too high|too fast|over target/i)
    }
  })

  test('the ceiling lines state the figure rounded', () => {
    expect(easyCeilingNote(141.6)).toBe('Heart rate above the easy ceiling of 142 bpm is hatched.')
    expect(easyCeilingLabel(141.6)).toBe('Easy ceiling 142 bpm')
  })
})
