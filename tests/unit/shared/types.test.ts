import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  Activity,
  ActivityDetail,
  ActivitySource,
  ActivityStreamData,
  AthleteProfile,
  Availability,
  Feel,
  HrHistogram,
  Injury,
  IntegrationStatus,
  Lap,
  ParsedActivity,
  ProviderInfo,
  Terrain,
  UploadedFile,
  Weekday,
  WellnessDay,
  WellnessInput,
} from '../../../shared/types.ts'
import { makeActivity } from '../../factories.ts'

describe('shared contract types', () => {
  it('opens ActivitySource to any registry key', () => {
    expectTypeOf<ActivitySource>().toEqualTypeOf<string>()
  })

  it('keeps the feel scale from -2 to +2', () => {
    expectTypeOf<Feel>().toEqualTypeOf<-2 | -1 | 0 | 1 | 2>()
  })

  it('extends Activity with the data-foundation fields', () => {
    expectTypeOf<Activity['startUtc']>().toEqualTypeOf<string | null>()
    expectTypeOf<Activity['hrHistogram']>().toEqualTypeOf<HrHistogram | null>()
    expectTypeOf<Activity['feel']>().toEqualTypeOf<Feel | null>()
    expectTypeOf<Activity['weatherSource']>().toEqualTypeOf<
      'open-meteo' | 'provider' | 'manual' | null
    >()
    const activity = makeActivity({ feel: 1, pain: 3, subtype: 'trail' })
    expect(activity).toMatchObject({ feel: 1, pain: 3, subtype: 'trail', startUtc: null })
  })

  it('shapes the stream, laps and parsed activity as the spec does', () => {
    expectTypeOf<ActivityStreamData>().toEqualTypeOf<{
      t: number[]
      d: number[] | null
      hr: number[] | null
      alt: number[] | null
      cad: number[] | null
      pwr: number[] | null
    }>()
    expectTypeOf<ParsedActivity['samples']>().toEqualTypeOf<ActivityStreamData>()
    expectTypeOf<ParsedActivity['laps']>().toEqualTypeOf<Lap[]>()
    expectTypeOf<Lap>().toHaveProperty('startSec').toEqualTypeOf<number>()
    expectTypeOf<Injury['kind']>().toEqualTypeOf<
      'bone-stress' | 'tendon' | 'muscle' | 'joint' | 'other'
    >()
  })

  it('keys availability by weekday', () => {
    expectTypeOf<keyof Availability>().toEqualTypeOf<Weekday>()
    expectTypeOf<keyof Terrain>().toEqualTypeOf<'trail' | 'hills' | 'treadmill' | 'track'>()
    expectTypeOf<AthleteProfile['strengthPreference']>().toEqualTypeOf<0 | 1 | 2 | 3>()
  })

  it('extends WellnessInput into WellnessDay', () => {
    expectTypeOf<WellnessDay>().toMatchTypeOf<WellnessInput>()
    expectTypeOf<WellnessDay['source']>().toEqualTypeOf<string>()
    expectTypeOf<WellnessInput>().toHaveProperty('hrvSdnn').toEqualTypeOf<number | null>()
  })

  it('describes providers and their status', () => {
    expectTypeOf<ProviderInfo['channels']>().toEqualTypeOf<
      Array<'pull' | 'push' | 'upload' | 'folder'>
    >()
    expectTypeOf<IntegrationStatus['info']>().toEqualTypeOf<ProviderInfo>()
    expectTypeOf<IntegrationStatus['status']>().toEqualTypeOf<
      'disconnected' | 'connected' | 'needs_auth' | 'error'
    >()
    expectTypeOf<ActivityDetail['stream']>().toEqualTypeOf<
      (ActivityStreamData & { sampleSec: number }) | null
    >()
    expectTypeOf<UploadedFile['bytes']>().toEqualTypeOf<Uint8Array>()
  })
})
