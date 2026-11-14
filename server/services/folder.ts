import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Gunzip, Unzip, UnzipInflate } from 'fflate'
import type { Deps } from '../app.ts'
import { isInstallOwner } from '../installOwner.ts'
import { loadProfile } from '../serialize.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import type { ImportReportRow, SyncFailure, SyncTrigger } from '../../shared/types.ts'
import { storeParsed } from './activityStore.ts'
import { MAX_FAILURES_STORED, recordSyncRunUnlessIdle, syncMessage } from './syncLog.ts'

const SCANNED = /\.(fit|gpx|tcx|zip|gz)$/i
const ACTIVITY_FILE = /\.(fit|gpx|tcx)$/i
const MAX_DEPTH = 3
/** Larger files (and archive members) are reported and skipped. */
const MAX_FILE_BYTES = 200 * 1024 * 1024
/** The one directory the server reads (F1, decided 2026-11-09); tests inject another through `Deps.folderRoot`. */
export const FOLDER_ROOT = '/import'

/**
 * Data-preparation bounds of one scan, not engine Params. A file that passes a per-file bound is
 * reported as invalid; a bound on the whole scan only defers the rest to the next tick.
 */
export interface FolderLimits {
  /** Bytes one file may unpack to in total, nested archives included: stops a gzip or ZIP bomb. */
  maxUnpackedBytes: number
  /** Entries one ZIP may list: stops an archive of millions of empty members. */
  maxArchiveMembers: number
  /** New top-level files taken per scan and user, so one tick stays short for every user. */
  maxScanFiles: number
  /** A scan stops taking new files once it has taken this many bytes; the last file may pass it. */
  maxScanBytes: number
}

export const FOLDER_LIMITS: FolderLimits = {
  maxUnpackedBytes: 256 * 1024 * 1024,
  maxArchiveMembers: 10_000,
  maxScanFiles: 100,
  maxScanBytes: 512 * 1024 * 1024,
}

/** Compressed bytes fed to a decompressor at once; bounds one step's output to about 1000 times this. */
const FEED_BYTES = 16 * 1024
/** A file changed within this window may still be written by a sync tool; the next scan takes it. */
const SETTLE_MS = 5_000
const MAX_REPORT_ROWS = 100

type Format = 'fit' | 'gpx' | 'tcx'

interface ScanOptions {
  settleMs?: number
  /** Overrides of `FOLDER_LIMITS`, for tests. */
  limits?: Partial<FolderLimits>
}

interface Tally {
  stored: number
  duplicate: number
  invalid: number
  seen: number
  report: ImportReportRow[]
  /** The first failures with the file they belong to, for the sync log. */
  failures: SyncFailure[]
  /** Failures that are not the file's fault (for example a database error); retried next scan. */
  errors: string[]
  batchId: string | null
}

/** The unpacked bytes one top-level file may still produce, shared by every archive inside it. */
interface Budget {
  left: number
  limits: FolderLimits
}

/** An archive that breaks a bound; reported like an unreadable one. */
class ArchiveLimitError extends Error {}

/**
 * The root the server reads, as a real directory path. Every failure (missing, not a directory,
 * unreadable, the root itself a symbolic link) gives the same message, so that nothing tells which
 * paths exist on the host. The root is `Deps.folderRoot` (default `/import`), read at each call.
 */
export async function resolveFolderRoot(deps: Deps): Promise<string> {
  const root = deps.folderRoot ?? FOLDER_ROOT
  try {
    if ((await lstat(root)).isSymbolicLink()) throw new Error('symbolic link')
    const real = await realpath(root)
    if (!(await stat(real)).isDirectory()) throw new Error('not a directory')
    return real
  } catch {
    throw new Error(syncMessage('sync.msg.folder-unreadable', {}))
  }
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

/** Feeds `bytes` to a streaming decompressor in small slices, so that its output arrives in small steps. */
function feed(sink: { push(chunk: Uint8Array, final?: boolean): void }, bytes: Uint8Array): void {
  if (bytes.length === 0) sink.push(bytes, true)
  for (let at = 0; at < bytes.length; at += FEED_BYTES) {
    sink.push(bytes.subarray(at, at + FEED_BYTES), at + FEED_BYTES >= bytes.length)
  }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** An archive that is not a whole, readable gzip or ZIP file (`unzipSync` and `gunzipSync` refused these). */
class UnreadableArchiveError extends Error {}

const EOCD_SIGNATURE = 0x06054b50
const EOCD_MIN_BYTES = 22
/** The end record may be followed by a comment of up to 65,535 bytes. */
const EOCD_SEARCH_BYTES = EOCD_MIN_BYTES + 65_535

/**
 * Whether a ZIP ends with an end-of-central-directory record that points at a central directory
 * inside the file. The streaming reader never looks at it, so a ZIP cut before its end would
 * otherwise import the members that came before the cut.
 */
function hasCentralDirectory(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lowest = Math.max(0, bytes.length - EOCD_SEARCH_BYTES)
  for (let at = bytes.length - EOCD_MIN_BYTES; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue
    const size = view.getUint32(at + 12, true)
    const offset = view.getUint32(at + 16, true)
    // 0xFFFFFFFF marks a ZIP64 value kept in the ZIP64 record.
    return size === 0xffffffff || offset === 0xffffffff || offset + size <= at
  }
  return false
}

/** Takes `n` unpacked bytes from the budget; throws once the file has unpacked past its bound. */
function spend(budget: Budget, n: number): void {
  budget.left -= n
  if (budget.left < 0) {
    const mb = Math.round(budget.limits.maxUnpackedBytes / (1024 * 1024))
    throw new ArchiveLimitError(`unpacks to more than ${String(mb)} MB`)
  }
}

/**
 * The files inside a ZIP or gzip; a plain activity file is its own single entry. Unpacking is
 * streamed and stops as soon as the unpacked bytes pass the budget or a member passes
 * `MAX_FILE_BYTES`, whatever the archive's headers declare.
 */
function expand(
  name: string,
  bytes: Uint8Array,
  budget: Budget,
): Array<{ name: string; bytes: Uint8Array }> | null {
  if (/\.gz$/i.test(name)) {
    if (bytes.length === 0) throw new UnreadableArchiveError('empty gzip file')
    const chunks: Uint8Array[] = []
    let size = 0
    const gunzip = new Gunzip((chunk) => {
      spend(budget, chunk.length)
      size += chunk.length
      if (size > MAX_FILE_BYTES) throw new ArchiveLimitError('a file inside is larger than 200 MB')
      chunks.push(chunk)
    })
    feed(gunzip, bytes)
    // The last four bytes are the unpacked size (mod 2^32): a file cut inside its trailer fails this.
    const trailer = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.length < 18 || trailer.getUint32(bytes.length - 4, true) !== size % 2 ** 32) {
      throw new UnreadableArchiveError('gzip file is cut short')
    }
    return [{ name: name.replace(/\.gz$/i, ''), bytes: concat(chunks, size) }]
  }
  if (/\.zip$/i.test(name)) {
    const members: Array<{ name: string; bytes: Uint8Array }> = []
    let listed = 0
    const unzip = new Unzip((file) => {
      listed += 1
      if (listed > budget.limits.maxArchiveMembers) {
        throw new ArchiveLimitError(
          `more than ${String(budget.limits.maxArchiveMembers)} files inside`,
        )
      }
      if (
        file.name.endsWith('/') ||
        baseName(file.name).startsWith('.') ||
        !SCANNED.test(file.name) ||
        (file.originalSize ?? 0) > MAX_FILE_BYTES
      ) {
        return
      }
      const chunks: Uint8Array[] = []
      let size = 0
      file.ondata = (error, chunk, final) => {
        if (error) throw error
        spend(budget, chunk.length)
        size += chunk.length
        if (size > MAX_FILE_BYTES) {
          throw new ArchiveLimitError('a file inside is larger than 200 MB')
        }
        chunks.push(chunk)
        if (final) members.push({ name: baseName(file.name), bytes: concat(chunks, size) })
      }
      file.start()
    })
    unzip.register(UnzipInflate)
    feed(unzip, bytes)
    if (listed === 0 || !hasCentralDirectory(bytes)) {
      throw new UnreadableArchiveError('not a readable ZIP file')
    }
    return members
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

/** Adds a line to the import report; `counted` failures also go to the sync log's failure list. */
function note(tally: Tally, name: string, reason: string, counted = true): void {
  if (tally.report.length < MAX_REPORT_ROWS) {
    tally.report.push({ line: null, reason: `${baseName(name)}: ${reason}` })
  }
  if (counted && tally.failures.length < MAX_FAILURES_STORED) {
    tally.failures.push({ ref: baseName(name), reason })
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
  budget: Budget,
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
    // A bound broken anywhere below makes the top-level archive invalid, not only the member.
    const invalidArchive = async (error: unknown): Promise<null> => {
      tally.invalid += 1
      note(tally, name, error instanceof Error ? error.message : 'unreadable archive')
      await recordFile(deps, userId, sha, name, 'invalid', null)
      return null
    }
    let members: ReturnType<typeof expand>
    try {
      members = expand(name, bytes, budget)
    } catch (error) {
      if (depth > 0 && error instanceof ArchiveLimitError) throw error
      return invalidArchive(error)
    }
    let first: string | null = null
    let stored = 0
    try {
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
          budget,
        )
        if (id !== null) {
          first ??= id
          stored += 1
        }
      }
    } catch (error) {
      if (depth === 0 && error instanceof ArchiveLimitError) return invalidArchive(error)
      throw error
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
    note(
      tally,
      name,
      error instanceof Error ? error.message : syncMessage('sync.msg.file-unreadable', {}),
    )
    await recordFile(deps, userId, sha, name, 'invalid', null)
    return null
  }
  if (activities.length === 0) {
    await recordFile(deps, userId, sha, name, 'no-activity', null)
    return null
  }
  const importBatchId = await ensureBatch(deps, userId, tally, path)
  let first: string | null = null
  let imported = false
  for (const parsed of activities) {
    const result = await storeParsed(deps, userId, parsed, {
      source: 'file',
      importBatchId,
      channel: 'folder',
      file: { name: baseName(name), format, bytes },
    })
    if (result.outcome === 'duplicate') tally.duplicate += 1
    else {
      tally.stored += 1
      imported = true
    }
    first ??= result.activityId
  }
  await recordFile(deps, userId, sha, name, imported ? 'imported' : 'duplicate', first)
  return first
}

/**
 * Imports the files in `path` (the resolved root) that `ImportedFile` has not seen and returns what the scan found,
 * including the failures that are not a file's fault. Throws only when the folder cannot be read.
 * The folder is read-only to the app. FIT, GPX and TCX files are read directly, `.gz` and
 * `.zip` files are opened (archives inside archives too, to a depth of three), and a file is remembered by the SHA-256 of its
 * bytes, so a moved or renamed copy is not imported twice. Files changed in the last few seconds
 * are left for the next scan, in case a sync tool is still writing them. One batch (source
 * `folder`) is recorded per scan that touched at least one new activity file. A scan takes at most
 * `maxScanFiles` new files and `maxScanBytes` bytes of them per user; the rest wait for the next
 * scan and nothing is lost.
 */
async function scan(deps: Deps, userId: string, path: string, opts: ScanOptions): Promise<Tally> {
  const limits = { ...FOLDER_LIMITS, ...opts.limits }
  const { timezone } = await loadProfile(deps.prisma, userId)
  const settleMs = opts.settleMs ?? SETTLE_MS
  const tally: Tally = {
    stored: 0,
    duplicate: 0,
    invalid: 0,
    seen: 0,
    report: [],
    failures: [],
    errors: [],
    batchId: null,
  }

  let takenFiles = 0
  let takenBytes = 0
  for await (const file of walk(path, 0)) {
    if (takenFiles >= limits.maxScanFiles || takenBytes >= limits.maxScanBytes) break
    try {
      const details = await stat(file)
      if (details.size > MAX_FILE_BYTES) {
        note(tally, file, 'larger than 200 MB, skipped', false)
        continue
      }
      if (Date.now() - details.mtimeMs < settleMs) continue
      const bytes = new Uint8Array(await readFile(file))
      const seenBefore = tally.seen
      await ingest(deps, userId, path, file, bytes, timezone, tally, 0, {
        left: limits.maxUnpackedBytes,
        limits,
      })
      // Only a file `ImportedFile` had not seen counts toward the bounds of the scan.
      if (tally.seen > seenBefore) {
        takenFiles += 1
        takenBytes += bytes.length
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      tally.errors.push(`${baseName(file)}: ${reason}`)
      if (tally.failures.length < MAX_FAILURES_STORED) {
        tally.failures.push({ ref: baseName(file), reason })
      }
    }
  }

  if (tally.batchId !== null || tally.invalid > 0) {
    const batchId = tally.batchId ?? (await ensureBatch(deps, userId, tally, path))
    await deps.prisma.importBatch.update({
      where: { id: batchId, userId },
      data: {
        rowCount: tally.stored + tally.duplicate + tally.invalid,
        accepted: tally.stored,
        skippedDuplicate: tally.duplicate,
        skippedInvalid: tally.invalid,
        errors: JSON.stringify(tally.report),
      },
    })
  }
  return tally
}

function failedError(tally: Tally): Error | null {
  const [first] = tally.errors
  if (first === undefined) return null
  return new Error(
    tally.errors.length === 1
      ? syncMessage('sync.msg.files.one', { reason: first })
      : syncMessage('sync.msg.files.many', {
          n: { kind: 'count', n: tally.errors.length },
          reason: first,
        }),
  )
}

/**
 * Imports the files in the root (`Deps.folderRoot`, default `/import`) that `ImportedFile` has not
 * seen; returns how many activities were stored (see `scan`).
 *
 * Throws when the root cannot be read, or, after finishing the rest, when a file failed for a
 * reason that is not its content (such as a database error).
 */
export async function scanFolder(
  deps: Deps,
  userId: string,
  opts: ScanOptions = {},
): Promise<number> {
  const tally = await scan(deps, userId, await resolveFolderRoot(deps), opts)
  const failure = failedError(tally)
  if (failure) throw failure
  return tally.stored
}

/**
 * Scans the import root for a user's `folder` integration, records the outcome on the row and writes
 * one `SyncRun`, except for a scheduled scan that found nothing while the last run ended ok (see
 * `recordSyncRunUnlessIdle`). Does nothing when the integration is missing or the user is not the
 * install owner (F1); the path an older row stored is ignored. Returns the number of activities
 * stored.
 */
export async function scanFolderIntegration(
  deps: Deps,
  userId: string,
  opts: { trigger?: Extract<SyncTrigger, 'schedule' | 'manual'> } = {},
): Promise<number> {
  const { prisma } = deps
  const row = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'folder' } },
  })
  if (!row || !(await isInstallOwner(prisma, userId))) return 0

  const startedAt = new Date()
  let tally: Tally | null = null
  let failure: Error | null = null
  try {
    tally = await scan(deps, userId, await resolveFolderRoot(deps), {})
    failure = failedError(tally)
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  }

  await prisma.integration.updateMany({
    where: { id: row.id, userId },
    data:
      failure === null
        ? { status: 'connected', lastSyncAt: new Date(), lastSyncStatus: 'ok', lastError: null }
        : {
            status: 'error',
            lastSyncAt: new Date(),
            lastSyncStatus: 'error',
            lastError: failure.message,
          },
  })
  await recordSyncRunUnlessIdle(deps, {
    userId,
    provider: 'folder',
    channel: 'folder',
    trigger: opts.trigger ?? 'schedule',
    startedAt,
    status: failure !== null ? 'error' : tally && tally.invalid > 0 ? 'partial' : 'ok',
    accepted: tally?.stored ?? 0,
    duplicate: tally?.duplicate ?? 0,
    failed: (tally?.invalid ?? 0) + (tally?.errors.length ?? 0),
    message: failure,
    failures: tally?.failures ?? [],
    importBatchId: tally?.batchId ?? null,
  })
  if (failure) throw failure
  return tally?.stored ?? 0
}
