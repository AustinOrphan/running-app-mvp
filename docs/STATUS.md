# Status

Current state only; rewritten at every boundary. History lives in `git log`, the specs and
plans under `docs/superpowers/`, the research corpus under `research/` and `docs/adr/`.

Last update: 2026-11-22.

## Waiting on the owner (2026-11-22)

Each item names the default that holds until the owner answers.

1. **Move to the home server and switch on off-host backups.** Do the cutover from the private
   homelab runbook, name the sftp target machine, and change the homelab restic job from 30 to 29
   daily snapshots (newest `app-*.db` only) before the cutover. Default: the laptop copy, whose
   jobs stop when it sleeps, plus same-disk daily copies only.
2. **Enter the spring race and set the places.** Enter the spring race as a B or C goal (#731),
   and set the home place and the race place (place search, #756 and #757) so race heat, the
   cooling line and the night-run counts work. Default: no spring race in the plan, and no race
   heat or night counts.
3. **Device checks on the watch and phone.** Check the FIT files on the watch, one live
   intervals.icu publish, a calendar app on the webcal link and the Garmin model for the help text
   (Q6). Also check the fuel-cue test on the wrist (kit sent outside the repository), the minus
   key and the colon in the number fields on the iPhone (#792), and one strength session logged in
   a gym online and offline. Default: delivery to the watch stays an inference.
4. **Tag the first beta.** In the live checkout: move `prisma/dev.db` and `prisma/prisma` out
   of the checkout (the release script refuses a dirty tree, `scripts/release.ts:173`), run
   `git pull`, run `npm run release -- 2.0.0-beta.1`, run `docker build .` and
   `npm run -s plan:report`, edit the draft note `release-notes/v2.0.0-beta.1.md`, then run the
   two git commands the script prints. Default: untagged; `v1.0.0` is the
   latest release tag.
5. **Beta gate (D2).** Invite testers only after the move, with the off-site backups on, the data
   notice shown and the network change applied. Default: no invitations.
6. **Strava policy choices.** Decide whether to drop the stored coarse start point
   (`server/providers/strava.ts:361,380-381`, Policy 5.7) or keep it for non-Strava use only, and
   settle the 7-day cache (6.2) and the no-AI-read rule (5.3). Default: the coarse start point is
   stored.
7. **Accept the proposed ADRs.** ADR 0024 (place search), 0025 (Strava per-runner apps) and 0026
   (work follows events) are built and merged but still read Proposed. Default: they stay Proposed.
8. **Engine values awaiting a call.** Pending: RU2, whether the ADR 0013 rebuild ceiling or weeks
   run may lift the class-peak ceiling (more load on grade D); the K2 marathon final week (36%
   against 46-54%; a 100-mile taper uses the 2-week row [0.65, 0.4], so the owner's race is
   unaffected); the P2 extension past the half-marathon; RU1b's eight findings and whether
   `f8.e1rmDivisor` stays 30; the P4 "no load" sentence in `engine-rules` (p); the strength wave-0
   questions (calf A/B alternation at `shared/engine/strength.ts:288`, bodyweight movements at no
   added load, a 40 vs 25 min lighter week); the five smallest-reading assumptions; the L3d
   confirmation. Default: the shipped values stand.
9. **Sources and readings.** Photograph into `data/sources/` (ignored by Git): Koop 2nd ed.,
   Daniels 4th, Run Less Run Faster 3rd, Lydiard and Gilmour 1997, Pfitzinger 4th. Collect the
   papers with no legal full text (Warden 2014, Doherty 2020, Keogh 2016, Mountjoy 2023 with its
   correction, Bourdon 2017, Ely 2007, the Tyler 2016 erratum). Read the Higdon advanced 5K page.
   Default: the rules keep their grades; the Higdon and Daniels records stay in
   `PREDATES_RUBRIC` (`scripts/research-check.ts:141`), and the book records stay unwritten
   until the pages are photographed.
10. **Strength setup and bar.** Enter the equipment, lifting level and weight unit, then judge the
    spec 1.4 bar after a month of use. A rest timer and a plate calculator are built only if the
    bar fails. Default: generic setup, nothing built.
11. **Small optional decisions.** Folder scan: a file watch once the sftp drop exists (default:
    5-minute scan, `shared/limits.ts:27`). Restore in a week with no weekly update (default: as
    is, #799). Owner replay figures into spec 5.6 (default: the figures stay outside the repository;
    recommendation: close as no). Compact banner buttons at 26 px (default: as built; every
    action previews first). VoiceOver pass (default: axe scan only). Apple Watch companion spike Task 1 in Xcode
    (default: nothing built).
12. **Stale remote branches.** Review the six stale remote branches: `ci/e2e-ubuntu-2404`,
    `feat/coach-phase3`, `feat/il2-illustrations-in-use`, `task/M1-methods-research`,
    `task/RU1-rir-research` and `task/S4-revet-practice`. Default: kept.

## Where things stand

- `main` is at 21cef333 (#818), 2026-11-22. `PARAMS_VERSION` is `2026-11-22.1`
  (`shared/engine/params/index.ts:24`). The research corpus holds 469 records in
  `research/papers`.
- The app version is 2.0.0-beta.1 (`package.json:3`, #793). The latest release tag is `v1.0.0`,
  so the beta tag is not made.
- ADRs run to 0026. 0021 (companion) is not written. 0022 and 0023 are Accepted; 0024, 0025 and
  0026 read Proposed.
- The live copy runs on the laptop over http `.local`. The home-server move and the beta
  invitations are not done.
- Branch protection on `main` (owner decision 2026-11-20) requires the `ci` and CodeQL `analyze`
  checks, without the branch being up to date, and refuses force pushes and deletion; it is not
  enforced for admins.
- #740 to #801 merged 2026-11-16 to 2026-11-19: per-runner days (ADR 0022), the road race plan
  (ADR 0023), place search (ADR 0024), beta preparation, Strava deletion (ADR 0025) and polls to
  events (ADR 0026: terrain, HR quality, track and surface run as start passes and on edit, watch
  ratings and track streams follow the hourly sync, publish runs on change). The PRs hold the
  detail.
- #802 to #818 merged 2026-11-20 to 2026-11-22: the status update, the `effect` override and the
  branch-protection notes (#802 to #804), then engine work on re-plans after a break, a hold or a
  window. A reported break is restarted once (#808); the hold cap steps from the minutes run (#809);
  a week too small for two runs holds one run growing about 10% a week (#810, #813); the long run's
  distance limit is measured once (#807); the short week stays a part week (#805); a window lowers
  only the weeks it or its ramp back holds (#811); a re-plan after the Monday keeps the later weeks
  (#812); the taper reference and the planned minutes of a short-placed week are kept (#814, #815);
  windows under 7 days leave the later loading weeks unchanged (#817); a held week trims its quality
  session once (#818). The PRs hold the detail.
- Timers left in the scheduler: sync hourly, folder every 5 minutes, weather every 10 minutes,
  predictions every 6 hours, plus the daily slots (`server/jobs/scheduler.ts:1119-1229`).
- Off-host backup bound in code: 29 snapshots (`server/services/backup.ts:57`). The restic job is
  in the private homelab repository and still keeps 30.
- Earlier STATUS text, with the wave and phase reviews, is in `git show 7f653392:docs/STATUS.md`.

## Open follow-ups (none blocks a merge)

Ranked by weight for the first 100-mile build toward the goal race, then for beta readiness.

1. **Live copy on the laptop.** The hourly sync, the Monday re-plan, the calendar publish and the
   02:00 backup stop whenever the laptop sleeps. See owner item 1; beta invitations wait for the move (D2).
2. **Off-host backups.** Only the app's own daily copies exist, on the same disk as the database.
   The app side is done (`OFF_HOST_SNAPSHOT_DAYS = 29`); the rest is owner item 1.
3. **Workout delivery on the real watch is unconfirmed.** Unchecked: the three FIT files on the
   watch (manufacturer 255, repeat steps, string caps, hike sent as running); one live
   intervals.icu publish (sport-settings field names, percent-pace steps, the 40 bpm floor,
   `external_id` and date change by PUT); a calendar app on the webcal link; which Garmin model
   the help text names (Q6). Until then "On your watch" is an inference.
4. **Race simulation opt-in (H2) is not built.** The opt-in 8 h simulation, no later than 3 weeks
   before race day, is design intent. `h2.raceSimulationMaxHours`
   (`shared/engine/params/h-ultra.ts:81`) has no reader; only the longest-run caps of H2 are read
   (`shared/engine/goal.ts:367-368`). It must exist at least 3 weeks before the goal race to be
   used.
5. **Race fuel rate has no duration floor.** `raceFuelFor` (`shared/engine/fuel.ts:546`) takes the
   tolerated rung of the ladder whatever the length of the runs that showed it, so a 2 h run
   counts like a 6 h run. A floor that can only lower the rate was proposed on 2026-11-12 and left
   out because it changes plan output (`PARAMS_VERSION` bump, `plan:report` delta).
6. **Blank page after tapping Done on Today.** Seen once (iOS Safari PWA, 2026-11-11), no known
   cause, not reproduced in headless Chromium. Error boundaries (#705), window error reports
   (#713) and the feedback note (#714) capture the next occurrence. No recurrence is recorded.
7. **After a held restart, the generic paused path draws the next weeks low.** A week the weekly
   decision holds under the 3 x N floor stays a restart, and the weeks after it step from the
   floor: marathon, 2026-12-21, draws 41, 30, 45, 49, 53
   (`tests/unit/engine/held-week-restart.test.ts:33-41`, pinned as the engine draws it, not as a
   target). The cause is not traced; the code that continues a paused sequence after a restart is
   `replanAnchor` (`shared/engine/macro.ts:419-484`) and `anchored` with `haveWork`
   (`macro.ts:1342-1369`).
8. **The planner and the guards read a guard-emptied week differently.** `generate` enters a week
   in the ramp baselines at the minutes it holds, zero included (`shared/engine/index.ts:1480`).
   The guards leave a week they emptied out of the baseline, so the weeks after it are measured
   from an earlier week (`shared/engine/guards.ts:296-301`, changed in #810). The two readers can
   disagree about the week after an emptied one. No committed case separates them.
9. **A strength-only week counts as 0 in the checklist and is skipped in the guards.**
   `draftRamp` lists every week that holds any session, strength included
   (`shared/engine/checklist.ts:169`), and a week with no run totals 0 there, while `rampWeek`
   returns at a total of 0 and leaves the week out (`shared/engine/guards.ts:329-334`). A week of
   only a strength session is a zero baseline for the checklist and no baseline for the guards.
   Not reproduced by a committed test.
10. **The first week back shows the J9 figure, then G-1 cuts it once the return runs exist.** After a
    hold the first full week is drawn at the hold's restart share while the 30-day reference is empty;
    at its own Monday the short runs of the return week are the only runs in the reference, and the
    G-1 session-spike limit (`days * longCap`, `shared/engine/macro.ts:1499`) cuts it: hot-race,
    28-day niggle from 2026-11-14, 189 at the re-plans through 12-07 and 120 at 12-14; trail-50k,
    niggle of 28 days from 2026-11-21, 224 then 120 (measured in #808). Lifting it means exempting a
    restart week from G-1 or placing the return week's runs differently, a change to a safety rule.
11. **G-1 can cap every run of a week, beyond the long run.** #807 measures the long run's distance
    limit once (`longRunMinWithin`, `shared/engine/macro.ts:1417-1419`), so the stated long run is
    the one placed, and `tests/unit/engine/g1-week-cap-sweep.test.ts:24` pins the 11 weeks after a
    part week. Later weeks, and runs that are not the long run, still drift from their stated target
    where G-1 holds every run of a week at one cap (`macro.ts:1499`), and three equal runs at the cap
    stay legal (D7). Seen on a real history before #807; no committed case beyond 11 weeks.
12. **The rebuild after a long hold at a fraction under 1 is slow.** The weeks after the full week
    of such a hold are bound by the ramp (the ceiling weeks, `shared/engine/index.ts:626-632`; the
    g-8 rebuild zone, `shared/engine/limits.ts:540-546`), and the plan reaches the pre-hold figure
    late. No committed case and not traced to one of the two.
13. **A window of 3 days or more whose days are past, re-planned on the Thursday, still leaves the
    next weeks below the no-window plan.** #817's known limit: the half-marathon chain re-planned on
    the Thursday after a Monday to Wednesday window draws 213, 234 and 175 minutes against 259, 270
    and 202, the figures main drew before. The runs missed inside the window stand in the G-1
    reference and the run record. Pinned in
    `tests/unit/engine/short-window-later-weeks-sweep.test.ts:155-182`; no claim of rule.
14. **A week where a window holds or caps a day, under a hold, can still take the trim twice.** #818
    makes a window a bound on a week only when it holds or caps a day (`windowTakesMinutes`,
    `shared/engine/index.ts:2055`). Where it does, the bound is the minutes placed and the hold trim
    (`holdTrimmed`) takes its minutes from that bound again at the next re-plan. In the 2,133-step
    differential, 18 steps have such a week (3 of them with sessions placed below the figure) and
    none breaks the week-target fixed point. The count is from #818's review, not rerun in the
    repository.
15. **A replay of a real history, from before #817, raised many later weeks above the Monday plan on
    a mid-week re-plan.** #812 found later weeks above the Monday plan on main and on its branch
    alike (a path that predates it, F-a1 to F-a3). #817 changes that path (window-free weeks) and the
    replay was not repeated on #817 or #818 (counts only, nothing kept in the repository).
16. **The six F-a items of #812.** F-a1: start-path ladders still raise on a re-plan (needs an E6
    decision). F-a2: the returning runner's J7 return week. F-a3: the recovery-cadence shift of
    sparse-100-mile. F-a4: the `replanChain` hole in `tests/unit/engine/replan-steps.ts` (closed for
    the first re-plan; later re-plans run the week before them as before). F-a5: taper and race-week
    residuals (a few minutes short in a later week on the hot-race Thursday and after). F-a6: fixtures
    that log runs with no elevation. One path is untested: a run logged today that matches no planned
    session, while today's planned run is still in `plannedOn`, could add a day.
17. **The `g2.ceilingLookbackWeeks` note names one of its readers.** The Param note
    (`shared/engine/params/g-limits.ts:160-163`) describes the 2-week ceiling's look-back
    (`shared/engine/limits.ts:768`). #811 adds a second reader, the weeks after a hold that a window
    may hold under their target (`shared/engine/index.ts:626-632`), and #817 a third, the read-back
    of the weeks a short window took days from (`limits.ts:431`). The six-week reach is a design
    default for the new uses, not a measured value.
18. **Entered B and C races: narrowed check, no browser check.** After an entered race's day the
    minutes check of a re-plan is narrowed. The Plan page with an entered race was not checked in
    a browser, and an A-priority goal other than the plan's own is not read (#731). The
    12-athlete probe found no failure; no e2e spec covers an entered race on the Plan page.
    Medium weight, because owner item 2 enters a spring race: when a completed race of marathon
    distance or longer lies before the goal race (`windowLeadIn`, `shared/engine/macro.ts:1926-2004`;
    `shared/engine/postRace.ts:411-417`), the plan drawn after its post-race window passes
    `existing: null` (`macro.ts:2029`), so `pastStrengthBlock` (`macro.ts:531`) finds no block and
    starts a fresh strength block during the build. Strength stays at 0 through the window
    (`postRace.ts:664`). The first-finish modifier applies to a runner with no race history. The
    new-plan trigger uses the D1 class while G-1 uses the literal 42,195 m.
19. **Strength logging is not checked on a phone in a gym.** No real strength session has been
    logged on the owner's phone, online or offline. `tests/e2e/17-offline.spec.ts` cuts the connection in a
    desktop browser only.
20. **Beta tag.** `package.json:3` is `2.0.0-beta.1` but the latest release tag is `v1.0.0`; see
    owner item 4. The app shows the `package.json` version (`server/version.ts`,
    `web/versionDefine.ts`); the tag marks the release notes and the rollback point. Later betas
    count up with each tester-facing update.
21. **Strava start point and policy questions.** `server/providers/strava.ts:361,380-381` reads
    `start_latlng` and stores it coarsened (`coarse()`) as `startLat` and `startLng`; Policy 5.7
    restricts storing location; see owner item 6 for the choices.
22. **Invited-account flow not tried on a phone over HTTPS.** Create-user, the temporary password
    and the PW1 gate `auth.password-change-required` (`server/auth/middleware.ts:62`) were tried
    in Chromium only (`tests/e2e/38-invited-account.spec.ts`), with no phone, HTTPS or proxy. Anyone who knows an email can lock that account out of sign-in
    for 15 minutes (10 failures), and behind a proxy the per-address budgets are shared by every
    runner (`server/auth/rateLimit.ts`); open, and relevant to beta readiness.
23. **delete-user leaves data in backups, free pages and published events.** The user's rows stay
    in the daily copies until pruned (`server/services/backup.ts`), and pre-migrate and
    pre-restore copies are removed after 29 days, except the newest 3 of each kind, which stay
    whatever their age (`KEEP_PRE_MIGRATE_DAYS`, `KEEP_PRE_MIGRATE_MIN`, `backup.ts:49-50`), so
    those 3 can hold a deleted account's rows indefinitely. They also stay in the
    live file's free pages until VACUUM, and in intervals.icu calendar events the publisher wrote
    (#711). The README data notice states the bound.
24. **A failed climate refresh bumps the data version.** `ClimateCache` is a state model
    (`server/dataVersion.ts:47`) and a failed refresh writes `failedAt` and `lastError` to it
    (`server/services/weatherCache.ts:544-548`), so every failure drops every memo. Moving those
    columns off the state table needs a schema change. `ForecastCache` is non-state, so its
    failure write is harmless.
25. **The brief says "no key session this week" after the first key session has passed,** even
    when a later one remains (`shared/copy/briefTemplates.ts:248-252`). The line also draws
    nothing offline, and Open the brief can clip in the two-line clamp.
26. **Goals reads "1:45" as minutes and seconds.** `parseTime`
    (`web/components/goalFormat.ts:28-32`) reads "m:ss" for two parts, so "1:45" is 105 s. Only
    h:mm:ss reads as hours.
27. **Watch rating is not refreshed after the first ask.** A run's intervals.icu rating
    is read at import and asked once more at the next hourly sync (`runWatchRatingPass`,
    `server/jobs/scheduler.ts:315-325`; `createdBefore` is the start of the sync before the tail),
    then never, so a later change in
    intervals.icu is not picked up. A stored standout and the execution assessments are not
    recomputed when the spread check first passes. The three spread thresholds are defaults.
28. **The track-record memo reads non-state `PredictionLog`.** `server/services/trackRecord.ts:31,41`
    reads it (non-state, `server/dataVersion.ts:79`), so the memo is sound only while no
    prediction is logged after a result is recorded. `PredictionLog` moves to `STATE_MODELS` in
    the PR where the engine or the snapshot first reads it.
29. **A kept raised week target carries no progression warning.** The checklist
    (`shared/engine/checklist.ts:227`) is built from the engine draft and never sees the kept
    figure (`targetKept`, `server/services/replan.ts:136-178`). The diff and the Plan page do show
    the figure. Applies only when the runner raises a week by hand.
30. **A5 low-frequency flag at a high start level.** `lowFrequencyOf`
    (`shared/engine/athlete.ts:564`) arms at a start level over 60 min with fewer than two runs a
    week. It keeps the 2:1 cadence and the time step (`shared/engine/limits.ts:322`) and, since
    #579, no longer holds the load setting. The other options of the proposal stay open.
31. **Simulator fixed point and pinned preset cases.** A re-plan with nothing new returns the stored
    plan at the week-target level in all 2,133 steps of the sim-athlete differential (seed offsets
    0, 1000 and 2000, three levels, twelve athletes, from the run for #818, outside the committed
    tests; 0 breaks as of #818). A stricter deep-equal check
    leaves six drifts: 0/reds-hold/14, 0/post-marathon-short-run/1, 2000/marathon/19,
    2000/reds-hold/18, and 2000/post-marathon-short-run/1 and /5. They belong to the first week of
    a start path and to the long-run figure of a recovery week inside a rest window (KNOWN LIMITS,
    `tests/unit/engine/sim-athlete.test.ts:1029-1040`, pinned as `test.fails` at `:1041`). The older
    count of 39 drifts in 576 window combinations (2026-10-23) was not rerun and is replaced by this
    differential. Under longer-base, a window-touched week stays at 252 against the default's 243
    (`tests/unit/engine/preset-chains.test.ts:514,530`, `holdWeek` at `shared/engine/index.ts:462`).
    Not rechecked on main: the first-100-mile ragged chain collapsed to 0-30 min a week failing the
    taper item at 4 of 29 steps, and `tests/unit/engine/plan-metrics.ts` reading a window's part
    week as the G-2 baseline, so some sweep minima are report artefacts. The three half-marathon
    cases with a 21-day hold are closed (#808; `STILL_PINNED` is empty,
    `tests/unit/engine/disruption-integration.test.ts:1217`).
32. **Compact banner, fold and 125% text layout.** The compact disruption banner's buttons are
    26 px tall, below common touch-target guidance, and every action previews first (owner item
    11). The
    rest-window offer may be read twice in browse mode. Today may scroll sideways at 125% text
    from the hidden chart table. With three readiness signals, Done falls past the 788 px fold at
    390x844 and behind the tab bar at 360x740, and the fold assertions do not subtract the tab
    bar. None of this is verified in a browser on main.
33. **The Today preview payload arms no rollover timer.** `useServerToday`
    (`web/api/today.ts:78-102`) arms none for a preview payload, so a preview that becomes today's
    copy waits for the next focus or reconnect. Explain offline still waits out its retries. The
    sync-paused and weekly-update health notes in kept Today copy may be stale.
34. **Revision and fuel form gaps.** State-driven updates show no per-session Why in
    `RevisionDiff`. The undo-reason copy differs from the examples in spec 8.6. The fuel "opens
    after" hint can understate what the server allows, and focus drops to the page after a fuel
    settings save. A fuel-log item whose product was edited loses its product link on the next
    edit. An undo after a `PARAMS_VERSION` bump shows "Drawn under updated plan rules"
    (`shared/copy/revision.ts:629`) although its rows are the restored ones.
35. **Climb note and eased easy runs.** `climbNote` (`shared/engine/targets.ts:132`) fires on any
    session whose planned gain per hour reaches `h4.climbNoteGainPerHourM`, so it shows on every
    run of a climbing week. `easedSession` (`shared/engine/readiness.ts:791`) spreads the original
    session, so an eased easy run keeps its `gainM`, and it gives one purpose text (readiness
    signals lower than usual) for every easy downgrade. Checked on HEAD 2026-11-20; both hold.
36. **An engine trim of a future session writes a plan row outside any revision.**
    `trimNextQuality` (`server/services/execution.ts:75-139`) updates the `PlanSession` row
    directly, with no `recordPlanWrite`, so a later undo can read the row as an edit and refuse
    (the refusal names the row; the refusal path itself was not traced). The row does keep the
    untrimmed session in `original`. Checked on HEAD 2026-11-20.
37. **`RUN_CAP_MAX_MIN` and the trim predicates.** `RUN_CAP_MAX_MIN = 240`
    (`shared/engine/disruption.ts:31`) is documented as an input bound of the form, not a rule;
    whether the every-number-is-a-Param rule covers it is a judgement call.
    `shared/engine/index.ts:289-293` keeps its own `isTrim` and `isHoldTrimRow` beside
    `isTrimmed()`.
38. **Small engine gaps for other runners.** Not offered or not built: a declared longest run
    (A3; no profile field); n1 walk-jog stages after a bone stress injury (only `n1.bsiReturnDays`
    exists); widening the prediction range during a rest window; moves across weeks
    (`shared/engine/adjust.ts:9`); open-ended windows (`j9.maxWindowDays`); an automatic follow of
    the device zone (ADR 0022: the runner changes the profile zone). The sleep-efficiency signal
    needs time in bed, which only Apple Health supplies (#739). A novice 5 km goal 12 weeks out
    reads "not reachable" although the plan still builds. Contrived re-plans with completions that
    have no activity can collapse to zero-minute weeks (19 of 2,310 fuzzed); no real path
    produces that input.
39. **Low-weight follow-ups.** `useWellness` (`web/api/wellness.ts`) has no consumer. Stats charts
    stop at 12 weeks (`web/pages/StatsPage.tsx:21`). The Warning signs page has no offline test, and the
    feedback clipboard fallback is untried in iOS Safari. The downhill cue shows on the session
    sheet only (`web/components/SessionSheet.tsx:75`), and "heavy" has no metre dose. The own easy ceiling reads
    nested refits and has no e2e spec. The first-hot-days hold can answer 409 stale-preview after
    a forecast refresh, by design. Time in bed was tried on synthetic fixtures only. The axe scan
    covers seeded states only and keeps one known 3.24:1 violation
    (`tests/e2e/42-axe-scan.spec.ts:68-70`). The survivors of the 2026-11-01 audit are unchecked: E18
    reminders, CI time, nine over-graded Params, Steps on Today, the after-run verdict, the
    sensitivity probe. More providers are unbuilt (Polar, WHOOP, Oura, Google Health).
40. **Code health and test strength.** `shared/engine/explainInputs.ts` is 4,023 lines. `median`
    is duplicated in at least five engine files. `planEngine.ts` and `replan.ts` import each other
    (uses are inside function bodies). The legacy `PUT /api/plan/sessions/:id` is still mounted
    (`server/routes/plan.ts:420`). `DISRUPTION_COLUMNS` is a hand-kept list defined at
    `server/services/replan.ts:360`. 47 of 120 `tests/api` files do not call
    `expectNoRefusedFetches`. The runner-keyed write scan misses OR shapes. A few engine tests
    assert conditionally. `ClimateCache` is never pruned. The predictions job records idle runs. A
    zstd request body is untried against the app. The Playwright image tag in `.github/workflows/ci.yml:86` needs a
    by-hand bump, which a CI step enforces. Fast finish, the easy part of strides and quality
    warm-ups go out as open steps. A real two-release shell update and iOS cache eviction are
    untried (the owner's http copy blocks the worker anyway). The fuel e2e depends on the plan
    holding an eligible run. The G5 lint misses inflected forms. Dark mode and real-device hand
    checks of the phase 3a pages are not done. The brief reading pass covered one live brief, and
    the replay into a throwaway database was never run. Revision dates are still cut in the
    device's day. Readiness and race-decision gates are not yet stored decisions. Research passes R1 to R5 are unchecked. The H2b
    simulator tuning and the Treff readings are open. A sign-out read in flight can still be kept
    after `purgeDeviceData()` (recorded in ADR 0012).
41. **Accepted limits, no action planned.** The non-production API limit; `computeReplan` does
    not await `ensureClimate`; the `webcal` scheme; `X-WR-TIMEZONE` in the feed; merge-style undo;
    the 14-day keep of owner edits; the explain weekly-decision query; unbounded lifetime Stats
    totals. The race plan models no late fade, so no end of the arrival range is ranked (#709); it
    waits on a pacing cohort, and the two papers it would rest on are not in the corpus.

## Environment notes

- An intervals.icu account goes dormant without a login; Garmin's official API is closed to new
  applicants (October 2026).
- Dependency policy: a security advisory on a runtime dependency is merged within 48 hours of its
  Dependabot PR going green, other grouped updates weekly, and a major version only by a deliberate
  decision; a red `npm audit` step in CI blocks until the advisory is addressed.
- `package.json` `overrides`: `minimatch` `^11.0.1` (#620) and `effect` `^3.22.1` (#803,
  GHSA-7589-6fvf-x4pw, a ReDoS in `Schema.TemplateLiteral`; `@prisma/config` pins `effect` at
  3.20.0 and `npm audit fix` offers only a downgrade to prisma 6.12.0). Drop the `effect` override
  once `@prisma/config` pins 3.22.1 or newer.
