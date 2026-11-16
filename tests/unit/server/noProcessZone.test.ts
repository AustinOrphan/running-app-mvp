import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * D10 (ADR 0022): a runner's day comes from the runner's zone, not from the process zone. These
 * scanners hold the files that still read the process zone (`todayIso`, a local-clock getter,
 * `toISOString().slice(0, 10)`) under `server/`, and the files that still read the device's day
 * under `web/`. The allowlists only shrink: a file that reads more than listed fails, and so does a
 * file that reads less (remove or lower its entry in the PR that fixes it).
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

function sourceFiles(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => extensions.some((extension) => path.endsWith(extension)))
    .map((path) => `${dir}/${path}`)
    .sort()
}

/** The files whose source matches `pattern`, with the number of matches. */
export function matchCounts(files: readonly string[], pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of files) {
    const found = readFileSync(join(ROOT, file), 'utf8').match(pattern)
    if (found !== null) counts[file] = found.length
  }
  return counts
}

/** Server files reading the process zone through `todayIso`, with the number of calls. */
const SERVER_TODAY_ISO: Record<string, number> = {
  'server/jobs/scheduler.ts': 6,
  'server/jobs/weeklyUpdate.ts': 1,
  'server/services/publish.ts': 5,
  'server/services/watchRatingBackfill.ts': 1,
  'server/services/weatherCache.ts': 2,
}

/** Server files calling a local-clock getter or setter (the backup slot, the Smashrun offset). */
const SERVER_LOCAL_CLOCK: Record<string, number> = {
  'server/jobs/scheduler.ts': 6,
  'server/jobs/weeklyUpdate.ts': 4,
  'server/routes/imports.ts': 1,
}

/**
 * Server files writing a UTC day with `toISOString().slice(0, 10)`: the named exceptions, none of
 * which decides a runner's day (pull windows padded a day each side, the backup's retention
 * buckets, the duplicate pass's date shift).
 */
const SERVER_UTC_DAY: Record<string, number> = {
  'server/providers/garmin.ts': 1,
  'server/providers/intervals.ts': 1,
  'server/services/backup.ts': 1,
  'server/services/duplicates.ts': 1,
}

/**
 * Web files reading the device's day through `todayIso`, with the number of calls: only the
 * fallback of `useRunnerToday` (D10, ADR 0022), used while no zone is known.
 */
const WEB_TODAY_ISO: Record<string, number> = {
  'web/api/today.ts': 1,
}

const TODAY_ISO_CALL = /\btodayIso\(/g
const LOCAL_CLOCK =
  /\.(?:getDay|getHours|getMinutes|getDate|getMonth|getFullYear|setHours|setDate|getTimezoneOffset)\(/g
/** The chain may be split over lines by prettier, and `.slice(0,10)` may be written compact. */
const UTC_DAY = /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/g
/**
 * A Date built from an ISO time with no `Z` or offset reads the process zone: a template or string
 * literal ending in `T00:00:00` inside `new Date(`.
 */
const OFFSETLESS_DATE = /new Date\(\s*(?:`[^`]*|'[^']*|"[^"]*)T\d\d:\d\d(?::\d\d)?(?:\.\d+)?[`'"]/g
/**
 * An aliased import of `todayIso` would hide its calls from `TODAY_ISO_CALL`. The scan does not see
 * a bare reference passed along (`map(todayIso)`) or a call through another name; review catches those.
 */
const TODAY_ISO_ALIAS = /\btodayIso\s+as\b/g

/** Server files building a Date from an offset-less ISO time (process zone). */
const SERVER_OFFSETLESS_DATE: Record<string, number> = {
  'server/services/brief.ts': 2,
}

describe('the process zone under server/', () => {
  const files = sourceFiles('server', ['.ts'])

  test('the scan sees the server tree', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  test('todayIso is called only where the allowlist says, and the list only shrinks', () => {
    expect(matchCounts(files, TODAY_ISO_CALL)).toEqual(SERVER_TODAY_ISO)
  })

  test('a local-clock getter is read only where the allowlist says', () => {
    expect(matchCounts(files, LOCAL_CLOCK)).toEqual(SERVER_LOCAL_CLOCK)
  })

  test('toISOString().slice(0, 10) appears only in its four named exceptions', () => {
    expect(matchCounts(files, UTC_DAY)).toEqual(SERVER_UTC_DAY)
  })

  test('a Date built from an offset-less ISO time appears only where the allowlist says', () => {
    expect(matchCounts(files, OFFSETLESS_DATE)).toEqual(SERVER_OFFSETLESS_DATE)
  })

  test('todayIso is never imported under another name', () => {
    expect(matchCounts(files, TODAY_ISO_ALIAS)).toEqual({})
    expect(matchCounts(sourceFiles('web', ['.ts', '.tsx']), TODAY_ISO_ALIAS)).toEqual({})
  })
})

describe('the device day under web/', () => {
  const files = sourceFiles('web', ['.ts', '.tsx'])

  test('the scan sees the web tree', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  test('todayIso is called only where the allowlist says, and the list only shrinks', () => {
    expect(matchCounts(files, TODAY_ISO_CALL)).toEqual(WEB_TODAY_ISO)
  })
})

describe('the patterns', () => {
  const count = (pattern: RegExp, source: string) => source.match(pattern)?.length ?? 0

  test('UTC_DAY matches the compact, spaced and line-split forms', () => {
    expect(count(UTC_DAY, 'd.toISOString().slice(0, 10)')).toBe(1)
    expect(count(UTC_DAY, 'd.toISOString().slice(0,10)')).toBe(1)
    expect(count(UTC_DAY, 'new Date(ms)\n    .toISOString()\n    .slice(0, 10)')).toBe(1)
    expect(count(UTC_DAY, 'd.toISOString().slice(0, 16)')).toBe(0)
  })

  test('OFFSETLESS_DATE matches a local time and not one with Z or an offset', () => {
    expect(count(OFFSETLESS_DATE, 'new Date(`${day}T00:00:00`)')).toBe(1)
    expect(count(OFFSETLESS_DATE, "new Date('2026-01-01T06:30:00')")).toBe(1)
    expect(count(OFFSETLESS_DATE, 'new Date(`${day}T00:00:00Z`)')).toBe(0)
    expect(count(OFFSETLESS_DATE, 'new Date(`${day}T00:00:00+02:00`)')).toBe(0)
    expect(count(OFFSETLESS_DATE, 'new Date(`${day}T00:00:00.000Z`)')).toBe(0)
  })

  test('TODAY_ISO_ALIAS matches an aliased import', () => {
    expect(count(TODAY_ISO_ALIAS, "import { todayIso as t } from '../shared/dates.ts'")).toBe(1)
    expect(count(TODAY_ISO_ALIAS, "import { todayIso } from '../shared/dates.ts'")).toBe(0)
  })
})

describe('matchCounts', () => {
  test('counts matches per file and leaves out a file with none', () => {
    const counts = matchCounts(['server/runnerDay.ts', 'server/index.ts'], /\bchosenZone\b/g)
    expect(Object.keys(counts)).toEqual(['server/runnerDay.ts'])
  })
})
