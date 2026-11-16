import { afterEach, describe, expect, test } from 'vitest'
import {
  chosenZone,
  describeZoneCutover,
  loadRunnerDay,
  runnerDay,
  runnerDays,
  runnerZone,
  serverTimeZone,
  zoneCutoverReport,
} from '../../../server/runnerDay.ts'
import { createTestCtx, seedUser, type TestCtx } from '../../api/helpers.ts'

const SLOW = 30_000
const NOW = new Date('2026-11-16T12:00:00Z')

function inZone<T>(zone: string, run: () => T): T {
  const original = process.env.TZ
  process.env.TZ = zone
  try {
    return run()
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
}

describe('runnerZone (D10 step 1: every runner follows the server zone)', () => {
  test.each([['Pacific/Kiritimati'], ['Etc/UTC'], ['UTC'], [null], [undefined], ['Nowhere/Land']])(
    'gives the server zone for %s',
    (stored) => {
      expect(runnerZone(stored)).toBe(serverTimeZone())
      for (const zone of ['America/Chicago', 'Asia/Kolkata']) {
        inZone(zone, () => expect(runnerZone(stored)).toBe(serverTimeZone()))
      }
    },
  )

  test('serverTimeZone follows the process zone', () => {
    inZone('Pacific/Auckland', () => expect(serverTimeZone()).toBe('Pacific/Auckland'))
    inZone('America/Chicago', () => expect(serverTimeZone()).toBe('America/Chicago'))
  })

  test('runnerDay is the date of `now` in the server zone, with the instant it was given', () => {
    inZone('Pacific/Kiritimati', () => {
      const day = runnerDay(NOW, 'Pacific/Pago_Pago')
      expect(day).toEqual({ tz: 'Pacific/Kiritimati', today: '2026-11-17', now: NOW })
      expect(day.now).toBe(NOW)
    })
    inZone('Pacific/Pago_Pago', () => {
      expect(runnerDay(NOW, 'Pacific/Kiritimati').today).toBe('2026-11-16')
    })
  })
})

describe('chosenZone (the rule step 5 applies)', () => {
  test('keeps a valid zone as stored, Etc/UTC included, and never canonicalises it', () => {
    expect(chosenZone('America/Chicago')).toBe('America/Chicago')
    expect(chosenZone('Etc/UTC')).toBe('Etc/UTC')
    expect(Intl.DateTimeFormat('en', { timeZone: 'Etc/UTC' }).resolvedOptions().timeZone).toBe(
      'UTC',
    )
  })

  test('reads the literal UTC, no row and an unknown zone as not chosen', () => {
    expect(chosenZone('UTC')).toBeNull()
    expect(chosenZone(null)).toBeNull()
    expect(chosenZone(undefined)).toBeNull()
    expect(chosenZone('Nowhere/Land')).toBeNull()
  })
})

describe('describeZoneCutover', () => {
  test('names ids and counts, nothing else', () => {
    expect(describeZoneCutover({ moving: ['a1', 'b2'], unset: 3 })).toBe(
      "D10: 2 runner(s) (a1, b2) will follow a zone other than the server's; 3 runner(s) have no zone chosen and keep the server's day",
    )
    expect(describeZoneCutover({ moving: [], unset: 0 })).toBe(
      "D10: 0 runners will follow a zone other than the server's; 0 runner(s) have no zone chosen and keep the server's day",
    )
  })
})

describe('the readers of the stored zone', () => {
  const open: TestCtx[] = []
  afterEach(async () => {
    await Promise.all(open.splice(0).map((ctx) => ctx.close()))
  })

  async function ctxWith(zones: Record<string, string | null>) {
    const ctx = await createTestCtx()
    open.push(ctx)
    const ids: Record<string, string> = {}
    for (const [name, zone] of Object.entries(zones)) {
      const user = await seedUser(ctx, { email: `${name}@example.com` })
      ids[name] = user.id
      if (zone !== null) {
        await ctx.prisma.athleteProfile.upsert({
          where: { userId: user.id },
          create: { userId: user.id, timezone: zone },
          update: { timezone: zone },
        })
      }
    }
    const idOf = (name: string): string => {
      const id = ids[name]
      if (id === undefined) throw new Error(`no runner ${name}`)
      return id
    }
    return { ctx, ids, idOf }
  }

  test(
    'loadRunnerDay and runnerDays give the server day for a real zone, UTC and no row',
    async () => {
      const { ctx, ids, idOf } = await ctxWith({
        far: 'Pacific/Kiritimati',
        utc: 'UTC',
        none: null,
      })
      const expected = runnerDay(NOW, null)
      expect(await loadRunnerDay(ctx.prisma, idOf('far'), NOW)).toEqual(expected)
      expect(await loadRunnerDay(ctx.prisma, idOf('none'), NOW)).toEqual(expected)
      const days = await runnerDays(ctx.prisma, NOW)
      expect([...days.keys()].sort()).toEqual(Object.values(ids).sort())
      for (const day of days.values()) expect(day).toEqual(expected)
      const some = await runnerDays(ctx.prisma, NOW, [idOf('utc')])
      expect([...some.keys()]).toEqual([idOf('utc')])
    },
    SLOW,
  )

  test(
    'zoneCutoverReport lists runners with a zone other than the server, and counts the unset',
    async () => {
      const server = serverTimeZone()
      const { ctx, idOf } = await ctxWith({
        far: server === 'Pacific/Kiritimati' ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati',
        // A server in 'UTC' reads its own name as unset, so the chosen same-zone runner uses the alias.
        same: server === 'UTC' ? 'Etc/UTC' : server,
        utc: 'UTC',
        none: null,
        bad: 'Nowhere/Land',
      })
      const report = await zoneCutoverReport(ctx.prisma)
      expect(report).toEqual({ moving: [idOf('far')], unset: 3 })
    },
    SLOW,
  )

  test(
    'zoneCutoverReport reads an alias of the server zone as the server zone',
    async () => {
      const { ctx, idOf } = await ctxWith({ calcutta: 'Asia/Calcutta', utc: 'Etc/UTC' })
      const original = process.env.TZ
      try {
        process.env.TZ = 'Asia/Kolkata'
        expect(await zoneCutoverReport(ctx.prisma)).toEqual({ moving: [idOf('utc')], unset: 0 })
        process.env.TZ = 'UTC'
        expect(await zoneCutoverReport(ctx.prisma)).toEqual({
          moving: [idOf('calcutta')],
          unset: 0,
        })
      } finally {
        if (original === undefined) delete process.env.TZ
        else process.env.TZ = original
      }
    },
    SLOW,
  )
})
