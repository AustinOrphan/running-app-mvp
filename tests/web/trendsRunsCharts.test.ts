import { describe, expect, test } from 'vitest'
import {
  dayNumber,
  dayTickLabel,
  isoOfDay,
  monthStartDays,
  rangeTicks,
} from '../../web/components/charts/dayTicks.ts'
import { dotRadius, driftScale } from '../../web/components/charts/DurabilityChart.tsx'
import { bpmScale } from '../../web/components/charts/EfficiencyChart.tsx'

describe('the day axis of the run panels', () => {
  test('numbers days from 1970 and turns them back', () => {
    expect(dayNumber('1970-01-02')).toBe(1)
    expect(isoOfDay(dayNumber('2026-03-18'))).toBe('2026-03-18')
    expect(dayNumber('2026-03-19') - dayNumber('2026-03-18')).toBe(1)
  })

  test('ticks the first of the months inside the range, every step months from January', () => {
    const march = dayNumber('2026-03-01')
    expect(monthStartDays('2026-03-18', '2026-07-01', 1).map(isoOfDay)).toEqual([
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
    ])
    expect(monthStartDays('2026-03-01', '2026-07-01', 3).map(isoOfDay)).toEqual([
      '2026-04-01',
      '2026-07-01',
    ])
    expect(monthStartDays('2026-03-01', '2026-03-20', 1)).toEqual([march])
    expect(monthStartDays('2025-11-20', '2026-02-10', 1).map(isoOfDay)).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ])
  })

  test('names a month by its short name and a January with its year', () => {
    expect(dayTickLabel(dayNumber('2026-03-01'))).toBe('Mar')
    expect(dayTickLabel(dayNumber('2026-01-01'))).toBe('Jan 26')
  })

  test('thins the ticks with the length of the range so the labels do not touch', () => {
    expect(rangeTicks('2025-09-19', '2026-03-18')).toHaveLength(6)
    expect(rangeTicks('2024-03-19', '2026-03-18').length).toBeLessThanOrEqual(8)
  })
})

describe('the scales of the run panels', () => {
  test('the drift axis always holds zero and whole percents, and sets no aim', () => {
    expect(driftScale([2, 4.5, 6.2])).toEqual({ domain: [0, 8], ticks: [0, 2, 4, 6, 8] })
    expect(driftScale([-3.2, 1])).toEqual({ domain: [-5, 2], ticks: [-4, -2, 0, 2] })
    expect(driftScale([14, 22]).domain[0]).toBe(0)
  })

  test('a dot grows in area with the length of the run, between two sizes', () => {
    expect(dotRadius(10)).toBeCloseTo(3.5, 6)
    expect(dotRadius(300)).toBeCloseTo(8, 6)
    expect(dotRadius(120)).toBeGreaterThan(dotRadius(60))
    // Area, not radius, is proportional to length above the floor: the half-way run is not half-way in radius.
    expect(dotRadius(110)).toBeGreaterThan((3.5 + 8) / 2)
  })

  test('the heart-rate axis spans at least a tenth of the median, so a small change reads as a line', () => {
    const { domain, ticks } = bpmScale([148, 149, 150])
    expect(domain[1] - domain[0]).toBeGreaterThanOrEqual(14)
    expect(ticks).toHaveLength(3)
    expect(ticks[0]).toBe(domain[0])
    expect(ticks[2]).toBe(domain[1])
    const wide = bpmScale([140, 170])
    expect(wide.domain[0]).toBeLessThanOrEqual(140)
    expect(wide.domain[1]).toBeGreaterThanOrEqual(170)
  })
})
