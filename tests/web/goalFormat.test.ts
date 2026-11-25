// How the goal and profile forms read a typed coordinate. Values are synthetic.
import { describe, expect, test } from 'vitest'
import {
  LATITUDE_REFUSAL,
  LONGITUDE_REFUSAL,
  describeTime,
  parseCoordinate,
  parseTime,
  twoPartReading,
} from '../../web/components/goalFormat.ts'

const HALF_M = 21_097
const TEN_K_M = 10_000
const FIVE_K_M = 5_000

describe('parseTime', () => {
  test.each([
    ['1:45:30', null, 6330],
    ['1:45:30', FIVE_K_M, 6330],
    ['1:45:30', HALF_M, 6330],
    ['0:24:30', FIVE_K_M, 1470],
    ['24:30', null, 1470],
  ])('reads the three-part or distanceless %j (distance %j) as %i s', (text, distanceM, sec) => {
    expect(parseTime(text, distanceM)).toBe(sec)
  })

  test.each([
    ['1:45', HALF_M, 6300],
    ['3:52', 42_195, 13_920],
    ['5:30', 50_000, 19_800],
    ['1:45', TEN_K_M, 6300],
    ['0:45', FIVE_K_M, 2700],
    ['24:30', FIVE_K_M, 1470],
    ['45:00', TEN_K_M, 2700],
    ['1:45', null, 105],
  ])('reads the two-part %j at %j m as %i s', (text, distanceM, sec) => {
    expect(parseTime(text, distanceM)).toBe(sec)
  })

  test.each([['abc'], [''], ['1:75'], ['1:2'], ['1:45:75'], ['0:00'], ['0:00:00']])(
    'refuses %j',
    (text) => {
      expect(parseTime(text, HALF_M)).toBeNull()
    },
  )

  test('a minutes entry past 59 needs its hours on a short distance', () => {
    expect(parseTime('75:00', FIVE_K_M)).toBeNull()
    expect(parseTime('75:00', null)).toBeNull()
  })
})

describe('describeTime and twoPartReading', () => {
  test.each([
    [6300, '1 h 45 min'],
    [105, '1 min 45 s'],
    [3600, '1 h'],
    [1470, '24 min 30 s'],
  ])('puts %i s in words as %j', (sec, words) => {
    expect(describeTime(sec)).toBe(words)
  })

  test('shows a reading for a two-part entry only', () => {
    expect(twoPartReading('1:45', HALF_M)).toBe('Read as 1 h 45 min.')
    expect(twoPartReading('1:45:30', HALF_M)).toBeNull()
    expect(twoPartReading('abc', HALF_M)).toBeNull()
    expect(twoPartReading('1:75', HALF_M)).toBeNull()
  })
})

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
