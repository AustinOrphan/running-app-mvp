import { describe, expect, it } from 'vitest'
import {
  REMOVAL_DAYS,
  removalDateOf,
  removalIsDue,
  withRemovalClock,
  withoutRemovalClock,
} from '../../../shared/domain/stravaRemoval.ts'

const NOW = new Date('2026-11-18T10:00:00Z')

describe('the Strava removal clock (SC1)', () => {
  it('is 25 days', () => {
    expect(REMOVAL_DAYS).toBe(25)
  })

  it('starts 25 days after the refusal and keeps the rest of the config', () => {
    const config = withRemovalClock({ clientId: '1' }, NOW)
    expect(config.clientId).toBe('1')
    expect(removalDateOf(config)?.toISOString()).toBe('2026-12-13T10:00:00.000Z')
  })

  it('keeps a date that already runs, so a second refusal does not push the removal out', () => {
    const first = withRemovalClock({}, NOW)
    const second = withRemovalClock(first, new Date('2026-12-01T00:00:00Z'))
    expect(removalDateOf(second)).toEqual(removalDateOf(first))
  })

  it('is due on the date and not a minute before', () => {
    const config = withRemovalClock({}, NOW)
    const due = removalDateOf(config)!
    expect(removalIsDue(config, new Date(due.getTime() - 60_000))).toBe(false)
    expect(removalIsDue(config, due)).toBe(true)
    expect(removalIsDue({}, due)).toBe(false)
  })

  it('is cleared by connecting again, and an unreadable date reads as none', () => {
    expect(withoutRemovalClock({ clientId: '1', ...withRemovalClock({}, NOW) })).toEqual({
      clientId: '1',
    })
    expect(removalDateOf({ deleteAt: 'soon' })).toBeNull()
    expect(removalDateOf({ deleteAt: 5 })).toBeNull()
  })
})
