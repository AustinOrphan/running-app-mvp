import { Router } from 'express'
import { z } from 'zod'
import { parseGenericCsv } from '../../shared/importers/generic.ts'
import { parseSmashrunCsv } from '../../shared/importers/smashrun.ts'
import type { ImportRow, RowError } from '../../shared/importers/csv.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { offsetMinFor } from '../../shared/importers/files/summarize.ts'
import type { ActivitySource, ImportReportRow, ParsedActivity } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { notFound, parse, validationError } from '../errors.ts'
import { parsedActivitySchema, wellnessInputSchema } from '../parsedSchemas.ts'
import { PROVIDERS } from '../providers/registry.ts'
import { loadProfile, toImportBatch } from '../serialize.ts'
import { storeParsed, storeWellness } from '../services/activityStore.ts'
import { markDuplicates } from '../services/duplicates.ts'
import { assessSessionsQuietly } from '../services/execution.ts'

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

const MAX_FILES = 20
const MAX_PARSED_ACTIVITIES = 500
const MAX_PARSED_WELLNESS = 500
/** A batch accepts appended files for this long after it was created. */
const APPEND_WINDOW_MS = 3_600_000
const BASE64 = /^[A-Za-z0-9+/\r\n]*={0,2}$/
const FILE_EXTENSION = /\.(fit|gpx|tcx)$/i

const filesSchema = z.strictObject({
  batchId: z.string().min(1).max(64).optional(),
  files: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(255),
        dataBase64: z.string(),
      }),
    )
    .min(1)
    .max(MAX_FILES),
})

const parsedSchema = z.strictObject({
  batchId: z.string().min(1).max(64).optional(),
  source: z.string().min(1).max(40),
  activities: z.array(parsedActivitySchema).max(MAX_PARSED_ACTIVITIES),
  wellness: z.array(wellnessInputSchema).max(MAX_PARSED_WELLNESS),
})

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

/** Decoded bytes of a base64 string; throws on characters outside the alphabet. */
function decodeBase64(text: string): Uint8Array {
  if (!BASE64.test(text)) throw new RangeError('the file is not valid base64')
  return new Uint8Array(Buffer.from(text, 'base64'))
}

function errorMessage(error: unknown): string {
  return (error instanceof Error && error.message ? error.message : 'unreadable file').slice(0, 300)
}

/** Running totals of one batch, written back when the request ends. */
interface Tally {
  rowCount: number
  accepted: number
  skippedDuplicate: number
  skippedInvalid: number
  report: ImportReportRow[]
}

export function importsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  /**
   * The batch a request writes to: a new one, or (with `batchId`) the user's own batch of the
   * same source that is under an hour old.
   */
  async function openBatch(
    userId: string,
    source: string,
    fileName: string | null,
    batchId: string | undefined,
  ): Promise<{ id: string; tally: Tally }> {
    if (batchId === undefined) {
      const created = await prisma.importBatch.create({
        data: {
          userId,
          source,
          fileName,
          rowCount: 0,
          accepted: 0,
          skippedDuplicate: 0,
          skippedInvalid: 0,
          errors: '[]',
        },
      })
      return {
        id: created.id,
        tally: { rowCount: 0, accepted: 0, skippedDuplicate: 0, skippedInvalid: 0, report: [] },
      }
    }
    const row = await prisma.importBatch.findFirst({
      where: {
        id: batchId,
        userId,
        source,
        createdAt: { gte: new Date(Date.now() - APPEND_WINDOW_MS) },
      },
    })
    if (!row) throw notFound('Import batch not found.')
    const batch = toImportBatch(row)
    return {
      id: batch.id,
      tally: {
        rowCount: batch.rowCount,
        accepted: batch.accepted,
        skippedDuplicate: batch.skippedDuplicate,
        skippedInvalid: batch.skippedInvalid,
        report: batch.errors,
      },
    }
  }

  async function closeBatch(userId: string, id: string, tally: Tally) {
    const row = await prisma.importBatch.update({
      where: { id, userId },
      data: {
        rowCount: tally.rowCount,
        accepted: tally.accepted,
        skippedDuplicate: tally.skippedDuplicate,
        skippedInvalid: tally.skippedInvalid,
        errors: JSON.stringify(tally.report),
      },
    })
    return toImportBatch(row)
  }

  async function importRows(
    userId: string,
    today: string,
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

    const moved: string[] = []
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
            (ids) => {
              moved.push(...ids)
              return Promise.resolve()
            },
          )
        }
        return created
      },
      { timeout: 60_000 },
    )
    // Sessions handed from a confirmed copy to its original are assessed once the import is saved.
    await assessSessionsQuietly(deps, { userId, sessionIds: moved, today })

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
      // The runner's zone (`req.runnerDay.tz`, `runnerZone` of the stored one) puts a UTC-only
      // `startDateUtc` on the runner's local day and time. No `startUtc` is written here, and a
      // re-import skips an existing providerKey, so no stored run is re-dated.
      utcOffsetMinutes: (instant) => offsetMinFor(instant.toISOString(), req.runnerDay.tz) ?? 0,
    })
    res
      .status(201)
      .json(await importRows(req.userId, req.runnerDay.today, 'smashrun', body.fileName, parsed))
  })

  router.post('/csv', async (req, res) => {
    const body = parse(uploadSchema, req.body)
    res
      .status(201)
      .json(
        await importRows(
          req.userId,
          req.runnerDay.today,
          'csv',
          body.fileName,
          parseGenericCsv(body.text),
        ),
      )
  })

  router.post('/files', async (req, res) => {
    const body = parse(filesSchema, req.body)
    const { timezone } = await loadProfile(prisma, req.userId)
    const [only] = body.files
    const label =
      body.files.length === 1 && only ? baseName(only.name) : `${body.files.length} files`
    const batch = await openBatch(req.userId, 'file', label, body.batchId)
    const { tally } = batch

    try {
      for (const file of body.files) {
        const name = baseName(file.name)
        let format: 'fit' | 'gpx' | 'tcx'
        let bytes: Uint8Array
        let activities: ParsedActivity[]
        try {
          format = (FILE_EXTENSION.exec(name)?.[1]?.toLowerCase() ?? '') as typeof format
          bytes = decodeBase64(file.dataBase64)
          activities = parseActivityFile(name, bytes, { timezone })
          if (activities.length === 0) throw new RangeError('the file holds no activity')
        } catch (error) {
          tally.rowCount += 1
          tally.skippedInvalid += 1
          tally.report.push({ line: null, reason: `${name}: ${errorMessage(error)}` })
          continue
        }

        for (const parsed of activities) {
          tally.rowCount += 1
          const result = await storeParsed(deps, req.userId, parsed, {
            source: 'file',
            importBatchId: batch.id,
            file: { name, format, bytes },
            channel: 'upload',
            today: req.runnerDay.today,
          })
          if (result.outcome === 'duplicate') {
            tally.skippedDuplicate += 1
            tally.report.push({ line: null, reason: `${name}: already imported` })
          } else {
            tally.accepted += 1
            if (result.outcome === 'updated') {
              tally.report.push({
                line: null,
                reason: `${name}: updated an activity already imported`,
              })
            }
          }
        }
      }
    } catch (error) {
      await closeBatch(req.userId, batch.id, tally)
      throw error
    }
    res.status(201).json(await closeBatch(req.userId, batch.id, tally))
  })

  router.post('/parsed', async (req, res) => {
    const body = parse(parsedSchema, req.body)
    if (!Object.hasOwn(PROVIDERS, body.source)) {
      throw validationError('Some fields need attention.', [
        { path: 'source', message: `Unknown source: ${body.source}` },
      ])
    }
    const batch = await openBatch(req.userId, body.source, null, body.batchId)
    const { tally } = batch

    try {
      for (const parsed of body.activities) {
        tally.rowCount += 1
        const result = await storeParsed(deps, req.userId, parsed, {
          source: body.source,
          importBatchId: batch.id,
          channel: 'upload',
          today: req.runnerDay.today,
        })
        if (result.outcome === 'duplicate') {
          tally.skippedDuplicate += 1
          tally.report.push({ line: null, reason: `already imported (${parsed.providerKey})` })
        } else {
          tally.accepted += 1
        }
      }
      if (body.wellness.length > 0) {
        const written = await storeWellness(deps, req.userId, body.wellness, body.source)
        const unchanged = body.wellness.length - written
        tally.rowCount += body.wellness.length
        tally.accepted += written
        tally.skippedDuplicate += unchanged
        if (unchanged > 0) {
          tally.report.push({
            line: null,
            reason: `${unchanged} wellness day${unchanged === 1 ? '' : 's'} had nothing new`,
          })
        }
      }
    } catch (error) {
      await closeBatch(req.userId, batch.id, tally)
      throw error
    }
    res.status(201).json(await closeBatch(req.userId, batch.id, tally))
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
