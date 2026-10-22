import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HttpError } from '../../../server/errors.ts'
import { appleHealthPush } from '../../../server/providers/appleHealth.ts'
import type { ProviderCtx } from '../../../server/providers/types.ts'

const payload = JSON.parse(
  readFileSync(new URL('../../fixtures/apple/push.json', import.meta.url), 'utf8'),
) as unknown

const ctx = { timezone: 'UTC' } as ProviderCtx

function workoutPayload(name: string, extra: Record<string, unknown> = {}) {
  return {
    data: {
      workouts: [
        {
          id: `id-${name}`,
          name,
          start: '2026-03-04 07:00:00 -0500',
          end: '2026-03-04 07:30:00 -0500',
          ...extra,
        },
      ],
    },
  }
}

describe('appleHealthPush.parsePush: metrics', () => {
  const { wellness, ignored } = appleHealthPush.parsePush(payload, ctx)

  it('maps the five metrics to wellness days, HRV to SDNN only', () => {
    expect(wellness).toEqual([
      {
        date: '2026-03-03',
        restingHr: 53,
        hrvRmssd: null,
        hrvSdnn: null,
        sleepSec: null,
        sleepScore: null,
        weightKg: null,
        vo2max: null,
      },
      {
        date: '2026-03-04',
        restingHr: 52,
        hrvRmssd: null,
        hrvSdnn: 41.5,
        sleepSec: 26_100,
        sleepScore: null,
        weightKg: 83.2,
        vo2max: 45.3,
      },
    ])
  })

  it('reads a night with sleep stages, where asleep is 0, from totalSleep or the stages', () => {
    const night = (point: Record<string, unknown>) =>
      appleHealthPush.parsePush(
        {
          data: {
            metrics: [
              {
                name: 'sleep_analysis',
                units: 'hr',
                data: [{ sleepEnd: '2026-03-04 06:45:00 -0500', asleep: 0, ...point }],
              },
            ],
          },
        },
        ctx,
      ).wellness[0]
    expect(night({ core: 4, deep: 1, rem: 2, totalSleep: 7 })).toMatchObject({
      date: '2026-03-04',
      sleepSec: 7 * 3600,
    })
    expect(night({ core: 4, deep: 1, rem: 1.5 })?.sleepSec).toBe(6.5 * 3600)
    expect(night({})).toBeUndefined()
  })

  it('counts unknown metrics and unreadable workouts instead of failing', () => {
    expect(ignored).toEqual({ step_count: 2, 'workout:unreadable': 1 })
  })
})

describe('appleHealthPush.parsePush: workouts', () => {
  const { activities } = appleHealthPush.parsePush(payload, ctx)
  const run = activities[0]

  it('maps the run, keyed by the workout id, with the offset kept', () => {
    expect(activities).toHaveLength(2)
    expect(run).toMatchObject({
      providerKey: 'apple:00000000-0000-4000-8000-000000000001',
      startUtc: '2026-03-04T12:00:00.000Z',
      utcOffsetMin: -300,
      type: 'run',
      subtype: null,
      elapsedSec: 1800,
      movingSec: 1795,
      avgHr: 149,
      maxHr: 172,
    })
  })

  it('converts miles and feet to metres', () => {
    expect(run?.distanceM).toBe(4989)
    expect(run?.elevationGainM).toBe(50)
  })

  it('drops heart-rate points outside the workout, including the recovery readings', () => {
    expect(run?.samples.hr).not.toContain(90)
    expect(run?.samples.hr).not.toContain(110)
    expect(run?.samples.hr).not.toContain(100)
    expect(run?.samples.hr).toEqual([120, 120, 120])
  })

  it('builds the route: cumulative haversine distance, altitude, rounded start, clipped times', () => {
    expect(run?.samples.t).toEqual([0, 30, 60])
    expect(run?.samples.alt).toEqual([10, 14, 20])
    expect(run?.samples.d?.[0]).toBe(0)
    expect(run?.samples.d?.[2]).toBeCloseTo(222.4, 0)
    expect(run?.startLat).toBe(0.01)
    expect(run?.startLng).toBe(-0.01)
    expect(run?.elevationLossM).toBe(0)
  })

  it('maps a strength workout without a route to an activity with no samples', () => {
    expect(activities[1]).toMatchObject({
      providerKey: 'apple:00000000-0000-4000-8000-000000000002',
      type: 'strength',
      elapsedSec: 2700,
      distanceM: null,
      startLat: null,
    })
    expect(activities[1]?.samples.t).toEqual([])
  })

  it.each([
    ['Outdoor Run', 'run', null],
    ['Indoor Run', 'run', 'treadmill'],
    ['Trail Run', 'run', 'trail'],
    ['Running', 'run', null],
    ['Outdoor Walk', 'cross', null],
    ['Hiking', 'cross', null],
    ['Outdoor Cycling', 'cross', null],
    ['Pool Swim', 'cross', null],
    ['Functional Strength Training', 'strength', null],
  ])('maps the workout name %s to %s / %s', (name, type, subtype) => {
    const out = appleHealthPush.parsePush(workoutPayload(name), ctx)
    expect(out.activities[0]).toMatchObject({ type, subtype })
  })

  it('clips heart-rate points to [start, end] when there is no route', () => {
    const heartRateData = [
      ['06:59:50', 90],
      ['07:00:10', 120],
      ['07:29:50', 165],
      ['07:31:00', 110],
    ].map(([time, avg]) => ({ date: `2026-03-04 ${time} -0500`, Avg: avg, Max: avg }))
    const out = appleHealthPush.parsePush(workoutPayload('Outdoor Run', { heartRateData }), ctx)
    expect(out.activities[0]?.samples).toMatchObject({ t: [10, 1790], hr: [120, 165] })
    expect(out.activities[0]).toMatchObject({ avgHr: 143, maxHr: 165 })
  })

  it('uses the location to find an indoor run', () => {
    const out = appleHealthPush.parsePush(workoutPayload('Running', { location: 'Indoor' }), ctx)
    expect(out.activities[0]?.subtype).toBe('treadmill')
  })

  it('takes the route length as the distance when the workout has none', () => {
    const route = [0, 1, 2].map((i) => ({
      latitude: 0.001 * i,
      longitude: 0,
      altitude: 5,
      timestamp: `2026-03-04 07:0${i}:00 -0500`,
    }))
    const out = appleHealthPush.parsePush(workoutPayload('Outdoor Run', { route }), ctx)
    expect(out.activities[0]?.distanceM).toBe(222)
    expect(out.activities[0]?.samples.hr).toBeNull()
  })
})

describe('appleHealthPush.parsePush: input', () => {
  it('accepts an empty export', () => {
    expect(appleHealthPush.parsePush({ data: {} }, ctx)).toEqual({
      activities: [],
      wellness: [],
      ignored: {},
    })
  })

  it('rejects a body that is not Health Auto Export JSON with a validation error', () => {
    expect(() => appleHealthPush.parsePush({ nope: true }, ctx)).toThrow(HttpError)
    expect(() => appleHealthPush.parsePush('text', ctx)).toThrow(HttpError)
  })
})
