import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { todayIso } from '../../../shared/dates.ts'
import { DAY_HOLDS_MS, msUntilMidnight, waitForNextDay } from '../../e2e/globalSetup.ts'

const HOUR_MS = 3_600_000

describe('msUntilMidnight', () => {
  test('counts to the next local midnight', () => {
    expect(msUntilMidnight(new Date(2026, 6, 15, 23, 59, 0))).toBe(60_000)
    expect(msUntilMidnight(new Date(2026, 6, 15, 12, 0, 0))).toBe(12 * HOUR_MS)
    expect(msUntilMidnight(new Date(2026, 6, 15, 0, 0, 0))).toBe(24 * HOUR_MS)
  })

  test('crosses the end of a month and of a year', () => {
    expect(msUntilMidnight(new Date(2026, 9, 31, 23, 0, 0))).toBe(HOUR_MS)
    expect(msUntilMidnight(new Date(2026, 11, 31, 23, 30, 0))).toBe(HOUR_MS / 2)
  })
})

describe('waitForNextDay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('returns at once while more than the run needs is left of the day', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0))
    await waitForNextDay()
    expect(todayIso()).toBe('2026-07-15')
  })

  test('returns at once with exactly the run needs left', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 24, 0, 0).getTime() - DAY_HOLDS_MS)
    await waitForNextDay()
    expect(todayIso()).toBe('2026-07-15')
  })

  test('waits for the date to change when less than the run needs is left', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 23, 58, 30))
    let finished = false
    const waiting = waitForNextDay().then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(89_000)
    expect(finished).toBe(false)
    expect(todayIso()).toBe('2026-07-15')
    await vi.advanceTimersByTimeAsync(1_500)
    await waiting
    expect(finished).toBe(true)
    expect(todayIso()).toBe('2026-07-16')
  })
})
