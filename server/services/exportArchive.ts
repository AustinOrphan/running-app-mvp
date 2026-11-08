// The full-data export: every record one runner owns, as readable files in one ZIP archive
// (`GET /api/export`). It is not the operator's backup (`backup.ts` copies the whole database for a
// restore): this is one runner's rows as JSON, the activity CSV, and the original imported files,
// with a README that names every file.
//
// Secrets stay out by construction. A model that holds one (`User`, `Integration`,
// `DeliveryChannel`) is read through an allowlist `select`, so a column added later is left out
// until someone adds it here; the other models carry no secret column. `ActivityFile.gz` is the
// uploaded file, not a secret, and goes out decompressed. The route's test scans every byte of an
// archive for each seeded secret.
//
// Memory: a table is read a page at a time (`PAGE_ROWS`, or `FILE_PAGE_ROWS` for the file blobs)
// and written as it is read, so the working set is one page plus the deflate window, whatever the
// size of the account.
import { gunzipSync } from 'node:zlib'
import type { PrismaClient } from '../db.ts'
import { activityCsvHeader, activityCsvLine } from './activitiesCsv.ts'
import { zipStream, type ZipEntry } from './zipWriter.ts'

const PAGE_ROWS = 200
/** Stored original files and streams are large; a smaller page keeps a page of them small. */
const FILE_PAGE_ROWS = 5
const STREAM_PAGE_ROWS = 20

/** Folder of the uploaded files inside the archive. */
export const ORIGINAL_FILES_DIR = 'original-files'

type Row = Record<string, unknown>
/** Reads the page after `after` (a row key; `undefined` for the first page). */
type Finder = (take: number, after: string | undefined) => Promise<Row[]>

interface Table {
  /** The file in the archive. */
  file: string
  /** The Prisma models whose rows the file holds. */
  models: readonly string[]
  /** What the file is, for the README. */
  about: string
  /** Notes on fields and units, for the README. */
  fields: readonly string[]
  /** `object`: the one row (or null) instead of an array. */
  shape?: 'array' | 'object'
  /** The columns that hold JSON text; they are written as JSON, not as a string of JSON. */
  json?: readonly string[]
  /** The row column that is its key for paging. */
  key?: string
  pageRows?: number
  find: Finder
}

/** The paging args that continue after the row with this id. */
function after(key: string | undefined): { cursor?: { id: string }; skip?: number } {
  return key === undefined ? {} : { cursor: { id: key }, skip: 1 }
}

/** The same for the tables keyed by their activity. */
function afterActivity(key: string | undefined): {
  cursor?: { activityId: string }
  skip?: number
} {
  return key === undefined ? {} : { cursor: { activityId: key }, skip: 1 }
}

/** The tables, in archive order. `prisma` and `userId` are fixed per export. */
export function exportTables(prisma: PrismaClient, userId: string): Table[] {
  const mine = { userId }
  const ofMyPlans = { plan: { userId } }
  return [
    {
      file: 'settings.json',
      models: ['User'],
      shape: 'object',
      about: 'Your account settings.',
      fields: [
        'units: "mi" or "km", the distance unit shown on screen. Stored distances are metres.',
        'weightUnit: "lb" or "kg", the unit strength loads are shown in. Stored loads are grams.',
        'showBodyWeight: whether Trends draws the body-weight chart.',
        'The password and its hash are not included.',
      ],
      // An allowlist, so a column added to User stays out until it is listed here.
      find: (take) =>
        prisma.user.findMany({
          where: { id: userId },
          take,
          select: {
            id: true,
            email: true,
            displayName: true,
            units: true,
            weightUnit: true,
            showBodyWeight: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
    },
    {
      file: 'profile.json',
      models: ['AthleteProfile'],
      shape: 'object',
      about: 'Your athlete profile: body, heart rate, availability, home place and time zone.',
      fields: [
        'heightCm, weightKg: centimetres and kilograms.',
        'hrMax, hrRest, lthr: beats per minute. thresholdPaceSecPerKm: seconds per kilometre.',
        'birthYear, runningSinceYear: calendar years.',
        'homeLat, homeLng: degrees, rounded to 0.01.',
        'timezone: an IANA zone; every local day in the archive is a day in it.',
      ],
      json: ['injuries', 'availability', 'terrain'],
      find: (take) => prisma.athleteProfile.findMany({ where: mine, take }),
    },
    {
      file: 'activities.json',
      models: ['Activity'],
      about:
        'Every activity, including its feedback (rpe, feel, pain), weather, and terrain bins. Flagged duplicates are included.',
      fields: [
        'date: the runner’s local day, YYYY-MM-DD. startTime: HH:MM local. startUtc: ISO 8601 UTC.',
        'durationSec, movingSec: seconds. distanceM, gapDistanceM, elevationGainM, elevationLossM: metres.',
        'rpe: 1 to 10. feel: -2 (much easier than expected) to +2 (much harder). pain: 0 to 10.',
        'avgHr, maxHr: beats per minute. avgCadence: steps per minute. avgPowerW: watts.',
        'tempC, dewPointC: degrees Celsius. windKph: kilometres per hour. humidityPct: percent.',
        'startLat, startLng: degrees, rounded to 0.01.',
        'hrHistogram, terrainBins: the stored analysis of the stream, as JSON.',
        'duplicateOfId, duplicateStatus: the duplicate pass’s link and verdict.',
      ],
      json: ['hrHistogram', 'terrainBins'],
      find: (take, key) =>
        prisma.activity.findMany({
          where: mine,
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
          take,
          ...after(key),
        }),
    },
    {
      file: 'activity-streams.json',
      models: ['ActivityStream'],
      about:
        'The recorded streams and laps of the activities that have them, one row per activity.',
      fields: [
        'activityId: the activity in activities.json.',
        'sampleSec: seconds between samples.',
        'data: the sampled series (see the keys in each row); laps: the lap list.',
      ],
      json: ['data', 'laps'],
      key: 'activityId',
      pageRows: STREAM_PAGE_ROWS,
      find: (take, key) =>
        prisma.activityStream.findMany({
          where: { activity: mine },
          orderBy: { activityId: 'asc' },
          take,
          ...afterActivity(key),
        }),
    },
    {
      file: 'activity-files.json',
      models: ['ActivityFile'],
      about: `The index of the original imported files, which are in the ${ORIGINAL_FILES_DIR} folder.`,
      fields: [
        'activityId: the activity the file made.',
        'format: fit, gpx or tcx. fileName: the name it was uploaded under, when known.',
        'sizeBytes: the size of the original file. sha256: its SHA-256.',
        'archivePath: where the file is in this archive.',
      ],
      key: 'activityId',
      pageRows: PAGE_ROWS,
      find: async (take, key) => {
        const rows = await prisma.activityFile.findMany({
          where: { activity: mine },
          orderBy: { activityId: 'asc' },
          take,
          ...afterActivity(key),
          // The blob goes out as its own entry, not in this index.
          select: { activityId: true, format: true, fileName: true, sizeBytes: true, sha256: true },
        })
        return rows.map((row) => ({ ...row, archivePath: originalFilePath(row) }))
      },
    },
    {
      file: 'import-batches.json',
      models: ['ImportBatch'],
      about: 'One row per import you ran, with its counts and the rows it could not read.',
      fields: ['errors: the rows that were skipped and why, as JSON.'],
      json: ['errors'],
      find: (take, key) =>
        prisma.importBatch.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'imported-files.json',
      models: ['ImportedFile'],
      about: 'The files the importers have seen (by SHA-256) and what came of each.',
      fields: ['outcome: imported, duplicate, no-activity or invalid.'],
      find: (take, key) =>
        prisma.importedFile.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'wellness.json',
      models: ['WellnessDay'],
      about:
        'Wellness days and daily check-ins (fatigue, soreness, sleep quality, mood, stress, pain).',
      fields: [
        'date: the local day, YYYY-MM-DD.',
        'restingHr: beats per minute. hrvRmssd, hrvSdnn: milliseconds. sleepSec: seconds.',
        'weightKg: kilograms. vo2max: millilitres per kilogram per minute.',
        'fatigue, soreness, sleepQuality, mood, stress: check-in answers, 1 to 5, 3 is normal.',
        'painScore: 0 to 10. illness: true when the check-in said ill.',
      ],
      find: (take, key) =>
        prisma.wellnessDay.findMany({
          where: mine,
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
          take,
          ...after(key),
        }),
    },
    {
      file: 'weekly-reviews.json',
      models: ['WeeklyReview'],
      about: 'Your weekly reviews.',
      fields: [
        'weekStart: the Monday of the week, YYYY-MM-DD.',
        'suggestedNextMin, finalNextMin: planned running minutes for the next week.',
        'fatigue: 1 to 5.',
      ],
      find: (take, key) =>
        prisma.weeklyReview.findMany({
          where: mine,
          orderBy: [{ weekStart: 'asc' }, { id: 'asc' }],
          take,
          ...after(key),
        }),
    },
    {
      file: 'screenings.json',
      models: ['Screening'],
      about: 'Your answers to the screening questionnaire.',
      fields: ['answers: the answers, as JSON. flags: how many were flagged.'],
      json: ['answers'],
      find: (take, key) =>
        prisma.screening.findMany({ where: mine, orderBy: { id: 'asc' }, take, ...after(key) }),
    },
    {
      file: 'goals.json',
      models: ['Goal'],
      about: 'Your goals and races.',
      fields: [
        'targetDate: YYYY-MM-DD. distanceM, gainM, lossM: metres. targetTimeSec: seconds.',
        'startTime: HH:MM. raceLat, raceLng: degrees, rounded to 0.01.',
      ],
      find: (take, key) =>
        prisma.goal.findMany({ where: mine, orderBy: { id: 'asc' }, take, ...after(key) }),
    },
    {
      file: 'race-results.json',
      models: ['RaceResult'],
      about: 'The results you recorded for finished races.',
      fields: ['date: YYYY-MM-DD. distanceM, gainM: metres. timeSec: seconds.'],
      find: (take, key) =>
        prisma.raceResult.findMany({ where: mine, orderBy: { id: 'asc' }, take, ...after(key) }),
    },
    {
      file: 'race-checkpoints.json',
      models: ['RaceCheckpoint'],
      about: 'The course points you entered for a goal race.',
      fields: [
        'distanceM: metres from the start. gainM, lossM: metres since the previous point.',
        'cutoffSec: elapsed seconds from the start.',
      ],
      find: (take, key) =>
        prisma.raceCheckpoint.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'predictions.json',
      models: ['PredictionLog'],
      about: 'The race-time predictions the app logged.',
      fields: [
        'predictedSec, lowSec, highSec, actualSec: seconds.',
        'weekStart: the Monday, YYYY-MM-DD. loggedOn: the local day it was made.',
        'inputs: what the prediction used, as JSON.',
      ],
      json: ['inputs'],
      find: (take, key) =>
        prisma.predictionLog.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'plans.json',
      models: ['Plan'],
      about:
        'Your training plans (active and archived). Their weeks, sessions and revisions are in the next three files.',
      fields: [
        'startDate, raceWeekStart: Mondays, YYYY-MM-DD.',
        'feasibility, warnings, checklist, options: the generator’s notes, as JSON.',
      ],
      json: ['feasibility', 'warnings', 'checklist', 'options'],
      find: (take, key) =>
        prisma.plan.findMany({ where: mine, orderBy: { id: 'asc' }, take, ...after(key) }),
    },
    {
      file: 'plan-weeks.json',
      models: ['PlanWeek'],
      about: 'The weeks of every plan.',
      fields: [
        'planId: the plan in plans.json. weekStart: the Monday, YYYY-MM-DD.',
        'baselineRunMin, targetRunMin, longRunMin, day2Min: minutes. gainTargetM: metres.',
        'tid: the intensity targets, percent of running time. flags: the week’s flags.',
      ],
      json: ['tid', 'flags'],
      find: (take, key) =>
        prisma.planWeek.findMany({
          where: ofMyPlans,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'plan-sessions.json',
      models: ['PlanSession'],
      about: 'The planned sessions of every plan.',
      fields: [
        'planId: the plan in plans.json. date: YYYY-MM-DD. weekStart: the Monday.',
        'durationMin: minutes. distanceM, gainM: metres.',
        'structure, target, rules, flags, execution, original: the session’s steps and notes, as JSON.',
        'activityId: the activity that fulfils the session, when linked.',
        'externalId: the session’s identity outside the database.',
      ],
      json: ['structure', 'target', 'rules', 'flags', 'execution', 'original'],
      find: (take, key) =>
        prisma.planSession.findMany({
          where: ofMyPlans,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'plan-revisions.json',
      models: ['PlanRevision'],
      about: 'The history of changes to every plan.',
      fields: [
        'planId: the plan in plans.json. createdAt: ISO 8601 UTC.',
        'summary: what changed, in words. changes, decision, diff, undo: the details, as JSON.',
      ],
      json: ['changes', 'decision', 'diff', 'undo'],
      pageRows: STREAM_PAGE_ROWS,
      find: (take, key) =>
        prisma.planRevision.findMany({
          where: ofMyPlans,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'weekly-briefs.json',
      models: ['WeeklyBrief'],
      about: 'The Monday briefs, as the facts they were built from.',
      fields: ['weekStart: the Monday, YYYY-MM-DD. facts: template ids and values, as JSON.'],
      json: ['facts'],
      find: (take, key) =>
        prisma.weeklyBrief.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'disruptions.json',
      models: ['Disruption'],
      about: 'The illness, injury, travel and time windows you reported.',
      fields: ['startDate, endDate: YYYY-MM-DD, inclusive. maxRunMin: minutes. pain: 0 to 10.'],
      find: (take, key) =>
        prisma.disruption.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'strength-settings.json',
      models: ['StrengthSettings'],
      shape: 'object',
      about: 'Your strength setup: equipment, level, exercises to avoid and pinned lifts.',
      fields: ['equipment, avoid, pinned: JSON. Exercise ids are the app’s fixed catalogue.'],
      json: ['equipment', 'avoid', 'pinned'],
      find: (take) => prisma.strengthSettings.findMany({ where: mine, take }),
    },
    {
      file: 'strength-lifts.json',
      models: ['StrengthLift'],
      about: 'The starting loads you entered for each exercise.',
      fields: ['loadG: grams. reps: repetitions. rir: reps in reserve, 0 to 5. asOf: YYYY-MM-DD.'],
      find: (take, key) =>
        prisma.strengthLift.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'strength-logs.json',
      models: ['StrengthLog'],
      about: 'Your strength sessions. The sets are in strength-sets.json.',
      fields: [
        'activityId: the strength activity in activities.json, which holds the date and minutes.',
        'prescribed: what the sheet showed when you logged, as JSON.',
      ],
      json: ['prescribed'],
      find: (take, key) =>
        prisma.strengthLog.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'strength-sets.json',
      models: ['StrengthSet'],
      about: 'Every set of every strength session.',
      fields: [
        'logId: the session in strength-logs.json. position: the order in the session.',
        'loadG: grams. count: repetitions, seconds or contacts, by the exercise. rir: 0 to 5.',
      ],
      find: (take, key) =>
        prisma.strengthSet.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'fuel-products.json',
      models: ['FuelProduct'],
      about: 'The fuel products you keep, archived ones included.',
      fields: ['carbsG: grams per serving. sodiumMg: milligrams. kcal: kilocalories.'],
      find: (take, key) =>
        prisma.fuelProduct.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
        }),
    },
    {
      file: 'fuel-logs.json',
      models: ['FuelLog'],
      about: 'Your fuel logs, one per run.',
      fields: [
        'activityId: the run in activities.json.',
        'items: what you ate, as JSON. fluidMl: millilitres. sodiumMg: milligrams.',
        'gut, nausea: 0 to 4.',
      ],
      json: ['items'],
      find: (take, key) =>
        prisma.fuelLog.findMany({ where: mine, orderBy: { id: 'asc' }, take, ...after(key) }),
    },
    {
      file: 'fuel-settings.json',
      models: ['FuelSettings'],
      shape: 'object',
      about: 'Your fuel switches.',
      fields: ['optIn90, optInAdvanced, giDisease, gutBlock: true or false.'],
      find: (take) => prisma.fuelSettings.findMany({ where: mine, take }),
    },
    {
      file: 'integrations.json',
      models: ['Integration'],
      about:
        'The data sources you connected: provider, status and dates only. No key, token, secret or account setting is included.',
      fields: [
        'provider: the source’s name. status: connected, needs_auth or error.',
        'lastSyncAt, pausedUntil, createdAt, updatedAt: ISO 8601 UTC.',
      ],
      // An allowlist: the secret, the push-token hash, the cursor, the settings and the last error
      // text are not read at all.
      find: (take, key) =>
        prisma.integration.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
          select: {
            id: true,
            provider: true,
            status: true,
            lastSyncAt: true,
            lastSyncStatus: true,
            pausedUntil: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
    },
    {
      file: 'delivery-channels.json',
      models: ['DeliveryChannel'],
      about:
        'Whether the watch or calendar delivery is switched on. The feed’s token is not included.',
      fields: ['channel: intervals or calendar. lastRunAt, pausedUntil: ISO 8601 UTC.'],
      find: (take, key) =>
        prisma.deliveryChannel.findMany({
          where: mine,
          orderBy: { id: 'asc' },
          take,
          ...after(key),
          select: {
            id: true,
            channel: true,
            enabled: true,
            garminLinked: true,
            lastRunAt: true,
            pausedUntil: true,
            tokenCreatedAt: true,
            updatedAt: true,
          },
        }),
    },
    {
      file: 'sync-runs.json',
      models: ['SyncRun'],
      about: 'The log of the last syncs and jobs (the app keeps 200 rows and 90 days).',
      fields: ['startedAt, finishedAt: ISO 8601 UTC. failures: the first failures, as JSON.'],
      json: ['failures'],
      find: (take, key) =>
        prisma.syncRun.findMany({ where: mine, orderBy: { id: 'asc' }, take, ...after(key) }),
    },
  ]
}

/** Models that are deliberately not in the archive, with the reason. A test holds every model to one list or the other. */
export const EXCLUDED_MODELS: Readonly<Record<string, string>> = {
  ActivityInsight: 'Derived from the activities; rebuilt on the next read.',
  WristPublication: 'The publisher’s queue for the watch; rebuilt from the plan.',
  ForecastCache: 'Shared weather cache, not owned by a runner.',
  ClimateCache: 'Shared climate cache, not owned by a runner.',
}

/** `original-files/<activityId>-<name>`; the id keeps two uploads of the same name apart. */
export function originalFilePath(file: {
  activityId: string
  format: string
  fileName: string | null
}): string {
  const stem = (file.fileName ?? '')
    .replace(/[^\w. -]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 100)
  const name = stem === '' ? `activity.${file.format}` : stem
  return `${ORIGINAL_FILES_DIR}/${file.activityId}-${name}`
}

function parseJsonText(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function present(row: Row, json: readonly string[] | undefined): Row {
  if (json === undefined) return row
  const out: Row = { ...row }
  for (const column of json) if (column in out) out[column] = parseJsonText(out[column])
  return out
}

/** Reads a table a page at a time. */
async function* rowsOf(table: Table): AsyncGenerator<Row[], void, undefined> {
  const take = table.pageRows ?? PAGE_ROWS
  const key = table.key ?? 'id'
  let cursor: string | undefined
  for (;;) {
    const page = await table.find(take, cursor)
    if (page.length === 0) return
    yield page
    if (page.length < take) return
    const last = page[page.length - 1]?.[key]
    if (typeof last !== 'string') throw new Error(`${table.file}: a row has no ${key}.`)
    cursor = last
  }
}

/** A JSON array, or one object, written a page at a time. `counted.rows` ends with the row count. */
async function* jsonChunks(table: Table, counted: { rows: number }): AsyncGenerator<Buffer> {
  if (table.shape === 'object') {
    for await (const page of rowsOf(table)) {
      const first = page[0]
      counted.rows = first === undefined ? 0 : 1
      yield Buffer.from(
        `${JSON.stringify(first === undefined ? null : present(first, table.json), null, 1)}\n`,
      )
      return
    }
    yield Buffer.from('null\n')
    return
  }
  yield Buffer.from('[')
  let first = true
  for await (const page of rowsOf(table)) {
    const text = page.map((row) => JSON.stringify(present(row, table.json))).join(',\n')
    yield Buffer.from(`${first ? '\n' : ',\n'}${text}`)
    first = false
    counted.rows += page.length
  }
  yield Buffer.from(first ? ']\n' : '\n]\n')
}

async function* csvChunks(prisma: PrismaClient, userId: string): AsyncGenerator<Buffer> {
  yield Buffer.from(`${activityCsvHeader()}\r\n`)
  let cursor: string | undefined
  for (;;) {
    const page = await prisma.activity.findMany({
      where: { userId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      take: PAGE_ROWS,
      ...after(cursor),
    })
    if (page.length === 0) return
    yield Buffer.from(page.map((row) => `${activityCsvLine(row)}\r\n`).join(''))
    if (page.length < PAGE_ROWS) return
    cursor = page[page.length - 1]?.id
  }
}

async function* originalFiles(
  prisma: PrismaClient,
  userId: string,
  counted: { files: number },
): AsyncGenerator<ZipEntry> {
  let cursor: string | undefined
  for (;;) {
    const page = await prisma.activityFile.findMany({
      where: { activity: { userId } },
      orderBy: { activityId: 'asc' },
      take: FILE_PAGE_ROWS,
      ...afterActivity(cursor),
    })
    if (page.length === 0) return
    for (const file of page) {
      let bytes: Uint8Array = file.gz
      try {
        bytes = gunzipSync(file.gz)
      } catch {
        // A stored blob that is not gzip is still the runner's data: it goes out as it is.
      }
      counted.files += 1
      yield { name: originalFilePath(file), data: bytes }
    }
    if (page.length < FILE_PAGE_ROWS) return
    cursor = page[page.length - 1]?.activityId
  }
}

/** The `README.txt`: one section per file, from the same table definitions that write the files. */
export function readmeText(tables: readonly Table[]): string {
  const lines = [
    'RUNNING LOG: FULL DATA EXPORT',
    '=============================',
    '',
    'This archive holds every record the app keeps for your account, as plain files.',
    'It is not a backup of the app: use the operator backup (`npm run backup`) for that.',
    '',
    'Units and formats, as the app stores them:',
    '  - Distance in metres, elevation in metres, duration in seconds.',
    '  - Strength loads in grams (integers). Plan targets in minutes.',
    '  - Dates as YYYY-MM-DD, the runner’s local day. Weeks start on Monday.',
    '  - Timestamps such as createdAt and startUtc are ISO 8601 in UTC.',
    '  - Temperatures in degrees Celsius, wind in kilometres per hour.',
    '  - Every .json file is UTF-8. Columns the app keeps as JSON text are written as JSON.',
    '  - A field that is null had no value.',
    '  - activities.csv is the one file in miles: minutes with two decimals, miles with four.',
    '',
    'Not included: your password and its hash, the session secret, the keys, tokens and secrets of',
    'connected sources, the calendar feed’s token, and caches the app rebuilds on its own',
    `(${Object.keys(EXCLUDED_MODELS).join(', ')}).`,
    '',
    'FILES',
    '-----',
    '',
    'README.txt',
    '  This file.',
    '',
    'export-info.json',
    '  When the archive was made, and how many rows each file holds.',
    '',
    'activities.csv',
    '  Every activity as a spreadsheet: date, start_time, type, minutes, miles, avg_hr, max_hr,',
    '  elevation_gain_m, rpe, notes, source, duplicate_status.',
    '',
  ]
  for (const table of tables) {
    lines.push(table.file)
    lines.push(`  ${table.about}`)
    if (table.shape === 'object') lines.push('  One object, or null when there is none.')
    for (const field of table.fields) lines.push(`  - ${field}`)
    lines.push('')
  }
  lines.push(`${ORIGINAL_FILES_DIR}/`)
  lines.push('  The imported FIT, GPX and TCX files, exactly as they were uploaded, named')
  lines.push('  <activityId>-<file name>. activity-files.json is their index.')
  lines.push('')
  return lines.join('\n')
}

/** The files of the archive, in order. Lazy: each file is read as the stream reaches it. */
export async function* exportEntries(
  prisma: PrismaClient,
  userId: string,
  now: Date,
): AsyncGenerator<ZipEntry> {
  const tables = exportTables(prisma, userId)
  yield { name: 'README.txt', data: Buffer.from(readmeText(tables)) }
  yield { name: 'activities.csv', data: csvChunks(prisma, userId) }
  const rowCounts: Record<string, number> = {}
  for (const table of tables) {
    const counted = { rows: 0 }
    // The count is complete once the entry has been written; `export-info.json` reads it last.
    rowCounts[table.file] = 0
    yield {
      name: table.file,
      data: (async function* () {
        yield* jsonChunks(table, counted)
        rowCounts[table.file] = counted.rows
      })(),
    }
  }
  const files = { files: 0 }
  yield* originalFiles(prisma, userId, files)
  yield {
    name: 'export-info.json',
    data: Buffer.from(
      `${JSON.stringify({ exportedAt: now.toISOString(), rows: rowCounts, originalFiles: files.files }, null, 1)}\n`,
    ),
  }
}

/** The archive as a stream of bytes. */
export function exportArchive(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): AsyncGenerator<Buffer> {
  return zipStream(exportEntries(prisma, userId, now), { modified: now })
}
