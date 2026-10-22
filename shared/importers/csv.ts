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
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false

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

  for (let i = 0; i < input.length; i++) {
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
