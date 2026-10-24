# 0012. The installed app opens offline from a hand-written service worker that keeps five reads, and the device's copy of health data is purged with the session

Status: Accepted 2026-10-23 (#554)

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
  `vite:preloadError`, and not again within a minute.
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
- **Fact:** The precache is 45 files, 3.29 MB (3,294,695 bytes), about 1.02 MB gzipped, of which the
  research corpus is 1.69 MB (0.49 MB gzipped). Measured on the build of 2026-10-23 with the
  waves 0 to 7 code: `npm run build` printed `sw.js written: build 54eb1a593f90, 45 files kept`, and
  the sizes are those of the files in the worker's list (gzip at level 9). The entry chunk is
  356.55 kB, under the 500 kB bound of `vite.config.ts`.
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
  few seconds, and forms that need the server say so. The outbox keeps only the check-in and the fuel
  log (design 4.8).
- Query failures offline cost a few seconds of retries before they show, where the library would have
  paused them without a message.
- `rl-meta` holds one number, the time of the last warm, and is emptied with the answers.
- A new cached read is added in one change to the allowlist in `web/sw/sw.js`, its test in
  `tests/unit/shared/sw.test.ts` and the list in this ADR.
- `docker build .` runs the same Vite build, so the image carries `sw.js`; the healthcheck calls
  `/api/health` and is unaffected.
