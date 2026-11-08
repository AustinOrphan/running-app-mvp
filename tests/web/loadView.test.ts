import { describe, expect, test, vi } from 'vitest'
import { combineQueries, loadViewOf } from '../../web/components/loadView.ts'

const query = (over: Partial<Parameters<typeof loadViewOf>[0]> = {}) => ({
  data: undefined,
  isError: false,
  isFetching: false,
  ...over,
})

describe('loadViewOf', () => {
  test('a first read in flight is loading', () => {
    expect(loadViewOf(query({ isFetching: true }), false)).toBe('loading')
  })

  test('a failed first read is failed', () => {
    expect(loadViewOf(query({ isError: true }), true)).toBe('failed')
    expect(loadViewOf(query({ isError: true }), false)).toBe('failed')
  })

  test('the retry of a failed first read is retrying, not loading: the query is pending again', () => {
    expect(loadViewOf(query({ isFetching: true }), true)).toBe('retrying')
  })

  test('data wins: a page holding data keeps it when a refetch fails', () => {
    expect(loadViewOf(query({ data: { a: 1 }, isError: true }), false)).toBe('ready')
    expect(loadViewOf(query({ data: { a: 1 }, isError: true, isFetching: true }), true)).toBe(
      'ready',
    )
  })
})

describe('combineQueries', () => {
  const read = (over: Partial<Parameters<typeof query>[0]> = {}) => ({
    ...query(over),
    refetch: vi.fn(() => Promise.resolve()),
  })

  test('has data only when every read has', () => {
    expect(combineQueries([read({ data: 1 }), read({ data: null })]).data).toBeDefined()
    expect(combineQueries([read({ data: 1 }), read()]).data).toBeUndefined()
  })

  test('has failed when any read has, and is fetching while any is', () => {
    const combined = combineQueries([read({ data: 1 }), read({ isError: true, isFetching: true })])
    expect(combined.isError).toBe(true)
    expect(combined.isFetching).toBe(true)
    expect(combineQueries([read(), read()]).isError).toBe(false)
  })

  test('retries only the reads that failed', async () => {
    const held = read({ data: 1 })
    const failed = read({ isError: true })
    await combineQueries([held, failed]).retry()
    expect(failed.refetch).toHaveBeenCalledTimes(1)
    expect(held.refetch).not.toHaveBeenCalled()
  })
})
