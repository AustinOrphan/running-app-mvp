import { afterEach, describe, expect, test } from 'vitest'
import {
  chosenZone,
  describeZoneCutover,
  loadRunnerDay,
  runnerDay,
  runnerDays,
  runnerZone,
  serverTimeZone,
  setUnknownZoneReporter,
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

describe('runnerZone (D10 step 5: the stored zone, or the server zone)', () => {
  test.each([['Pacific/Kiritimati'], ['Pacific/Pago_Pago'], ['Europe/Berlin'], ['Etc/UTC']])(
    'gives the stored zone as written for %s, whatever the process zone',
    (stored) => {
      expect(runnerZone(stored)).toBe(stored)
      for (const zone of ['America/Chicago', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
        inZone(zone, () => expect(runnerZone(stored)).toBe(stored))
      }
    },
  )

  test.each([['UTC'], [null], [undefined], ['Nowhere/Land']])(
    'gives the server zone for %s',
    (stored) => {
      expect(runnerZone(stored)).toBe(serverTimeZone())
      for (const zone of ['America/Chicago', 'Asia/Kolkata']) {
        inZone(zone, () => expect(runnerZone(stored)).toBe(serverTimeZone()))
      }
    },
  )

  describe('a stored zone the server does not know', () => {
    afterEach(() => {
      setUnknownZoneReporter(null)
    })

    test('is reported once per process and runner, with the runner id only', () => {
      const reported: string[] = []
      setUnknownZoneReporter((userId) => reported.push(userId))
      runnerZone('Nowhere/Land', 'u1')
      runnerZone('Nowhere/Land', 'u1')
      runnerZone('Elsewhere/Land', 'u2')
      expect(reported).toEqual(['u1', 'u2'])
    })

    test('is not reported for a zone that is valid, the literal UTC, or no zone', () => {
      const reported: string[] = []
      setUnknownZoneReporter((userId) => reported.push(userId))
      runnerZone('Europe/Berlin', 'u1')
      runnerZone('UTC', 'u1')
      runnerZone(null, 'u1')
      runnerZone(undefined, 'u1')
      expect(reported).toEqual([])
    })
  })

  test('serverTimeZone follows the process zone', () => {
    inZone('Pacific/Auckland', () => expect(serverTimeZone()).toBe('Pacific/Auckland'))
    inZone('America/Chicago', () => expect(serverTimeZone()).toBe('America/Chicago'))
  })

  test('runnerDay is the date of `now` in the runner zone, with the instant it was given', () => {
    // 12:00 UTC on the 16th is 02:00 on the 17th at +14 and 01:00 on the 16th at -11.
    for (const host of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Berlin']) {
      inZone(host, () => {
        const far = runnerDay(NOW, 'Pacific/Kiritimati')
        expect(far).toEqual({ tz: 'Pacific/Kiritimati', today: '2026-11-17', now: NOW })
        expect(far.now).toBe(NOW)
        expect(runnerDay(NOW, 'Pacific/Pago_Pago')).toEqual({
          tz: 'Pacific/Pago_Pago',
          today: '2026-11-16',
          now: NOW,
        })
      })
    }
    inZone('Pacific/Kiritimati', () => {
      expect(runnerDay(NOW, 'UTC')).toEqual({
        tz: 'Pacific/Kiritimati',
        today: '2026-11-17',
        now: NOW,
      })
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
      "D10: 2 runner(s) (a1, b2) follow a zone other than the server's; 3 runner(s) have no zone chosen and keep the server's day",
    )
    expect(describeZoneCutover({ moving: [], unset: 0 })).toBe(
      "D10: 0 runners follow a zone other than the server's; 0 runner(s) have no zone chosen and keep the server's day",
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
    'loadRunnerDay and runnerDays give the stored zone, and the server day for UTC and no row',
    async () => {
      const { ctx, ids, idOf } = await ctxWith({
        far: 'Pacific/Kiritimati',
        utc: 'UTC',
        none: null,
      })
      const server = runnerDay(NOW, null)
      const far = runnerDay(NOW, 'Pacific/Kiritimati')
      expect(far.tz).toBe('Pacific/Kiritimati')
      expect(await loadRunnerDay(ctx.prisma, idOf('far'), NOW)).toEqual(far)
      expect(await loadRunnerDay(ctx.prisma, idOf('none'), NOW)).toEqual(server)
      const days = await runnerDays(ctx.prisma, NOW)
      expect([...days.keys()].sort()).toEqual(Object.values(ids).sort())
      expect(days.get(idOf('far'))).toEqual(far)
      expect(days.get(idOf('utc'))).toEqual(server)
      expect(days.get(idOf('none'))).toEqual(server)
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
