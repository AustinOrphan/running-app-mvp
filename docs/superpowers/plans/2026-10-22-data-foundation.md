# Data foundation — implementation plan

> For agentic workers: one task per engineer, in its own worktree, test first. Read the spec
> `docs/superpowers/specs/2026-10-22-data-foundation-design.md`, the **Global Constraints**
> of `docs/superpowers/plans/2026-10-21-running-app-rewrite.md`, `CLAUDE.md`, and only your
> own task below plus the Interfaces it consumes.

**Goal:** files, provider sync, weather, profile, wellness, feedback fields and the activity
detail page, as specified.

**Base branch:** `feat/evidence-engine`. Groups run in order; tasks inside a group run in
parallel and touch only their own files.

## Global constraints (in addition to the rewrite plan's)

- Every network client takes an injected `fetch: typeof fetch`; tests use synthetic
  responses; no test touches the network.
- No new environment variables. Secrets go through `server/crypto.ts`.
- Only Task D1 changes `package.json`, `package-lock.json`, `prisma/`, `server/app.ts`,
  `web/App.tsx`, `web/api/client.ts`, `shared/types.ts`, or any `web/api/*.ts` hooks file.
- Fixtures are synthetic: no real names, places, routes or run history; coordinates in
  fixtures are 0.00/0.00 or a made-up offset.
- Store start coordinates rounded to 0.01°; never store lat/lng streams.

## Shared contract (written by D1 into `shared/types.ts`, then frozen)

Types exactly as spec 2.2 and 2.3 (`ActivityStreamData`, `Lap`, `HrHistogram`, `Injury`,
`Availability`, `Terrain`, `ParsedActivity`), plus:

```ts
export type Feel = -2 | -1 | 0 | 1 | 2
// Activity gains the spec 2.2 fields; ActivitySource becomes `string` (registry-validated).
export interface AthleteProfile { birthYear: number | null; sex: 'female' | 'male' | 'unspecified' | null
  heightCm: number | null; weightKg: number | null; hrMax: number | null
  hrMaxSource: 'measured' | 'estimated' | null; hrRest: number | null; lthr: number | null
  thresholdPaceSecPerKm: number | null; runningSinceYear: number | null; injuries: Injury[]
  availability: Availability; longRunDay: Weekday; terrain: Terrain; strengthPreference: 0 | 1 | 2 | 3
  timezone: string; homeLat: number | null; homeLng: number | null; useHomeWeather: boolean }
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export interface WellnessInput { date: string; restingHr: number | null; hrvRmssd: number | null
  hrvSdnn: number | null; sleepSec: number | null; sleepScore: number | null; weightKg: number | null
  vo2max: number | null }
export interface WellnessDay extends WellnessInput { id: string; notes: string | null
  source: 'manual' | string; updatedAt: string }
export interface ProviderInfo { key: string; label: string; experimental: boolean
  channels: Array<'pull' | 'push' | 'upload' | 'folder'>; wellness: boolean; docsUrl: string }
export interface IntegrationStatus { provider: string; info: ProviderInfo
  status: 'disconnected' | 'connected' | 'needs_auth' | 'error'; config: Record<string, unknown>
  pushEnabled: boolean; lastSyncAt: string | null; lastSyncStatus: string | null; lastError: string | null }
export interface ActivityDetail { activity: Activity; stream: (ActivityStreamData & { sampleSec: number }) | null
  laps: Lap[] | null; hasFile: boolean }
export interface UploadedFile { name: string; bytes: Uint8Array }
```

Defaults: `Availability` every day `{ available: true, maxMin: null }`; `Terrain` all false;
`longRunDay 'sat'`; `strengthPreference 2`; `timezone 'UTC'`; `useHomeWeather true`.

API additions (spec 2.10, generalized for the provider framework):

| Method and path | Body / query | Response |
| --- | --- | --- |
| `GET/PUT /api/profile` | profile fields | `AthleteProfile` |
| `GET /api/wellness?from&to`; `PUT /api/wellness/:date` | `WellnessInput` minus date, plus `notes?` | `WellnessDay[]`, `WellnessDay` |
| `POST /api/imports/files` | `{ batchId?, files: [{ name, dataBase64 }] }` (≤ 20 files, 16 MB body) | 201 `ImportBatch` |
| `POST /api/imports/parsed` | `{ batchId?, source, activities: ParsedActivity[], wellness: WellnessInput[] }` (client-parsed exports, ≤ 500 activities) | 201 `ImportBatch` |
| `GET /api/activities/:id/detail` | | `ActivityDetail` |
| `GET /api/activities/:id/file` | | original file attachment, 404 when none |
| `GET /api/integrations` | | `IntegrationStatus[]` (every registry provider, connected or not) |
| `PUT /api/integrations/:provider` | provider-specific connect body | `IntegrationStatus` (+ `authorizeUrl` for OAuth providers) |
| `GET /api/integrations/:provider/callback` | OAuth `code`, `state` | 302 to `/integrations?connected=<provider>` or `?error=` |
| `POST /api/integrations/:provider/sync` | `{ from? }` | 202 `IntegrationStatus` |
| `POST /api/integrations/:provider/push-token` | | `{ token }` shown once; replaces any previous token |
| `DELETE /api/integrations/:provider` | | 204 |
| `POST /api/ingest/:provider` | bearer token; provider payload | `{ activities: n, wellness: n }` |
| `GET /api/weather/forecast` | | `{ hours: [{ time, tempC, dewPointC, humidityPct, windKph }] }` or 404 without home location |

Hooks (D1, `web/api/`): `profile.ts` `useProfile useUpdateProfile`; `wellness.ts`
`useWellness({from,to}) useSaveWellness`; `integrations.ts` `useIntegrations useConnectIntegration
useSyncIntegration useDisconnectIntegration useCreatePushToken`; `activities.ts` adds
`useActivityDetail(id)`; `imports.ts` adds `useImportFiles` and `useImportParsed`.
Query keys extend `keys` with `profile wellness integrations activityDetail`.

---

## Group D0

### Task D1: Scaffold the data foundation

**Files:** `package.json`, `package-lock.json`, `prisma/schema.prisma`, new migration
`prisma/migrations/<ts>_data_foundation/`, `shared/types.ts`, `server/crypto.ts`,
`server/providers/registry.ts`, `server/providers/types.ts`, stubs for every file named in
later tasks, `server/app.ts`, `server/serialize.ts`, `web/App.tsx`, `web/api/*.ts`,
`web/pages/MorePage.tsx`, `tests/fakeFetch.ts`, `tests/unit/server/crypto.test.ts`,
`tests/unit/shared/types.test.ts`.

- Install `fit-file-parser`, `fast-xml-parser`, `fflate` (dependencies) and `saxes`
  (devDependency). No other packages.
- Schema exactly as spec 2.2 plus `Integration.ingestTokenHash` and `ImportedFile`; generate
  the migration with `prisma migrate dev --create-only` and commit it.
- `server/crypto.ts`: `encryptSecret(plain: string, sessionSecret: string): string`,
  `decryptSecret(blob: string, sessionSecret: string): string` (throws `SecretError` on any
  failure), `hashToken(token: string): string`, `newToken(): string` (32 bytes, base64url),
  `tokensEqual(a, b): boolean`. Tests: round trip; tampered tag throws; other secret throws;
  two encryptions of the same text differ.
- `server/providers/types.ts`: the interfaces of spec 2.6 verbatim (`ProviderCtx`,
  `RemoteActivityRef = { id: string; startUtc: string }`, `PullProvider`, `PushProvider`,
  `UploadProvider`). `registry.ts`: `PROVIDERS: Record<string, { info: ProviderInfo;
  pull?: PullProvider; push?: PushProvider; upload?: UploadProvider }>` with entries for every
  provider in spec 2.6.1, each importing its (stub) module; `getProvider(key)` throws
  `notFound` for unknown keys.
- `server/app.ts`: mount `/api/ingest` (ingest router, Task D10) after the global limiter and
  BEFORE `sameOriginGuard`; register `profileRouter`, `wellnessRouter`, `integrationsRouter`,
  `weatherRouter` with the protected routers; `/api/imports/files`, `/api/imports/parsed` and
  `/api/ingest` get a 16 MB JSON limit, everything else stays at 1 MB.
- `serialize.ts`: `toActivity` covers the new fields; add `toProfile`, `toWellnessDay`,
  `toIntegrationStatus(row | null, info)`; `loadProfile(prisma, userId): Promise<AthleteProfile>`
  returns defaults when no row exists.
- `web/App.tsx`: routes `/activities/:id`, `/integrations`, `/profile`; `MorePage` links to
  Integrations and Profile. Pages are placeholders with their `<h1>`.
- `tests/fakeFetch.ts`: `fakeFetch(routes: Record<string, (req: Request) => Response | Promise<Response>>)`
  keyed by `METHOD url-prefix`; unmatched calls throw.
- Finish: `npm run check`, `npm run build`, `npm run test:e2e`; commit
  `chore: scaffold the data foundation`.

## Group DA (parallel)

### Task D2: Activity file parsers

**Files:** `shared/importers/files/{fit,gpx,tcx,summarize,index}.ts`,
`tests/fixtures/fit/buildFit.ts`, `tests/fixtures/files/*.gpx|*.tcx`,
`tests/unit/shared/files-*.test.ts`.
**Produces:** `parseActivityFile(name: string, bytes: Uint8Array, opts: { timezone: string }):
ParsedActivity[]` (throws `RangeError` with a reason on unreadable files), `summarize(parsed:
ParsedActivity): ActivitySummary` where `ActivitySummary = { movingSec, hrHistogram,
decouplingPct, gapDistanceM, stream: ActivityStreamData & { sampleSec: 10 } }`,
`localDateTime(startUtc, utcOffsetMin | null, timezone): { date, startTime }`.
Tests (each with exact expected values): a FIT built by `buildFit` with 3600 one-second
records at a steady 3.0 m/s and HR 140 for 30 min then 147 → `decouplingPct` ≈ 5.0 (±0.1);
HR histogram sums to elapsed seconds; `gapDistanceM` equals distance on flat and exceeds it
on a constant +8% grade; FIT sport `running` sub-sport `trail` → run/trail; a two-session
multisport FIT → two activities; `providerKey` `fit:<serial>-<time_created>`; GPX with
Garmin TrackPointExtension HR; TCX laps; a GPX in a timezone at UTC+13 lands on the next
local date; BOM and CRLF tolerated; a truncated FIT throws `RangeError`.

### Task D3: Duplicates across sources

**Files:** `shared/domain/duplicates.ts`, `server/services/duplicates.ts`, their tests.
Implements spec 2.4 exactly; keeps `findPossibleDuplicate` behaviour for rows without
`startUtc`. New exports `SOURCE_RANK: Record<string, number>`, `matchActivities(a, b):
'start' | 'date' | null`. `markDuplicates(prisma, userId, ids)` now also demotes an existing
lower-ranked row when a richer one arrives, re-pointing its duplicates. Tests: file vs
strava same start → strava confirmed duplicate of file, whichever came first; manual vs
intervals → manual possible; 121 s apart → no match; distance 5.1% apart → no match;
dismissed rows stay dismissed on re-sync.

### Task D4: Profile, wellness and weather

**Files:** `server/routes/{profile,wellness,weather}.ts`, `server/services/weather.ts`,
`server/providers/openMeteo.ts`, their tests.
Profile bounds from spec 2.10 (zod strict object; `hrMax > lthr` cross-check; rounding of
`homeLat/homeLng` to 0.01 on write). Weather: `enrichWeather(deps, userId, { limit, fetch,
now })` per spec 2.9 (archive vs forecast by age, midpoint hour, grouping by 0.1° and
contiguous dates); `getForecast(deps, userId, fetch)` with a one-hour in-memory cache.
Tests use `fakeFetch` with responses shaped like the Open-Meteo sample checked 2026-10-22.

### Task D5: intervals.icu provider

**Files:** `server/providers/intervals.ts`, `tests/unit/server/providers-intervals.test.ts`.
Spec 2.6.2. `connect({ athleteId, apiKey })` verifies `GET /api/v1/athlete/{id}` (401 →
`validationError('intervals.icu rejected the API key')`). `fetchActivity` prefers
`/file` through `parseActivityFile` (D2 interface; stub returns `[]` until merge, so tests
inject a fake parser via ctx), falls back to streams. `listWellness` maps the five fields.

### Task D6: Strava provider

**Files:** `server/providers/strava.ts`, `server/providers/oauthState.ts`, tests.
Spec 2.6.3. `authorizeUrl(config, redirectUri, state)`, `exchangeCode`, `refreshIfNeeded`
(refresh when expiring within 5 minutes; calls `ctx.saveSecret`), `listActivities` paging
with `after`, `fetchActivity` from streams, sport mapping (`Run`, `TrailRun`, `VirtualRun`
→ run with subtypes road/trail/treadmill; `Walk`, `Hike`, `Ride`, `Swim` → cross;
`WeightTraining` → strength), rate-limit stop at 80% of either window (throws
`RateLimitPause` carrying the cursor). `oauthState.ts`: `signState(userId, secret, now)` /
`verifyState(state, secret, now)` with a 10-minute expiry.

### Task D7: Garmin Connect provider (experimental)

**Files:** `server/providers/garmin.ts`, `server/providers/garminSso.ts`,
`tests/unit/server/providers-garmin.test.ts`.
Spec 2.6.4 and `docs/research/integrations-2026-10.md`. `connect(input)` with modes
`login`, `mfa`, `tokens` (zod discriminated union; `acknowledgeRisk: true` required);
pending MFA sessions in a module-level `Map<userId, { cookies, expiresAt }>` (10 minutes);
`refreshIfNeeded` serialised per user with a promise lock; `listActivities` by date range;
`fetchActivity` downloads the ZIP, unzips with `fflate`, parses the first `.fit` with D2's
`parseActivityFile`; `listWellness(from, to)` for at most 30 days. Throttle one request per
second (inject a `sleep` in ctx so tests run instantly) and 200 per run; 429/403 throws
`RateLimitPause` with `retryAfterSec 21600`. Tests with `fakeFetch`: successful login →
tokens stored, password absent from every saved value and log line; MFA path; invalid
credentials → `validationError`; 403 on login → error message pointing at token import;
token import accepts the python-garminconnect JSON shape; refresh on 401 rotates and saves
the new pair once even with two concurrent calls; 429 mid-run pauses with the cursor kept.

### Task D8: Apple Health export and push

**Files:** `server/providers/appleHealth.ts` (push), `shared/importers/appleHealth.ts`
(export reducer), `tests/fixtures/apple/*.xml|*.json`, `tests/unit/shared/appleHealth.test.ts`,
`tests/unit/server/providers-appleHealth.test.ts`.
Spec 2.6.5. Push: `parsePush(body)` maps Health Auto Export v2 JSON to `ParsedActivity[]`
and `WellnessInput[]` plus `ignored: Record<string, number>`; heart-rate points outside
`[start, end]` dropped; miles and feet converted; `route` → cumulative haversine distance,
altitude, rounded start location. Export reducer: `createAppleExportReducer(opts: { timezone })`
returning `{ onOpenTag(name, attrs), onCloseTag(name), passOneResult(): { workouts, wellness },
startPassTwo(workouts), passTwoResult(): ParsedActivity[] }`, plus
`attachRoute(activity, gpxText)` using D2's GPX parser. Tests drive the reducer with a
synthetic `export.xml` through `saxes` in Node: two workouts, HR records inside and outside
their windows, resting HR, HRV SDNN (to `hrvSdnn`), sleep stages summed per night to the
wake date, body mass in lb converted to kg; the push mapper with a synthetic payload
including the recovery-series quirk and an unknown metric reported under `ignored`.

### Task D9: Activity store

**Files:** `server/services/activityStore.ts`, `tests/api/activityStore.test.ts`.
`storeParsed(deps, userId, parsed: ParsedActivity, opts: { source: string; importBatchId:
string | null; file?: { name: string; format: 'fit'|'gpx'|'tcx'; bytes: Uint8Array };
channel: 'upload'|'folder'|'provider'|'push' }): Promise<{ outcome: 'imported'|'updated'|'duplicate'; activityId: string }>`
per spec 2.7 (summary via D2 `summarize`, local date via profile timezone, gzip with
`node:zlib`, `ImportedFile` row, duplicate pass). `storeWellness(deps, userId, rows, source)`
upserts by date and never overwrites manual fields with nulls. Tests: re-storing the same
`providerKey` updates provider fields but keeps `rpe`, `feel`, `pain`, `notes`; owner-edited
`type` survives; a file stored twice by bytes is `duplicate` via `ImportedFile`.

## Group DB (parallel)

### Task D10: Integrations, sync, ingest, folder and scheduler

**Files:** `server/routes/integrations.ts`, `server/routes/ingest.ts`,
`server/services/sync.ts`, `server/services/folder.ts`, `server/jobs/scheduler.ts`,
`server/index.ts` (start the scheduler), tests.
Routes per the contract table; `PUT /:provider` dispatches to the provider's `connect`
and stores `secret` encrypted; folder provider's connect validates the path exists and is a
directory. `syncProvider` per spec 2.8 (runs one at a time per provider; `RateLimitPause`
records `lastSyncStatus 'paused'` and keeps the cursor). Ingest: bearer token checked with
`tokensEqual(hashToken(token), row.ingestTokenHash)`; 401 otherwise; payload goes to the
provider's `parsePush`, then the store. Folder: `scanFolder(deps, userId, path)` reads new
files (by SHA-256 via `ImportedFile`), parses with D2, stores with channel `folder`.
Scheduler: `startScheduler(deps, { fetch })` returns `stop()`; jobs never overlap.
Tests: connect/disconnect; encrypted at rest (DB value is not the plain key); sync stores
activities and wellness and advances the cursor; pause on rate limit; ingest 401 without
token, 200 with; folder scan imports a synthetic FIT once and skips it on the second scan;
`SESSION_SECRET` change → `needs_auth`.

### Task D11: File and parsed imports, activity detail and file download

**Files:** `server/routes/imports.ts` (add the two endpoints only),
`server/routes/activities.ts` (add `/:id/detail`, `/:id/file`; `feel` and `pain` in the
body schema with bounds), tests.
`POST /imports/files`: base64 decode, `parseActivityFile` per file (`.fit .gpx .tcx`;
anything else is a per-file error), store each, one `ImportBatch` (or append to `batchId`
if it belongs to the user, source `file`, under an hour old). Report rows carry the file
name. `POST /imports/parsed` validates `ParsedActivity` with zod (array lengths aligned,
≤ 100 000 samples) and stores with the given registry source.

## Group DC (parallel, web)

### Task D12: Import dialog — files and Apple Health

**Files:** `web/pages/ImportDialog.tsx` (+ css), `web/import/*` (unzip, gunzip, batching,
Apple Health worker per D8), `tests/web/import-files.test.tsx`.
Kinds: Smashrun CSV, Generic CSV (existing), Activity files, Apple Health export (a Web
Worker runs D8's reducer over `fflate` streaming unzip and `saxes`, two passes, routes
matched by time, then batches of 200 activities to `useImportParsed`). Files:
nested ZIP and `.gz` handled with fflate; batches of ≤ 20 files and ≤ 12 MB base64;
progress "n of m files"; aggregated report; unsupported entries listed.

### Task D13: Integrations page

**Files:** `web/pages/IntegrationsPage.tsx` (+ css), `tests/web/integrations.test.tsx`.
One card per registry provider in registry order: status, last sync, Connect form per
provider, Sync now, backfill date, Disconnect; push providers show "Create push token"
(token shown once with copy button and setup steps); experimental providers show their
risk text before the form; the Strava card lists the API-application steps with the exact
callback domain derived from `window.location.host`.

### Task D14: Profile page

**Files:** `web/pages/ProfilePage.tsx` (+ css), `tests/web/profile.test.tsx`.
Sections: About you, Heart rate, Pace, Availability (per weekday toggle and max minutes;
long-run day), Terrain, Strength preference, Injury history (add/remove rows), Location and
timezone ("Use my location" rounds to 0.01°; timezone select defaults to
`Intl.DateTimeFormat().resolvedOptions().timeZone`). Saves with `useUpdateProfile`;
field errors from the server shown inline.

### Task D15: Activity detail page and feedback capture

**Files:** `web/pages/ActivityDetailPage.tsx` (+ css), `web/components/charts/StreamChart.tsx`,
`web/components/FeelPicker.tsx`, `web/pages/ActivitiesPage.tsx` (rows link to detail),
`web/pages/ActivityForm.tsx` (feel and pain fields), `web/pages/DashboardPage.tsx`
("How did it go?" card: runs and races from the last 7 days with no RPE and no feel, each
with RPE 1-10, feel chips, pain 0-10, Save), tests.
Detail per spec 2.11; charts share one x-axis (distance, or time when distance is missing);
units follow settings; weather shows °C or °F by units (`mi` → °F).

## Group DD

### Task D16: End to end and docs

**Files:** `tests/e2e/07-files-and-detail.spec.ts`, `tests/e2e/08-profile-integrations.spec.ts`,
`README.md` (Integrations section: every provider's setup steps, what data each brings,
risks of the experimental ones, Docker volume for the watched folder), `CLAUDE.md`
(providers convention), `docs/STATUS.md`.
E2E: upload a synthetic FIT built at test time, see it in the list, open detail, see charts
and laps; rate it from the Today card; fill the profile and reload; integrations page lists
every provider (no network).
