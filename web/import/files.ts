import { gunzipSync, Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import type { ImportBatch } from '../../shared/types.ts'
import type { ImportFilesRequest } from '../api/imports.ts'
import { READ_CHUNK_BYTES, readBlobBytes, readSourceChunk, sourceSize } from './blobs.ts'
import type { ByteSource } from './blobs.ts'
import { mergeReport } from './report.ts'

/** The server accepts at most 20 files and 12 MB of base64 per request. */
export const MAX_BATCH_FILES = 20
export const MAX_BATCH_BASE64_CHARS = 12 * 1024 * 1024
/** Archives inside archives inside archives stop here, so a ZIP bomb cannot run away. */
const MAX_DEPTH = 5

export interface FileEntry {
  name: string
  bytes: Uint8Array
}

export interface SkippedEntry {
  name: string
  reason: string
}

export interface UploadProgress {
  /** Files the server has answered for. */
  done: number
  /** Usable files seen so far; keeps growing while archives are still being read. */
  found: number
  /** False once every archive has been read and `found` is final. */
  scanning: boolean
}

export interface UploadSummary {
  /** The server's report for the whole upload, `null` when no file was usable. */
  batch: ImportBatch | null
  skipped: SkippedEntry[]
  sent: number
}

export const UNSUPPORTED_REASON = 'not a FIT, GPX, TCX, ZIP or GZ file'

const ACTIVITY_EXT = /\.(fit|gpx|tcx)$/i
const ARCHIVE_EXT = /\.(zip|gz)$/i
/** A ZIP starts with `PK`, then 3 4 (a local file header) or 5 6 (an empty archive). */
const isZip = (head: Uint8Array) =>
  head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5)
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|\._)/

export function toBase64(bytes: Uint8Array): string {
  const piece = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += piece) {
    binary += String.fromCharCode(...bytes.subarray(i, i + piece))
  }
  return btoa(binary)
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'could not be read'
}

/**
 * Streams the usable entries (activity files and nested archives) out of a ZIP, one chunk at a
 * time, so a multi-gigabyte Garmin export never sits in memory whole. Unreadable archives are
 * listed in `skipped`.
 */
async function* zipEntries(
  source: ByteSource,
  label: string,
  skipped: SkippedEntry[],
): AsyncGenerator<FileEntry> {
  const ready: FileEntry[] = []
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  unzip.onfile = (file) => {
    const name = file.name
    if (name.endsWith('/') || JUNK.test(name)) return
    const path = `${label}/${name}`
    if (!ACTIVITY_EXT.test(name) && !ARCHIVE_EXT.test(name)) {
      skipped.push({ name: path, reason: UNSUPPORTED_REASON })
      return
    }
    // fflate reads stored (0) and deflated (8) entries; starting any other kind throws out of
    // `push` and would end the whole archive, so such an entry is listed and left unread.
    if (file.compression !== 0 && file.compression !== 8) {
      skipped.push({
        name: path,
        reason: `could not be unzipped (compression method ${file.compression})`,
      })
      return
    }
    const chunks: Uint8Array[] = []
    file.ondata = (err, data, final) => {
      if (err) {
        skipped.push({ name: path, reason: `could not be unzipped (${err.message})` })
        return
      }
      chunks.push(data)
      if (final) ready.push({ name: path, bytes: concat(chunks) })
    }
    file.start()
  }
  try {
    const total = sourceSize(source)
    const head = await readSourceChunk(source, 0, Math.min(total, 4))
    if (!isZip(head)) throw new Error('no ZIP header')
    let offset = 0
    do {
      const end = Math.min(total, offset + READ_CHUNK_BYTES)
      unzip.push(await readSourceChunk(source, offset, end), end >= total)
      offset = end
      while (ready.length > 0) yield ready.shift() as FileEntry
    } while (offset < total)
  } catch (error) {
    skipped.push({ name: label, reason: `not a readable ZIP file (${describe(error)})` })
  }
}

/** Expands one entry: activity files pass through, `.gz` is gunzipped, ZIPs are opened. */
async function* expandEntry(
  entry: FileEntry,
  depth: number,
  skipped: SkippedEntry[],
): AsyncGenerator<FileEntry> {
  const { name, bytes } = entry
  if (ACTIVITY_EXT.test(name)) {
    yield entry
  } else if (depth >= MAX_DEPTH) {
    skipped.push({ name, reason: 'nested too deeply' })
  } else if (/\.gz$/i.test(name)) {
    let inner: Uint8Array
    try {
      inner = gunzipSync(bytes)
    } catch (error) {
      skipped.push({ name, reason: `could not be unzipped (${describe(error)})` })
      return
    }
    const innerName = name.replace(/\.gz$/i, '')
    if (!ACTIVITY_EXT.test(innerName) && !ARCHIVE_EXT.test(innerName)) {
      skipped.push({ name, reason: UNSUPPORTED_REASON })
      return
    }
    yield* expandEntry({ name: innerName, bytes: inner }, depth + 1, skipped)
  } else if (/\.zip$/i.test(name)) {
    for await (const inner of zipEntries(bytes, name, skipped)) {
      yield* expandEntry(inner, depth + 1, skipped)
    }
  } else {
    skipped.push({ name, reason: UNSUPPORTED_REASON })
  }
}

/** Every usable activity file in the picked files, however deeply zipped or gzipped. */
export async function* readActivityFiles(
  files: readonly File[],
  skipped: SkippedEntry[],
): AsyncGenerator<FileEntry> {
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      for await (const inner of zipEntries(file, file.name, skipped)) {
        yield* expandEntry(inner, 1, skipped)
      }
    } else {
      yield* expandEntry({ name: file.name, bytes: await readBlobBytes(file) }, 0, skipped)
    }
  }
}

/**
 * Reads the picked files and sends them in requests of at most 20 files and 12 MB of base64.
 * Later requests carry the id of the batch the first one created, so the server keeps one report
 * for the whole upload; the last response is that report.
 */
export async function uploadActivityFiles(
  files: readonly File[],
  send: (request: ImportFilesRequest) => Promise<ImportBatch>,
  opts: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<UploadSummary> {
  const skipped: SkippedEntry[] = []
  let batch: ImportBatch | null = null
  let pending: ImportFilesRequest['files'] = []
  let pendingChars = 0
  let found = 0
  let done = 0
  let scanning = true
  const report = () => opts.onProgress?.({ done, found, scanning })

  async function flush() {
    if (pending.length === 0) return
    const request: ImportFilesRequest = {
      ...(batch ? { batchId: batch.id } : {}),
      files: pending,
    }
    pending = []
    pendingChars = 0
    batch = mergeReport(batch, await send(request))
    done += request.files.length
    report()
  }

  report()
  for await (const entry of readActivityFiles(files, skipped)) {
    if (opts.signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError')
    const dataBase64 = toBase64(entry.bytes)
    if (dataBase64.length > MAX_BATCH_BASE64_CHARS) {
      skipped.push({ name: entry.name, reason: 'larger than 12 MB once encoded' })
      continue
    }
    found++
    if (
      pending.length >= MAX_BATCH_FILES ||
      pendingChars + dataBase64.length > MAX_BATCH_BASE64_CHARS
    ) {
      await flush()
    } else {
      report()
    }
    pending.push({ name: entry.name, dataBase64 })
    pendingChars += dataBase64.length
  }
  scanning = false
  report()
  await flush()
  return { batch, skipped, sent: done }
}
