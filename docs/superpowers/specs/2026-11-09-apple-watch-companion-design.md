# Apple Watch companion app: design

Status: draft 2, 2026-11-09, revised after a platform, a security-and-privacy and a fit-and-scope critique; nothing is built and no decision in section 15 is taken. Proposes ADR 0021, which extends ADR 0008 (a second wrist channel) and follows ADR 0006 (a new push provider); ADR 0002 is not changed (section 6). Sources: six survey notes of 2026-11-09 (outbound pipeline, ingest path, native auth, toolchain, WorkoutKit, HealthKit) and the Apple bridge research of the same day, none committed. Every `path:line` refers to `main` on that date. Apple behaviour comes from Apple documentation pages and WWDC23 session 10016 and WWDC24 session 10084, read that day through a summarising fetch, plus Apple Developer Forums threads 694223 and 824819 on locked-device delivery; what was not confirmed is listed in section 16. "The companion" is the working name of the iPhone app. No host, tailnet, account or person is named.

## 1. Purpose, and what the bridges already do

The owner asked for a native iPhone companion that is guaranteed to work with the running log, for beta testers who wear an Apple Watch: planned runs go onto the Watch, and finished Watch workouts come back into the log.

Bridges that exist today (bridge research, 2026-11-09):
- **Planned runs out.** The intervals.icu publish channel (ADR 0008) keeps the next 14 days in the runner's intervals.icu calendar. Intervals.icu Companion, a third-party iPhone app, turns those events into WorkoutKit workouts in Apple's Workout app. It needs an intervals.icu account and iOS 18.6 or later. Its pace targets were broken until build 34 (2026-03-23). Forum requests from October 2026 say it syncs only while the app is open. Whether workout sync needs a paid tier is unverified. Watchletic Club is an alternative that runs imported workouts in its own Watch app.
- **Runs in.** HealthFit (US$6.99) sends finished Watch workouts to intervals.icu, and the server's pull picks them up (built). Health Auto Export pushes to `POST /api/ingest/apple-health` (built), but it needs a Premium tier, its background runs are best effort, and it does not run while the phone is locked (no app can read Health data then; section 4). The browser import of a Health `export.zip` is built but manual.
- The beta audit recommended these bridges for testers and recommended deferring a native app until one of them fails.

Why build the companion anyway:
- **One tested contract instead of a chain.** Today a planned run passes through four steps owned by three parties: the server writes `WorkoutPlan` as intervals.icu text, intervals.icu stores it, a third-party app parses that text back, and WorkoutKit schedules it. Any of the three can change without notice. With the companion, the server's wire type and the app's mapper are tested against shared fixtures in this repository's CI, so a disagreement fails the `ci` check (section 11). "Guaranteed" means the contract is tested on every change. It cannot mean that Apple's Watch behaviour is guaranteed.
- **Less to set up.** A tester installs one app and Tailscale. Today the same tester needs an intervals.icu account, two bridge apps with their own tiers, and the permissions for each.
- **The plan's own structure on the Watch.** `WorkoutPlan` nodes become WorkoutKit steps directly (section 7), with no text in between.

What the companion adds over the bridges:
- **Honest delivery status.** The app reports what it scheduled. The intervals.icu route cannot see the watch and infers "On your watch" (ADR 0008:51-53, 106-107).
- **Richer runs in.** A pushed workout carries its route, so it gets a stored map track; Health Auto Export pushes get none (`server/providers/appleHealth.ts:280-302`). It also carries the heart-rate source for the HR-quality gate and a stable key from the HealthKit workout UUID; Health Auto Export falls back to the start time when it sends no `id` (`appleHealth.ts:212`).
- **The planned session's id** on the finished workout, as a matching hint (section 8).

Nothing in the engine, the plan or the other channels changes. The bridges remain the fallback and stay documented in the tester guide.

## 2. Scope of version 1, and non-goals

In version 1:
1. **Pairing and unpairing.** The app pairs with a token from the web app and can be unpaired from either side (sections 3 and 6).
2. **Plan out.** Publishable sessions of today to today+13 (runs and hikes) are scheduled through `WorkoutScheduler`. A changed session is scheduled again, and a session that leaves the plan or the window is removed. Today's rest advice withdraws today's workout.
3. **Delivery report.** The app tells the server what it scheduled. The app keeps the list anyway, and the server already has `WristPublication` (outbound note, section 6, item 3).
4. **Runs in.** Running and hiking workouts are read from HealthKit, starting 7 days before pairing. Each upload carries the route, heart-rate samples, distance, elevation gain, the device, and the scheduled plan id when HealthKit records one. Whether this ships in the first tester build or after it is decision D13.
5. **One screen.** The pairing state and server host, the 14 days with each session's state on the watch, the last sync, "Sync now", an Uploads switch, and a Health row: last workout read, last workout with a route, and a pointer to Settings > Health > Data Access when a recent outdoor workout came without route or heart rate. HealthKit hides a denied read, which looks like no data (notes-healthkit, section 3), so this row is the only way a tester learns of it. `getRequestStatusForAuthorization` re-shows the sheet for a type never asked.

Non-goals for version 1:
- **A watchOS app.** Not needed (section 4).
- **Strength, mobility, cross-training, race and rest sessions.** They are not publishable, and `toWorkoutPlan` throws for them (`shared/workouts/labels.ts:43-60`). The strength workout is derived on read and has its own surfaces (ADR 0014).
- **Wellness** (resting heart rate, HRV, sleep). See decision D9.
- **Cadence, power, laps and elevation loss** beyond what route altitudes give. These come in phase 6.
- **Check-in, rating, Done and Today in the app.** The web app stays the place for them.
- **Server push (APNs), deletion sync and history before the 7-day look-back.** Deleting a workout in Health deletes nothing on the server. The `export.zip` import already covers older history.
- **Other platforms, analytics, crash-reporting SDKs and third-party Swift packages.**

## 3. How a runner uses it

**Pairing.** The runner needs an iPhone that reaches the server's HTTPS name over Tailscale, a paired Apple Watch, and the TestFlight build. The origin is the HTTPS name of whichever shape the beta checklist settles: preferred, a Tailscale node that runs only the app and is shared with each tester, who does not join the tailnet; otherwise the tailnet with an access rule limited to that node.
1. In the web app on the iPhone, the runner opens Integrations > "Apple Watch app" and taps "Create pairing text". This is a card of its own with its words in `shared/copy`: `PushSetup` is written for Health Auto Export (its text, steps and `/api/ingest/<provider>` URL, `web/pages/IntegrationsPage.tsx:452-520`). It shows the text once, holding the token and the server origin. While intervals.icu sending is on, the card offers to turn it off through the existing disable and withdraw flow, so no session is on the Watch twice (section 5.4). Creating a new text while paired warns that the phone will be unpaired.
2. The runner opens the companion and pastes into a text field or through `PasteButton`. The app never reads the pasteboard from code, so iOS shows no "Allow Paste" prompt. It accepts only an `https://` origin, shows the host and asks for confirmation, then clears the pasteboard. It stores the token in the Keychain and fetches the plan; a 200 confirms the pairing and returns the account id (section 5.1).
3. A disclosure screen names what is sent (workout summary, route, heart rate, device) and to which host, with the Uploads switch. The app then asks for WorkoutKit authorisation (`WorkoutScheduler.requestAuthorization`), then HealthKit read access to workouts, workout routes, heart rate and distance.
4. The app shows the 14 days.

**First sync.**
- **Plan.** Sessions are scheduled in date order, up to the scheduler's cap (section 7), and the app sends its report. The web Plan page then shows each session as on the watch.
- **Runs.** A HealthKit anchored query reads workouts from 7 days before pairing and uploads them one per request. The duplicate pass folds in any that intervals.icu or Health Auto Export already delivered.

**A normal week.**
- **Before the run.** The Workout app on the Watch shows the companion's section with the day's workout (WWDC23 10016), and the runner starts it there. The app fetches the plan whenever it comes to the foreground, and in the background when iOS grants time, which is not guaranteed.
- **After the morning check-in.** If the check-in eases today's session, the eased version replaces today's workout at the next fetch. Until then, the web app shows today as "waiting", because the hash in the report differs from the current one (section 5.4). Opening the companion before the run makes the fetch happen at once.
- **After the run.** While the phone is locked, Health data is protected: no app can read it, and observer wakes are withheld until the database is available. A phone in a pocket after a run is normally locked, so the run is read after the next unlock, then uploaded, possibly up to an hour later (section 4). The server stores it and links it to the session.

**A re-plan mid-week.** `applyReplan` writes the change and the data version moves, so the next fetch gets a new body.
- A session whose hash changed is scheduled again.
- A session that moved to another day comes back with a new `externalId` (`shared/domain/sessionIdentity.ts:48-59`): the app removes the old one and schedules the new one.
- A session that is gone is removed. The Plan page shows "waiting" for each changed session until the report arrives.

**A missed sync.** The phone was off the tunnel, the app was force-quit, or iOS granted no background time.
- The Watch keeps the last schedule: possibly stale, but usable. Finished workouts wait in the app's outbox.
- The next foreground fetches the plan and empties the outbox. The app says "Last synced 2 days ago", and the web app reads the same from `DeliveryChannel.lastRunAt`. No copy says "missed" or "behind" (CLAUDE.md, Conventions).

**Unpairing.**
- **In the app.** "Unpair" removes the app's scheduled workouts (`removeAllWorkouts`), calls `DELETE /api/companion/pairing`, then deletes the Keychain item and every local file.
- **On the web.** Disconnect deletes the integration and the companion's delivery rows (section 6). The app's next call gets a 401 with `details.reason: 'pairing-revoked'`. After a second such answer it removes its scheduled workouts and the token and says it was unpaired; unsent workouts stay until the same account pairs again or the runner taps "Remove data". Any other 401 (a proxy page, a restored older database answering differently) stops syncing and shows "pairing needs attention", and nothing is deleted.
- **A lost phone.** Disconnect on the web, a password change (D11), or the owner's offboarding script (section 6).
- **Deleting the app.** Keychain items can outlive the app (section 16), so the first launch after an install deletes any item of the app's service before use, keyed on a marker file that a reinstall does not keep. The tester guide says to unpair before deleting the app.

## 4. Architecture

- **One iOS app** in SwiftUI, with no watchOS target. `WorkoutScheduler` runs on iOS 17 or later. Apple's Workout app runs the session and records the `HKWorkout`, and scheduled workouts reach the Watch through the system (WWDC23 10016). A watchOS app is needed only for a custom live screen, which is out of scope. The deployment target is decision D4.
- **Two code units** (section 10):
  - `RunningLogCore` is a Swift package with no UI: the wire models, the API client, the WorkoutKit mapper, the workout payload builder and the sync diff, a pure function from (the last fetched plan, the local schedule map) to the schedule, remove and report actions.
  - The app target holds the views, a HealthKit reader, a thin adapter over `WorkoutScheduler`, and background registration through `@UIApplicationDelegateAdaptor`.
- **One sync actor.** `SyncCoordinator` serialises `syncPlan()` and `flushOutbox()`. Triggers: the app coming to the foreground, a `BGAppRefreshTask`, a `BGProcessingTask` that requires network and external power (an overnight catch-up), a HealthKit observer wake, `protectedDataDidBecomeAvailableNotification`, and "Sync now".
- **Background delivery.**
  - **Setup.** `HKObserverQuery`s on the workout type and on `HKSeriesType.workoutRoute()` are registered in `application(_:didFinishLaunchingWithOptions:)`, with `enableBackgroundDelivery` and the `com.apple.developer.healthkit.background-delivery` entitlement. An observer only signals; an `HKAnchoredObjectQuery` then fetches.
  - **Locked phone.** Before any read the app checks `HKHealthStore.isProtectedDataAvailable()`. When it is false the wake ends, and the anchored query runs again on the protected-data notification, on foreground and on each BGTask run. Delivery and reads are expected only after an unlock.
  - **Late route and heart rate.** The Watch saves the workout first and finishes its route afterwards (`HKWorkoutRouteBuilder.finishRoute(with:metadata:)` takes the saved workout), and the samples reach the phone as separate synced objects, so the first wake can see a workout with neither. An outdoor workout with no route, or any workout with no heart-rate samples, waits in the outbox marked incomplete. It is read again on a delay, at each later wake and foreground, and sent as it is after 24 hours (a default). A later, fuller payload for the same UUID overwrites the stored row: on a rewrite that carries a route, `storeParsed` rebuilds the track, `trackV`, the stream and the HR-quality summary (`server/services/activityStore.ts:114-145, 208-216`).
  - **Completion handler.** Called once the payload or the incomplete marker is written. Upload is not awaited: HealthKit stops delivering after three failed responses.
  - **Work budget.** Building a payload (up to about 18,000 points) runs inside `beginBackgroundTask`, and the outbox file is written as a stream.
  - **Upload.** A background `URLSession` from the outbox file, relaunched through `application(_:handleEventsForBackgroundURLSession:completionHandler:)`. Its delegate refuses every redirect, so `Authorization` never reaches another host.
  - **Limits.** A force-quit app is not relaunched by either path, so the tester guide says not to swipe the app away. iOS may cap workout delivery at hourly (unverified).
- **Device storage.**
  - **Keychain:** the token, the server origin and the account id, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, no iCloud Keychain sync.
  - **Application Support files:** `plan.json` (the last body and its ETag); `schedule.json` (each `externalId` with its hash, date, state and WorkoutKit plan id); `anchor.bin` (the archived `HKQueryAnchor`); `outbox/<workout uuid>.json` (one payload per workout until it is uploaded).
  - **Account binding.** The anchor and each outbox entry record the account id they were made under. A new pairing sets them aside and sends no `If-None-Match` on its first fetch; if that fetch returns the same account id they are kept, otherwise they are deleted with the plan and schedule. No entry is ever uploaded under another account.
  - **File protection:** every file is excluded from backup and protected at `completeUntilFirstUserAuthentication`, so a background launch while locked can still upload an outbox file written earlier. It does not open the Health store, which stays unreadable until an unlock.
  - No database: a few dozen records do not justify Core Data (Opinion). No health data goes in `UserDefaults`.
- **Dates.** The app takes `today` and `tz` from the payload to decide what is past, never the phone's date, the same rule as the service worker's (ADR 0012).

## 5. Server side

### 5.1 The read endpoint for planned sessions

`GET /api/companion/plan` lives in a new router, `server/routes/companion.ts`, mounted in `server/app.ts` beside `/api/ingest` and `/api/calendar`, before `sameOriginGuard` (`app.ts:130-138`). The token is checked first, and the route takes no body.

```jsonc
{
  "wire": 1, "minWire": 1, "account": "hash", "today": "2026-11-09", "tz": "Area/City",
  "range": { "from": "2026-11-09", "to": "2026-11-22" },
  "sessions": [
    { "externalId": "uuid", "date": "2026-11-10", "order": 0, "action": "send", "hash": "sha256 hex",
      "workout": { "title": "Intervals, 50 min", "kind": "intervals", "eased": false, "totalSec": 3000,
                   "rpe": [6, 7], "description": "plain outline", "nodes": [ /* WorkoutNode[] as in types.ts */ ] } },
    { "externalId": "uuid", "date": "2026-11-09", "order": 0, "action": "withdraw", "cause": "rest-advice" }
  ]
}
```

- **One source.** The body is built from `buildDeliverables(deps, userId, { from: today, to: today + 13, today })` (`server/services/workouts.ts:82`) under `memoByVersion` with the name `companion.plan:<forecastStamp>` and `today` in the key. The memo key holds only the user, name, day and data version (`server/services/athleteState.ts:706`), the forecast is not state (`server/dataVersion.ts:84`), and the targets read it (`workouts.ts:131`), so the stamp goes in the name as `raiseOffer.ts:55` does. The pure mapper `toCompanionSession(deliverable)` in `shared/workouts/companion.ts` is the fourth renderer of the one `WorkoutPlan` (rule O1; ADR 0008:45-47); it chooses nothing and derives no target.
  - **What it copies:** the `nodes`, with the `StepTarget` union unchanged (bpm, and pace in s/km with the slow end first), plus `title` (the allowlisted `publicTitle`), `kind`, `eased`, `totalSec`, `description` and `targets.rpe`.
  - **What it leaves out:** `zonesNote`, `hotNote` and `source`. WorkoutKit cannot show them, and the less health text on the device the better.
- **Hash per session.** SHA-256 over canonical JSON of `[COMPANION_WIRE_VERSION, date, workout]`. The publish `contentHash` covers only the rendered text (`server/services/publish.ts:124-135`), so it cannot serve here. Targets follow the current zones (`targetsFor`), so a zone change changes the hash and the session is scheduled again.
- **Window.** `PUBLISH_HORIZON_DAYS` (`shared/workouts/horizon.ts:6`), the same 14 days as intervals.icu. No new constant.
- **Removal.** The list is the whole truth for the window. The app removes any `externalId` it scheduled that is no longer listed: done or skipped (`buildDeliverables` lists only sessions still to run, `workouts.ts:89-98`), moved (a new `externalId`), dropped by a re-plan, or past the window. No tombstones. Opinion: a 14-day list is small and complete, and tombstones would need storage that only the remote-event publisher keeps.
- **Validators.**
  - **Headers.** `ETag: W/"<account>.<publishChangeKey>.<wire>"`, `Vary: Authorization` and `Cache-Control: private, no-cache`. `account` is a hash of the user id: `publishChangeKey` (`publish.ts:157-167`) carries the user only inside the forecast stamp, which can be empty for two users, and `GET /api/today` tells users apart with `Vary: Cookie` (`server/routes/today.ts:31-33`), which a bearer client does not have. The key composes the data version, the day, `PARAMS_VERSION` and the forecast stamp, which covers everything the deliverables read.
  - **304.** An `If-None-Match` hit gets a 304 through `req.fresh` before any build, as `GET /api/today` does (`today.ts:33-35`).
  - **Over-invalidation.** The key moves on any write to a state model by any user and on every restart (`dataVersion.ts:269-275`), so it errs toward a needless rebuild, never a stale body. The per-session hash keeps a needless 200 from scheduling anything again.
- **Last sync.** Each 200 or 304 sets `DeliveryChannel(companion).lastRunAt`. The table is non-state, so this write starts nothing.

### 5.2 The delivery report

`PUT /api/companion/plan/report` takes `{ wire, runsIn, items: [{ externalId, date, hash, state, code? }] }`. The 16 KB JSON parser starts only after the token check, as the ingest router does.
- **States.**
  - `scheduled` writes `WristPublication.state = 'sent'`, with `sentHash` and `sentAt`; `removed` writes `withdrawn`.
  - `failed` takes a fixed code: `cap-reached` (the app reads the cap at run time), `unsupported` or `scheduler-error`. `alert-dropped` goes into `warnings`.
  - `runner-removed` (writes `owner-removed`, not scheduled again until the hash changes, as `decide()` does for intervals.icu, `publish.ts:728`) ships only if phase 0 shows the app can see a deletion made on the Watch.
- **Writes.** An idempotent replace keyed on `(userId, 'companion', externalId)`, the user being the token's, through a function in `server/services/publish.ts`, which owns the rows (CLAUDE.md, Providers). `desiredHash` is the server's current hash. An unknown `externalId` for that user is counted and ignored, so a report never touches another runner's rows.
- **`runsIn`.** True while the Uploads switch is on and HealthKit was asked. It is stored in `Integration.config` for J10 (section 5.3).

### 5.3 The ingest path

- **New push provider `apple-watch`.**
  - **Code.** `server/providers/appleWatch.ts`, with `parsePush`. The registry entry has the label "Apple Watch app (beta)", channels `['push']` and `wellness: false`. It is not `experimental`: that flag shows Garmin's risk paragraph on the card (`IntegrationsPage.tsx:34, 663, 671`).
  - **Pairing hook.** The entry carries an optional `pairing` hook (`onIssue`, `onRemove`) that the generic push-token and Disconnect routes call (`server/routes/integrations.ts:307-341`), as Disconnect already calls `prepareDisconnect` for a publish provider. The routes stay generic. For `apple-watch` the hook creates or deletes the companion `DeliveryChannel` and `WristPublication` rows and records `pairedAt` and `sessionVersion` in `Integration.config`.
  - **Route.** Workouts arrive through the existing `POST /api/ingest/apple-watch` (`server/routes/ingest.ts:36-189`). The token check runs before the 16 MB parser, and the router already handles `ImportBatch`, `SyncRun`, the integration status, `storeParsed`, the duplicate pass and the plan matcher. The router gains the per-token limiters of section 6 for every push provider.
- **Companion-native payload**, one workout per request:

  `{ wire, workout: { uuid, activity: 'running'|'hiking', indoor, start, end, tz, movingSec, distanceM, elevationGainM?, avgHr?, maxHr?, device: { name, model, externalHr }, planId?, route?: [{ t, lat, lng, alt? }], hr?: [{ t, bpm }] } }`

  A Zod schema bounds it: `uuid` a UUID, `planId` a UUID, at most 60,000 route points and 60,000 heart-rate samples, latitude, longitude, bpm and distance in range, `start` no later than now plus 5 minutes, `end >= start`, at most 48 hours and 400 km, `tz` a valid zone (defaults to tune in phase 1). `parsePush` maps it to `ParsedActivity` (`shared/types.ts:359-394`):
  - **Key and time:** `providerKey` is `apple-watch:<uuid>`, and the offset comes from `start`.
  - **Type:** `run`, with subtype `treadmill` when indoors. A hike becomes `cross` with subtype `hike`, the entry a hike session takes (`shared/domain/doneEntry.ts:10-26`).
  - **Track and samples:** `route` is set, so `storeParsed` builds a track (`activityStore.ts:119-120`). The samples `t`, `d` and `alt` come from the route, as `appleHealth.ts` already does, and heart rate is snapped to the route times.
  - **Source:** `hrSource` from `externalHr`, and `deviceName`.
- **Why not `/api/ingest/apple-health`.** Its token is one per runner and provider, so the companion would share it with Health Auto Export and a new one would break the other (`prisma/schema.prisma:554`, `integrations.ts:325`); its mapper stores no track and no `hrSource`; and the app would imitate another vendor's JSON (D6).
- **Idempotency.** `storeParsed` upserts on `(userId, providerKey)` (`activityStore.ts:154-156`), so a retried or fuller upload rewrites the same row. A rewrite keeps the session link: links live on `PlanSession`, and the matcher keeps an owner link (`server/services/execution.ts:319-340`). It replaces the summary fields, as for every source today, so an owner's edit of an `apple-watch` run's distance or date inside the late-route window is overwritten (accepted for version 1; there is no record of which fields an owner edited).
- **Deleted runs stay deleted.** The activity delete leaves no trace (`server/routes/activities.ts:362-367`), and the app re-reads 7 days after any new pairing, so a run the runner deleted (a private place, a wrong workout) would come back. A new non-state model `DeletedSourceKey` (`userId`, `providerKey`, `deletedAt`) is written when an activity of a push source is deleted, and the ingest route answers `ignored` for such a key. Rows older than 30 days are pruned by the daily job. It needs one migration with its `migrations.test.ts` case, an entry in `NON_STATE_MODELS`, and `EXCLUDED_MODELS` with the reason "a deletion marker, no runner data to restore".
- **J10.** The `apple-watch` row has a run channel, so `sourceRows` (`server/services/todayHealth.ts:265-284`) would name it silent after `j10.silentDays` for a tester who uses it for planned runs only and keeps HealthFit, counted from `createdAt`. `sourceRows` leaves out an integration whose config holds `runsIn: false`.
- **Duplicate pass.**
  - **Rank.** `SOURCE_RANK` gains an entry for `apple-watch`; without one it would rank 1, like CSV (`shared/domain/duplicates.ts:13-28`; D7).
  - **Match.** Starts within 120 s and distances within 5 % make a confirmed duplicate, and the lower rank becomes the copy; a tie makes the later arrival the copy (`server/services/duplicates.ts:230`).
  - **Hikes.** Cross-training has no duplicate rule (`shared/domain/duplicates.ts:46-52`), so a hike that arrives by two paths stays twice. Version 1 accepts this, and the tester guide asks for one path in per runner.
- **Size.** A 5-hour run at one point per second is about 18,000 route points plus heart rate, roughly 2 to 3 MB of JSON (Opinion, an estimate). The app gzips the body; the JSON parser inflates gzip by default (`node_modules/body-parser/lib/read.js:106`). Above 6 hours the app keeps one point per 2 s, so a 30-hour race stays under the 16 MB limit (`ingest.ts:15`).
- **Removing what a token wrote.** No batch delete exists (`server/routes/imports.ts` has none). Version 1 has the per-activity delete and the offboarding script; a delete by source and date range is listed in phase 6.

### 5.4 How it fits ADR 0008, `readWristItems` and `WRIST_CHANNEL`

- **A new delivery channel.** `COMPANION_CHANNEL = 'companion'` is written beside `WRIST_CHANNEL` in `server/services/wristItems.ts`, the one place channel names are written.
  - **Rows.** A `DeliveryChannel` row exists while the phone is paired, with `enabled` true and `lastRunAt` as the last fetch. `WristPublication` rows come from reports.
  - **No migration for the channel.** `channel` is a free string in both tables (`schema.prisma:641, 662`), and both tables are already non-state (ADR 0008:103-105).
- **Not a `PublishProvider`.** That interface needs a remote for the server to `upsert`, `withdraw` and `list` (`server/providers/types.ts:202-221`), but here the phone pulls. The calendar feed was kept out of the registry for the same reason (ADR 0008:54-56, 96-98). The publish job selects only its own channel (`server/jobs/scheduler.ts:462-465`), so a companion row never starts an intervals.icu run.
- **`readWristItems`.** Today it reads only `WRIST_CHANNEL`, and `wristItemStatus` compares only the stored date with the session's (`server/serialize.ts:346-369`); no status read knows the current hash. Changes:
  - `WristItemsArgs` gains `channel` and, for the companion, `currentHashes: Map<externalId, hash>`, which the caller takes from the `companion.plan` memo, so `wristItems.ts` keeps its imports (it imports neither `publish.ts` nor `today.ts`).
  - `wristItemStatus` takes `watchConfirmed` in place of `garminLinked` and an optional `currentHash`. For the companion, a `sent` row whose `sentHash` equals it reads `on-watch` with no 15-minute delay, since scheduling is local; a stale `sentHash` reads `waiting`.
  - **Cost.** Today's `watch` slot, `wristStatus` and `tomorrowNotOnWatch` then depend on that memo while the companion is the active channel. The first such read after a write or a forecast refresh builds 14 days of deliverables, the same build the next plan fetch reuses.
- **Readers of the active channel.** Today's `watch` slot (`todayWatchSlot`, `wristItems.ts:127-148`), `wristStatus` (`publish.ts:1397`) and `tomorrowNotOnWatch` (`todayHealth.ts:114`) read the runner's active wrist channel: the companion while paired, otherwise intervals.icu (D8). `registerTodayStamp` gains a stamp over the companion rows (`publish.ts:1455`), so a report moves Today's ETag.
- **Both routes at once.** The publish job keeps writing the intervals.icu calendar while its channel is enabled, and the third-party Intervals.icu Companion would then put the same sessions in the Workout app. Pairing offers to turn intervals.icu sending off (section 3), and the tester guide says to remove the third-party Workout-app sync.
- **Cross-surface test.** The rule of ADR 0008:45-47 extends to the companion wire: for one fixture plan it carries the same numbers as the FIT file, the intervals.icu text and the ICS outline.
- **ADR 0021.** It extends ADR 0008 with a second wrist channel that the device reads, delivery truth from the device's report, and one push provider whose token also authorises that channel's routes.

## 6. Auth

**The device token is the push token of the `apple-watch` integration.**
- **Issue.** `POST /api/integrations/apple-watch/push-token` (`integrations.ts:307-328`) makes 32 random bytes (`server/crypto.ts:73-75`), stores only their SHA-256 in `Integration.ingestTokenHash`, and returns the plain token once. The pairing hook creates or enables the companion `DeliveryChannel` row and records `pairedAt` and the user's `sessionVersion`.
- **Scope.** The token is accepted only by `POST /api/ingest/apple-watch` and the `/api/companion/*` routes. Both use one check extracted from the ingest router (`ingest.ts:36-54`) into a helper. Every other route still needs the session cookie, so a lost phone exposes plan reads and workout writes, not the account. Forged workouts would still reach the engine's load and re-plans, a coaching-safety effect, which the per-token budget, the payload bounds and the revocation paths below limit.
- **Transport.** `Authorization: Bearer`, never in a URL, unlike the calendar feed (ADR 0008:111-113). The logger already redacts that header (`server/logger.ts:7`).
- **Devices.** One device per runner, because there is one integration per runner and provider (`schema.prisma:554`). Pairing a new phone replaces the hash (`integrations.ts:325`), so the old phone gets a 401.
- **Ending a pairing.**
  - **From the web:** Disconnect calls `DELETE /api/integrations/apple-watch` (`integrations.ts:330`), which deletes the integration; the pairing hook deletes the companion's rows.
  - **From the app:** Unpair calls `DELETE /api/companion/pairing`, which does the same for the token's own user only.
  - **Password change or reset:** the check compares the `sessionVersion` in `Integration.config` with the user's, so a password change and the owner's `npm run reset-password` (which raises it, `server/auth/password.ts:56`) end the pairing (D11).
  - **The owner.** A new script, `npm run offboard -- <email> [--delete]`, clears every push token and the companion rows and raises `sessionVersion`; with `--delete` it deletes the user, whose rows go by `onDelete: Cascade` (each model checked in phase 5). Today no script or route deletes an account (`scripts/` holds backup, create-user, reset-password and restore).
  - **Refusals.** A well-formed token that matches no row, or whose version moved, gets a 401 with `details.reason: 'pairing-revoked'` (the `ApiErrorCode` union stays as it is).
  - **Visible.** The card shows "Paired on" (`pairedAt`) and the last sync, so a stale pairing shows. No time-based expiry (rejected: it would force testers to re-pair on a schedule).
- **Rate limits.** The address limiter allows 10,000 requests per 15 minutes (`server/auth/rateLimit.ts:140-145`), and the per-user limiter sits below `requireAuth` (`app.ts:143-144`), so nothing bounds one token today, and each ingest request is a transaction with track building and the duplicate pass. The companion router and the ingest router, for every push provider, get:
  - refusal limiters per token hash and per address, as `createFeedLimiters` does (`rateLimit.ts:198`);
  - a success budget per token of 120 requests per 15 minutes (a default), enough for a first-sync flush of 7 days.

  The app backs off and fetches the plan at most once per 5 minutes, except on "Sync now".
- **On the device.** The token is a Keychain item readable after the first unlock that never leaves the device. Wiping follows section 3.
- **On the server.** Only the hash is stored. The token is never logged or returned again, and no environment variable is added (CLAUDE.md, Providers). Rotating `SESSION_SECRET` does not affect it.

Alternatives:
- **A device-token table and a bearer branch over the whole API** (the auth note's recommendation). For (**Opinion**): later features such as Today, ratings and Done could reuse every route. Against (**Rule**): it changes the request order in CLAUDE.md and the consequence at ADR 0002:41, so ADR 0002 needs an amendment. Against (**Fact**): it needs a new model, a migration case, an export exclusion and a classification. Against (**Opinion**): without scopes it equals a full session on a phone, and adding scopes rebuilds the narrowing the chosen token has by construction.
- **Reuse the `apple-health` push token.** Against (**Fact**): Health Auto Export already holds it (one per provider), and it opens only the ingest route (`ingest.ts:38, 56`), so the plan cannot be read with it.
- **Password sign-in and the cookie.** Against (**Fact**): writes need a forged `Origin` (`server/auth/middleware.ts:22-46`). Against (**Fact**): the password would sit on the phone, and the session expires after 30 days with no refresh (`server/auth/session.ts:5`). Against (**Fact**): the per-email sign-in budget is shared with the web (`rateLimit.ts:105`).
- **A 60-second pairing code exchanged for the token** (the export-token pattern, `server/routes/export.ts:46-92`): decision D12.

## 7. Mapping `WorkoutPlan` to WorkoutKit

The mapper is a pure function in `RunningLogCore` from a wire session to a WorkoutKit `CustomWorkout`, wrapped in `WorkoutPlan(.custom(workout), id: UUID(externalId))`. It is checked at run time with `CustomWorkout.supportsActivity`, `supportsGoal` and `supportsAlert`.

| `WorkoutPlan` | WorkoutKit | Note |
| --- | --- | --- |
| `kind: 'hike'` | activity `.hiking`, else `.walking` | If neither is supported, the session is reported `failed`/`unsupported`. |
| any other kind | activity `.running` | Location `.outdoor`; the runner can switch to indoor at the start (watchOS 10.1, WWDC24 10084). |
| `title` | `displayName` | Already the allowlisted public title (kind and length). |
| first node, a step with intent `warmup` | `warmup` | WorkoutKit takes one warm-up. |
| last node, a step with intent `cooldown` | `cooldown` | WorkoutKit takes one cool-down. |
| a run of consecutive single steps | one `IntervalBlock`, `iterations: 1` | Blocks stay in plan order. |
| `repeat { count, steps }` | one `IntervalBlock`, `iterations: count` | One level only (`shared/workouts/types.ts:39-43`), so no nesting is needed. |
| step intent `work` or `steady` | purpose `.work` | |
| step intent `recover`, or `walk: true` | purpose `.recovery` | A run-walk break keeps its `label`. |
| `durationSec` | goal `.time(durationSec, .seconds)` | Every step has a duration (`types.ts:31`); no distance or open step exists. |
| `label` | step `displayName` | watchOS 11 or later; watchOS 10 shows the step type. |
| target `open` | no alert | The Watch shows current heart rate. |
| `hr-ceiling { floorBpm, ceilingBpm }` | `HeartRateRangeAlert(floorBpm...ceilingBpm)` | The floor exists so that only the ceiling alerts (`types.ts:16`). |
| `hr-band { lowBpm, highBpm }` | `HeartRateRangeAlert(lowBpm...highBpm)` | |
| `pace { slowSecPerKm, fastSecPerKm }` | `SpeedRangeAlert` from 1000/slow to 1000/fast m/s, current speed | Slow pace is low speed. |

Worked examples: cruise intervals are a `repeat` of `bouts - 1` work-and-recovery pairs followed by one trailing work step (`shared/engine/plan.ts:137-163`), which becomes a block with `iterations: bouts - 1`, then a one-step block; strides are a second block after the easy running. A step carries at most one target in the model already, so WorkoutKit's rule of one alert per step costs nothing.

What cannot be expressed, and how it degrades:
- **RPE-only targets.** RPE exists only for the whole session (`targets.rpe`), and WorkoutKit has no effort alert. A session in `effort` mode, or a day steered by heat where every step is `open`, runs as timed steps with no alert; the effort range is in the app's session view and in `description`. TrainingPeaks does not sync RPE-only workouts at all (bridge research, section A).
- **Open-ended steps.** None exist in `WorkoutPlan`, so `.open` is unused. A future "until lap" step would map to it; how the runner advances such a step is unverified.
- **Strength, mobility, cross-training, race and rest.** Not in the list (section 2). A later version could schedule strength as a title-only `.traditionalStrengthTraining` workout with an open goal (support unverified), or keep it in the web app.
- **Hikes.** Pace alerts are probably unsupported for hiking. When `supportsAlert` is false, the alert is dropped, the timed steps are kept, and the report carries `alert-dropped`. The same applies to an indoor pace alert before watchOS 11.
- **Units.** The `units` field is ignored; the Watch shows its own units.
- **Limits.** Step and block limits are undocumented. If WorkoutKit refuses a plan, the session is reported `failed`/`unsupported` and the web app keeps the FIT file and the session sheet.
- **Cap.** The app reads `WorkoutScheduler.maxAllowedScheduledWorkoutCount` at run time (15 or 50 by different unconfirmed sources; never hard-coded), schedules in date order up to it and reports the rest as `cap-reached`, to be scheduled as earlier days pass.
- **Rescheduling.** A changed hash means `remove(plan, at:)`, then `schedule(newPlan, at:)` with the same id. Whether WorkoutKit accepts a reused id is unverified; if not, the id becomes a name-based UUID of `externalId` and `hash`, with a local map back to the `externalId`.
- **Date.** Scheduled at `DateComponents(year:, month:, day:)` of the session date; whether the scheduler needs an hour is unverified.
- **Past days.** At each sync the app removes scheduled workouts dated before the payload's `today`; whether they persist otherwise is unverified.

## 8. Linking a completed Watch workout to its planned session

- **The path that exists.** `storeParsed` calls `runExecutionForActivity` (`activityStore.ts:261-272`; `execution.ts:382`). It matches by date and kind within `MATCH_SPREAD_DAYS = 1` (`execution.ts:34`) among the sessions of the user's own active plan (`activePlan`, `where: { userId, status: 'active' }`, `execution.ts:59-61`) and writes `linkSource: 'auto'`. It works for every source today and needs no change for version 1.
- **The hint.** WorkoutKit extends `HKWorkout` with `workoutPlan` (Apple's HKWorkout page), so a workout started from a scheduled plan carries that plan's id, which is the session's `externalId`. The app sends it as `planId`.
  - **Server side.** `ParsedActivity` gains an optional `plannedExternalId`. The matcher looks it up only in that same per-user active plan, and prefers it when it is still to run and within the spread; otherwise it ignores the hint. A `planId` from another runner's plan therefore links nothing.
  - **Limits.** The hint never replaces an owner link (`linkSource: 'owner'`, `schema.prisma:248`), and it never links a session that the matcher would refuse.
  - **What it fixes:** two sessions on one day, and a session started a day early from the Workout app's "View More" list.
- **Sequencing.** The app sends `planId` from phase 4, so no app update is needed later. The server reads it from phase 6, once a device test confirms that `HKWorkout.workoutPlan` is set (unverified). An ignored hint does no harm.
- **Duplicates.** When another source's copy becomes the original, `moveConfirmedLogs` hands it the session link (`duplicates.ts:35`).
- **A stale schedule.** A workout run from a schedule that missed a sync can carry an `externalId` the plan no longer has; the hint is then ignored and matching by date applies.

## 9. Privacy and security

- **What the app reads from HealthKit:** running and hiking workouts, their routes, heart rate and distance. It requests no write access; whether scheduling needs any HealthKit share type is unverified.
- **What leaves the phone.** Only the paired server receives anything, over HTTPS inside the Tailscale tunnel, and only while the Uploads switch is on. Each workout sends its summary, route points, heart-rate samples, device name and model, the HealthKit workout UUID and the plan id. The plan fetch brings back titles, steps, heart-rate and pace targets, the RPE range and the outline. Nothing else: no analytics, no crash SDK, no third-party package. TestFlight's own crash reports and feedback go to Apple, and testers choose whether to send them.
- **On the device.** HealthKit data stays in Apple's store. The outbox holds a workout until the server accepts it; the plan cache holds the targets. Every file is excluded from backup: guideline 5.1.3 forbids health information in iCloud, and whether device backup counts is unverified. The Keychain item is for this device only.
- **In transit.** The server has no public endpoint. HTTPS through a `tailscale serve` certificate for the shared node's name means App Transport Security needs no exception; the offline shell already needs a secure origin (README, "Offline use"). The app refuses `http://` origins and redirects. WireGuard sits underneath.
- **On the server.** Tokens are stored hashed and logs carry no bodies; track ends stay hidden when tracks are served (`User.hideMapEnds`); the full-data export covers the new activities and tracks.
- **App Review and the privacy policy.**
  - **Guidelines.** 5.1.1(i) requires a privacy-policy link in App Store Connect and inside the app; 5.1.1(ii) requires consent for collecting user data; 5.1.3 forbids using HealthKit data for advertising, marketing or data mining and requires disclosing the specific health data collected; 2.5.1 requires that HealthKit serve health and fitness.
  - **Consent.** The HealthKit sheet grants read access only. The disclosure screen of section 3 names what is uploaded and to which host before the first upload, and the Uploads switch stops reading and sending without unpairing; turning it on again sends the workouts finished meanwhile.
  - **Privacy manifest.** `ios/App/RunningLog/PrivacyInfo.xcprivacy` declares Health, Fitness and Precise Location as collected, linked to the user and not used for tracking, and the required-reason entries for `UserDefaults` and file timestamps.
  - **App Privacy answers.** The same three types, collected because testers' data reaches a server the developer operates.
  - **The policy.** `docs/privacy-companion.md`, linked by URL. It states what is read and where it goes, who operates the server, retention, and only the deletion paths that exist: per-activity delete, Disconnect, the full-data export, and the owner's offboarding script; and how to revoke (unpair, and the Health settings).
  - **Export compliance.** HTTPS only.
- **Reviewers.** A reviewer cannot reach a tailnet. Internal TestFlight builds skip review. External testing would need a demo mode that reads the bundled synthetic fixtures (D3).
- **The public repository.** The bundle identifier and the team ID live in an untracked `ios/App/Local.xcconfig`, and the committed `Local.xcconfig.example` holds placeholders. The app ships no server address, and fixtures are synthetic.

## 10. Repository layout, toolchain and CI

```text
ios/
  .swift-format                       line length 100 (matches Prettier), 4-space indent
  Packages/RunningLogCore/            SwiftPM, Swift 6 language mode, no third-party dependency
    Sources/RunningLogCore/           Wire models, API client, WorkoutKit mapper, payload builder, sync diff
    Tests/RunningLogCoreTests/        Swift Testing, reads ../../../../tests/fixtures/companion/
  App/RunningLog.xcodeproj            committed; iOS target only; Swift 5 mode, strict concurrency "targeted"
  App/RunningLog/                     SwiftUI views, HealthKit reader, WorkoutScheduler adapter, BGTask registration,
                                      Info.plist, entitlements, PrivacyInfo.xcprivacy
  App/Local.xcconfig.example          DEVELOPMENT_TEAM and PRODUCT_BUNDLE_IDENTIFIER placeholders
tests/fixtures/companion/             wire fixtures (server-built) and ingest fixtures (app-built), synthetic
```

**App target checklist** (each confirmed in the phase 0 spike; the notes recalled them without a source):
- Entitlements: HealthKit, and `com.apple.developer.healthkit.background-delivery`.
- Info.plist: `NSHealthShareUsageDescription`; `UIBackgroundModes` with `fetch` and `processing`; `BGTaskSchedulerPermittedIdentifiers` naming the refresh and processing tasks, without which `BGTaskScheduler.submit` throws.
- `@UIApplicationDelegateAdaptor` for the observer registration at launch and `handleEventsForBackgroundURLSession`.
- `PrivacyInfo.xcprivacy` (section 9).

**Language mode.** The package uses Swift 6 language mode: it has no HealthKit or BGTask callbacks. The app target uses Swift 5 mode with strict concurrency set to targeted, because HealthKit and BGTask completion handlers are not `Sendable` and every bridge to the `SyncCoordinator` actor would need workarounds (Opinion). Against: moving the app to Swift 6 later is a migration of its own.

**Tools, one per job.**
- **Build and tests:** `xcodebuild` and SwiftPM, with Swift Testing (`import Testing`); XCTest only if UI tests are ever added. A committed `.xcodeproj` means no XcodeGen or Tuist, which would be a second tool.
- **Format:** `swift format lint --strict`. It ships with the Xcode toolchain and is what the owner's other Swift repository uses. No SwiftLint at first.
- **Dependencies:** zero third-party packages (WorkoutKit, HealthKit, URLSession and Swift Testing are Apple's), so neither a Dependabot entry nor an audit gate is needed.

**CI.**
- **The `ios` job.** It runs on the pinned `macos-26` label with `timeout-minutes: 20` and always starts.
  - **Change detection.** A first step diffs against the base branch and sets a flag when anything changed under `ios/**`, `shared/workouts/**`, `shared/types.ts`, `tests/fixtures/companion/**` or `.github/workflows/ci.yml`. Pushes to `main` always run in full.
  - **Steps behind the flag:** `swift format lint`; the package tests with `xcodebuild test -destination 'platform=iOS Simulator,…'`, so the iOS slice that ships is the one built and tested; and an unsigned `xcodebuild … CODE_SIGNING_ALLOWED=NO build` of the app for the Simulator.
  - **Why not `on.paths`.** That filter would skip the required check, and a skipped job reads as passed (`ci.yml:111-113`).
- **The aggregator.** `ci` gains `ios` in `needs` and in its result loop (`ci.yml:115-131`).
- **Local use.** `npm run ios:check` runs the same commands. It stays out of `npm run check`, so a checkout without Xcode still passes `check`, the same treatment as `plan:report`.
- **Fixture checks.** They run in the existing `unit` job on Linux.
- **Housekeeping.** `.prettierignore` and `.dockerignore` gain `ios/`. CLAUDE.md gains: "Commands" (`ios:check`, `offboard`), "Gates" (five jobs), "Structure" (`ios/`), "Providers" (`publish` stays the one outbound provider channel, and the companion is a second wrist channel the phone pulls, like the calendar feed, not a provider channel), and the "Request order" convention (the companion router is a third token-checked router before `requireAuth`, and its 16 KB report parser a third parser ahead of it). ADR 0021's consequences list the same edits.

**Trade-offs.**
- **Monorepo.** One PR changes the TypeScript type, the fixture and the Swift model, and one `ci` check sees all three. Against: macOS minutes and a different release cadence (D10).
- **An installed app cannot be hot-fixed.** The wire is additive-only within a `wire` number. A breaking change raises `minWire`, and an older app then stops scheduling and says to update from TestFlight.
- **Line length.** 100 rather than 120 is a Preference: it matches Prettier, while the owner's other Swift repository uses 120.

## 11. Testing

- **Server unit tests** (`tests/unit`).
  - `toCompanionSession` for each node and target kind, cruise intervals, the run-walk ladder, a hike, an eased session and a withdrawal; hash stability across a re-encode, and hash change on any number, the date or the wire version.
  - `appleWatch.parsePush`: route to track, indoor to treadmill, hiking to `cross`/`hike`, `hrSource`, key format, and rejection of each out-of-bounds field.
  - The cross-surface test: one fixture plan, the same numbers in the FIT file, the intervals.icu text, the ICS outline and the companion wire.
  - `wristItemStatus` with a current hash: a re-plan, an eased day and a zone change each read `waiting` until a report carries the new hash.
- **API tests** (`tests/api`, `noNetwork()`, with `expectNoRefusedFetches` at the end of each `afterEach`).
  - **Auth.** 401 with `pairing-revoked` for an unknown token and after a password change; the refusal and success limiters on both routers; the `apple-watch` token refused on every other route (a scan over the mounted routers); Disconnect and the offboarding script cascade to the delivery rows.
  - **Two runners.** Token A never returns B's sessions, and A's ETag never gets a 304 for B; a report from A naming B's `externalId` writes nothing for B; a `planId` from B's plan on A's workout links nothing; Unpair with A's token affects only A; the `apple-watch` token is refused on `/api/ingest/apple-health` and the reverse.
  - **Plan.** 200, then 304 on the same ETag, and a fresh body after a state write. A forecast refresh with no state write changes the next body. The window is today to today+13. A moved session comes back with a new `externalId`. Rest advice gives `withdraw`.
  - **Report.** Idempotent replay, and each state read back through `readWristItems` and Today's `watch` slot.
  - **Ingest.** Idempotent by UUID; a fuller rewrite adds the track and keeps an owner link; a deleted run's key answers `ignored`. A duplicate against a synthetic intervals.icu activity and against an `apple-health` push.
  - **J10.** A plan-only pairing (`runsIn: false`) gives no `source-silent` note.
  - **Request order.** `bodyParsers.test.ts` gains plain `http.request` cases with a large body and a wrong token for `/api/companion/plan/report` and `/api/ingest/apple-watch` (401, no body read), and the 16 KB limit on the report.
- **Contract.**
  - **The generator.** `scripts/companion-fixtures.ts` builds wire fixtures with the real engine over synthetic athletes: one per `StepTarget` kind, a repeat, cruise intervals, a ladder, a hike, an eased session and a withdrawal.
  - **The Vitest side** checks that the committed files equal the generator's output and parse with the Zod schema.
  - **The Swift Testing side** decodes every fixture, re-encodes it to equal JSON, and maps each to a `CustomWorkout`. It proves the mapper's output, not that the Watch accepts it: `supports*` is not asserted in CI, because its answer in the Simulator is unverified. Acceptance is a device test.
  - **Inbound.** Swift writes `ingest-*.json` fixtures from synthetic workout values, and Vitest feeds them to `parsePush`.
  - **Coverage.** A test fails when a schema property has no `CodingKey` or listed skip.
- **Swift unit tests** against protocol fakes of the scheduler, HealthKit and URLSession: the mapper (warm-up and cool-down extraction, block order, iterations, speed conversion, dropped alerts), the sync diff (schedule, reschedule, remove, cap, a workout the runner deleted), the outbox state machine (incomplete, 24-hour release, account binding), and the 401 handling by reason.
- **Device tests** (manual, on the owner's iPhone and Watch, for each release). Section 16's device items, an overnight run with the phone locked and Tailscale at its defaults, and an outdoor run logged from its first wake. Results go in the PR without account data, as ADR 0008's consequences asked for the intervals.icu route. The Simulator cannot run HealthKit background queries (Apple's background-delivery page), so each background debug loop is a device run that waits on iOS scheduling.

## 12. Distribution

- **Apple Developer Program.** US$99 a year, with TestFlight included (developer.apple.com/programs, read 2026-11-09).
- **TestFlight.** Internal testers are App Store Connect users on the team, up to 100; external testers are invited by email or link, up to 10,000. External groups need Beta App Review for the first build of a version, and an internal group must exist before an external one. Builds expire after 90 days.
- **Upkeep.** A new build at least every 90 days; a monthly build from `main` is the plan (Opinion). Apple usually ships a major iOS, watchOS and Xcode each September (not confirmed from an Apple page), so testers may already run a release newer than 26; each major needs the matching Xcode, and the WorkoutKit and HealthKit checks run again.
- **What each tester needs:** an iPhone and an Apple Watch on the floors of D4, the Tailscale app with the shared node (or tailnet access, per the beta checklist), the TestFlight app, and an Apple ID email for the invitation. The tester guide says one path in per runner, to remove any third-party Workout-app sync, to unpair before deleting the app, and not to swipe the app away.
- **Cost.** US$99 a year, the macOS CI minutes (section 10) and the owner's time. Testers pay nothing, where the bridges cost about US$6.99 per tester plus optional tiers.

## 13. Phased build plan

Effort is in focused days, an Opinion. No iOS project exists yet, so signing, entitlements and background work are new, and background behaviour can be debugged only on a device; the ranges allow for that. Each phase is its own PR or PRs, and phases 1 and 2 can overlap.

| Phase | Effort | Work | What it proves |
| --- | --- | --- | --- |
| 0. Enrol and spike | 5 to 8 days plus the enrolment wait | Throwaway app on the owner's devices. First, one hard-coded workout onto the Watch through `WorkoutScheduler`; the rest is timeboxed: a fixture plan, a run, the observer and anchored query, an upload over the tunnel to a local server, the section 10 checklist. Record the iOS, watchOS and Xcode versions of every device and tester, and read the WorkoutKit and HealthKit release notes of the newest major. | Section 16's device items. Stop if workouts do not reach the Watch, if `workoutPlan` linking and date matching both fail, if an overnight locked phone delivers nothing after its first unlock, if the route is missing at the first wake and never arrives, or if the shared node is not reachable from the app's `URLSession` with On Demand at its defaults. |
| 1. Server contract | 6 to 9 days | ADR 0021; `shared/workouts/companion.ts` and its hash; the plan and report routes; the `apple-watch` provider, its pairing hook, bounds, rank and limiters; `DeletedSourceKey` and its migration; `readWristItems` with a channel and hashes; J10's `runsIn`; the fixture generator; tests (section 11). Linux CI only. | The server side end to end with `curl`. |
| 2. Swift core | 5 to 8 days | `RunningLogCore` (models, client, mapper, sync diff), the contract and unit tests, the `ios` CI job, `npm run ios:check`. | The contract holds on both sides in one `ci` check. |
| 3. App: plan to the Watch | 8 to 12 days | Signing and provisioning, pairing, Keychain, foreground and refresh sync, scheduling and removal, the report, the one screen, the 401 handling. | Two weeks of the owner's plan on the Watch through a re-plan, a move and an eased day. |
| 4. App: runs in | 10 to 14 days | HealthKit authorisation and the Health row, observers and anchored query, protected-data handling, the incomplete outbox, background upload, `planId`, the disclosure and Uploads switch. | A run reaches the log within an hour of the first unlock after it, with its route and heart rate, links to its session and is folded with an intervals.icu copy; a denied route shows in the Health row. |
| 5. Beta | 3 to 5 days plus any review wait | The App Store Connect record, the privacy manifest and policy, a TestFlight group, the tester guide in the README, the card wording, `npm run offboard`. | Testers install, pair and run. |
| 6. Later, each optional | S each | The `planId` hint in the matcher, wellness types, cadence, power and laps, a QR or pairing code, a "Sync now" App Intent, APNs, a delete by source and date range. | Each is measured against a tester's need first. |

Total: about 8 to 12 weeks of focused work for phases 0 to 5 (Opinion). With D13's recommendation, phases 1 to 3 and 5 ship to testers first (about 6 to 9 weeks), and phase 4 follows with a second privacy pass.

## 14. Risks

- **Locked phone.** Health data cannot be read while the phone is locked, and observer wakes wait for the unlock, so a run reaches the log only after the next unlock. Mitigations: reads on the protected-data notification, foreground and BGTask runs; the wording in section 3; a phase 0 stop item.
- **Late route and samples.** The first wake can see a workout without its route or heart rate. Mitigations: the incomplete outbox, the route observer, and the idempotent rewrite.
- **Background reliability.** HealthKit delivery may be capped at hourly, `BGTaskScheduler` promises no timing, and a force-quit stops both. Runs arrive late, and an eased day may reach the Watch only when the app opens. Mitigations: catch-up on foreground, an honest "waiting" status, a line in the tester guide.
- **The tunnel at background launch.** Whether Tailscale's on-demand tunnel is up when HealthKit wakes the app is untested, and whether On Demand behaves the same for a shared node is unknown. An open public issue (tailscale/tailscale #18292, iOS 26.2) reports that on-demand is hard to control. Uploads queue until the next foreground. This is the main reliability risk.
- **Undocumented WorkoutKit limits:** the scheduling cap, reuse of an id, past items, step limits. Phase 0 exists to find these before the build.
- **Today changing after the fetch.** Rest advice or an eased session can come after the last fetch, and with no APNs the Watch may hold the planned version. The report makes the mismatch visible; it cannot prevent it.
- **Two routes to the Watch.** A runner who keeps intervals.icu sending and its third-party app gets every session twice. Mitigations: the offer at pairing and the tester guide.
- **Silent denials.** A tester who declines routes or heart rate sends workouts without them, which looks like no data. Mitigation: the Health row.
- **App Review.** External testing could be refused because reviewers cannot reach a private server. Internal testing avoids review (D3).
- **Upkeep for one developer.** A Swift codebase beside the TypeScript one, rebuilds every 90 days, Xcode upgrades, US$99 a year and macOS CI minutes. The bridges remain if the app is dropped.
- **Health data of other people.** The owner operates the server that holds testers' health data. This is already true of the web app; the companion makes it explicit in a privacy policy, a manifest and Apple's App Privacy answers.
- **Wire drift against an installed build.** Mitigated by the additive-only rule, `minWire` and the contract tests.
- **Duplicates across paths.** A runner who also uses HealthFit or Health Auto Export gets copies that the duplicate pass folds by rank and arrival order. Hikes are not folded.
- **A lost phone or a departed tester.** The token reads the plan and writes workouts. Disconnect, a password change and the owner's offboarding script end it at once; the card shows when it last synced.
- **Overpromising.** "Guaranteed" covers the contract, not Apple's behaviour. The tester guide says what happens when a sync is missed.

## 15. Decisions for the owner

**D1. Build now, or spike first.** Options: (a) commit to phases 0 to 5; (b) run phase 0, then decide; (c) bridges only, building on evidence of a failure.
- Recommendation (b). **Fact:** at least seven behaviours this design rests on are undocumented (section 16: the cap, `HKWorkout.workoutPlan`, reuse of an id, delivery latency, delivery after a locked night, route arrival, the tunnel at launch). **Opinion:** 5 to 8 days on the owner's own devices finds a blocker before 8 to 12 weeks of work.
- Against: **Fact:** whether a free personal team can use the HealthKit capability is unverified, so the spike may need the US$99 enrolment first. **Opinion:** testers wait longer and use the bridges meanwhile.

**D2. Developer account: individual or organisation.**
- Recommendation: individual. **Fact:** US$99 a year either way (developer.apple.com/programs). **Opinion:** an organisation needs a legal entity and a D-U-N-S number (unverified) for a hobby project.
- Against: **Opinion:** the owner's legal name appears as the developer to testers (where it appears in TestFlight is unverified).

**D3. TestFlight testers: internal or external.**
- Recommendation: internal. **Fact:** internal builds skip Beta App Review (Apple's "Invite external testers" page). **Fact:** a reviewer cannot reach a tailnet server, so external testing needs a demo mode first. **Opinion:** five testers fit easily.
- Against: **Fact:** each internal tester becomes an App Store Connect user on the owner's team. **Opinion:** that is more access than a tester needs; the least-privileged role is unverified.

**D4. Minimum OS: iOS 17 with watchOS 10, iOS 18 with watchOS 11, or iOS 26 with watchOS 26.**
- Recommendation: iOS 18 with watchOS 11. **Fact:** step names on the Watch and indoor pace alerts arrived in watchOS 11 (WWDC24 10084). **Opinion:** one floor fewer to test.
- Against: **Fact (recalled, unverified):** watchOS 11 needs Series 6 or later, SE (second generation) or Ultra, so Series 4, Series 5 and the first SE stay on watchOS 10. Ask testers for their watch models, and the version phase 0 records, before choosing.

**D5. Auth: the `apple-watch` push token scoped to the companion routes, or a device-token table with a bearer branch over the whole API.**
- Recommendation: the scoped push token (section 6). **Fact:** the issue, rotate and revoke routes exist (`integrations.ts:307-341`). **Fact:** no migration is needed for auth. **Rule:** CLAUDE.md's request order names the ingest router and the calendar feed as the token-checked routers ahead of the guard; the companion router needs one added clause. **Opinion:** a narrow token limits what a lost phone exposes.
- Against: **Opinion:** each later feature in the app (ratings, Done) needs its own companion route. **Fact:** one device per runner (`schema.prisma:554`). **Fact:** the token check scans that provider's rows (`ingest.ts:44-50`), which is fine for five runners and linear in their number.

**D6. Inbound payload: companion-native, or Health Auto Export's JSON on `apple-health`.**
- Recommendation: companion-native. **Fact:** the Health Auto Export path stores no track and no `hrSource` (`appleHealth.ts:280-302`), and its token is shared (`schema.prisma:554`).
- Against: **Opinion:** a second Apple mapper to maintain. **Fact:** an owner who keeps Health Auto Export gets two keys for one run, which only the duplicate pass folds.

**D7. Source rank of `apple-watch`: 5, 4 (tied with intervals.icu and `apple-health`), or 3.5.**
- Recommendation: 4, with one path in per tester in the guide. **Fact:** it reads the same HealthKit store as `apple-health`, which ranks 4 (`duplicates.ts:13-22`). **Opinion:** revisit once cadence, power and laps arrive in phase 6.
- Against: **Fact:** a tie makes the later arrival the copy (`duplicates.ts:230`). **Opinion:** 3.5 would always keep intervals.icu's FIT-based copy, with its cadence, power and laps, as the original.

**D8. Watch status on the web: the active channel (the companion while paired, else intervals.icu), merged channels, or a line per channel.**
- Recommendation: the active channel. **Fact:** `readWristItems` and `todayWatchSlot` read one channel today (`wristItems.ts:47, 127-148`); the change adds a channel and the current hashes from the companion memo (section 5.4). **Opinion:** a runner wears one watch.
- Against: **Opinion:** a runner with both a Garmin and an Apple Watch sees only the companion's status. **Fact:** a runner who keeps intervals.icu sending and its third-party app gets each session twice on the Watch while the status shows one channel (`scheduler.ts:462-465`).

**D9. Wellness (resting heart rate, HRV, sleep) in version 1.**
- Recommendation: no; phase 6. **Opinion:** keeps version 1 small. **Fact:** HealthKit may replace resting-heart-rate samples of the current or previous day (Apple's `restingHeartRate` page), so the app would need deletion handling.
- Against: **Fact:** readiness reads wellness, so a tester with only the companion gets readiness advice without wearable data until phase 6.

**D10. Repository: `ios/` in this repository, or a separate repository.**
- Recommendation: `ios/` here. **Opinion:** one PR and one `ci` check cover both sides of the contract. **Preference:** no second branch protection, issue tracker or Dependabot setup.
- Against: **Fact:** macOS minutes cost about ten times Linux outside any free allowance; whether standard runners are free for public repositories is unverified. **Opinion:** the app's release cadence differs from the server's.

**D11. Does a password change end the pairing?**
- Recommendation: yes, for the companion token. **Fact:** `npm run reset-password` raises `sessionVersion` (`password.ts:56`), so binding the token to it gives the owner a revocation for a departed tester with no new route. **Opinion:** a runner who changes the password after losing a phone expects to be signed out everywhere. **Fact:** the app keeps unsent workouts on that 401 (section 3), so no run is lost.
- Against: **Fact:** the ingest and calendar tokens survive a password change (`sessionVersion` is checked only for the cookie, `middleware.ts:66`), so the tokens differ. **Opinion:** a runner must re-pair after every password change.

**D12. Pairing in version 1: paste a pairing text, or scan a QR code or open a `runninglog://pair` link holding a 60-second code.**
- Recommendation: paste, with the guards of section 3 (`PasteButton`, `https://` only, the host confirmed, the pasteboard cleared, redirects refused). **Fact:** the card already shows a token once. **Opinion:** enough for 2 to 5 testers, and it adds no anonymous route ahead of `requireAuth`.
- Against: **Opinion:** a long-lived token still crosses the clipboard, which Universal Clipboard can carry to a Mac on the same Apple ID. **Fact:** the export-token pattern (`export.ts:46-92`) and `createFeedLimiters` exist, so a code exchange is a small build, and with it no long-lived secret is ever on screen.

**D13. Version 1: plan out only, or both directions.**
- Recommendation: plan out first. Phases 1 to 3 and 5 ship to testers; phase 4 follows when a tester's bridge fails or the plan side has held for a month. **Fact:** runs in already has working bridges (HealthFit to intervals.icu, Health Auto Export; section 1), while planned runs out is the fragile chain. **Fact:** runs in carries the HealthKit entitlement, background delivery, the locked-phone and tunnel risks (section 14), a new provider and rank, and the health-data answers under guideline 5.1.3. **Opinion:** it lands the tested contract sooner.
- Against: **Fact:** testers keep HealthFit and an intervals.icu account meanwhile, so "less to set up" waits. **Opinion:** "guaranteed in both directions" is delayed, and the App Privacy answers and policy change a second time.

## 16. What this design did not verify

- **WorkoutKit (device tests in phase 0):** the value of `maxAllowedScheduledWorkoutCount` and what happens at the cap; whether removing a plan and scheduling one with the same id works; whether past or completed items persist; whether the runner can delete a scheduled workout on the Watch, and how the app sees that; whether `HKWorkout.workoutPlan` is set after a scheduled run; `supportsActivity` for hiking and walking; `supportsAlert` for heart-rate and speed ranges, outdoors and indoors, on a device and in the Simulator; step and block limits; whether a scheduled date needs an hour; how soon a schedule reaches the Watch; any WorkoutKit change in the newest major release; how the runner advances an open step.
- **HealthKit:** whether the workout type is delivered immediately or hourly on iOS; how delivery resumes after a locked night (forum threads, not Apple's pages); how long after the workout its route and heart rate reach the phone; behaviour after a force-quit; how an `HKWorkout`'s device reveals an external heart-rate strap; the source of cadence; whether a free personal team may use the HealthKit capability; whether scheduling needs a HealthKit share type; whether Health Auto Export's workout `id` is the HealthKit workout UUID; the Info.plist keys and background modes of section 10 (recalled).
- **Device:** that Keychain items outlive the app's deletion (widely reported; not read on an Apple page); which watch models watchOS 11 drops.
- **Network:** whether the Tailscale tunnel is up at a background launch and how fast it reconnects, for a shared node and for tailnet membership; that App Transport Security accepts a `tailscale serve` certificate with no exception (recalled, not tested); the payload sizes in section 5.3 (estimates).
- **Distribution and policy:** whether internal TestFlight needs a privacy-policy URL; the least-privileged App Store Connect role for an internal tester; where an individual account's name shows to testers; the D-U-N-S requirement; whether App Privacy answers and a privacy manifest are checked for a TestFlight-only build; the export-compliance wording; the current major iOS, watchOS and Xcode; billing of macOS runners for public repositories and the Xcode version on the runner image.
- **This repository:** no code was written or run and no Swift was compiled. The line references were spot-checked on `main` for `app.ts`, `ingest.ts`, `integrations.ts`, `wristItems.ts`, `serialize.ts`, `workouts.ts`, `publish.ts`, `today.ts`, `athleteState.ts`, `raiseOffer.ts`, `activityStore.ts`, `activities.ts`, `execution.ts`, `todayHealth.ts`, `IntegrationsPage.tsx`, `duplicates.ts`, `schema.prisma`, `rateLimit.ts` and `scheduler.ts`; the rest are as the notes gave them. Whether every model cascades on a user delete is checked in phase 5.
- **Effort:** every estimate in section 13 is an Opinion.
