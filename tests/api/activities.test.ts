import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { markDuplicates } from '../../server/services/duplicates.ts'
import { parseGenericCsv } from '../../shared/importers/generic.ts'
import type { Activity } from '../../shared/types.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

interface Json {
  id: string
  email: string
  displayName: string | null
  duplicateStatus: string
  duplicateOfId: string | null
  distanceM: number | null
  error: { code: string; details: { issues: Array<{ path: string }> } }
}

/** The response body, typed for the fields these tests read. */
function json(res: { body: unknown }): Json {
  return res.body as Json
}

let ctx: TestCtx
let user: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
})

const run = { date: '2026-03-02', type: 'run', durationSec: 1800, distanceM: 5000 }

/** An imported row, written straight to the database as an import would. */
async function seedImported(over: { date?: string; distanceM?: number } = {}) {
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: over.date ?? '2026-03-02',
      type: 'run',
      durationSec: 1800,
      distanceM: over.distanceM ?? 5000,
      source: 'smashrun',
      providerKey: `smashrun:${Math.random()}`,
    },
  })
}

async function post(body: object, as: TestUser = user) {
  return client(ctx, as).post('/api/activities').send(body)
}

describe('activities CRUD', () => {
  test('requires a session', async () => {
    expect((await client(ctx).get('/api/activities')).status).toBe(401)
  })

  test('create, read, update, delete a run; new rows are source manual with duplicateStatus none', async () => {
    const created = await post({ ...run, startTime: '06:30', rpe: 4, notes: '  easy  ' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      userId: user.id,
      date: '2026-03-02',
      startTime: '06:30',
      type: 'run',
      durationSec: 1800,
      distanceM: 5000,
      rpe: 4,
      avgHr: null,
      maxHr: null,
      elevationGainM: null,
      notes: 'easy',
      source: 'manual',
      providerKey: null,
      importBatchId: null,
      duplicateOfId: null,
      duplicateStatus: 'none',
    })
    const id = json(created).id

    const read = await client(ctx, user).get(`/api/activities/${id}`)
    expect(read.status).toBe(200)
    expect(read.body).toEqual(created.body)

    const updated = await client(ctx, user)
      .put(`/api/activities/${id}`)
      .send({ ...run, durationSec: 2400, distanceM: 6000, avgHr: 150, notes: '' })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({
      id,
      durationSec: 2400,
      distanceM: 6000,
      avgHr: 150,
      notes: null,
      startTime: null,
      rpe: null,
    })

    const del = await client(ctx, user).delete(`/api/activities/${id}`)
    expect(del.status).toBe(204)
    expect((await client(ctx, user).get(`/api/activities/${id}`)).status).toBe(404)
  })

  test('validation', async () => {
    const bad: Array<[string, object]> = [
      ['durationSec', { ...run, durationSec: 0 }],
      ['durationSec', { ...run, durationSec: 540001 }],
      ['distanceM', { ...run, distanceM: -1 }],
      ['distanceM', { ...run, distanceM: 1000001 }],
      ['rpe', { ...run, rpe: 0 }],
      ['rpe', { ...run, rpe: 11 }],
      ['avgHr', { ...run, avgHr: 29 }],
      ['avgHr', { ...run, avgHr: 251 }],
      ['maxHr', { ...run, maxHr: 251 }],
      ['elevationGainM', { ...run, elevationGainM: 9001 }],
      ['date', { ...run, date: '2026-02-30' }],
      ['date', { ...run, date: '3/2/2026' }],
      ['startTime', { ...run, startTime: '25:00' }],
      ['startTime', { ...run, startTime: '6:30' }],
      ['type', { ...run, type: 'swim' }],
      ['notes', { ...run, notes: 'n'.repeat(2001) }],
      ['durationSec', { ...run, durationSec: 12.5 }],
      ['date', { type: 'run', durationSec: 60 }],
    ]
    for (const [path, body] of bad) {
      const res = await post(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(json(res).error.code).toBe('validation')
      const paths = (json(res).error.details.issues as Array<{ path: string }>).map((i) => i.path)
      expect(paths).toContain(path)
    }
    const edge = await post({ ...run, durationSec: 540000, distanceM: 1000000, rpe: 10, avgHr: 30 })
    expect(edge.status).toBe(201)
    const strength = await post({ date: '2026-03-02', type: 'strength', durationSec: 1800 })
    expect(strength.status).toBe(201)
    expect(json(strength).distanceM).toBeNull()
    const long = await post({ ...run, notes: 'n'.repeat(2000) })
    expect(long.status).toBe(201)
    const badPut = await client(ctx, user)
      .put(`/api/activities/${json(strength).id}`)
      .send({ ...run, rpe: 11 })
    expect(badPut.status).toBe(400)
  })

  test('list filters from, to (inclusive) and type, newest first; from after to -> 400', async () => {
    await post({ ...run, date: '2026-03-01' })
    await post({ ...run, date: '2026-03-03', type: 'race' })
    await post({ ...run, date: '2026-03-05', type: 'strength', distanceM: null })
    await post({ ...run, date: '2026-03-08' })

    const all = await client(ctx, user).get('/api/activities')
    expect(all.status).toBe(200)
    expect((all.body as Activity[]).map((a) => a.date)).toEqual([
      '2026-03-08',
      '2026-03-05',
      '2026-03-03',
      '2026-03-01',
    ])

    const range = await client(ctx, user).get('/api/activities?from=2026-03-03&to=2026-03-08')
    expect((range.body as Activity[]).map((a) => a.date)).toEqual([
      '2026-03-08',
      '2026-03-05',
      '2026-03-03',
    ])
    const exact = await client(ctx, user).get('/api/activities?from=2026-03-05&to=2026-03-05')
    expect((exact.body as Activity[]).length).toBe(1)

    const runs = await client(ctx, user).get('/api/activities?type=run')
    expect((runs.body as Activity[]).map((a) => a.date)).toEqual(['2026-03-08', '2026-03-01'])

    expect(
      (await client(ctx, user).get('/api/activities?from=2026-03-09&to=2026-03-01')).status,
    ).toBe(400)
    expect((await client(ctx, user).get('/api/activities?type=swim')).status).toBe(400)
    expect((await client(ctx, user).get('/api/activities?from=nope')).status).toBe(400)
  })

  test('rows of another user are not_found on read, update, delete and duplicate resolution', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    const mine = await post(run)
    const id = json(mine).id
    const c = client(ctx, other)
    expect((await c.get(`/api/activities/${id}`)).status).toBe(404)
    expect((await c.put(`/api/activities/${id}`).send(run)).status).toBe(404)
    expect((await c.delete(`/api/activities/${id}`)).status).toBe(404)
    expect(
      (await c.post(`/api/activities/${id}/duplicate`).send({ status: 'confirmed' })).status,
    ).toBe(404)
    expect(((await c.get('/api/activities')).body as Activity[]).length).toBe(0)
    expect((await client(ctx, user).get(`/api/activities/${id}`)).status).toBe(200)
    await ctx.prisma.user.delete({ where: { id: other.id } })
  })
})

describe('duplicate flagging', () => {
  test('a manual run within 80 m of an imported run on the same date is flagged possible with duplicateOfId', async () => {
    const imported = await seedImported({ distanceM: 5000 })

    const near = await post({ ...run, distanceM: 5080 })
    expect(near.body).toMatchObject({ duplicateStatus: 'possible', duplicateOfId: imported.id })

    const far = await post({ ...run, distanceM: 5081 })
    expect(far.body).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })

    const otherDay = await post({ ...run, date: '2026-03-03', distanceM: 5000 })
    expect(json(otherDay).duplicateStatus).toBe('none')

    const strength = await post({ date: '2026-03-02', type: 'strength', durationSec: 1800 })
    expect(json(strength).duplicateStatus).toBe('none')

    // Two manual rows never flag each other.
    const first = await post({ ...run, date: '2026-03-10', distanceM: 5000 })
    const twin = await post({ ...run, date: '2026-03-10', distanceM: 5010 })
    expect(json(first).duplicateStatus).toBe('none')
    expect(json(twin).duplicateStatus).toBe('none')
  })

  test('flagged rows are excluded from totals only through duplicateStatus; GET still returns them', async () => {
    const imported = await seedImported()
    const flagged = await post({ ...run })
    expect(json(flagged).duplicateStatus).toBe('possible')

    const list = (await client(ctx, user).get('/api/activities')).body as Activity[]
    expect(list.map((a) => a.id).sort()).toEqual([imported.id, json(flagged).id].sort())
    const stored = list.find((a) => a.id === json(flagged).id)
    expect(stored).toMatchObject({
      distanceM: 5000,
      durationSec: 1800,
      duplicateStatus: 'possible',
    })
    const kept = list.find((a) => a.id === imported.id)
    expect(kept?.duplicateStatus).toBe('none')
  })

  test('confirm and dismiss', async () => {
    const imported = await seedImported()
    const a = await post({ ...run })
    expect(json(a).duplicateOfId).toBe(imported.id)
    const id = json(a).id

    const confirmed = await client(ctx, user)
      .post(`/api/activities/${id}/duplicate`)
      .send({ status: 'confirmed' })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body).toMatchObject({
      duplicateStatus: 'confirmed',
      duplicateOfId: imported.id,
    })

    const dismissed = await client(ctx, user)
      .post(`/api/activities/${id}/duplicate`)
      .send({ status: 'dismissed' })
    expect(dismissed.status).toBe(200)
    expect(json(dismissed).duplicateStatus).toBe('dismissed')

    const bad = await client(ctx, user)
      .post(`/api/activities/${id}/duplicate`)
      .send({ status: 'possible' })
    expect(bad.status).toBe(400)
    expect(json(bad).error.code).toBe('validation')

    // A later import pass must not flag the dismissed row again.
    await markDuplicates(ctx.prisma, user.id, [id, imported.id])
    const after = await client(ctx, user).get(`/api/activities/${id}`)
    expect(json(after).duplicateStatus).toBe('dismissed')

    const plain = await post({ ...run, date: '2026-04-01', distanceM: 1234 })
    const conflict = await client(ctx, user)
      .post(`/api/activities/${json(plain).id}/duplicate`)
      .send({ status: 'confirmed' })
    expect(conflict.status).toBe(409)
    expect(json(conflict).error.code).toBe('conflict')
  })

  test('markDuplicates counts only newly flagged rows and ignores other users', async () => {
    const imported = await seedImported()
    const manual = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: '2026-03-02',
        type: 'run',
        durationSec: 1800,
        distanceM: 5020,
      },
    })
    expect(await markDuplicates(ctx.prisma, user.id, [manual.id])).toBe(1)
    expect(await markDuplicates(ctx.prisma, user.id, [manual.id, imported.id])).toBe(0)
    expect(await markDuplicates(ctx.prisma, user.id, [])).toBe(0)
    const other = await seedUser(ctx, { email: 'third@example.com' })
    expect(await markDuplicates(ctx.prisma, other.id, [manual.id])).toBe(0)
    await ctx.prisma.user.delete({ where: { id: other.id } })
  })

  test('a freshly imported row flags the older manual row it repeats and stays counted', async () => {
    const manual = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: '2026-03-02',
        type: 'run',
        durationSec: 1800,
        distanceM: 5000,
      },
    })
    const imported = await seedImported({ distanceM: 5040 })
    expect(await markDuplicates(ctx.prisma, user.id, [imported.id])).toBe(1)
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: manual.id } })
    expect(row).toMatchObject({ duplicateStatus: 'possible', duplicateOfId: imported.id })
    const kept = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: imported.id } })
    expect(kept.duplicateStatus).toBe('none')
  })

  test('editing date, distance or type re-evaluates the flag; other edits keep it', async () => {
    const imported = await seedImported()
    const manual = await post({ ...run, distanceM: 5050 })
    const id = json(manual).id
    expect(json(manual).duplicateStatus).toBe('possible')

    const notesOnly = await client(ctx, user)
      .put(`/api/activities/${id}`)
      .send({ ...run, distanceM: 5050, notes: 'felt good' })
    expect(notesOnly.body).toMatchObject({
      duplicateStatus: 'possible',
      duplicateOfId: imported.id,
    })

    const moved = await client(ctx, user)
      .put(`/api/activities/${id}`)
      .send({ ...run, distanceM: 5050, date: '2026-03-03' })
    expect(moved.body).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })

    const back = await client(ctx, user)
      .put(`/api/activities/${id}`)
      .send({ ...run, distanceM: 5050 })
    expect(back.body).toMatchObject({ duplicateStatus: 'possible', duplicateOfId: imported.id })

    const longer = await client(ctx, user)
      .put(`/api/activities/${id}`)
      .send({ ...run, distanceM: 9000 })
    expect(longer.body).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })

    // Editing the imported original so it no longer matches releases the rows that pointed to it.
    const again = await client(ctx, user)
      .put(`/api/activities/${id}`)
      .send({ ...run, distanceM: 5050 })
    expect(json(again).duplicateStatus).toBe('possible')
    const editedOriginal = await client(ctx, user)
      .put(`/api/activities/${imported.id}`)
      .send({ ...run, distanceM: 8000 })
    expect(editedOriginal.status).toBe(200)
    const released = await client(ctx, user).get(`/api/activities/${id}`)
    expect(released.body).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })

    // Editing the original so it matches again flags the row again.
    const rematch = await client(ctx, user)
      .put(`/api/activities/${imported.id}`)
      .send({ ...run, distanceM: 5060 })
    expect(rematch.status).toBe(200)
    const flaggedAgain = await client(ctx, user).get(`/api/activities/${id}`)
    expect(flaggedAgain.body).toMatchObject({
      duplicateStatus: 'possible',
      duplicateOfId: imported.id,
    })
  })

  test('editing an original keeps a confirmed row while the pair still matches and releases it otherwise', async () => {
    const imported = await seedImported()
    const manual = await post({ ...run, distanceM: 5030 })
    const id = json(manual).id
    await client(ctx, user).post(`/api/activities/${id}/duplicate`).send({ status: 'confirmed' })

    await client(ctx, user)
      .put(`/api/activities/${imported.id}`)
      .send({ ...run, distanceM: 5010 })
    const still = await client(ctx, user).get(`/api/activities/${id}`)
    expect(still.body).toMatchObject({ duplicateStatus: 'confirmed', duplicateOfId: imported.id })

    await client(ctx, user)
      .put(`/api/activities/${imported.id}`)
      .send({ ...run, distanceM: 5010, date: '2026-03-04' })
    const released = await client(ctx, user).get(`/api/activities/${id}`)
    expect(released.body).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })
  })

  test('deleting the original releases the flagged rows', async () => {
    const imported = await seedImported()
    const possible = await post({ ...run })
    expect(json(possible).duplicateStatus).toBe('possible')
    const confirmedRow = await post({ ...run, distanceM: 5030 })
    await client(ctx, user)
      .post(`/api/activities/${json(confirmedRow).id}/duplicate`)
      .send({ status: 'confirmed' })

    const del = await client(ctx, user).delete(`/api/activities/${imported.id}`)
    expect(del.status).toBe(204)

    for (const row of [possible, confirmedRow]) {
      const after = await client(ctx, user).get(`/api/activities/${json(row).id}`)
      expect(after.body).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })
    }
  })
})

describe('export.csv', () => {
  test('headers, minutes with 2 decimals, miles with 4, RFC 4180 quoting', async () => {
    await post({
      date: '2026-03-02',
      startTime: '07:05',
      type: 'run',
      durationSec: 1805,
      distanceM: 5000,
      avgHr: 150,
      maxHr: 171,
      elevationGainM: 42,
      rpe: 5,
      notes: 'He said "go", then\nwe went, fast',
    })
    await post({ date: '2026-03-03', type: 'strength', durationSec: 1800 })
    const res = await client(ctx, user).get('/api/activities/export.csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[^"]+\.csv"$/)
    const text = res.text
    expect(text.split('\r\n')[0]).toBe(
      'date,start_time,type,minutes,miles,avg_hr,max_hr,elevation_gain_m,rpe,notes,source,duplicate_status',
    )
    expect(text).toContain(
      '2026-03-02,07:05,run,30.08,3.1069,150,171,42,5,"He said ""go"", then\nwe went, fast",manual,none',
    )
    expect(text).toContain('2026-03-03,,strength,30.00,,,,,,,manual,none')
  })

  test('the units setting does not change the export (always miles)', async () => {
    const km = await seedUser(ctx, { email: 'km@example.com', units: 'km' })
    await post({ ...run, distanceM: 10000 }, km)
    const res = await client(ctx, km).get('/api/activities/export.csv')
    expect(res.text).toContain(',6.2137,')
    await ctx.prisma.user.delete({ where: { id: km.id } })
  })

  test('a note beginning with =, +, -, @, a tab or a CR is prefixed with an apostrophe', async () => {
    const leads = ['=SUM(A1)', '+1', '-2', '@cmd', '\tx', '\ry']
    for (const [i, notes] of leads.entries()) {
      await ctx.prisma.activity.create({
        data: {
          userId: user.id,
          date: `2026-03-0${i + 1}`,
          type: 'run',
          durationSec: 600,
          distanceM: 1000 + i * 500,
          notes,
        },
      })
    }
    const res = await client(ctx, user).get('/api/activities/export.csv')
    expect(res.text).toContain(",'=SUM(A1),")
    expect(res.text).toContain(",'+1,")
    expect(res.text).toContain(",'-2,")
    expect(res.text).toContain(",'@cmd,")
    expect(res.text).toContain(",'\tx,")
    expect(res.text).toContain(',"\'\ry",')
    expect(res.text).not.toMatch(/,[=+\-@\t][^,]*,manual/)
  })

  test('only the caller rows are exported, and run rows round-trip through parseGenericCsv', async () => {
    const other = await seedUser(ctx, { email: 'else@example.com' })
    await post({ ...run, date: '2026-05-01', distanceM: 7777 }, other)
    const inputs = [
      { date: '2026-03-02', durationSec: 1805, distanceM: 5000, notes: 'a, "b"' },
      { date: '2026-03-04', durationSec: 3601, distanceM: 10000, notes: null },
      { date: '2026-03-06', durationSec: 2700, distanceM: 8047, notes: 'line\r\nbreak' },
      { date: '2026-03-07', durationSec: 5400, distanceM: 16093, notes: null },
    ]
    for (const i of inputs) await post({ type: 'run', ...i })
    const res = await client(ctx, user).get('/api/activities/export.csv')
    expect(res.text).not.toContain('2026-05-01')
    const parsed = parseGenericCsv(res.text)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows.length).toBe(inputs.length)
    for (const i of inputs) {
      const row = parsed.rows.find((r) => r.date === i.date)
      expect(row).toBeDefined()
      expect(Math.abs((row?.distanceM ?? 0) - i.distanceM)).toBeLessThanOrEqual(1)
      expect(Math.abs((row?.durationSec ?? 0) - i.durationSec)).toBeLessThanOrEqual(1)
    }
    await ctx.prisma.user.delete({ where: { id: other.id } })
  })
})
