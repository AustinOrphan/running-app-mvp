import { crc32, inflateRawSync } from 'node:zlib'

export interface VerifiedEntry {
  name: string
  method: number
  data: Buffer
}

/**
 * Reads an archive by hand, from the central directory, and checks every entry end to end: the
 * local header names the same entry, the descriptor repeats the central directory's CRC and
 * sizes, the data inflates to the recorded size, and its CRC-32 recomputed here equals the
 * recorded one. Throws on the first mismatch.
 */
export function verifyZip(zip: Buffer): VerifiedEntry[] {
  const end = zip.length - 22
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error('No end-of-central-directory record.')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const entries: VerifiedEntry[] = []
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`Bad central header ${String(i)}.`)
    const method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16)
    const compressedSize = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const offset = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    at += 46 + nameLength

    if (zip.readUInt32LE(offset) !== 0x04034b50) throw new Error(`${name}: bad local header.`)
    const localName = zip.readUInt16LE(offset + 26)
    const localExtra = zip.readUInt16LE(offset + 28)
    if (zip.subarray(offset + 30, offset + 30 + localName).toString('utf8') !== name) {
      throw new Error(`${name}: local header names another entry.`)
    }
    const start = offset + 30 + localName + localExtra
    const packed = zip.subarray(start, start + compressedSize)
    const descriptor = start + compressedSize
    if (
      zip.readUInt32LE(descriptor) !== 0x08074b50 ||
      zip.readUInt32LE(descriptor + 4) !== crc ||
      zip.readUInt32LE(descriptor + 8) !== compressedSize ||
      zip.readUInt32LE(descriptor + 12) !== size
    ) {
      throw new Error(`${name}: the data descriptor disagrees with the central directory.`)
    }
    const data = method === 8 ? inflateRawSync(packed) : Buffer.from(packed)
    if (data.length !== size)
      throw new Error(`${name}: size ${String(data.length)} != ${String(size)}.`)
    if (crc32(data) !== crc) throw new Error(`${name}: CRC-32 mismatch.`)
    entries.push({ name, method, data })
  }
  return entries
}
