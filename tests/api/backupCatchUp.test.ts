import { existsSync, readdirSync, rmSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { sqliteFilePath } from '../../server/dbPath.ts'
import {
  BACKUP_SLOT,
  lastSlotStart,
  runBackupCatchUp,
  startScheduler,
} from '../../server/jobs/scheduler.ts'
import { backupDirectory } from '../../server/services/backup.ts'
import { settleBackground } from '../../server/services/sync.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  noNetwork,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// createBackup is the real one unless a test holds it open, to keep a copy in flight.
const gate = vi.hoisted(() => ({ hold: null as Promise<void> | null }))
vi.mock('../../server/services/backup.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/backup.ts')>()
  return {
    ...original,
    createBackup: async (...args: Parameters<typeof original.createBackup>) => {
      await gate.hold
      return original.createBackup(...args)
    },
  }
})

// Local time, like the slot; a date on which no zone changes its clock.
const AFTER_SLOT = new Date(2026, 5, 17, 9, 0)
const BEFORE_SLOT = new Date(2026, 5, 17, 1, 0)

let ctx: TestCtx
let user: TestUser
const dir = () => backupDirectory(sqliteFilePath(ctx.config.databaseUrl))
const copies = () => (existsSync(dir()) ? readdirSync(dir()) : [])
const runs = () => ctx.prisma.syncRun.findMany({ where: { channel: 'job', provider: 'backup' } })

async function seedRun(startedAt: Date, status = 'ok', accepted = 1): Promise<void> {
  await ctx.prisma.syncRun.create({
    data: {
      userId: user.id,
      provider: 'backup',
      channel: 'job',
      trigger: 'schedule',
      startedAt,
      finishedAt: startedAt,
      status,
      accepted,
    },
  })
}

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})
afterAll(async () => {
  await ctx.close()
})
beforeEach(async () => {
  // Only Date is faked, so the log's age-based pruning reads the same clock as the dates below.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AFTER_SLOT)
  rmSync(dir(), { recursive: true, force: true })
  await ctx.prisma.syncRun.deleteMany()
})
afterEach(async () => {
  vi.useRealTimers()
  await settleBackground()
  expectNoRefusedFetches(ctx)
})

describe('lastSlotStart', () => {
  test('is today 02:00 after the slot and yesterday 02:00 before it', () => {
    expect(lastSlotStart(AFTER_SLOT, BACKUP_SLOT)).toEqual(new Date(2026, 5, 17, 2, 0))
    expect(lastSlotStart(BEFORE_SLOT, BACKUP_SLOT)).toEqual(new Date(2026, 5, 16, 2, 0))
  })
})

describe('runBackupCatchUp', () => {
  test('runs once when the last backup predates the last 02:00 slot, recorded as a catch-up', async () => {
    await seedRun(new Date(2026, 5, 16, 2, 0))
    expect(await runBackupCatchUp(ctx, { now: AFTER_SLOT })).toBe(true)
    expect(copies()).toHaveLength(1)
    const all = await runs()
    expect(all).toHaveLength(2)
    expect(all.find((run) => run.trigger === 'catchup')).toMatchObject({
      status: 'ok',
      accepted: 1,
    })
    // The copy is now the newest backup, so a second look finds nothing due.
    expect(await runBackupCatchUp(ctx, { now: AFTER_SLOT })).toBe(false)
    expect(copies()).toHaveLength(1)
  })

  test('runs when there has never been a backup', async () => {
    expect(await runBackupCatchUp(ctx, { now: AFTER_SLOT })).toBe(true)
    expect(copies()).toHaveLength(1)
  })

  test('does not run when the last backup is at or after the last slot', async () => {
    await seedRun(new Date(2026, 5, 17, 2, 0))
    expect(await runBackupCatchUp(ctx, { now: AFTER_SLOT })).toBe(false)
    // Before today's slot, yesterday's copy is the one that counts.
    await ctx.prisma.syncRun.deleteMany()
    await seedRun(new Date(2026, 5, 16, 2, 5))
    expect(await runBackupCatchUp(ctx, { now: BEFORE_SLOT })).toBe(false)
    expect(copies()).toHaveLength(0)
  })

  test('a failed run is not a backup, and a failed catch-up is recorded, not thrown', async () => {
    await seedRun(new Date(2026, 5, 17, 2, 0), 'error', 0)
    const broken = { ...ctx, config: { ...ctx.config, databaseUrl: 'file:/nonexistent-dir/x.db' } }
    await expect(runBackupCatchUp(broken, { now: AFTER_SLOT })).resolves.toBe(true)
    const failed = (await runs()).find((run) => run.trigger === 'catchup')
    expect(failed).toMatchObject({ status: 'error', accepted: 0 })
  })
})

describe('the scheduler start', () => {
  test('makes one catch-up copy shortly after a start past 02:00, and the daily slot does not repeat it', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    })
    vi.setSystemTime(AFTER_SLOT)
    const stop = startScheduler(
      { prisma: ctx.prisma, config: ctx.config },
      { fetch: noNetwork(ctx.refusedFetches) },
    )
    expect(copies()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(31_000)
    await vi.waitFor(async () => expect(await runs()).toHaveLength(1), { timeout: 10_000 })
    expect(copies()).toHaveLength(1)
    expect((await runs())[0]).toMatchObject({ trigger: 'catchup', status: 'ok' })

    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
    expect(await runs()).toHaveLength(1)

    // The next 02:00 slot (first check at 02:10 the next day) makes its own copy.
    await vi.advanceTimersByTimeAsync(17 * 60 * 60_000 + 15 * 60_000)
    await vi.waitFor(async () => expect(await runs()).toHaveLength(2), { timeout: 10_000 })
    expect(copies()).toHaveLength(2)
    expect((await runs()).map((run) => run.trigger).sort()).toEqual(['catchup', 'schedule'])
    stop()
    await settleBackground()
  })

  test('a catch-up still in flight when the slot fires blocks a second copy, and the flag resets', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    })
    // Five minutes before the slot with no backup: the catch-up starts at 01:55:30 and is held open
    // past the first daily check (02:05).
    vi.setSystemTime(new Date(2026, 5, 17, 1, 55))
    let release!: () => void
    gate.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const stop = startScheduler(
      { prisma: ctx.prisma, config: ctx.config },
      { fetch: noNetwork(ctx.refusedFetches) },
    )
    try {
      await vi.advanceTimersByTimeAsync(31_000)
      await vi.advanceTimersByTimeAsync(15 * 60_000)
      expect(copies()).toHaveLength(0)

      gate.hold = null
      release()
      await vi.waitFor(async () => expect(await runs()).toHaveLength(1), { timeout: 10_000 })
      // Settle: a second, concurrent copy would have been recorded by now.
      await vi.advanceTimersByTimeAsync(60_000)
      await settleBackground()
      expect(await runs()).toHaveLength(1)
      expect(copies()).toHaveLength(1)
      expect((await runs())[0]).toMatchObject({ trigger: 'catchup', status: 'ok' })

      // The flag is back down: the next day's slot copies.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      await vi.waitFor(async () => expect(await runs()).toHaveLength(2), { timeout: 10_000 })
      expect(copies()).toHaveLength(2)
    } finally {
      gate.hold = null
      stop()
      await settleBackground()
    }
  })

  test('does nothing at start when the day is already covered', async () => {
    await seedRun(new Date(2026, 5, 17, 2, 0))
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    })
    vi.setSystemTime(AFTER_SLOT)
    const stop = startScheduler(
      { prisma: ctx.prisma, config: ctx.config },
      { fetch: noNetwork(ctx.refusedFetches) },
    )
    await vi.advanceTimersByTimeAsync(31_000)
    await settleBackground()
    expect(await runs()).toHaveLength(1)
    expect(copies()).toHaveLength(0)
    stop()
  })
})
