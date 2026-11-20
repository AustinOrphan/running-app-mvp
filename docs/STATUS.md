# Status

Current state only; rewritten at every boundary. History lives in `git log`, the specs and
plans under `docs/superpowers/`, the research corpus under `research/` and `docs/adr/`.

Last update: 2026-11-20.

## Waiting on the owner (2026-11-20)

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
4. **Tag the first beta.** In the live checkout: move `prisma/dev.db` and `prisma/prisma` to
   `~/running-log-old-dbs/`, `git pull`, run `npm run release -- 2.0.0-beta.1`, then run the two
   git commands printed in `release-notes/v2.0.0-beta.1.md`. Default: untagged; `v1.0.0` is the
   latest release tag.
5. **Beta gate (D2).** Invite testers only after the move, with the off-site backups on, the data
   notice shown and the network change applied. Default: no invitations.
6. **Enable branch protection.** Require the `ci` and `analyze` checks on main (the API answers
   404, not protected, on 2026-11-19). Default: unprotected, although `CLAUDE.md` says the `ci`
   job is the one check that branch protection reads.
7. **Strava policy choices.** Decide whether to drop the stored coarse start point
   (`server/providers/strava.ts:361,375-376`, Policy 5.7) or keep it for non-Strava use only, and
   settle the 7-day cache (6.2) and the no-AI-read rule (5.3). Default: the start point is stored
   (coarsened), and live-database reads skip Strava rows.
8. **Accept the proposed ADRs.** ADR 0024 (place search), 0025 (Strava per-runner apps) and 0026
   (work follows events) are built and merged but still read Proposed. Default: they stay Proposed.
9. **Engine values awaiting a call.** Pending: RU2, whether the ADR 0013 rebuild ceiling or weeks
   run may lift the class-peak ceiling (more load on grade D); the K2 marathon final week (36%
   against 46-54%; a 100-mile taper uses the 2-week row [0.65, 0.4], so the owner's race is
   unaffected); the P2 extension past the half-marathon; RU1b's eight findings and whether
   `f8.e1rmDivisor` stays 30; the P4 "no load" sentence in `engine-rules` (p); the strength wave-0
   questions (calf A/B alternation at `shared/engine/strength.ts:288`, bodyweight movements at no
   added load, a 40 vs 25 min lighter week); the five smallest-reading assumptions; the L3d
   confirmation. Default: the shipped values stand.
10. **Sources and readings.** Photograph into `data/sources/` (ignored by Git): Koop 2nd ed.,
    Daniels 4th, Run Less Run Faster 3rd, Lydiard and Gilmour 1997, Pfitzinger 4th. Collect the
    papers with no legal full text (Warden 2014, Doherty 2020, Keogh 2016, Mountjoy 2023 with its
    correction, Bourdon 2017, Ely 2007, the Tyler 2016 erratum). Read the Higdon advanced 5K page.
    Default: the rules keep their grades, and the 4 records stay in `PREDATES_RUBRIC`.
11. **Strength setup and bar.** Enter the equipment, lifting level and weight unit, then judge the
    spec 1.4 bar after a month of use. A rest timer and a plate calculator are built only if the
    bar fails. Default: generic setup, nothing built.
12. **Small optional decisions.** Folder scan: a file watch once the sftp drop exists (default:
    5-minute scan, `shared/limits.ts:27`). Restore in a week with no weekly update (default: as
    is, #799). Owner replay figures into spec 5.6 (recommendation: no; the public repository holds
    none). VoiceOver pass (default: axe scan only). Apple Watch companion spike Task 1 in Xcode
    (default: nothing built).

## Where things stand

- `main` is at 7f653392 (#801), 2026-11-19. `PARAMS_VERSION` is `2026-11-18.2`
  (`shared/engine/params/index.ts:24`). The research corpus holds 469 records in
  `research/papers`.
- The app version is 2.0.0-beta.1 (`package.json:3`, #793). The latest release tag is `v1.0.0`,
  so the beta tag is not made.
- ADRs run to 0026. 0021 (companion) is not written. 0022 and 0023 are Accepted; 0024, 0025 and
  0026 read Proposed.
- The live copy runs on the laptop over http `.local`. The home-server move and the beta
  invitations are not done. Branch protection on main is off.
- Recent rounds, by PR range (the PRs and `git log` hold the detail):
  - #740 to #754 (2026-11-16): per-runner days (D10, ADR 0022) and the road race plan (D11,
    ADR 0023).
  - #755 to #769 (2026-11-17): zone fixes, place search for the home and race place (ADR 0024),
    Race and Plan wording and links, dismissible update cards, the easy ceiling on My paces, a
    rest offer after pain on a long day, what held each week, long-run climb by the course, the
    session cookie renewed up to 120 days, feel and pain asked on watch-rated runs.
  - #770 to #780 (2026-11-18): temporary-password reset and API gate (PW1), RU2 rule texts, hike
    practice cue, one prediction format, the true data notice (DN1), error references, release
    identity and script, the HR-quality line, race heat unknown, which source to use, Today's
    first action with no plan.
  - #781 to #791 (2026-11-18): cooling and gut papers, night start-by time, pre-restore prune,
    the race card's "When it gets hard", own answers on What the plan can see, the brief's first
    back-to-back, night or downhill session, cooling line, gut referral, rehearse script and
    restore drill, downhill lead (DL1), Strava deletion (SC1, ADR 0025).
  - #792 to #796 (2026-11-19): minus and colon keyboards, the 2.0.0-beta.1 version, strength
    pairing by date and once at start, manual merge of two entries.
  - #797 to #801 (2026-11-19): polls to events (ADR 0026). Terrain, HR quality, track and surface
    run as start passes and on edit; watch ratings and track streams follow the hourly sync; the
    weekly catch-up runs at start; publish runs on change.
- Timers left in the scheduler: sync hourly, folder every 5 minutes, weather every 10 minutes,
  predictions every 6 hours, plus the daily slots (`server/jobs/scheduler.ts:1119-1229`).
- Off-host backup bound in code: 29 snapshots (`server/services/backup.ts:57`). The restic job is
  in the private homelab repository and still keeps 30.
- Earlier STATUS text, with the wave and phase reviews, is in `git show 7f653392:docs/STATUS.md`.

## Open follow-ups (none blocks a merge)

Ranked by weight for the first 100-mile build (race 2027-06-12), then for beta readiness.

1. **Live copy on the laptop.** The hourly sync, the Monday re-plan, the calendar publish and the
   02:00 backup stop whenever the laptop sleeps. The cutover steps are in the private homelab
   runbook: stop and back up, deploy and set the secret, copy the backup in, restore, verify,
   re-add the phone clients, retire the laptop copy. Beta invitations wait for it (D2).
2. **Off-host backups.** Only the app's own daily copies exist, on the same disk as the database.
   The app side is done (`OFF_HOST_SNAPSHOT_DAYS = 29`). Still open: the sftp machine is named at
   the move, and the homelab restic job goes from 30 to 29 daily snapshots and reads only the
   newest `app-*.db`.
3. **Workout delivery on the real watch is unconfirmed.** Unchecked: the three FIT files on the
   watch (manufacturer 255, repeat steps, string caps, hike sent as running); one live
   intervals.icu publish (sport-settings field names, percent-pace steps, the 40 bpm floor,
   `external_id` and date change by PUT); a calendar app on the webcal link; which Garmin model
   the help text names (Q6). Until then "On your watch" is an inference.
4. **Race simulation opt-in (H2) is not built.** The opt-in 8 h simulation, no later than 3 weeks
   before race day, is design intent. `h2.raceSimulationMaxHours`
   (`shared/engine/params/h-ultra.ts:81`) has no reader; only `h2.longestRunCapHours` is read
   (`shared/engine/goal.ts:367`). It must exist before about 2027-05-22 to be used.
5. **Race fuel rate has no duration floor.** `raceFuelFor` (`shared/engine/fuel.ts:546`) takes the
   tolerated rung of the ladder whatever the length of the runs that showed it, so a 2 h run
   counts like a 6 h run. A floor that can only lower the rate was proposed on 2026-11-12 and left
   out because it changes plan output (`PARAMS_VERSION` bump, `plan:report` delta).
6. **Blank page after tapping Done on Today.** Seen once (iOS Safari PWA, 2026-11-11), no known
   cause, not reproduced in headless Chromium. Error boundaries (#705), window error reports
   (#713) and the feedback note (#714) capture the next occurrence. No recurrence is recorded.
7. **A re-plan after a hold can place sessions under 80% of target.** On one replayed chain this
   affected 25 of 57 future weeks. On the replayed real history it happened on four Mondays: two
   were returns from a layoff, and on the other two the re-plan opens on a restart-floor week
   that the hold cap cuts below the floor. The hold cap on a floor week is the candidate cause,
   not traced to a line (restart floor handling near `shared/engine/index.ts:666,1097`). The
   same happens at Steady.
8. **G-1 can cap every run of a week.** With a short 30-day reference, G-1
   (`shared/engine/macro.ts`, `P.g1.windowDays`) can hold every run of a week at one cap, so the
   weekly target is not placed and a plan with a larger target can get a shorter long run than
   Steady's. Seen on a real history; no committed case. The same happens at Steady.
9. **`afterBreak` stacking and plan movement after a long hold.** `afterBreak`
   (`shared/engine/adapt.ts:782`) still applies on the second Monday after an illness (a
   half-marathon first full week drops from 193 to 129). After a long hold the macrocycle
   restarts from the typical week on one Monday and carries on from the stored plan on the next
   (hot-race 14 days: 248, 238, 319).
10. **A mid-week 3-day window can lower later weeks of a ramp-limited plan** by about 10% until
    the next Monday re-plan. Not reproduced on main; no fix commit is found.
11. **Entered B and C races: narrowed check, no browser check.** After an entered race's day the
    minutes check of a re-plan is narrowed. The Plan page with an entered race was not checked in
    a browser, and an A-priority goal other than the plan's own is not read (#731). The
    12-athlete probe found no failure; no e2e spec covers an entered race on the Plan page.
12. **Strength logging is not checked on a phone in a gym.** No real strength session has been
    logged on the owner's phone, online or offline. `17-offline.spec.ts` cuts the connection in a
    desktop browser only.
13. **Beta tag.** `package.json:3` is `2.0.0-beta.1` but the latest release tag is `v1.0.0`; the
    steps are owner item 4. Later betas count up with each tester-facing update. Testers' release
    identity (#776) reads the tag.
14. **Strava start point and policy questions.** `server/providers/strava.ts:361,375-376` reads
    `start_latlng` and stores it coarsened (`coarse()`) as `startLat` and `startLng`; Policy 5.7
    restricts storing location. The precision stored should be stated when this is decided. The
    7-day cache (6.2) and the no-AI-read rule (5.3) are separate and undecided. ADR 0025 is
    Proposed 2026-11-18.
15. **Branch protection is off on main.** `gh api` answers 404 "Branch not protected" and the
    rulesets list is empty (2026-11-19). The fix is to require `ci` (`ci.yml`) and `analyze`
    (`codeql.yml`); `CLAUDE.md` then reads true.
16. **Invited-account flow not tried on a phone over HTTPS.** Create-user, the temporary password
    and the PW1 gate `auth.password-change-required` (`server/auth/middleware.ts:62`) were tried
    in Chromium only (`tests/e2e/38-invited-account.spec.ts`), with no phone, HTTPS or proxy.
17. **delete-user leaves data in backups, free pages and published events.** The user's rows stay
    in the daily copies until pruned (`server/services/backup.ts`), and pre-migrate and
    pre-restore copies stay after 29 days except the newest 3 of each kind. They also stay in the
    live file's free pages until VACUUM, and in intervals.icu calendar events the publisher wrote
    (#711). The README data notice states the bound.
18. **The access log writes the OAuth callback code and state.** Only the calendar feed token is
    redacted (`server/app.ts:113`, `redactedRequest` in `server/routes/calendar.ts:39-46`).
    `/api/integrations/:provider/callback` is logged with its `code` and `state`; the code is
    spent and the state signed by then, so the risk is low. Redacting both is a small change.
19. **A failed climate refresh bumps the data version.** `ClimateCache` is a state model
    (`server/dataVersion.ts:47`) and a failed refresh writes `failedAt` and `lastError` to it
    (`server/services/weatherCache.ts:544-548`), so every failure drops every memo. Moving those
    columns off the state table needs a schema change. `ForecastCache` is non-state, so its
    failure write is harmless.
20. **The brief says "no key session this week" after the first key session has passed,** even
    when a later one remains (`shared/copy/briefTemplates.ts:248-252`). The line also draws
    nothing offline, and Open the brief can clip in the two-line clamp.
21. **Goals reads "1:45" as minutes and seconds.** `parseTime`
    (`web/components/goalFormat.ts:28-32`) reads "m:ss" for two parts, so "1:45" is 105 s. Only
    h:mm:ss reads as hours.
22. **The Apple Health push skips the import's range checks.** `server/providers/appleHealth.ts:34`
    checks only that a number is finite, while the parsed import applies range checks. Not compared
    field by field; check whether a later write validates before fixing.
23. **Watch rating is not refreshed after the first ask.** A run is asked for its intervals.icu
    rating once after the sync that imported it and again at the next hourly sync
    (`runWatchRatingPass`, `server/jobs/scheduler.ts:320-330`), then never, so a later change in
    intervals.icu is not picked up. A stored standout and the execution assessments are not
    recomputed when the spread check first passes. The three spread thresholds are defaults.
24. **The track-record memo reads non-state `PredictionLog`.** `server/services/trackRecord.ts:31,41`
    reads it (non-state, `server/dataVersion.ts:79`), so the memo is sound only while no
    prediction is logged after a result is recorded. `PredictionLog` moves to `STATE_MODELS` in
    the PR where the engine or the snapshot first reads it.
25. **A kept raised week target carries no progression warning.** The checklist
    (`shared/engine/checklist.ts:228`) is built from the engine draft and never sees the kept
    figure (`targetKept`, `server/services/replan.ts:136-178`). The diff and the Plan page do show
    the figure. Applies only when the runner raises a week by hand.
26. **A5 low-frequency flag at a high start level.** `lowFrequencyOf`
    (`shared/engine/athlete.ts:564`) arms at a start level over 60 min with fewer than two runs a
    week. It keeps the 2:1 cadence and the time step (`shared/engine/limits.ts:309`) and, since
    #579, no longer holds the load setting. The other options of the proposal stay open.
27. **Repeated re-plans of one rest window drift slightly.** About 39 of 576 seeded window
    combinations (2026-10-23 count, not rerun) drift between re-plans, because a reduced week
    placed under its target feeds the next baseline.
28. **Simulator fixed point and pinned preset cases.** Pinned as `test.fails`: a re-plan with
    nothing new is not a fixed point in the first week of a start path or in a held week a window
    touches (`tests/unit/engine/sim-athlete.test.ts:1035`). Under longer-base, a window-touched
    week stays at 252 against the default's 243 (`preset-chains.test.ts:530`, `holdWeek` at
    `shared/engine/index.ts:441`). Three half-marathon cases with a 21-day hold sit at 91-92% of
    bound (`disruption-integration.test.ts:1227-1231`). In the ragged chains a first-100-mile
    runner collapsed to 0-30 min a week fails the taper item at 4 of 29 steps. `plan-metrics.ts`
    reads a window's part week as the G-2 baseline, so some sweep minima are report artefacts.
29. **Post-race plan restarts the strength block, with other post-race edges.** The plan drawn
    after a post-race window passes `existing: null` (`shared/engine/macro.ts:1892`), so
    `pastStrengthBlock` finds no block and starts a fresh one. Strength stays at 0 through the
    window (`shared/engine/postRace.ts:660`). The first-finish modifier applies to a runner with
    no race history. The new-plan trigger uses the D1 class while G-1 uses the literal 42,195 m.
30. **Compact banner, fold and 125% text layout.** The compact disruption banner's buttons are
    26 px tall, below common touch-target guidance, and every action previews first. The
    rest-window offer may be read twice in browse mode. Today may scroll sideways at 125% text
    from the hidden chart table. With three readiness signals, Done falls past the 788 px fold at
    390x844 and behind the tab bar at 360x740, and the fold assertions do not subtract the tab
    bar. None of this is verified in a browser on main.
31. **The Today preview payload arms no rollover timer.** `useServerToday`
    (`web/api/today.ts:78-102`) arms none for a preview payload, so a preview that becomes today's
    copy waits for the next focus or reconnect. Explain offline still waits out its retries. The
    sync-paused and weekly-update health notes in kept Today copy may be stale.
32. **Revision and fuel form gaps.** State-driven updates show no per-session Why in
    `RevisionDiff`. The undo-reason copy differs from the examples in spec 8.6. The fuel "opens
    after" hint can understate what the server allows, and focus drops to the page after a fuel
    settings save. A fuel-log item whose product was edited loses its product link on the next
    edit. An undo after a `PARAMS_VERSION` bump shows "Drawn under updated plan rules"
    (`shared/copy/revision.ts:629`) although its rows are the restored ones.
33. **Climb note and eased easy runs.** The climb note fires on every run of a climbing week,
    because the planner spreads gain over every run kind. An eased easy run keeps its original
    `gainM`, and `easedSession` gives one cause for every easy downgrade. Not rechecked on main.
34. **An engine trim of a future session may write a plan row outside any revision,** so a later
    undo can read it as an edit and refuse (the refusal names the row). The trimmed session is
    stored without its untrimmed version (`PlanSession.trimmed` is a flag only). Not rechecked in
    code.
35. **`RUN_CAP_MAX_MIN` and the trim predicates.** `RUN_CAP_MAX_MIN = 240`
    (`shared/engine/disruption.ts:31`) is documented as an input bound of the form, not a rule;
    whether the every-number-is-a-Param rule covers it is a judgement call.
    `shared/engine/index.ts:296-305` keeps its own `isTrim` and `isHoldTrimRow` beside
    `isTrimmed()`.
36. **Small engine gaps for other runners.** Not offered or not built: a declared longest run
    (A3; no profile field); n1 walk-jog stages after a bone stress injury (only `n1.bsiReturnDays`
    exists); widening the prediction range during a rest window; moves across weeks
    (`shared/engine/adjust.ts:9`); open-ended windows (`j9.maxWindowDays`); an automatic follow of
    the device zone (ADR 0022: the runner changes the profile zone). The sleep-efficiency signal
    needs time in bed, which only Apple Health supplies (#739). A novice 5 km goal 12 weeks out
    reads "not reachable" although the plan still builds. Contrived re-plans with completions that
    have no activity can collapse to zero-minute weeks (19 of 2,310 fuzzed); no real path
    produces that input.
37. **Low-weight follow-ups.** `useWellness` (`web/api/wellness.ts`) has no consumer. Stats charts
    stop at 12 weeks (`StatsPage.tsx:21`). The Warning signs page has no offline test, and the
    feedback clipboard fallback is untried in iOS Safari. The downhill cue shows on the session
    sheet only (`SessionSheet.tsx:75`), and "heavy" has no metre dose. The own easy ceiling reads
    nested refits and has no e2e spec. The first-hot-days hold can answer 409 stale-preview after
    a forecast refresh, by design. Time in bed was tried on synthetic fixtures only. The axe scan
    covers seeded states only and keeps one known 3.24:1 violation
    (`42-axe-scan.spec.ts:68-70`). The survivors of the 2026-11-01 audit are unchecked: E18
    reminders, CI time, nine over-graded Params, Steps on Today, the after-run verdict, the
    sensitivity probe. More providers are unbuilt (Polar, WHOOP, Oura, Google Health).
38. **Code health and test strength.** `shared/engine/explainInputs.ts` is 4,023 lines. `median`
    is duplicated in at least five engine files. `planEngine.ts` and `replan.ts` import each other
    (uses are inside function bodies). The legacy `PUT /api/plan/sessions/:id` is still mounted
    (`server/routes/plan.ts:420`). `DISRUPTION_COLUMNS` is a hand-kept list defined at
    `server/services/replan.ts:360`. 46 of 120 `tests/api` files do not call
    `expectNoRefusedFetches`. The runner-keyed write scan misses OR shapes. A few engine tests
    assert conditionally. `ClimateCache` is never pruned. The predictions job records idle runs. A
    zstd request body is untried against the app. The Playwright image tag in `ci.yml:86` needs a
    by-hand bump, which a CI step enforces. Fast finish, the easy part of strides and quality
    warm-ups go out as open steps. A real two-release shell update and iOS cache eviction are
    untried (the owner's http copy blocks the worker anyway). The fuel e2e depends on the plan
    holding an eligible run. The G5 lint misses inflected forms.

## Environment notes

- Bare repository with worktrees. Isolated agent worktrees branch from `origin/main` and have no
  `node_modules`; agents run `npm ci` first.
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
