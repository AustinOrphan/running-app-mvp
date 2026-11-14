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
const STREAM_PAGE_ROWS = 5

/** Folder of the uploaded files inside the archive. */
export const ORIGINAL_FILES_DIR = 'original-files'

type Row = Record<string, unknown>
/**
 * Reads the page that follows `last`, the final row of the page before (`undefined` for the
 * first). Paging is by key (`id > last.id`), never by a cursor row: a cursor whose row was deleted
 * between two reads makes the database answer an empty page, and the table would end early.
 */
type Finder = (take: number, last: Row | undefined) => Promise<Row[]>

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
  pageRows?: number
  find: Finder
}

/** Where clause part: rows with an id after the last one read. */
function idAfter(last: Row | undefined): { id?: { gt: string } } {
  return last === undefined ? {} : { id: { gt: String(last['id']) } }
}

/** The same for the tables keyed by their activity. */
function activityIdAfter(last: Row | undefined): { activityId?: { gt: string } } {
  return last === undefined ? {} : { activityId: { gt: String(last['activityId']) } }
}

/** Activities are read oldest first: the key is (date, id). */
function activityAfter(last: Row | undefined): {
  OR?: ({ date: { gt: string } } | { date: string; id: { gt: string } })[]
} {
  if (last === undefined) return {}
  const date = String(last['date'])
  return { OR: [{ date: { gt: date } }, { date, id: { gt: String(last['id']) } }] }
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
        'hideMapEnds: whether the map view leaves out the first and last 200 metres of a run. It only trims the view; activity-tracks.json holds the whole route.',
        'planNoticeVersion and planNoticeAt: the version of the health notice you confirmed before your first plan, and when. Both are null until you confirm it.',
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
            hideMapEnds: true,
            planNoticeVersion: true,
            planNoticeAt: true,
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
        'Every activity, including its feedback (rpe, feel, pain, heatExposure), weather, and terrain bins. Flagged duplicates are included.',
      fields: [
        'date: the runner’s local day, YYYY-MM-DD. startTime: HH:MM local. startUtc: ISO 8601 UTC.',
        'durationSec, movingSec: seconds. distanceM, gapDistanceM, elevationGainM, elevationLossM: metres.',
        'rpe: 1 to 10. feel: -2 (much easier than expected) to +2 (much harder). pain: 0 to 10. heatExposure: warm-room (a run indoors at 25 C or more) or passive (a hot bath or sauna after an easy run), marked by the runner, else null.',
        'avgHr, maxHr: beats per minute. avgCadence: steps per minute. avgPowerW: watts.',
        'tempC, dewPointC: degrees Celsius. windKph: kilometres per hour. humidityPct: percent.',
        'startLat, startLng: degrees, rounded to 0.01.',
        'hrHistogram: {start, width, sec}. Heart-rate bins of width bpm from start bpm; sec[i] is the seconds spent in bin i.',
        'terrainBins: where moving time went by grade band, from the stream. Band i holds grades from edgesPct[i-1] up to edgesPct[i] percent (open at both ends), so each array has edgesPct.length + 1 entries. sec: moving seconds per band. m: metres per band. walkSec: the part of sec spent under walkMps (metres per second). windowM: the smoothing window in metres. flatCv: how steady the flat running was (standard deviation over mean of segment speed), or null. v: the shape version.',
        'duplicateOfId, duplicateStatus: the duplicate pass’s link and verdict.',
        'hrQuality: the checks on the run’s heart-rate data, from its stream; null means not checked yet (and for a run with no stream). v: the version. th: the thresholds the counts used. source: strap, wrist or unknown. movingSec: moving seconds. cleanSec: moving seconds that passed every check. lockSec (heart rate locked to the step cadence), spikeSec (jumps larger than a heart makes), dropSec (no heart rate), flatSec (one exact value for a minute or more), mismatchSec (heart rate fell while effort rose sharply): seconds flagged by each check; one second can be flagged by several, so they can add up to more than movingSec minus cleanSec. halves: for runs of 40 minutes or more, the clean seconds, metres and heart rate times seconds of the first and second half by terrain band (the bands of terrainBins), or null. gapDecouplingPct: drift between the halves on grade-adjusted pace, in percent, or null.',
        'trackV: the version of the route extraction (see activity-tracks.json); null means not looked at yet.',
        'surfaceBins: how far the run went on each kind of way, from its route and the OpenStreetMap ways of your downloaded map area (see map-area.json); null means not computed, or the run is outside the area or has no route. trailM, pavedM, roadM: metres on trails (paths, tracks and unpaved ways), paved paths and roads. unknownM: metres with no mapped way within 25 m. The four add up to the length of the route. v: the version of the matching.',
      ],
      json: ['hrHistogram', 'terrainBins', 'hrQuality', 'surfaceBins'],
      find: (take, last) =>
        prisma.activity.findMany({
          where: { ...mine, ...activityAfter(last) },
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
          take,
        }),
    },
    {
      file: 'activity-streams.json',
      models: ['ActivityStream'],
      about:
        'The recorded streams and laps of the activities that have them, one row per activity.',
      fields: [
        'activityId: the activity in activities.json.',
        'sampleSec: the spacing the series were thinned to, in seconds.',
        'data: aligned arrays of one length, one value per sample, null when the source had no such channel. t: seconds since the start. d: distance in metres. hr: heart rate in beats per minute. alt: altitude in metres. cad: cadence in steps per minute. pwr: power in watts.',
        'laps: a list of {startSec, durationSec (seconds), distanceM (metres), avgHr, maxHr (beats per minute), avgCadence (steps per minute)}; null when there were none.',
      ],
      json: ['data', 'laps'],
      pageRows: STREAM_PAGE_ROWS,
      find: (take, last) =>
        prisma.activityStream.findMany({
          where: { activity: mine, ...activityIdAfter(last) },
          orderBy: { activityId: 'asc' },
          take,
        }),
    },
    {
      file: 'activity-tracks.json',
      models: ['ActivityTrack'],
      about:
        'The route of each run that had positions, one row per activity: the whole stored track, with the first and last 200 metres included. Only the map view in the app trims the ends (the hideMapEnds setting); this file does not.',
      fields: [
        'activityId: the activity in activities.json. v: the version of the extraction.',
        'polyline: the simplified route as a Google encoded polyline, precision 5: each point is latitude and longitude in degrees times 1e5, rounded, stored as the difference from the previous point (the first from 0,0), in zigzag form, in base-64-like 5-bit chunks. Any polyline decoder with precision 5 reads it.',
        'distM: cumulative metres along the route for each point of the polyline, the same length as the decoded polyline. pointCount: the number of points.',
        'minLat, minLng, maxLat, maxLng: the bounding box in degrees. toleranceM: how far in metres the simplified route may differ from the recorded one.',
      ],
      json: ['distM'],
      pageRows: STREAM_PAGE_ROWS,
      find: (take, last) =>
        prisma.activityTrack.findMany({
          where: { activity: mine, ...activityIdAfter(last) },
          orderBy: { activityId: 'asc' },
          take,
        }),
    },
    {
      file: 'map-area.json',
      models: ['MapArea'],
      shape: 'object',
      about:
        'The map area you downloaded for the trail and road shares, if any. The ways themselves are OpenStreetMap’s data (© OpenStreetMap contributors, ODbL) and are not in this archive; download the area again to get them.',
      fields: [
        'minLat, minLng, maxLat, maxLng: the box that was asked of OpenStreetMap, in degrees.',
        'fetchedAt: when it was downloaded, ISO 8601 UTC. dataTimestamp: the date of the OpenStreetMap data the answer held. wayCount: the number of ways kept.',
        'v, matchV: the versions of the way classes and of the matching.',
      ],
      find: (take) => prisma.mapArea.findMany({ where: mine, take }),
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
      pageRows: PAGE_ROWS,
      find: async (take, last) => {
        const rows = await prisma.activityFile.findMany({
          where: { activity: mine, ...activityIdAfter(last) },
          orderBy: { activityId: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.importBatch.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'imported-files.json',
      models: ['ImportedFile'],
      about: 'The files the importers have seen (by SHA-256) and what came of each.',
      fields: ['outcome: imported, duplicate, no-activity or invalid.'],
      find: (take, last) =>
        prisma.importedFile.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.wellnessDay.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.weeklyReview.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'screenings.json',
      models: ['Screening'],
      about: 'Your answers to the screening questionnaire.',
      fields: ['answers: the answers, as JSON. flags: how many were flagged.'],
      json: ['answers'],
      find: (take, last) =>
        prisma.screening.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'goals.json',
      models: ['Goal'],
      about: 'Your goals and races.',
      fields: [
        'targetDate: YYYY-MM-DD. distanceM, gainM, lossM: metres. targetTimeSec: seconds.',
        'startTime: HH:MM. raceLat, raceLng: degrees, rounded to 0.01.',
      ],
      find: (take, last) =>
        prisma.goal.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'race-results.json',
      models: ['RaceResult'],
      about: 'The results you recorded for finished races.',
      fields: ['date: YYYY-MM-DD. distanceM, gainM: metres. timeSec: seconds.'],
      find: (take, last) =>
        prisma.raceResult.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'race-checkpoints.json',
      models: ['RaceCheckpoint'],
      about: 'The course points you entered for a goal race.',
      fields: [
        'distanceM: metres from the start. gainM, lossM: metres since the previous point.',
        'cutoffSec: elapsed seconds from the start.',
      ],
      find: (take, last) =>
        prisma.raceCheckpoint.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.predictionLog.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.plan.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
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
      find: (take, last) =>
        prisma.planWeek.findMany({
          where: { ...ofMyPlans, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
        'refusedActivityIds: the activities the runner unlinked from the session, as JSON; none is linked to it again.',
        'externalId: the session’s identity outside the database.',
      ],
      json: [
        'structure',
        'target',
        'rules',
        'flags',
        'execution',
        'original',
        'refusedActivityIds',
      ],
      find: (take, last) =>
        prisma.planSession.findMany({
          where: { ...ofMyPlans, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'plan-revisions.json',
      models: ['PlanRevision'],
      about: 'The history of changes to every plan.',
      fields: [
        'planId: the plan in plans.json. createdAt: ISO 8601 UTC.',
        'summary: what changed, in words. changes, decision, diff, undo: the details, as JSON.',
        'paramsVersion: the version of the plan rules the revision was drawn under; empty when unknown.',
      ],
      json: ['changes', 'decision', 'diff', 'undo'],
      pageRows: STREAM_PAGE_ROWS,
      find: (take, last) =>
        prisma.planRevision.findMany({
          where: { ...ofMyPlans, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'weekly-briefs.json',
      models: ['WeeklyBrief'],
      about: 'The Monday briefs, as the facts they were built from.',
      fields: ['weekStart: the Monday, YYYY-MM-DD. facts: template ids and values, as JSON.'],
      json: ['facts'],
      find: (take, last) =>
        prisma.weeklyBrief.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'disruptions.json',
      models: ['Disruption'],
      about: 'The illness, injury, travel and time windows you reported.',
      fields: ['startDate, endDate: YYYY-MM-DD, inclusive. maxRunMin: minutes. pain: 0 to 10.'],
      find: (take, last) =>
        prisma.disruption.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.strengthLift.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.strengthLog.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.strengthSet.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
    {
      file: 'fuel-products.json',
      models: ['FuelProduct'],
      about: 'The fuel products you keep, archived ones included.',
      fields: ['carbsG: grams per serving. sodiumMg: milligrams. kcal: kilocalories.'],
      find: (take, last) =>
        prisma.fuelProduct.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.fuelLog.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
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
      find: (take, last) =>
        prisma.integration.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.deliveryChannel.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
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
      find: (take, last) =>
        prisma.syncRun.findMany({
          where: { ...mine, ...idAfter(last) },
          orderBy: { id: 'asc' },
          take,
        }),
    },
  ]
}

/** Models that are deliberately not in the archive, with the reason. A test holds every model to one list or the other. */
export const EXCLUDED_MODELS: Readonly<Record<string, string>> = {
  ActivityInsight: 'Derived from the activities; rebuilt on the next read.',
  WristPublication: 'The publisher’s queue for the watch; rebuilt from the plan.',
  ForecastCache: 'Shared weather cache, not owned by a runner.',
  ClimateCache: 'Shared climate cache, not owned by a runner.',
  MapWay: 'OpenStreetMap’s data (ODbL), kept as a convenience; download the area again to get it.',
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
  let last: Row | undefined
  for (;;) {
    const page = await table.find(take, last)
    if (page.length === 0) return
    yield page
    if (page.length < take) return
    last = page[page.length - 1]
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
  let last: Row | undefined
  for (;;) {
    const page = await prisma.activity.findMany({
      where: { userId, ...activityAfter(last) },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: PAGE_ROWS,
    })
    if (page.length === 0) return
    yield Buffer.from(page.map((row) => `${activityCsvLine(row)}\r\n`).join(''))
    if (page.length < PAGE_ROWS) return
    last = page[page.length - 1]
  }
}

async function* originalFiles(
  prisma: PrismaClient,
  userId: string,
  counted: { files: number },
): AsyncGenerator<ZipEntry> {
  let last: Row | undefined
  for (;;) {
    const page = await prisma.activityFile.findMany({
      where: { activity: { userId }, ...activityIdAfter(last) },
      orderBy: { activityId: 'asc' },
      take: FILE_PAGE_ROWS,
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
    last = page[page.length - 1]
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
    'Limits: the archive is a plain ZIP, which holds at most 65,535 files and 4 GiB. An account',
    'over either limit is refused before any byte is sent (the page shows an error).',
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

/**
 * How many files the archive will hold: the fixed ones, one per table, and one per original file.
 * Counted before the stream starts so that an account past the ZIP limit is refused up front.
 */
export async function exportEntryCount(prisma: PrismaClient, userId: string): Promise<number> {
  const originals = await prisma.activityFile.count({ where: { activity: { userId } } })
  // README.txt, activities.csv and export-info.json, then the tables, then the original files.
  return 3 + exportTables(prisma, userId).length + originals
}
