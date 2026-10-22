# Training engine — implementation plan

> For agentic workers: one task per engineer, own worktree, test first. Read
> `docs/superpowers/specs/2026-10-22-training-engine-design.md`, the sections of
> `research/engine-rules.md` your task cites, `CLAUDE.md`, the **Global constraints** and
> **Shared contract** below, and your own task. Numbers come from `research/engine-rules.md`
> through the parameter registry; never type a rule number into module code.

**Base branch:** `feat/evidence-engine`. Groups in order; tasks inside a group in parallel.

## Global constraints

- Everything in `shared/engine/` is pure: no I/O, no `Date.now()`, no randomness; `today`
  arrives in the input. Same input, same output.
- Every number used by engine code is a `Param` from `shared/engine/params/`. A task may add
  parameters only to its own section file(s) (listed in its Files). Grade D parameters carry
  a `note` that says they are defaults. Evidence ids must exist in `research/papers/`.
- Copy follows the tone rules [rules G5]: no "behind", "missed", streaks, red states; never
  claim a limit prevents injury.
- Engine output never adds load from a readiness signal, never reschedules missed sessions,
  never exceeds a limit silently (a limit hit yields a warning with rule ids).
- Only Task E1 edits `prisma/`, `shared/types.ts`, `shared/engine/types.ts`,
  `server/app.ts`, `web/App.tsx`, `web/api/*.ts`, `package.json`.
- Fixtures synthetic. The owner's real history is never committed.

## Shared contract (E1 writes `shared/engine/types.ts`; frozen afterwards)

```ts
export type Grade = 'A' | 'B' | 'C' | 'D'
export interface Param<T = number> { id: string; value: T; range?: [T, T]; unit?: string
  grade: Grade; rule: string; evidence: string[]; note?: string }
export interface EngineWarning { code: string; severity: 'info' | 'warn' | 'hold'; message: string; rules: string[] }
export type PhaseV2 = 'base' | 'build' | 'specific' | 'taper' | 'race'
export type SessionKind = 'easy' | 'recovery' | 'long' | 'long-fast-finish' | 'threshold' | 'intervals'
  | 'race-pace' | 'strides' | 'hills' | 'hike' | 'b2b' | 'strength' | 'mobility' | 'rest' | 'race' | 'cross'
export interface Step { kind: 'warmup' | 'work' | 'recover' | 'cooldown' | 'steady'; reps: number
  durationSec: number | null; distanceM: number | null; zone: ZoneKey }
export type ZoneKey = 'z1' | 'z2' | 'z3' | 'race-pace' | 'strides' | 'strength' | 'rest'
export interface SessionTarget { zone: ZoneKey; rpe: [number, number]; hr: [number, number] | null
  paceSecPerKm: [number, number] | null; heatNote: string | null }
export type SessionFlag = 'spike-warn' | 'override-required' | 'heat' | 'night' | 'fuel-practice'
  | 'b2b-day1' | 'b2b-day2' | 'downhill' | 'run-walk'
export interface SessionSpec { date: string; order: number; kind: SessionKind; title: string
  durationMin: number; distanceM: number | null; gainM: number | null; structure: Step[]
  target: SessionTarget; purpose: string; rules: string[]; flags: SessionFlag[] }
export interface Boundary { value: number; band: [number, number]
  source: 'tested' | 'cs' | 'dfa' | 'rpe' | 'hrmax-observed' | 'hrmax-age' | 'hrr' | 'profile'; asOf: string }
export interface ZoneSet { hrMax: Boundary | null; hrRest: number | null; lt1Hr: Boundary | null
  lt2Hr: Boundary | null; csMps: Boundary | null; lt1PaceSecPerKm: Boundary | null
  thresholdPaceSecPerKm: Boundary | null
  hr: Record<'z1' | 'z2' | 'z3', [number, number]> | null
  pace: Record<'z1' | 'z2' | 'z3', [number, number]> | null       // sec/km, slow..fast
  rpe: Record<'z1' | 'z2' | 'z3', [number, number]> }            // CR-10
export interface AthleteState {
  asOf: string; age: number | null; sex: 'female' | 'male' | 'unspecified' | null
  experience: 'novice' | 'returning' | 'recreational' | 'trained'; yearsRunning: number | null
  load: { metric: 'srpe' | 'trimp' | 'minutes'; acute: number; chronic: number
    daily: Array<{ date: string; load: number }> }
  weeks: WeekRow[]                       // last 16 Mondays, oldest first (shared/domain/weeks)
  typicalWeekMin: number                 // median run minutes of the last 4 weeks with a run
  longest30d: { distanceM: number; durationSec: number; gainM: number; lossM: number; twoDaySec: number }
  gaps16w: number; layoffDays: number; lastRunDate: string | null
  fitness: { csMps: number | null; dPrimeM: number | null; csEfforts: number
    exponent: number | null; races: Array<{ date: string; distanceM: number; timeSec: number }>
    vo2maxTrend: number | null }
  efficiency: { current: number | null; trendPct: number | null; samples: number }
  durability: { decouplingMedianPct: number | null; samples: number }
  risk: { recentInjury: boolean; priorBsi: boolean; bsiFactors: number; redsFlags: number; noviceFlags: string[] }
  heatAcclimation: number                // 0..1 credit
}
export interface GoalModel { goalId: string; name: string; date: string; distanceM: number
  gainM: number; lossM: number; surface: 'road' | 'trail' | 'track' | 'mixed'; goalType: 'finish' | 'time'
  targetTimeSec: number | null; startTime: string | null; isUltra: boolean
  distanceClass: '5k' | '10k' | 'half' | 'marathon' | 'ultra50' | 'ultra100k' | 'ultra100mi' | 'beyond'
  expectedDurationSec: number; crossesDarkness: boolean; raceWbgtC: number | null }
export interface Feasibility { label: 'comfortable' | 'tight' | 'not-reachable'; weeksNeeded: number
  weeksAvailable: number; notes: EngineWarning[] }
export interface WeekDraft { weekStart: string; index: number; phase: PhaseV2; focus: string
  targetRunMin: number; longRunMin: number; longRunM: number | null; gainTargetM: number | null
  runDays: number; qualitySessions: number; strengthSessions: number
  tid: { z1: number; z2: number; z3: number }; flags: string[]; isRecovery: boolean; isTaper: boolean }
export interface ChecklistResult { id: string; ok: boolean; detail: string; rules: string[] }
export interface Prediction { method: string; predictedSec: number; lowSec: number; highSec: number
  conditions: string[]; rules: string[] }
export interface PlanDraft { weeks: WeekDraft[]; sessions: SessionSpec[]; feasibility: Feasibility
  warnings: EngineWarning[]; checklist: ChecklistResult[]; prediction: Prediction | null
  zones: ZoneSet; paramsVersion: string }
export interface Checkin { date: string; fatigue: number | null; soreness: number | null; sleepQuality: number | null
  mood: number | null; stress: number | null; illness: boolean; painScore: number | null
  painArea: string | null; painFocalBone: boolean }
export interface ReadinessSnapshot { date: string; checkin: Checkin | null
  hrv: { readings: number; latest: number | null; baselineMean: number | null; baselineSd: number | null; flag: boolean }
  restingHrFlag: boolean; sleepAvgH: number | null; sleepFlag: boolean
  state: 'normal' | 'possible-fatigue' | 'persistent-suppression'
  redFlags: Array<{ code: string; message: string; rules: string[] }> }
export interface ExecutionAssessment { completion: 'completed' | 'partial' | 'extended' | 'modified'
  intensity: 'below' | 'on' | 'above' | 'unknown'
  effort: { score: -2 | -1 | 0 | 1 | 2 | null; confidence: 'high' | 'moderate' | 'low'
    parts: { rpeDelta: number | null; feel: number | null; hrResidualZ: number | null; paceResidualPct: number | null } }
  conditions: { wbgtC: number | null; heatAdjusted: boolean; gradeAdjusted: boolean }
  flags: Array<'pain' | 'focal-bone-pain' | 'heat' | 'hr-unqualified' | 'spike'>; lines: string[] }
export interface WeeklyDecision { decision: 'progress' | 'hold' | 'reduce'
  signals: Array<{ code: string; detail: string; rules: string[] }>; nextWeekTargetMin: number }
export interface ZoneProposal { boundary: 'cs' | 'lt1Pace' | 'thresholdPace' | 'lt1Hr' | 'hrMax'
  from: number; to: number; observations: number; reason: string; rules: string[] }
export interface PlanChange { weekStart: string; field: string; from: unknown; to: unknown; rules: string[] }
export interface EngineInput { today: string; profile: AthleteProfile; activities: Activity[]
  wellness: (WellnessDay & Partial<Checkin>)[]; reviews: WeeklyReview[]; goal: GoalModel
  forecast: Array<{ time: string; tempC: number; dewPointC: number; humidityPct: number; windKph: number;
    shortwaveWm2?: number }> | null
  existing: { weeks: WeekDraft[]; sessions: Array<SessionSpec & { id: string; status: string;
    activityId: string | null }> } | null
  options: { recoveryCycle?: '3:1' | '2:1'; strengthSessions?: 0 | 1 | 2; tidModel?: 'pyramidal' | 'polarized' } }
```

Server and web additions (E1 adds to `shared/types.ts` and hooks): `PlanSession` (row shape
of spec 3.3 with parsed JSON), `PlanRevision`, `PlanWithSessions` (`PlanWithWeeks` +
`sessions` + `feasibility` + `warnings` + `checklist` + `zones`), `TodayView { date;
sessions: Array<{ session: PlanSession; advice: 'as-planned' | 'downgrade-easy' | 'rest';
reasons: string[] }>; heat: { wbgtC: number | null; note: string | null; coolerHour: string | null };
checkin: Checkin | null; readiness: ReadinessSnapshot; unrated: Activity[] }`.

Engine entry points (`shared/engine/index.ts`, E9):

```ts
buildPlan(input: EngineInput): PlanDraft
replan(input: EngineInput): { draft: PlanDraft; changes: PlanChange[] }
assessExecution(session: SessionSpec, activity: Activity, ctx: { zones: ZoneSet; state: AthleteState }): ExecutionAssessment
matchSessions(sessions: Array<SessionSpec & { id: string; activityId: string | null; linkSource: string | null }>,
  activities: Activity[]): Array<{ sessionId: string; activityId: string }>
todayAdvice(input: EngineInput, sessions: Array<SessionSpec & { id: string }>): TodayView['sessions']
weeklyDecision(input: EngineInput, weekStart: string): WeeklyDecision
predictRace(input: EngineInput): Prediction | null
zoneProposals(input: EngineInput): ZoneProposal[]
```

---

## Group E0

### Task E1: Engine scaffold, parameter registry, research tooling

**Files:** `prisma/schema.prisma` + migration `training_engine` (spec 3), `shared/types.ts`,
`shared/engine/types.ts`, `shared/engine/params/{index,a-state,b-load,c-zones,d-goal,e-macro,f-micro,g-limits,h-ultra,i-env,j-adapt,k-taper,l-predict,m-execution}.ts`,
stubs for every engine module and every file named below, `server/serialize.ts`
(new serializers), `server/app.ts` (register new routers), `web/App.tsx` (`/research`),
`web/api/*.ts` (hooks for every endpoint in spec 6), `research/README.md`,
`research/tools/{build-corpus.workflow.js,write-corpus.mjs}`, `scripts/research-check.ts`,
`scripts/research-verify.ts`, `package.json` scripts `research:check`, `research:verify`
(add `research:check` to `check`), `.claude/skills/research-update/SKILL.md`,
`tests/unit/engine/params.test.ts`, `tests/unit/research/corpus.test.ts`.

- Transcribe **every** numeric value in `research/engine-rules.md` (all sections and the
  numeric parameter table) into the section files as `Param`s with ids like `g1.spikeRatio`,
  rule ids (`g-1`), grades, evidence ids and notes for grade D; `params/index.ts` exports
  `P` (all sections merged) and `PARAMS_VERSION = '2026-10-22.1'`.
- Tests: every evidence id exists as `research/papers/<id>.json`; every grade D param has a
  note; ids unique; every paper validates against a zod schema (fields as in the corpus);
  every `[id]` cited in `research/rules/*.json` and `research/engine-rules.md` exists
  (a small set of known unresolved ids may be listed explicitly in the test with a reason).
- `scripts/research-verify.ts`: the Crossref check (title token overlap ≥ 0.6, year ±1),
  one request at a time, prints mismatches; not run in CI.
- Skill: when and how to add papers or a topic (the workflow, the writer, both scripts,
  updating `engine-rules.md` and params, never inventing ids).
- Finish with `npm run check`, `npm run build`, `npm run test:e2e`; commit
  `chore: scaffold the training engine and parameter registry`.

## Group EA (parallel, pure engine)

Each task: its modules, its params section files, `tests/unit/engine/<module>.test.ts`.

### Task E2: Athlete state and load — `athlete.ts`, `load.ts`; params a, b

`estimateState(input: EngineInput): AthleteState`; `sessionLoad(activity: Activity, ctx: {
profile; zones }): { srpe: number | null; trimp: number | null; metric: 'srpe' | 'trimp' | 'minutes';
hrQualified: boolean }`; `dailyLoad(activities, ctx, metric): Array<{ date; load }>`;
`ewma(series, days)`; `criticalSpeed(efforts: Array<{ distanceM; timeSec }>): { csMps; dPrimeM } | null`
(linear distance-time fit, ≥ 3 efforts 400-5000 m within 90 days, grade-adjusted);
`efficiencyIndex(activities)`; `experienceClass(...)`. Tests pin rules A2-A9, B1-B5, B7
(including: optical HR on a trail run is not qualified; sRPE and TRIMP never summed; the
30-day longest run uses completed runs only; gap counting over 16 weeks; female TRIMP
constant 1.67, male 1.92, unspecified uses the profile's explicit setting defaulting to male).

### Task E3: Zones, heat and terrain — `zones.ts`, `heat.ts`, `terrain.ts`; params c, i

`buildZones(profile, state, today): ZoneSet` (anchor hierarchy C2, HRmax C3, LT1 C4,
threshold C5, bands C7); `liljegrenWbgt(input: { tempC; humidityPct; windKph; shortwaveWm2;
pressureHpa? ; zenithDeg? }): number` with the air-temperature fallback and a label;
`heatPenaltyPct(wbgtC, abilityMarathonSec): number` (I2-I4, no extrapolation above 25 C →
warning); `trainingHeatAdvice(forecastHours, session)` (I7, cooler hour);
`acclimationCredit(exposureDays: string[], today): number` (I8 decay);
`minettiCost(grade: number): number`, `gradeAdjustedSpeed(speed, grade)` (I11). Also
change `shared/importers/files/summarize.ts` to use `terrain.ts` instead of its own Minetti
copy (keep its tests green). Tests: published WBGT reference values within 0.5 C; penalty
table cross-check (Ely bands); Minetti values 5.6 at +45%, 0.51 floor at -20%.

### Task E4: Goal model and prediction — `goal.ts`, `predict.ts`; params d, l

`goalModel(goal: Goal, state: AthleteState, climate): GoalModel` (distance class, expected
duration from prediction or pace prior, darkness from start time and duration, ultra flag);
`feasibility(goal, state, today): Feasibility` (D4 formula, floors D3, notes D5, never
refuse); `predictRace(input): Prediction | null` (L1-L6 hierarchy, intervals, trail
widening, heat penalty from E3's interface via its stub). Tests: D4 weeks formula with
cutbacks; 100-mile defaults to finish-first; half and marathon floors; Riegel only ≤ 21.1 km;
minimum ±3% band, ±6% marathon; trail +50%.

### Task E5: Macrocycle and sessions — `macro.ts`, `sessions.ts`; params e, h, k

`macroPlan(input, state, goal, feasibility): WeekDraft[]` — backwards from race day: taper
(K1, K2, strictly decreasing), specific 6-8 weeks, build, base; 3:1 or 2:1 cycles by flags
(E3); TID targets per phase and distance class (E4 table; Z1 ≥ 70, Z2 ≤ Z1); weekly targets
from `typicalWeekMin` within G-2/G-3 and floors; strength, gut-training and heat blocks
(E5, H7, I8); ultra volume-first (H1); post-race week. `sessionLibrary(kind, params): ...` and
`prescribe(kind, minutes, zones, week): SessionSpec` with structure (C5 continuous threshold
margins, C6 rep length from D′ budget, strides, long fast finish rules, hike, b2b). Tests:
taper multipliers and lengths per distance; recovery-week cut 20-30%; Z1 floor in every
phase; strength block length; heat block placed when race WBGT ≥ 18 C; ultra long-run cap
min(6 h, 0.6 × race duration).

### Task E6: Microcycle and guards — `micro.ts`, `guards.ts`; params f, g

`placeWeek(week: WeekDraft, ctx: { profile; zones; state; prevSessions }): SessionSpec[]` —
available days and max minutes, long-run day, 1-2 quality sessions, spacing F1, F3, F4,
frequency F5, novice run-walk, b2b pairs (H3), strength placement. `applyGuards(sessions,
state, history): { sessions; warnings }` — G-1 spike guard on distance, duration, gain and
descent against the 30-day maxima (completed runs only; minimum steps), G-2 ramp (soft 10%,
30% per 2 weeks ceiling), G-3 profiles, H2/H3 ultra caps, never-make-up G-6 helper
`nextWeekCap(plannedMin, actualLastWeekMin, ramp)`. Tests: no two hard days in a row; no
session on an unavailable day; long run never between two quality days; a 2.1× spike is
never scheduled without `override-required`; 1.10-2.0× gets `spike-warn`; ramp ceiling over
any 2-week window; prior-BSI ramp ≤ 5%.

### Task E7: Execution — `execution.ts`; params m

`matchSessions` and `assessExecution` per spec 4.1-4.2: compatibility table, scoring,
greedy per day, owner links untouched; completion bands; intensity from HR histogram time in
band when HR is qualified, else GAP pace vs band; HR model fit (≥ 8 steady runs in 8 weeks,
heat term, shrinkage); effort score combining RPE delta, feel, HR residual, pace residual;
pain flags. Tests: a 60-minute easy session matched by a 58-minute run the same day over a
30-minute run the day after; strength activity never matches a run session; RPE 7 on an easy
run → score ≥ +1; feel −2 with RPE 2 on a threshold session → score ≤ −1; HR residual null
with fewer than 8 qualifying runs; heat-adjusted flag at WBGT 22 C; pain 5 → `pain` flag.

### Task E8: Readiness and adaptation — `readiness.ts`, `adapt.ts`; params j

`readinessSnapshot(input, date): ReadinessSnapshot` (J2-J4, sleep, red flags §n, fatigue
states J8); `todayAdvice` (downgrade-only J3 with persistence rule); `weeklyDecision`
(J5 using completion, execution scores, check-ins, efficiency, sleep, HRV, REDs, heat; G-6
cap); `zoneProposals` (C8 + spec 4.3: three concordant observations); `breakRestart(layoffDays,
preBreakWeekMin)` (J7 table); `quality trim` helper (spec 4.3). Tests: high HRV never adds
load; one flagged day without poor subjective score → as planned; two days → downgrade;
completion 75% → hold; two signals for 7 days → reduce; illness → no intensity until one
symptom-free day plus three easy days; masters gate J6; restart table tiers.

## Group EB

### Task E9: Orchestration, checklist, explanations — `index.ts`, `checklist.ts`, `explain.ts`

`buildPlan` (state → zones → goal → feasibility → macro → per-week micro → guards →
checklist → prediction), `replan` (keeps past weeks and completed sessions, recomputes the
future, returns `PlanChange[]` with rule ids), `explain(rules: string[]): Array<{ rule;
params: Param[]; papers: string[] }>`, checklist items for G1 (progression within limits,
recovery cadence, TID per phase, strictly decreasing taper, level differentiation between
novice and trained plans, spike guard, availability). **Plan matrix test** in
`tests/unit/engine/matrix.test.ts`: nine synthetic athletes × goals from spec 9 and assert
every checklist item and every guard in every week; plus determinism (same input twice →
identical output).

## Group EC

### Task E10: Server services and routes

**Files:** `server/services/engineInput.ts` (gather `EngineInput` from the DB: profile,
365 days of activities, 60 days of wellness and check-ins, reviews, goal model inputs,
forecast, race climate via Open-Meteo archive climatology for the race date and location),
`server/services/planEngine.ts` (generate, replan with `PlanRevision`, persist sessions),
`server/services/execution.ts` (after store: match and assess; nightly sweep),
`server/routes/{plan,today,checkins,zones,predictions,screenings,research}.ts`,
`server/jobs/scheduler.ts` (add Monday 03:00 local re-plan and nightly matching),
`server/services/activityStore.ts` (call the execution hook after a store), tests.
API per spec 6; 422 with the checklist when publishing fails; owner session edits never
violate guards (a move that would break spacing returns 409 with the reason).

## Group ED (parallel, web)

### Task E11: Today
`web/pages/DashboardPage.tsx` becomes Today: session cards (pace, HR, RPE, purpose, why),
readiness advice, heat note with cooler hour, check-in card (1-5 chips, illness, pain with
area and "point tenderness on a bone"), the existing "How did it go?" card, red-flag banners,
disclaimer link. Tests with mocked API.

### Task E12: Plan
`web/pages/PlanPage.tsx` + `web/components/SessionSheet.tsx`: week rows expand to day cards;
session sheet with prescription, steps, why drawer, linked activity and execution
assessment, link/relink, move, skip; feasibility, warnings, checklist, "What changed".

### Task E13: Goals, Review, Profile additions
Goals: new descriptors, feasibility, prediction range and method, race heat. Review:
weekly decision with signals, zone proposals accept/decline, execution summaries. Profile:
risk fields, zones with sources, REDs screen.

### Task E14: Research page and why drawer
`web/pages/ResearchPage.tsx`, `web/components/WhyDrawer.tsx`: topics, rules with grade
badges, papers with findings and DOI links, grade filter; drawer used by Today, Plan and
Review; data via `import.meta.glob` (lazy).

## Group EE

### Task E15: End to end and docs
E2E spec per spec 9; README "Training engine" section (what it does, what it does not, the
disclaimer, how evidence and defaults are shown); `docs/STATUS.md`; ADR 0005 (deterministic
evidence-graded engine, LLM text only) and ADR 0006 (provider framework, experimental Garmin).

## Group EF (found by local validation, 2026-10-22)

### Task E16: Plan adequacy — projection, recovery baselines, restart floor, session minimums

A plan generated from a real, sparse recent history (one run of about 30 minutes most weeks,
an 84-minute run seven weeks earlier, a 10-day gap; goal 100 miles on trail, finish-first,
33 weeks away) passed every checklist item yet was unusable: 30 minutes in week 1 split into
runs of 10-13 minutes, a peak of 3.7 h with a 72-minute long run, and from week 12 on a
single session per week. Causes and required behaviour:

1. **Projection.** `applyGuards` measures G-2 baselines from a volume map filled only with
   completed weeks, and G-1 references only completed runs, so every future week is compared
   with the last real week. Future weeks must be guarded against the projected history:
   completed runs up to `today`, then the guarded planned sessions of earlier weeks in date
   order. After a week is final, its total enters the volume map and its runs enter the
   G-1 records. Re-plans re-anchor on actual data (they already pass `history`).
2. **Recovery and taper weeks never lower a baseline.** The soft ramp uses the highest of the
   previous `g2.baselineWeeks` weeks (keep). The 2-week ceiling compares with the highest
   non-recovery, non-taper week in the window ending two weeks earlier, so a planned recovery
   week cannot hold the following weeks down. The week after a recovery week may return to
   the pre-recovery level and grow from it.
3. **Restart floor (new params, grade D, in `e-macro.ts`):** `restartFloor.sessions = 3`,
   `restartFloor.sessionMin = 20`, evidence `kluitenberg-2015-nlstart2run`,
   `buist-2008-graded-training`, note: novice and return programmes start at about three
   sessions of 20-30 minutes; G-2 governs growth from an established weekly base, so the
   floor week itself is exempt from G-2. When `typicalWeekMin` is below sessions × sessionMin
   and the runner has completed a run of at least `sessionMin` in the last 90 days, the first
   week's target is sessions × sessionMin on non-consecutive days; every session still obeys
   G-1. Without such a run, the floor sessions are run-walk (flag `run-walk`). Growth from
   the floor follows G-2.
4. **Session minimums (grade D params in `f-micro.ts`):** easy and recovery runs at least 20
   minutes (run-walk allowed for novices and returners); the long run at least the easy-run
   minimum and never shorter than the week's other runs. When a week's minutes cannot fit
   `runDays` runs at the minimum, place fewer runs (never below 2 outside taper, race and
   recovery weeks) instead of shrinking runs below the minimum. Guards that shorten a week
   scale the movable sessions down to the minimum and then remove the shortest easy run; the
   long run is never removed by a ramp cut.
5. **Run days follow volume** within availability and the F5 caps (novices 3 for their first
   6 weeks; 40 and over at most 6): verify the existing `daysFor` produces at least 4 days
   from 3 h, 5 days from 5 h, 6 days from 7 h of weekly running when the days are available;
   fix and add params if it does not.
6. **Placement completeness.** Every non-race, non-post-race week places exactly its `runDays`
   runs plus its strength sessions (unless availability prevents it, which yields a warning).
7. **Week flags** are unique (no `recovery,recovery` or `taper,taper`).
8. **Adequacy tests** in `tests/unit/engine/matrix.test.ts` for all nine athletes: sessions per
   week match runDays (+ strength); no run below the session minimum outside run-walk; no
   `ramp-ceiling` warning whose 2-weeks-earlier week was a recovery or taper week; weekly
   planned minutes within 10% of the week target. Add a tenth synthetic athlete with the
   sparse shape above and assert: week 1 has three runs of at least 20 minutes; volume grows
   to at least 6 h in the last specific week and the long run reaches at least 180 minutes
   (or feasibility is `not-reachable` with its warning, never silently); every guard and
   checklist item holds. Keep the existing assertions.

**Files:** `shared/engine/{guards,macro,micro,index,checklist}.ts`, `shared/engine/params/{e-macro,f-micro,g-limits}.ts`,
`tests/unit/engine/{matrix,matrix-fixtures,guards,macro,micro,orchestration}.test.ts` (and
fixtures). Engine purity and the parameter rules apply.

### Task E17: Close the feedback loop — goals, reviews, execution triggers, screening

Gaps reported by E10 and confirmed in review:

1. **Goal fields.** `server/routes/goals.ts` rejects the design §3.1 fields. Accept and
   validate `gainM`, `lossM` (0-30 000), `surface`, `goalType`, `targetTimeSec`
   (required when `goalType` is `time`), `startTime` (HH:MM), `raceLat/raceLng` (rounded to
   0.01°), `supportLevel`; defaults per the design (`finish` above 42.2 km). Check that
   `web/pages/GoalsPage.tsx` sends them; API tests.
2. **Weekly decision for version-2 plans.** For a plan with `generatorVersion` 2,
   `GET /api/reviews` returns the engine's `weeklyDecision` (decision, signals with rules,
   next-week target) in place of the version-1 suggestion, and saving a review of a finished
   week triggers `replanActivePlan` and returns the new `PlanRevision` summary. Version-1
   plans keep the version-1 logic. Make the Review page show the version-2 decision and the
   "What changed" summary after saving.
3. **Execution triggers.** Matching and assessment run immediately (not only nightly) after a
   manual create or edit in `server/routes/activities.ts`, after `PATCH
   /api/activities/:id/feedback`, and after linking. A feedback change re-assesses the linked
   session. Pain ≥ 4 or focal bone pain shows on Today's red flags at once.
4. **Screening into state.** Add an optional `screeningFlags?: number` to `EngineInput`;
   `estimateState` sets `risk.redsFlags` from it; `engineInput.ts` fills it from the latest
   REDs screening; buildPlan, replan and the weekly decision then see it. Two or more flags
   hold progression [rules §n.4].

**Files:** `server/routes/{goals,reviews,activities}.ts`, `server/services/{reviews,planEngine,execution,engineInput}.ts`,
`shared/engine/{types,athlete}.ts` (the optional field only), `web/pages/{GoalsPage,ReviewPage}.tsx`,
their tests.

### Task E18: Follow-ups from E16 and E17

1. **REDs hold at build time** [rules §n.4]: when `state.risk.redsFlags` is 2 or more,
   `buildPlan` and `replan` hold progression (weekly targets stay at the current level, no
   ramp growth, no new back-to-backs) and add a `hold` warning with a clinician prompt; the
   checklist and matrix gain a case. Lives in `shared/engine/{index,macro}.ts` and their
   tests (no limit is relaxed).
2. **Readable "What changed"**: PlanChange fields render as words ("Weekly running time",
   "Long run", "Run days", "Phase", "Recovery week", "Strength sessions", "Quality sessions",
   "Gain target", "Planned minutes") with units, on the Plan and Review pages, through one
   shared helper in `web/components/`.
3. **Fresh revisions after a review save**: `useSaveReview` also invalidates the plan and
   plan-revisions queries; move `SavedReview`, `ReviewView` and the signals type into
   `shared/types.ts` and use them on both sides.
4. **Re-match on a date change**: editing a linked activity's date (or type) unlinks it from
   a session it no longer fits and runs matching again; an owner link (`linkSource 'owner'`)
   on the same date stays.

**Files:** `shared/engine/{index,macro,checklist}.ts`, `tests/unit/engine/*`,
`web/components/planChanges.ts`, `web/pages/{PlanPage,ReviewPage}.tsx`, `web/api/reviews.ts`,
`shared/types.ts`, `server/services/{reviews,execution}.ts`, `server/routes/activities.ts`,
their tests.

### Task E19: Never schedule a spike; label after-race weeks; version-2 generate form

Found by the E15 end-to-end work and its review:

1. **The generator never schedules an override-band spike** [rules G-1: above 2.0× "the
   generator never schedules it without an explicit override"]. Reproduction: generate on a
   Saturday with 8 weeks of 40-minute runs on six days, one weekday closed (the day 3 days
   ahead), a marathon 20 weeks out, birth year 1985, measured HR max 188 → 422 with
   `spike-guard`: the current week's remaining minutes are packed into Saturday and Sunday.
   Fix in the engine: `remainingOfCurrentWeek` and `applyGuards` shorten any generated run to
   the warn band's upper limit (2.0× the 30-day reference on every dimension), preferring the
   normal band (1.10×) for the current week, and drop leftover minutes rather than flag
   `override-required` (owner edits keep their own rules). The never-make-up rule holds.
   Add the reproduction as a test for every weekday, plus matrix assertions that no generated
   session carries `override-required`.
2. **After-race weeks** keep `phase 'race'` (no schema change) but every view labels a week
   flagged `post-race` "After the race" instead of "Race week" (one helper used by the Plan
   page, Today and the e2e spec 04, which then drops its `.first()`).
3. **Generate form for version 2**: remove the ignored "Weekly run minutes" and "Plan start"
   fields; offer the engine options instead (recovery cycle 3:1 or 2:1, strength sessions
   0-2, polarized specific phase on or off for 5-10 km goals), sent as `options` in
   `POST /api/plan/generate`; the route passes them through to `buildPlan`. Version-1 plans
   are no longer generated, so their form path goes.

**Files:** `shared/engine/{index,guards,micro}.ts`, `tests/unit/engine/*`,
`server/routes/plan.ts`, `server/services/planEngine.ts`, `tests/api/{plan,engine}.test.ts`,
`web/pages/{PlanPage,DashboardPage}.tsx`, `web/components/format.ts`, `tests/web/*plan*`,
`tests/e2e/04-plan.spec.ts`.

### Task E20: Visual and copy polish from the screenshot pass

Found by screenshots of every page with synthetic data (phone 390 px and desktop 1280 px,
light and dark):

1. **The generator stays in the normal band.** Generated runs are capped at the normal band
   (1.10× the projected 30-day reference) on duration, distance, gain and descent, in every
   week, not only the current one; the warn band (1.10-2.00×) is reached only by owner
   edits, which keep their warning. A step within the H4 minimum (100 m of gain) or the G-1
   minimum (0.5 km) never raises a warning on its own. Re-run the matrix and adequacy tests;
   a fresh plan for the matrix athletes should carry no `spike-warn` and no `gain-ramp`
   soft warnings caused by minimum steps. [rules G6: conservative wins]
2. **Warnings read well.** The Plan page groups warnings by code into one line each
   ("Climbing above the 10% step in 3 weeks") with a disclosure listing the weeks; dates read
   "19 Oct", distances and gain follow the units setting (ft and mi for `mi`), through one
   tested helper that localises engine text (ISO dates, `N m`, `N km`) without changing the
   engine's messages.
3. **Why drawer in plain language.** No raw ids: each parameter shows its note as the
   sentence, then value and unit, grade badge and papers; each rule shows its title from a
   `RULE_TITLES` map (`g-1` "Session spike guard", `F-lib` "Session library", and so on for
   every rule id the engine emits, with a test that every emitted id has a title). "Default"
   reads "Default (no direct study)".
4. **Scales fit on one row.** The 0-10 pain scale and 1-10 RPE scale never wrap at 360 px or
   on desktop (one row of equal buttons, sized to fit). Today's "How did it go?" shows the
   most recent unrated run in full and the others as a list with "Rate" buttons that expand.
5. **Activity detail on phones.** Chart y-axes have room for their labels (no clipped
   "1180"); the laps table scrolls horizontally inside its own region with a visible edge
   fade; all four columns of the summary stay readable at 360 px.
6. **Review opens on the last finished week** (the Monday before this week's Monday), not two
   weeks back; a test pins it for every weekday.
7. **Small fixes:** the stray full stop after "Target" on Goals; the session sheet's linked
   activity select and Link button use the shared Field and Button components; Profile
   availability rows keep the minutes input next to the day.

**Files:** `shared/engine/{guards,macro,index}.ts`, `shared/engine/params/*.ts` (only for
item 1), `tests/unit/engine/*`, `web/pages/{PlanPage,ActivityDetailPage,DashboardPage,ReviewPage,GoalsPage,ProfilePage}.tsx`
and their CSS modules, `web/components/{WhyDrawer,SessionSheet,FeelPicker,charts/StreamChart}.tsx`
and CSS, new `web/components/{ScalePicker,engineText,ruleTitles}.ts(x)`, `tests/web/*`.

### Task E21: Progression consistent by construction

The whole-branch review and the local validation show the macrocycle and the guards
disagreeing: the macro grows long runs faster than 1.10× of the projected 30-day maximum (the
long-run share rises across phases), so the guards shorten nearly every generated long run,
the shortened weeks then read as a lower base, and the next week raises `ramp-soft`; a part
current week with any logged running still acts as a ramp baseline (a week three weeks out
was held to 40 minutes). A plan for a sparse 100-mile history carried about 50 warnings.

1. **Generated plans satisfy the guards by construction.** One set of limit helpers (the 30-day
   reference on duration, distance, gain and descent over completed plus projected runs; the
   soft and 2-week ceilings over the highest non-recovery, non-taper weeks; G-3 profiles; H2
   and H3) is used by both `macroPlan`/`placeWeek` while planning and `applyGuards` while
   checking. The macro plans each week's target and long run already inside those limits
   (long run at most 1.10× the projected 30-day maximum, weekly target at most the soft step
   over the highest of the previous two loading weeks), so `applyGuards` is a no-op for a
   generated plan. Guard shortening remains for owner edits and as a safety net.
2. **The part current week is never a ramp baseline** when `today` is after its Monday,
   whatever has been logged: the baseline comes from completed full weeks and
   `typicalWeekMin`. Revisit the e9 regression that relied on the opposite.
3. **A re-plan keeps owner edits** of the next 14 days (moved, kind-swapped and skipped
   sessions, and trims marked `design-4.3`) and plans the rest of those weeks around them,
   as it does for finished sessions of the current week.
4. **Focal bone pain** (active per `focalBoneActive`) makes `buildPlan` and `replan` hold
   progression (no growth in weekly targets, long runs or gain while active) with a `hold`
   red-flag warning and a clinician prompt [rules §n.1]; Today already advises rest.
5. **Hold and reduce decisions reach the sessions** [rules J5]: a hold trims the next quality
   session of the following week (marked like a `design-4.3` trim); a week capped by a reduce
   decision is marked `isRecovery`.
6. **Tests:** for every matrix athlete and every weekday as `today`, a generated plan has no
   `spike-shortened`, `spike-warn`, `ramp-ceiling`, `ramp-soft`, `ramp-run-dropped` or
   `gain-ramp` warning other than the restart floor's own info, and still meets every
   adequacy assertion (sparse 100-mile: ≥ 6 h in the last specific week, a run ≥ 180 min);
   weekly re-plans across 12 Mondays keep progressing and keep the specific phase; owner
   edits survive a re-plan; focal bone pain holds; a hold trims the next quality session.

**Files:** `shared/engine/{macro,guards,micro,index,checklist,readiness}.ts`, new
`shared/engine/limits.ts`, `shared/engine/params/{e-macro,f-micro,g-limits}.ts`,
`server/services/planEngine.ts`, `tests/unit/engine/*`, `tests/api/{engine,feedbackLoop}.test.ts`.

### Task E22: Remaining review findings outside progression

1. **Bone pain stays reported until cleared:** the Today check-in prefills "point
   tenderness on a bone" from the active state and clears it only when the runner unticks it;
   the server stores an explicit `false` only from such an action.
2. **Multi-day activities:** the parse cap becomes 240 hours (200-mile races take up to about
   100 hours), with the stream buckets bounded accordingly.
3. **No trims or proposals from guesses:** an effort score with no subjective part (no RPE,
   no feel) is capped at ±1 with low confidence, and quality trims require a subjective part.
4. **Zone proposals use fresh evidence only:** observations before the last accepted change
   of a boundary are ignored (the server supplies the dates).
5. **Weather** is not attached to treadmill, virtual or indoor activities.
6. **Fresh data:** profile saves invalidate zones, plan, today and zone proposals; week edits
   invalidate plan revisions and today; zone accept and decline invalidate plan revisions;
   the Integrations card refetches while a sync runs until it finishes.
7. **Readable changes:** `describeChange` names session and zone changes too.
8. **Activity detail feedback** resyncs when the stored values change.
9. **Ingest** reports per-activity failures in its response and marks the integration
   `error` when every pushed activity failed.
10. **Heart rate gaps:** samples are not forward-filled across gaps over 10 seconds.
11. **E2E independence:** `resetData()` clears every user-owned table.
12. **Session sheet:** climb in the units setting; skipping asks for confirmation and a
    skipped session can be restored.

**Files:** `web/**` (not `web/api/plan.ts` beyond invalidations), `shared/engine/{execution,adapt,types}.ts`
(the optional input field only), `shared/importers/files/*`, `server/services/{execution,weather,engineInput}.ts`,
`server/routes/{ingest,checkins}.ts`, `tests/e2e/helpers.ts`, their tests. Not E21's files.
