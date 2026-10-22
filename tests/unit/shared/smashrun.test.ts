import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseSmashrunCsv } from '../../../shared/importers/smashrun.ts'

const fixture = readFileSync(new URL('../../fixtures/smashrun-sample.csv', import.meta.url), 'utf8')

const HEADER =
  'Run Id,Source,Key,Distance,Duration (ms),Duration,Speed,HR Average,HR Max,HR Min,Start Date,Start Date (utc),Created Date (utc),Updated Date (utc),Is Deleted,Is Manual Edit,Elevation Gained,Elevation Lost,Hill Difficulty,SPI,Description,Tags,PowerAverage,PowerMax,PowerFormAverage,PowerFormMax'

interface RowOptions {
  id?: string
  distance?: string
  durationMs?: string
  hrAvg?: string
  hrMax?: string
  start?: string
  utc?: string
  deleted?: string
  gain?: string
  description?: string
}

/** One 26-field record with the named fields set and the rest blank. */
function record(o: RowOptions = {}): string {
  const f = new Array<string>(26).fill('')
  f[0] = o.id ?? '2001'
  f[1] = 'Synthetic'
  f[3] = o.distance ?? '3'
  f[4] = o.durationMs ?? '1800000'
  f[7] = o.hrAvg ?? ''
  f[8] = o.hrMax ?? ''
  f[10] = o.start ?? '26/03/02 7:15'
  f[11] = o.utc ?? ''
  f[14] = o.deleted ?? 'false'
  f[16] = o.gain ?? ''
  f[20] = o.description ?? ''
  return f.join(',')
}

const file = (...records: string[]) => [HEADER, ...records].join('\n') + '\n'

describe('parseSmashrunCsv', () => {
  test('out-of-range duration and distance are row errors; odd elevation and long notes are trimmed', () => {
    const { rows, errors } = parseSmashrunCsv(
      file(
        record({ id: '1', distance: '1e9' }),
        record({ id: '2', durationMs: '1e15' }),
        record({ id: '3', gain: '1e9', description: 'n'.repeat(5000) }),
      ),
    )
    expect(errors).toEqual([
      { line: 2, reason: 'distance out of range' },
      { line: 3, reason: 'duration out of range' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.providerKey).toBe('smashrun:3')
    expect(rows[0]?.elevationGainM).toBeNull()
    expect(rows[0]?.notes).toHaveLength(2000)
  })

  test('fixture parses to three rows', () => {
    const { rows, errors } = parseSmashrunCsv(fixture)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      providerKey: 'smashrun:1001',
      date: '2026-03-02',
      startTime: '07:15',
      durationSec: 1800,
      distanceM: 4989,
      avgHr: 150,
      maxHr: 170,
      elevationGainM: 30,
      notes: 'Easy loop, flat',
    })
    expect(rows[1]).toEqual({
      providerKey: 'smashrun:1002',
      date: '2026-03-04',
      startTime: '18:30',
      durationSec: 2700,
      distanceM: 8047,
      avgHr: null,
      maxHr: null,
      elevationGainM: null,
      notes: null,
    })
    expect(rows[2]).toMatchObject({
      providerKey: 'smashrun:1003',
      date: '2026-03-07',
      startTime: '08:00',
      durationSec: 4800,
      distanceM: 12875,
      elevationGainM: 76,
    })
  })

  test('distanceUnit km reads Distance as kilometres and elevation as metres', () => {
    const { rows } = parseSmashrunCsv(file(record({ distance: '5', gain: '100' })), {
      distanceUnit: 'km',
    })
    expect(rows[0]?.distanceM).toBe(5000)
    expect(rows[0]?.elevationGainM).toBe(100)
  })

  test('headerless 26-column files and files with a leading index column parse the same rows', () => {
    const expected = parseSmashrunCsv(fixture).rows
    const lines = fixture.trim().split('\n')
    const body = lines.slice(1)
    expect(parseSmashrunCsv(body.join('\n')).rows).toEqual(expected)
    const indexed = [`0,${lines[0]}`, ...body.map((l, i) => `${i + 1},${l}`)].join('\n')
    expect(parseSmashrunCsv(indexed).rows).toEqual(expected)
    const indexedHeaderless = body.map((l, i) => `${i + 1},${l}`).join('\n')
    expect(parseSmashrunCsv(indexedHeaderless).rows).toEqual(expected)
  })

  test('header detection is case-insensitive and columns map by name', () => {
    const text = [
      'run id,start date,distance,duration (ms),description',
      '3001,26/03/02 7:15,4,1200000,Reordered',
    ].join('\n')
    const { rows, errors } = parseSmashrunCsv(text)
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({
      providerKey: 'smashrun:3001',
      distanceM: 6437,
      durationSec: 1200,
      notes: 'Reordered',
    })
  })

  test('a header missing a required column reports it once and imports nothing', () => {
    const { rows, errors } = parseSmashrunCsv('Run Id,Distance,Start Date\n1,3,26/03/02 7:15\n')
    expect(rows).toEqual([])
    expect(errors).toEqual([{ line: 1, reason: 'missing required column: Duration (ms)' }])
  })

  test('date forms: YY/MM/DD H:MM, YYYY-MM-DD HH:MM:SS, ISO 8601 with offset keeps the literal local digits', () => {
    const starts = ['26/03/02 7:15', '2026-03-02 07:15:30', '2026-03-02T07:15:00-05:00']
    const { rows, errors } = parseSmashrunCsv(
      file(...starts.map((start, i) => record({ id: `${i + 1}`, start }))),
    )
    expect(errors).toEqual([])
    expect(rows.map((r) => [r.date, r.startTime])).toEqual([
      ['2026-03-02', '07:15'],
      ['2026-03-02', '07:15'],
      ['2026-03-02', '07:15'],
    ])
  })

  test('blank Start Date falls back to the UTC column with utcOffsetMinutes', () => {
    const text = file(record({ start: '', utc: '2026-03-03T02:30:00Z' }))
    const shifted = parseSmashrunCsv(text, { utcOffsetMinutes: () => -300 })
    expect(shifted.errors).toEqual([])
    expect(shifted.rows[0]).toMatchObject({ date: '2026-03-02', startTime: '21:30' })
    const plain = parseSmashrunCsv(text)
    expect(plain.rows[0]).toMatchObject({ date: '2026-03-03', startTime: '02:30' })
  })

  test('utcOffsetMinutes is asked per row instant', () => {
    const text = file(
      record({ id: '1', start: '', utc: '2026-01-15T12:00:00Z' }),
      record({ id: '2', start: '', utc: '2026-07-15T12:00:00Z' }),
    )
    const { rows } = parseSmashrunCsv(text, {
      utcOffsetMinutes: (d) => (d.getUTCMonth() < 3 ? -300 : -240),
    })
    expect(rows.map((r) => r.startTime)).toEqual(['07:00', '08:00'])
  })

  test('rows with problems are reported, not dropped, with 1-based record numbers', () => {
    const short = record({ id: '9' }).split(',').slice(0, 25).join(',')
    const text = file(
      record({ id: '1' }),
      record({ id: '2', start: 'last tuesday' }),
      record({ id: '3', distance: '0' }),
      record({ id: '4', durationMs: '' }),
      record({ id: '5', deleted: 'true' }),
      record({ id: '' }),
      short,
      record({ id: '8', start: '26/02/30 7:15' }),
      record({ id: '10' }),
    )
    const { rows, errors } = parseSmashrunCsv(text)
    expect(rows.map((r) => r.providerKey)).toEqual(['smashrun:1', 'smashrun:10'])
    expect(errors).toEqual([
      { line: 3, reason: 'unparseable start date' },
      { line: 4, reason: 'distance must be positive' },
      { line: 5, reason: 'duration must be positive' },
      { line: 6, reason: 'deleted in Smashrun' },
      { line: 7, reason: 'missing Run Id' },
      { line: 8, reason: 'expected 26 columns, got 25' },
      { line: 9, reason: 'unparseable start date' },
    ])
    expect(rows.length + errors.length).toBe(9)
  })

  test('a start time out of range is unparseable', () => {
    const { rows, errors } = parseSmashrunCsv(file(record({ start: '26/03/02 25:00' })))
    expect(rows).toEqual([])
    expect(errors).toEqual([{ line: 2, reason: 'unparseable start date' }])
  })

  test('BOM, CRLF and Excel-style quoting import like the clean fixture', () => {
    const excel = '﻿' + fixture.replace(/\n/g, '\r\n') + '\r\n\r\n'
    expect(parseSmashrunCsv(excel)).toEqual(parseSmashrunCsv(fixture))
    const quoted = fixture.replace('"Easy loop, flat"', '"Easy loop, ""flat"""')
    expect(parseSmashrunCsv(quoted).rows[0]?.notes).toBe('Easy loop, "flat"')
  })

  test('heart rates outside 30..250 become null; every row is a run (no type field)', () => {
    const { rows } = parseSmashrunCsv(
      file(
        record({ id: '1', hrAvg: '29', hrMax: '251' }),
        record({ id: '2', hrAvg: '30', hrMax: '250' }),
        record({ id: '3', hrAvg: 'abc', hrMax: '0' }),
      ),
    )
    expect(rows.map((r) => [r.avgHr, r.maxHr])).toEqual([
      [null, null],
      [30, 250],
      [null, null],
    ])
    for (const row of rows) expect(row).not.toHaveProperty('type')
  })

  test('empty input gives no rows and no errors', () => {
    expect(parseSmashrunCsv('')).toEqual({ rows: [], errors: [] })
  })
})
