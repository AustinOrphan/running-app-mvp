# Data foundation — design

Status: Accepted 2026-10-22 by the owner's instruction to "keep going" and push the app
further (integrations, heart rate, temperature, richer data). Every decision below is the
builder's call unless marked **owner**. Builds on the rewrite design
(`2026-10-21-running-app-rewrite-design.md`); where they differ, this document wins for the
areas it covers.

## 1. Intent

The evidence-based training engine (separate design, after the research corpus) needs more
than date, duration and distance. It needs heart rate, elevation, weather, laps, wellness
(resting HR, HRV, sleep) and an athlete profile, and it needs them to arrive without manual
entry. This layer gets that data in, stores it compactly, and shows it.

Goals:

1. **Files.** Import FIT, GPX and TCX files, single or bulk, including the Garmin
   "Export your data" archive (nested ZIPs) and the Strava bulk export (`*.fit.gz`,
   `*.gpx.gz`, `*.tcx.gz`). Idempotent, with a per-file report.
2. **Automatic sync.** intervals.icu (API key; the owner has an account; Garmin syncs to it
   officially; it also supplies resting HR, HRV and sleep) and Strava (OAuth with the
   owner's own API application). Hourly background sync plus "Sync now".
3. **Richer activities.** Start instant and offset, moving time, elevation loss, cadence,
   power, device, rounded start location, weather, an HR histogram, aerobic decoupling,
   grade-adjusted distance, laps, a 10-second stream for charts, and the original file.
4. **Weather.** Air temperature, dew point, humidity and wind for every activity with a
   location (or the home location), from Open-Meteo; a 7-day forecast at home.
5. **Athlete profile.** Birth year, sex, height, weight, HR max (measured or estimated),
   resting HR, threshold HR and pace, running since, injury history, weekly availability,
   long-run day, terrain access, strength preference, timezone, home location.
6. **Wellness.** Daily resting HR, HRV (rMSSD, and SDNN from Apple kept separately), sleep,
   weight, VO2 max estimate, from any provider that has them, or entered by hand.
7. **Activity detail page** with pace, HR and elevation charts, laps, weather, HR
   distribution and decoupling.
8. **Feedback on every activity (owner, 2026-10-22).** RPE, a "how did it feel" rating
   against expectation (much easier, easier, as expected, harder, much harder) and a pain
   score, captured with as little friction as possible: a "How did it go?" card on Today
   lists recent unrated activities. The engine compares each activity with the planned
   session it fulfils (that link and the comparison are in the engine design) and uses the
   difference to adjust later sessions.
9. **Many sources (owner, 2026-10-22).** "Import from all of those accounts potentially, or
   link to them in some capacity", including Garmin directly, Apple Health and HealthFit.
   Every source is a provider behind one interface (2.6), so adding one later is a single
   module; the feasibility research of 2026-10-22 decides which ship now (2.6.1).

Non-goals: maps and GPS tracks (no lat/lng streams are stored), multi-user, a native
mobile app (phone data arrives through exports, automations and synced folders).

Garmin direct access was first ruled out (unofficial login is fragile and can lock the
account; the official API is for approved businesses). The owner asked for it a second
time, so it ships as an **experimental** provider, off by default, with the risks stated on
its card and only tokens stored, never the password.

Anti-goals: storing integration secrets in plain text; a sync that silently drops
activities; duplicate runs counted twice across sources; new environment variables.

## 2. Decisions

### 2.1 Dependencies

- `fit-file-parser` (MIT) for FIT on the server. Rejected: `@garmin/fitsdk`, whose licence
  allows internal business use only, a poor fit for a public MIT repository.
- `fast-xml-parser` (MIT) for GPX and TCX on the server.
- `fflate` (MIT) to unzip archives and gunzip `.gz` files: in the browser before upload,
  and on the server for Garmin's zipped original files.
- `saxes` (ISC) in a browser Web Worker to stream the Apple Health `export.xml`; a
  devDependency because only the Vite build uses it.
- No multipart library: files travel as base64 in JSON, at most 20 files and 12 MB of
  base64 per request, so a 2 GB Garmin export streams through in bounded requests.

### 2.2 Schema (one migration, `data_foundation`)

`Activity` gains (all nullable unless stated):
`subtype` (run/race: `road|trail|track|treadmill`; cross: `bike|hike|walk|swim|ski|elliptical|other`),
`startUtc` (ISO 8601 with `Z`), `utcOffsetMin` Int, `movingSec` Int, `elevationLossM` Int,
`avgCadence` Int (steps/min), `avgPowerW` Int, `deviceName`, `startLat`/`startLng` Float
(rounded to 0.01°), `tempC`/`dewPointC`/`windKph` Float, `humidityPct` Int,
`weatherSource` (`open-meteo|provider|manual`), `hrHistogram` (JSON text, see 2.4),
`decouplingPct` Float, `gapDistanceM` Int, `feel` Int (-2 much easier .. +2 much harder
than expected), `pain` Int (0-10). `source` becomes an open string validated against the
provider registry (`manual|smashrun|csv|file|intervals|strava|garmin|apple-health|...`).

New models (user-owned ones cascade on user delete):

```
ActivityStream  activityId (PK, cascade), sampleSec Int, data (JSON text), laps (JSON text?)
ActivityFile    activityId (PK, cascade), format ('fit'|'gpx'|'tcx'), fileName?, sizeBytes,
                sha256, gz Bytes
AthleteProfile  userId (PK), birthYear?, sex? ('female'|'male'|'unspecified'), heightCm?,
                weightKg?, hrMax?, hrMaxSource? ('measured'|'estimated'), hrRest?, lthr?,
                thresholdPaceSecPerKm?, runningSinceYear?, injuries (JSON, default '[]'),
                availability (JSON), longRunDay ('mon'..'sun', default 'sat'),
                terrain (JSON), strengthPreference Int (0-3, default 2),
                timezone (IANA, default 'UTC'), homeLat?, homeLng?,
                useHomeWeather Bool (default true), updatedAt
WellnessDay     id, userId, date, restingHr?, hrvRmssd?, hrvSdnn?, sleepSec?, sleepScore?,
                weightKg?, vo2max?, notes?, source (registry key or 'manual'), updatedAt;
                unique (userId, date)
Integration     id, userId, provider (registry key), status
                ('connected'|'needs_auth'|'error'), secret (encrypted text), config (JSON,
                no secrets), ingestTokenHash? (SHA-256 of a push token), cursor?,
                lastSyncAt?, lastSyncStatus?, lastError?, createdAt, updatedAt;
                unique (userId, provider)
ImportedFile    id, userId, sha256, fileName?, channel ('upload'|'folder'|'provider'),
                outcome ('imported'|'duplicate'|'no-activity'|'invalid'), activityId?,
                createdAt; unique (userId, sha256)   -- every file seen, so re-scans skip it
```

`ImportBatch.source` adds `file|intervals|strava`. JSON shapes, as TypeScript in
`shared/types.ts`:

```ts
ActivityStreamData = { t: number[]; d: number[] | null; hr: number[] | null;
  alt: number[] | null; cad: number[] | null; pwr: number[] | null }  // aligned arrays
Lap = { startSec: number; durationSec: number; distanceM: number | null;
  avgHr: number | null; maxHr: number | null; avgCadence: number | null }
HrHistogram = { start: number; width: number; sec: number[] }  // bpm bins, seconds each
Injury = { area: string; side: 'left'|'right'|'both'|null; year: number; month: number | null;
  kind: 'bone-stress'|'tendon'|'muscle'|'joint'|'other'; notes: string | null }
Availability = Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', { available: boolean;
  maxMin: number | null }>
Terrain = { trail: boolean; hills: boolean; treadmill: boolean; track: boolean }
```

### 2.3 Parsing pipeline

All parsers are pure and live in `shared/importers/files/`, returning `ParsedActivity`:

```ts
interface ParsedActivity {
  providerKey: string; startUtc: string; utcOffsetMin: number | null
  type: ActivityType; subtype: string | null
  elapsedSec: number; movingSec: number | null; distanceM: number | null
  elevationGainM: number | null; elevationLossM: number | null
  avgHr: number | null; maxHr: number | null; avgCadence: number | null; avgPowerW: number | null
  deviceName: string | null; startLat: number | null; startLng: number | null
  samples: { t: number[]; d: number[] | null; hr: number[] | null; alt: number[] | null;
    cad: number[] | null; pwr: number[] | null }     // seconds from start, as recorded
  laps: Lap[]
}
```

- FIT: sport/sub-sport map to type and subtype (running/trail → run/trail; walking,
  hiking, cycling, swimming → cross; training/strength → strength). A file with several
  sessions yields one activity per session. `providerKey` is `fit:<serial>-<time_created>`
  from `file_id`, else `sha:<first 16 hex of SHA-256 of the bytes>`.
- GPX and TCX: `providerKey` `sha:` as above. TCX gives HR, cadence and laps; GPX gives
  HR and cadence through Garmin's TrackPointExtension when present.
- The local calendar date and start time come from `utcOffsetMin` when the file has it
  (FIT `activity.local_timestamp`), else from the profile timezone via `Intl`.
- `summarize(parsed)` computes: `hrHistogram` (1 bpm bins from 40 to 220, seconds per bin,
  using sample durations); `movingSec` when the file lacks it (speed above 0.5 m/s);
  `decouplingPct` for runs of at least 40 minutes with HR and distance: pace-per-HR ratio of
  the second half divided by the first half, minus 1, in percent, positive meaning drift;
  `gapDistanceM` using the Minetti (2002) cost-of-gradient polynomial on 30-second smoothed
  grade, clamped to ±45%; and a 10-second stream (`sampleSec` 10, mean of each bucket).
  Grade-adjusted distance and decoupling are descriptive inputs for the engine, which
  decides how to use them.

### 2.4 Duplicates across sources

Generalize the existing rule in `shared/domain/duplicates.ts`:

- Two activities match when both have `startUtc` within 120 s of each other and their
  distances are within 5% (or both lack distance and durations are within 5%); otherwise
  the existing same-date, 80 m rule applies.
- Richness rank: `file` 5, `intervals` 4, `strava` 3, `smashrun` 2, `csv` 1, `manual` 0.
  The lower-ranked activity becomes the duplicate of the higher-ranked one, whichever
  arrived first; anything that pointed at the demoted row is re-pointed.
- Status is `confirmed` automatically when both sources are automated (rank 1 or more) and
  they matched on `startUtc`; otherwise `possible`, as today. Confirmed and possible rows
  stay excluded from totals; dismissed rows count.

### 2.5 Secrets

`server/crypto.ts`: AES-256-GCM, key from HKDF-SHA256 over `SESSION_SECRET` with salt
`rl-integrations-v1`. Stored format `v1.<iv>.<tag>.<ciphertext>` (base64url). A failed
decrypt (secret rotated) sets the integration to `needs_auth` with the message "Reconnect:
the session secret changed." No new environment variables: the Strava client id and secret
are entered in the app and stored encrypted.

### 2.6 Provider framework

Every source is a module in `server/providers/<key>.ts` registered in
`server/providers/registry.ts`. A provider declares which channels it supports and
implements only those:

```ts
interface ProviderInfo { key: string; label: string; experimental: boolean;
  channels: Array<'pull' | 'push' | 'upload' | 'folder'>; wellness: boolean; docsUrl: string }
interface PullProvider {   // the server fetches on a schedule
  connect(input: unknown, ctx: ProviderCtx): Promise<{ config: object; secret: object }>
  listActivities(since: string, ctx: ProviderCtx): AsyncIterable<RemoteActivityRef>
  fetchActivity(ref: RemoteActivityRef, ctx: ProviderCtx): Promise<ParsedActivity | null>
  listWellness?(from: string, to: string, ctx: ProviderCtx): Promise<WellnessInput[]>
}
interface PushProvider {   // the source posts to /api/ingest/<key> with a bearer token
  parsePush(body: unknown, ctx: ProviderCtx): { activities: ParsedActivity[]; wellness: WellnessInput[] }
}
interface UploadProvider { // the browser uploads an export the user downloaded
  parseUpload(files: UploadedFile[], ctx: ProviderCtx): Promise<{ activities: ParsedActivity[];
    wellness: WellnessInput[]; skipped: RowError[] }>
}
```

`ProviderCtx` carries an injected `fetch`, the profile timezone, decrypted secrets, a
`saveSecret` callback for refreshed tokens, and a rate-limit budget. All network clients
take the injected `fetch`, so tests never touch the network.

Channels:

- **pull**: scheduled sync (2.8).
- **push**: `POST /api/ingest/:provider` authenticated by `Authorization: Bearer <token>`.
  The token is 32 random bytes shown once when the owner enables push; only its SHA-256 is
  stored (`Integration.ingestTokenHash`) and compared in constant time. The ingest router is
  mounted before the same-origin guard and the session check (phone automations send no
  Origin and no cookie) and sits under the global rate limiter; body limit 16 MB.
- **upload**: the import dialog sends files as base64 JSON (2.1).
- **folder**: the scheduler scans a server-side folder the owner configures (for example an
  iCloud Drive, Dropbox or Syncthing folder that HealthFit or another app exports FIT files
  into) every 5 minutes for `.fit`, `.gpx`, `.tcx`, `.zip`, `.gz`; `ImportedFile` makes a
  re-scan skip files already seen. Read-only; the path must exist and be a directory; in
  Docker it must be mounted.

A fourth, outbound channel, `publish`, is defined in ADR 0008 and in section 4.4 of
`docs/superpowers/specs/2026-10-22-coach-phase3a-design.md`. The three inbound channels above are
unchanged.

#### 2.6.1 Providers in this release

Decided by the feasibility research of 2026-10-22 (`docs/research/integrations-2026-10.md`).
| Key | Label | Channels | Wellness | Experimental |
| --- | --- | --- | --- | --- |
| `intervals` | intervals.icu | pull | resting HR, HRV (rMSSD), sleep, weight | no |
| `strava` | Strava | pull | none | no |
| `garmin` | Garmin Connect | pull | resting HR, HRV (rMSSD), sleep | **yes** |
| `apple-health` | Apple Health (Health Auto Export, or the Health app's export file) | push, upload | resting HR, HRV (SDNN), sleep, weight, VO2 max | no |
| `folder` | Watched folder (HealthFit, Garmin or any app that exports files) | folder | none | no |

Plain FIT/GPX/TCX uploads use source `file` and need no provider. Polar AccessLink, WHOOP,
Oura and Google Health are feasible single-module additions for later; COROS, Suunto,
TrainingPeaks and Wahoo do not offer personal API access (use their file exports).

#### 2.6.2 intervals.icu (pull, wellness)

Basic auth, user `API_KEY`, password the key (OpenAPI checked 2026-10-22). Endpoints:
`GET /api/v1/athlete/{id}` (connect check), `GET /api/v1/athlete/{id}/activities?oldest&newest`,
`GET /api/v1/activity/{id}/file` (original file; not available for Strava-sourced
activities), `GET /api/v1/activity/{id}/streams.json?types=...` (fallback),
`GET /api/v1/athlete/{id}/wellness.json?oldest&newest`. `providerKey` `intervals:<id>`.
Prefer the original FIT through the file parser for fidelity; fall back to streams.
Wellness maps `restingHR`, `hrv` (rMSSD), `sleepSecs`, `sleepScore`, `weight`.
The card tells the owner to connect Garmin directly to intervals.icu (Strava-sourced
activities are not exposed through its API) and that the account must be active.

#### 2.6.3 Strava (pull)

The owner creates an API application at strava.com/settings/api with the app's host as the
callback domain, then enters client id, client secret and (optionally) the public base URL.
OAuth: `GET https://www.strava.com/oauth/authorize?client_id&redirect_uri&response_type=code&approval_prompt=auto&scope=read,activity:read_all&state`,
token exchange and refresh at `POST https://www.strava.com/oauth/token`. `state` is an HMAC
of the user id and a nonce with a 10-minute expiry. Activities from
`GET /api/v3/athlete/activities?after&page&per_page=200`, streams from
`GET /api/v3/activities/{id}/streams?keys=time,distance,heartrate,altitude,cadence,watts&key_by_type=true`.
`providerKey` `strava:<id>`. Respect rate limits from the `X-RateLimit-*` headers: stop
the run at 80% of either window and continue next run from the cursor.

#### 2.6.4 Garmin Connect (pull, wellness, experimental)

Unofficial: Garmin's official developer program is closed to new applicants (October 2026),
so this provider speaks the mobile app's login and API (request sequence in
`docs/research/integrations-2026-10.md`). It ships off by default; the card states the
risks and the connect form requires ticking "I understand this is unofficial and Garmin may
block it".

- Connect, mode `login`: `{ username, password }` → SSO mobile login. `MFA_REQUIRED`
  returns `{ mfaRequired: true, method }` and keeps the pending SSO session (cookies) in
  memory for 10 minutes keyed by user; mode `mfa` `{ code }` completes it. The service
  ticket is exchanged for DI OAuth2 tokens (client ids tried in order:
  `GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2`, `..._DI_2024Q4`, `..._ANDROID_DI`,
  `GARMIN_CONNECT_MOBILE_IOS_DI`). The password is never stored or logged.
- Connect, mode `tokens`: a pasted JSON object with `access_token`, `refresh_token` and
  `expires_in` or `expires_at` (as written by `python-garminconnect`), plus the client id.
  This is the fallback when Cloudflare blocks the login from Node (HTTP 403) or the account
  is rate limited (HTTP 429); the card explains it.
- Tokens: refresh when within 15 minutes of expiry or on a 401; refresh tokens rotate, so
  refreshes are serialised and the new pair is saved before use. A failed refresh sets
  `needs_auth`.
- Pull: activities by date range from the activity-list service, original FIT from the
  download service (a ZIP, opened with `fflate` on the server) through the file parser;
  `providerKey` `garmin:<activityId>`. Wellness for the last 30 days per run: sleep (seconds
  asleep, sleep score), HRV last-night average (rMSSD), daily resting HR.
- Politeness: at most one request per second, at most 200 per run; any 429 or 403 stops the
  run (`paused`) with a back-off of 6 hours before the next attempt.

#### 2.6.5 Apple Health (push and upload, wellness)

- **Push** from the Health Auto Export iOS app (its REST automation, Premium tier):
  `POST /api/ingest/apple-health` with `Authorization: Bearer <token>`, JSON v2 format,
  "Include Route Data" on, "Since Last Sync". Workouts map by `name` (running variants →
  run with subtypes treadmill for indoor, trail when the name says so; walking, hiking,
  cycling, swimming → cross; strength types → strength); `providerKey` `apple:<id>`;
  `start`/`end` carry the offset; distance and elevation `{qty, units}` normalised to
  metres; `heartRateData` points clipped to `[start, end]` become HR samples (Avg);
  `route` points give altitude, cumulative distance and the rounded start location;
  `temperature`/`humidity` set the weather fields with `weatherSource 'provider'`. Metrics
  are matched by normalised name (`resting_heart_rate`, `heart_rate_variability`,
  `sleep_analysis` asleep hours, `weight_body_mass`, `vo2_max`); unknown names are counted
  and returned as `ignored`, never an error.
- **Upload** of the Health app export (`export.zip`) for history: parsed in the browser in a
  Web Worker with `fflate` streaming unzip and the `saxes` streaming XML parser, in two
  passes over the file: (1) `Workout` elements with their `WorkoutStatistics`, and daily
  `Record`s for resting HR, HRV (SDNN), body mass, VO2 max and sleep (asleep stages summed
  per night, assigned to the wake-up date); (2) `HKQuantityTypeIdentifierHeartRate` records
  inside workout windows. Routes from `workout-routes/*.gpx` are matched to workouts by first
  point time. The worker builds `ParsedActivity` objects and posts them in batches to
  `POST /api/imports/parsed`. The pure extraction logic is `shared/importers/appleHealth.ts`
  (an event-driven reducer fed by the SAX events), so it is unit-tested without a browser.
- Apple's HRV is SDNN; it goes to `WellnessDay.hrvSdnn`, never to `hrvRmssd`.

### 2.7 Activity store

`server/services/activityStore.ts` is the only writer of imported activities, whatever the
channel: `storeParsed(deps, userId, parsed, { source, importBatchId, file? })` upserts by
`(userId, providerKey)`, writes `Activity`, `ActivityStream` and (for files) `ActivityFile`
and `ImportedFile` in one transaction, then runs the duplicate pass (2.4) for the new row.
An update from the same provider replaces the stream and summary fields but never the
owner's own fields (`rpe`, `feel`, `pain`, `notes`, `type` if the owner changed it).

### 2.8 Sync service and scheduler

`syncProvider(deps, userId, provider, { from? })` walks `listActivities` from the cursor
(first run: `from`, default 365 days back; "all history" allowed), stores each through the
activity store, pulls wellness when supported, records one `ImportBatch` per run, and
updates the cursor and status. The scheduler (`server/jobs/scheduler.ts`) starts from
`server/index.ts` only, never in tests: hourly pull sync of connected providers, folder
scan every 5 minutes, weather backfill every 10 minutes (50 activities per run). A job never
overlaps itself; a failure records `lastError` and the next run retries.

### 2.9 Weather

Open-Meteo, no key. Past: `archive-api.open-meteo.com/v1/archive` for activities older
than 5 days, `api.open-meteo.com/v1/forecast?past_days=7` for recent ones; hourly
`temperature_2m, relative_humidity_2m, dew_point_2m, wind_speed_10m`; values at the hour
nearest the activity midpoint. Location: the activity's start, else the home location when
`useHomeWeather` is on, else skipped. Requests are grouped by location rounded to 0.1° and
contiguous date ranges. Forecast: `GET /api/weather/forecast` returns 7 days hourly at home,
cached for one hour. Heat indices and pace adjustment belong to the engine.

### 2.10 API

```
GET/PUT /api/profile                         AthleteProfile (zod-validated; bounds below)
GET /api/wellness?from&to ; PUT /api/wellness/:date
POST /api/imports/files                      { batchId?, files: [{ name, dataBase64 }] } -> ImportBatch
POST /api/imports/parsed                     { batchId?, source, activities, wellness } -> ImportBatch
GET /api/activities/:id/detail               { activity, stream, laps, hasFile }
GET /api/activities/:id/file                 original file (attachment) or 404
GET /api/integrations                        one status per registry provider
PUT /api/integrations/:provider              provider-specific connect body (+ authorizeUrl for OAuth)
GET /api/integrations/:provider/callback     OAuth code exchange, redirect to /integrations
POST /api/integrations/:provider/sync        { from? } -> 202, runs in the background
POST /api/integrations/:provider/push-token  -> { token }, shown once
DELETE /api/integrations/:provider           forget credentials; activities stay
POST /api/ingest/:provider                   bearer push token; provider payload
GET /api/weather/forecast
```

The plan (`docs/superpowers/plans/2026-10-22-data-foundation.md`) holds the exact request and
response shapes.
Profile bounds: birthYear 1920 to the current year minus 10; heights 100-230 cm; weight
30-250 kg; HR max 120-230; resting HR 25-110; threshold HR 100-220 and below HR max;
threshold pace 150-900 s/km; availability `maxMin` 0-600. `/api/imports/files` gets a 16 MB
JSON body limit; every other route keeps 1 MB.

### 2.11 Web

- Import dialog: a third kind, "Activity files (FIT, GPX, TCX, ZIP)", multiple selection,
  client-side unzip (nested ZIPs) and gunzip, batches of 20 files or 12 MB, a progress bar,
  one aggregated report; unsupported entries listed, not dropped silently.
- `/integrations` page (linked from More and Settings): intervals.icu and Strava cards with
  connect forms, status, last sync, "Sync now", backfill start date, disconnect; Strava card
  explains the API-application step.
- `/profile` page (linked from More and Settings): the profile fields in sections; "Use my
  location" rounds the browser location to 0.01°; timezone defaults to the browser's.
- `/activities/:id` detail page: summary, pace/HR/elevation charts against distance (time
  when distance is missing), laps table, weather, HR distribution in 10 bpm bands,
  decoupling, source and original-file download, Edit and Delete. List rows link to it.

### 2.12 Tests

Synthetic fixtures only: a small FIT encoder in `tests/fixtures/fit/buildFit.ts` writes
test files (header, definitions, `file_id`, `record`, `lap`, `session`, `activity`, CRC);
GPX and TCX fixtures are hand-written. intervals.icu, Strava and Open-Meteo clients take an
injected `fetch`; their tests use synthetic responses shaped like the documented ones. No
test touches the network. An e2e spec imports a synthetic FIT and opens its detail page.

## 3. Left to the builders

Component layout of the new pages; chart details; query keys; how the Strava callback page
reports errors; batch-size tuning within the limits above.
