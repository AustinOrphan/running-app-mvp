import { describe, expect, test } from 'vitest'
import { ratingAsk } from '../../../shared/domain/ratingAsk.ts'

const none = { rpe: null, rpeSource: null, feel: null, pain: null } as const

describe('ratingAsk (FP1)', () => {
  test('a run with no rating and no feel gets the full ask', () => {
    expect(ratingAsk(none)).toBe('full')
    expect(ratingAsk({ ...none, pain: 2 })).toBe('full')
  })

  test('a feel answers the run whatever the rating', () => {
    expect(ratingAsk({ ...none, feel: 0 })).toBeNull()
    expect(ratingAsk({ rpe: 5, rpeSource: 'watch', feel: -1, pain: null })).toBeNull()
  })

  test('an in-app rating, or one of unknown source, answers the run', () => {
    expect(ratingAsk({ ...none, rpe: 6, rpeSource: 'app' })).toBeNull()
    expect(ratingAsk({ ...none, rpe: 6, rpeSource: null })).toBeNull()
  })

  test('a watch rating alone leaves the short ask', () => {
    expect(ratingAsk({ ...none, rpe: 6, rpeSource: 'watch' })).toBe('short')
  })

  test('a watch rating the snapshot reads as empty (spread check not passed) is still a short ask', () => {
    expect(ratingAsk({ ...none, rpeSource: 'watch' })).toBe('short')
  })

  test('a watch rating with a pain, even 0, is answered', () => {
    expect(ratingAsk({ ...none, rpe: 6, rpeSource: 'watch', pain: 0 })).toBeNull()
    expect(ratingAsk({ ...none, rpe: 6, rpeSource: 'watch', pain: 3 })).toBeNull()
  })
})
