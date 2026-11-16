import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createQueryClient, keys } from '../../web/api/client.ts'
import {
  COPY_RETRY_MAX_MS,
  COPY_RETRY_MS,
  copyRetryDelay,
  copyRetryInterval,
} from '../../web/api/copyRetry.ts'
import { useToday } from '../../web/api/today.ts'
import { mockApi } from './helpers.tsx'

// Timers are faked, but user-event is not used here, so nothing stalls.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

type Answer = 'copy' | 'server'

function serve(initial: Answer = 'copy') {
  const state = { answer: initial }
  const { calls } = mockApi({
    'GET /api/today': () => (state.answer === 'copy' ? { servedFromCache: true } : {}),
  })
  const reads = () => calls.filter((c) => c.method === 'GET' && c.url === '/api/today').length
  return { state, reads }
}

function harness() {
  const queryClient = createQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

// Reading a Response body takes turns of the real event loop, which the fake timers do not drive.
const realTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 3; i += 1) {
      await realTurn()
      await vi.advanceTimersByTimeAsync(0)
    }
  })
}

/** Lets the first read and the ask on reconnect settle: two reads, the second one an ask. */
async function settle() {
  for (let i = 0; i < 8; i += 1) await advance(0)
}

describe('copyRetryDelay', () => {
  test('doubles from the first step and stops at the cap', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8].map(copyRetryDelay)
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000])
    expect(copyRetryDelay(1)).toBe(COPY_RETRY_MS)
    expect(Math.max(...delays)).toBe(COPY_RETRY_MAX_MS)
  })
})

describe('copyRetryInterval', () => {
  function fake(state: { data?: { servedFromCache?: true }; dataUpdateCount: number }) {
    return { state } as unknown as Parameters<typeof copyRetryInterval>[0]
  }

  test('asks again for the same state with the same wait, and counts each new answer once', () => {
    const query = fake({ data: { servedFromCache: true }, dataUpdateCount: 1 })
    expect(copyRetryInterval(query)).toBe(2_000)
    expect(copyRetryInterval(query)).toBe(2_000)
    query.state.dataUpdateCount = 2
    expect(copyRetryInterval(query)).toBe(4_000)
    expect(copyRetryInterval(query)).toBe(4_000)
  })

  test('starts again at the first step after a server answer', () => {
    const query = fake({ data: { servedFromCache: true }, dataUpdateCount: 1 })
    copyRetryInterval(query)
    query.state.dataUpdateCount = 2
    expect(copyRetryInterval(query)).toBe(4_000)
    query.state.data = {}
    query.state.dataUpdateCount = 3
    expect(copyRetryInterval(query)).toBe(false)
    query.state.data = { servedFromCache: true }
    query.state.dataUpdateCount = 4
    expect(copyRetryInterval(query)).toBe(2_000)
  })

  test('does not ask while the browser says it is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(copyRetryInterval(fake({ data: { servedFromCache: true }, dataUpdateCount: 1 }))).toBe(
      false,
    )
  })
})

describe('the reads that repeat while the answer is the phone copy', () => {
  test('stop for good once the server has answered', async () => {
    const { state, reads } = serve('copy')
    const { wrapper } = harness()
    renderHook(() => useToday(), { wrapper })
    await settle()
    expect(reads()).toBe(2)
    state.answer = 'server'
    await advance(2_000)
    expect(reads()).toBe(3)
    await advance(3 * COPY_RETRY_MAX_MS)
    expect(reads()).toBe(3)
  })

  test('make no second read while the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { reads } = serve('copy')
    const { wrapper } = harness()
    renderHook(() => useToday(), { wrapper })
    await settle()
    await advance(10 * COPY_RETRY_MAX_MS)
    expect(reads()).toBe(1)
  })

  test('make no request at all for a disabled observer over a copy', async () => {
    const { reads } = serve('copy')
    const { queryClient, wrapper } = harness()
    queryClient.setQueryData([keys.today], { servedFromCache: true })
    renderHook(() => useToday({ enabled: false }), { wrapper })
    await settle()
    await advance(10 * COPY_RETRY_MAX_MS)
    expect(reads()).toBe(0)
  })

  test('make one request for each tick with two observers mounted', async () => {
    const { reads } = serve('copy')
    const { wrapper } = harness()
    renderHook(() => ({ a: useToday(), b: useToday() }), { wrapper })
    await settle()
    // the read and one ask on reconnect, neither cancelling the other
    expect(reads()).toBe(2)
    await advance(2_000)
    expect(reads()).toBe(3)
    await advance(4_000)
    expect(reads()).toBe(4)
    await advance(8_000)
    expect(reads()).toBe(5)
  })

  test('wait twice as long after each copy up to the cap, and start again after a server answer', async () => {
    const { state, reads } = serve('copy')
    const { queryClient, wrapper } = harness()
    renderHook(() => useToday(), { wrapper })
    await settle()
    expect(reads()).toBe(2)

    let seen = reads()
    for (const wait of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]) {
      await advance(wait - 1)
      expect(reads()).toBe(seen)
      await advance(1)
      seen += 1
      expect(reads()).toBe(seen)
    }

    // a server answer ends the repeat; a later copy starts the steps again
    state.answer = 'server'
    await advance(COPY_RETRY_MAX_MS)
    seen += 1
    expect(reads()).toBe(seen)
    state.answer = 'copy'
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: [keys.today] })
    })
    seen += 1
    await advance(COPY_RETRY_MS - 1)
    expect(reads()).toBe(seen)
    await advance(1)
    expect(reads()).toBe(seen + 1)
  })

  test('start the wait again from the first step when the connection returns', async () => {
    const { reads } = serve('copy')
    const { wrapper } = harness()
    renderHook(() => useToday(), { wrapper })
    await settle()
    await advance(2_000)
    await advance(4_000)
    expect(reads()).toBe(4)
    // the next wait is 8 s; going offline and back asks at once and goes back to 2 s
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
      await vi.advanceTimersByTimeAsync(0)
    })
    online.mockReturnValue(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(reads()).toBe(5)
    await advance(2_000)
    expect(reads()).toBe(6)
  })
})
