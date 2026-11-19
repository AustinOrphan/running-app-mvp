// How the goal and profile forms read a typed coordinate. Values are synthetic.
import { describe, expect, test } from 'vitest'
import {
  LATITUDE_REFUSAL,
  LONGITUDE_REFUSAL,
  parseCoordinate,
} from '../../web/components/goalFormat.ts'

describe('parseCoordinate', () => {
  test.each([
    ['-87.63', 180, -87.63],
    ['−87.63', 180, -87.63],
    ['-87,63', 180, -87.63],
    ['+8.23', 180, 8.23],
    ['  41.8812 ', 90, 41.88],
    ['-180', 180, -180],
  ])('reads %j at a limit of %i as %f', (text, limit, expected) => {
    expect(parseCoordinate(text, limit)).toBe(expected)
  })

  test('gives 0, not -0, for a tiny negative', () => {
    expect(Object.is(parseCoordinate(' -0.004 ', 90), 0)).toBe(true)
  })

  test.each([
    ['-180.01', 180],
    ['-90.5', 90],
    ['95', 90],
    ['', 90],
    ['-', 90],
    ['--1', 90],
    ['1-', 90],
    ['−', 90],
    ['−−1', 90],
    ['abc', 90],
  ])('refuses %j at a limit of %i', (text, limit) => {
    expect(parseCoordinate(text, limit)).toBeNull()
  })

  test('the refusals show a negative example with the minus sign of the design rules', () => {
    expect(LATITUDE_REFUSAL).toContain('−33.87')
    expect(LONGITUDE_REFUSAL).toContain('−87.63')
  })
})
