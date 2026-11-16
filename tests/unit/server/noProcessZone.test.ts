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
  'server/jobs/scheduler.ts': 4,
  'server/jobs/weeklyUpdate.ts': 1,
  'server/routes/activities.ts': 1,
  'server/routes/calendar.ts': 1,
  'server/routes/export.ts': 1,
  'server/routes/fuel.ts': 2,
  'server/routes/goals.ts': 5,
  'server/routes/paces.ts': 1,
  'server/routes/plan.ts': 19,
  'server/routes/planInputs.ts': 1,
  'server/routes/predictions.ts': 1,
  'server/routes/race.ts': 1,
  'server/routes/reviews.ts': 3,
  'server/routes/screenings.ts': 1,
  'server/routes/state.ts': 1,
  'server/routes/strength.ts': 6,
  'server/routes/today.ts': 1,
  'server/routes/trends.ts': 1,
  'server/routes/trendsDurability.ts': 1,
  'server/routes/trendsLoad.ts': 1,
  'server/routes/trendsRuns.ts': 1,
  'server/routes/weeks.ts': 2,
  'server/routes/wrist.ts': 1,
  'server/routes/zones.ts': 4,
  'server/serialize.ts': 1,
  'server/services/athleteState.ts': 1,
  'server/services/brief.ts': 2,
  'server/services/execution.ts': 2,
  'server/services/explain.ts': 1,
  'server/services/fuel.ts': 1,
  'server/services/insight.ts': 3,
  'server/services/planEngine.ts': 1,
  'server/services/planNotice.ts': 1,
  'server/services/publish.ts': 5,
  'server/services/revisions.ts': 1,
  'server/services/strength.ts': 1,
  'server/services/todayHealth.ts': 1,
  'server/services/watchRatingBackfill.ts': 1,
  'server/services/weatherCache.ts': 2,
}

/** Server files calling a local-clock getter or setter (the backup slot, the Smashrun offset). */
const SERVER_LOCAL_CLOCK: Record<string, number> = {
  'server/jobs/scheduler.ts': 6,
  'server/jobs/weeklyUpdate.ts': 4,
  'server/routes/imports.ts': 1,
  'server/routes/profile.ts': 1,
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

/** Web files reading the device's day through `todayIso`, with the number of calls. */
const WEB_TODAY_ISO: Record<string, number> = {
  'web/components/CalendarFeed.tsx': 1,
  'web/components/SeasonStrip.tsx': 1,
  'web/components/WristSettings.tsx': 1,
  'web/components/WristStrip.tsx': 1,
  'web/components/revisions/RevisionDiff.tsx': 1,
  'web/components/revisions/UndoControl.tsx': 2,
  'web/pages/ActivitiesPage.tsx': 1,
  'web/pages/ActivityForm.tsx': 2,
  'web/pages/BriefPage.tsx': 1,
  'web/pages/GoalsPage.tsx': 2,
  'web/pages/PlanPage.tsx': 1,
  'web/pages/ProfilePage.tsx': 1,
  'web/pages/RaceResultSheet.tsx': 1,
  'web/pages/ReviewPage.tsx': 1,
  'web/pages/StatsPage.tsx': 1,
  'web/pages/TrendsPage.tsx': 1,
}

const TODAY_ISO_CALL = /\btodayIso\(/g
const LOCAL_CLOCK =
  /\.(?:getDay|getHours|getMinutes|getDate|getMonth|getFullYear|setHours|setDate|getTimezoneOffset)\(/g
const UTC_DAY = /toISOString\(\)\.slice\(0, 10\)/g

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

describe('matchCounts', () => {
  test('counts matches per file and leaves out a file with none', () => {
    const counts = matchCounts(['server/runnerDay.ts', 'server/index.ts'], /\bchosenZone\b/g)
    expect(Object.keys(counts)).toEqual(['server/runnerDay.ts'])
  })
})
