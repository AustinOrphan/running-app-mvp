import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { zipStream, type ZipEntry } from '../../../server/services/zipWriter.ts'
import { verifyZip } from '../../zipCrc.ts'

async function build(entries: ZipEntry[], modified = new Date(Date.UTC(2026, 10, 8, 12, 30, 10))) {
  const parts: Buffer[] = []
  for await (const chunk of zipStream(entries, { modified })) parts.push(chunk)
  return Buffer.concat(parts)
}

/** The central directory, read by hand: signature, fields, name. */
function centralDirectory(zip: Buffer) {
  const end = zip.length - 22
  expect(zip.readUInt32LE(end)).toBe(0x06054b50)
  const count = zip.readUInt16LE(end + 10)
  expect(zip.readUInt16LE(end + 8)).toBe(count)
  const size = zip.readUInt32LE(end + 12)
  const start = zip.readUInt32LE(end + 16)
  expect(start + size).toBe(end)
  const records = []
  let at = start
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const nameLength = zip.readUInt16LE(at + 28)
    records.push({
      flags: zip.readUInt16LE(at + 8),
      method: zip.readUInt16LE(at + 10),
      time: zip.readUInt16LE(at + 12),
      day: zip.readUInt16LE(at + 14),
      crc: zip.readUInt32LE(at + 16),
      compressedSize: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      offset: zip.readUInt32LE(at + 42),
      name: zip.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
    })
    at += 46 + nameLength
  }
  expect(at).toBe(end)
  return records
}

describe('zipStream', () => {
  test('the structure is right byte by byte: local header, data, descriptor, central directory', async () => {
    const text = Buffer.from('hello hello hello hello hello\n'.repeat(50))
    const zip = await build([
      { name: 'a/deflated.txt', data: text },
      { name: 'stored.bin', data: Uint8Array.of(1, 2, 3, 4), method: 'store' },
      { name: 'empty.txt', data: new Uint8Array() },
    ])
    const records = centralDirectory(zip)
    expect(records.map((r) => r.name)).toEqual(['a/deflated.txt', 'stored.bin', 'empty.txt'])
    expect(records.map((r) => r.method)).toEqual([8, 0, 8])

    const [deflated, stored] = records
    // Local header at the recorded offset, with zero sizes and the descriptor flag.
    expect(zip.readUInt32LE(deflated!.offset)).toBe(0x04034b50)
    expect(zip.readUInt16LE(deflated!.offset + 6)).toBe(0x0808)
    expect(zip.readUInt32LE(deflated!.offset + 14)).toBe(0)
    const dataStart = deflated!.offset + 30 + Buffer.byteLength('a/deflated.txt')
    const compressed = zip.subarray(dataStart, dataStart + deflated!.compressedSize)
    expect(inflateRawSync(compressed).equals(text)).toBe(true)
    expect(deflated!.compressedSize).toBeLessThan(text.length)
    expect(deflated!.size).toBe(text.length)
    expect(deflated!.crc).toBe(crc32(text))
    // The descriptor repeats the central directory's numbers.
    const at = dataStart + deflated!.compressedSize
    expect(zip.readUInt32LE(at)).toBe(0x08074b50)
    expect(zip.readUInt32LE(at + 4)).toBe(deflated!.crc)
    expect(zip.readUInt32LE(at + 8)).toBe(deflated!.compressedSize)
    expect(zip.readUInt32LE(at + 12)).toBe(deflated!.size)

    expect(stored!.compressedSize).toBe(4)
    expect(stored!.crc).toBe(crc32(Buffer.of(1, 2, 3, 4)))
    expect(records.every((r) => (r.flags & 0x0800) !== 0)).toBe(true)
  })

  test('the modification time is the given one, in DOS fields', async () => {
    const [record] = centralDirectory(await build([{ name: 'a.txt', data: Buffer.from('x') }]))
    expect(record!.day).toBe(((2026 - 1980) << 9) | (11 << 5) | 8)
    expect(record!.time).toBe((12 << 11) | (30 << 5) | 5)
  })

  test('fflate, a separate reader, gets the same bytes back', async () => {
    const big = Buffer.alloc(300_000)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 251
    const zip = await build([
      { name: 'readme.txt', data: Buffer.from('Ünïcode name ok\n') },
      { name: 'ünï/文件.json', data: Buffer.from('{"a":1}') },
      { name: 'big.bin', data: big },
      { name: 'stored.bin', data: big.subarray(0, 1000), method: 'store' },
    ])
    const files = unzipSync(new Uint8Array(zip))
    expect(Object.keys(files)).toEqual(['readme.txt', 'ünï/文件.json', 'big.bin', 'stored.bin'])
    expect(Buffer.from(files['big.bin']!).equals(big)).toBe(true)
    expect(Buffer.from(files['stored.bin']!).equals(big.subarray(0, 1000))).toBe(true)
    expect(Buffer.from(files['ünï/文件.json']!).toString()).toBe('{"a":1}')
  })

  test('chunked and async sources are joined, and the entries are pulled one at a time', async () => {
    const log: string[] = []
    async function* chunks(): AsyncGenerator<Uint8Array> {
      for (const part of ['one,', 'two,', 'three']) {
        await Promise.resolve()
        log.push(`chunk ${part}`)
        yield Buffer.from(part)
      }
    }
    async function* entries(): AsyncGenerator<ZipEntry> {
      await Promise.resolve()
      log.push('entry 1')
      yield { name: 'x.txt', data: chunks() }
      log.push('entry 2')
      yield { name: 'y.txt', data: [Buffer.from('a'), Buffer.from('b')] }
    }
    const parts: Buffer[] = []
    for await (const chunk of zipStream(entries())) parts.push(chunk)
    const files = unzipSync(new Uint8Array(Buffer.concat(parts)))
    expect(Buffer.from(files['x.txt']!).toString()).toBe('one,two,three')
    expect(Buffer.from(files['y.txt']!).toString()).toBe('ab')
    expect(log.indexOf('entry 2')).toBeGreaterThan(log.indexOf('chunk three'))
  })

  test('every CRC-32 and size is right end to end: streamed, chunked, stored and whole entries', async () => {
    async function* chunks(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < 40; i++) {
        await Promise.resolve()
        yield Buffer.alloc(50_000, i)
      }
    }
    const zip = await build([
      { name: 'streamed.bin', data: chunks() },
      { name: 'streamed-stored.bin', data: chunks(), method: 'store' },
      { name: 'whole.txt', data: Buffer.from('whole\n'.repeat(1000)) },
      { name: 'whole-stored.txt', data: Buffer.from('stored\n'), method: 'store' },
      { name: 'empty.txt', data: new Uint8Array() },
    ])
    const entries = verifyZip(zip)
    expect(entries.map((e) => e.name)).toEqual([
      'streamed.bin',
      'streamed-stored.bin',
      'whole.txt',
      'whole-stored.txt',
      'empty.txt',
    ])
    expect(entries[0]!.data).toHaveLength(2_000_000)
    expect(entries[1]!.data.equals(entries[0]!.data)).toBe(true)
  })

  test('the verifier catches a flipped byte', async () => {
    const zip = await build([{ name: 'a.txt', data: Buffer.from('abcdef'), method: 'store' }])
    const at = zip.indexOf('abcdef')
    zip[at] = zip[at]! ^ 0xff
    expect(() => verifyZip(zip)).toThrow(/CRC-32/)
  })

  test('an empty archive is just the end record', async () => {
    const zip = await build([])
    expect(zip).toHaveLength(22)
    expect(centralDirectory(zip)).toEqual([])
  })

  test('a failing source ends the stream with its error and never writes an end record', async () => {
    async function* broken(): AsyncGenerator<Uint8Array> {
      await Promise.resolve()
      yield Buffer.from('partial')
      throw new Error('database went away')
    }
    const parts: Buffer[] = []
    await expect(
      (async () => {
        for await (const chunk of zipStream([{ name: 'a.txt', data: broken() }])) parts.push(chunk)
      })(),
    ).rejects.toThrow('database went away')
    expect(parts.some((p) => p.readUInt32LE(0) === 0x06054b50)).toBe(false)
  })

  test('refuses names that could escape a folder, and duplicates', async () => {
    for (const name of ['', '/abs.txt', '../x.txt', 'a/../x.txt', 'a\\b.txt']) {
      await expect(build([{ name, data: new Uint8Array() }])).rejects.toThrow(/valid ZIP entry/)
    }
    await expect(
      build([
        { name: 'a.txt', data: new Uint8Array() },
        { name: 'a.txt', data: new Uint8Array() },
      ]),
    ).rejects.toThrow(/Duplicate/)
  })

  const hasUnzip = spawnSync('unzip', ['-v']).status === 0
  test.skipIf(!hasUnzip)('the unzip tool accepts the archive and its checksums', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-zip-'))
    const file = join(dir, 'a.zip')
    writeFileSync(file, await build([{ name: 'a.txt', data: Buffer.from('abc\n'.repeat(1000)) }]))
    const out = execFileSync('unzip', ['-t', file]).toString()
    expect(out).toContain('No errors detected')
  })
})
