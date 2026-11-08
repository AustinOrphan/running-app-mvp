// A streaming ZIP writer (PKZIP appnote 6.3: local headers, data descriptors, central directory).
// It exists so the full-data export (`exportArchive.ts`) can send an archive of any length with
// memory bounded by one chunk, and so no dependency is added for it. `zlib` gives the raw deflate
// and the CRC-32.
//
// Each entry is written with general-purpose flag bit 3: the CRC and sizes are not known when the
// header goes out, so they follow the data in a data descriptor and are repeated in the central
// directory at the end. Names are UTF-8 (flag bit 11). Not supported, and refused by a thrown
// `ZipLimitError` rather than written wrongly: ZIP64, that is an archive, an entry or an entry
// count past the 32-bit and 16-bit fields.
import { Readable, pipeline } from 'node:stream'
import { crc32, createDeflateRaw, deflateRawSync } from 'node:zlib'

/** The largest single buffer that is deflated in one synchronous call. */
const WHOLE_ENTRY_MAX = 8 * 1024 * 1024

export type ZipMethod = 'deflate' | 'store'

export interface ZipEntry {
  /** The path inside the archive: forward slashes, relative, no `..` segment. */
  name: string
  /** The bytes, whole or in chunks. A chunked source is read once, as it is written. */
  data: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>
  /** Defaults to `deflate`. */
  method?: ZipMethod
  /** Stored as the entry's modification time (UTC fields); defaults to the archive's. */
  modified?: Date
}

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipLimitError'
  }
}

const LOCAL_SIGNATURE = 0x04034b50
const DESCRIPTOR_SIGNATURE = 0x08074b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const VERSION_NEEDED = 20
/** Bit 3: sizes and CRC follow the data. Bit 11: the name is UTF-8. */
const FLAGS = 0x0808
const MAX_32 = 0xffffffff
const MAX_ENTRIES = 0xffff

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107)
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

function checkName(name: string): Buffer {
  const bytes = Buffer.from(name, 'utf8')
  if (
    name === '' ||
    bytes.length > 0xffff ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.split('/').some((part) => part === '..')
  ) {
    throw new Error(`Not a valid ZIP entry name: ${JSON.stringify(name)}`)
  }
  return bytes
}

async function* chunksOf(data: ZipEntry['data']): AsyncGenerator<Uint8Array, void, undefined> {
  if (data instanceof Uint8Array) {
    yield data
    return
  }
  yield* data
}

interface Finished {
  crc: number
  compressedSize: number
  size: number
}

/**
 * Writes one entry's data and returns its CRC and sizes through `done`. A generator cannot return
 * a value to a `for await` consumer, so the tally lives in the object the caller passes in.
 */
async function* entryData(
  entry: ZipEntry,
  done: Finished,
): AsyncGenerator<Buffer, void, undefined> {
  const state = { crc: 0, size: 0 }
  async function* counted(): AsyncGenerator<Buffer, void, undefined> {
    for await (const chunk of chunksOf(entry.data)) {
      const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      state.crc = crc32(buffer, state.crc)
      state.size += buffer.length
      yield buffer
    }
  }
  if ((entry.method ?? 'deflate') === 'store') {
    for await (const chunk of counted()) {
      done.compressedSize += chunk.length
      yield chunk
    }
  } else if (entry.data instanceof Uint8Array && entry.data.length <= WHOLE_ENTRY_MAX) {
    // One buffer already in memory: the synchronous call frees its native zlib state at once. A
    // stream per entry holds about 250 KB of native memory until the garbage collector gets to its
    // wrapper, and an archive of thousands of original files would pile that up.
    for await (const chunk of counted()) {
      const packed = deflateRawSync(chunk)
      done.compressedSize += packed.length
      yield packed
    }
  } else {
    const deflate = createDeflateRaw()
    // `pipeline` forwards a failure of the source to `deflate`, so the loop below throws it.
    pipeline(Readable.from(counted()), deflate, () => {})
    try {
      for await (const chunk of deflate as AsyncIterable<Buffer>) {
        done.compressedSize += chunk.length
        yield chunk
      }
    } finally {
      deflate.destroy()
    }
  }
  done.crc = state.crc
  done.size = state.size
}

function localHeader(name: Buffer, method: number, time: number, day: number): Buffer {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(LOCAL_SIGNATURE, 0)
  header.writeUInt16LE(VERSION_NEEDED, 4)
  header.writeUInt16LE(FLAGS, 6)
  header.writeUInt16LE(method, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(day, 12)
  // CRC and both sizes stay zero: the data descriptor carries them.
  header.writeUInt16LE(name.length, 26)
  return Buffer.concat([header, name])
}

function descriptor(done: Finished): Buffer {
  const out = Buffer.alloc(16)
  out.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0)
  out.writeUInt32LE(done.crc, 4)
  out.writeUInt32LE(done.compressedSize, 8)
  out.writeUInt32LE(done.size, 12)
  return out
}

interface CentralRecord {
  name: Buffer
  method: number
  time: number
  day: number
  done: Finished
  offset: number
}

function centralHeader(record: CentralRecord): Buffer {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0)
  header.writeUInt16LE(VERSION_NEEDED, 4)
  header.writeUInt16LE(VERSION_NEEDED, 6)
  header.writeUInt16LE(FLAGS, 8)
  header.writeUInt16LE(record.method, 10)
  header.writeUInt16LE(record.time, 12)
  header.writeUInt16LE(record.day, 14)
  header.writeUInt32LE(record.done.crc, 16)
  header.writeUInt32LE(record.done.compressedSize, 20)
  header.writeUInt32LE(record.done.size, 24)
  header.writeUInt16LE(record.name.length, 28)
  header.writeUInt32LE(record.offset, 42)
  return Buffer.concat([header, record.name])
}

/**
 * The archive as a stream of buffers. `entries` may be a lazy source: an entry is pulled only when
 * the one before it has been written, so the work of building an entry (a database page, a file
 * read) happens as the consumer drains the stream. An error thrown by an entry's data ends the
 * stream with that error; a consumer that stops early abandons the rest.
 */
export async function* zipStream(
  entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>,
  options: { modified?: Date } = {},
): AsyncGenerator<Buffer, void, undefined> {
  const archiveTime = options.modified ?? new Date()
  const records: CentralRecord[] = []
  const seen = new Set<string>()
  let offset = 0

  function advance(bytes: number): void {
    offset += bytes
    if (offset > MAX_32) throw new ZipLimitError('The archive is larger than 4 GiB.')
  }

  for await (const entry of entries) {
    if (records.length >= MAX_ENTRIES) throw new ZipLimitError('The archive has too many entries.')
    const name = checkName(entry.name)
    if (seen.has(entry.name)) throw new Error(`Duplicate ZIP entry name: ${entry.name}`)
    seen.add(entry.name)
    const method = (entry.method ?? 'deflate') === 'store' ? 0 : 8
    const { time, day } = dosDateTime(entry.modified ?? archiveTime)
    const start = offset
    const header = localHeader(name, method, time, day)
    advance(header.length)
    yield header

    const done: Finished = { crc: 0, compressedSize: 0, size: 0 }
    for await (const chunk of entryData(entry, done)) {
      advance(chunk.length)
      yield chunk
    }
    if (done.size > MAX_32) throw new ZipLimitError(`${entry.name} is larger than 4 GiB.`)
    const tail = descriptor(done)
    advance(tail.length)
    yield tail
    records.push({ name, method, time, day, done, offset: start })
  }

  const centralStart = offset
  for (const record of records) {
    const header = centralHeader(record)
    advance(header.length)
    yield header
  }
  const centralSize = offset - centralStart
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_SIGNATURE, 0)
  end.writeUInt16LE(records.length, 8)
  end.writeUInt16LE(records.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralStart, 16)
  yield end
}
