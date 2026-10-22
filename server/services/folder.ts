import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, unzipSync } from 'fflate'
import type { Deps } from '../app.ts'
import { loadProfile } from '../serialize.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import type { ImportReportRow } from '../../shared/types.ts'
import { storeParsed } from './activityStore.ts'

const SCANNED = /\.(fit|gpx|tcx|zip|gz)$/i
const ACTIVITY_FILE = /\.(fit|gpx|tcx)$/i
const MAX_DEPTH = 3
/** Larger files (and archive members) are reported and skipped. */
const MAX_FILE_BYTES = 200 * 1024 * 1024
/** A file changed within this window may still be written by a sync tool; the next scan takes it. */
const SETTLE_MS = 5_000
const MAX_REPORT_ROWS = 100

type Format = 'fit' | 'gpx' | 'tcx'

interface Tally {
  stored: number
  duplicate: number
  invalid: number
  seen: number
  report: ImportReportRow[]
  /** Failures that are not the file's fault (for example a database error); retried next scan. */
  errors: string[]
  batchId: string | null
}

function formatOf(name: string): Format | null {
  const match = ACTIVITY_FILE.exec(name)
  return match ? (match[1]?.toLowerCase() as Format) : null
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

async function* walk(dir: string, depth: number): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) yield* walk(full, depth + 1)
    } else if (entry.isFile() && SCANNED.test(entry.name)) {
      yield full
    }
  }
}

/** The files inside a ZIP or gzip; a plain activity file is its own single entry. */
function expand(
  name: string,
  bytes: Uint8Array,
): Array<{ name: string; bytes: Uint8Array }> | null {
  if (/\.gz$/i.test(name)) {
    return [{ name: name.replace(/\.gz$/i, ''), bytes: gunzipSync(bytes) }]
  }
  if (/\.zip$/i.test(name)) {
    const files = unzipSync(bytes, {
      filter: (file) =>
        !file.name.endsWith('/') &&
        !baseName(file.name).startsWith('.') &&
        SCANNED.test(file.name) &&
        file.originalSize <= MAX_FILE_BYTES,
    })
    return Object.entries(files).map(([entryName, data]) => ({
      name: baseName(entryName),
      bytes: data,
    }))
  }
  return null
}

async function recordFile(
  deps: Deps,
  userId: string,
  sha: string,
  name: string,
  outcome: 'imported' | 'duplicate' | 'no-activity' | 'invalid',
  activityId: string | null,
): Promise<void> {
  // The activity store already wrote the row of a stored file; this only fills in the others.
  await deps.prisma.importedFile.upsert({
    where: { userId_sha256: { userId, sha256: sha } },
    create: {
      userId,
      sha256: sha,
      fileName: baseName(name),
      channel: 'folder',
      outcome,
      activityId,
    },
    update: {},
  })
}

function note(tally: Tally, name: string, reason: string): void {
  if (tally.report.length < MAX_REPORT_ROWS) {
    tally.report.push({ line: null, reason: `${baseName(name)}: ${reason}` })
  }
}

async function ensureBatch(
  deps: Deps,
  userId: string,
  tally: Tally,
  path: string,
): Promise<string> {
  if (tally.batchId === null) {
    const created = await deps.prisma.importBatch.create({
      data: {
        userId,
        source: 'folder',
        fileName: baseName(path).slice(0, 200) || null,
        rowCount: 0,
        accepted: 0,
        skippedDuplicate: 0,
        skippedInvalid: 0,
        errors: '[]',
      },
    })
    tally.batchId = created.id
  }
  return tally.batchId
}

/**
 * Imports one file or archive member that `ImportedFile` has not seen. Returns the id of the first
 * activity it stored, or null.
 */
async function ingest(
  deps: Deps,
  userId: string,
  path: string,
  name: string,
  bytes: Uint8Array,
  timezone: string,
  tally: Tally,
  depth: number,
): Promise<string | null> {
  const sha = sha256(bytes)
  const known = await deps.prisma.importedFile.findUnique({
    where: { userId_sha256: { userId, sha256: sha } },
  })
  if (known) return null
  tally.seen += 1

  const format = formatOf(name)
  if (format === null) {
    if (depth > 2) {
      await recordFile(deps, userId, sha, name, 'invalid', null)
      return null
    }
    let members: ReturnType<typeof expand>
    try {
      members = expand(name, bytes)
    } catch (error) {
      tally.invalid += 1
      note(tally, name, error instanceof Error ? error.message : 'unreadable archive')
      await recordFile(deps, userId, sha, name, 'invalid', null)
      return null
    }
    let first: string | null = null
    let stored = 0
    for (const member of members ?? []) {
      if (member.bytes.length > MAX_FILE_BYTES) continue
      const id = await ingest(
        deps,
        userId,
        path,
        member.name,
        member.bytes,
        timezone,
        tally,
        depth + 1,
      )
      if (id !== null) {
        first ??= id
        stored += 1
      }
    }
    await recordFile(deps, userId, sha, name, stored > 0 ? 'imported' : 'no-activity', first)
    return first
  }

  let activities: ReturnType<typeof parseActivityFile>
  try {
    activities = parseActivityFile(name, bytes, { timezone })
  } catch (error) {
    // Whatever the parser throws, the content is the problem: the file is remembered as invalid.
    tally.invalid += 1
    note(tally, name, error instanceof Error ? error.message : 'unreadable file')
    await recordFile(deps, userId, sha, name, 'invalid', null)
    return null
  }
  if (activities.length === 0) {
    await recordFile(deps, userId, sha, name, 'no-activity', null)
    return null
  }
  const importBatchId = await ensureBatch(deps, userId, tally, path)
  let first: string | null = null
  for (const parsed of activities) {
    const result = await storeParsed(deps, userId, parsed, {
      source: 'file',
      importBatchId,
      channel: 'folder',
      file: { name: baseName(name), format, bytes },
    })
    if (result.outcome === 'duplicate') tally.duplicate += 1
    else tally.stored += 1
    first ??= result.activityId
  }
  await recordFile(deps, userId, sha, name, first === null ? 'duplicate' : 'imported', first)
  return first
}

/**
 * Imports the files in `path` that `ImportedFile` has not seen; returns how many activities were
 * stored. The folder is read-only to the app. FIT, GPX and TCX files are read directly, `.gz` and
 * `.zip` files are opened (archives inside archives too, to a depth of three), and a file is remembered by the SHA-256 of its
 * bytes, so a moved or renamed copy is not imported twice. Files changed in the last few seconds
 * are left for the next scan, in case a sync tool is still writing them. One batch (source
 * `folder`) is recorded per scan that touched at least one new activity file.
 *
 * Throws when the folder cannot be read, or, after finishing the rest, when a file failed for a
 * reason that is not its content (such as a database error).
 */
export async function scanFolder(
  deps: Deps,
  userId: string,
  path: string,
  opts: { settleMs?: number } = {},
): Promise<number> {
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory())
    throw new Error(`The watched folder is not a readable directory: ${path}`)
  const { timezone } = await loadProfile(deps.prisma, userId)
  const settleMs = opts.settleMs ?? SETTLE_MS
  const tally: Tally = {
    stored: 0,
    duplicate: 0,
    invalid: 0,
    seen: 0,
    report: [],
    errors: [],
    batchId: null,
  }

  for await (const file of walk(path, 0)) {
    try {
      const details = await stat(file)
      if (details.size > MAX_FILE_BYTES) {
        note(tally, file, 'larger than 200 MB, skipped')
        continue
      }
      if (Date.now() - details.mtimeMs < settleMs) continue
      const bytes = new Uint8Array(await readFile(file))
      await ingest(deps, userId, path, file, bytes, timezone, tally, 0)
    } catch (error) {
      tally.errors.push(
        `${baseName(file)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (tally.batchId !== null || tally.invalid > 0) {
    const batchId = tally.batchId ?? (await ensureBatch(deps, userId, tally, path))
    await deps.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        rowCount: tally.stored + tally.duplicate + tally.invalid,
        accepted: tally.stored,
        skippedDuplicate: tally.duplicate,
        skippedInvalid: tally.invalid,
        errors: JSON.stringify(tally.report),
      },
    })
  }
  if (tally.errors.length > 0) {
    throw new Error(`${tally.errors.length} file(s) failed: ${tally.errors[0]}`)
  }
  return tally.stored
}

/**
 * Scans the folder of a user's `folder` integration and records the outcome on the row. Does
 * nothing when the integration is missing; returns the number of activities stored.
 */
export async function scanFolderIntegration(deps: Deps, userId: string): Promise<number> {
  const { prisma } = deps
  const row = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'folder' } },
  })
  if (!row) return 0
  let path = ''
  try {
    const config: unknown = JSON.parse(row.config)
    if (typeof config === 'object' && config !== null && 'path' in config) {
      path = typeof config.path === 'string' ? config.path : ''
    }
  } catch {
    // An unreadable config is reported below like a missing path.
  }
  try {
    if (path === '') throw new Error('No folder is configured.')
    const stored = await scanFolder(deps, userId, path)
    await prisma.integration.updateMany({
      where: { id: row.id },
      data: { status: 'connected', lastSyncAt: new Date(), lastSyncStatus: 'ok', lastError: null },
    })
    return stored
  } catch (error) {
    await prisma.integration.updateMany({
      where: { id: row.id },
      data: {
        status: 'error',
        lastSyncAt: new Date(),
        lastSyncStatus: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}
