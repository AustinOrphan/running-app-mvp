# Training engine — design

Status: Accepted 2026-10-22 on the owner's instruction to make the plan builder "use the
latest and greatest in research", adapt to recent and historical training, age, sex,
temperature, heart rate, intensity, speed, distance and duration, scale to 100 miles and
beyond, and learn from how each planned session actually went. Decisions are the builder's
unless marked **owner**.

The rules and numbers live in `research/engine-rules.md` (cited below as **[rules §x]**),
derived from the verified corpus in `research/` (285 papers, every DOI checked against
Crossref on 2026-10-22). This document decides architecture, data, flows and UI; it does
not restate numbers.

## 1. Intent

A plan engine a careful coach would trust: deterministic, explainable, conservative where
evidence is thin, and honest about which numbers are evidence and which are defaults. Every
prescription carries its reason and its evidence grade. It adapts every week to what the
runner actually did and how it felt, and every day only ever downgrades.

Goals:

1. **State from data** [rules §a]: load (EWMA 7/42), 30-day longest run by distance,
   duration, gain and descent, consistency and gaps, experience class, fitness (critical
   speed from best grade-adjusted efforts; personal exponent from races), efficiency index,
   durability descriptor, risk profile.
2. **Load per session** [rules §b]: sRPE primary; TRIMP only on qualified HR; never mix
   scales; divergence shown, never corrected.
3. **Zones** [rules §c]: three domains with anchor hierarchy and recorded source per
   boundary; HRmax prior from age; ranges, not points; updates only after three concordant
   observations.
4. **Goals** [rules §d]: distance, gain, loss, surface, date, start time, finish-first or
   time goal; feasibility labelled comfortable / tight / not reachable within default limits;
   race-day heat from forecast or climatology.
5. **Macro and micro** [rules §e, §f]: phases built backwards from race day; 3:1 or 2:1
   recovery cycles by flags; TID targets per phase; fixed blocks (strength, gut training,
   heat acclimation); day-level sessions placed by availability, spacing and long-run day.
6. **Safety limits** [rules §g, §h]: the session spike guard on distance, duration, gain and
   descent; weekly ramp soft 10% with a 30%-per-2-weeks ceiling; tightened profiles; never
   make up missed volume; ultra caps on time on feet and back-to-backs.
7. **Environment** [rules §i]: WBGT, heat penalties and training guidance, acclimation,
   grade-adjusted effort.
8. **Planned vs actual (owner, 2026-10-22).** Every completed activity is linked to the
   session it fulfils; the engine assesses completion, intensity and effort against
   expectation (HR at pace corrected for heat and grade, pace against target, RPE against the
   session's expected RPE, the "how did it feel" rating, pain) and feeds that into the weekly
   decision and zone updates.
9. **Adaptation** [rules §j]: weekly progress / hold / reduce from execution, completion,
   check-ins, efficiency, sleep and HRV; daily readiness downgrade-only; break restarts;
   fatigue escalation.
10. **Taper and race week** [rules §k]; **prediction with uncertainty** [rules §l], logged
    and back-tested.
11. **Red flags and disclaimer** [rules §n], on every plan.
12. **A living research base (owner, 2026-10-22):** the corpus ships in the repository with
    a schema test, a Crossref verification script, a research page in the app, and a project
    skill that tells future sessions how to add papers and re-derive rules.

Non-goals: LLM-generated sessions (an LLM may only write explanatory text, [rules G1]);
fitness-fatigue models driving the plan [rules G2]; responder labels; medical diagnosis;
altitude adjustment (no evidence retrieved).

Anti-goals: any rule that adds load on weak evidence; any copy that says "behind",
"missed", streaks or red states [rules G5]; a parameter in code that is not in the
parameter registry; a citation that is not in `research/papers/`.

## 2. Architecture

Pure TypeScript in `shared/engine/`, no I/O, deterministic for a given input and `today`.
The server gathers inputs, calls the engine, persists outputs.

```
shared/engine/
  params.ts       the parameter registry: every number in the rules, with grade and evidence ids
  types.ts        EngineInput, AthleteState, ZoneSet, GoalModel, PlanDraft, SessionSpec, ...
  athlete.ts      state estimation [§a]
  load.ts         per-activity load and daily series [§b]
  zones.ts        zones and anchors [§c]
  heat.ts         WBGT (Liljegren), penalties, training guidance, acclimation [§i]
  terrain.ts      Minetti cost and grade-adjusted pace [§i I11] (also used by file summaries)
  goal.ts         goal model, floors, feasibility, readiness notes [§d]
  macro.ts        phases, weekly targets, TID targets, blocks, taper [§e, §k, §h]
  sessions.ts     session library and prescriptions [§f table]
  micro.ts        week to days: placement, spacing, strength, back-to-backs [§f, §h]
  guards.ts       spike guard, ramp, never-make-up, ultra caps [§g, §h]
  execution.ts    session-activity matching and execution assessment (goal 8)
  readiness.ts    check-ins, HRV, sleep, red flags, fatigue states [§j, §n]
  adapt.ts        weekly decision and rolling re-plan [§j, G-6]
  predict.ts      race prediction with intervals [§l]
  checklist.ts    plan quality checklist run before publishing [G1]
  explain.ts      rationale lines from rule and parameter ids
  index.ts        buildPlan, replan, assessExecution, todayAdvice, predictRace
```

### 2.1 Parameter registry

`params.ts` exports `P`, an object of `Param` records:

```ts
interface Param<T = number> { id: string; value: T; range?: [T, T]; unit?: string
  grade: 'A' | 'B' | 'C' | 'D'; rule: string /* e.g. 'g-1' */; evidence: string[]; note?: string }
```

Every number the engine uses comes from `P`. A unit test loads `research/papers/*.json` and
fails if any `evidence` id is missing, and another fails if a grade D parameter has no
`note` saying it is a default. The UI's "why" drawer renders the param's rule, grade,
note and papers.

### 2.2 Engine input and output

```ts
interface EngineInput {
  today: string                       // runner's local date
  profile: AthleteProfile             // data foundation
  activities: Activity[]              // last 365 days, with summaries (hrHistogram, gapDistanceM,
                                      // decouplingPct, weather) and feedback (rpe, feel, pain)
  wellness: WellnessDay[]             // last 60 days, incl. check-in fields (3.2)
  reviews: WeeklyReview[]             // last 16 weeks
  goal: GoalModel                     // goal + race descriptors (3.1)
  forecast: HourlyWeather[] | null    // home, next 7 days
  raceClimate: { wbgtC: number; source: 'forecast' | 'climatology' } | null
  existing: { plan: PlanWithSessions | null }   // for re-plans: keeps the past
  options: { recoveryCycle?: '3:1' | '2:1'; strengthSessions?: 0 | 1 | 2; blockPeriodization?: boolean;
             tidModel?: 'pyramidal' | 'polarized' }
}
interface PlanDraft { weeks: WeekDraft[]; sessions: SessionSpec[]; feasibility: Feasibility;
  warnings: EngineWarning[]; checklist: ChecklistResult[]; prediction: Prediction | null;
  state: AthleteStateSummary; paramsVersion: string }
```

### 2.3 Session prescription

```ts
interface SessionSpec { date: string; order: number; kind: SessionKind; title: string
  durationMin: number; distanceM: number | null; gainM: number | null
  structure: Step[]                   // warm-up, reps, recoveries, cool-down; empty for steady runs
  target: { zone: 'z1' | 'z2' | 'z3' | 'race-pace' | 'strides' | 'strength' | 'rest'
    rpe: [number, number]; hr: [number, number] | null; paceSecPerKm: [number, number] | null
    heatNote: string | null }
  purpose: string; rules: string[]    // rule ids, resolved to params and papers by explain.ts
  flags: Array<'spike-warn' | 'override-required' | 'heat' | 'night' | 'fuel-practice' | 'b2b-day1'
    | 'b2b-day2' | 'downhill' | 'run-walk'> }
type SessionKind = 'easy' | 'recovery' | 'long' | 'long-fast-finish' | 'threshold' | 'intervals'
  | 'race-pace' | 'strides' | 'hills' | 'hike' | 'b2b' | 'strength' | 'mobility' | 'rest' | 'race' | 'cross'
```

Targets in HR and pace are computed from the zone set at generation and recomputed for
display from the current zone set, so zone updates propagate to future sessions.

## 3. Data model (one migration, `training_engine`)

### 3.1 Goal additions

`gainM Int?`, `lossM Int?`, `surface` (`road|trail|track|mixed`, default `road`),
`goalType` (`finish|time`, default `finish` for distances above 42.2 km, else `time`),
`targetTimeSec Int?`, `startTime String?` (HH:MM), `raceLat/raceLng Float?` (0.01°),
`supportLevel` (`aided|self`, default `aided`).

### 3.2 Check-in fields on `WellnessDay`

`fatigue`, `soreness`, `sleepQuality`, `mood`, `stress` (Int 1-5, 3 = normal), `illness`
Bool, `painScore` Int 0-10, `painArea` String?, `painFocalBone` Bool. One row per day; the
Today page asks for it (rules J2: subjective first).

### 3.3 New models

```
PlanSession   id, planId (cascade), weekStart, date, order, kind, title, durationMin,
              distanceM?, gainM?, structure (JSON), target (JSON), purpose, rules (JSON),
              flags (JSON), status ('planned'|'completed'|'partial'|'skipped'|'downgraded'|'moved'),
              activityId? (unique; SetNull on activity delete), linkSource? ('auto'|'owner'),
              execution (JSON?), original (JSON?, the prescription before a downgrade or move),
              updatedAt
PlanRevision  id, planId (cascade), createdAt, reason ('generate'|'weekly'|'review'|'owner'|'break'),
              summary, changes (JSON: [{ weekStart, field, from, to, rules }])
PredictionLog id, userId, goalId, createdAt, method, predictedSec, lowSec, highSec,
              inputs (JSON), actualSec?
Screening     id, userId, date, kind ('reds'), answers (JSON), flags Int
```

`Plan` gains `paramsVersion`, `feasibility` (JSON), `warnings` (JSON), `checklist` (JSON),
`options` (JSON). `PlanWeek` gains `tid` (JSON targets), `flags` (JSON: recovery, taper,
strength block, gut training, heat acclimation), `gainTargetM Int?`. Existing columns keep
their meaning; `generatorVersion` becomes 2. The old `shared/domain/plan.ts` stays for
version-1 plans and is no longer used to generate.

## 4. Planned vs actual (goal 8)

### 4.1 Matching

When an activity is stored or edited, and nightly for the last 7 days, `matchSessions`
links unlinked activities to unlinked planned sessions:

- Candidates: same date first, then ±1 day for sessions still `planned`.
- Compatibility: run and race activities match run session kinds; `hike` matches cross
  activities with subtype hike or walk; strength matches strength; cross matches cross.
- Score: `|ln(actualMin / plannedMin)|` plus 0.5 for an adjacent-day match; greedy lowest
  score per day; ties go to the earlier session order.
- An owner link (`linkSource 'owner'`) is never changed automatically; the owner can link,
  relink and unlink from the session or the activity.
- Unlinked activities still count fully as load.

### 4.2 Execution assessment

`assessExecution(session, activity, ctx)` returns:

```ts
interface ExecutionAssessment {
  completion: 'completed' | 'partial' | 'extended' | 'modified'   // duration ratio bands 0.8 / 1.2;
                                                                 // modified = different kind
  intensity: 'below' | 'on' | 'above' | 'unknown'                 // time in target zone, from the
                                                                 // HR histogram when HR qualifies
                                                                 // [rules B2], else GAP pace vs band
  effort: { score: -2 | -1 | 0 | 1 | 2 | null; confidence: 'high' | 'moderate' | 'low';
    parts: { rpeDelta: number | null; feel: number | null; hrResidualZ: number | null;
             paceResidualPct: number | null } }
  conditions: { wbgtC: number | null; heatAdjusted: boolean; gradeAdjusted: boolean }
  flags: Array<'pain' | 'focal-bone-pain' | 'heat' | 'hr-unqualified' | 'spike'>
  lines: string[]                                                 // plain-language summary
}
```

- **Expected RPE** per session kind is a parameter range (`P.expectedRpe.<kind>`, grade D,
  anchored on Borg mapping [rules C4, bok-2022-subjective-intensity]).
- **Expected HR at pace** comes from the athlete's own model: HR against grade-adjusted
  speed on steady runs over the last 8 weeks (the efficiency index, [rules A8]), with a heat
  term (prior from the heat topic, personalised by shrinkage [rules G3]). Fewer than 8
  qualifying runs → no HR residual (null), never a guess.
- **Effort score** combines, in this order of weight: RPE against expectation (subjective
  first, [rules J2]), the owner's feel rating, the HR residual (only when HR qualifies), the
  pace residual. Missing parts drop out; confidence reflects how many remain. Weights and
  bands are grade D parameters.
- **Pain** 4 or more, or `painFocalBone`, raises the matching red flag [rules §n] at once.

### 4.3 What it changes

- **Next quality session:** after an effort score of +2 (or +1 twice in a row) on quality
  sessions with no pain, the next quality session is trimmed (fewer reps or shorter) and
  marked `downgraded` with the reason. Never more than one trim per week.
- **Weekly decision** [rules J5]: execution feeds the signals: completion below 80% of
  planned minutes holds; persistent harder-than-expected effort counts as the subjective
  decline signal; easier-than-expected with a stable or rising efficiency index supports
  "progress" (still inside every limit in §g).
- **Zones** [rules C8]: three concordant observations of easier-than-expected effort at
  threshold or interval targets (or of HR consistently below the band at a given pace)
  produce a *proposed* zone update the owner confirms on the review page; harder-than-
  expected produces a proposal in the other direction. Zones never change silently.
- Nothing in execution ever adds a session or raises a weekly target above what the limits
  allow; missed sessions are never rescheduled [rules G-6].

## 5. Flows

- **Generate:** `POST /api/plan/generate { goalId, options }` gathers inputs, runs
  `buildPlan`, runs the checklist, persists plan, weeks, sessions and a `PlanRevision`
  ('generate'), logs the prediction. A failed checklist item blocks publishing with the
  reason (the request returns 422 with the checklist).
- **Store activity:** after the activity store writes, the server runs matching and the
  execution assessment for the linked session.
- **Today:** `GET /api/today` returns today's sessions with readiness advice (downgrade-only,
  [rules J3]), the forecast-based heat note and best cooler hour [rules I7], unrated recent
  activities, check-in status and active red flags.
- **Weekly re-plan:** on review save, on owner request and every Monday 03:00 local by the
  scheduler: `replan(existingPlan, state)` keeps the past and the current week's completed
  sessions, recomputes future weeks from the updated state within all limits, and writes a
  `PlanRevision` with per-week changes and rule ids. Breaks of 7 days or more apply the
  restart table [rules J7].
- **Review page:** shows the weekly decision with its signals, execution summaries, zone
  proposals to accept or decline, and the next-week target (the owner's final say stays, as
  today, bounded by the limits).
- **Screening:** a short REDs screen at onboarding and every 12 weeks [rules §n.4].

## 6. API

```
POST /api/plan/generate                { goalId, options? } -> PlanWithSessions | 422 { checklist }
GET  /api/plan                         active plan with weeks, sessions, feasibility, warnings
POST /api/plan/replan                  -> PlanRevision
GET  /api/plan/revisions               PlanRevision[]
PUT  /api/plan/sessions/:id            owner edits (move date, swap kind within week, skip) -> PlanSession
POST /api/plan/sessions/:id/link       { activityId | null } -> PlanSession
GET  /api/today                        TodayView
GET/PUT /api/checkins/:date            check-in fields on WellnessDay
GET  /api/zones                        ZoneSet with sources; GET /api/zones/proposals; POST .../:id/accept|decline
GET  /api/predictions?goalId           latest Prediction + log
GET/POST /api/screenings               REDs screen
GET  /api/research/params              the parameter registry (for the why drawer)
```

The research corpus is bundled into the web build at build time (`import.meta.glob` over
`research/papers/*.json` and `research/topics/*.md`, lazily loaded on the Research page and
the why drawer), so no API is needed for papers.

## 7. Web

- **Today:** today's session card (prescription in pace, HR and RPE; purpose; why), readiness
  advice, heat note, check-in card, "How did it go?" card, red-flag banners, disclaimer link.
- **Plan:** week rows (existing) expand to day cards; each session opens a sheet with the
  prescription, its rules and evidence grades, the linked activity and the execution
  assessment, plus relink, move and skip. Feasibility, warnings, checklist and "What
  changed" (revisions) live at the top.
- **Goals:** the new descriptors, feasibility label, prediction with its range and method,
  race-day heat.
- **Review:** the weekly decision with signals, zone proposals, execution summaries.
- **Research:** topics, rules with grades, papers with findings and DOI links; filter by
  grade; the same drawer component serves every "why".
- **Profile:** adds risk-profile fields (BSI history, REDs screen entry point) and shows the
  current zone set with each boundary's source.

## 8. Living research base

- `research/` holds `papers/*.json`, `topics/*.md`, `rules/*.json`, `engine-rules.md` and
  `README.md` (method, grading, verification, how to extend).
- `research/tools/` keeps the corpus workflow script and the writer used to build it.
- `npm run research:check` validates every paper against a zod schema and checks that every
  id cited in `rules/`, `engine-rules.md` and `shared/engine/params.ts` exists (offline, in
  CI). `npm run research:verify` re-checks DOIs against Crossref (online, manual).
- `.claude/skills/research-update/SKILL.md` tells future sessions how to add a topic or
  paper, verify it, regenerate syntheses, update `engine-rules.md` and `params.ts`, and run
  both checks.

## 9. Validation

- Unit tests per module with the rules' exact numbers.
- A **plan matrix** test generates plans for synthetic athletes (novice 5 km, recreational
  half, time-goal marathon, 50 km trail, first 100-mile, masters, returning after 6 weeks off,
  prior bone stress injury, hot race) and asserts every limit holds in every week: spike
  guard on distance, duration, gain and descent; ramp; Z1 floor; recovery cadence; strictly
  decreasing taper; ultra caps; no session on unavailable days; spacing rules.
- A **local validation** against the owner's own history (in the job directory, never
  committed): generate the owner's 100-mile plan and review it by hand against the
  spreadsheet plan the owner already built.
- E2E: generate, see today's session, log the matching activity, see the execution
  assessment, save a review, see the re-plan's "What changed".

## 9.1 Left to the builders

WBGT implementation details within the Liljegren method; chart choices; component layout;
exact copy within the tone rules.

## 10. Decisions made during the build (for the owner to confirm)

Each was a builder call made while validating plans against a real, sparse history; each is
a grade D default in `shared/engine/params` unless stated.

1. **Restart floor.** A runner below three 20-minute sessions a week who has run at least 20
   minutes in the last 90 days restarts at 3 × 20 minutes; that floor week is exempt from
   the weekly ramp (G-2 governs growth from an established base) but not from the session
   spike guard. Tightened injury profiles get no floor.
2. **Generated runs stay in the normal band.** The generator plans every run at or below 1.10×
   the projected 30-day maximum on duration, distance, gain and descent; the 1.10-2.00× warn
   band is reachable only by the owner's own edits. Planning and checking share one limit
   module (`shared/engine/limits.ts`), so a generated plan needs no trimming.
3. **Baselines.** Recovery, taper and the part current week never lower a ramp baseline; when
   every week of the 2-week window is one of those, the baseline looks back up to 6 weeks to
   the last loading week. The restart floor week counts at its floor minutes.
4. **Post-race.** After 100 km or more: a week without running, then one week at 25% of the
   pre-taper peak; a new plan after the race restarts from the J7 table.
5. **Ultra feasibility target.** Feasibility measures the longest single run against 180 min
   (50 km), 240 min (100 km and 100 miles) or 270 min (beyond), capped by H2; back-to-backs
   add time on feet beyond it.
6. **Run length cap follows the long run.** No run is placed longer than the week's long run,
   so a very high-volume 5 km runner (above 6 days × the 60-minute 5 km long-run default) is
   held at that product; raise `peakLongRunMin.5k` if that is too low.
7. **No guessed trims.** An effort score with no RPE and no feel is capped at ±1 and never
   triggers a session trim or a zone proposal.
8. **Multi-day files.** Activities up to 240 hours parse (200-mile races); longer files are
   rejected as corrupt.
