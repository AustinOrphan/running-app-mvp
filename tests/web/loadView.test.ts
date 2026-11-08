import { describe, expect, test } from 'vitest'
import { loadViewOf } from '../../web/components/loadView.ts'

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
