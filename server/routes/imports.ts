import { Router } from 'express'
import { z } from 'zod'
import { parseGenericCsv } from '../../shared/importers/generic.ts'
import { parseSmashrunCsv } from '../../shared/importers/smashrun.ts'
import type { ImportRow, RowError } from '../../shared/importers/csv.ts'
import type { ActivitySource, ImportReportRow } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { parse, validationError } from '../errors.ts'
import { toImportBatch } from '../serialize.ts'
import { markDuplicates } from '../services/duplicates.ts'

/** Records (data rows plus rejected rows) one upload may carry. */
const MAX_RECORDS = 50_000
/** Rows per database statement; keeps each statement under SQLite's bound-variable limit. */
const CHUNK = 500
const MAX_FILE_NAME = 200

const uploadSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    text: z.string().refine((text) => text.trim().length > 0, 'text must not be empty'),
    distanceUnit: z.enum(['mi', 'km']).optional(),
  })
  .strict()

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The last path segment, so a browser-supplied path never reaches the stored name. */
function baseName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? ''
  return (name === '' ? fileName : name).slice(0, MAX_FILE_NAME)
}

export function importsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  async function importRows(
    userId: string,
    source: Exclude<ActivitySource, 'manual'>,
    fileName: string,
    parsed: { rows: ImportRow[]; errors: RowError[] },
  ) {
    const { rows, errors } = parsed
    if (rows.length + errors.length > MAX_RECORDS) {
      throw validationError(`A file may hold at most ${MAX_RECORDS} records.`)
    }

    const known = new Set<string>()
    for (const chunk of chunks(rows, CHUNK)) {
      const found = await prisma.activity.findMany({
        where: { userId, providerKey: { in: chunk.map((row) => row.providerKey) } },
        select: { providerKey: true },
      })
      for (const { providerKey } of found) if (providerKey) known.add(providerKey)
    }

    const fresh: ImportRow[] = []
    const report: ImportReportRow[] = errors.map(({ line, reason }) => ({ line, reason }))
    for (const row of rows) {
      if (known.has(row.providerKey)) {
        report.push({ line: null, reason: `already imported (${row.providerKey})` })
      } else {
        known.add(row.providerKey)
        fresh.push(row)
      }
    }

    const batch = await prisma.$transaction(
      async (tx) => {
        const created = await tx.importBatch.create({
          data: {
            userId,
            source,
            fileName: baseName(fileName),
            rowCount: rows.length + errors.length,
            accepted: fresh.length,
            skippedDuplicate: rows.length - fresh.length,
            skippedInvalid: errors.length,
            errors: JSON.stringify(report),
          },
        })
        for (const chunk of chunks(fresh, CHUNK)) {
          await tx.activity.createMany({
            data: chunk.map((row) => ({
              userId,
              importBatchId: created.id,
              type: 'run',
              source,
              providerKey: row.providerKey,
              date: row.date,
              startTime: row.startTime,
              durationSec: row.durationSec,
              distanceM: row.distanceM,
              avgHr: row.avgHr,
              maxHr: row.maxHr,
              elevationGainM: row.elevationGainM,
              notes: row.notes,
            })),
          })
        }
        // Inside the transaction, so a failure here rolls the whole import back and the client's
        // "nothing was imported" holds.
        if (fresh.length > 0) {
          const inserted = await tx.activity.findMany({
            where: { userId, importBatchId: created.id },
            select: { id: true },
          })
          await markDuplicates(
            tx,
            userId,
            inserted.map((row) => row.id),
          )
        }
        return created
      },
      { timeout: 60_000 },
    )

    return toImportBatch(batch)
  }

  router.post('/smashrun', async (req, res) => {
    const body = parse(uploadSchema, req.body)
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
      select: { units: true },
    })
    const parsed = parseSmashrunCsv(body.text, {
      distanceUnit: body.distanceUnit ?? (user.units === 'km' ? 'km' : 'mi'),
      utcOffsetMinutes: (instant) => -instant.getTimezoneOffset(),
    })
    res.status(201).json(await importRows(req.userId, 'smashrun', body.fileName, parsed))
  })

  router.post('/csv', async (req, res) => {
    const body = parse(uploadSchema, req.body)
    res
      .status(201)
      .json(await importRows(req.userId, 'csv', body.fileName, parseGenericCsv(body.text)))
  })

  router.get('/', async (req, res) => {
    const rows = await prisma.importBatch.findMany({
      where: { userId: req.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    res.json(rows.map(toImportBatch))
  })

  return router
}
