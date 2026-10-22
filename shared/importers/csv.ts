/** What every importer returns for a row it accepted. */
export interface ImportRow {
  providerKey: string
  date: string
  startTime: string | null
  durationSec: number
  distanceM: number
  avgHr: number | null
  maxHr: number | null
  elevationGainM: number | null
  notes: string | null
}

/** A record that could not become a run. `line` is the 1-based record number; a header counts. */
export interface RowError {
  line: number
  reason: string
}

/**
 * Small RFC 4180 parser. Strips a leading BOM, accepts CRLF or LF record ends, keeps quoted
 * commas, doubled quotes and newlines, and drops records that are entirely empty (blank lines).
 * A quote that is never closed is read as a literal character, so the records after it are
 * still parsed instead of disappearing into one field.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false
  // Where the open quoted field started, to re-read it if the quote is never closed.
  let openAt = -1
  let openRecords = 0
  let openRecord: string[] = []

  const endField = () => {
    record.push(field)
    field = ''
    fieldStarted = false
  }
  const endRecord = () => {
    endField()
    if (record.length > 1 || record[0] !== '') records.push(record)
    record = []
  }

  for (let i = 0; i <= input.length; i++) {
    if (i === input.length) {
      if (!quoted) break
      // Unclosed quote: rewind to it and read it as an ordinary character.
      quoted = false
      records.length = openRecords
      record = openRecord
      field = '"'
      fieldStarted = true
      i = openAt
      continue
    }
    const ch = input.charAt(i)
    if (quoted) {
      if (ch === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
      openAt = i
      openRecords = records.length
      openRecord = [...record]
    } else if (ch === ',') {
      endField()
    } else if (ch === '\n') {
      endRecord()
    } else if (ch === '\r' && input.charAt(i + 1) === '\n') {
      // the \n ends the record
    } else {
      field += ch
      fieldStarted = true
    }
  }
  if (field !== '' || fieldStarted || record.length > 0) endRecord()
  return records
}
