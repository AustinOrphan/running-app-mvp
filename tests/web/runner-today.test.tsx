import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isoDateInZone, todayIso } from '../../shared/dates.ts'
import { useRunnerDayOf, useRunnerToday } from '../../web/api/today.ts'
import { makeTestQueryClient, seedRunnerZone } from './helpers.tsx'

/** The runner's day on every page (D10, ADR 0022): the session user's zone, never the device's. */
describe('useRunnerToday', () => {
  const originalZone = process.env['TZ']

  beforeEach(() => {
    // The device is in Kiritimati (+14), 25 hours ahead of Pago Pago (-11): the two days differ at
    // every instant.
    process.env['TZ'] = 'Pacific/Kiritimati'
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalZone === undefined) delete process.env['TZ']
    else process.env['TZ'] = originalZone
  })

  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
  }

  test("shows the session user's day, not the device's", () => {
    const queryClient = makeTestQueryClient()
    seedRunnerZone(queryClient, 'Pacific/Pago_Pago')
    const { result } = renderHook(() => useRunnerToday(), { wrapper: wrapperFor(queryClient) })
    expect(result.current).toBe(isoDateInZone(new Date(), 'Pacific/Pago_Pago'))
    expect(result.current).not.toBe(todayIso())
  })

  test('reads the day of an instant in the runner zone', () => {
    const queryClient = makeTestQueryClient()
    seedRunnerZone(queryClient, 'Pacific/Pago_Pago')
    const { result } = renderHook(() => useRunnerDayOf(), { wrapper: wrapperFor(queryClient) })
    // 05:00 UTC on the 22nd is the evening of the 21st at -11, and the 22nd at +14 (19:00).
    const at = new Date('2026-10-22T05:00:00.000Z')
    expect(result.current(at)).toBe('2026-10-21')
    expect(todayIso(at)).toBe('2026-10-22')
  })

  test("falls back to the cached Today payload's zone, then to the device's day", () => {
    const withToday = makeTestQueryClient()
    withToday.setQueryData(['today'], { tz: 'Pacific/Pago_Pago' })
    const first = renderHook(() => useRunnerToday(), { wrapper: wrapperFor(withToday) })
    expect(first.result.current).toBe(isoDateInZone(new Date(), 'Pacific/Pago_Pago'))

    const empty = renderHook(() => useRunnerToday(), {
      wrapper: wrapperFor(makeTestQueryClient()),
    })
    expect(empty.result.current).toBe(todayIso())
  })

  test('the session user wins over a cached Today payload of another zone', () => {
    const queryClient = makeTestQueryClient()
    queryClient.setQueryData(['today'], { tz: 'Pacific/Kiritimati' })
    seedRunnerZone(queryClient, 'Pacific/Pago_Pago')
    const { result } = renderHook(() => useRunnerToday(), { wrapper: wrapperFor(queryClient) })
    expect(result.current).toBe(isoDateInZone(new Date(), 'Pacific/Pago_Pago'))
  })

  test('a session user cached without a zone falls through to the Today payload', () => {
    const queryClient = makeTestQueryClient()
    queryClient.setQueryData(['me'], { id: 'u1' })
    queryClient.setQueryData(['today'], { tz: 'Pacific/Pago_Pago' })
    const { result } = renderHook(() => useRunnerToday(), { wrapper: wrapperFor(queryClient) })
    expect(result.current).toBe(isoDateInZone(new Date(), 'Pacific/Pago_Pago'))
  })

  test("an unknown zone gives the device's day and throws nothing", () => {
    vi.useFakeTimers()
    const queryClient = makeTestQueryClient()
    seedRunnerZone(queryClient, 'Not/AZone')
    const { result } = renderHook(() => useRunnerToday(), { wrapper: wrapperFor(queryClient) })
    expect(result.current).toBe(todayIso())
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
  })

  test('a timer that fires 1 ms early still rolls the day over', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T10:59:59.000Z'))
    const queryClient = makeTestQueryClient()
    seedRunnerZone(queryClient, 'Pacific/Pago_Pago')
    const { result } = renderHook(() => useRunnerToday(), { wrapper: wrapperFor(queryClient) })
    expect(result.current).toBe('2026-10-21')
    // The boundary is 1000 ms away: the first fire is at 999 ms, 1 ms early.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(result.current).toBe('2026-10-21')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })
    expect(result.current).toBe('2026-10-22')
  })

  test('a return to the page after the boundary updates the day', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T10:00:00.000Z'))
    const queryClient = makeTestQueryClient()
    seedRunnerZone(queryClient, 'Pacific/Pago_Pago')
    const { result } = renderHook(() => useRunnerToday(), { wrapper: wrapperFor(queryClient) })
    expect(result.current).toBe('2026-10-21')
    // The device slept past the boundary (no timer runs, as with the real timers left alone).
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe('2026-10-22')
  })

  test("moves to the next day when the runner's day ends, not the device's", async () => {
    vi.useFakeTimers()
    // 23:59:30 at Pago Pago on 21 Oct, which is 10:59:30 on the 23rd on the device.
    vi.setSystemTime(new Date('2026-10-22T10:59:30.000Z'))
    const queryClient = makeTestQueryClient()
    seedRunnerZone(queryClient, 'Pacific/Pago_Pago')
    const { result } = renderHook(() => useRunnerToday(), { wrapper: wrapperFor(queryClient) })
    expect(result.current).toBe('2026-10-21')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    expect(result.current).toBe('2026-10-22')
  })
})
