import { describe, expect, it } from 'vitest'
import { refusedAtOf, withRefusal, withoutRefusal } from '../../../shared/domain/stravaRemoval.ts'

const NOW = new Date('2026-11-18T10:00:00Z')

describe('the Strava refusal note (SC1)', () => {
  it('records when Strava refused and keeps the rest of the config', () => {
    const config = withRefusal({ clientId: '1' }, NOW)
    expect(config.clientId).toBe('1')
    expect(refusedAtOf(config)?.toISOString()).toBe('2026-11-18T10:00:00.000Z')
  })

  it('keeps an earlier date, so a second refusal does not move it', () => {
    const first = withRefusal({}, NOW)
    const second = withRefusal(first, new Date('2026-12-01T00:00:00Z'))
    expect(refusedAtOf(second)).toEqual(refusedAtOf(first))
  })

  it('is cleared by connecting again, and an unreadable value reads as none', () => {
    expect(withoutRefusal({ clientId: '1', ...withRefusal({}, NOW) })).toEqual({ clientId: '1' })
    expect(refusedAtOf({ refusedAt: 'soon' })).toBeNull()
    expect(refusedAtOf({ refusedAt: 5 })).toBeNull()
    expect(refusedAtOf({})).toBeNull()
  })
})
