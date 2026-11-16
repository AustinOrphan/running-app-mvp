import { describe, expect, test } from 'vitest'
import {
  dueRunners,
  MATCHING_SLOT,
  REPLAN_SLOT,
  weekSlotStart,
} from '../../../server/jobs/scheduler.ts'

/**
 * D10 step 3 (ADR 0022): the night and Monday slots follow each runner's zone. The zones are named
 * on every call and the instants are UTC, so no test depends on the process zone.
 */

const utc = (iso: string): Date => new Date(`${iso}Z`)
const NONE = new Map<string, string>()

describe('dueRunners', () => {
  // Monday 2026-10-19 at 03:30 UTC: Monday 05:30 in Berlin (UTC+2), Sunday 20:30 in Los Angeles
  // (UTC-7), Monday 17:30 in Kiritimati (UTC+14), Monday 09:00 in Kolkata (UTC+5:30).
  const now = utc('2026-10-19T03:30:00')
  const runners = [
    { userId: 'berlin', tz: 'Europe/Berlin' },
    { userId: 'la', tz: 'America/Los_Angeles' },
    { userId: 'kiritimati', tz: 'Pacific/Kiritimati' },
    { userId: 'kolkata', tz: 'Asia/Kolkata' },
  ]

  test('the Monday slot is due for the runners whose own clock is past Monday 03:00', () => {
    expect(dueRunners(now, runners, NONE, REPLAN_SLOT)).toEqual([
      { userId: 'berlin', date: '2026-10-19' },
      { userId: 'kiritimati', date: '2026-10-19' },
      { userId: 'kolkata', date: '2026-10-19' },
    ])
  })

  test('the runner on Sunday evening is due when the slot comes on that runner is clock', () => {
    // 10:00 UTC is Monday 03:00 in Los Angeles.
    expect(dueRunners(utc('2026-10-19T09:59:00'), [runners[1]!], NONE, REPLAN_SLOT)).toEqual([])
    expect(dueRunners(utc('2026-10-19T10:00:00'), [runners[1]!], NONE, REPLAN_SLOT)).toEqual([
      { userId: 'la', date: '2026-10-19' },
    ])
  })

  test('the night slot is due every day, for each runner on the local date of the slot', () => {
    // 00:45 UTC: Kiritimati is on Tuesday 14:45, Los Angeles on Monday 17:45 (still Monday).
    const due = dueRunners(utc('2026-10-20T00:45:00'), runners, NONE, MATCHING_SLOT)
    expect(due.map((d) => [d.userId, d.date])).toEqual([
      ['berlin', '2026-10-20'],
      ['la', '2026-10-19'],
      ['kiritimati', '2026-10-20'],
      ['kolkata', '2026-10-20'],
    ])
    // Before 02:30 on the local clock a runner is not due.
    expect(dueRunners(utc('2026-10-19T23:59:00'), [runners[0]!], NONE, MATCHING_SLOT)).toEqual([])
  })

  test('a runner whose slot already ran that local date is not due again, the next date is', () => {
    const last = new Map([
      ['berlin', '2026-10-19'],
      ['kolkata', '2026-10-12'],
    ])
    expect(dueRunners(now, runners, last, REPLAN_SLOT).map((d) => d.userId)).toEqual([
      'kiritimati',
      'kolkata',
    ])
  })

  test('a restart seed (the date dueRunners gives with no last) stops that day and not the next', () => {
    const seed = new Map(
      dueRunners(now, runners, NONE, REPLAN_SLOT).map((d) => [d.userId, d.date] as const),
    )
    expect(dueRunners(now, runners, seed, REPLAN_SLOT)).toEqual([])
    expect(dueRunners(utc('2026-10-26T03:30:00'), runners, seed, REPLAN_SLOT)).toHaveLength(3)
  })

  test('a runner first seen after the slot has run for that day, one seen before it has not', () => {
    const late = [{ userId: 'late', tz: 'Europe/Berlin' }]
    const seed = new Map(
      dueRunners(utc('2026-10-19T05:00:00'), late, NONE, REPLAN_SLOT).map(
        (d) => [d.userId, d.date] as const,
      ),
    )
    expect(dueRunners(utc('2026-10-19T05:10:00'), late, seed, REPLAN_SLOT)).toEqual([])
    const early = new Map(
      dueRunners(utc('2026-10-19T00:30:00'), late, NONE, REPLAN_SLOT).map(
        (d) => [d.userId, d.date] as const,
      ),
    )
    expect(early.size).toBe(0)
    expect(dueRunners(utc('2026-10-19T01:10:00'), late, early, REPLAN_SLOT)).toHaveLength(1)
  })

  test('spring forward: the 02:30 slot of the skipped night is due at the first check after 03:00', () => {
    const berlin = [{ userId: 'berlin', tz: 'Europe/Berlin' }]
    // 2026-03-29: Berlin goes from 02:00 to 03:00 at 01:00 UTC.
    expect(dueRunners(utc('2026-03-29T00:59:00'), berlin, NONE, MATCHING_SLOT)).toEqual([])
    expect(dueRunners(utc('2026-03-29T01:00:00'), berlin, NONE, MATCHING_SLOT)).toEqual([
      { userId: 'berlin', date: '2026-03-29' },
    ])
  })

  test('fall back: the 02:30 slot comes once, the second 02:30 is the same local date', () => {
    const berlin = [{ userId: 'berlin', tz: 'Europe/Berlin' }]
    // 2026-10-25: Berlin goes from 03:00 back to 02:00 at 01:00 UTC, so 02:30 happens twice.
    const first = dueRunners(utc('2026-10-25T00:30:00'), berlin, NONE, MATCHING_SLOT)
    expect(first).toEqual([{ userId: 'berlin', date: '2026-10-25' }])
    const last = new Map(first.map((d) => [d.userId, d.date] as const))
    expect(dueRunners(utc('2026-10-25T01:30:00'), berlin, last, MATCHING_SLOT)).toEqual([])
  })

  test('a half-hour daylight saving zone follows its own wall clock', () => {
    // Lord Howe is UTC+11 in October (daylight time, a 30-minute shift): Monday 03:00 is
    // Sunday 16:00 UTC.
    const howe = [{ userId: 'howe', tz: 'Australia/Lord_Howe' }]
    expect(dueRunners(utc('2026-10-18T15:59:00'), howe, NONE, REPLAN_SLOT)).toEqual([])
    expect(dueRunners(utc('2026-10-18T16:00:00'), howe, NONE, REPLAN_SLOT)).toEqual([
      { userId: 'howe', date: '2026-10-19' },
    ])
  })
})

describe('weekSlotStart', () => {
  test('is the slot on the zone is wall clock, or null before it has come', () => {
    // Monday 03:00 in Berlin in October (UTC+2) is 01:00 UTC.
    const berlin = 'Europe/Berlin'
    expect(weekSlotStart(utc('2026-10-19T00:59:00'), REPLAN_SLOT, berlin)).toBeNull()
    expect(weekSlotStart(utc('2026-10-19T01:00:00'), REPLAN_SLOT, berlin)).toEqual(
      utc('2026-10-19T01:00:00'),
    )
    // Sunday evening still belongs to the week that began on the Monday.
    expect(weekSlotStart(utc('2026-10-25T20:00:00'), REPLAN_SLOT, berlin)).toEqual(
      utc('2026-10-19T01:00:00'),
    )
  })

  test('one instant gives different slots in different zones', () => {
    const now = utc('2026-10-19T12:00:00')
    // Kiritimati (+14): already Tuesday 02:00, Monday 03:00 was Sunday 13:00 UTC.
    expect(weekSlotStart(now, REPLAN_SLOT, 'Pacific/Kiritimati')).toEqual(
      utc('2026-10-18T13:00:00'),
    )
    // Pago Pago (-11): Monday 01:00, the slot has not come.
    expect(weekSlotStart(now, REPLAN_SLOT, 'Pacific/Pago_Pago')).toBeNull()
    // Kathmandu (+5:45): Monday 03:00 was Sunday 21:15 UTC.
    expect(weekSlotStart(now, REPLAN_SLOT, 'Asia/Kathmandu')).toEqual(utc('2026-10-18T21:15:00'))
    // St John's (-2:30 in October daylight time): Monday 03:00 is 05:30 UTC.
    expect(weekSlotStart(now, REPLAN_SLOT, 'America/St_Johns')).toEqual(utc('2026-10-19T05:30:00'))
  })

  test('a week that holds a spring-forward change keeps the slot on the wall clock', () => {
    const berlin = 'Europe/Berlin'
    // Monday 23 March 03:00 CET is 02:00 UTC; the clocks change on Sunday 29 March.
    expect(weekSlotStart(utc('2026-03-29T12:00:00'), REPLAN_SLOT, berlin)).toEqual(
      utc('2026-03-23T02:00:00'),
    )
    // Monday 30 March 03:00 CEST is 01:00 UTC.
    expect(weekSlotStart(utc('2026-04-01T12:00:00'), REPLAN_SLOT, berlin)).toEqual(
      utc('2026-03-30T01:00:00'),
    )
  })

  test('a week that holds a fall-back change keeps the slot on the wall clock', () => {
    const berlin = 'Europe/Berlin'
    // Monday 19 October 03:00 CEST is 01:00 UTC; the clocks change on Sunday 25 October.
    expect(weekSlotStart(utc('2026-10-25T22:00:00'), REPLAN_SLOT, berlin)).toEqual(
      utc('2026-10-19T01:00:00'),
    )
    // Monday 26 October 03:00 CET is 02:00 UTC.
    expect(weekSlotStart(utc('2026-10-26T01:59:00'), REPLAN_SLOT, berlin)).toBeNull()
    expect(weekSlotStart(utc('2026-10-26T02:00:00'), REPLAN_SLOT, berlin)).toEqual(
      utc('2026-10-26T02:00:00'),
    )
  })

  test('a slot in the skipped hour is the first instant after the gap, a repeated one the first', () => {
    const berlin = 'Europe/Berlin'
    const sunday0230 = { weekday: 0, hour: 2, minute: 30 }
    // Sunday 29 March: 02:30 does not exist; the first instant after the gap is 03:00 CEST = 01:00 UTC.
    expect(weekSlotStart(utc('2026-03-29T12:00:00'), sunday0230, berlin)).toEqual(
      utc('2026-03-29T01:00:00'),
    )
    // Sunday 25 October: 02:30 happens twice; the first is 02:30 CEST = 00:30 UTC.
    expect(weekSlotStart(utc('2026-10-25T12:00:00'), sunday0230, berlin)).toEqual(
      utc('2026-10-25T00:30:00'),
    )
  })

  test('an unknown zone is refused', () => {
    expect(() => weekSlotStart(utc('2026-10-19T12:00:00'), REPLAN_SLOT, 'Not/AZone')).toThrow(
      RangeError,
    )
  })
})
