import { describe, expect, it } from 'vitest'
import { movingTimeDiffers } from '../../../shared/domain/movingTime.ts'

describe('movingTimeDiffers', () => {
  it('is false for an activity with no moving time', () => {
    expect(movingTimeDiffers({ durationSec: 1800, movingSec: null })).toBe(false)
  })

  it('is false when the moving time is the elapsed time, or within a second of it', () => {
    expect(movingTimeDiffers({ durationSec: 1800, movingSec: 1800 })).toBe(false)
    expect(movingTimeDiffers({ durationSec: 1800, movingSec: 1800.5 })).toBe(false)
    expect(movingTimeDiffers({ durationSec: 1800, movingSec: 1799.5 })).toBe(false)
  })

  it('is true from a second apart, whichever time is the longer', () => {
    expect(movingTimeDiffers({ durationSec: 1800, movingSec: 1799 })).toBe(true)
    expect(movingTimeDiffers({ durationSec: 1800, movingSec: 1750 })).toBe(true)
    expect(movingTimeDiffers({ durationSec: 1750, movingSec: 1801 })).toBe(true)
  })
})
