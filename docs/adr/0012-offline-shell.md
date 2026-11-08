# 0012. The installed app opens offline from a hand-written service worker that keeps six reads (five at first, the race plan added 2026-11-07), and the device's copy of health data is purged with the session

Status: Accepted 2026-10-23 (#554); amended 2026-11-07 (#659; the race plan is a sixth kept read, see the addendum); amended 2026-11-07 (Done and a rating are queued writes, see the second addendum)

## Context

At a trailhead with no signal the runner wants to open the installed app and see today's session, its
explanation and a way to say how they feel. Phase 3a (design spec
`docs/superpowers/specs/2026-10-22-coach-phase3a-design.md`, sections 7.1, 7.3 and 7.6) asks for that,
and for a check-in tapped there to be kept until the connection returns. Five choices needed a
decision: how the shell and the answers are kept on the device, which answers, for how long, what
happens to them when the session ends, and how an update replaces a shell that an open page is still
using. The answers hold health data: the session, the readiness signals, the check-in, the race
prediction and the health notes of Today.

## Decision

A hand-written worker, `web/sw/sw.js`, keeps the shell and five API reads. `web/sw/buildSw.ts` writes
it into the build with the build id and the list of files to keep substituted. No library and no new
dependency are used.

- **Shell.** The page, every script and style chunk (the lazy ones too: the seven tap-opened sheets
  and the research corpus that the Explain drawer reads), the manifest, the icons and the latin fonts
  are kept at install in `rl-shell-<build id>`. The build id is twelve hex digits over the worker's
  source and the name and bytes of each kept file. Two builds are kept; `/assets/*` is served from any
  kept build, newest first. The worker skips waiting and claims open pages. `main.tsx` reloads once on
  `vite:preloadError`, and not again within a minute. While the browser reports offline it does not
  reload at all, because a reload cannot fetch a newer build, and the sheet shows its "did not
  open" notice instead (amended 2026-10-31; `tests/web/offline.test.tsx`).
- **Strategies.** Navigations and the five API reads are network first with a 2.5 s limit: the
  network's answer, else the kept copy when the request fails, answers 502 to 504 or is not answered
  in time. An answer that arrives after the copy was served is kept for next time. Kept files of the
  shell are answered from the cache first.
- **Allowlist.** Exactly `GET /api/auth/me`, `/api/setup`, `/api/settings`, `/api/today` (with no query
  or with one `date=YYYY-MM-DD`) and `/api/research/params`. Only a 200 answer to a GET is kept, in
  `rl-api-v1`, stamped with the time. Nothing else under `/api` is touched: not the watch status, not
  the brief, not the explain figures, no write.
- **Time limits.** A kept answer is served for 36 hours, the research parameters for 14 days. The
  limit bounds how long a copy is served, not how long it is stored. An expired copy is deleted when
  a read meets it, when Today is saved and at the first request of each worker's life (a browser
  stops an idle worker and starts one again when the app is next opened, so that sweep runs on the
  next open). A phone that is not opened again keeps its copies until a sign-out or a 401 empties
  them, or until the browser clears the site's data.
- **Sign-out.** A 401 from an allowlisted read empties `rl-api-v1` and `rl-meta`. The page does the
  same, through `purgeDeviceData()` and nothing else, on sign-out and on any 401 it sees, and at
  sign-in and account creation, together with the outbox and the unsent drafts. `purgeApiCache()`
  is called only from `purgeDeviceData()`. The page's in-memory query cache is dropped as well: at
  sign-out, at sign-in and account creation, and on a 401 once the auth gate has left the pages, so
  a second account in the same tab never meets the first one's Today.
- **Today's copy** is picked by the server's day: the kept answer whose date is today in the `tz` it
  carries (a plain copy before a preview of the same day), else the newest earlier one, never a day
  that has not come. `isoDateInZone` is written out in the worker the same way as in
  `shared/dates.ts`, so the worker and `useServerToday` agree on when the day ends. The worker marks
  the copy it serves (`servedFromCache`) and strips from every copy it keeps the watch slot and the
  health note about the watch (`wrist-tomorrow`), which state the watch's present state.
- **The phone's copy** is one predicate on the page (`phoneCopy.ts`): the browser says it has no
  connection, or the payload is marked `servedFromCache`. The offline note, the brief line and the
  watch line all use it, so the worker's copy is treated as the phone's copy with the browser online
  too. A copy is read against the server's today by the phone's clock: a preview counts as one only
  while its date is later than that day, so yesterday evening's preview opened on its own day is
  that day's Today and offers the check-in (a preview has no verdict to show); a copy of a day that
  is over is read-only, with no check-in, no Done and no Not today. A live answer is the server's
  own word and is never judged by the phone's clock.
- **The offline note** says "Offline. Showing the session saved at 06:12." and names the day as well
  when the payload was composed on another day than the one on screen ("saved on Wed 18 Mar at
  21:50", for a preview made the evening before). For a copy of a day that is over it names the day
  it was saved and says that today's is not loaded. It sits under the session, in a polite live
  region that is on the page whether or not the note has text.
- **Warm.** After a fresh 200 for today the worker refreshes the rest of the allowlist and fetches
  tomorrow's preview, at most once in ten minutes (the time is kept in `rl-meta`). The page asks for a
  warm once the worker is active, because a first visit's requests went out before the worker took
  the page over.
- **Registration** only in a production build, after `load`. Settings shows "Offline use: ready" or
  "installing", or "not available" with the cause: needs https, the browser does not support it, the
  browser did not allow it, or the build is not a production build. Playwright blocks workers in
  every spec except `17-offline.spec.ts`.
- **Query client.** `createQueryClient()` sets `networkMode: 'always'` for queries and mutations.
- **Serving.** `sw.js` and the manifest are served with `Cache-Control: no-cache`, as the page is.
- **Install.** The shell is kept whole or not at all: when a file does not load, the worker deletes
  `rl-shell-<build id>` before the install fails, and activation also deletes any shell cache that
  holds no `/index.html`. An empty cache would otherwise count as a generation and push out the last
  complete build.

Reasons:

- **Rule:** The design (7.6) fixes the strategies, the five reads, the 36-hour and 14-day limits, the
  401 purge, the server-day fallback and the ten-minute warm. Decision 28 of the design requires two
  shell generations and the single reload on `vite:preloadError`, and workers blocked in every spec
  but one.
- **Rule:** The design (4.8) allows only idempotent PUTs to be queued offline, which the outbox
  already enforces; the worker never keeps or replays a write.
- **Rule:** The design (7.6) calls for a hand-written worker with no workbox, and the plan's task E2-8
  (`docs/superpowers/plans/2026-10-22-coach-phase3a.md`) allows no new dependency, which also means
  the PNG icons are rendered with the Chromium that Playwright already installs.
- **Fact:** The precache is 45 files, about 3.3 MB, about 1.02 MB gzipped, of which the research
  corpus is 1.69 MB (0.49 MB gzipped). Measured on 2026-10-23 with `npm run build` on the merged
  waves 0 to 7 code: the sizes are those of the files in the worker's list (gzip at level 9), and
  the entry chunk is about 357 kB, under the 500 kB bound of `vite.config.ts`. The figures are
  approximate: the byte count moves with every build, and so does the build id (a hash of the
  worker and every kept file), so neither is pinned here.
- **Fact:** The Explain drawer shows its rules from `/api/research/params` and its papers from the
  corpus chunk, and its figures from `/api/explain`, which is not kept. Offline it shows the sentence
  that the figures could not be loaded and the rule and papers beneath it
  (`tests/e2e/17-offline.spec.ts`, run 2026-10-23).
- **Fact:** With TanStack Query 5.104.5 defaults a request is paused while the browser says it is
  offline. A check-in tapped after the connection went then never reached the outbox, and an
  allowlisted read never reached the worker. `tests/web/offline.test.tsx` fails without
  `networkMode: 'always'` (run 2026-10-23); the check-in specs before it dropped requests and never
  took the connection away.
- **Fact:** Playwright 1.64.1 blocks a worker by replacing `ServiceWorkerContainer.prototype.register`
  with a function that does nothing (read in `playwright-core`, 2026-10-23), so a blocked page has no
  registration and `17-offline.spec.ts` checks that a context built as the other specs build theirs
  has none.
- **Fact:** Service workers exist only on https or localhost, so a plain-http LAN install has no
  offline shell and Settings says so (design 7.9).
- **Opinion:** A worker of about 500 lines with five rules, each pinned by a test that runs the file in
  a sandbox, is easier to keep correct than a library's configuration, which would hide the cache
  rules this ADR depends on (what is kept, for how long, when it is emptied).
- **Opinion:** Network first suits a log that changes under the runner's hands (a plan re-planned on
  Monday, a check-in): the answer is fresh whenever the network is there, and a 2.5 s limit stops a
  weak signal from holding the page. Cache first suits only the hashed files, which never change.
- **Fact:** The note is 38 px for one line and 60 px for two (22 px lines and a 16 px margin,
  `OfflineNote.module.css`). Above the session it moved Done's bottom edge from 736 px to 774 px at
  360 x 740 with the check-in unanswered, past that limit of 740 px; under the session Done stays at
  736 px and 689 px (390 x 707, answered), inside both limits, and the note's first line starts at
  761 px on a 390 x 844 screen, above the tab bar (`tests/e2e/12-today.spec.ts`, run 2026-10-23).
- **Fact:** The worker registers only `install`, `activate`, `fetch` and `message` listeners (read in
  `web/sw/sw.js`, 2026-10-23), so nothing wakes it between two opens of the app and nothing deletes
  an expired copy before the next one; the sweep runs then.
- **Opinion:** 36 hours covers a day, its evening and the next morning at a trailhead, and bounds how
  long a copy is served on a phone whose runner has forgotten to sign out. A bound on how long a copy
  is stored would need a periodic sync or a push, which this worker does not use; the sweep on the
  next open is the cheaper bound that needs neither.
- **Opinion:** Precaching the corpus costs a download that a runner who never opens Explain does not
  need, and is worth it because the explanation is part of the promise of offline use and the corpus
  cannot be fetched at the moment it is wanted.
- **Opinion:** Marking the copy in the body (`servedFromCache`) lets the note appear when the browser
  believes it is online but the server does not answer (one bar of signal), which is the common case
  on a phone, and go away when a fresh answer replaces it. The brief line and the watch line hide on
  the same marker (one predicate, `phoneCopy.ts`), because a copy can hold the brief of a week that
  is gone, and the brief page is not kept.
- **Opinion:** A preview that has become the day it is for should offer the check-in, because the
  trailhead morning is the case the offline shell exists for and a check-in tapped there is kept
  until the connection returns. A copy of a day that is over should not offer it or Done, because
  both would file their answer under that day. A live answer is judged by the server's flag alone,
  because the phone's clock can be wrong and the server's cannot.
- **Opinion:** The worker drops the health note about the watch with the watch slot because both
  state the watch's present state ("not on the watch yet" read hours later is as false as "On your
  watch"). The notes about a paused sync and a plan update that has not run stay: they describe the
  copy's own time, which the offline note names.
- **Preference:** Setting the watch slot to null in the kept copy, rather than marking it, and the
  manifest's two shortcuts (Plan and Log activity) are taste. The page also hides the watch line while
  it shows the phone's copy, so either way a saved "On your watch" is not shown.

Alternatives:

- **Workbox or `vite-plugin-pwa`.** Against (**Rule**): a new dependency. Against (**Opinion**): its
  generated worker and cache names would sit between the design's rules and the code, and the 401
  purge and the server-day fallback would still be hand-written.
- **Stale while revalidate for the API reads.** Against (**Opinion**): it shows the kept session
  first, so at 06:00 yesterday's plan can flash before today's with the network fine. For
  (**Opinion**): it is faster on a slow link; the 2.5 s limit gives most of that.
- **Keep every GET under `/api`.** Against (**Rule**): the design lists five. Against (**Fact**): the
  watch status would keep a false "On your watch" (design 6.7), and every kept page is more health
  data on the device.
- **Keep the shell only, no answers.** Against (**Opinion**): an app that opens to an error at the
  trailhead does not meet the story of design 7.2.
- **One shell generation.** Against (**Fact**): an open page that is replaced asks for lazy chunks of
  the old build by name, and the new build no longer serves them; the design's decision 28 records
  this as the reason for two generations. For (**Opinion**): it halves the disk use of the shell.
- **Leave the corpus out of the precache and keep it when first opened.** For (**Opinion**): about
  0.49 MB gzipped less on every first install. Against (**Opinion**): Explain then fails offline for a
  runner who never opened it online first.
- **The offline note above the session.** For (**Opinion**): it is the first thing read. Against
  (**Fact**): it moved Done past the fold (see the measurement above), and the design's budgets
  count only the slots.
- **Mirror the answers in IndexedDB instead of Cache Storage.** Against (**Opinion**): the worker
  would need a second store and its own serialisation, and Cache Storage already holds a response
  with its status and headers.

## Consequences

- The device holds health data: Today's payload, the settings and the account's name and email
  (`/api/auth/me`). A copy is served for at most 36 hours but stays stored until the app is next
  opened (the sweep), a sign-out, a 401 or the next sign-in empties it, so a phone that is never
  opened again keeps it until the browser clears the site's data. A shared device that is unlocked
  exposes the same as the open page.
- A read that was in flight when the runner signed out can still finish and be kept after the purge.
  The next 401 or the next sign-in empties it; this is not closed.
- Today follows the server's day, so a runner who travels sees the home server's date, and the offline
  copy picked by that date. The design records this as a limitation.
- The two-generation update is verified by unit tests and the offline e2e on one build, not on a real
  device across two releases. iOS may evict caches, and a queued check-in, for a Safari tab not used
  for days.
- A new build has a new id and a new shell cache, and the oldest of three builds is deleted at
  activation. Hashed files are served with `Cache-Control: immutable` (`server/static.ts`), so the
  browser can take an unchanged one from its own cache at install; that is not measured.
- Offline, pages other than Today, Settings and Research parameters show their error states after a
  few seconds, and forms that need the server say so. The outbox keeps only the check-in, the fuel
  log (design 4.8) and the strength log (strength design 9.6).
- Query failures offline cost a few seconds of retries before they show, where the library would have
  paused them without a message.
- `rl-meta` holds one number, the time of the last warm, and is emptied with the answers.
- A new cached read is added in one change to the allowlist in `web/sw/sw.js`, its test in
  `tests/unit/shared/sw.test.ts` and the list in this ADR.
- `docker build .` runs the same Vite build, so the image carries `sw.js`; the healthcheck calls
  `/api/health` and is unaffected.

## Addendum 2026-11-07: the race plan is the sixth kept read

### Context

The race plan (ADR 0018) is read on the Race page, and its checkpoint table is what a crew reads at an
aid station. The page said "The race plan needs a connection", and a 100-mile race has long stretches
with no signal, so the card was unreadable where it was wanted.

### Decision

- **Allowlist.** `GET /api/race/plan`, with no query, is the sixth read. Same strategy as the other
  five: network first with the 2.5 s limit, only a 200 kept, in `rl-api-v1`, stamped with the time. The
  plan, and the answer for a goal that has none (`plan: null` with its `reason`), are kept alike.
  `/api/race/checkpoints` is not kept; the plan carries the table's rows and their arrival ranges.
- **Time limit.** 4 days for this read; the others keep 36 hours and 14 days.
- **Mark.** The worker serves the copy with `servedFromCache` and with `savedAt`, the ISO time the
  copy was kept: the payload names no time of its own, where Today's has `coach.generatedAt`. What is
  stored is the server's answer, unmarked.
- **Warm.** The warm that follows a fresh Today keeps the race plan with `/api/auth/me`, `/api/setup`
  and `/api/settings`, so the copy exists for a runner who never opened the Race page on the way to the
  start.
- **Page.** The Race page applies the one predicate for the phone's copy (`isPhoneCopy`, the browser
  says offline or the payload is marked) and then shows "Offline. Showing the race plan saved at
  06:12." in a polite live region, and leaves out the days to go, which a saved copy cannot know. The
  editor and the import save need a connection and say so when they fail.
- **Crew notes.** The free-text note for each checkpoint on the race card is kept in the browser's
  local storage under `race-crew:`, named in `web/pwa/drafts.ts`, so `purgeDrafts()` and therefore
  `purgeDeviceData()` empty it. The server never sees a note.
- **Purge.** Unchanged: `purgeDeviceData()` empties `rl-api-v1`, which holds the plan, and the crew
  notes with the drafts; the worker empties `rl-api-v1` on a 401.

### Reasons

- **Fact:** The plan holds the zone 1 ceiling in beats per minute, the expected time and its range, and,
  inside the final window, the carbohydrate load in grams worked out from the runner's body mass
  (`RacePlan`, `RaceWeek.carbG` in `shared/engine/racePlan.ts`, read 2026-11-07). It is health data on
  the device and goes under the same purge as the five reads.
- **Opinion:** 36 hours would end the copy during the race. A runner who last had signal at the start
  line at 05:00 loses a 36-hour copy at 17:00 the next day, before many finishers of a 100-mile race with
  a 36 to 48 hour limit. 4 days covers the sync before the start, a race of up to 48 hours and a day of
  slack, and is still bounded: a phone left signed in keeps the copy for four days at most from the last
  successful read.
- **Opinion:** A marked copy beats a banner invented by the page. The page cannot tell a live answer
  from the worker's by itself when the browser believes it is online (one bar of signal), and the mark is
  the way the Today note already tells them apart.
- **Fact:** The warm adds one request, the race plan's, to the three it already made after Today
  (`/api/auth/me`, `/api/setup`, `/api/settings`), at most once in ten minutes and only while the app is
  in use (`warmCache` in `web/sw/sw.js`).
- **Preference:** Carrying `savedAt` in the body, not in a header, is taste: the body is what the page
  already reads for `servedFromCache`.
- **Opinion:** Notes kept on the device alone suit a crew card: a note about who meets the runner where
  is the runner's own, and no server read or sync is needed for it. The cost is that a note does not
  follow the runner to a second device.

### Alternatives

- **Keep the race card as a page of its own, rendered to a file.** Against (**Opinion**): a second
  rendering that can say something other than the plan. The card is drawn from the kept plan by the
  same copy functions as the page.
- **Keep `GET /api/race/checkpoints` too.** Against (**Opinion**): the only reader is the editor, which
  cannot save offline, and the plan already holds every row with its arrival range.
- **The 36-hour limit.** For (**Opinion**): one rule for the answers of the account. Against
  (**Opinion**): it ends before the race does (see the reason above).
- **A limit of 14 days like the research parameters.** For (**Opinion**): never expires during a
  race week. Against (**Opinion**): a copy that long serves a plan of a goal that has since changed.
- **Crew notes on the server.** Against (**Opinion**): a new model and a sync for a line of text, and
  the note is wanted exactly when there is no connection to sync.

### Consequences

- The device holds the race plan for up to four days after the last read, until the next open sweeps it
  (the sweep runs at the first request of each worker's life), a sign-out, a 401 or the browser clears
  the site's data.
- A copy kept before the final window holds no race-week block, and a copy shows the plan as of the day
  it was kept: the days to the race are not shown from it.
- The plan stays off the watch, the feed and the brief (ADR 0018); the card is a page and a print layout.
- Crew notes are health-adjacent text on the device and go with every purge: a sign-out, a sign-in and a
  401 empty them, as the drafts are. The card says so beside the notes ("Notes stay on this phone and are
  cleared when you sign out."). A note is kept under the stop's name and its place to the nearest 100 m, so
  a renamed or moved stop leaves its note behind.
- A new cached read is still one change to the allowlist in `web/sw/sw.js`, its test in
  `tests/unit/shared/sw.test.ts` and the list in this ADR.

## Addendum 2026-11-07: Done and a rating are queued writes

### Context

A runner often logs at a trailhead with no signal. Done (`DoneSheet`) posted an activity, which is not
idempotent, so it was refused offline; the rating of a run used `PATCH`, which the outbox does not take.
The outbox only holds idempotent PUTs of a URL on its allowlist (`OUTBOX_ROUTES`). No cached read is
added by this change.

### Decision

- **Done.** `PUT /api/activities/done/:activityId`. The sheet makes a UUID when it opens and the server
  stores the activity under that id (`saveDoneActivity`, `server/services/activityStore.ts`), so no
  column or migration is needed. The id has 8 to 64 of `[A-Za-z0-9_-]`. A repeat of an id the runner
  already owns answers 200 with the stored row and writes nothing, so a replay after a lost answer, or
  from two tabs, stores one activity and never undoes a later edit. An id held by another runner is a 404. Two sends at once end as one create and one repeat (the loser's unique violation is read as a
  repeat).
- **Conflict.** The body carries `sessionId`, the planned session marked done. When that session
  already has an activity (done on another phone, or matched from a sync) the write is a 409 and
  stores nothing. A session the active plan no longer holds is not an error: the run is kept and the
  matcher ties it to the plan as for any other run.
- **Pain.** The sheet gains the 0 to 10 pain scale already used by the rating and the activity page; it
  is the existing `Activity.pain`. No pain-area chips exist anywhere (the check-in takes a free-text
  area, stored on the day, not on a run), so none is added here.
- **Rating.** `PUT /api/activities/:id/feedback`, the same handler as `PATCH` (kept for the activity
  page). It stores the keys it names and leaves the others, so a second queued rating merges into the
  first (`combine: 'merge'`) and a replay changes nothing.
- **Outbox.** Two allowlist entries, `run` and `rating`. An entry whose send could not go out, and the
  ones behind it, are marked `held`. The page shows a held Done in the session card ("Saved on this
  phone, waiting to go up.", Done hidden so it cannot be made twice), a held rating in place of its
  form, and a toast says when a held entry has gone up. A 409 sets `conflict` on the refused result: the
  sheet shows the server's sentence in a status line and a "Back to Today" button; a refusal found on
  replay is a dismissible notice on Today that quotes the server's sentence (`quoteReason`).
- **Dates.** The sheet sends `session.date` from Today's payload, the server's day. The phone's clock
  and time zone are not read, and no time of day is shown for a queued write.
- **Purge.** Unchanged. The entries live in the outbox, emptied only by `purgeDeviceData()`; the draft
  keeps its place in `purgeDrafts()` and now holds the pain value too.

### Reasons

- **Fact:** `saveStrengthLog` is an idempotent replace on a client-chosen id and `OUTBOX_ROUTES` already
  holds it (`web/pwa/outbox.ts`, read 2026-11-07), so the same shape fits a run.
- **Fact:** `Activity.id` is a `String @id` with a cuid default (`prisma/schema.prisma`), so a UUID fits
  and the primary key enforces one row per id, with no new column or unique index. Verified by
  `tests/api/doneActivity.test.ts` (a replay and two concurrent sends store one row).
- **Opinion:** Create-if-absent beats replace for a run. The activity can be edited, rated and linked
  after the first send, and a replay of the first body would silently undo that; the replay window is
  the minutes after a lost answer.
- **Opinion:** A conflict on the session beats a possible-duplicate flag. The duplicate pass compares
  figures and would keep both runs; the runner marked one session done once, and the other phone's run
  stands.
- **Opinion:** Keeping the run when its session has moved beats a 404. A 404 would drop the entry
  (`refused`) and the runner's only record of the run would be gone.
- **Opinion:** Marking everything behind a failed send `held` beats marking only the failed one: the
  runner was told all of them are saved on the phone.
- **Preference:** The long sentence is spoken once, in the toast; the card carries a short line, so a
  screen reader does not read the same sentence twice.

### Alternatives

- **A `clientId` column with a unique index on `(userId, clientId)`.** Against (**Opinion**): a
  migration and a state-model entry for what the primary key already gives.
- **Queue the existing `POST /api/activities`.** Against (**Fact**): a POST is not idempotent, and
  the outbox rejects a URL outside its allowlist.
- **Replace the stored activity on a repeat, as the strength log does.** Against (**Opinion**): see the
  reason above; a strength log is one document the sheet owns, a run is edited elsewhere.
- **Queue the rating of the activity page as well.** Against (**Opinion**): that page cannot open
  offline (its detail read is not kept), so it keeps `PATCH`.

### Consequences

- A phone that logs offline and a second device that logs the same session first: the second write is
  refused with one plain sentence and the phone's run is not stored. The runner can enter it again as
  an unlinked activity from Activities.
- An entry older than 7 days is dropped unsent (unchanged), with the generic notice.
- The `held` flag is stored in the entry in IndexedDB; an entry written by an earlier build has none
  and is treated as not waiting until its first failed send.
- The strength sheet's own save of "without sets" still posts an activity and needs a connection.
