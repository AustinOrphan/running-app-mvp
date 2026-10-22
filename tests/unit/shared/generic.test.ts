import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { parseGenericCsv } from '../../../shared/importers/generic.ts'

describe('parseGenericCsv', () => {
  test('date,type,minutes,miles,notes with any header case', () => {
    const { rows, errors } = parseGenericCsv(
      'Date,TYPE,Minutes,Miles,Notes\n2026-03-02,run,45,5,Hill repeats\n',
    )
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.providerKey).toMatch(/^csv:[0-9a-f]{40}$/)
    expect(rows[0]).toEqual({
      providerKey: rows[0]?.providerKey,
      date: '2026-03-02',
      startTime: null,
      durationSec: 2700,
      distanceM: 8047,
      avgHr: null,
      maxHr: null,
      elevationGainM: null,
      notes: 'Hill repeats',
    })
  })

  test('minutes may be fractional; type may be blank; notes may be absent', () => {
    const { rows, errors } = parseGenericCsv('date,type,minutes,miles\n2026-03-02,,45.5,5\n')
    expect(errors).toEqual([])
    expect(rows[0]?.durationSec).toBe(2730)
    expect(rows[0]?.notes).toBeNull()
  })

  test('providerKey is the sha1 of "date|minutes|miles" and is stable', () => {
    const text = 'date,type,minutes,miles\n2026-03-02,run,45,5\n'
    const expected = 'csv:' + createHash('sha1').update('2026-03-02|45|5').digest('hex')
    expect(parseGenericCsv(text).rows[0]?.providerKey).toBe(expected)
    expect(parseGenericCsv(text).rows[0]?.providerKey).toBe(expected)
  })

  test('rows that cannot become runs are reported', () => {
    const text = [
      'date,type,minutes,miles',
      '2026-03-02,strength,30,0',
      '03/02/2026,run,45,5',
      '2026-03-03,run,45,',
      '2026-03-04,run,0,5',
      '2026-02-30,run,45,5',
      '2026-03-05,run,45,5',
    ].join('\n')
    const { rows, errors } = parseGenericCsv(text)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.date).toBe('2026-03-05')
    expect(errors).toEqual([
      { line: 2, reason: 'unsupported type "strength": only run rows can be imported' },
      { line: 3, reason: 'date must be YYYY-MM-DD' },
      { line: 4, reason: 'miles must be positive' },
      { line: 5, reason: 'minutes must be positive' },
      { line: 6, reason: 'date must be YYYY-MM-DD' },
    ])
  })

  test('a missing required column gives no rows and one error', () => {
    expect(parseGenericCsv('date,type,miles\n2026-03-02,run,5\n')).toEqual({
      rows: [],
      errors: [{ line: 1, reason: 'missing required column: minutes' }],
    })
  })

  test('BOM, CRLF, quoted notes and blank trailing lines import like a clean file', () => {
    const text = '﻿date,type,minutes,miles,notes\r\n2026-03-02,run,45,5,"Hills, ""fast"""\r\n\r\n'
    const { rows, errors } = parseGenericCsv(text)
    expect(errors).toEqual([])
    expect(rows[0]?.notes).toBe('Hills, "fast"')
  })
})
