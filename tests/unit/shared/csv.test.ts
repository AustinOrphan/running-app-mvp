import { describe, expect, test } from 'vitest'
import { parseCsv } from '../../../shared/importers/csv.ts'

describe('parseCsv', () => {
  test('quotes, escaped quotes, embedded commas and newlines', () => {
    expect(parseCsv('a,"b,c","say ""hi""","l1\nl2"\n')).toEqual([
      ['a', 'b,c', 'say "hi"', 'l1\nl2'],
    ])
  })

  test('CRLF line ends, a BOM and blank trailing lines', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  test('empty fields are kept; a final line without newline works; empty input gives []', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']])
    expect(parseCsv('')).toEqual([])
  })

  test('a quoted field containing CRLF keeps it', () => {
    expect(parseCsv('"a\r\nb",c\r\n')).toEqual([['a\r\nb', 'c']])
  })

  test('a line of only commas is a record of empty fields, not a blank line', () => {
    expect(parseCsv('a,b\n,\n')).toEqual([
      ['a', 'b'],
      ['', ''],
    ])
  })

  test('an unclosed quote is a literal character and later records survive', () => {
    expect(parseCsv('a,"b\nc,d\n')).toEqual([
      ['a', '"b'],
      ['c', 'd'],
    ])
    expect(parseCsv('1,2\na,"b')).toEqual([
      ['1', '2'],
      ['a', '"b'],
    ])
  })
})
