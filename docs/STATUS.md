# Status

Current state only; rewritten at every boundary. History lives in `git log`, the specs and
plans under `docs/superpowers/`, the research corpus under `research/` and `docs/adr/`.

Last update: 2026-11-01.

## Where things stand

- **Load progression from the runner's history (2026-10-25, `feat/load-progression`, PR #565,
  follow-up 22).** Tasks L0 to L7 of
  `docs/superpowers/specs/2026-10-24-load-progression-proposal.md`, built on the owner's answers of
  2026-10-24 (section 7 there); L0 and L1 (the six tissue papers, 376 papers in the corpus, and ADR
  0013 with the G-5 amendment) merged in #564. A runner with a year of running and a block of
  steady weeks (four consecutive complete weeks of at least two runs each, scored by the mean
  without the highest, ended within 12 weeks) starts a plan on 3 × 30 minutes in place of 3 × 20 at
  the Standard and Upper band positions (E6 path 2, second route); the session length stays the
  longest run of the last 30 days, G-1 bounds every session, and age 45 or over does not close the
  route. The Generate form offers the load setting: Steady (the default, the engine byte for
  byte), Standard and Upper band. A position is held at steady, with the reason shown, under a
  recent injury, an earlier bone stress injury or two risk factors for one, flags from the energy
  availability screening, focal bone pain, a rest window and a plan built in the weeks after a
  race; at age 45 or over Upper band is read as Standard.
  The Plan page's Load panel names the position in effect, why a chosen one does not apply, and
  the trade-off of a faster step (the effect on a return after a break is not known); the Why
  drawer carries no trade-off by decision, because it states facts of the plan and not the choice.

  The engine. The rebuild zone: `R` is the credit (0.70 at Standard, 0.85 at Upper band) times the
  taper of the block's age times the block's score `H`, taken from the runner's own weeks. A loading
  week whose baseline is under `R` takes the position's step (12% at Standard, 14.0% at Upper band)
  in place of 10%, clamped so that it never plans a week above `R` except by the usual 10%; a
  continued plan keeps the block it opened with until a week reaches `R` (L3d). The response to
  weeks run above plan (Standard and Upper band): the baseline of a loading week is the higher of
  the planned baseline and the mean of the minutes run in the last four eligible weeks, with two
  bounds (L3d): the newest of those weeks must have been run at or above its stored target, and the
  lifted baseline never passes the planned baseline stepped by the two-week ceiling. A raised week
  target is kept at a re-plan within the limit the engine itself allows for that week
  (`targetLimit`), clipped above it, and the revision's diff names each kept and each clipped week
  and the bound that set the kept figure (the limit, the plan's own figure or the minutes already
  run; the `logged` bound is a safeguard that no API fixture reaches, covered by unit and copy
  tests). A clip by a hold, a decision, a window, a programme or the structure of the plan is
  written as the plan's own figure with no override, so the week is free again once the rule has
  passed. The Why drawer's g-8 facts (the block and its age, the zone, the setting, the held or
  capped reason, the response and the limits that stay) read the input with the plan's own goal, and
  a week in the zone says what it rebuilds toward.

  Params, values and validation. Rule g-8 of `research/engine-rules.md` has nine Params in group
  `g8`, every one grade D with a default note; the upper step is not a Param: it is the weekly rate
  at which two weeks meet `g2.rampCeilingTwoWeeks`, derived from the grade C ceiling so that it
  cannot pass it. Shipped values, provisional and grade D: 0.70 and 12% at Standard, 0.85 and the
  ceiling's own rate, 14.0%, at Upper band; `g8.creditTaperEndWeeks` 12 (the 16-week window with a
  taper to one half stays available by Param); `g8.responseWeeks` 4; `PARAMS_VERSION`
  `2026-10-25.3`. Validation at Steady: byte-identical to the baseline at every merge (39 weeks, 210 sessions, 0 of 15 checklist
  failures). Owner replay (L6, outside the repository, where the full figures are kept): over the 53
  Mondays of the last year the setting changed the plan on 7 (a block in the 12-week window and the
  plan opening on the start path); the low-frequency flag held the position on 30; on the 7, the
  opening week was 90 minutes instead of 60, the block level came 6.6 (Standard) and 7.2 (Upper
  band) weeks sooner than at Steady, of which the 3 × 30 lift alone gave 5.8 weeks and the zone 0.8
  and 1.4; checklist failures and spike flags 0 everywhere. The 16-week credit window changed 1 of
  53 plans (by 1.5% at Standard and 6% at Upper band over 12 weeks). In a back-test of 32 weekly
  re-plans the response lifted a baseline in 16 (14 after a week run above plan, 2 after a dip
  following a held week; the first bound of L3d removes the 2); one outlier week lifted a plan 3.1
  times (the second bound limits it to 1.3). The own-tolerance record holds no weekly step between 0
  and 14% and no pain or fatigue flags, so it neither confirms nor refutes 12% or 14.0%. The close
  review is the next section; the decisions and the open item are under "Decisions for the owner".

- **Owner decisions of 2026-10-24 (documents only, no code).** The load-progression proposal
  (PR #558) and the strength design (PR #559) merged with their open questions unanswered. The
  owner answered all 28 on the evening of 2026-10-24: the answers are in section 7 of the proposal
  and section 18 of the strength design, and both specs are amended to follow them. The ADR for
  strength is 0014, because 0013 records the load-progression decision (the G-5 amendment
  included). The phase 3a leftovers are decided under "Decisions for the owner"; the work they leave
  is follow-up 18, follow-up 19 (the Today disruption presentation, since shipped in #567) and
  follow-up 22 (load progression, since shipped, the entry above), and follow-ups 20 and 21
  shipped in #561.
- **Distance estimate beside the minutes (2026-10-24, `feat/distance-estimate`, follow-up 17).** A
  run session carries `distanceEstimate` (`{ distanceM, basis }`) and a plan week
  `distanceEstimateM`, worked out on the server (`shared/engine/distanceEstimate.ts`) and never
  stored. The easy pace comes from the zones when they hold a pace (the middle of the Z1 range,
  `basis: 'easy'`; its slow edge is the existing grade D `c2.z1PaceSlowFactor`), else from the
  runner's recent logged runs (`basis: 'recent'`, "about 9 mi at your recent pace"), else there is
  no estimate. The recent pace (`recentPaceSecPerKm`) is the median pace of the logged runs of the
  last `macroDesign.trainingPaceWeeks` weeks (the window of `trainingPace`) that are at least
  `restartFloor.sessionMin` long, not races, not flagged duplicates and with a distance, after the
  hard ones are left out: runs above the easy heart-rate limit (the top of Z1) when the zones hold
  one, and the fastest `macroDesign.recentPaceFastestShare` of the runs with no heart rate to judge
  by. With fewer than `macroDesign.recentPaceMinRuns` runs left it is the median of the weekly
  paces of the window (`recentWeeklyPace`, factored out of `trainingPace`). It is computed once per
  snapshot (`AthleteContext.recentPaceSecPerKm`, no new query), so the plan, Today and the brief
  share it. Two new grade D Params (`PARAMS_VERSION` `2026-10-24.1`); the 20-minute floor and the
  window reuse existing ones. A threshold, interval or race-pace session covers its work minutes at
  the middle of its own pace band and the rest at the easy pace (`basis: 'pace'`). Null for a hike,
  strength, mobility, cross-training or rest session, the race, a run-walk session, and a runner
  with neither a zone pace nor a usable logged run. The payload types are `PlanSessionView` and
  `PlanWeekView`, so a producer that omits the field does not compile; `WeekStrip.distanceEstimateM`,
  `BriefKeySession.distanceEstimate` (kept in the brief's facts, absent in older briefs) and
  `BriefListItem.nextKey.distanceEstimate` carry the rest. The words are in
  `shared/copy/distanceEstimate.ts` (half unit below 5, whole unit above) and appear on the Today
  hero and next line, the week strip, the session sheet, the Plan day cards and week rows, the
  brief's key session and Today's brief line. Where an estimate exists it replaces the plan's own
  unlabelled `SessionSpec.distanceM` on those surfaces; an eased session carries neither. Plan
  output is byte-identical (owner validation: 39 weeks, 210 sessions, 0 failing checks, identical to
  the phase 3a close); the owner's zones hold no pace on 2026-10-23, and the same plan with the
  estimates worked out against the owner's history reads a recent pace of 359.8 s/km (9:39 per
  mile) and gives 152 of 210 sessions an estimate (a 30-minute run: about 3.1 mi at the recent
  pace; the first week: about 6.2 mi), the rest being strength, mobility, rest and the race. A
  threshold pace entered on the Profile page still gives the better figure: it is the easy pace of
  the zones, not an average that includes hard days. Today's request pins are unchanged (30 reads
  cold, 15 warm). Gates: `npm run check` (232 files, 11056 tests), `npm run build`,
  `npm run test:e2e` (78). The hero's extent column wraps beside the minutes, so the phrase costs no
  height at 360 px (measured with a payload patched in Playwright: 0 px against the plain
  distance). The e2e fold test passes with an estimate in the payload, but it has no pace zones: with
  a tested threshold pace set before the plan is made, Done ended at 766 px at 360 x 740, with the
  estimate or without it, so the fold is unproven for a runner whose zones hold pace.
- **Phase 3a implemented (2026-10-23).** Seven implementation waves landed through PRs #542,
  #544, #546, #549, #551, #552, #553 and #554 (with the fix PRs #538, #540, #541, #543, #545, #547,
  #548 and #550), each wave gated by `npm run check`, `npm run build`, `npm run test:e2e`, a Docker
  build where a migration or the image changed, the owner validation (byte-identical from wave 0 to
  the close: 39 weeks, 210 sessions, no checklist failure) and a six-lens adversarial review with
  two refuters per finding, whose confirmed and accepted findings were fixed before each wave was
  cut; the close adds a whole-phase contract-drift review (43 findings, 24 confirmed and 15 accepted disputed ones fixed before the close PR, four recorded below). What shipped: Today as one
  coach payload (the readiness read, the one-row check-in with the outbox, the session hero with
  its targets, Done and Not today as one-tap sheets, the brief line, the watch line, the disruption
  slot, the week strip, the race countdown, the offline note; two columns from 900 px; the fold
  measured); the Plan page with preview-then-apply actions (Not 100%, the window banners, the adjust
  section for move, swap, shorten, skip and restore, "Update plan from latest data", undo for every
  revision with its causes, the wrist strip and downloads); the weekly brief page and its API; the
  Why drawer on the runner's numbers with every rule explained by a builder or a policy entry; the
  Fuel lab (the ladder, products, the 20-second log, the gut-training block, the EAH card); race
  results and the prediction track record; watch delivery through FIT files, intervals.icu
  publishing and the private calendar feed; disruption windows in the engine and on the server;
  the offline shell (ADR 0012); ADRs 0007 to 0012 accepted; fourteen migrations; `PARAMS_VERSION`
  `2026-10-23.3` after the close added two grade D Params with the values the code already used.
  Final gates on the merged branch after the close fixes: `npm run check` (227 files, 10896
  tests), `npm run build` (`sw.js` with 45 files kept, entry chunk 358 kB), `npm run test:e2e`
  (77), `docker build .` with the database files excluded from the image. Manual checks still open: the FIT files on
  the owner's watch, one live intervals.icu run, a real calendar app on the `webcal://` link, which
  Garmin model and manual route the help text should name (Q6), a two-release shell update on a
  device and iOS cache eviction. Owner questions still open: "Decisions for the owner" below
  (the section-13 defaults; the wave-7 items and the API limiter were decided on 2026-10-24). Next:
  strength programming (the design is merged, PR #559, follow-up 18); the distance estimate
  (follow-up 17) shipped on 2026-10-24 (#560), load progression (follow-up 22) on 2026-10-25 (the
  entries above) and the Today disruption presentation (follow-up 19) in #567.
- **On `main`:** the clean rewrite (#528, rebase-merged) and the evidence engine, data
  foundation and research corpus (#529, squash-merged as `2e17f23a`); the CodeQL escaping fix
  (#536); the second evidence pass (#537); the eight phase 3a wave pull requests, merged on
  2026-10-23 (#542 wave 0, #544 wave 1, #546 wave 2, #549 wave 3, #551 wave 4, #552 wave 5, #553
  wave 6, #554 wave 7); and the fix pull requests #538, #539, #540, #541, #543, #545, #547, #548
  and #550.
- **Merged (#537, 2026-10-22):** the owner's answers to the eight section-10
  builder calls (`docs/superpowers/specs/2026-10-22-training-engine-design.md`), backed by a
  second evidence pass on five questions (70 new sources, corpus 370; `research/README.md`
  method entry 7): four start paths (E6: a 9-rung run-walk ladder, a 3 × 20-30 floor sized from
  the runner's own recent run, ladder entry by the longest recent bout, an injury-return
  ladder), 5 km and 10 km long-run tiers with a 16 km cap (D7), the day-counted post-race
  window with a delay-only check-in gate (H12), marathon-plus races out of the 30-day session
  reference, a 3-min duration step for G-1, the weekly ramp relabelled grade D, a
  low-frequency profile, the ratings-required copy, and one 150-hour activity limit.
  `PARAMS_VERSION` is `2026-10-22.2`.
- Gates on the branch (2026-10-22): `npm run check` (lint, Prettier, typecheck,
  `research:check` with 370 papers and 373 cited ids, Vitest), `npm run build`,
  `npm run test:e2e`; the local validation against the owner's real history (kept outside the
  repository) builds the 100-mile plan with 0 checklist failures of 15, label "tight" (33 of 33
  weeks, the weekly path governs by one week), a 3 × 20 first week and a 9.2 h peak, and
  projects a 15-day hold after the race (10 days × 1.5 for a first finish in the class) followed
  by three 7-day steps.
- An adversarial review of the branch (six lenses, two independent refuters per finding) confirmed
  32 findings and disputed 18; the confirmed ones and the accepted disputed ones are fixed on the
  branch (start paths read only the runs the 30-day reference counts; the injury ladder advances
  by minutes run, not by weeks; tightened profiles take the ladder; the post-race lead-in obeys
  G-1 and the steps start inside the race week; the 16 km cap at the carried pace; one duplicate
  predicate; the half and marathon long-run floors reconciled with the planner; web labels and
  rule text aligned). Re-plan sweeps (0-37 days, logged and unlogged) pass for the reviewed
  fixtures.

- **Phase 3a (integration branch `feat/coach-phase3`; one PR per wave to `main`, #542 to #554):**
  the owner's mandate of 2026-10-22 ("a professional, research-informed, self-adjusting coach and
  tracker, better than Strava and Runna") after an audit of the app and the market
  (`docs/superpowers/specs/2026-10-22-coach-phase3a-design.md`, plan
  `docs/superpowers/plans/2026-10-22-coach-phase3a.md`; ADRs 0007-0012 Accepted 2026-10-23: 0010 in
  #542, 0009 and 0011 in #544, 0007 and 0008 in #546, 0012 in #554). Seven epics in eight waves:
  the foundation (cached athlete state, data version, one session identity, one revision model,
  sync log), sessions on the wrist (intervals.icu publish, FIT download, ICS feed), Today rebuilt
  as a phone-first coach with an offline shell, explanations from the runner's own numbers and a
  Monday brief, disruptions (dial-back, what-if, moves, undoable re-plans), the fuel lab and gut
  training, and the prediction back-test. The owner's spreadsheet plan is a placeholder; only the
  goal race is firm, and the engine owns the plan.
- **Phase 3a wave 0 (branch `feat/coach-phase3`, PR from `wave/3a-0`, 2026-10-23):** the contracts
  every later task imports. E3-1: the data version (`server/dataVersion.ts`, raised by the Prisma
  client after every state write and at the end of every transaction, model classification tested
  against the schema, `conflict(message, details)`, schema-derived `resetData`). E3-4: one
  `PlanSession` migration (`externalId` unique per plan, `trimmed`, the indexes), the migration-chain
  and drift test, `executionRecordsByWeek`, `loadActivityCores` with a 52-week bounded window.
  E2-1: the Today page split into `web/components/today/*` with named slots. E2-2: one eased
  session, `resolveTargets`/`climbNote`, heat steering shared across surfaces (`PARAMS_VERSION`
  `2026-10-22.3`). E4-1: the copy system (`shared/copy/*`: typed templates, the G5 lint,
  `formatQuantity`, `describeParamValue` in the runner's units, `expectCleanCopy`) and ADR 0010.
  Gates on the merged branch: `npm run check` (123 files, 3336 tests), `npm run build`,
  `npm run test:e2e` (18), `docker build .` (the migration applies), owner validation unchanged
  apart from the date. Adversarial review: see below.
- Fix pull requests against `main`, all merged: #538 (dev proxy), #539 (plan form labels), #540
  (start level from the last two complete weeks), #541 (persist `qualitySessions` and
  `isRecovery` on `PlanWeek` so a re-plan stops reporting a phantom change), #543 (a Playwright
  port per checkout), #545 (an overshot week is taken as it is), #547 (the restart floor week is
  kept when a mid-week re-plan ends its path), #548 (a fresh plan mid-week is built from the weeks
  actually run), #550 (static assets stay out of the global rate limit). `PARAMS_VERSION` is
  `2026-10-23.2`.

- **Phase 3a wave 7 (branch `feat/coach-phase3`, PR from `wave/3a-7`, 2026-10-23):** the offline
  shell, the last explain builders, the disruption wiring and the fuel e2e. E2-8: a hand-written
  service worker (`web/sw/sw.js`, rendered into the build by `web/sw/buildSw.ts` with the build id
  and the precache list of every emitted script and style chunk, the lazy sheets, the charts and
  the research corpus included, about 3.3 MB and 1 MB gzipped; two shell generations kept) keeps
  five allowlisted GET reads network first with a 2.5 s limit for 36 h (14 days for the research
  params) in `rl-api-v1`; a 401 and `purgeDeviceData()` (sign-out, sign-in, setup) empty the cache
  with the outbox and the drafts; Today's kept copy is chosen by the server's day, marked
  `servedFromCache` and stripped of the watch slot; a throttled warm fetches tomorrow's preview;
  `main.tsx` reloads once on a preload error; registration only in production builds; `sw.js` and
  the manifest served with `no-cache` (`mountStatic(app, root?)`); PNG icons from
  `scripts/make-icons.ts` with no new dependency (`npm run icons`), the manifest with id, scope and
  the Plan and Log activity shortcuts, the iOS head tags; `OfflineNote` on Today ("Saved at
  HH:MM" in the server zone) and the Settings "Offline use" row; `createQueryClient` is
  `networkMode: 'always'`, because a check-in tapped after the browser's offline event was
  otherwise paused in memory and never reached the outbox; Playwright blocks workers except in
  `17-offline.spec.ts` (Today offline, the shell cache holding every lazy chunk, Explain offline, a
  check-in kept and sent on reconnect, a 401 and sign-out emptying cache and queue); the Docker
  image builds and its healthcheck passes; ADR 0012. E4-8: `explainInputs.ts` has a builder with a
  gap sentence for 46 more rules and 29 policy entries with their reasons, the PENDING list is gone
  and the coverage test fails on a rule title with neither or with both; `ExplainContext.race`
  carries the goal as the engine models it, read from the snapshot and the cached climate and never
  fetched; `AthleteContext.planOptions` carries the options the plan was generated with; the
  reading pass over the owner's live brief and cards found no banned or alarming sentence and fixed
  "up to 0 min" (the brief headline, the stored decision summary, J5, g-2), "of 0 planned minutes"
  (the renderer, g-6) and a restart cause that said the runner had been away; the rewrite design
  (items 19 and 20, sections 4.6, 4.7 and 6) lists the phase 3a routes and pages and the engine
  design points to `explainInputs`. E5-8: the Today `disruption` slot is `DisruptionSlot`
  (registered in `slotMounts.tsx`, from `coach.slots.disruption`, no request): a window in effect,
  else the next one, as the compact `DisruptionBanners` (64 px at 360 px: two lines of text and a
  row of small buttons, each previewing first); with no window and an illness or pain check-in the
  slot offers "Set a rest window and a return plan?" ("Set one up" opens `NotFullSheet`, "Not now"
  lasts until the page is left and is not stored); `DisruptionBanners` takes a `frame` that wraps
  only the banners, so a removed window leaves no frame and keeps its sheet; the Not today sheet
  carries a "Not 100%" entry (`NotFullEntry`) that swaps it for `NotFullSheet` dated from the
  server's day; the fold test holds with the banner present (Done at 737 px of 788 unanswered and
  689 of 707 answered); `wristPublish.test.ts` pins that a window withdraws the days it holds on the
  next publish, that its undo sends them again, and that Today, the session sheet and the publish
  set agree on a rest-window day. E6-8: `18-fuel.spec.ts` (a product added, a 3-hour run logged
  through the sheet, the target stepping up, two runs scored 2 holding then falling back to the
  last rate that went well, the stronger EAH card for a 100-mile goal) and the 360 px case for
  the lab and an open log form; the E1 seam (`loadFuelContext` once per build, `fuelLineFor` per
  session, at most 60 characters) and the E11/E12 surface (`GET /api/fuel`, `GET /api/fuel/targets`,
  the pure functions in `shared/engine/fuel.ts`) are recorded as stable. Gates on the merged
  branch: `npm run check` (226 files, 10661 tests), `npm run build` (`sw.js` with 45 files kept, entry chunk 357 kB), `npm run test:e2e` (77), `docker build .` with a healthy healthcheck, owner validation byte-identical to the phase start. Adversarial review: see below.
- Wave 7 left for later tasks: a real two-release shell update on a device and iOS cache eviction
  are untested; a read in flight at sign-out can finish and write after the purge (the next 401 or
  sign-in clears it; ADR 0012); Explain offline waits about 3 s on the explain query's retries
  before showing the rules; the "online but the server does not answer" marker path is covered in
  unit tests only (Playwright cannot intercept a worker's own fetches); the sync-paused and
  weekly-update health notes in the kept Today copy may be stale (only the watch note is
  stripped); `useServerToday` arms no rollover timer for a payload flagged as a preview, so a
  preview that has become today's copy waits for the next focus or reconnect refetch; the compact banner's buttons are 26 px high inside the 64 px budget
  (every action previews first; raising the budget is the owner's call) and the box grows with the
  text size, the one slot whose content grows its box; the always-mounted live region that
  announces the rest-window offer may read the question twice in a screen reader's browse mode;
  the visually hidden chart table of the recent strip makes Today scroll sideways at 125% text
  size and above (pre-existing; a `visually-hidden` table does not collapse); the slot shows one
  window; `explainInputs.ts` is about 2.9k lines and the builder families could be split from the
  registry; the fuel e2e depends on the generated plan holding an eligible future run; the "three
  generated briefs" reading pass ran on one live brief, because the replay of the owner's history
  into a throwaway database was refused by the session's permission layer (the owner can run it);
  the G5 line for `research/engine-rules.md` waits for the owner.
- **Phase 3a wave 6 (branch `feat/coach-phase3`, PR from `wave/3a-6`, 2026-10-23):** the pages
  around the coach. E2-7: Today in two columns from 900 px (`useMediaQuery` sets `data-layout`
  on the page; both column groups stay mounted, so crossing 900 px never remounts the hero; the
  hero group comes before the week group in DOM and tab order with no CSS `order`); the page
  fills no slot itself, every slot renders the mount registered in
  `web/components/today/slotMounts.tsx`, and `slots.ts` documents each slot's budget, the fold
  limits and how a slot is filled; `RecentWeeks` lazy-loads its chart; `useServerToday` asks for
  the new day at midnight in the server zone (the 25-hour day on 1 Nov, a server still on the old
  day retried each minute, no timer for a preview day); the fold measured in Playwright with every
  slot filled to its budget (Done's bottom 729 px at 390×844 unanswered against a 788 limit, 681
  at 390×707 answered against 707, inside the viewport at 360×740, the strip in the right column at
  1280×800, screenshots attached), which took `PageHeader.inlineActions` ("Log activity" beside the
  title on a phone) and tighter hero and readiness spacing. E1-8: the Today watch slot is filled
  from the payload (`TodaySlots.watch` from `todayWatchSlot`; `readWristItems` in
  `server/services/wristItems.ts` is the one reader for Plan and Today; `WristLine` takes the item;
  `WatchMount` renders a frame only with content and hides offline), because spec 7.6 allows no
  request above the fold but Today and the settings; the Today stamp covers the channel's switches
  and the sends inside the 15 minutes before "On your watch" (pins warm 13, cold 29); the
  intervals.icu card (both switches off by default, last send, "Send now", an inline remove-sent
  offer when a session is sent or on the watch), Disconnect with its question and the
  `remove-failed` fallback, the Calendar link card (token shown once in a sheet, held only in
  component state, `webcal://`, Copy, replace, turn off; the 28-day and 14-day sentence from
  `shared/workouts/horizon.ts`); e2e `15-wrist.spec.ts`; CLAUDE.md Providers names the publish
  channel, README describes the three delivery routes, the engine design points to Delivery.
  E4-6: `/brief` and `/brief/:weekStart` (`web/pages/BriefPage.tsx`: every section of spec 8.6 in
  order, one column at 360 px and two from 900 px, the exact copy for loading, error, no plan, not
  yet, none, provisional and the five replan notes, `role="alert"` only on a real error, "Earlier
  brief" and "Later brief"); `BriefLine` in the `brief` slot within 52 px with one "New" marker
  from `seenAt`, mounted as `BriefMount`, which fetches `GET /api/briefs?limit=1` once the slot
  nears the viewport; "Weekly brief" first in More; `TargetList` extracted from `SessionTargets`
  so the key session reads like the hero; `tests/web/brief-invalidation.test.tsx` holds every
  plan-changing hook to the brief; e2e `16-explain-brief.spec.ts` (a change with its cause and
  undo, undo refused after a run, undo refused while an illness is reported). E6-7: `/fuel`
  (`web/pages/FuelLabPage.tsx`, `web/components/fuel/*`: every section of spec 10.6 in phone
  order and two columns from 900 px; the ladder with state words, an evidence grade per rung and
  `aria-current="step"`; "Fuel history, newest first" as a scrollable labelled region; products
  with exact bodies and the 409 beside the field; the four switches in one PUT, a gut condition
  forcing the others off, the 400 on the advanced opt-in unticking and focusing the box; the gut
  block in its four states; the EAH card standard and stronger with `role="note"` and hours from
  `P.n7.eahStrongerAlertHours`; the opt-in labels read "above 60 g/h, up to 90 g/h" and "above
  90 g/h, up to 120 g/h" because `P.h7.carbAdvancedGPerH` is [90, 120]); reached from More; a
  source scan asserts the lab components import no engine fuel function. E10s-5: the track-record
  e2e (`13-track-record.spec.ts`: record with a linked run, persist, edit with a re-score, remove;
  the summary turning on with the third race; 360 px) with `seedPredictionLogs` in the e2e helpers
  writing the log through Prisma, because nothing is logged on or after race day; the engine design
  points to L7. Merge: `BriefLine` replaces `ChangeLine`, so `ChangeLine` and `ChangeSheet` are
  deleted with their styles and tests (the Sheet focus fallback is tested through "Remove window"
  on the banner); `PLAN_READER_KEYS`, `invalidatePlanReaders` and `NEW_PLAN_KEYS` live in
  `web/api/client.ts`, and `invalidateNewPlan` and `useSaveReview` go through them; `fuel.ts`
  holds the outbox save and the product and settings hooks together. Gates on the merged branch:
  `npm run check` (220 files, 9900 tests), `npm run build` (entry chunk 352 kB, charts no longer preloaded), `npm run test:e2e` (53), owner validation byte-identical to wave 5; no migration, so no Docker build. Adversarial review: see below.
- Wave 6 left for later tasks: the fold holds for up to one readiness signal (three signals push
  Done past 788 px at 390×844 by arithmetic); the spec's 788 and 707 limits are not both
  "viewport minus the tab bar", and at 360×740 unanswered Done sits inside the viewport but
  behind the tab bar; the brief line reads "no key session this week" once the week's first key
  session has passed, although a later one may remain (a "none left" template or a live next key
  from the plan would fix it); the brief line draws nothing offline, as the watch line does, since
  the brief page is not cached; `RevisionDiff` shows a Why only for revision-level rules, so a
  state-driven update has no Why where spec 8.6 gives each changed session one; spec 8.6's
  undo-reason examples differ from the shipped server copy; `BriefLine` can clip "Open the brief" inside its two-line clamp; the fuel settings form's
  "opens after" hint reads the ladder replayed under the saved settings and can understate what
  the server would allow (the server stays the authority and the sentence appears after any
  refusal); focus drops to the page after a successful fuel settings save, because the lab page
  remounts the form; the manual watch checks of E1 (three FIT files on the owner's watch, one live
  intervals.icu run for the sport-settings field names, percent-pace parsing, the 40 bpm floor,
  `external_id` and a date change by PUT, which Garmin model and manual route the help text should
  name, a real calendar app subscribed to the `webcal://` link) all stay open, and "On your watch"
  stays an inference because the app cannot see the Garmin tick; the "N
  predictions logged so far" line shows only on the active goal; `PredictionLog` is non-state and
  E10 must reclassify it as state in the PR where it reads the record into the engine; the
  prediction job still records idle runs; dark mode, real devices and screen readers were not
  checked by hand on the new pages.
- **Phase 3a wave 5 (branch `feat/coach-phase3`, PR from `wave/3a-5`, 2026-10-23):** the one-tap
  surfaces, the plan sheets and the brief. E2-6: the check-in is one row under the readiness verdict
  ("How do you feel today?", five answers in a radiogroup; one tap saves the fatigue score, folds the
  row into "Checked in" with "Add more" and moves focus to the verdict; "Something hurts, or I'm
  ill" opens the full check-in sheet); the outbox (`web/pwa/outbox.ts`: an IndexedDB queue of the
  allowlisted idempotent PUTs, the check-in of a day and the fuel log of a run, that survives a
  reload and a lost connection; writes to one URL are combined, replayed oldest first on online, on
  return to the foreground and on open, one at a time; a 4xx drops the entry with an inline
  message, a 401 and sign-out empty the queue, entries older than 7 days drop, a send over 10 s
  counts as no connection; the row and the sheet say whether an answer is saved or kept on the
  phone); Done opens a sheet that logs the run the hero shows with a draft kept on the device; Not
  today opens a sheet that moves or skips the session; spec 7.6 follows. E1-7: Plan gains a wrist
  strip (the next 14 days counted by what they mean, "Send again", the week as a zip), a chip on
  each run in the window, a zip link under each week and an "On your watch" section in the session
  sheet that reads `GET /api/plan/sessions/:id/workout` (targets resolved through the same code as
  Today, the file and the watch; refusals from the workout templates); `WristLine` for the Today
  watch slot; every chip and sentence a publish template; nothing renders offline or when the
  status cannot be read while the downloads stay; the wrist status reports the calendar link; the
  `publish.wrist.*` sentences point at controls that exist; the intervals.icu event text says "By
  effort" where the resolver leads by effort; `DELIVERY_VERSION` is 2. E4-5: the weekly brief
  (`WeeklyBrief`, migration `weekly_brief`, non-state: the job and a request write it and nothing
  memoised reads it; no seen column, seen when its revision is; `shared/engine/brief.ts` builds the
  facts: last week, the decision, the changes with a cause each, up to four noticed facts with their
  sources, the next key session with the resolver's targets, the countdown and a prediction line
  that waits for two weekly estimates a week apart, with no new Param; `shared/copy/briefTemplates.ts`
  and `briefRender.ts` word it in the runner's units, `targetRows` moved to `shared/copy`;
  `runReplanJob` writes the brief after the re-plan in a try/catch of its own, with a replan note
  after a refused or failed re-plan; a request builds the current week's brief when none exists,
  never a past week; `GET /api/brief`, `GET /api/briefs`, `POST /api/briefs/:weekStart/seen`; Explain
  answers `subject=brief`). E5-7: "Not 100%" in the Plan header opens a three-step sheet (reason,
  dates, preview) over the disruption routes; "Update plan from latest data" previews first and
  applies with its hash; every action goes preview, confirm, commit with `expectHash`, a stale
  preview swaps in with a sentence, a blocked one disables Apply; `NotFullSheet` takes its bounds
  from the Params, its dates from the server's day, the n-3 sentence, a running-time line over the
  next four weeks from the sessions and a race-day note; `DisruptionBanners` (I'm better, Finish
  early, Extend, Remove window, each previewed); `AdjustSection` replaces `SessionChanges` with live
  dry runs of move, swap, shorten, skip and restore, the guard messages with their one-tap
  suggestion and the result as a revision with its undo, and the web no longer sends the legacy
  PUT; "Rest window" and "Return week" chips on Plan; "Remove this rest window instead" when an undo
  is refused for edited-since; `shared/copy/windowView.ts`; `invalidatePlanReaders` in
  `web/api/plan.ts` refreshes plan, revisions, disruptions, reviews, brief, state and Today after
  every plan-changing write. E6-6: the 20-second fuel log (`FuelLogSheet` saving through
  `PUT /api/fuel/logs/:activityId`: product chips with steppers, "Same as last long run", food not
  on the list, a live total against the target, fluid chips from the runner's recent amounts, gut
  and nausea scales, "It was hot", "Not this time", a draft on the device; a first log needs taps
  only); `TodaySlot` renders the mounts registered in `slotMounts.tsx` (the fuel target line as a
  disclosure closing to its 26 px budget, the prompt card) with no new request; Fuel sections on
  the activity page and in the session sheet; `shared/copy/fuelUi.ts`. E10s-4: Goals gains "Record
  result" and "Edit result" on each goal whose race day has come, a result sheet (outcome, finish
  time, date, distance, an optional activity within three days that is marked a race when linked,
  a note; refusals under their fields, focus to the first invalid field; "Remove result" asks
  first) and the prediction track record (the lead, the summary, each race newest first with a
  Recharts chart named for assistive technology and a captioned table; `shared/copy/trackRecord.ts`;
  `web/components/goalFormat.ts` shared by both sheets). Merge: the e2e specs are `12-today`,
  `13-record-result` and `14-disruptions`; `NotTodaySheet` mounts `AdjustSection` and closes after an
  applied change (`onApplied`); one `useOnline`; Today pins unchanged (26 cold, 10 warm, 5
  data-version reads). Gates on the merged branch: `npm run check` (212 files, 9260 tests), `npm run build` (entry chunk 324 kB), `npm run test:e2e` (40), `docker build .` (fourteen migrations apply), owner validation byte-identical to wave 4. Adversarial review: see below.
- Wave 5 left for later tasks: the Not today sheet closes after an applied change, so its undo is on
  Today's change line and in the toast rather than in the sheet; a re-plan keeps owner edits for
  `keepOwnerEditsDays` (14 days), so a shortened run further out is rebuilt by "Update plan from
  latest data" and the preview shows it; the legacy `PUT /api/plan/sessions/:id` stays for API
  callers and two e2e set-ups although the web no longer sends it; the global API limiter allows
  20000 requests per 15 minutes outside `NODE_ENV=production` (the Docker image sets production; a
  bare `npm start` without it runs with the wide limit); the tap-opened sheets are lazy chunks, so
  E2-8's offline shell must precache them; a fuel-log item whose product was edited since the log
  loses its product link on the next edit; sign-in and setup clear the outbox, so a queue left by
  an expired session is lost; `RevisionDiff` and `WindowActionSheet` import each other; screen
  readers and the layout from 900 px were not checked by hand; `DELIVERY_VERSION` 2 re-sends every
  sent run once (deleted events stay deleted).
- **Phase 3a wave 4 (branch `feat/coach-phase3`, PR from `wave/3a-4`, 2026-10-23):** the first
  surfaces and the plan actions on top of the wave-3 services. E2-5: Today rebuilt around the
  readiness read and the session hero (`web/components/today/*`, one CSS module per component: the
  verdict and its signals first, the session as the hero with the duration as the display figure and
  the targets in the lead's order, the cooler start, a "What to know today" disclosure that remembers
  its state; the week strip with marks by shape and names for screen readers, the change line in the
  brief slot with a Details sheet, the race countdown with the finish range; the payload carries the
  race distance and the card-rule unrated list; the 28-day strip and the 12-week chart load when the
  foot of the page nears the viewport; `useToday` refetches on focus; design 4.7 and item 18 of
  section 7 record that the hero is the session and readiness). E1-5: the intervals.icu publisher
  (`server/services/publish.ts`: today to +13 of the active plan's runs, read before write, upsert
  before withdraw, one outcome per session; remote id `rl-<userTag>-<externalId>`; change detection
  by athlete key, home forecast stamp, a due retry and a 30-minute backstop; a run writes only
  non-state tables and leaves the data version alone; per-session back-off, a rate limit pauses the
  channel, a refused key marks the integration `needs_auth`; `GET /api/wrist/status`,
  `PUT /api/wrist/intervals`, `POST /api/wrist/publish`, `DELETE /api/integrations/intervals`; a
  two-minute check and a forced 04:45 run; tomorrow's run that is not on the watch is a Today health
  note). E1-6: the private calendar feed (`GET /api/calendar/:token/plan.ics`, 28 days of all-day
  events from `buildDeliverables`; the router sits ahead of the same-origin guard, authentication and
  the body parsers and compares the token's SHA-256 against `DeliveryChannel` in constant time; any
  unknown token is the unknown-route 404; refusals limited like sign-in; `POST` and
  `DELETE /api/wrist/calendar/token`; public titles and figure-free outlines only; no clock input;
  the access log masks the token; `userTagOf` in `server/crypto.ts`). E4-3: the Why drawer opens
  with "From your numbers" (`web/api/explain.ts`: `ExplainRef`, `useExplain`; `InputFacts` renders
  each rule's figures in the runner's units with up to five sources linked to the runner's own
  records; every call site passes a subject; a failed request keeps the rule section; `why.*`
  templates). E4-4: one diff and undo component set (`RevisionDiff`, `PlanDiffView` with moved lines
  folded and "Show all N changes", `UndoControl` previewing through `POST /api/plan/preview` with
  the confirm sentences and every `UndoReasonCode` worded in one exhaustive record; `attributeChange`
  derives the causes from the stored revision into `PlanRevisionView.causes`; `owner-edit` joins the
  cause list; a revision written for a request is seen at write, an undo marks its target seen, the
  scheduler's revisions stay unseen until a surface opens them). E5-5: disruptions on the server
  (`Disruption` is a state model, migration `disruptions`; a window is a plan action previewed by
  `POST /api/plan/preview` and committed by `POST`, `PATCH` and `DELETE /api/plan/disruptions` in one
  transaction and one revision with the skips of the covered past days and the re-plan; only
  `applyReplan` with a window step writes a window; the snapshot loads the active windows into
  `estimateState`, readiness and every `EngineInput`; `keptByReplan` takes the held dates; undo
  withdraws a created window or restores an edited one; `coach.disruptions` and the disruption slot
  on Today; a commit that lands while a re-plan is decided answers 409 `stale-preview`, with
  `replanActivePlan` deciding again once). E5-6: move, swap, swap-kind, shorten, skip and restore as
  one guarded action (`shared/engine/adjust.ts`: the guards moved out of `planEngine.ts` plus F3,
  rest windows, quiet days and per-day caps, the spike limit, a restore held to the week target and
  the back-to-back pair; each guard carries a code, a template that cites its rule and the
  alternative that would work; shorten scales steps, distance and climb and sets `adjusted`;
  `server/services/adjust.ts` and `POST /api/plan/sessions/:id/adjust`, with `computeAction` building
  the preview and the commit from one `adjustCheck`; `PlanGuardView` is
  `{ code, message, rules, effect, suggest }`). E6-5: the fuel lab view (`GET /api/fuel` from one
  replay memoised by data version, `GET /api/fuel/targets` for at most 62 days,
  `PUT /api/fuel/settings`; `loadFuelContext` replaces the stub and callers pass the snapshot or
  forecast they hold; `slots.fuel` and `slots.fuelPrompt` on Today; `options.gutTraining` is set only
  by the plan writers from the stored switches; a confirmed duplicate's fuel log moves to the
  original). Today pins: 26 cold reads, 10 warm, 5 data-version reads. `PARAMS_VERSION` stays
  `2026-10-23.2`. Gates on the merged branch: `npm run check` (191 files, 7776 tests), `npm run build`, `npm run test:e2e` (26), `docker build .` (thirteen migrations apply), owner validation byte-identical to wave 3. Adversarial review: see below.
- Wave 4 left for later tasks: Today's change sheet lists the revision page (50 rows) to
  show one revision and lists it again after the seen stamp (a by-id route for E4-8); revision dates
  are cut in the device's day, as the Goals page has always done; the week strip announces today only
  on a day with a session; a past check-in source links to Today; the feed's `X-WR-TIMEZONE` names
  the home zone; `DISRUPTION_COLUMNS` is a hand-kept list equal to the schema minus the bookkeeping
  columns; the prediction job still records idle runs.
- **Phase 3a wave 3 (branch `feat/coach-phase3`, PR from `wave/3a-3`, 2026-10-23):** the services
  and routes on top of the wave-2 stores. R0-2: undo, preview and seen (`server/services/revisions.ts`,
  `planActions.ts`, `shared/engine/undoGuard.ts`): `computeAction` is the one builder of a preview and
  its commit; `POST /api/plan/preview`, `POST /api/plan/revisions/:id/undo` (409 with the reason codes,
  422 with the checklist, stale-preview by head revision or midnight), `POST .../seen`; a linked run
  is checked before the hash (the wave-2 finding) and the listing no longer reads undo payloads.
  E3-8: every body and query is parsed after authentication (`server/app.ts`; the ingest token path
  has its own parser; 16 KB on setup and sign-in), "Make active" builds the plan on the chosen goal
  with a `goal-switch` revision and a confirm dialog, archived plans can be restored with their ids,
  the catch-up skips a plan generated after the slot, `latestJobRuns` reads one row per job, four
  foundation e2e specs and two 360 px cases, ADR 0009's measured timings (today 10.4/2.1 ms cold/warm
  on a synthetic three-year history). E2-4: Today is one coach payload (`server/services/today.ts`:
  hero, eased session, targets, heat, week strip, race, change line, health notes, slots; an ETag with
  registered stamps; 16 reads cold, 4 warm, 3 on a 304; a future date is a read-only preview). E1-3:
  the FIT workout writer (round-trips through the project's parser; golden files), `buildDeliverables`
  as the one builder for every delivery, per-session and per-week downloads, the workout fragments as
  templates (`shared/copy/workouts.ts`), the publisher reconciled to them. E5-4: disruption windows in
  the engine (`EngineInput.disruptions`; held days become rest sessions with `rest-window`; return
  fractions; overlapping windows count as one layoff; a 16th checklist item `disruption-window`; the
  `adjusted` status; byte-identical output with no windows; a 576-window seeded sweep). E4-7: "What
  stood out" (`server/services/insight.ts`: eleven findings per run, at most three shown, stored on
  first read as `ActivityInsight` (non-state) and refreshed by the pipeline hook after a store, link,
  rating or edit; the run card; migration `activity_insight`). E6-4: the fuel schema (`FuelProduct`,
  `FuelLog`, `FuelSettings`, state; migration `fuel_lab`), products, settings and the log API, each
  log carrying a snapshot of its products and the replayed ladder. E10s-3: race results
  (`PUT`/`DELETE /api/goals/:id/result` in one transaction with the activity retyped to a race and the
  weekly predictions scored) and the track-record read model (`GET /api/predictions/record`, memoised).
  `PARAMS_VERSION` is `2026-10-23.2`. Gates on the merged branch: `npm run check` (173 files, 6629 tests),
  `npm run build`, `npm run test:e2e` (25), `docker build .` (eleven migrations apply), owner
  validation byte-identical to wave 2. Adversarial review: see below.
- Wave 3 left for later tasks: a 3-day window drawn
  mid-week lowers a ramp-limited plan's later weeks by about 10% until the next Monday re-plan
  (E5-4; window-lowered weeks could be ramp-skip weeks); `isHotForSteering` has no production caller
  that changes a session until E2-5/E1-5 read it; the FIT files' watch behaviour (manufacturer 255, repeat steps, string caps) and
  the hike as sport running await the owner's watch check; the prediction job still records idle runs.
- **Phase 3a wave 2 (branch `feat/coach-phase3`, PR from `wave/3a-2`, 2026-10-23):** the stores
  and engines the surfaces will show. R0-1: the revision foundation (`server/services/replan.ts`:
  `computeReplan` reads only, `applyReplan` and `recordPlanWrite` are the only writers of a re-plan
  or a revision; every re-plan and owner session edit stores a session-level diff and a row-level
  undo payload; `GET /api/plan/revisions` pages and hides empty diffs; `revision.undoWindowDays`
  7 days; ADR 0007 accepted and the rewrite design's anti-goal amended). E3-3: Open-Meteo moves
  behind two caches (`ForecastCache` non-state, `ClimateCache` state) filled by the weather job
  with a 15-minute back-off and a 20 s request timeout; no request path waits on Open-Meteo
  except the forecast route and `ensureClimate` before plan generation (a profile or goal write
  and a stale forecast read only start a background refresh); `Deps.fetch` is injected and the
  test context's default fetch refuses the network; `forecastStamp` for the publisher. E3-5:
  `GET /api/activities` is a paged envelope without the heart-rate histogram and `GET /api/stats`
  serves the statistics from six-column rows memoised by data version; the Activities page loads
  50 at a time. E1-4: the publish channel (`DeliveryChannel`, `WristPublication`, both
  non-state; `PublishProvider`; the intervals.icu publisher with every spec 6.6 status path against
  an injected fetch; public titles only through `publicTitle`; ADR 0008 accepted). E4-2: the
  explain inputs (`shared/engine/explainInputs.ts`: builders for g-1, g-2, g-6, A2-A8, C1-C5,
  J2-J5, J7 and L1-L6 with a gap sentence each; `GET /api/explain` from the snapshot and
  `memoByVersion` only; the four `standout` Params under `design-explain`). E5-3: rule J9 with
  `j9.maxWindowDays`, `j9.maxBackdateDays` and `j9.niggleEasyDays`, and the pure disruption module
  (`shared/engine/disruption.ts`: window phases, the niggle tail, return fractions, week caps,
  held dates, validation; `illnessPhase` rebuilt on `illnessGate` with identical results). E6-2:
  the pure fuel ladder (`shared/engine/fuel.ts`, `fuelCopy.ts`, `shared/domain/fuel.ts`:
  `replayLadder`, `fuelTargetFor`, the watch line, the EAH card; E6-1's seven replay mechanics
  confirmed against the spec, one amended in H7: a tolerated hot-day run is neutral). E6-3: the
  gut-training option (`options.gutTraining`, on unless set false) and the `fuel-practice` flag on
  up to `h7.gutBlockSessionsPerWeek` long, easy or race-pace runs of at least 60 minutes, decided at
  placement; weeks, minutes and zones unchanged. E10s-1: `RaceResult` (state), the weekly
  de-duplicated prediction log with `weekStart`, `loggedOn` and the course snapshot, `recordPrediction`
  at both plan writers, the six-hourly ensure job. `PARAMS_VERSION` is `2026-10-23.2`. Four
  migrations, renumbered at merge to sort after the sync log's (`wrist_delivery`, `race_results`,
  `revision_model`, `foundation_weather_cache`). Gates on the merged branch: `npm run check`
  (159 files, 5547 tests), `npm run build`, `npm run test:e2e` (19), `docker build .` (nine migrations apply),
  owner validation identical to wave 1. Adversarial review: see below.
- Wave 2 left for later tasks: `computeReplan` does not await `ensureClimate` (only generation
  does, per the spec); `ClimateCache` rows are never pruned; after a boot the first weather tick
  (30 s) leaves Today without a heat note; e2e spec 08 saves a home location and so causes one
  background Open-Meteo request from the e2e server; `planEngine.ts` and `replan.ts` import each
  other (uses inside function bodies only); `RUN_CAP_MAX_MIN` 240 in the disruption form is a
  named constant, not a Param; the explain service makes one narrow `executionRecordsByWeek`
  query for a weekly decision because the snapshot does not carry execution assessments; the
  Stats totals read the whole history (lifetime figures cannot be bounded); the intervals.icu
  module's live behaviour (sport-settings fields, date-only `start_date_local`, step syntax,
  `external_id` echo) is unconfirmed until the owner's manual run.
- **Phase 3a wave 1 (branch `feat/coach-phase3`, PR from `wave/3a-1`, 2026-10-23):** the
  foundation every surface reads. E3-2: the cached athlete snapshot (`server/services/athleteState.ts`:
  `loadAthleteContext`, `memoByVersion`, `currentGoalFor`; one build shared by concurrent requests,
  rebuilt once per state write, day change or TTL, never stored when it overlapped a write or a
  transaction; deep-frozen), `GET /api/state` with an ETag and 304, the DataInUse panel on
  Integrations, ADR 0009 accepted; warm Today reads fall from ~8.5 ms to ~2 ms on a three-year
  synthetic history. E3-7: session identity (`pairSessions`, `carryExternalIds`,
  `workoutExternalId` in `shared/domain/sessionIdentity.ts`; `writeReplannedSessions` updates paired
  rows in place and returns a `SessionWriteSet`), so a Monday re-plan of an unchanged plan keeps
  every id and `externalId` (205 of 205 on the owner's plan; the old write kept 0). E3-6: the
  `SyncRun` log (one row per pull, push, folder scan and job; `GET /api/integrations/:provider/runs`,
  `GET /api/jobs`; `safeMessage` strips tokens; 200 rows and 90 days kept), honest Garmin wellness
  truncation (`WellnessTruncated`, `paused` never `ok`), the weekly catch-up re-plan on start and
  every 6 hours (ADR 0007), the SyncHistory card. E2-3: the Today engine pieces (`readinessSignals`,
  `readinessVerdict`, `rangeLabel`, `weekStrip`, `formatEstimate`, `isoDateInZone`,
  `restingHrEval`; templates in `shared/copy/today.ts`). E1-2: the workout model
  (`shared/workouts/*`: `toWorkoutPlan` for every publishable kind including the run-walk ladder,
  `publicTitle` from a closed allowlist, rule O1 with `o1.hrFloorBpm` and `o1.hrTargetMinStepSec`).
  E6-1: the nine `h7` fuel-ladder Params, the H7 rule text and ADR 0011. E10s-2: the prediction
  back-test scorer (`shared/engine/backtest.ts`), the `l7` Params, the L7 rule text and the
  track-record copy. `PARAMS_VERSION` is `2026-10-23.1`. Gates on the merged branch: `npm run
check` (142 files, 4337 tests), `npm run build`, `npm run test:e2e` (18), `docker build .` (the sync-log migration
  applies), owner validation identical to wave 0. One merge interaction was caught by the gates
  and fixed (the sync-history page test did not expect the Integrations page's new state read).
  Adversarial review: see below.
- Wave 1 left for later tasks: `TODAY_TEMPLATES` verdicts can
  name a session on a day with none (E2-4); `median` now exists three times in `shared/engine`
  (`athlete.ts`, `readiness.ts`, `backtest.ts`); idle folder scans every 5 minutes fill the
  200-row `SyncRun` cap in about 17 hours (E3-8 or the next boundary decides whether idle
  scheduled runs are recorded); the fast finish of a long run, the easy part of a strides session
  and quality warm-ups are published as open steps because `resolveTargets` holds no band for
  them.
- **Session identity (E3-7, the contract for the publish channel in E1):** a session's `externalId`
  is its only durable identity, kept by owner moves, swaps, skips and restores and by every
  re-plan that leaves it on the same day and kind (`pairSessions` in
  `shared/domain/sessionIdentity.ts`), carried by a regenerate for sessions dated today or later,
  and new when a re-plan changes its day or kind, so E1 publishes under
  `workoutExternalId(externalId, userTag)`, creates the new event before it withdraws the old one
  and derives no id from the date, the kind or the order.

## Load progression close: adversarial review (2026-10-25)

Six lenses over the merged diff of the integration branch against `main` (L2 to L6 and L3d, at
`47c9984b`): engine contracts, evidence honesty (the lens L7 added: no sentence or Param note claims
more than grade D, none says that a limit prevents an injury or that the response or a raised
target is safe, G-5 and G-1 unchanged), copy and explanation, server and API, web and e2e, and
tests, documents and the public repository. 42 findings, each tried by two independent refuters:
30 confirmed, 12 disputed (both refuters refuted each) and 0 unverified. The 30 confirmed findings
are 21 distinct defects after merging duplicates, plus one more that is deferred (the kept-target
warning). Tasks L7a (engine, server and tests) and L7b (copy, explanation, documents and research)
fixed them on the integration branch.

Fixed (the numbers are those of the review):

1. Fixed in L7b. The block line and the 3 × 30 route line said "averaged" for the block's score,
   which is the mean without the highest week; both now say "without the highest", with a test of
   unequal weeks (280, 280, 280 and 400 give 280).
2. Fixed in L7a. `Plan.options` was read raw by two paths, and the three positions were listed
   three times; one reader and one list.
3. Fixed in L7b. The Why drawer read the position and the zone from the neutral-goal input, so a
   plan whose goal race had been run could differ from the Plan page; it reads the plan's own input.
4. Fixed in L7b. A second loading-week predicate in the response facts; one shared predicate.
5. Fixed in L7b. The 0.70 credit was called "the fall" in tendon stiffness and "the cautious end of
   the J7 table"; it is close to the share left at day 23 (about 71%) and near the 75% J7 tier
   (rule, Param note and spec; no value or grade change).
6. Fixed in L7a. The clipped-target sentences claimed "the most the limits allow" when the kept
   figure could be the plan's own or the minutes already run; they now say which bound set it.
7. Fixed in L7b. The limits line said that growth never passes 30% over two weeks, though the
   start and return weeks are exempt; it now says so.
8. Fixed in L7b. "A year of running" was written into the 3 × 30 route line (it reads
   `a5.noviceMaxYears`), its threshold was a second copy, and two documents said that the
   calendar-year check "covers about 10 to 22 months", true only near late October.
9. Fixed in L7b. The trade-off line was on the Generate form only; it is also in the Plan page's
   Load panel, and the Why drawer carries no trade-off by decision (it states facts of the plan,
   not the choice).
10. Fixed in L7b. The step printed as 14.02% in the g-2 and g-6 facts and 14% elsewhere; one step
    formatter.
11. Fixed in L7a. A literal "10%" in the ramp-soft summary, and a checklist soft note that used the
    usual step for a zone week; the note names each soft week's own step.
12. Fixed in L7b. The Upper band hint omitted the sentence on weeks run above plan.
13. Fixed in L7b. Spec 4.6 stated two things the code contradicts (the explain templates use no
    "you" because the existing ones use none; a revision line for a change of position that no
    action produces yet).
14. Fixed in L7a. A raised target clipped by a temporary limit became a standing hand-set cap at
    the next re-plan; those clips are now written as the plan's own figure with no override.
15. Fixed in L7a. API tests seeded a birth year that makes the runner 45 from 2030.
16. Fixed in L7a. Nothing reached rule g-8 through the real explain path; an API test now does.
17. Fixed in L7b. Rule g-8, ADR 0013 and spec 4.3 said that the setting changes only the step below
    `R` and that the response is off above `R`; above `R` the response still lifts the baseline and
    the usual 10% applies to it.
18. Fixed in L7b. ADR 0013 and spec section 7 stated the response without a bound, and L3d shipped
    two bounds without a recorded approval; both documents carry an "Amended 2026-10-25"
    paragraph, and the decision is listed under "Decisions for the owner".
19. Fixed in L7b. Spec 4.6 named `{mean}` where the template names `{from}`.
20. Fixed in L7b. Spec section 8 named an ADR file and a page test that do not exist.
21. Fixed in L7b. ADR 0013 cited section 4.7 for the 20-week G-1 figure; it is in sections 2.7
    and 4.9.

Deferred (follow-ups 23 to 26, no code change):

- Deferred to follow-up 23. Spec 4.8 said that a kept target above the soft step carries the
  `progression` warning; it does not (the checklist comes from the engine draft, which never holds
  the runner's raised figure). Spec 4.8 now says so (L7b).
- Deferred to follow-up 24. G-1 can hold every run of a week at one cap, so the long run does not
  take the remainder.
- Deferred to follow-up 25. The A5 low-frequency flag arms at a start level over 60 minutes with
  fewer than two runs a week.
- Deferred to follow-up 26. After a hold decision one re-plan placed sessions under 80% of target in
  25 of 57 future weeks of one replayed chain.

Disputed and recorded (not fixed; both refuters refuted each): the upper-step row graded C
"inherited" (D1, D4; recorded in spec 4.5); `holdOf` restating the hold conditions (D2, shared
primitives); ADR 0009 wording for the plan's own block (D3, no new query); the trade-off sentence
against the corpus (D5, it matches damsted-2018 and nielsen-2014 and the lines beside it hedge it);
"conservative" scoped to cessation values (D6); spec 4.3 "observed bands" (D7, text from main, a
derivation statement); the standard hint as a conditional (D8); checklist and guard sentences as
literals (D9, the repository's mechanism for engine messages); g8-held copying `load.held` (D10,
tied by tests); a kept-only re-plan stored as an empty revision (D11, deliberate: the week shows
its target); follow-up 22 stale (D12, rewritten below).

Gates at `f3a8991d` (the L7a and L7b merges): the owner validation at Steady identical to the
baseline; `Test Files 241 passed (241)`, `Tests 11776 passed (11776)`; `npm run build` ok;
`npm run test:e2e` `79 passed`; no migration, so no Docker gate.

## Phase 3a close: whole-phase contract-drift review (2026-10-23)

Six lenses over the whole repository at the wave-7 head, one per contract family (engine, copy and
explain, server and delivery, web, ADRs and documents, public repository and safety), each
searching for second implementations of a section 4 contract, bypasses, contradictions between a
document and the code, and personal data; 43 findings, each tried by two independent refuters:
24 confirmed, 19 disputed.

Fixed on the integration branch before the close PR (`task/3a-C1-fix-server`, `task/3a-C1-fix-web`,
`task/3a-C1-fix-docs`, and two direct commits):

1. Safety and the public repository: the Docker ignore list named a top-level `data` folder but not
   `prisma/data`, so an image build copied the development database; the engine plan's task E16
   described a real recent history and now describes the synthetic shape it was derived from; the
   overshoot-week fixture's race date moved away from a real date.
2. Engine and explain: the Why drawer built the weekly decision from a goal-less input, so a
   post-race week contradicted the stored decision (the plan's goal model is passed); readiness,
   checklist and execution sentences restated Param numbers as literals and some thresholds were
   unnamed numbers (built from `P`, new grade D Params with the same values, a Param-swap copy
   test); the execution assessment was worded twice with raw kind codes (codes and slots rendered
   through templates); the link-conflict message printed raw kind codes.
3. Server and delivery: the intake sync status text was hand-built prose used as control flow
   (templates and a structured signal); changing the intervals.icu connection to another athlete
   made every sent publication read as deleted by the runner with nothing to revive it (the rows
   reset on an athlete change; switching sending on and "Send again" revive them); a past-dated
   failed publication kept the two-minute tick running a full publish forever (bounded to rows a run
   can act on); trim detection used `isTrimmed()` everywhere; the intervals.icu rejection text goes
   through `safeMessage`.
4. Web: banned G5 words on the import, sign-in, setup, profile and integrations pages that no
   linted test rendered (reworded; the pages are linted); the session sheet's step names differed
   from the watch's (one map); two metric figures bypassed the runner's units; Done on a hike
   session logged an activity the matcher could never link (manual activities carry a subtype and
   the second `compatible` copy is gone); a 401 on `GET /api/auth/me` did not purge the drafts and
   the outbox; editing a goal left its prediction and Today's race block stale; the wrist write
   hooks did not refresh the Today payload that carries the watch slot; the session sheet's second
   target-row formatter joins the cross-surface registry; the Meter's threshold is a Param and its
   hours come from the payload; the wrist range and the folder scan interval are filled from the
   constants the code uses; app-authored provider failure texts are templates.
5. Documents: CLAUDE.md's Open-Meteo bullet says what is true (handlers start background refreshes
   and never wait, except the forecast route and `ensureClimate`); "Where things stand" no longer
   describes the pre-wave state; the spec records that idle scheduled sync runs are not stored;
   ADR 0010 records `PlanRevision.summary` as a template output fixed at write time; the rewrite
   design's item 19 lists the shipped routes; the engine design counts 370 papers; ADR 0007 and
   spec 4.2 state the 14-day rule for owner edits; spec 4.4's `PublishFailCode` has
   `owner-removed`; ADR 0003 records the brief's stored minutes; the documents say where
   `PublishProvider` lives; ADR 0012 keeps approximate sizes without a build id; the phase spec's
   status reads Implemented.

Disputed and recorded (not fixed; reason in brackets):

- `PARAMS_VERSION` was not bumped for the #548 rule change [the version marks Param changes; #548
  changed a rule, not a Param].
- Derived athlete values are recomputed in `server/services/execution.ts` outside the snapshot and
  memo [reads of the snapshot's own rows; no second query of the history window].
- The real goal date stays in the published git history (three commits before the wave-3 fix)
  [history is never rewritten; the tip has been clean since wave 3].
- The access log writes the Strava OAuth callback's code and state [the line is written on the
  response's finish, after the code is exchanged and spent].
- Five commit subjects of this phase exceed 72 characters [pushed history; the template is shorter
  from here on].

## Wave 7 adversarial review (2026-10-23)

Six lenses over the wave-7 diff against the wave-6 tip (74 files); 35 findings, each tried by two
independent refuters: 16 confirmed, 19 disputed. The confirmed mediums were a second purge at
sign-in that skipped the drafts, four explain builders reading the athlete state before the break
restart the plan applies, a kept copy of today treated as a preview offline, a gap sentence that
contradicted the fact beside it, a compact banner that clipped at larger text, and a banner test
that could not fail.

Fixed on the integration branch before `wave/3a-7` was cut (`task/3a-W7-fix-offline`,
`task/3a-W7-fix-explain`, `task/3a-W7-fix-disruption`, `task/3a-W7-fix-tests`):

1. Sign-in and setup hand-built their own purge (the outbox and the API cache) and left the unsent
   drafts that ADR 0012 says are emptied; both go through `purgeDeviceData()`, and a 401 or a
   sign-in also clears the page's in-memory query cache, so a second account in the same tab never
   sees the previous account's Today first.
2. The brief line hid on the browser's online flag alone, so a worker-served copy still showed it;
   one "showing the phone's copy" predicate (online and not `servedFromCache`) drives the offline
   note, the brief line and the watch line. A kept copy of today was treated as a preview offline
   (no check-in, yesterday's time as "saved at"); a payload is a preview only when its date is
   later than the server's today, a copy of the day that has arrived renders the check-in and the
   verdict, a copy of an older day is read-only and the note names the date. The kept copy also
   drops the watch health note beside the stripped watch slot.
3. A failed shell install left an empty cache that counted as a generation and could evict the real
   previous build; the cache is deleted when the precache rejects. The 36-hour TTL bounds how long a
   copy is served, not how long it is stored; the ADR says so and expired API entries are swept on
   the first fetch of each worker lifetime. The ADR's sizes are approximate figures, measured on
   the merged build (no build id or exact byte count is pinned).
4. The offline note added height above Done that no fold test measured; the note moved below the
   session, where the fold limits hold with the connection gone (a new 12-today case measures it),
   and `slots.ts` records that it is not a slot. The note is an always-mounted live region, so its
   arrival is announced. Sign-in, account creation and a 401 also drop the previous account's
   queries (`dropUserQueries`), and `startSession()` is the one entry point for a new session. The Settings "Offline use" sentence names the real cause instead of https for every
   unavailable state. The README no longer promises the session's figures offline.
5. The explain builders for E6, D4, D7 and K1 read the raw athlete state while the plan reads it
   after the break restart; the context is built from `afterBreak`. The "next recovery week" and
   taper-week sentences said "up to 0 min" for a week a rest window holds whole (bare variants).
   The E6 gap sentence promised the run-walk ladder while the path fact beside it said otherwise;
   it states only what is missing. `planOptionsOf` used `planSwitch.storedOptions`; the unused
   `holdReasons` and `clockTimeIn` exports are gone.
6. The compact disruption banner clipped its buttons and the date at larger text sizes and its
   three-button state was never measured; the row wraps when it does not fit and the e2e covers the
   three-button state and an enlarged font. Dismissing the rest-window offer dropped focus and the
   offer's arrival was not announced; focus goes to a stable element and the offer is a live region.
   The 14-disruptions "sentence is not cut" check could not fail; it measures the content height.
7. Tests and docs: the offline e2e copied helpers verbatim (moved to `tests/e2e/helpers.ts`); the
   worker's "only a 200 answer is kept" rule is pinned; `tests/api/explain.test.ts` ends its
   `afterEach` with `expectNoRefusedFetches`; the rewrite design's item 20 places the "Not 100%"
   entry inside the Not today sheet.

Accepted from the disputed list and fixed with them: the watch health note in the kept copy, the
older-day copy's check-in and Done, the note's date, the offline note as a live region, the
Settings sentence by cause, `planOptionsOf`, the unused exports, the copied e2e helpers, the kept
answers pin, the explain suite's network guard, the rewrite design wording and the README sentence.

Disputed and recorded (not fixed; reason in brackets):

- The Plan watch-strip e2e timed out on a Saturday or Sunday [fixed before this record, in
  4ca65500 on the integration branch: the case opens the weeks of its routed runs].
- ADR 0012 was left Proposed and STATUS untouched by the tasks [the wave close stamps the ADR with
  the PR number and writes STATUS; the tasks were told to].
- The 26 px compact-banner buttons are recorded only in a CSS comment [recorded here and under
  "Decisions for the owner"; every action previews first].
- The server sends the precache uncompressed, so a first install is 3.3 MB rather than the 1 MB
  gzipped the ADR quotes [the app has no compression middleware and a reverse proxy usually
  compresses; adding a dependency for it is the owner's call; the ADR states both sizes].

## Wave 6 adversarial review (2026-10-23)

Six lenses over the wave-6 diff against the wave-5 tip (90 files); 38 findings, each tried by two
independent refuters: 15 confirmed, 23 disputed. The confirmed mediums were a brief line that
called a key session "next" after its day had passed, two focus losses on the Integrations page,
and a lazy chart that saved nothing.

Fixed on the integration branch before `wave/3a-6` was cut (`task/3a-W6-fix-server`,
`task/3a-W6-fix-web-a`, `task/3a-W6-fix-web-b`, `task/3a-W6-fix-tests`):

1. The brief line fetched `GET /api/briefs` at first paint and compared the week with the device
   clock, so the Monday rollover on an open page never reached it; the `brief` slot is now part of
   the Today payload (the stored row of the server's current week, a non-state stamp on the ETag),
   the mount makes no request, and the Today refetch at the server's midnight carries the new week.
   A key session whose day has passed is no longer called "next".
2. Nothing read `coach.change` after `ChangeLine` was deleted; the field, its memo and its
   serializer are gone and the Today pins fell with them.
3. The zone decisions and the session link changed the plan outside `invalidatePlanReaders`; both
   go through it. A failed background refetch replaced the whole Today page with the load error;
   the last payload stays on screen. `msUntilDayEnds` had a dead branch, a wrong comment and a
   one-minute retry loop for a payload date ahead of the device's day.
4. The calendar-link dialog returned focus to the body because the Create button was disabled
   while pending; wrist settings controls lost focus while saving and when the remove-sent offer
   or the disconnect choice opened; the one-time token's sheet was hidden whenever the status
   read failed or the browser went offline. The highest-tier hint of the fuel settings stayed
   beside an unlocked box and read "opens after" for an open tier; a refused advanced opt-in
   dropped the other edits silently (the rest is saved and the sentence says so).
5. The More and Research pages carried "behind" and no linted test rendered them (reworded;
   the navigation and the Research header are linted). The lazy chart in `RecentWeeks` saved
   nothing while `StatsPage`, `StreamChart` and `PredictionTrackChart` imported recharts
   statically; the chart-bearing pages are lazy and the `charts` chunk is no longer preloaded.
6. Tests: the brief e2e spawned a second server for a request budget that no longer exists and
   its teardown could skip killing it (it runs on the suite's server); the TodayWrist "same state
   again" check could run before the refetch landed (it now waits for the refetched payload to
   render); the request-count comments are corrected to the measured figure, about 1,170 `/api`
   requests for the 53-spec suite against the 20000 budget.

Accepted from the disputed list and fixed with them: the `brief` slot from the payload (above);
the dead `coach.change`; `useLinkPlanSession` in the invalidation test; `FuelSettingsForm`'s copy of
the server's settings rule moved to `shared/domain/fuel.ts`; `tomorrowNotOnWatch` reads through
`readWristItems` and the channel name is one constant; the day timer's dead branch; the unused
`WristLine` component.

Disputed and recorded (not fixed; reason in brackets):

- Today's brief line counts an undone update as "no changes" while the brief page keeps the stored
  count [the spec gives the slim item `undone` for the line; the page is the record].
- `BriefLine` says "no changes" for a provisional or failed update [the spec defines the line's
  inputs; `changes` is null in those states].
- The `NotTodaySheet` `children` prop had no caller [E5-8 fills it in wave 7].
- The `webcal://` link drops the page's scheme [no client shown to downgrade; the https address is
  beside it with Copy].
- The fold assertions at 360×740 and 390×707 do not subtract the tab bar [the numbers are the
  spec's; recorded under wave 6 as a spec-wording question].
- The 12-today fold tests share one page in sequence [the file's recorded design].
- The Today stamp costs two reads per request for the watch slot [a recorded trade-off; the pins
  hold it].
- A mid-week review re-plan is not surfaced on Today until the brief shows it [the brief line
  replaced the change line by design; the brief page and the toast carry it].
- Three readiness signals push Done past the fold limit [recorded under wave 6].

## Wave 5 adversarial review (2026-10-23)

Six lenses over the wave-5 diff against the wave-4 tip (165 files); 42 findings, each tried by two
independent refuters: 20 confirmed, 22 disputed. The confirmed mediums were a fuel-log edit that
re-snapshotted every product, a hot-day note that promised "today" on other days' sheets and in the
brief, and the e2e suite's spent request budget.

Fixed on the integration branch before `wave/3a-5` was cut (`task/3a-W5-fix-server`,
`task/3a-W5-fix-web-a`, `task/3a-W5-fix-web-b`, `task/3a-W5-fix-tests`):

1. The Not 100% sheet summed "Running time over the next four weeks" in the browser from the cached
   plan and the diff lines, subtracted skipped sessions it had never counted and could go negative;
   `PlanPreview.runMin` now carries the before and after run minutes over 28 days from the same
   write set as the diff (`shared/domain/runMinutes.ts`) and the sheet renders the payload.
2. A second weekly run in the same week replaced the brief of the real update with an empty one;
   `generateBrief` keeps a non-provisional brief whose revision changed the plan when a later
   revision of the week changed nothing. The headline no longer reads "of 0 planned minutes".
3. A `DELIVERY_VERSION` bump re-created intervals.icu events the runner had deleted, because the
   owner-removed check compared the stored hash with one that includes the version; the publisher
   recognises the same content under every earlier version, so a version-only change keeps a
   deleted event deleted while a content change still re-sends it.
4. Editing a saved fuel log re-snapshotted every product at its current amounts; an item whose
   product changed since it was logged is sent in its snapshot form with the amounts logged.
5. Outbox and drafts: a send that timed out could still arrive after the entry's next send (it is
   aborted); unsent Done and fuel-log drafts stayed in local storage after sign-out and the Done
   draft was keyed by date alone (`purgeDeviceData()` on sign-out and on a 401; the Done draft is
   keyed by user); the outbox purge depended on one IndexedDB transaction and entries carried no
   user (the database is deleted when the store fails, entries carry the user id, `adopt` drops
   another user's entries before the first replay, sign-in and setup clear the queue); a check-in
   save invalidated Today, check-ins and wellness twice (`refreshAfterSend`, the keys listed once
   on the outbox route).
6. `AdjustSection` re-implemented the server's shorten and swap eligibility loosely (a hike or race
   offered a shorten field; past sessions and back-to-back days were listed as swap partners);
   `swappable` and `shortenable` are exported from `shared/engine/adjust.ts` and used by the engine
   and the section, with today from the Today payload. The panel is a live region that exists
   before the answer, with its focus ring restored; the shorten and move inputs wait 300 ms before
   a dry run.
7. Copy and focus: the hot-day effort note said "Go by this today." on the weekly brief and on
   other days' session sheets (`targetRows` takes the day; "Go by this when you run it."
   elsewhere); the "Finish early" banner button opened a dialog titled "I'm better" (`betterWords`
   keys the label, title and intro on the window kind); the re-plan and window-action sheets lost
   focus when the result replaced Apply (the result heading takes focus); every Apply stamped an
   already-seen revision (`markSeen` only when `seenAt` is null, in every request-driven sheet).
8. The entry chunk had grown to 607 kB past the 500 kB invariant stated in `vite.config.ts`; the
   seven tap-opened sheets load through `web/components/lazySheets.tsx` (React.lazy, a notice when
   a chunk cannot load, chunks fetched at idle) and the entry is 325 kB. The copy registry and the
   Sheet are chunks the entry and the sheets share, so the code loaded at start fell by 30 kB, not
   by 280 kB.
9. The e2e suite spent 942 of the global limiter's 1000 `/api` requests per 15 minutes; the
   limiter allows 20000 outside `NODE_ENV=production` (`apiLimitFor`; the sign-in limiter stays at
   10), the suite measures 943 requests, and the budget comments are corrected.
10. Tests: the outbox "stops listening when it unmounts" case could not fail; the fold case passed
    with the fold removed; the 12-today set-up un-skipped through the legacy PUT and e2e comments
    named coverage that did not exist (the set-up restores through the adjust route); the brief
    "concurrent requests" case never reached the unique-violation branch (eight requests are held
    at `create`); the brief suite lacked `expectNoRefusedFetches` and built job deps without
    `ctx.fetch`; the Plan watch-strip e2e inherited its viewport.

Accepted from the disputed list and fixed with them: the fuel log is saved through the outbox like
the check-in (a queued log says so and the ladder refreshes when it is sent); `useUpdatePlanWeek`
and `useGeneratePlan` go through `invalidatePlanReaders`, which also covers the wrist status and
fuel; the dead `useCheckin` hook and its key are gone; the plan's E2-6 and E5-8 text and the spec's
Today paragraph say Not today hosts `AdjustSection`.

Disputed and recorded (not fixed; reason in brackets):

- Three reason-to-words maps for a disruption (`windowView.ts`, `revision.ts`, `disruption.ts`)
  [the wording differs by surface as the spec words it].
- Window and Today sentences typed in components rather than templates [rendered pages are linted
  by `expectCleanCopy`; the same practice as the rest of the app].
- `WristStrip` and the result sheet take today from the device clock [a recorded limitation: the
  app follows the home day].
- The provisional brief is recomposed on every `GET /api/brief` outside `memoByVersion` and stays
  provisional all week for a plan built after Monday 03:00 [specified: a provisional brief reads
  today's plan; its reads are the memoised context].
- `disruption.module.css` is 275 lines [the 250-line limit is E2-1's page acceptance, not a module
  rule].
- The shared `Field` renders a validation error in red [the visual design fixes it for field
  errors; not load].
- The session sheet's workout request runs the deliverable builder for a day that cannot be eased
  [memoised reads; a micro-optimisation].
- The fuel log sheet reads the whole activity detail for four scalars [the stream is bucketed;
  small].

## Wave 4 adversarial review (2026-10-23)

Six lenses over the wave-4 diff against the wave-3 tip (181 files); 34 findings, each tried by two
independent refuters: 14 confirmed, 20 disputed. The one confirmed medium was a second engine-input
builder in the explain service that left out the rest windows.

Fixed on the integration branch before `wave/3a-4` was cut (`task/3a-W4-fix-server`,
`task/3a-W4-fix-web`, `task/3a-W4-fix-tests`):

1. `explain.ts` built its own `EngineInput` without the rest windows, so the Why drawer's weekly
   decision could contradict the stored one; it takes `inputFromContext(context, { existing: true })`
   and the second builder is gone.
2. A fuel log saved on a confirmed duplicate read back as null and was never counted; a log saved,
   skipped, read or deleted on a copy addresses its original.
3. Revision causes read the week's current target source, so an override set later was credited to
   older revisions; `owner-target-kept` is credited only to a revision written at or after the week
   row's last write.
4. The calendar feed token reached the access log in an absolute-form request target and after a
   doubled slash; both forms are redacted.
5. Copy and web: `ChangeSheet` and `RevisionDiff` worded the reason labels from two template sets
   (one, `reasonLabel`); the hero chip said "Adjusted" where the sheet and Review say "Eased", and
   three files held their own status map (one, `shared/copy/sessionStatus.ts`); rest-window hold
   lines printed a double colon; the "What to know today" summary lost its disclosure marker
   (`display: list-item`); an undo from Today's change sheet dropped focus to `<body>` (the Sheet
   moves it to `#main` when its opener is gone); the Why drawer started the rule registry and the
   research bundle only after the explain request settled (requested together).
6. Tests: the idle-tick "not written" check compared `updatedAt` under a frozen clock; the "never
   blocked by later edits" case never edited a held session; the past-session 409 case was skipped by
   an `if`; a comment named the wrong file; the limited-window cap loop ran zero times; "I am better"
   did not check that the return was resized; the cross-surface fuel-line test returned the expected
   value when the FIT note lacked the line.

Accepted from the disputed list and fixed with them: a non-array 200 from intervals.icu is an
unreadable answer, not an empty calendar that marks every sent row owner-removed; a sustained outage
stores one error run instead of one every five minutes; undo invalidates the disruptions and reviews
queries; the Plan page falls back to miles like the other pages; the swap-kind guard names the
session kind in words (`sessionTitle`); the `disruptions` and `revision-presentation` suites assert
that nothing reached the network; the README names the Explain and Why buttons.

Disputed and recorded (not fixed; reason in brackets):

- `DISRUPTION_COLUMNS` is hand-kept rather than derived from the Prisma DMMF like the session and
  week columns [equal to the schema minus the bookkeeping columns today; a later column needs the
  edit].
- Revision dates are cut in the device's day, not the server's [a pre-existing pattern moved
  verbatim; travelling follows the home day, recorded in wave 1].
- A past check-in source links to Today, which shows only the current day's card [a documented
  choice; no page shows a past day].
- The feed's `X-WR-TIMEZONE` names the home zone under all-day events [a minimisation preference;
  no rule names it].
- The no-signals verdict promises a one-tap control below it [spec wording; E2-6 brings the control
  in wave 5]. Closed by E2-6.
- The week strip does not announce today on a day without a session [specified design;
  `aria-current` on the cell].
- Wrist copy names the Plan page and Integrations controls of E1-7 and E1-8 [the end-state wording
  the plan scheduled; publishing is API-only until then]. Closed by E1-7.
- Today's change sheet lists the revision page for one revision and again after the seen stamp [one
  refuter held; small today; a by-id route for E4-8].
- The `@ts-expect-error` undo-reason test checks TypeScript rather than the record [the type is the
  contract].

## Wave 3 adversarial review (2026-10-23)

Six lenses over the wave-3 diff against the wave-2 tip (135 files); 25 findings, each tried by two
independent refuters: 15 confirmed, 10 disputed. The two mediums were an engine double charge and a
fuel gate tested far from its boundary.

Fixed on the integration branch before `wave/3a-3` was cut (`task/3a-W3-fix-engine`,
`task/3a-W3-fix-server`, `task/3a-W3-fix-tests`):

1. A re-plan with the rest window its plan already carried took the held days' minutes out of the
   current week a second time; a ruled day the replaced plan already keeps to now costs nothing
   more. Repeated re-plans of the same window are stable in the pinned cases; 39 of 576 seeded
   window combinations still drift a little between re-plans (a reduced week placed under its
   target feeds the next baseline), recorded below.
2. The fuel ladder replay lost gut-block credit for runs linked to an archived plan's sessions after
   "Make active"; it reads each logged run's session flags from any plan.
3. Plan-check refusals (undo, Make active) reached the runner with raw checklist ids; they are plain
   sentences with the ids in `details`.
4. Today's "sync paused" and "weekly update not run" health notes had no producer; both are
   registered, with a stamp so the ETag moves.
5. The standout pain sentence said the pain came "with this run" when the day's check-in supplied
   it; a strides session's FIT name was cut to "Easy run with" (short FIT names per kind); one
   cool-down step name bypassed the workout templates; the disruption-window check read
   "3 day(s)".
6. The second fuel opt-in gate is tested at its boundary; nothing had made the Today hero hot from
   the cached forecast (it does now, with solar radiation in the fixture); `applyUndo`'s stale-row
   guards and dropped-link branch, the insight pipeline claims, `syncActuals`' pre-race boundary
   (one shared predicate) and the goals suite's network guard are covered; `loadForecast` builds
   one `Intl.DateTimeFormat` per zone (Today warm read 7.9 ms → 2.7 ms with a cached home
   forecast); the Build-plan button wraps a long goal name at 360 px.

Accepted from the disputed list and fixed with them: a stored run insight recomputes when the day's
check-in pain score or bone flag changes; race-result validation messages are templates; the
Today query-count guards see `findFirstOrThrow`, `findUniqueOrThrow` and `$queryRaw`; the
disruption sweep's wall-clock assertion names its margin; one fixture carried the owner's real race
date and now carries a synthetic one.

Disputed and recorded (not fixed; reason in brackets):

- `explain.ts` kept a second snapshot-to-input builder beside `inputFromContext` [one narrow
  read; E4-8's pass]. Closed by the wave-4 review fixes: the builder left out the rest windows, so
  the Why drawer's weekly decision for a week a window touches contradicted the stored one;
  `explain.ts` now takes `inputFromContext(context, { existing: true })`.
- The track-record memo reads `PredictionLog`, a non-state model [sound while no prediction is
  logged after a result; the header says so].
- A restored plan keeps its old `createdAt`, so the catch-up may re-plan it once more [a no-op
  diff].
- Server re-plan pairing calls `keptByReplan` without the hold dates [E5-5 passes them in wave 4].
  Closed by E5-5.
- `MOVABLE_STATUSES` and the `adjusted` status [E5-6 in wave 4]. Closed by E5-6.

## Wave 2 adversarial review (2026-10-23)

Six lenses over the wave-2 diff against the wave-1 base (136 files); 32 findings, each tried by two
independent refuters: 18 confirmed (one duplicate pair), 14 disputed. The two mediums were a
self-contradicting explanation sentence and a hash test that could not fail.

Fixed on the integration branch before `wave/3a-2` was cut (`task/3a-W2-fix-revisions`,
`task/3a-W2-fix-explain`, `task/3a-W2-fix-weather`), or inside R0-2 where noted:

1. The accepted and declined zone-proposal revisions were hand-built prose that also served as
   lookup keys; they are templates now (`revision.zone.*`) and the lookups read the stored
   `changes[]` (`shared/engine/zoneChange.ts`). A proposal declined before this change is no
   longer recognised and could reappear once.
2. The J4 explanation counted today's HRV reading and always said 21 days; it reads the baseline
   count and the cycle-aware lookback from the snapshot. The g-6 and J5 sentences restate the
   decision's own figures (`wholeMinutes`, the plain weekly total). The L1 anchor appears only
   when a race-anchored method was used. The C2 critical-speed row has its own sentence.
3. The undo hash read a linked run as an edit; the session-run check runs before the hash
   comparison (R0-2). `GET /api/plan/revisions` no longer reads every undo payload (R0-2). The
   undo-payload hash test compares every created and updated session and week.
4. Offset paging could repeat a row when a write landed between pages; the page joins by id and
   the count is read after the page. A goal with one race coordinate mixed it with the home
   coordinate; places are taken as pairs and the goal body refuses a half-set place.
5. The Activities page keeps its count status region mounted and moves focus to it when the last
   page loads.
6. Test strength: the disruption-cap property test reaches its clamps; the Open-Meteo timeout
   test proves the 20 s abort; the `ensureClimate` wait test is gated, not timed; the explain memo
   tests count builds; the C1 hr-band builder is exercised.

Accepted from the disputed list and fixed with them: `safeMessage`-style publish failure
sentences are templates (`shared/copy/publish.ts`); a null `external_id` echo falls back to
positional matching; the `noNetwork` guard records refused calls and ten of the 43 API suites
assert none with `expectNoRefusedFetches` (the others are not yet probed);
the publisher's global-fetch guard covers `withdraw` and `globalThis.fetch`; `ensureClimate`
returns at once when a usable climate value exists.

Found by wave-3 tasks and fixed here: the cached forecast carried no solar radiation, so
`isHotForSteering` could never fire from the forecast; `shortwave_radiation` is requested and
stored in the forecast hours (no migration), and a hot synthetic afternoon now steers.

Disputed and recorded (not fixed; reason in brackets):

- `explain.ts` rebuilds the weekly decision by hand for one narrow query [the snapshot does not
  carry execution assessments; E4-5 or E3's next pass decides whether to add them].
- An engine trim of a future session writes a plan row outside any revision, so a later undo reads
  it as an edit [trims are rare and the undo refusal names the row; R0-2 records the trim as an
  owner-visible change in a later wave if the owner asks].
- The "Eased for today" line and the step vocabulary exist in two layers [E1-3 reconciled the
  publisher to `shared/workouts` templates in wave 3].
- Percent-of-max heart rate is floored on the upper edge, so a watch alerts a beat early
  [conservative by design; the comment is corrected].
- The restart sentence says "the week before" where the rule means the week before the window
  [E4-8's reading pass].
- The weather-job test pinned an idle run wave 1 stopped storing [already changed at the merge
  of wave 1 into the integration branch].
- The pre-split re-plan oracle shares helpers with the new path and never has a weekly decision
  [the row-level comparison is the real check; noted for E3's next test pass].
- Failed or partial climate refreshes write the state table and bump the data version [rare;
  moving `failedAt`/`lastError` off the state table needs a schema change; later].

## Wave 1 adversarial review (2026-10-23)

Six lenses over the wave-1 diff against `wave/3a-0` (90 files); 23 findings, each tried by two
independent refuters: 8 confirmed (two pairs name one defect each), 15 disputed. Nothing confirmed
is above medium.

Fixed on `wave/3a-1` before its PR (`task/3a-W1-fix-readiness`, `task/3a-W1-fix-synclog`):

1. The HRV "Building your usual range (N of 10 readings)" sentence counted today's reading while
   the threshold counts prior readings only, so 9 prior nights read "10 of 10" with no range; the
   shown count is the count the threshold uses, with boundary tests.
2. The "Signals are a little low. Today's session is already easy, so it stays." verdict fired on
   every non-quality day (a long run, a race, a strength day, a day with no session);
   `readinessVerdict` now reads the day's session kinds and keeps that sentence for easy days only.
3. The check-in signal used the fatigue sentence when a different item was the poor one.
4. The sleep signal could read "averaged 7 h ... under 7 h"; the verdict now compares the value as
   shown.
5. Two sync-log tests could not fail (the `safeMessage` cut-order case and the "hostile message"
   case of `recordSyncRun`); rebuilt so they discriminate.

Accepted from the disputed list and fixed with them: `safeMessage` strips credentials after any
`Authorization` scheme, cookie values and bare token pairs, not only `Bearer`; app-written failure
messages in the sync history are templates under the lint (provider text stays a quoted slot); the
"no token in a log line" test captures real log lines; idle scheduled folder scans and weather runs
are no longer recorded, so the 200-row log holds real syncs.

Disputed and recorded (not fixed; reason in brackets):

- The catch-up and the 03:00 job can both re-plan one plan in a week [an in-process guard
  serialises them; R0-1's revision model makes the second a no-op diff]. A plan built after the
  slot is no longer due (E3-8).
- `GET /api/state` can answer 304 for a body the race-climate path would now build differently,
  and a cold read waits on up to three sequential Open-Meteo calls with no timeout [E3-3 replaces
  `raceClimate.ts` with the cache in the same wave 2].
- DataInUse says "No activities yet" for data outside its window [copy choice; E4-8's reading
  pass].
- The workout step vocabulary (`shared/workouts/plan.ts`) is a second copy of the session sheet's
  wording [E1-7's cross-surface adapter reconciles them].
- The Monday re-plan identity test runs a no-op re-plan; the overlap test has one assertion that
  cannot fail; a 50 ms real-time sleep precedes the single-flight assertion; the Vary-header test
  only re-checks the header [test-strength notes; E3-8 added the changed-plan case].

## Wave 0 adversarial review (2026-10-23)

Six lenses (contracts, correctness, security and privacy, copy and accessibility, tests,
performance) over the merged wave-0 diff against `main` (94 files); 24 findings, each tried by two
independent refuters: 6 confirmed, 18 disputed. All confirmed findings are low or medium.

Fixed in the same wave (`task/3a-W0-fix-copy`, `task/3a-W0-fix-code`):

1. The why drawer printed Param notes with metric figures beside values converted to miles (about
   70 notes restate a figure); notes now go through the same localisation as engine text, with a
   registry-wide test.
2. Four Param notes (`pain.flagScore`, `h8.weightLossToleranceMaxPct`,
   `h12.laterStepLongRunMaxMin`, `l1.sameDistanceTolerancePct`) and the G-6 rule title failed the
   G5 lint and nothing linted them; reworded, with a test over every note and rule title.
3. `computeBaselineRunMin` still loaded whole `Activity` rows for week aggregation; it reads
   `ActivityCore` rows now.
4. The plan's R0-1 acceptance and spec 4.2 still asked migration D to add the `PlanRevision`
   `(planId, reason)` index that migration B (E3-4) created; the index is removed from both.
5. The cooler-hour gain threshold (`i7.coolerMinGainC`) had no pinning test; two cases added.
6. `expectCleanCopy` linted each text node alone, so a banned phrase split by inline markup
   passed; it also lints collapsed block text now.

Accepted from the disputed list and fixed with them: the date-format test pins a time zone so a UTC
runner can catch a local-getter regression; `render()` treats a non-object `slots` record as a
missing slot (fallback in production, `CopyError` under test) instead of throwing.

Disputed and recorded (not fixed; reason in brackets):

- Canonical helpers from wave 0 coexist with in-tree duplicates in `planEngine.ts`; "trimmed" is
  still decided by separate checks in `shared/engine` [the duplicates are on the write path E3-7
  rewrites; revisit at E3-7].
- The climb note fires on every run of a climbing week because the planner spreads gain over all
  run kinds; an eased easy run keeps the original `gainM`; `easedSession` gives one cause for every
  easy downgrade [design intent of E2-2; E2-3 and E2-5 own the sentences].
- The G5 lint passes plural and inflected forms and some injury-probability phrasings [the list is
  spec 4.5's exact list; widen it only with the owner's reading pass, E4-8].
- The spec states the goal race's distance, terrain and month [not a race name, cutoff or course
  fact; distance and terrain are already on `main`].
- Focus drops to the page when the focused control unmounts in `SessionChanges` (confirmed by one
  refuter, narrower than claimed) and `FeedbackCard` [moved unchanged from `main`; E2-6 rebuilds
  the check-in sheet and should move focus].
- Window lengths ("28 days", "12 weeks") are literal in Today headings [duplicates of constants
  the same files own; E2-7 reworks the strip and the recent weeks].
- ADR 0010's parameter count is pinned to a version and dated; its status gets the PR number
  when the wave PR opens [convention].
- `today.module.css` is one 368-line module against the plan's 250-line limit [E2-5 splits it].
- The data-version write hook's nested-relation key list is mostly untested; the batched execution
  query asserts no `orderBy`; the session-kind list in engine fixtures is hand-kept [test-strength
  notes for E3-2 and E3-7].
- The why drawer holds its loading state on the settings request, so the unit fallback applies
  only after retries [E4-3 reworks the drawer's data loading].

## Decisions for the owner

Phase 3a, section 13 of its design, lists sixteen open questions with the defaults the plan
implements (undo policy, hot-day thresholds, the one-row check-in, publishing off by default, who
runs the live intervals.icu and watch checks, the niggle caution, the fuel ladder details, windows
as Params, and smaller defaults). Each default ships unless the owner says otherwise. The section-10 items are confirmed; the builder calls the second pass added are
listed there (experienced returner after 90 days off restarts at 3 × 20; ladder weeks exempt from
the soft ramp warning only; BMI > 30 holds rung 1 for three weeks; the ultra weekly feasibility
path measures toward the long-run week, not the class peak; the check-in gate is computed, not
stored, and a check-in older than 3 days neither delays nor releases a step).

Wave 7 items, decided by the owner on 2026-10-24: (a) the offline precache of the 1.69 MB
research corpus stays, so Explain works offline (the alternative was to cache it after first use).
(b) The manifest shortcuts stay Plan and Log activity. (c) `createQueryClient` keeps
`networkMode: 'always'`, so an offline tap reaches the outbox instead of pausing; offline reads
fail after about 3 s instead of waiting. (d) The G5 sentence for `research/engine-rules.md` is
approved as quoted: "A single lint (`shared/copy/lint.ts`) checks these words, exclamation marks
and injury-probability phrases in every sentence the app writes from a template; text a provider
returns is quoted, not linted, and a runner's own words (a goal name) are shown as typed." It is
applied to rule G5 of `research/engine-rules.md` (follow-up 21, done in #561). (e) The countdown
wording changes from "Weeks until {name}: {n}.", which reads oddly when a goal name ends in
punctuation, to "{name} is {n} weeks away" (follow-up 20, done in #561). (f) The compact
disruption banner's 26 px buttons are parked: the owner saw screenshots and the button size is
decided inside the Today disruption presentation task (follow-up 19), together with the rest of
the owner's feedback on Today during an illness window. The API limiter that allows 20000
requests per 15 minutes outside `NODE_ENV=production` is fine as it is. Compression of the
precache is left to the reverse proxy for now, and the app adds no compression middleware.

The distance estimate adds: (a) the owner's zones hold no pace on 2026-10-23 (one critical-speed
effort, no tested threshold pace), so the estimate falls back to the pace of the recent logged runs
and reads "at your recent pace". The fallback exists; a threshold pace entered on the Profile page
still gives the better figure, because the zones then hold a pace of the easy kind, where the
recent pace is a median that a hard run can still lift (the fastest quarter and the runs above the
easy heart-rate limit are left out, but a runner with no heart rate and fewer than four runs in
the four weeks has nothing to leave out). Quality sessions with no pace target (a threshold or
interval session in a plan made before any pace existed) are counted at the recent pace too, which
reads a little short. (b) The estimate replaces the plan's own unlabelled distance on the screens
above; the Done sheet still words the plan's `distanceM` ("Planned: 40 min, 6.2 mi") and pre-fills
the log with it. (c) The race and run-walk sessions have no estimate, so a race week or a ladder
week has none for the week.

Load progression (2026-10-25), decisions taken in the build session. Each is an engine or copy
choice taken inside the owner's answers of 2026-10-24, and the third awaits confirmation.

- Question 3, the values: kept as proposed, provisional and grade D (0.70 and 12% at Standard, 0.85
  and the ceiling's own rate, 14.0%, at Upper band). Reason: the own-tolerance record holds no
  weekly step between 0 and 14% and no pain or fatigue flags, so the replay neither confirms nor
  refutes 12% or 14.0%, and a change toward more load needs stronger evidence than a change toward
  less (G6). Taken in task L6 (spec 5.6).
- Question 7, the credit window: `g8.creditTaperEndWeeks` ships at 12, and the 16-week window with
  a taper to one half stays available by Param. Reason: the 16-week window changed 1 of 53
  replayed plans (by 1.5% at Standard and 6% at Upper band over 12 weeks). Taken in task L6.
- Awaiting the owner's confirmation, two engine changes of task L3d, taken on the findings of the
  replay (spec 5.6): (a) the rebuild zone reads the block the plan opened with, until a complete
  week has run at `R`, so that a runner who runs as planned gets the first plan's weeks; (b) the
  response to weeks run above plan has two bounds, written into ADR 0013 and spec section 7 as
  "Amended 2026-10-25". Reason for (b): in a back-test of 32 weekly re-plans the unbounded response
  lifted a baseline in 16 (2 of them after a dip that followed a held week) and one outlier week
  lifted a plan 3.1 times; the bounds remove the 2 and limit the outlier to 1.3. The owner's
  answer to question 5 was "in a bounded form"; the bounds are the build session's reading of it.
- The trade-off line is on the Generate form and in the Plan page's Load panel, and not in the Why
  drawer. Reason: the drawer states facts of the plan and not the choice; the trade-off belongs
  where the choice is made and where the position in effect is read. Taken in the L7 review
  (finding 9), and spec 4.6 and the L5 acceptance say so.

Open for the owner: whether the owner-derived replay figures go into spec 5.6. They are kept
outside the repository, and the spec holds the synthetic results only; the summary under "Where
things stand" gives counts and percentages without a weekly total or a date.

## Open follow-ups (none blocks a merge)

1. The weekly decision's "first days of heat" and "sleep efficiency drop" holds are not derived
   from data yet, so those two J5 signals never fire.
2. Contrived re-plans (sessions marked completed for weeks with no activity behind them) can
   ramp from a zero baseline and collapse to zero-minute weeks or a zero taper (19 of 2310 fuzzed
   re-plans); the app marks a session completed only through activity matching, so no real path
   produces this input. A repeated floor week after a clipped restart carries no flags and is
   placed as a plain week.
3. A true novice with a 5 km time goal 12 weeks away reads "not reachable within default limits"
   (the ladder alone takes 9 weeks and a 30-min run is under 5 km at a novice pace); the label is
   honest but conservative, and the plan still builds.
4. The 8 h race-simulation opt-in (H2) and the "no later than 3 weeks before race day" timing are
   design intent: no code reads `h2.raceSimulationMaxHours`.
5. A declared longest run (A3) has no profile field; a runner with no logs starts at rung 1 or, if
   experienced and unflagged, at 3 × 20. The n1 walk-jog stages for bone stress injuries are not
   implemented: a recent bone stress injury takes the same injury-return ladder.
6. Post-race: strength sessions stay at 0 through the window with no evidence either way; the
   first-finish modifier applies to a runner with no race history at all; the window trigger for a
   new plan uses the D1 class (so a 40 km race counts as a marathon) while G-1 uses the literal
   42,195 m.
7. A session the engine trims after a hold decision is stored without its untrimmed version.
8. Lower-ranked review findings not yet addressed: nested sheets share the Escape key; Apple
   Health push skips the range checks the parsed import applies; Goals reads "1:45" as minutes
   and seconds; a few engine tests assert conditionally.
9. Behind a reverse proxy, rate limits key on the proxy's address (no trust-proxy setting by
   design: the environment variables are fixed).
10. Spec non-goals still open: readiness and race-decision gates as stored decisions, strength
    programming; Polar, WHOOP, Oura and Google Health providers. The Fuel lab shipped in phase
    3a (the ladder, products, logs, the gut-training block and the EAH card; `18-fuel.spec.ts`).
11. Enable branch protection on `main` requiring the `ci` and `analyze` checks.
12. Prediction widening for planned windows: a rest window does not widen the race prediction
    range.
13. Moves across weeks: a move stays in its week (`adjust.ts`); moving a session to another week
    is not offered.
14. Merge-style undo: undoing a window or an adjustment restores rows by the undo payload and is
    refused once a neighbour changed (`edited-since`); a merge that keeps later edits is not built.
15. Open-ended windows: a window needs an end date (at most `j9.maxWindowDays`); "until further
    notice" is not offered.
16. Travel across time zones: a window and Today follow the server's day (`TodayView.tz`); a trip
    that crosses zones is a recorded limitation.
17. Done 2026-10-24 (`feat/distance-estimate`, entry under "Where things stand"). A distance
    estimate beside the minutes (the owner's direction, 2026-10-23: distance before strength): a
    derived "about N mi at your easy pace" on the session, the week and the brief, computed by the
    server from the zones, labelled an estimate and never scored; the plan's currency stays minutes
    (ADR 0003) and speeds stay per-session guides. The easy pace is the middle of the Z1 pace range
    of the current zones; with no pace in the zones the recent logged pace stands in ("about N mi
    at your recent pace"); see "Decisions for the owner". Merged as #560 on 2026-10-24.
18. Done 2026-10-31 in #598 (task C2; the closing paragraph is the last of this item). Strength
    programming as the first phase 3b epic (the owner's direction, 2026-10-23): an
    exercise library and session templates by phase from rules H10 and F4 (heavy lifting at 80%
    or more of one-rep max, 2-4 exercises of 3-4 sets of 3-6 reps, calf raises and plyometrics,
    eccentric-biased work in the block, one session a week to maintain), per-set weight, reps
    and reps-in-reserve logging, rule-based next-session suggestions, and the runner's equipment
    and lifting history captured in the app. Designed in
    `docs/superpowers/specs/2026-10-24-strength-phase3b-design.md` (PR #559, merged), and the owner
    answered its 16 questions on 2026-10-24 (section 18 there): equipment editable at any time,
    pounds by default, no importer in v1 with logging good enough to skip a dedicated lifting app,
    the barbell for anyone with a bar after the ramp-in, a plyometric ladder that steps only after a
    completed running week. The ADR is 0014. Next: its task list (section 17, E14-1 to E14-11 and
    C2), which moves to `docs/superpowers/plans/` when the epic is scheduled.
    Wave 0 done in #572 (2026-10-25): task E14-1 added rules F7 (session structure and exercise
    selection, grade A for the method and D for every dose), F8 (load progression, D) and F9
    (lighter days, the taper and the return after a gap, D) to `research/engine-rules.md`, with E5,
    F4, F-lib, H5 and H10 amended; 20 papers from a gap pass on the design's twelve evidence gaps
    (corpus 396, none closes a gap); the 34 Params of `f7`, `f8` and `f9` (`PARAMS_VERSION`
    2026-10-25.4, every value grade D except `f7.expectedBenefitPct`, A); and ADR 0014, Proposed.
    A five-lens review raised 46 findings: 19 applied as wording fixes, 27 refuted. Open for the
    owner: (1) whether to keep the A/B alternation of straight-knee and bent-knee calf raises,
    which `kinoshita-2023-standing-seated-calf-raise` does not back; (2) the two bodyweight
    movements entered at no added load in `f8.startFractionBodyweight` (the single-leg box squat
    and the single-leg calf raise); (3) spec 5.4 gives `f7.maintenanceSessionMin` to a lighter
    session while 8.1 and 8.5 give a lighter week 40 minutes, and the Params follow 8.1 and 8.5.
    Next: wave 1, tasks E14-2 (weights, the catalogue, the load quantity and the copy) and E14-3
    (the anchored block, the session budgets and the rule ids in the engine).
    Wave 1 done in #574 and #576 (2026-10-25): task E14-2 added the 25-exercise catalogue with its
    ladders and the substitutes that reach the harder movements, weights in integer grams shown by
    unit with the display grid, the `load` quantity, the strength templates and the benefit
    sentence with its qualifiers. Task E14-3 anchored the block in the engine: the block is the
    trailing run of flagged weeks (adjacent Mondays) of the stored plan, so a plan re-planned every
    week holds 12 block weeks in all and a regenerate starts a new block; the budgets are 40 minutes
    in a block week and 25 otherwise, `fplace.strengthSessionMin` is retired and `PARAMS_VERSION` is
    2026-10-25.5; the room of a lift on a day is the runner's availability, with the days a window
    or a post-race step limits still bound by every cap; a re-plan in mid-week counts the lifts the
    week already holds; and the purpose of a strength session is one sentence that names the week of
    the block or the maintenance and no dose. A four-lens review of the wave raised 15 findings: 8
    confirmed and fixed, 7 refuted. The owner validation (today 2026-10-23, counts only) gives 39
    weeks and 211 sessions, of which 44 are strength: the 12 block weeks hold 2 lifts of 40 minutes
    (1 in the current, partial week) and the 21 maintenance weeks 1 lift of 25 minutes; the
    oracle's 47 chain digests were regenerated for the block flag, the plans being otherwise as
    before. Left for E14-6: the H10 explain builder (it should name the block week and cite H10 for
    ultra goals only), and a block that is not continued across a post-race window
    (`macroPlanDraft` passes no stored plan to the plan built after one). Next: wave 2, task E14-4
    (the pure strength engine).
    Wave 2 done in #580 and #581 (2026-10-31): task E14-4 added the pure strength engine,
    `shared/engine/strength.ts`, derived on read (ADR 0014): the templates by phase; the block
    position, which reuses the planner's counter; the ramp-in by level, with the regenerate credit
    of four logged block weeks; lift selection from the equipment, with the pins and the barbell
    after the ramp-in; the one derived workout; load suggestions by rules F8.1 to F8.7, with the
    worked examples of the design as tests; the estimated maximum, labelled as an estimate and
    limited by the new Param `f8.e1rmMaxReps` (10, grade D); the F9 reads; and the history summary.
    Rule F8 was amended so that the smallest step the equipment makes is always usable (a light
    start on a lift with no harder movement could otherwise never progress), and the 90% ceiling
    reads the latest estimate available; `PARAMS_VERSION` is 2026-10-25.6. A four-lens review raised
    9 confirmed defects, all fixed, among them a recovery week inside the ramp-in that let the
    barbell in. Task E14-5 added the migration `strength`: `User.weightUnit`, backfilled by distance
    unit (kg for km, lb otherwise), and the state models `StrengthSettings`, `StrengthLift`,
    `StrengthLog` and `StrengthSet`; `PUT /api/settings` takes `weightUnit`; and the strength
    settings, lifts and logs routes store a log by an idempotent replace on the log id.
    `createManualActivity` was extracted from the activity route. Its review found that strength
    activities were never considered for duplicates, so a session logged in the app and imported
    later would have shown twice; they now pair by start instant or by same-day duration, the log is
    handed to a strength original on confirm, and a type change away from strength is refused while
    a log exists. Validation (counts only): the plan on a real history is unchanged, because the
    workout is derived on read. Left for E14-6: the duplicated payload and engine types to map in
    `loadStrengthContext`; logs on duplicate activities counted once; `next` after a save (empty
    until the engine fills it); the H10 explain builder. Next: wave 3, task E14-6 (the server read
    side), then E14-7 to E14-9 (the web).
    Wave 3 done in #584 and #586 (2026-10-31): task E14-6 added the server read side. The
    `strength.state` memo (`memoByVersion`) holds the settings, the anchors and the last 26 weeks of
    logs in one round of four reads, and four answers read it: `GET /api/strength` (the page view),
    `GET /api/strength/workouts` (at most 62 days), `GET /api/strength/exercises/:id` and
    `coach.slots.strength` on Today (the derived workout of the day's strength session, null on an
    illness rest day or without a plan). `GET /api/explain` takes the subject `strength`, with the
    F7 to F9 builders moved from the policy-only rules to the input builders, and the save of a log
    (`PUT /api/strength/logs/:logId`) returns `next`, the load the next planned session asks for. A
    copy's log (a possible or confirmed duplicate) is skipped only when its original has a log, so a
    session is counted once and never disappears (a deviation from the task brief, which skipped
    every confirmed copy). A three-lens review confirmed 4 defects, all fixed: the F8 and F9 explain
    facts re-read the history without the engine's implement filter and window, so after a change of
    equipment the drawer could name a load the engine never judged (`WorkoutLift.evidence` now
    carries the engine's own judged session, latest session and estimate, and the facts read those);
    "1 days"; the unit of a timed or bodyweight lift in the last-session fact; and the `next`
    harder-movement case, which had no test. Task E14-7 added the web foundations: the hooks in
    `web/api/strength.ts`, which refresh the strength readers, Today and the activity readers after
    a write, and the lazy `StrengthSheet`, the sheet of spec 9.1, pre-filled from the workout, with
    44 px steppers (the load by the equipment step, the reps by one), "As suggested", "Same as last
    time", the reps-left scale with "All sets", add and remove a set, the bodyweight path with no
    load field, "Swap" with "Always use this", "Save without sets" and "Use the usual load" on a
    lighter day. A session logged as suggested takes 3 interactions, and two changed sets with one
    All-sets value per lift take 8, against the bar of 12 (both asserted). The draft is kept under
    `strength-draft:<logId>` and purged with the device data, the `strength log` outbox entry
    replays once with the same log id, and ADR 0012 gains one line. Swap is a stand-in: no read
    gives the sheet the server's `liftFor` result, so a swapped lift is built on the client as the
    first session of its exercise (`structuresFor(...).first`) at the lightest load the equipment
    makes, with no Why drawer; the server read of a lift in a session's place is given to E14-10
    (spec section 17) and replaces it, and "Add a lift" waits for the same read. A three-lens review
    confirmed 7 defects, all fixed: "Same as last time" copied another implement's loads (it now
    keys the last session by exercise and implement, and copies no load into a lift without a load
    field); the sheet showed no line for what a load means (spec 5.2), and now shows one muted line
    per lift; a swapped lift took the structure of the lift it replaced, and now takes the
    first-session structure above; a strength log refused at replay was dropped with a notice that
    no surface showed, and `useStrengthLogNotices` now lists and dismisses it for the wave-4
    surfaces to render; a sheet reopened after a queued save started a new log id, and now reuses
    the queued entry's id, so the second save replaces the first; the draft kept a load with no
    unit, and now stores its unit and rebuilds each load from the same grams; `keys.strength` was in
    neither invalidation list, and is now in both. Gates: `npm run check` (256 files and 13475 tests
    after E14-6; 261 files and 14095 tests after E14-7), `npm run build` (entry 358.79 kB, the sheet
    its own 35.80 kB chunk), `npm run test:e2e` (80). Validation on a real history is byte-identical
    (counts only): E14-6 added only the workout's `evidence` field and read paths, E14-7 changed no
    engine, server or schema file, and neither added a migration. Left for wave 4: the Why drawer
    renders loads in the default unit (`InputFacts.tsx` needs the runner's weight unit), and the
    hero rows pick the "leave n or more" templates for easy sessions. Next: wave 4, tasks E14-8
    (Today and the session sheet) and E14-9 (the Strength page, the setup, Settings and More), both
    in review.
    Wave 4 done in #588 and #589 (2026-10-31): task E14-8 added the strength surfaces on Today and
    in the session sheet. The strength-only hero lists the lifts, the jumps and the trunk movements,
    at most five rows from one builder (`workoutRows`), with loads in the runner's unit and "Log
    sets" in place of Done. The lighter-day line and the "Use the usual load" switch sit under the
    action row, and the purpose sentence is dropped: with it "Log sets" ended at 751 px at 360 x 740
    (limit 740 px), and without it the button ends at 699 px at 390 x 844 and at 360 x 740 for the
    day as the server derives it, and at 699 px and 721 px on the tallest day (five long rows plus
    the lighter-day block), against limits of 788 px and 740 px, all measured in the e2e. The "Also
    today" item on a run day is a button ("Strength, 40 minutes: open the workout", a 44 px target)
    gated like "Log sets"; the session sheet has a Strength section; the Profile hint sits under the
    strength choice; offline, the hero and the sheet open from the kept Today payload
    (`coach.slots.strength`) and a save queues in the outbox; and a strength log refused at replay
    shows its notice in the check-in row's list. `DashboardPage.tsx` and `SLOT_BUDGETS_PX` are
    unchanged. A three-lens review confirmed 9 defects, all fixed: the "Also today" item was not
    gated like "Log sets", so it could log a completed session a second time; the usual-load switch
    was offered for a lift whose load was not lowered (`usualLoadOf` is now the one test); the
    item's hit area overlapped the action buttons by 3 px; "Log sets" stayed on offer after a save
    and the week strip held a stale session; two stacked sheets fought over Tab and Escape (`Sheet`
    is now stack-aware: only the topmost answers and the ones under it are `inert`); the unavailable
    message showed while the workouts read was in flight; the logging sheet took the live workout
    instead of the one it was opened with (ADR 0014); the kept-copy branch, an empty workouts answer
    and a run-plus-strength day had no tests; and focus after a save from the item went to the title
    instead of the item. Task E14-9 added `/strength` (a static import, laid out in phone order and
    in two columns from 900 px, reached from More and not in the tab bar): the Workout card (the
    rows, "Log sets", and "Add a past session" as a date step checked against
    `STRENGTH_BACKDATE_DAYS`), the Block card, the Lifts and History cards (a labelled table per
    exercise and a lazy `EstimatedMaxChart`), and Edit and Delete of recent sessions through a `log`
    edit path on `StrengthSheet` (the sheet opens on the saved log and saves under its id). The five
    setup sheets of spec 6.2 (equipment, level, currently lifting, avoids, pins) and the anchors
    each save their own body, with the estimated maximum shown as an estimate; the weight unit is
    saved through `PUT /api/settings` from Settings and from the page (pounds by default); and the
    page's states are templates in `shared/copy/strengthPage.ts`, registered in `templates.ts` and
    rendered by the G5 lint. A three-lens review confirmed 8 defects, all fixed: a unit change
    re-read neither the strength view nor Today; the logging sheet had no setup offer (spec 6.1) and
    the Today card for the first strength session within 7 days had no owner, so it is now an "Also"
    line under E14-10 in section 17 of the spec; the anchor weight field did not say what its load
    means (it now uses the sheet's `loadMeaningLine`); the weights list field asked for commas on a
    decimal keypad; "Always use this" could pin an avoided exercise (`withoutAvoided` is now behind
    both `pinChoices` and `swapChoices`); the anchor picker offered the timed carry (it offers
    rep-counted exercises only); an edit could not clear its effort, pain or note (it now sends
    explicit nulls, which the server schema already accepted); and focus was lost after the
    past-session flow. `StrengthLogNotices` moved out of the check-in row, which now shares it with
    the page. Gates: `npm run check` (262 files and 14215 tests after E14-8; 264 files and 14930
    tests after E14-9), `npm run build` (entry chunk 375.97 kB after E14-8 and 368.03 kB after
    E14-9, against the 500 kB budget; the setup sheets, the logging sheet and the chart stay lazy),
    `npm run test:e2e` (85 after each). No engine, server or schema change in either task (only copy
    templates under `shared/copy/` changed), no migration, and no owner validation was needed. The
    E14-9 screenshots were not retaken after the review's fixes. Left for E14-10: the day-workout
    read for a log with no planned session (`view.next` and `GET /api/strength/workouts` list
    planned sessions only, so with none planned the Workout card has no log button), the Swap read,
    the Today setup card, the count prompt's slot (under the Block card), and "Edit sets" and "Add
    the sets" on the activity page (both open `StrengthSheet`, with `log` or with `activityId`).
    Left for E14-11: the e2e flows of spec section 13 for the page, and the move of
    `strengthOnlyToday()` and `serveTallestStrengthDay()` from `12-today.spec.ts` to
    `tests/e2e/helpers.ts`. The Lifts list also shows jumps and trunk movements (the server lists
    any exercise with a logged set), each with "No added load". Next: wave 5, task E14-10 in two
    halves (E14-10a: the day-workout read with Swap, the Today setup card, the activity page;
    E14-10b: the Review lines, the count prompt, the notes, the list), then E14-11 and C2.
    E14-11 done in #595 (2026-10-31): task E14-11 added the strength e2e. `20-strength.spec.ts`
    (13 cases) covers the flows of spec section 13 that `12-today.spec.ts` leaves out: the setup
    saved with a barbell and dumbbells from the "Set up strength" card; a change of equipment and of
    the weight unit, followed by the next workout, Today and the sheet; a session logged as
    suggested in 3 interactions and one with two changed sets and a reps-left value on each of
    three lifts in 12, both counted from the click and key events the browser itself makes (the
    bar of spec 1.4 is met exactly); a load that rises one step after a session at the top of the
    range with reps left, and one that comes down after a set short of it, with the reason in the
    Why drawer; the bodyweight path; "Log a session" and "Add a past session" with nothing planned;
    Swap and Add a lift through the server read; "Add the sets" and "Edit sets" on the activity
    page; the Today offer to set up strength; and the count prompt after "Not now" (quiet at 27
    days, back at 28) and after "Plan 1 a week". `06-narrow-viewport.spec.ts` holds the Strength
    page, the equipment sheet and the logging sheet at 360 px (no horizontal scroll, every control
    at least 44 px, a set in two lines, Save in view), and `17-offline.spec.ts` a strength log
    saved with no connection and sent once when it returns. `strengthOnlyToday()` and
    `serveTallestStrengthDay()` moved to `tests/e2e/helpers.ts`, with the seeding the cases need.
    Two seeds are worth knowing: a lift that starts on the lightest rung of a 5 lb dumbbell ladder
    holds there, because one step passes 90% of the estimated maximum (rule F8, as designed), so
    the case for a rising load gives the lifts starting points; and a plan generated today has a
    recovery week as its second week, which keeps the load, so that case takes the recovery weeks
    out first. Nothing under `web/`, `server/`, `shared/` or `prisma/` changed, and every flow was
    driven by role and label. The stable surface for the later epics: `StrengthView`
    (`GET /api/strength`) and the derived `StrengthWorkout` (`workoutFor` in
    `shared/engine/strength.ts`; also Today's `coach.slots.strength`, `GET /api/strength/workouts`
    and `GET /api/strength/workout`), which an ultra-readiness epic can read, are derived on read
    from the stored plan and the logs and written nowhere; the routes of `server/routes/strength.ts`
    (settings, lifts, logs, exercises; the weight unit is `PUT /api/settings`) write the setup and
    the logs; and `strength.state`, one memo per data version and day, is what the reads share and
    what every write of a strength model drops. This closes the test line of follow-up 18. Gates:
    `npm run check` (267 files and 15266 tests), `npm run build` (entry chunk 376.17 kB),
    `npm run test:e2e` (100, twice in a row). Next: task C2.
    C2 done in #598 (2026-10-31): the epic is closed. What shipped, by wave: wave 0 (#572) the
    research base, rules F7 to F9 with their Params and ADR 0014; wave 1 (#574, #576) the
    25-exercise catalogue with weights in grams and the copy, and the block anchored in the engine
    with budgets of 40 and 25 minutes; wave 2 (#580, #581) the pure strength engine and the
    `strength` migration with its routes; wave 3 (#584, #586) the server read side (the
    `strength.state` memo, the explain subject, Today's `coach.slots.strength`) and the web
    foundations with the logging sheet; wave 4 (#588, #589) the strength hero and the session sheet
    on Today, and the Strength page with the setup, Settings and More; wave 5 (#592, #593, #594,
    #595) the Review lines and the count prompt, the day-workout read with Swap and Add a lift, the
    Today setup card and the sets on the activity page, the sets count in the list and the note for
    a day with no heavy lifting, and the e2e, narrow-viewport and offline cases. ADR 0014 is
    Accepted and the design reads Implemented. Contract-drift review (repository searches, read-only
    first): no second weight formatter or arithmetic on grams in `web/` beside
    `shared/domain/weight.ts`, no second estimated-maximum formula beside `estimateOneRm`, no second
    block counter beside `strengthBlockPosition` (the planner's `pastStrengthBlock` counts the run
    before a re-plan, not a position, and both are in `macro.ts`), no second exercise list beside
    `shared/domain/strengthLibrary.ts`, no second budget rule beside `strengthMinutes`, no second
    derivation of the workout beside `workoutFor` and `liftFor`, and no second purge beside
    `purgeDeviceData` and `purgeDrafts`. The one leftover was the Why drawer's loads, which read in
    the default unit (recorded under wave 3): the drawer now takes the weight unit from
    `useStrengthUnits()` and passes it through `InputFacts`, with a test in kilograms, in pounds and
    on a settings payload without the unit. CLAUDE.md names the six conventions of the epic (the one
    derivation of the workout, grams and the one formatter, the closed catalogue, the one save of a
    log with the drafts purged together, the `strength.state` memo, the stack-aware `Sheet`). Final
    gates, on `main` at `2c7aabcc` with this task's commits: `npm run check` (269 test files, 15428
    tests; `research:check ok: 396 papers, 398 cited ids all resolve`), `npm run build` (entry chunk
    376.68 kB), `npm run test:e2e` (100 passed), `npx prettier --check .` and `docker build .` (also
    with `--no-cache`, so the `prisma migrate deploy` smoke step ran), all clean. Final owner
    validation (run by the coordinator outside the repository, where the baselines are kept): the
    steady plan on the real history at the epic's close is byte-identical to the load-progression
    baseline taken after wave 1 (`owner-plan-c3`). Against the epic's start (`owner-plan-c2`, before
    any strength change) the only differences are the ones task E14-3 made: the strength sessions of
    block weeks are 40 minutes with rule F7 instead of 30 without it, one strength session was added
    in the first block week (the anchored block starts at once), and the block weeks' strength days
    moved one day earlier under F4's placement (never the day before the long run). Weekly run
    minutes, long runs and every run session are unchanged. Manual checks still open: a real session
    logged on a phone in a gym, with and without a connection (the e2e drives a browser with the
    connection cut, not a phone); and the wrist path, which strength does not touch (no commit of
    the epic changes the publish, workouts, workoutFit, wristItems or calendar service,
    `shared/workouts/` or the intervals.icu and Garmin providers), stays on the phase 3a list: the
    FIT files on the owner's watch and one live intervals.icu run. Owner questions still open: the
    sixteen questions of section 18 of the spec are answered, and its six readings of the answers
    stand as the smallest reading of the owner's words until overruled: reading 1, "switchable"
    equipment means editable at any time (no named home and gym sets); reading 2, the weight unit is
    per runner and the Profile's body weight stays in kilograms (a unit-aware Profile is a small
    follow-up the owner may want); reading 3, the history view of the estimated maximum is the
    Strength page; reading 4, a completed running week is 80% of the planned run minutes; reading 5,
    "after the ramp-in" excludes the return weeks; reading 6, the bar is judged on the lower-body
    programme. Three questions from wave 0 have no answer recorded: the A/B alternation of
    straight-knee and bent-knee calf raises, the two bodyweight movements entered at no added load,
    and the 40 minutes of a lighter week against the 25 of spec 5.4. Questions 1 to 3 (equipment,
    lifting level, weight unit) are entered in the app by the owner; this file records no such
    entry. The owner judges the bar of spec section 1.4 (pre-filled sets, sub-minute logging, a
    per-lift history with the estimated maximum, suggestions with reasons) after a month of use; the
    e2e asserts the interaction counts (3 as suggested, 12 with two changed sets and a reps-left
    value per lift), which is not the judgement. If the bar is not met, the first additions are a
    rest timer and a plate calculator, in a later task that the design does not plan.
19. Done in #567: the Today disruption presentation, from the owner's feedback of 2026-10-24 on
    Today with an illness window. (a) The band owns the window and the verdict names the day: while
    the illness windows hold the n-3 gate, the payload leaves out the illness note and the illness
    signal, and "Ready as planned." becomes "A rest day of the window.", "A day of limited
    running.", "Easy running only today." or "A day of the return week."
    (`shared/domain/windowDay.ts`, `today.verdict.window-*` in `shared/copy/today.ts`). (b) The
    "Why" of a health note and of the heat note is an inline info icon (a circle "i", a 44 px
    touch target) at the right end of the note's line, with the accessible name and the drawer the
    button had (`icon` on `ExplainButton`). (c) The band lists every open window on its own line
    with its own buttons (`slots.disruption.windows` replaces `window`), and the buttons are 44 px
    boxes pulled into the line height and the gap, so a line stays 64 px at 360 px and the fold
    tests keep their limits; this decides the compact banner's button size, which was 26 px. (d)
    The check-in link reads "Add a pain or illness window" while a window is open and opens the Not
    100% sheet, and keeps "Something hurts, or I'm ill" and the check-in sheet otherwise. Not
    built: the band has no "see it" action, because the Plan page has no view of a single window.
    Not changed: a Today payload cached before the deploy shows no band until it refreshes (at
    most 36 h, ADR 0012). Reviewed at 360 px: a day inside an illness window, an illness and an
    injury window open together, the gate day, an illness check-in with no window, and a day with
    no window. The owner's other remark, that Done was not visible in the screenshot, was a rest
    day: no change.
20. Done in #561: the countdown reads "{name} is {n} weeks away." (`brief.countdown-weeks` in
    `shared/copy/briefTemplates.ts`), because "Weeks until {name}: {n}." reads oddly when a goal
    name ends in punctuation. The owner named the weeks form; the days form
    (`brief.countdown-days`) took the same shape, "{name} is {n} days away.". No other countdown
    template exists in `shared/copy` (searched on 2026-10-25), so the hero and the plan header need
    no further edit.
21. Done in #561: the approved G5 sentence is in rule G5 of `research/engine-rules.md`, as quoted
    under "Decisions for the owner" (d).
22. Done 2026-10-25 (the integration branch, PR #565; entry under "Where things stand"). Load
    progression from the runner's history (the owner's report of 2026-10-24), proposed in
    `docs/superpowers/specs/2026-10-24-load-progression-proposal.md` (PR #558) and answered on
    2026-10-24 (section 7 there). Shipped: the history block and the 3 × 30 start from it (L2), the
    rebuild zone (L3), the response to weeks run above plan (L3b), a raised week target that
    survives a re-plan (L3c), the plan's own block and the response's two bounds (L3d), the load
    setting on the Generate form and the Plan page (L4), the copy and the Why drawer's g-8 facts
    (L5), the fixtures, the sweep and the replay on real history (L6), and the close review (L7),
    with rule g-8, nine grade D Params and ADR 0013. Still open: the confirmation of L3d's two
    changes and the figures question under "Decisions for the owner", and follow-ups 23 to 26. The
    plan action that changes the position once the plan exists (L4b, decision 6 of the proposal)
    shipped in #575: `PUT /api/plan/load` records one revision with an undo and no preview. Not
    proposed, by decision 10: a G-1 history reference.
23. The kept-target warning of spec 4.8. A raised week target kept at a re-plan above the soft step
    carries no `progression` warning: the checklist is built from the engine draft, which never
    holds the runner's raised figure. Case: a loading week whose target the runner raised above the
    soft step and a re-plan keeps; the revision diff and the Plan page show the kept figure, and
    the checklist does not name the week. Spec 4.8 now describes the shipped behaviour; the warning
    would need the checklist to read the kept figure.
24. G-1 can hold every run of a week at one cap, so the long run does not take the remainder of the
    week's minutes. Case: seen on a real history (no committed case); with a short reference run
    the weekly target is not placed, and a plan with the larger weekly target can have a slightly
    shorter long run than Steady's in the same week. Baseline behaviour at Steady too.
25. The A5 low-frequency flag arms when the start level passes 60 minutes with fewer than two runs
    a week. Case: "H3 inside a chain" of the replay fixtures; on the replayed real history it held
    the position at Steady on 30 of the 53 Mondays, which matters more to the setting's reach than
    the values of question 3. Baseline behaviour at Steady too. Option 4 of the proposal shipped in
    #579 (decided 2026-10-25): the flag keeps the 2:1 cadence and the time-based step and no longer
    holds the load setting. The rest of the proposal stays open.
26. After a hold decision a re-plan can place sessions under 80% of target. Case: one replayed
    chain, 25 of 57 future weeks after one re-plan following a hold decision. Baseline behaviour at
    Steady too. Open. The trace of follow-up 27 showed it is a different mechanism from the
    recovery-week cadence. On the replayed real history, with a hold cap on the current week at 25
    Mondays, 2 or fewer future weeks were under 80% except on four Mondays. On two of them 34 of
    about 40 weeks were under with no decision at all (a return from a layoff). On the other two
    the re-plan without a decision opens on a restart floor week (1 or 2 weeks under), and the cap
    cuts that week below the floor (29 and 33 weeks under); the weeks after it sit between one and
    two 20-minute runs or under a G-1 cap. The hold cap on a floor week is the candidate; the
    cause is not yet traced to a line.
27. Done in #570. A change of recovery cycle between two re-plans (the A5 low-frequency flag
    arming or ending, 2:1 and 3:1) dropped the recovery week the replaced plan stored on the first
    Monday: the count of `planPhases` missed it, the week became a loading week drawn a step above
    the loading sequence with the recovery week's sessions (G-6), `keepCadenceAcrossReplan` forced
    a second recovery week after it, and the next loading week stepped from the minutes placed
    there. Case: `replan-chain.test.ts`, "the re-plan on which the low-frequency flag changes the
    recovery cycle" (H10 at Steady on the re-plan where the flag ends, 82, 61r, 61, 45r; H3 at
    Standard where it arms) and "a stored recovery week on the Monday a start path claims". Shipped:
    the stored recovery week is kept, the count's own recovery week that would follow it is
    dropped, and a start path (a 3 × N floor after a gap, a ladder) claims the opening week first
    (`planWeeks`, `macro.ts`); H10 now plans 56r, 82, 90, 67r and the H3 chain equals the
    unflagged chain. No rule text and no Param changed. 0 of 142 steady oracle digests moved, the
    owner validation at 2026-10-23 is byte-identical, and 0 of 25 replayed re-plans of the real
    history changed. Not changed: a stored recovery week that the count already places keeps
    winning over a floor start (`lifts`).
28. Sources, methods and evaluation (2026-10-31). Done in #585 to #616, and on 2026-11-01 in #618
    to #621 (the paragraphs headed "After the build closed"); the last paragraphs list what is open
    and who owns it. The owner's three requests of 2026-10-31 were which sources beyond
    the corpus should inform plans and how they are vetted, how plans could follow different
    methods, and which tools would test and evaluate plans. The proposal
    (`docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md`, #585) was written
    by a research-and-design workflow with two critics (evidence honesty, repository fit) and a
    revision on their findings. Its findings: the corpus held no book and enforced no source policy;
    no method had been tested as a package; the suites proved conformance and not quality; the
    checklist could not see a loosened guard; and, outside the request, the Generate form sent
    `recoveryCycle: '3:1'` unasked, which switched off the 2:1 rhythm of rules E3 and A5. That fifth
    finding was fixed first, in #587 (task M0): the form sends the field only when the runner picks
    one, a stored `'3:1'` stays a choice until the plan is regenerated, and 26 oracle digests were
    regenerated for the checklist's "every 3rd week" wording with the plans unchanged. The owner's
    13 answers and the answer to the question of fact (every book of section 3.2 is treated as held;
    the owner reads the pages a record needs) are recorded in #599, one "Answered 2026-10-31" line
    each in section 7. Four answers departed from the default, each with the reason recorded there:
    all 19 practice records are re-vetted now and not marked for later (one standard across the
    corpus); the change action for a plan's shape ships with the presets (M6; consistency with the
    load setting's in-place change); the early plateau gets a research pass and not a report alone
    (the plateau is the shape the runner sees, and a report without a reason explains nothing); and
    Qin 2025 is read in full for admission (no reason recorded). The logging sheet keeps reps left,
    with a research pass on the RIR Params, as the owner also decided that day. The other answers
    took the default: book fields on `book-or-guideline` records and a `training-methods` topic, the
    Daniels citation relabelled, the caps of section 3.1, a typed preset overlay of at most four
    presets (P1, P4, and P2 for 5 km to half-marathon goals; P3 out), a report-only harness, three
    simulator levels and descriptive outcome learning.

    Corpus lane. S1 (#596): `research:verify` reports the Crossref notices that a record does not
    mention (`crossrefNotices` and `correctionNotices` in `scripts/research-verify.ts`, pure
    functions over a stored message, 28 tests with no network; the exit code is unchanged); the run
    by hand listed 4 notices, 2 of them unmentioned. S0 (#600): the Daniels citation reads "as
    reported by Running Magazine" in its record, the note of `macroDesign.longRunShareOfWeek`, the
    `volume-long-run-share` rule and the topic file (0.35 stays, held by three grade D sources; the
    article was read and the book was not), and the Tyler 2016 and Mountjoy 2023 corrections are
    noted in their records with the contents unread; no value, grade or rule id changed. S2 (#602,
    ADR 0015, Accepted 2026-10-31): the rubric R1 to R6 and the class caps in `research/README.md`;
    "Add a source outside the journals" in the `research-update` skill; the optional `edition`,
    `isbn`, `pagesRead` and `interests` fields on `book-or-guideline` records and `vetting` on any
    record in the paper schema; a rule that a book record fails `research:check` unless R1 and R2
    pass (the 19 existing records exempt by name in `PREDATES_RUBRIC`); a `params.test.ts` case that
    a Param citing only practice sources is grade D (33 cite one, all D); the link on `PaperCard`;
    and `docs/research/watch-list.md`. S4 (#606): the 19 practice records re-vetted against R1 to R6
    in two independent passes (S4 and S4b). Fifteen pass and leave `PREDATES_RUBRIC`. Four stay on
    it, each with a passing co-source on every Param it backs:
    `runningmagazine-2023-daniels-long-run-limit` fails R1 (the rule is located only in the
    magazine's report, with no book, edition or page; S3 reads the book page);
    `higdon-2024-advanced-5k` holds R1 (the live page drops a plain client and the one Wayback
    lookup resolved to a captcha; the second pass read the page and it matches the record, but one
    pass is not two); `clark-2026-couch-to-5k-original` holds R1 and R2 (located only in a
    University of Arizona copy, and the author's only independent record is Wikipedia);
    `bjsm-2019-bone-stress-return-to-run` holds R2 (an unsigned table from a physiotherapist's blog
    post, the original table sitting behind a bot check). S4b tightened five gates to hold (R5 on
    the CTS and Skurka records, where 100-mile plans are applied after a marathon or 50K, and on the
    Sanford and BJSM records, where tendon, post-surgical and bone-stress tables are applied to any
    recent-injury flag; R4 on Sanford) and reported three value questions that nothing applies:
    `injuryReturn.restDaysBetween` (RU3 below), Sanford's "at 180 bpm" against the page's 60 bpm for
    heel raises, and the Western States record's title. M1 (#607) is the research update for the
    methods layer: 9 records (7 journal papers at their design level, 2 programme pages at the
    practice cap), the topic `research/topics/training-methods.md`, and rules P1 to P4 in section
    (p) of `research/engine-rules.md`; its second pass (M1b) agreed on 53 of 54 gate results and
    tightened Zinner's R3. Qin 2025 was read in full twice and not admitted, although decision 13
    admits it when R1 to R6 pass: R1 to R3 pass and R4 and R5 hold, because the text and the tables
    do not reconcile (the training is described only in the Introduction, no registration or flow
    diagram was found, the between-group p-values of Table 6 cannot be reproduced from the printed
    means and SDs, d recomputes to 0.86 against the reported 0.81, the correlation "experience
    predicts the better method" has the opposite sign in Table 7, and the machine-learning accuracy
    is for predicting marathon time and zone, not for choosing a method). The verdict is in the
    topic file, and a watch-list row names what would move the paper in: a registration or protocol,
    the data, a correction or a replication. The corpus holds 406 papers at the end of the build
    (396 at its start: Treff 2019 in #605 and 9 in #607), and `research:check` resolves all 408
    cited ids.

    Harness lane (report-only; ADR 0016, Accepted 2026-10-31). H0 (#597): `describePlan` in
    `tests/unit/engine/plan-metrics.ts`, the figures of section 5.1 each with its grade and rule
    ids, pure and importing no limit code. H1 and H3 (#601): `npm run plan:report`
    (`tests/reports/plan-report.ts`; the twelve matrix athletes and both sweeps, deterministic, with
    no overall score and no acute:chronic ratio); the reference bands from Knopp 2024's marathon
    figures (read from the Europe PMC full text) and from the corpus's 5 and 10 km programme
    records, printed as a signed distance and never as a verdict; a scorecard per matrix plan;
    `harness-isolation.test.ts` (nothing under `tests/` may be imported from `shared/`, `server/`,
    `web/` or `scripts/`); and the `plan-review` skill (five lenses, two refuters per finding,
    output headed "Unvalidated: this review vouches for nothing", never a plan edit). H2 (#604): the
    seeded scenario simulator `tests/unit/engine/sim-athlete.ts` (the levels compliant, ragged and
    overshooting; a chain driver on the server's weekly path; a scorer; metamorphic relations). Its
    24 chains run in 2.6 s (ragged), 3.0 s (compliant) and 6.0 s (overshooting), so the two
    invariants stay in `npm run check`, as decision 11 allowed under a minute (29 s with their
    chains). It found engine defects, pinned as `test.fails`: the re-plan was not a fixed point
    after a hold (35 of 96 ragged steps after a hold and 14 of 19 compliant `reds-hold` steps came
    back changed, a ratchet) nor in the race week (8 of 11 compliant chains), and a closed day could
    raise a week. It also observed, without asserting, that a zero-minute week gave a 0-minute cap
    on the next, that `reds-hold` failed its own checklist item, and that closing a weekday raised
    minutes in some weeks. H4 (#603): `baselineSkill` and `intervalScore` in
    `tests/unit/engine/prediction-skill.ts` (the Riegel exponent 1.06 fixed in the file so the
    yardstick does not move with the engine; 23 hand-computed tests). The back-test replay, outside
    the repository in the git-ignored `data/` and counts only, replayed nothing on the real history:
    the plan starts after the history ends, so its figures wait for the next import, and the two
    skill figures need exported `PredictionLog` rows and at least three scored races. H5 (#605): ADR
    0016 and the G-5 sentence in `research/engine-rules.md`, "A descriptive figure in a report is
    not a band (ADR 0016)": a figure printed to describe a plan gates, caps and justifies nothing,
    so it is not the ratio band the rule forbids, and the plan report prints no acute-to-chronic
    ratio and sets no target. H5 also added Treff 2019 to the corpus
    (`treff-2019-polarization-index`, level D, cited by no rule) and recorded two readings that
    change nothing yet: Eq. 2 also subtracts 0.01 from zone 3 when zone 2 is empty (one of 72 report
    rows differs from H0's code), and the paper calls the index invalid when zone 3 exceeds zone 1
    while H0 returns null and a value with its order.

    Engine fix RF1 (#608), from the defects H2 pinned: the weekly re-plan is a fixed point after a
    hold, a progress decision and a reduce (storing a step's plan and re-planning with nothing new
    changes nothing). Causes and fixes: a hold carries the loading sequence on from its cap; the
    hold's trim cites J5 beside the trim rule (`isHoldTrim`), is not kept by `keptByReplan` and is
    drawn again with its week; a week the replaced plan has not started is held to its stored figure
    on its Monday (`unstartedWeek`), because the race week plans a run on the race day that the race
    replaces and shed a share at each pass; a windowed week is bounded by the lesser of the figure
    and the placed minutes; the cap after a zero-minute week is never under the J7 share of the
    planned week and, where the plan holds that much, never under 60 minutes (E6's 3 × 20); and the
    checklist's REDs and bone-pain hold items read the runner's own level (after a layoff, the J7
    restart level), so `reds-hold` passes at every step at all three simulator levels (it failed at
    10 of 20 compliant and 11 of 20 overshooting steps before). No Param was added and
    `PARAMS_VERSION` did not change; rules J5, G-6 and n-4 gained text for the readings, recorded as
    Preferences. Two of the 142 oracle digests moved, both the last plan of a chain, for the
    race-week reason: `chain half 18` (race week 27 minutes where it was 21) and
    `chain first-100-mile 28` (48 minutes four times where it was 38 to 39). Over five seeds of 237
    steps, ragged fixed-point drifts fell from 202 to 14 and compliant drifts from 111 to 0. A
    runner sees one change: on the first re-plan after a hold the weeks ahead are drawn from the cap
    and sit lower when the cap is far under the replaced plan (17 of 96 sampled hold steps differ,
    median weekly change -6 minutes), and no later re-plan of that Monday takes more minutes. What
    stays pinned as `test.fails` or open, for RF2: the drifts at the first week of a start path and
    at a held week that a window touches; the closed-day relation for emptied weeks, start-path
    plans and tiny weeks a window places above target (an emptied week is a rule question: a one-day
    window that empties the week leaves the ramp no baseline, and no baseline serves both the open
    and the closed plan short of planning the weeks after it at about nothing, J9 and J7 against
    relation 5.3); and the race-day run slot, whose removal by a closed weekday raised minutes in 78
    of 1,388 compliant checks, the proper fix placing the race week's runs only before the race day
    and moving every digest.

    Methods layer. M2 (#610, ADR 0017): `method` is a typed overlay of four values, `PresetId` being
    `default`, `three-run-days` (P2: `p2.runDays` 3) and `longer-base` (P4: `p4.buildWeeks` 4,
    strides only in the base, then threshold and hills), both grade D
    (`shared/engine/params/p-methods.ts`). `shared/engine/methods.ts` resolves the requested preset
    to the effective one with a reason (`not-applicable`,
    `held:<recent-injury|bone-stress|bsi-factors|reds-hold|bone-pain>`, `novice`, `no-base`), nine
    reads in five files go through `effective` (a scan test enforces it), and `persistentHoldOf` in
    `shared/engine/holds.ts` is the one list of persistent holds. `POST /api/plan/generate` takes
    `options.method`, kept in `Plan.options` with no migration; the 142 oracle digests hold and 74
    new `method: 'default'` cases pass. The review added the G6 clamp: a preset never plans more
    than the default plan of the same input (`generate` plans the default beside a preset that
    applies and holds each week to the default's target and placed minutes; before it, `longer-base`
    raised week targets in 36 of 150 sweep first plans, by up to 16 minutes, and the peak in 11, by
    up to 5.3%). M4 (#611): the plan shape on the Generate form, a Plan shape panel and the Why
    drawer (builders for P1 to P4; copy in `shared/copy/method.ts`; "A choice, not a better plan
    (grade D)."; three run days disabled for a goal over the half-marathon; the fit note counted
    through one open-day helper), with `tests/e2e/21-plan-shape.spec.ts`. M5 (#612): the matrix at
    every preset (`matrix-methods.test.ts`, 499 tests), four chains per athlete per preset with a
    rest window or a niggle (`preset-chains.test.ts`, about 90 s), fidelity from finished sessions
    (`preset-fidelity.test.ts`), a preset stratum in the plan report, and the two decisions that M2
    left of M3: P4's build row is threshold first, then hills (hills first left `trail-50k` and the
    100-mile athletes with no threshold in any build week), and a ladder or floor week does not
    count as a base week, so `longer-base` applies to eight of twelve matrix athletes. M3 had no PR
    of its own: M2 carried its Params, kind table, applicability and holds, and M5 its two
    decisions. The pinned known failures of the build (`test.fails`, 8 expected fails in all in
    #615's run) are RF1's two above and M5's: the checklist's `spacing` item at four sweep runners
    (half-marathon plans starting on a Saturday with threshold Saturday, long run Sunday, threshold
    Monday), the return from a window (after a 7-day illness the weeks after the window plan 16 to
    29 minutes where the plan before had 190 to 330, at the default and at both presets, so the
    defect is in J9 and J7 and not in the overlay), and two fixed-point residuals. The full preset
    phase sweep (150 runners, 26 race dates, two presets) timed out at 180 s on one GitHub runner,
    so `npm run check` keeps the matrix and a sample of it and the full sweep runs by hand. M6
    (#615, decision 8): `PUT /api/plan/method` through `computeReplan` and `applyReplan`, one
    undoable `method-change` revision with its diff and undo payload, the current week held, and a
    sheet on the Plan page. The guard: a week drawn under a preset carries a `shape-<preset>` flag;
    when the shape in effect differs from the stored current week's, the current week is drawn again
    under the shape it has and the new shape starts with the next week. A persistent hold that
    starts applies at once (keeping the stored rows would skip J5 and the injury ramp); a hold that
    ends, a runner's change and a novice's days ending wait for the boundary (ADR 0017's addendum,
    with labelled reasons); the transient holds, a rest window and the weeks after a race, leave the
    preset in place. A plan generated before #615 has untagged weeks, so its first re-plan redraws
    the current week once under the plan's own shape and says so in the summary.

    The e2e hardening (#616). The refused-strength-log case in `tests/e2e/12-today.spec.ts` failed
    one of two CI runs on #605, #610 and #612 ("Test timeout of 30000ms exceeded", then "setOffline:
    Target page, context or browser has been closed"). Cause, from the CI traces: the test cut the
    connection right after the card appeared, before the app had fetched its lazy sheet code
    (`warmSheets` runs when the main thread is idle, which on a slow runner comes after the cut);
    the chunk requests failed, Vite raised `vite:preloadError`, `reloadOnPreloadError` reloaded the
    page, and with the service worker blocked in that spec the reload landed on the browser's
    offline page. A second race was real: the 409 route was installed after the connection came
    back, and the browser's own `online` event replayed the log to the real server first, so the
    case also failed when run alone. The fix touches tests only: `loadWithSheetCode` in
    `tests/e2e/helpers.ts` waits until a sheet chunk has been requested and nothing is in flight,
    the 409 route goes in before the connection is cut, and the same pattern covers the two offline
    sibling cases. No sleep and no timeout change; 20 runs of the case in separate processes passed
    20 of 20.

    Review pattern. Each engine or surface PR of the build (RF1, M2, M4, M5, M6) was reviewed by
    independent lenses (three each, two for M5) with two refuters trying every finding, and only a
    confirmed finding was fixed. Confirmed defects fixed, as the PR bodies give them: RF1 4, M2 4,
    M4 5, M5 3 and M6 5, 21 in all; M6's sixth finding was a commit body that said the entry chunk
    did not grow (it grew 0.67 kB), and the commit stays as pushed. The corpus PRs took a second
    reading pass in place of lenses: S4b (agreed on 18 of 19 records, five gates tightened) and M1b
    (53 of 54 gate results, one tightened). The bodies of #587, #596 to #605 and #616 report no
    review.

    Gates and validation. At the end of the build, from #615's body on its merged tree:
    `npm run check` (`research:check ok: 406 papers`; 284 test files passed and 3 skipped; 16854
    tests passed, 8 expected fail and 6 skipped), `npm run build` (entry chunk 380.78 kB, from
    376.17 kB before M4), `npm run test:e2e` (102 passed) and `npx prettier --check .`. The build
    added no migration (M2 and M6 say so), and no PR body reports a `docker build .` run. Owner
    validation, run outside the repository and counts only: the steady plan on the real history is
    byte-identical to `owner-plan-c3`, the baseline of the strength epic, through every PR of the
    build. The bodies of #587, #608, #610, #612 and #615 each report the run, and the other PRs
    change no code that draws a plan. At each `PARAMS_VERSION` bump (now `2026-10-31.1`),
    `npm run plan:report` runs by hand before and after, with its delta pasted in the PR (CLAUDE.md
    and the `research-update` skill say so), and so does the full preset phase sweep
    (`PRESET_PHASES_FULL=1 npx vitest run tests/unit/engine/preset-phases-sweep`, 72.5 s for its
    three files); the simulator's figures are printed by a `SIM_FIGURES=1` run of
    `sim-athlete.test.ts`.

    After the build closed (2026-11-01). RU1 and RU1b (#619): the literature on repetitions in
    reserve (RIR) read in the source, 18 records added (406 to 424 papers) and 7 earlier ones
    re-read, the topic `strength-autoregulation`, and the six RIR `Param`s of rules F7 and F8
    re-derived. One grade changed, `f7.heavyRir` from D to C, and no value; `PARAMS_VERSION` went
    from `2026-10-31.1` to `2026-10-31.2`, `history-oracle.json` is unchanged and the owner
    validation is identical (`buildPlan` reads no strength `Param`). The second pass read each
    record's source before opening RU1's notes. It agreed on 145 of 150 gates and moved three R4
    results from pass to hold (`wiedenmann-2026-rir-trainability`,
    `richens-2014-reps-at-percent-runners` and `currier-2026-acsm-resistance-prescription`). It
    judged the grade C on `f7.heavyRir` justified, narrowly: five syntheses agree that stopping
    short of the limit costs no strength and one randomised trial spans the engine's range, but the
    five sources overlap, no study tests 1 to 3 against another target and the outcome is a
    one-repetition maximum in lifters, not running economy (D would also stand, B would not). It
    reported eight finding-level items and applied none, because each would move a finding, a level
    or a `Param`: the owner adjudicates them. It confirmed the divisor figures (the implied divisor
    is 33 to 36 for the bench press, 44 to 81 for the leg press and 79 to 97 for runners, against
    the `f8.e1rmDivisor` of 30), and the value stays: a larger divisor is supported for lower-body
    lifts and not for the bench press, and a change would be toward less load (G6). The e2e lesson:
    the first CI run of #619 failed one e2e case, the strength Why-drawer assertion, which read the
    former closing sentence of the `f8.progressMinRir` note that RU1 had rewritten, so a research
    pass that rewrites a `Param` note needs `npm run test:e2e`, not only `npm run check`.

    RF2 (#621): the engine defects that H2, RF1 and M5 left pinned. RF2 added or changed no
    `Param`, so it changes no `PARAMS_VERSION`; there is no schema, copy or `server/` change; the
    expected fails fell from 8 to 2. The first round fixed five findings. (1) The return from a
    window collapsed the weeks after it (16 to 29 minutes against 190 to 330 after a 7-day
    illness) because the part week a window left was the only ramp baseline once a recovery week
    sat between them; rule J9, "The weeks after a window", now counts a part week as a G-2 baseline
    beside another week and never alone, keeps the restart week after a hold of 7 days or more as
    the baseline of the weeks after it, and bounds the ramp so a window never raises a week
    (relation 5.3). (2) A closed day that empties the current week no longer lowers the weeks after
    it: they ramp from the last week run, never above the plan with the day open (a Preference in
    J9). (3) The race week placed a run on the race day that the race replaced, so a share of K2's
    minutes was never run and closing that weekday changed the week (K6, "Where the runs of the
    race week go"). (4) One of the two fixed-point residuals was the window collapse and went with
    it; the other, `longer-base` on trail-50k with a Monday niggle, was traced and stays pinned. (5)
    The `spacing` item passes for all 150 sweep runners (F3 had no exception for a first part
    week). Moved digests: finding 3 moved 139 of the 142 history-oracle digests (69 of 72 runners
    and all 70 chain plans) and the matrix digest of the plan report, only in the sessions of the
    race week; finding 5 moved 3 (`sweep #16`, `#28` and `#36`); the second round moved one,
    `h13 rest window` (moved once already by the window fix); the later rounds moved none, and the
    oracle was regenerated only with its test's command.

    Review of RF2. Five adversarial reviews followed the first round (three lenses, two refuters per
    finding) and confirmed 4, 4, 8, 10 and 3 findings; 23 were in the branch's own commits and are
    fixed, and 6 were already on main and belong to RF4. The second round's one cause, behind three
    of its four findings: the E3 recovery cut read the window-shrunk part week as the previous
    loading week, so a restart week on a recovery cadence was cut to about 24 minutes and then
    became the whole baseline of the weeks after it. The third round found the taper cut (a window
    in the last loading week pulled the taper to 0 minutes for the half-marathon and the marathon
    athlete) and fixed `remainingOfWeek`: the long run of the week in progress was held to the
    minutes left but carried a distance scaled by the whole week's share, so a 54-minute, 9,000 m
    long run capped at 28 minutes carried 1,633 m (about 17 min/km), and once the runs before a
    21-day window aged out of the 30-day window that run was the only G-1 distance reference and
    every run of the restart week became 12 minutes. The distance now follows the long run's own
    minutes (28 minutes over 4,667 m, 6.0 min/km); the fix applies to every mid-week re-plan, not
    only those with a window, and moves no digest. The fourth and fifth rounds and the closing
    items cut the taper from the lesser of two readings, bounded a taper under way by the weeks of
    the plan before (only against the plan of the same race, so a moved goal date does not take a
    post-race row), made the generator and the checklist read one baseline after a hold, read the
    hold's reference week and the tier of the whole layoff in the `break-restart` item, and made
    the restart floor week spend the first-block allowance. The reset at the restart floor week is
    an exemption from E3 (a Preference, no study), because the start path of a floor restart is
    six weeks and carries no recovery week.

    Readings and observations from RF2. Recorded as Preferences: the closed day (J9); a restart
    week that the cadence cuts below the J7 share is not a baseline, and the next week returns to
    110% of the last week run before the window, bounded by the plan before it (J9; the
    alternative, that the restart week stays a baseline and the return slows by a week, is the
    owner's call); the E3 exemption above. Observations left as rule questions, listed below: the
    day before a race now carries a run (K6, RF3), the marathon final-week decrease (K2) and
    `afterBreak` on the second Monday after an illness. A 28-day hold returns more slowly than at
    the first round's tip (1483 loading minutes against 2585 for the masters athlete), as J7 and J9
    say. Gates at `269cc3d7`: `npm run check` (285 files, 17018 tests passed, 2 expected fail, 9
    skipped, `research:check` ok), `npm run build`, `npm run test:e2e` (102 passed),
    `npx prettier --check .` and the preset phase sweep. The by-hand grids (`WINDOW_GRIDS_FULL=1`,
    about 9 minutes) failed no checklist item in 1,296 taper plans and 38,432 re-plans; the day
    grid of 7,362 mid-week re-plans has 0 failing the fall of the taper and 31 holding a taper or
    race week 2 to 7 minutes above its row (RF4). Owner validation, counts only: the state,
    warnings, checklist (0 of 15 failing) and weeks table are identical to `owner-plan-c3`, and the
    one difference is the sessions-per-week line, where the race week holds 7 sessions where it
    held 6 (the run on the day before the race, RF3's subject). What stays pinned: two expected
    fails (the simulator's fixed point at the first week of a start path and at a held week a
    window touches, and the `longer-base` residual below) and the three enumerated half-athlete
    cases with a 21-day hold in the restart-week sweep (RF4: J7 proration with G-1).

    #618 did the three small follow-ups of the build's close. `reloadOnPreloadError`
    (`web/pwa/register.ts`) no longer reloads while the browser reports offline, because a reload
    cannot fetch a newer build and would drop an open sheet; the once-per-minute guard's record is
    neither read nor written then, and ADR 0012's shell bullet gained the exception. CI caches the
    Playwright browsers (`actions/cache@v6` on `~/.cache/ms-playwright`, keyed by the installed
    Playwright version, with a five-minute timeout on the install of a miss, after two runs were
    cancelled at that step after 20 minutes; the first green run on a Playwright version fills the
    cache). `KG_PER` is exported from `shared/importers/appleHealth.ts` and imported by
    `server/providers/appleHealth.ts`, so the unit table exists once.

    #620 closed the two Dependabot alerts open on 2026-10-31. body-parser (alert 256, high, a denial
    of service by trailing bytes after a compressed request body) is transitive under
    `express@5.3.0`, whose `^2.3.0` range admits the patched `2.4.0`, so `npm update body-parser`
    moved only its lockfile entry; the release notes touch neither the `express.json` limits nor the
    auth-before-parse order, and 2.4.0 also decodes `Content-Encoding: zstd` where 2.3.0 answered
    status 415. minimatch (alert 265, medium, dev scope only, a globparts amplification) is patched
    only in `11.0.1`, no parent range admits it (eslint 9, `@eslint/config-array`,
    `@eslint/eslintrc` and `@typescript-eslint/typescript-estree` declare `^3.1.5` or `^10.2.2`,
    and their newest releases still do), and `npm audit fix` offers only `--force`, which would
    install eslint 4; so `package.json` gained `"overrides": { "minimatch": "^11.0.1" }` and one
    `minimatch@11.0.3` serves all four parents. The override goes once the parents declare a
    patched range. `npm audit` at the moderate level went from 12 vulnerabilities (11 moderate, 1
    high) to 0; `npm run check`, the build, the e2e suite and `docker build .` passed. Not
    verified: a real zstd-compressed request against the running app.

    Still open, and who owns it:

    - RU2, the plateau research update (decision 10: whether the class `peakWeeklyMin` or the
      history-informed ceiling of ADR 0013 should bind, and what the literature says about volume
      inside a plateau; it ends in a rule change naming each moved oracle digest, or in a stated
      reason in the Why drawer): a `research-update` session, open.
    - RU3, `injuryReturn.restDaysBetween` against its tendon source (S4b, #606: the Param is 1 day,
      the table it takes its levels from says 2 to 3 days between runs, so the Param is less
      conservative than its source): a value question for the owner.
    - S3, the book records (_Run Less, Run Faster_ 3rd ed., Pierce, Murr and Moss, for the FIRST
      plans; Lydiard, with Gilmour 1997 for the phase lengths; then the corpus gaps Koop 2nd ed.,
      Daniels 4th and Pfitzinger 4th; the Daniels page is what the R1 failure above waits on): the
      owner reads the pages, every book being treated as held.
    - H2b, the tuning of the simulator's other two levels (H2 shipped all three with named rates): a
      session, open.
    - RF3, the day before a race of 90 minutes or more: K6 asks for little running in the final 24
      to 48 hours and no `Param` implements it, so a full race week now places a run there (48
      minutes for a first 100-mile). The task is a K6 shake-out rule with a grade D `Param` for the
      most minutes on the day before a race, and easy running only on the two days before, through
      the `research-update` skill; the brief is written, and the session is running or queued.
    - RF4, the cases #621 pinned: the three half-athlete cases with a 21-day hold in the
      restart-week sweep (`STILL_PINNED` in the test, the cause in a comment: the J7-prorated return
      week gets two short runs that are the only runs in the restart week's 30-day G-1 reference, so
      the weeks after it grow from what was placed; the window code is not the cause, J7 proration
      with G-1 is), and the other cases #621 lists under "Still pinned, and RF4": mid-week re-plans
      of a taper in progress and of plain plans that fail the `taper` and `tid` items in the
      reviewers' harness (unverified against a stored plan), the erosion of a held plan's recovery
      week, the 31 mid-week re-plans of the day grid that hold a taper or race week 2 to 7 minutes
      above its row, the `tid` item of the reds-hold Tuesday chain, and the start path of a floor
      restart, which carries no recovery week. The simulator's fixed point at the first week of a
      start path and at a held week a window touches stays a `test.fails` beside them.
    - The K2 final-week question: the marathon's final-week decrease is now K2's own figure (0.35 /
      0.55 gives about 36%; the plan report reads 36.5% for the marathon, masters and hot-race
      plans, where it read 49.2%), against the practice band of 46 to 54% (Knopp 2024); the old
      accidental shed had put it inside the band. A change is a K2 `Param` change (grade D
      multipliers), the owner's call.
    - `afterBreak` stacking on the second Monday after an illness: it still applies there (the
      half-marathon athlete's first full week after an illness goes 193 to 129), as on main.
      Related: a plan moves between re-plans after a long hold, because the macrocycle restarts
      from the typical week after a break at one Monday and carries on from the stored plan at the
      next (hot-race, 14 days: 248, 238 and 319 at three successive re-plans).
    - The `longer-base` preset residual: on a window-touched week the window's own cap (`holdWeek`)
      keeps the long run and leaves the preset's week at 252 against the default's 243, then the G6
      cap (`capWeek`) shrinks every session by the same share. Capping a window-touched week with
      `holdWeek` is a one-line fix that moves every preset plan a window reaches, so it is its own
      task (pinned in `preset-chains`: trail-50k, Monday niggle).
    - The first-100-mile ragged `taper` item at 0-minute taper weeks: the simulator's checklist
      failed 1 of 29 steps before RF2 and 4 of 29 after, at the taper weeks of a runner collapsed to
      0 to 30 minutes a week. The failures first appear in the window fix, not in the race-week
      commit; no baseline chain fails the `taper` item, the second round left them as they are, and
      the fourth and fifth rounds left the checklist counts unchanged in all 48 chains.
    - The harness: `plan-metrics.ts` reads a window's part week as the G-2 baseline and skips a
      restart week that the cadence cut, so the rest-window sweep's soft-step headroom minima (-295
      to -99 by stratum, against -47 to -13 on main) and its 89 of 576 plans under -47 are a
      construction of the report, not of the engine, whose checklist passes all 576 plans. Teaching
      the report the engine's reading is a harness follow-up.
    - The P2 marathon extension (a weekly-minutes cap or a cross-training session kind; decision 6):
      the owner has not said.
    - By hand, for the owner: the Higdon advanced 5K page (a second read or the owner's sign-off
      takes `higdon-2024-advanced-5k` off `PREDATES_RUBRIC`), and the contents of the two Crossref
      notices behind bot checks, the Tyler 2016 erratum (`10.1007/s40279-016-0572-3`) and the
      Mountjoy 2023 correction (`10.1136/bjsports-2023-106994corr1`).
    - For the owner: section (p)'s "no load" sentence for P4 is true of minutes only, since
      `longer-base` adds one threshold session on `trail-50k` and `first-100-mile` (the peak planned
      load of `trail-50k` rises 35 units; M5, left as written).
    - For the owner: RU1b's eight items, reported and not applied (finding 7 of
      `hickmott-2022-autoregulation-meta`, which reads repetitions left beyond the call as "before
      failure"; finding 3 of `martikainen-2025-varying-proximity-failure` and finding 4 of
      `wiedenmann-2026-rir-trainability`, which overstate their sources slightly; finding 5 of
      `helms-2018-rpe-vs-percent-loading`, which drops "at all times"; level A of Robinson 2024 and
      Halperin 2021; the `evidence` list of `f7.heavyRir`, which omits the 2026 stand that its note
      cites; the `f8.e1rmDivisor` note, which says 30 "fits" bench-press counts that imply 33 to 36;
      and step 18 of the method in `research/README.md`, whose "about 44 to 81" is the leg-press
      range alone), and the `f8.e1rmDivisor` value itself (30; a larger one is supported for
      lower-body lifts and not for the bench press).
    - Small follow-up, not urgent: the two readings of Treff's index that #605 recorded.

29. Audit: the best it can be (2026-11-01). A six-lens audit (ultra coach quality, the
    self-adjusting loop, product, evidence process, reliability and privacy, and evaluation) made
    60 findings; two refuters per finding were told to refute by default. Six were confirmed:

    1. Race day is unplanned: the race session targets RPE 8 to 9 for a 34-hour race,
       `h11.belowVt1Share` (`shared/engine/params/h-ultra.ts`) and the four `k6.*` Params
       (`shared/engine/params/k-taper.ts`) are read by nothing, `FUEL_KINDS.race`
       (`shared/engine/fuel.ts`) is `false`, and rule E12's race plan has no design. The fix is
       step 1, an ultra race-effort `Param` and the Z1 ceiling, then step 2, a race plan derived on
       read in the ADR 0014 shape, as the strength workout is.
    2. The Why drawer declares an intensity mix that the plan does not deliver (the marathon build
       about 91/7/2 against the 80/12/8 declared, the 100-mile build 98/1/0 against 85/10/5), and
       `e4.priorTolerancePp` (`shared/engine/params/e-macro.ts`) is read by nothing. The owner
       decides intent or truth; G6 favours the truth.
    3. There is no backup, restore, pre-migration copy or rollback path (the README's one command
       needs a `sqlite3` binary that the image lacks). Open as #624, under review.
    4. There was no dependency gate (the body-parser advisory sat open for 7 days while about 40 PRs
       merged). Done in #622: an `npm audit --omit=dev --audit-level=high` step in CI, a `docker`
       ecosystem and major-version ignores in `.github/dependabot.yml` (the `@prisma/*` ignore is
       confirmed only on Dependabot's first run); branch protection stays follow-up 11.
    5. There is no trends or season view: `useWellness` (`web/api/wellness.ts`) has no consumer,
       and the charts stop at 12 weeks (`web/pages/StatsPage.tsx`).
    6. The README's weather privacy sentence is false: GPS activities and race climates always go
       to Open-Meteo, and `useHomeWeather` gates only the home fallback. Corrected in this PR.

    The narrowed survivors, one sentence each:

    - A Today note for a source that has gone silent or needs authentication.
    - The reminder channel, parked as E18.
    - CI `check` takes about 680 s on the runner.
    - Heat acclimation for a runner whose spring is cool.
    - Sign-out-everywhere.
    - Quieting the health probe in the logs.
    - A Docker smoke job in CI.
    - Nine Params graded above their best cited paper.
    - Steps in the Today card.
    - An after-run block that never states an inferred effort verdict.
    - A sensitivity probe in the plan report.

    Refuted, with the reason: vertical specificity (the probe ran at 9,000 m of gain, far above the
    matrix fixture); hiking as a stimulus (lab energetics only); a daylight module
    (`crossesDarkness` is already true for any 100-mile); a logistics checklist (no source); a
    rehearsal ledger (rows exist, E11 undesigned); a tune-up race (follow-up 4); a Smashrun provider
    (intervals.icu feeds the app); rescheduling downgraded sessions (G-6, grade B); an offline run
    log (decision 27); sharing (a non-goal); a sex-invariance relation (G-3's BMI rule); edge
    athletes (300 plans green); a 60-paper full-text pass (disclosed); a retraction scan (S0 and S1
    done).

    Owner decisions pending: whether the race plan is effort-only or carries splits and a private
    checkpoint table; intent or truth for the intensity mix; RF3's two defaults and the K2
    final-week question; the backup destination and its encryption; branch protection; whether a
    trends page holds weight and prediction history; the reminder channel; passive heat; and one
    integer of session state.

    Recommended order: RF3, race plan step 1, intensity honesty, backup (#624, open), the CI audit
    gate (done in #622), race plan step 2, trends, the silent-source note, CI time.

## Clean-up after the merges

- Delete obsolete remote branches: `feat/comprehensive-ci-cd-infrastructure`,
  `feature/phase3-test-fixes-complete`, the five `fix/*-pr298` branches, the eight July-2025
  rescue branches (`architectural-review-and-improvements`, `error-logging-standardization`,
  `feature/refactor-async-handlers-39`, `fix/footer-css-classes-issue-155`,
  `fix/issue-113-api-mocking-standardization`, `fix/limit-pace-decimal-places-108`,
  `issue-105-fix-unreachable-catch-stats`, `lint-react-hooks`).
- Delete the local `task/*` and `review/*` branches from the parallel agents (including
  `task/round2-B`, `task/round2-C`, `task/round2-D`), remove the agent worktrees under
  `.claude/worktrees/wf_*` and `.claude/worktrees/agent-*`, the stale `build e2e integration
linting unit-tests` worktrees and the detached comparison worktree the start-path task left
  in its job directory (`git worktree prune` after the directory is gone); check `_main` out on
  `main`.
- Unset `core.hooksPath` in the bare repository; it points at a removed `.husky/_`.

## Environment notes

- Bare repository with worktrees (`~/src/BARE-REPO-WORKFLOW.md`). Isolated agent worktrees
  branch from `origin/main` and have no `node_modules`; agents run `npm ci` first.
- The Playwright web server listens on 3101 plus a per-checkout offset (0-399, a hash of the
  checkout's absolute path, `tests/e2e/env.ts`), so worktrees can run `npm run test:e2e` at the
  same time; it also clears `test-results/`. Print a checkout's port with
  `node -e "import('./tests/e2e/env.ts').then((m) => console.log(m.E2E_PORT))"`. Two checkouts can
  still hash to one port; the run then fails on the bind error.
- The owner's intervals.icu account goes dormant without a login; Garmin's official API is
  closed to new applicants (October 2026).
- Personal training data stays in Google Sheets, Smashrun and the owner's own app database; the
  repository holds synthetic fixtures only.
- Dependency policy: a security advisory on a runtime dependency is merged within 48 hours of its
  Dependabot PR going green, other grouped updates weekly, and a major version only by a deliberate
  decision; a red `npm audit` step in CI blocks until the advisory is addressed.
