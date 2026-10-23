# Coach phase 3a — design

Status: Proposed 2026-10-22. Written under the owner's phase 3 mandate (section 1) from seven epic
designs, each revised after a principal-engineer review, and from the review itself. Decisions are
the builder's unless marked **owner**; section 12 lists every decision with its reason, and section
13 lists what the owner still has to settle.

This document decides architecture, data, flows, copy and tests for the "now" tier of phase 3. It
does not restate the rule numbers in `research/engine-rules.md` or the training engine design
(`docs/superpowers/specs/2026-10-22-training-engine-design.md`); where it adds a number, the number
is a `Param` with a grade and evidence ids. The task list is
`docs/superpowers/plans/2026-10-22-coach-phase3a.md`.

## 1. Purpose and mandate

The owner's mandate (2026-10-22): "Make it Runna, Strava, and other running apps, a professional
research informed self adjusting and improving coach and tracker and all. Make it better than Strava
and Runna. The result should be incredible not just passable or good enough." The only firm input is
the goal race, a 100-mile trail race in early June 2027; the app must own the plan.

The audit of 2026-10-22 (seven lenses and a gap analysis) found an engine that already plans, adapts
weekly and explains its rules, wrapped in an app that reads like a tracker: Today leads with weekly
hours, the weekly re-plan runs silently, the plan never reaches the watch, explanations show rules
but not the runner's own numbers, disruptions can only be handled one session at a time, fuelling
has no place to be practised, and predictions are logged but never checked. Each screen also
re-reads a year of activities on every request.

Phase 3a closes those gaps in seven epics. "Incredible" is defined per epic in its goal; across all
of them it means four things:

1. **Fast and fresh.** Every screen answers from one cached picture of the runner, and no write can
   leave a stale number on screen.
2. **One truth on every surface.** Today, the session sheet, the watch, the workout file and the
   calendar show the same session with the same numbers.
3. **Visible, reversible adaptation.** Every change the engine makes is a revision the runner can
   read, question and undo.
4. **Honest and evidence-graded.** Every number has a grade and a source, every sentence is
   rule-generated (ADR 0005), and nothing blames (G5).

## 2. Scope and non-goals

### 2.1 In scope (phase 3a), in dependency order

| Epic | Name                                                           | Sections |
| ---- | -------------------------------------------------------------- | -------- |
| E3   | Foundation: fast athlete state, reliable sync, one identity    | 4, 5     |
| R0   | Revision foundation (split out of E3 and E5)                   | 4.2      |
| E1   | Sessions on the wrist: intervals.icu, FIT files, ICS feed      | 6        |
| E2   | Today, rebuilt as a coach (phone first), with offline shell    | 7        |
| E4   | Explanations from the runner's own numbers, and a weekly brief | 8        |
| E5   | Disruptions: dial-back, what-if and moves                      | 9        |
| E6   | Fuel lab and gut training                                      | 10       |
| E10s | Prediction back-test slice                                     | 11       |

### 2.2 Non-goals

- Phase 3b epics (run analysis E7, fitness and body trends E8, best efforts E9, the rest of the
  calibration loop E10, ultra readiness E11, race plan E12, calendar E13, strength E14, deeper
  imports E15, gear E16, data ownership E17) and the "later" tier (push E18, routes E19, season
  planner E20).
- Storing GPS tracks (owner decision 3).
- Any write through the unofficial Garmin provider (owner decision 4).
- Race facts (cutoffs, aid stations, course) in the repository, guessed or real (owner decision 5).
- A move to five heart-rate zones (owner decision 6).
- Changing the 10.0 h plateau at the class peak (owner decision 7).
- A recalibration of predictions from the back-test (E10s stores the record; E10 proposes changes
  later and the runner accepts them).
- Offline queueing of non-idempotent writes (logging a run, plan edits, disruptions).

### 2.3 Anti-goals

- Any change to a training target that the runner cannot see and reverse (the amended rewrite
  anti-goal, ADR 0007).
- Two definitions of one concept: a second pairing of sessions, a second eased session, a second
  target resolver, a second hot-day test for steering, a second revision formatter, a second seen
  marker, a second G5 word list, a second change detector.
- A caller that bumps the data version by hand, or a table that ships without a state
  classification.
- A fluid volume prescribed above thirst, a promise of speed from gut training, a health word in a
  calendar or watch title.
- A sentence written by a language model, or one that says "behind", "missed", streaks, badges or
  shows red (G5).

## 3. Standing constraints

These bind every design below and every task in the plan.

- **ADR 0005.** The engine is pure and deterministic; a language model never chooses or edits a
  session; all plan text comes from templates over engine values.
- **Params.** Every engine number is a `Param` in `shared/engine/params/` with a grade, a rule id
  and evidence ids that exist in `research/papers/`; a grade D value carries a note that says it is
  a default. Display caps (page sizes, list lengths, slot budgets) are named constants, not Params;
  thresholds about the runner's data are Params. Changing a Param follows the `research-update`
  skill: rule text, then Param, then `PARAMS_VERSION`.
- **Server.** Express 5 routes stay thin; Zod parses every body and query; services hold logic;
  errors are `HttpError` (`server/errors.ts`). Input validation is 400 with `details.issues`; 409 is
  a conflict and may carry `details` (section 4.8); 422 is reserved for the plan quality checklist.
- **Data.** Prisma on SQLite; migrations are committed under `prisma/migrations`; import
  `PrismaClient` and row types from `server/db.ts`. Distance in metres, duration in seconds, plan
  targets in minutes, dates as `YYYY-MM-DD` in the runner's local day, weeks start Monday (ADR
  0003).
- **Shared code.** `shared/` is pure domain code with unit tests; relative imports carry `.ts`.
- **Web.** Data hooks live in `web/api/<resource>.ts`; pages only consume them; tests query by role
  and accessible name.
- **Providers.** One module per source, channels `pull`, `push`, `upload` and (new, ADR 0008)
  `publish`; network only through `ctx.fetch`; secrets only through `server/crypto.ts` and
  `ctx.saveSecret`, never logged or returned; a provider never writes to the database.
- **Environment.** The variables are exactly `DATABASE_URL`, `SESSION_SECRET`, `PORT`, `NODE_ENV`,
  `ALLOW_REGISTRATION` and `LOG_LEVEL`. Phase 3a adds none and adds no runtime dependency (`fflate`
  and `fit-file-parser` are already dependencies).
- **Privacy.** No personal data in the repository: synthetic fixtures, `example.com` emails, no real
  names, race names or run history. The owner validation database stays outside it.
- **Copy (G5).** No red, no "behind" or "missed", no streaks or badges; targets are a sketch.
- **Tests.** `tests/unit`, `tests/api` (`helpers.ts`), `tests/web` (`helpers.tsx`), `tests/e2e`
  (`helpers.ts`, `resetData()`, `signedInApi()`, dates from the clock, no sleeps; `01-auth.spec.ts`
  owns the empty database and stays first).
- **Gates.** `npm run check`, `npm run build` and `npm run test:e2e` before every merge;
  `docker build .` after a migration or a change to what the image serves; the owner validation
  (`data/validate-owner.ts`) after any engine change.

## 4. Cross-cutting designs

Seven contracts are shared by several epics (sections 4.1 to 4.7), and section 4.8 lists the
conventions every task follows. Each contract is defined once here and owned by one task; the epics
adopt them and define no copy of their own. The review found four definitions of session identity,
two revision models, three heat thresholds, five revision formatters and seven word lists before
this section existed.

### 4.1 Session identity (owner: E3-7, schema in E3-4)

- **Durable id.** `PlanSession.externalId` (a uuid string, required, unique per plan) is the
  identity of a session for anything outside the database: the intervals.icu event, the ICS UID, the
  revision diff and the publish row. `PlanSession.id` is stable within a plan because every write
  that keeps a session updates its row in place.
- **One pairing function.** `pairSessions(before, after)` in `shared/domain/sessionIdentity.ts`
  pairs two session lists by (date, kind, occurrence): within one (date, kind) group both lists are
  ordered by `order`, then by input index, and zipped. `order` only breaks ties, because it shifts
  when a strength or mobility session is added to a day. Nobody else pairs sessions.
  `carryExternalIds(previous, next)` builds on it.
- **Writes.**
  - Owner move, swap, shorten, skip and restore update the row in place (id and externalId kept).
  - A re-plan updates each paired slot's row in place (engine-derived columns only; id, externalId,
    planId and the activity link kept), deletes only unpaired replaced rows and creates only
    unpaired draft sessions. Kept rows (`keptByReplan`) stay out of pairing. The write returns a
    `SessionWriteSet` (`created` rows, `deleted` full rows, `updated` `{ id, before, after }`) from
    which the revision diff and the undo payload are built (section 4.2).
  - Regenerate carries externalIds from the archived plan's sessions dated today or later.
  - Undo recreates deleted rows with their original id and externalId.
- **Changed day or kind.** An owner move or swap keeps the row, so the watch event is updated in
  place with the new date or kind. When a re-plan or a regenerate produces a session on another day
  or of another kind, pairing treats it as a removal plus an addition in every consumer: the watch
  creates the new event before it withdraws the old one, and the diff shows two lines. A "moved"
  line is presentation built by `shared/copy` when a removed and an added session of one kind and
  prescription fall in one week; it is never an identity rule.
- **Published id.** `workoutExternalId(externalId, userTag)` returns `rl-<userTag>-<externalId>`.
  The server computes `userTag` as the first 6 hex characters of SHA-256 of the user id
  (`server/services/publish.ts`), so two installs writing to one intervals.icu account cannot
  overwrite each other and `shared/` stays free of Node crypto.

### 4.2 Revision model with undo (owner: R0, tasks R0-1 and R0-2)

The review found E4 and E5 each defining storage, an undo route, a split of `replanActivePlan` and
ADR 0007, and E3 editing the same function a third time. R0 is one foundation that E3-8, E4 and E5
build on. It ships no UI: E4-4 builds the diff and undo components once and E5 reuses them.

**Storage (migration D, additive).** `PlanRevision` gains:

```prisma
auto         Boolean   @default(false) // written by the scheduler, not by a request
decision     String?   // JSON: the weekly decision this revision acted on (weekly and review)
diff         String?   // JSON PlanDiff; null on rows written before this migration
undo         String?   // JSON UndoPayload; never sent to the client; null when nothing can be restored
undoneAt     DateTime?
undoneById   String?   // the 'undo' revision that reverted this one
undoOf       String?   // on an 'undo' revision: the revision it reverted
seenAt       DateTime? // the one seen marker in the product
disruptionId String?   // the window this revision created, changed or removed (no foreign key)
```

The `@@index([planId, reason])` on `PlanRevision` is not part of migration D: migration B
(`20261023052702_foundation_plan_session`, task E3-4) already shipped it, so migration D holds the
columns and the backfill only.

`reason` gains the values `disruption`, `undo` and `goal-switch` (a text column, no migration). The
migration backfills `auto = 1` for `weekly` and `break` rows and `seenAt = createdAt` for every
existing row, so old revisions are never shown as new; `diff` and `undo` stay null.

**Shapes** (`shared/types.ts`; `SessionBrief` has one definition, in `shared/engine/types.ts`):

```ts
interface SessionBrief {
  date: string
  kind: SessionKind
  title: string
  durationMin: number
  distanceM: number | null
  gainM: number | null
}
interface SessionDiffLine {
  change: 'added' | 'removed' | 'changed'
  externalId: string
  sessionId: string | null
  date: string
  weekStart: string
  before: SessionBrief | null
  after: SessionBrief | null
  fields: Array<'date' | 'kind' | 'durationMin' | 'distanceM' | 'gainM' | 'structure' | 'status'>
  rules: string[]
}
interface WeekDiffLine {
  weekStart: string
  runMinBefore: number
  runMinAfter: number
  flagsAdded: string[]
  flagsRemoved: string[]
}
interface PlanDiff {
  v: 1
  sessions: SessionDiffLine[]
  weeks: WeekDiffLine[]
  holds: Array<{ from: string; to: string; label: string; disruptionId: string | null }>
  totals: {
    added: number
    removed: number
    changed: number
    weeksChanged: number
    runMinBefore: number
    runMinAfter: number
  }
  empty: boolean
}
type UndoReasonCode =
  | 'already-undone'
  | 'is-undo'
  | 'not-undoable'
  | 'window-passed'
  | 'plan-archived'
  | 'edited-since'
  | 'session-run'
  | 'safety-rule'
  | 'checklist'
interface UndoReason {
  code: UndoReasonCode
  message: string
  sessionId?: string
  weekStart?: string
  disruptionId?: string
  rules?: string[]
}
interface UndoState {
  available: boolean
  reasons: UndoReason[]
  undoneAt: string | null
}
```

`UndoPayload` (server only, v 1) holds, for sessions and weeks, the rows the revision `created` (id
and an after-state hash), `deleted` (full rows, every scalar column except `updatedAt`, so
`externalId` too) and `updated` (id, the changed columns' `before` values and an after-state hash),
plus `disruptions.created` and `disruptions.updated`. The hash is SHA-256 of the stable JSON of a
row's content columns, listed from the Prisma DMMF minus `execution`, `activityId`, `linkSource` and
`updatedAt`, so a linked run reads as `session-run`, never as an edit. Plan-level derived columns
(`warnings`, `checklist`, `feasibility`, `paramsVersion`) are recomputed after an undo by the code a
re-plan uses, not stored. A row-level payload is a few KB per Monday; a full-plan snapshot would be
about 100 KB.

**Services** (`server/services/replan.ts`, `server/services/planActions.ts`):

- `computeReplan(deps, args)` reads only; it accepts an optional input transformer so a preview can
  apply a hypothetical (a rest window, a restored plan).
- `applyReplan(deps, result)` runs the transaction: E3-7's row-level write, then `recordPlanWrite`.
- `recordPlanWrite(tx, { planId, userId, reason, summary, changes, diff, undo, decision, auto, disruptionId })`
  is the only function that writes a `PlanRevision`. It bumps nothing (section 4.3).
- `computeAction(deps, action)` builds both the preview and the commit for every plan action
  (re-plan, undo, and later disruption create, update and remove, and adjust), so a preview and its
  commit cannot disagree. `replanActivePlan` keeps its signature as a wrapper; `planEngine.ts`
  re-exports the old names.
- `diffPlans` (`shared/engine/diff.ts`) builds the `PlanDiff` from the same pairs that produced the
  write set, so a diff cannot describe a change that was not written.

**One undo policy** (the review's recommendation; owner question Q1). A revision can be undone while
all of these hold:

1. it has a payload, is not undone and is not itself an undo (`not-undoable`, `already-undone`,
   `is-undo`);
2. its plan is still active (`plan-archived`);
3. it is younger than `P.revision.undoWindowDays` (7 days, grade D default, rule `design-revisions`;
   `window-passed`);
4. no session, week or rest window it created or changed has changed since, compared by after-state
   hash (`edited-since`, naming the row). A later edit to another row does not block it: moving one
   session on Tuesday leaves Monday's undo available;
5. none of its sessions has been run or linked to an activity since (`session-run`);
6. no safety rule it cites (n-1 to n-4) is still active in the current input (`safety-rule`),
   because G6 makes the more conservative rule win. The one exception is a revision that created a
   rest window the runner reported: its own undo is never refused on safety grounds;
7. the restored plan passes the quality checklist (`checklist`).

Checks 1 to 6 are structural and run on the list (one id query per page and at most one read of the
cached input). Check 7 runs only in the undo preview and the commit: `applyUndoPayload` on the
in-memory rows, `existingFrom(weeks, sessions)` to build the draft, `runChecklist` against the
current input from `loadAthleteContext`. Its cost (one draft and one checklist) is paid once per
click. Undo restores only rows dated today or later; past rows stay as they are, except the
back-dated skips of a window the undone revision created, which come back because the window was the
runner's own statement. Undo writes a revision of reason `undo` with `undoOf`, sets `undoneAt` and
`undoneById` on the target, and has no undo of its own; redo is a new action. The undo confirm says
that the next weekly update may make the same change if the data still points that way.

**Routes.**

- `GET /api/plan/revisions`. Body or query: `limit` 1-200 (50), `before` id, `include=empty`.
  Response: `PlanRevisionView[]` newest first, with `auto`, `decision`, `diff`, `undo: UndoState`,
  `seenAt`, `undoOf`, `disruptionId`.
- `POST /api/plan/preview`. Body or query: `PlanAction` (discriminated union on `type`; R0-2 ships
  `replan` and `undo`). Response: 200
  `PlanPreview { action, diff, summary, warnings, blocked, guards, reasons, hash, today }`; a
  refusal is information.
- `POST /api/plan/revisions/:id/undo`. Body or query:
  `z.strictObject({ expectHash: z.string().length(64).optional() })`. Response: 200
  `{ revision, target }`; 409 `{ reasons }` or `{ code: 'stale-preview', preview }`; 422
  `{ checklist }`.
- `POST /api/plan/revisions/:id/seen`. Body or query: none. Response: 204, idempotent.
- `POST /api/plan/replan`. Body or query: adds optional `expectHash`. Response: `PlanRevision` with
  the new fields; 409 stale-preview.

The preview writes nothing (no revision, no prediction row, no state write). `hash` is SHA-256 of
the canonical JSON of `{ diff, headRevisionId, today }`; a commit whose `expectHash` no longer
matches answers 409 with the new preview, so new sync data or midnight never applies an unseen diff.
Revisions with an empty diff are hidden from the list unless `include=empty`; a no-op weekly re-plan
still writes one, so "the weekly update ran" is a reliable test (section 4.7). E4 may add derived
fields to `PlanRevisionView` (causes) but not change its shape.

**ADR 0007** records the decision (owner decision 1) and amends the rewrite design's anti-goal to:
"Any change to a training target that the owner cannot see and reverse. Changes the engine makes on
schedule are shown as revisions and can be undone; targets the owner set by hand are never
overwritten." R0-1 accepts it; no other task writes it.

### 4.3 State cache and data-version counter (owner: E3-1, E3-2; ADR 0009)

- **Counter.** `server/dataVersion.ts` keeps a per-client counter `{ boot: randomHex(4), n }` and a
  Prisma query extension that bumps it after every create, update, upsert, delete and their `many`
  and `AndReturn` variants on a state model, also when the operation throws. Callers never bump;
  there is no public bump function.
- **Rollback safety.** `createPrisma` returns a proxy whose `$transaction` wrapper keeps an `openTx`
  count while any transaction is in flight and bumps once when it ends, on commit or rollback. The
  snapshot never stores a build that started or finished while `openTx > 0` or that overlapped a
  bump; such a build is returned to its caller and dropped. A rolled-back write can therefore never
  leave a stale snapshot. The review showed the first draft's "harmless over-invalidation" claim was
  wrong for one ordering; E3-1's spike test records whether root reads share the better-sqlite3
  handle with an open interactive transaction.
- **Other processes.** `dataVersionKey(prisma)` returns `{ n, external, key }`, where `external` is
  `Number(PRAGMA data_version)` (the pragma may come back as a `BigInt`) and changes when another
  connection or process writes the file (Playwright's `resetData`, a restore, a CLI script);
  `key = <boot>.<n>.<external>`. `onDataVersionChange(prisma, listener)` fires after each in-process
  bump.
- **Classification.** Every Prisma model is listed in exactly one of `STATE_MODELS` and
  `NON_STATE_MODELS`; a test parses `prisma/schema.prisma` and fails naming any unclassified model,
  so a new table cannot ship unclassified. A state model is anything the snapshot, a memoised value
  or a published deliverable reads.
  - **State** (a write invalidates the snapshot): User, Activity, WellnessDay, AthleteProfile,
    WeeklyReview, Screening, Goal, Plan, PlanWeek, PlanSession, PlanRevision, ClimateCache (E3),
    Disruption (E5), FuelLog, FuelProduct, FuelSettings (E6), RaceResult (E10s).
  - **Non-state** (a write does not): ActivityStream, ActivityFile, ImportBatch, ImportedFile,
    Integration, PredictionLog, SyncRun, ForecastCache (E3), DeliveryChannel, WristPublication (E1),
    WeeklyBrief, ActivityInsight (E4).

  A derived table written on a read (a lazy brief, a run insight) must be non-state, or each lazy
  write would invalidate the cache it just read. A table whose writes come from the publisher must
  be non-state, or each publish run would trigger the next.

- **Snapshot.** `server/services/athleteState.ts` exports
  `loadAthleteContext(deps, { userId, today })`, returning a deep-frozen `AthleteContext` (as of,
  key, profile, activities, wellness, reviews, screening flags, zone changes, state, zones,
  readiness, the stored plan through `existing()` and predictions through `prediction(goalId)`), and
  `memoByVersion(deps, { userId, name, today? }, compute)` for derived values (stats, E4's
  heart-rate model and weekly decision, undo availability). The build is one `Promise.all` round of
  column-selected queries; entries live in an LRU of 8 with a 5-minute TTL as backstop, single
  flight per key; the memo LRU holds 64. The key includes `today`, so midnight rolls over without a
  bump. `gatherEngineInput` and the other engine-input functions keep their signatures as thin
  adapters, so consumers that need an `EngineInput` call them.
- **One goal resolver.** `currentGoalFor(db, userId)` in `server/services/currentGoal.ts` returns
  the active plan's goal, else the `isActive` goal, else null. `StateView.goal`, Today's race block,
  E10s's ensure job and every "which goal" lookup call it.
- **Rule for every epic** (CLAUDE.md, and an acceptance line in E1-3, E4-2, E4-7 and E10s-1):
  athlete data comes from `gatherEngineInput`, `loadAthleteContext` or `memoByVersion`; no query of
  the history window or the stored plan outside the snapshot; no raw SQL write to a state table (a
  source test enforces the last).
- **Change keys outside the cache.** A deliverable that also depends on the forecast composes its
  key as `dataVersionKey + today + forecastStamp(prisma, userId)`, where `forecastStamp` is the
  `fetchedAt` of the home forecast cell (E1's publisher).

### 4.4 Publish channel (owner: E1-4; ADR 0008)

A provider may declare a fourth channel, `publish`, implemented as a `PublishProvider` beside its
other channels in the same module:

```ts
interface PublishReference {
  maxHr: number | null
  lthr: number | null
  thresholdPaceMps: number | null
}
interface OutboundWorkout {
  externalId: string /* rl-<userTag>-<externalId> */
  date: string
  name: string
  plan: WorkoutPlan
  remoteId: string | null
}
type PublishFailCode =
  'auth' | 'rate-limit' | 'no-threshold' | 'rejected' | 'network' | 'device' | 'not-connected'
type UpsertOutcome =
  | {
      externalId: string
      ok: true
      remoteId: string
      warnings: string[]
      deviceMessage: string | null
    }
  | { externalId: string; ok: false; code: PublishFailCode; message: string }
interface PublishProvider {
  reference(ctx: ProviderCtx): Promise<PublishReference>
  upsert(
    workouts: OutboundWorkout[],
    ref: PublishReference,
    ctx: ProviderCtx,
  ): Promise<UpsertOutcome[]>
  withdraw(
    refs: Array<{ externalId: string; remoteId: string | null }>,
    ctx: ProviderCtx,
  ): Promise<void>
  list(range: { from: string; to: string }, ctx: ProviderCtx): Promise<RemoteWorkout[]>
}
```

The rules of ADR 0006 carry over: network only through `ctx.fetch`, secrets only through
`server/crypto.ts`, refreshed secrets through `ctx.saveSecret`, no new environment variable, and a
publish provider never writes to the database. `server/services/publish.ts` owns the publication
rows, as `activityStore.ts` owns imported activities. Publishing is off until the runner turns it
on, writes only run sessions of the next 14 days, never goes through the experimental Garmin
provider, and stores every failure per session. Change detection is the composed key of section 4.3
plus a 30-minute refresh as backstop; there is no second watermark. Each run is recorded in
`SyncRun` with channel `publish` (section 4.7). The private calendar feed is not a provider: it has
no account to connect, sync or disconnect, so it is a route behind a hashed token stored on
`DeliveryChannel`. Only intervals.icu implements `publish` in this release.

### 4.5 Copy system and the G5 lint (owner: E4-1; ADR 0010)

- **Templates, not prose.** `shared/copy/` holds typed templates (`tpl`, `render`, `renderFact`)
  over typed slots (`Quantity`: pace, distance, climb, duration, bpm, percent, share, date and
  others, formatted in the runner's units by `formatQuantity`). Stored records hold structured
  facts, never prose, so a copy fix reaches old briefs and units follow the settings. A missing or
  mistyped slot throws in tests and renders the template's fallback in production, never
  `undefined`.
- **Numbers from Params.** A sentence that restates a rule number (illness days, the fluid reference
  range, the EAH hours, the undo window, the fuel floor) interpolates it from `P`; a copy test
  compares the rendered sentence with `P`, so a Param change cannot leave text out of step.
- **One formatter per concept.** All revision, diff, brief and window prose lives in
  `shared/copy/revision.ts` and `shared/copy/brief*.ts`. The server's `describeChanges` becomes a
  wrapper over it; `web/components/planChanges.ts` keeps only the legacy renderer for revisions with
  `diff = null`.
- **One lint.** `shared/copy/lint.ts` exports `G5_BANNED`, `lintText` and `assertCleanCopy`;
  `tests/web/helpers.tsx` exports `expectCleanCopy(container)`. Whole words, case-insensitive:
  behind, missed, miss, streak(s), badge(s), trophy, "personal record", "personal best", fail,
  failed, failure, lazy, crush, smash, "should have". Case-sensitive whole words: PB, PR and
  lowercase "red" (so RED-S and REDs copy passes). The plain word "record" is allowed ("Prediction
  track record", "Record result"). No exclamation marks; no injury-probability wording. Every epic's
  templates and rendered page tests run it; no epic keeps a list of its own.
- **Scope.** The lint covers app-authored copy. Text a provider or the system returns (an
  intervals.icu error, a Garmin message) is shown verbatim inside an app-authored sentence and
  quoted as the service's own words; it is outside the lint. App-authored provider copy that
  contained a banned word ("Wellness sync failed") is reworded ("Wellness could not be read").

### 4.6 Shared delivery semantics (owner: E2-2)

The review found two eased sessions, two target resolvers and three heat thresholds; at 20 C WBGT
Today said "go by effort" while the watch carried a 149 bpm ceiling. One wave-0 task (E2-2, which
absorbs E1's first task) defines:

- `easedSession<S extends SessionSpec>(session: S, zones): S` in `shared/engine/readiness.ts`, the
  J3 downgrade made concrete: kind `easy`, title "Easy run", the same minutes (never longer),
  `distanceM` null (time is the unit), one steady Z1 step, rules plus `J3`, flags dropped except
  `heat`, purpose "Eased from <title>: readiness signals have stayed lower than usual, so an easy
  run keeps the day." The id and status of the input are kept, so the cached hero, the watch event
  and an undo all point at one row. Easy, recovery and non-run sessions return unchanged. Only
  called for advice `downgrade-easy`; a `rest` advice withdraws.
- `resolveTargets(session, zones, { hot }): ResolvedTargets` in `shared/engine/targets.ts`:

  ```ts
  interface ResolvedTargets {
    zone: ZoneKey
    mode: 'hr-ceiling' | 'hr-band' | 'pace' | 'effort'
    hrCeiling: number | null
    hrRange: [number, number] | null
    paceSecPerKm: [number, number] | null /* slow..fast */
    rpe: [number, number]
    hot: boolean
    hotNote: string | null
    zonesNote: string | null
    source: 'zones' | 'plan'
  }
  ```

  Z1 with heart rate gives an `hr-ceiling` at the top of the current Z1 (current zones beat the
  stored target, because an accepted zone change does not re-plan); Z2 and Z3 give a band;
  threshold, intervals and race pace keep the stored work pace band (built from critical speed and
  D′, not derivable from zones); hills, hike, cross and strength give effort. `hot` forces mode
  `effort`, keeps heart rate as secondary text and sets `hotNote`. `climbNote(session)` adds the
  climbing line when gain per hour reaches `P.h4.climbNoteGainPerHourM`. E2's `TodayTarget` is a
  view of this type; the hero, the session sheet, the FIT steps, the intervals.icu description, the
  ICS outline and the brief's key session render from it. The watch-only floor (`P.o1.hrFloorBpm`)
  and the short-step rule (`P.o1.hrTargetMinStepSec`) are applied by E1's step mapping, not here.

- `isHotForSteering(peak: { value; index: 'wbgt' | 'air-temperature' } | null, flags)` in
  `shared/engine/heat.ts`: true for the `heat` flag or a WBGT peak at or above `P.i9.warnWbgtC` (25
  C); an air-temperature peak alone never makes a day hot. No new Param. E6's fuel hold keeps its
  own threshold (`h7.hotDayWbgtC`, 18 C), because it answers a different question (gut risk and
  whether to climb the fuel ladder), and its Param note and copy say so.
- `trainingHeatAdvice` returns `peak` and `coolerValue` additively; E1 and E6 reuse `peak`, nobody
  extracts a second peak helper. The cooler hour is offered for any run (owner question Q4).
- `isToRun(status)` in `shared/domain/sessionStatus.ts`, built on an exhaustive
  `Record<PlanSessionStatus, boolean>` (planned, moved, downgraded; E5 adds `adjusted`, which is a
  compile error until classified). `shared/engine/index.ts` reuses it for `TO_RUN`. E1's publish
  set, E2's week strip, E6's fuel target, E4's key session and execution matching
  (`shared/engine/execution.ts:131`) call it.
- **Cross-surface test.** `tests/unit/engine/targetSurfaces.test.ts` holds a registry of surface
  adapters (the hero in E2-2; the session sheet, FIT steps, intervals.icu text and ICS outline in
  E1; the brief's key session in E4-5; the fuel line in E6-5) and asserts for every session kind,
  hot or not, eased or not, in km and miles, that every surface shows the same ceiling, band or pace
  and effort. A second implementation anywhere fails it by design.

### 4.7 Job and sync log, and the weekly catch-up (owner: E3-6)

- `SyncRun` (migration C, non-state) is the one run history: channels `pull`, `push`, `folder`,
  `publish` (E1) and `job` (the scheduler's replan, matching, weather, sync, predictions and publish
  jobs). Every run is stored, idle ones too, through `syncLog.recordSyncRun`, which never throws and
  prunes to the newest 200 rows and 90 days per user and provider. `message` and failure reasons
  pass `safeMessage` (strips bearer tokens, `access_token` and `client_secret` values and query
  strings; cuts at 300 characters).
- `GET /api/integrations/:provider/runs` serves a provider's runs (both directions on one card);
  `GET /api/jobs` returns the latest run per job and `weeklyUpdate: { due, lastRevisionAt }`. E2's
  `TodayHealth` builds "This week's plan update has not run yet" and "Sync is paused" from them.
- **Catch-up.** `daily()` seeds its slot at start, so a server restarted on Monday after 03:00
  skipped that week's re-plan silently. `runReplanJob(deps, { catchUp: true })` runs on process
  start and every 6 hours for users with an active version-2 plan whose current week's slot has
  passed and who have no revision of reason `weekly` or `break` since it; runs are recorded with
  trigger `catchup`, and a failed catch-up waits for the next tick. The 03:00 slot is unchanged.

### 4.8 Conventions every task follows

- **Errors.** `conflict(message, details?)` (E3-1) carries `details` to the client body: `requires`,
  `reasons`, `guards`, `code: 'stale-preview'`. Validation is 400 with issues everywhere, including
  E6's settings and E10s's results; 422 stays the checklist only.
- **`PARAMS_VERSION`.** No design claims a suffix. The PR that merges takes the next free suffix of
  `PARAMS_VERSION` at rebase and updates the assertion at `tests/unit/engine/params.test.ts` in the
  same PR; its description names the value taken. Tasks that add or change a Param: E2-2, R0-1,
  E1-2, E4-2, E5-3, E6-1, E10s-2.
- **ADR numbers.** 0007 automatic re-plan, visible and undoable (R0-1); 0008 outbound publish
  channel (E1-4; 0006 gains a pointer line); 0009 athlete-state snapshot and data version (E3-2);
  0010 rule-generated text (E4-1); 0011 personal fuel ladder (E6-1); 0012 offline shell and cached
  health data (E2-8). 0007, 0008 and 0009 are drafted as Proposed with this document.
- **Migrations.** Ten in this phase: weather cache (E3-3), plan session (E3-4), sync log (E3-6),
  revision model (R0-1), wrist delivery (E1-4), disruptions (E5-5), weekly brief (E4-5), activity
  insight (E4-7), fuel lab (E6-4), race results (E10s-1). One per PR; the folder name is regenerated
  at rebase so timestamps sort in merge order. Each adds a case to the shared migration-chain test
  (`tests/unit/server/migrations.test.ts`, created by E3-4), which applies every migration in order
  to a database filled with the previous release's rows; CI runs
  `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`.
- **`resetData()`.** Derived from the schema (E3-1, `tests/schemaModels.ts`): it clears every model
  with a `userId` column, in foreign-key passes, and a test fails if one is skipped. A leftover
  `Disruption` would otherwise turn every later spec's plan into a plan with a rest window.
- **E2E numbering.** New specs take the next free number at merge (`NN-*.spec.ts`), never a
  pre-claimed one. Playwright blocks service workers (`serviceWorkers: 'block'`) for every spec
  except the offline spec.
- **Whose today.** The server's local day (`todayIso()`) is "today" everywhere. `TodayView` carries
  `date` and `tz`; the service worker and every sheet take their dates from it, never from the
  device clock. While the runner travels, the app follows the home server's day; this is a recorded
  limitation, not solved in 3a.
- **Offline writes.** Only idempotent PUTs may be queued offline: the check-in
  (`PUT /api/checkins/:date`) and the fuel log (`PUT /api/fuel/logs/:activityId`), through E2's
  `web/pwa/outbox.ts` allowlist. Logging a run, plan edits and disruptions need a connection and say
  so; forms keep unsent values on the device.
- **Request pipeline** (E3-8, recorded in CLAUDE.md). No JSON body parser runs before authentication
  except the 16 KB parser on `/api/setup` and `/api/auth` and the token-checked routers, which
  verify their token first: `/api/ingest/:provider` (then its 16 MB parser) and
  `GET /api/calendar/:token/plan.ics` (no body), both mounted before `sameOriginGuard` and
  `requireAuth`.

## 5. E3 Foundation: fast athlete state, reliable sync, one identity

### 5.1 Goal

Every screen answers from one cached, consistent picture of the runner, and that picture is
trustworthy. Today each of `/today`, `/plan` (zones), `/reviews`, `/predictions`, `/zones` and each
execution assessment re-reads 365 days of full activity rows, 60 days of wellness, 16 weeks of
reviews and a screening with sequential awaits, parses `hrHistogram` on every row and may call
Open-Meteo inside the request. Incredible here means: a warm `GET /api/state` is a 304 or a few
milliseconds of serialisation; a cold build is one parallel round of selective queries; no request
waits on the network for weather; no write (own connection, rolled back, or another process) leaves
a stale answer; the engine's output for the same data is byte-identical to before; and the runner
can see what the advice reads, when each source last ran and what it did.

E3 owns sections 4.1, 4.3, 4.7, the conflict helper, `isToRun`'s home, the model classification and
`resetData`. R0 (section 4.2) was split out of E3-9 and E5-1.

### 5.2 Stories

- The runner opens Today, Plan or Review and the screen appears without a multi-second wait.
- After logging a run, a sync, or a write by another process, the next screen already reflects it;
  no number comes from before the run or from a rolled-back change.
- The Integrations page says what the advice reads: "Training advice reads 214 activities, the
  latest on 21 Oct, and 41 days of wellness, the latest on 22 Oct."
- When Garmin runs out of its request budget, the card says "Read 12 of 30 wellness days" instead of
  a green "ok"; when wellness was not attempted because the backfill is still going, it says so.
- Each source's card lists its recent syncs (time, trigger, what was stored, what could not be
  imported and why), idle runs included.
- If the server was down at 03:00 on Monday, the week's update still runs when it comes back.
- "Make active" on another goal asks once, then builds the plan for that goal; the archived plan can
  be restored.
- A Monday re-plan that keeps a session on the same day and kind keeps its identity, so the workout
  on the watch is updated, not duplicated.
- A 1,200-run history pages ("Showing 50 of 1,284 activities") and Stats loads totals from the
  server.
- An unauthenticated client cannot make the server buffer and parse a 16 MB body.

### 5.3 Data model

- **Migration A, weather cache (E3-3).** `ForecastCache` (7-day hourly forecast per 0.1 degree home
  cell: integer `latE1`, `lngE1`, `hours` JSON, `fetchedAt`, `failedAt`, `lastError`; unique cell;
  non-state) and `ClimateCache` (race-window WBGT climatology per 0.01 degree race cell, `monthDay`,
  `startHour`, `windowHours`, `wbgtC`, `samples`, `yearsRead`, `complete`; state, so a memoised
  prediction cannot outlive its climate). Integer cells keep unique keys off float equality.
- **Migration B, plan session (E3-4), one migration for every `PlanSession` change.**
  `trimmed Boolean @default(false)` (derived from `rules` in exactly one function, `isTrimmed`, and
  backfilled from rules containing `design-4.3`, replacing a substring scan SQLite cannot index),
  `externalId String` (required; the generated table redefine is hand-edited to fill
  `lower(hex(randomblob(16)))` per row and copy every other column; fallback: nullable column,
  update and unique index, with null mapped to the row id), `@@unique([planId, externalId])`,
  `@@index([planId, weekStart, trimmed])`, `@@index([planId, status, date])`;
  `PlanRevision @@index([planId, reason])`; `Activity @@index([duplicateOfId])`. Acceptance includes
  applying it to a database whose sessions are linked to activities: the link must survive the
  redefine.
- **Migration C, sync log (E3-6).** `SyncRun` with user, provider, channel, `trigger` (schedule,
  manual, push, catchup), start and finish times, `status` (ok, partial, paused, error), counts
  accepted, duplicate and failed, `wellnessStatus` (none, read, truncated, waiting, error), wellness
  days and total, a scrubbed message, the first 10 failures as JSON and the import batch id, index
  `[userId, provider, startedAt]`. No row for a skipped run (already running, paused, not due).
- **Migration D** is R0's (section 4.2).
- **No migration for the data version**: the counter is in memory and nothing about the snapshot is
  persisted, because a persisted snapshot would need invalidating on every `PARAMS_VERSION` and
  engine change.
- Indexes considered and not added: `Activity [userId, type, date]` (the type filter is rare);
  wellness and review ranges are served by their existing unique indexes.

### 5.4 API

- `GET /api/state`: `StateView` (version, as of, built at, parameter version, state, zones,
  readiness, goal, plan, prediction, inputs) with
  `ETag: W/"<boot>.<n>.<external>.<today>.<PARAMS_VERSION>"`, `Cache-Control: private, no-cache`;
  304 on a matching `If-None-Match` before serialising. `inputs` (window sizes, activity and
  wellness counts and latest dates) is what E4 quotes.
- `GET /api/activities`: **Breaking:**
  `{ items: ActivityListItem[], total, limit, offset, nextOffset }`, `limit` 1-500 (100), `offset`;
  items omit `hrHistogram`; order date, start time, created, then `id` desc. Offset, not keyset
  (nullable `startTime`). `/:id`, `/:id/detail` and the CSV export are unchanged.
- `GET /api/stats`: `StatsView { monthly, yearly, efforts, longest }` from the existing pure
  functions over five-column rows, memoised by version.
- `GET /api/weeks`: Unchanged shape; activities load from 52 weeks before the first week, five
  columns; `streak3Plus` capped at 52 (no UI reads it, G5).
- `GET /api/weather/forecast`: Serves `ForecastCache` with `{ hours, fetchedAt, stale }`; a stale
  hit refreshes in the background (single flight); an empty cache awaits one fetch bounded to 5 s,
  else 502; 404 without a home. The only request path that may wait on Open-Meteo, because the
  runner asked for the forecast.
- `GET /api/integrations/:provider/runs`: `SyncRunView[]` newest first, `limit` 1-100 (20), scoped
  to the user; never secrets.
- `GET /api/jobs`: Section 4.7.
- `POST /api/goals/:id/activate`: `{ replacePlan: boolean = false }`. No v2 plan: flip `isActive`.
  Plan on this goal: flip only. Plan on another goal: 409
  `{ requires: 'replacePlan', planGoalId, planGoalName }` unless `replacePlan`, which generates the
  plan (old plan archived, ids carried, revision `goal-switch`). Done or dropped goals still 409.
- `GET /api/plan/archived`: Up to 5
  `{ id, goalId, goalName, raceWeekStart, archivedAt, restorable, reason }`; not restorable when the
  goal is done or dropped or the race date has passed.
- `POST /api/plan/archived/:id/restore`: In one transaction archive the current plan, reactivate the
  restored one and its goal, write revision `owner` "Plan restored"; then re-plan once (ids kept by
  pairing). 409 for a finished goal or a passed date; `replanned: false` with the checklist message
  when the re-plan is blocked.
- `POST /api/ingest/:provider`: Token verified before any byte is parsed, then the 16 MB parser; 401
  before 413; writes a `push` run.
- Plan routes: `PlanSession` gains `externalId` (opaque) in `GET /api/plan` and the session routes.

### 5.5 Engine

No new Param, no rule text, no change to any engine output. `engineInput.ts`'s local
`ACTIVITY_DAYS = 365` becomes `P.a5.historyWindowDays.value`. The 60-day wellness window, the
16-week review window and the climatology constants move unchanged (owner question Q12). New pure
code: `shared/domain/sessionIdentity.ts`, `shared/domain/sessionStatus.ts` (the latter's content is
E2-2's), `shared/domain/weeks.ts` (`STREAK_LOOKBACK_WEEKS = 52`, five-column `WeekCore`) and
`shared/domain/stats.ts` retyped to `StatsCore`. The snapshot is deep-frozen; any engine function
that sorts or pushes into an input array in place throws in tests and gets a local copy (no
behaviour change; the PR reports the count). Infrastructure constants (TTL, LRU sizes, refresh ages,
retention, page size, catch-up interval) are named constants at the top of their modules. After
E3-2, E3-7 and R0-1 the owner validation must report the STATUS result (0 of 15 checklist failures,
label "tight", 33 of 33 weeks, 3 × 20 first week, 9.2 h peak) with sessions identical apart from
`externalId`.

### 5.6 Providers

- `WellnessTruncated extends RateLimitPause` (`rows`, `daysRead`, `daysTotal`) in
  `server/providers/types.ts`; CLAUDE.md gains the contract that `listWellness` never returns a
  short list as complete.
- Garmin `listWellness` iterates newest first (readiness needs the latest days), returns ascending,
  and throws `WellnessTruncated` on `BudgetExhausted`. The sync stores the rows, records
  `lastSyncStatus: 'paused'` (not `ok`),
  `lastError = "Wellness stopped after <n> of <m> days: ..."`, and waits the hour the budget asks
  for. When the activity pass paused first, wellness is not attempted and the run records
  `wellnessStatus: 'waiting'`.
- "Wellness sync failed: ..." becomes "Wellness could not be read: ...".
- Open-Meteo stays outside the registry; `openMeteo.ts` gains `fetchClimateHours(fetchFn, ...)` and
  every Open-Meteo call takes an injected `fetch`. `Deps` gains optional `fetch`.

### 5.7 UI and copy

- **DataInUse** (`role="status"`) at the top of Integrations: "Training advice reads 214 activities,
  the latest on 21 Oct, and 41 days of wellness, the latest on 22 Oct." Singulars; "No wellness data
  yet."; "No activities yet. Connect a source or import a file."; " 3 flagged duplicates are left
  out."; error "The data summary did not load."
- **SyncHistory** in each connected provider card: a native `<details>` "Recent syncs", fetched on
  first open; rows "22 Oct, 06:00 · Scheduled" (Manual, Push, Folder scan, Catch-up, Sent to
  calendar) and one sentence from the pure `describeRun(run)`: "Stored 3 new activities, skipped 1
  already stored. Read 7 wellness days." / "Nothing new." / "Stored 5 new activities. 2 could not be
  imported." / "Paused to stay within the service's limits. Read 12 of 30 wellness days; the rest
  follow on the next run." / "... Wellness waits until the activity backfill finishes." / "Did not
  finish: <service text>" / "Sent 4 sessions, 2 unchanged."; a nested disclosure "Show the N that
  could not be imported"; empty "No syncs recorded yet."
- **Activities** pages 50 at a time: "Showing 50 of 1,284 activities" (`role="status"`) and "Show 50
  more"; a failed page: "More activities did not load. Try again." **Stats** reads `GET /api/stats`.
- **Make active** opens an inline confirm when a version-2 plan follows another goal: "The plan
  follows <Old goal>. Making <New goal> active builds a new plan for it. The current plan is
  archived, not deleted, and targets you set by hand do not carry over." Buttons "Build plan for
  <goal>" and "Cancel"; focus moves to the text and returns on Cancel or Escape. Restore note: "The
  plan for <Old goal> was archived on 22 Oct." with "Restore this plan".

### 5.8 Jobs

The 10-minute weather job ends with `refreshWeatherCaches`: forecast cells older than 60 min,
climate rows missing, incomplete or older than 30 days, a 15-minute back-off after a failure, old
data kept; a forecast older than 24 h is treated as absent. Profile and goal writes that change a
location, date, start time or distance warm the cache in the background; plan generation awaits
`ensureClimate` for up to 8 s (owner question Q13). Read paths never fetch. The scheduler's job
wrappers record `job` runs; the catch-up is section 4.7.

### 5.9 Tests

Unit: pairing (kind change, date change, two of a kind, added strength does not re-pair,
order-independence), data version (every write kind, transactions, rollback bumps, BigInt pragma,
second connection), model classification, no raw writes, snapshot (single flight, reuse, rebuild on
write, other connection, day change, TTL, overlap not stored, rolled-back transaction leaves no
stale snapshot, frozen input, climate invalidates the memoised prediction), Garmin truncation,
weather cache, `safeMessage`, `describeRun` through the shared lint. API: state (304, ETag after a
write, second client seen, warm equals cold plan), no network in Today, predictions or plan,
activity paging and the envelope fallout (helpers `activityPage(items)` and
`listActivities(ctx, query)` absorb it across eleven web and seven API files), stats, batched week
queries (one `findMany` for 26 weeks), body-parser order (401 before 413), sync log, jobs and
catch-up, session identity (unchanged plan keeps every future id across a Monday re-plan; linked
activities stay linked), activate and restore, and the migration-chain cases. Web: DataInUse,
SyncHistory, paging, stats, the activate confirm. E2E `NN-foundation.spec.ts`: Make active builds
the plan; paging; conditional `GET /api/state` that follows a write by another process; the
DataInUse sentence; 360 px cases.

### 5.10 Risks

- The Prisma 7 query extension must fire for nested and in-transaction writes with
  `PrismaBetterSqlite3`, and the proxy must not break delegates; E3-1 proves it first, with a
  documented fallback (explicit bumps in the same wrapper layer, a request middleware, the scheduler
  wrappers; callers elsewhere still never bump).
- A stale answer after a write is the worst failure; the defence is the hook, the transaction-end
  bump, not storing builds made during a transaction, `PRAGMA data_version`, the TTL, the
  classification test and the raw-write test.
- Deep-freezing surfaces in-place mutation in engine code; the number of sites is unknown until E3-2
  runs the suite.
- Better-sqlite3 is synchronous, so `Promise.all` gives no multiple; the gain is the cache. The PR
  reports measured cold and warm timings; no CI timing assertion.
- The `PlanSession` redefine runs in the Docker build; a wrong hand edit loses sessions or links.
  The chain test on linked data, the drift check and the nullable fallback bound it.
- The activities envelope breaks any external script that read the bare array; the CSV export is the
  bulk route.
- Other epics can still bypass the snapshot; the CLAUDE.md rule and acceptance lines are the only
  enforcement besides the raw-write test, so reviewers check it.
- The global counter invalidates every user's snapshot on any write; irrelevant for one runner.

## 6. E1 Sessions on the wrist

### 6.1 Goal

The runner heads out and finds today's session already on the watch, with the right steps and
limits, never re-typed. Within about two minutes of any plan change (weekly re-plan, an owner move,
a zone change, a check-in that eases today, an undo, a rest window) the next 14 days of run sessions
on intervals.icu match the app, and intervals.icu's Garmin upload carries them to the watch. Easy
runs carry one heart-rate ceiling, intervals a pace band per rep and an open recovery, long runs the
fuel line from E6. An eased session replaces the planned one on the same event and a rest advice
withdraws it. Each session shows an honest status. Two fallbacks need no third party: a FIT workout
file per session and per week, and a private calendar feed whose titles carry no health data. One
provider-neutral `WorkoutPlan` is rendered three ways (intervals.icu text, FIT, ICS), so the routes
cannot disagree.

### 6.2 Stories

- After the weekly re-plan or a move, the watch shows the new version within minutes, with nothing
  to do.
- An easy run carries one heart-rate ceiling, not a 52-149 band; interval reps carry a pace band and
  the recovery is open.
- On a day a check-in eases a hard session, the easy version replaces it on the watch with the
  description "Eased for today", never the reason; a rest advice removes it.
- A long run of 2 h or more carries tonight's fuel line.
- Every session on Plan and Today says whether it reached intervals.icu and the watch, and if not,
  why and what to do, without red or "failed".
- When intervals.icu or Garmin is down, a `.fit` per session or a `.zip` per week goes on the watch
  by USB or import.
- A private calendar URL shows the next 28 days with titles such as "Easy run, 45 min", never an
  injury, illness or reason, and can be revoked.
- Publishing is switched on explicitly, with a tick for "intervals.icu uploads planned workouts to
  my Garmin Connect", and can be switched off with an offer to remove what was sent; disconnecting
  intervals.icu offers the same.
- An event deleted by hand in intervals.icu is not recreated.

### 6.3 Data model (migration `wrist_delivery`, E1-4)

```prisma
// One row per user and delivery channel. Non-state.
model DeliveryChannel {
  id             String    @id @default(cuid())
  userId         String
  channel        String    // 'intervals' | 'calendar'
  enabled        Boolean   @default(false)
  garminLinked   Boolean   @default(false) // intervals: the runner ticked the Garmin upload
  dataKey        String?   // intervals: the composed change key the last run saw
  lastRunAt      DateTime?
  pausedUntil    DateTime?
  referenceJson  String?   // intervals: { maxHr, lthr, thresholdPaceMps, readAt }, 6 h cache
  tokenHash      String?   @unique // calendar: SHA-256 of the feed token; the token is never stored
  tokenCreatedAt DateTime?
  updatedAt      DateTime  @updatedAt
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, channel])
}

// What the remote holds, or should hold, for one session identity. Non-state.
model WristPublication {
  id            String    @id @default(cuid())
  userId        String
  channel       String    // 'intervals'
  externalId    String    // PlanSession.externalId; joined by it, no foreign key
  date          String
  kind          String
  variant       String    @default("planned") // 'planned' | 'eased'
  title         String    // the allowlisted public title sent
  remoteId      String?
  state         String    // 'pending' | 'sent' | 'failed' | 'withdrawn' | 'owner-removed'
  desiredHash   String
  sentHash      String?
  failCode      String?
  failMessage   String?   // sanitised, max 200
  deviceMessage String?   // sanitised, max 200
  warnings      String    @default("[]")
  attempts      Int       @default(0)
  nextAttemptAt DateTime?
  sentAt        DateTime?
  updatedAt     DateTime  @updatedAt
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, channel, externalId])
  @@index([userId, channel, date])
}
```

Settings live on `DeliveryChannel`, not in `Integration.config`, because a reconnect replaces
`config` wholesale. Publications have no foreign key to `PlanSession`; they join by `externalId`,
which pairing carries across a regenerate. Run history is `SyncRun` (channel `publish`), not columns
here. Both tables are non-state: if the publisher's own writes bumped the data version, every run
would trigger the next. Withdrawn and owner-removed rows older than 60 days are pruned.

### 6.4 API

- `GET /api/plan/sessions/:id/workout.fit`: Attachment `2027-03-02-easy-run.fit` (date and
  allowlisted kind slug, never the title), `no-store`. 404 outside the active plan; 409 for rest,
  strength, race or mobility; 409 when not `isToRun`; 409 "Rest is the better choice today, so there
  is no workout file." Built by `buildDeliverables`, so it holds the eased version and current-zone
  targets.
- `GET /api/plan/weeks/:weekStart/workouts.zip`: One FIT per publishable to-run session of the week
  (`-2` for a second of a kind on a day); Monday check; 409 when empty.
- `GET /api/wrist/status`: `from`, `to` (default today to +13, span at most 60 days, else 400);
  `WristStatus` joined by `externalId`, with synthetic `not-sent` items while publishing is on. "On
  your watch" only when `garminLinked`, no device message and 15 minutes have passed since sending.
- `PUT /api/wrist/intervals`: `{ enabled, garminLinked, removeSent? }`; 409 with
  `requires: 'connect-intervals'` or `requires: 'reconnect-intervals'`; enabling starts a tracked
  background run; disabling with `removeSent` withdraws.
- `POST /api/wrist/publish`: `{ sessionId? }`, 202, "Send again" (clears that session's back-off);
  one run per user at a time.
- `DELETE /api/integrations/intervals?removeSent=`: Before deleting the key, withdraws when asked
  (20 s cap; 409 `{ code: 'remove-failed' }` keeps the integration), then disables the channel and
  marks rows withdrawn with `remoteId` kept for later re-adoption.
- `POST` and `DELETE /api/wrist/calendar/token`: Create or rotate (the plain token returned once,
  its hash stored) and revoke.
- `GET /api/calendar/:token/plan.ics`: Mounted before `sameOriginGuard`, `requireAuth` and any
  parser; hash lookup then `tokensEqual`; 404 with the unknown-route body for a wrong token; today
  to +27, all-day events, UID `<remote external id>@running-log`, `DTSTAMP` the newest `updatedAt`
  (never the clock), `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; the access log redacts
  the token.

### 6.5 Engine

- Section 4.6's shared semantics are imported, not redefined.
- `shared/workouts/` (pure, no Node imports): `WorkoutPlan`, `WorkoutStep`, `WorkoutNode` types;
  `publicTitle(session)` from a closed allowlist keyed by kind and duration only ("Easy run, 45
  min"; a run-walk ladder is "Easy run"); `publishable(kind)` (run kinds, not race, strength,
  mobility, rest or cross); `toWorkoutPlan(session, targets, { eased, fuelLine, units })`, which
  maps engine steps to repeats (work and recover with equal reps become `repeat(n)`; `bouts - 1`
  recoveries become `repeat(n - 1)` plus a trailing work step), chooses a target per step (easy,
  recovery, long, b2b, hike: heart-rate ceiling; quality work: pace band; recoveries, strides and
  hills: open; steps under `P.o1.hrTargetMinStepSec` never carry a heart-rate target) and writes a
  description whose numbers equal the steps.
- New Params (`shared/engine/params/o-delivery.ts`, rule O1): `o1.hrFloorBpm` 40 (D; the lower edge
  written with a ceiling, so the watch alerts only above it) and `o1.hrTargetMinStepSec` 180 (D;
  `bent-2020-ppg-inaccuracy`, `gillinov-2017-wearable-hr-aerobic`). Rule O1 "Targets on the device"
  joins `research/engine-rules.md` as section (o). Delivery plumbing (horizons, grace period,
  back-off, chunk size, name caps) are named constants, not Params.
- `encodeWorkoutFit(plan, { createdAt })` in `server/services/workoutFit.ts` (server only, because
  it imports `fit-file-parser`): `file_id` type 5, `workout` (msg 26, sport running), `workout_step`
  (msg 27) with field numbers verified against the FIT SDK profile; durations in ms or cm, speed in
  mm/s (low = slow), heart rate as bpm + 100, repeat steps by first-step index and count. `fitText`
  derives each string field's size from the folded byte length plus the terminator, as the encoder's
  `validateField` requires; names cap at 15 bytes and notes at 49. Output is byte-identical for
  identical input.
- `renderIntervalsDescription` (percent of max heart rate rounded down, percent of threshold pace,
  absolute numbers in a header line; open steps with a warning when a reference value is missing)
  and `renderIcs` (titles from `publicTitle`, an outline with effort words and no bpm or pace, RFC
  5545 escaping and folding).
- `buildDeliverables(deps, userId, { from, to, today })` is the single builder for the files, the
  feed and the publisher: it reads `loadAthleteContext` once, the cached forecast through the shared
  peak helper, `todayAdvice` for today only (tomorrow is never pre-eased: J3 is a statement about
  today), `easedSession` for `downgrade-easy`, a `withdraw` variant for `rest`, `isToRun`,
  `publishable`, `resolveTargets`, and fuel lines from one call to E6's `loadFuelContext` plus the
  pure `fuelLineForSession` (a stub returning nothing until E6-5).
- `contentHash` covers a `DELIVERY_VERSION` constant (bumped when a renderer changes), the date and
  the rendered content, so a move republishes.

### 6.6 Providers

ADR 0008 (section 4.4). `intervals.info.channels = ['pull', 'publish']`; there is no `calendar`
registry entry (it would render a generic provider card with Disconnect and a sync history).
`server/providers/intervalsPublish.ts`:

- `reference` reads the Run entry of the athlete's sport settings (defensive about field names; the
  first live run verifies them);
- `upsert` sends new events in one `POST .../events/bulk?upsert=true` (chunks of 50) and known ones
  as `PUT .../events/{remoteId}`, because the documented upsert matches only events created by the
  same OAuth application;
- a 404 on PUT means the runner deleted it (`owner-removed`, not recreated until the content
  changes); 429 throws `RateLimitPause`; 401 or 403 asks to reconnect; 400 or 422 is `rejected` with
  a trimmed message stripped of any key echo; `push_errors` become the device message; an empty
  `workout_doc` adds the `unparsed-steps` warning;
- `withdraw` uses `bulk-delete`; `list` reads the horizon to detect owner deletions, read device
  errors and adopt orphans with the `rl-<userTag>-` prefix.

A run costs one cached reference read, one list and at most two bulk calls (the key limit is 2,500
per 15 minutes).

### 6.7 UI and copy

- **Status chips** (text, never colour alone; `title` equals the sentence): "Waiting to send" /
  "Sent to intervals.icu" / "On your watch" / "Not delivered" / "Removed in intervals.icu" / "Not
  sent yet". Sentences by code, for example "intervals.icu did not accept the API key. Reconnect it
  on the Integrations page.", "intervals.icu asked the app to wait. It tries again at 14:20.",
  "Garmin Connect did not take it: <message>.", "You removed this one in intervals.icu, so the app
  leaves it alone." With no threshold pace the session is sent with a note: "intervals.icu has no
  running threshold pace yet, so pace targets are written in the text of each step only. Set it in
  intervals.icu under Settings, Run." Actions "Send again" and "Download the workout file".
- **Plan page.** A strip "Watch: next 14 days. 11 on your watch or sent, 2 waiting, 1 not
  delivered." with "Send again" and "Download this week as .zip"; compact chips on run sessions in
  the window; a session sheet section "On your watch" (eased note: "Today's readiness eased this
  session. The watch has the easy version; this page keeps the plan."). The sheet's targets come
  from `resolveTargets` ("Heart rate: under 142 bpm"). With publishing off: "Sending to your watch
  is off. Download the workout file, or turn it on under Integrations."
- **Today** (E2's `watch` slot, 24 px): one line, "On your watch." / "Sent to intervals.icu." / "The
  watch has the easy version of this run." / "Not on the watch yet: <short reason>. Download the
  workout file."; `role="status"` only when the state changed since the page loaded. A problem with
  tomorrow's session becomes a health note, not a second banner.
- **Integrations.** The intervals.icu card gains "Send sessions to your watch": "Send my next 14
  days of runs to intervals.icu" (off by default), "intervals.icu uploads planned workouts to my
  Garmin Connect" (help: "In intervals.icu open Settings, Garmin Connect, and switch on uploading
  planned workouts. The app cannot check this."), the last send line from `SyncRun`, "Send now",
  "Also remove the sessions already sent", and the note "intervals.icu closes accounts that are not
  logged in to for a long time. Log in now and then so the plan keeps reaching your watch." A
  standalone "Calendar link" section (no Disconnect, no sync history): create, copy, open as
  `webcal://`, turn off, and "Anyone with this link can read your session titles and durations.
  Titles name the kind of run only. The calendar shows the next 28 days; the watch gets the next 14.
  ..."
- **Offline.** `/api/wrist/status` is not cached by the service worker (a cached "On your watch"
  would be false); offline, the chips and line render nothing and the download links stay.

### 6.8 Jobs

`every('publish', 2 min)` runs `publishForUser` when the composed key changed, a publication's retry
is due, or 30 minutes passed; `daily('publish-morning', 04:45)` forces a run after matching and the
Monday re-plan. `publishForUser` (single flight per user): load the integration and channel; build
deliverables for today to +13; read the reference (6 h cache); list the horizon (owner removals,
adoption); upsert new or changed content before withdrawing anything (no day without a session);
withdraw rows no longer desired (skipped, rest advice, removed sessions); store outcomes; record one
`SyncRun`. Back-off: network and rate-limit errors retry at `min(2^attempts, 60)` minutes without a
cap; `rejected` retries twice and then waits for new content or "Send again"; `auth` stops the
channel and marks the integration `needs_auth`; device errors stay visible until `push_errors`
clears. Undo, dial-back and rest windows reach the watch through the data version with no call from
E4 or E5.

### 6.9 Tests

Unit: `publicTitle` over every kind and flag finds no injury, illness, pain, return, post-race,
eased or run-walk word; `toWorkoutPlan` for every library kind (totals equal minutes, ladder frames
excepted); FIT decode round-trips (fields, units, repeats, string sizes for ASCII and non-ASCII,
byte-identical output, a synthetic golden file); intervals.icu module against `fakeFetch` (every
status path, chunking, no global `fetch`, no key in any message); ICS (folding, escaping, UID,
deterministic `DTSTAMP`, no numbers, health-free titles); the cross-surface registry entries. API:
download routes; publish runs (14 days only, no write when unchanged, in-place PUT for a move,
create-before-withdraw, skip and rest withdraw, eased replaces, tomorrow not pre-eased, fuel line
after a move, owner removal not recreated, 429 pause, 401 needs_auth, rejected stops, device errors,
on-watch rule, disable and disconnect with removal, a run leaves the data version unchanged, one
`SyncRun` per run, the change key); feed (no cookie, 404 after rotation, no health words with
injury, illness and pain seeded, token absent from the log). Web: every chip state through the
shared lint, offline renders nothing, Plan strip and sheet, settings and calendar link. E2E
`NN-wrist.spec.ts`: file and zip downloads, calendar link created, fetched without a cookie and
revoked, the "sending is off" sentence. Manual, recorded in PRs without account data: one easy, one
interval and one long file loaded on the owner's watch (E1-3); one live intervals.icu run confirming
the sport-settings fields, percent-pace parsing, the 40 bpm floor, external-id behaviour for an API
key and a date change by PUT (E1-4).

### 6.10 Risks

- intervals.icu text syntax is only partly documented; the `unparsed-steps` warning, the FIT
  download and the live smoke test bound it. Fallback if percent pace does not parse: publish the
  FIT through the events endpoint's file field.
- An API-key caller may not re-match by `external_id`; the stored `remoteId` is the key, and a lost
  database adopts orphans by prefix when the remote echoes the id.
- "On your watch" cannot be observed; it needs the runner's tick, no device error and 15 minutes. A
  wrong tick gives a false status; the help text states the dependency.
- Three FIT details (repeat target type, manufacturer 255, string caps) are unverified until a real
  watch loads a file; the route is harmless if a watch rejects one.
- A title could leak health information; the allowlist and the seeded scan guard it. The token sits
  in a URL path: hashed storage, redacted logs, no-referrer and revocation bound it, and the copy
  says reverse-proxy logs are out of reach.
- E1 sits behind E3 on the critical path; the fallback if E3-7 slips is to hold E1-5, never a
  derived id.
- intervals.icu closes dormant accounts; the card says so and the files and feed remain.

## 7. E2 Today, rebuilt as a coach

### 7.1 Goal

In ten seconds at 6 a.m. the runner knows what to run, how hard, whether to back off, and why. Today
becomes one server-composed coach view rendered as a readiness read (a verdict plus the two or three
signals behind it, with a one-tap check-in that folds away), a session hero (the duration as the
display figure; heart-rate ceiling or band, pace as a guide, effort; climb note; cooler start; Done,
Explain, Not today), a week strip with hours under it, a "what changed" line, and the race countdown
with the prediction range, labelled wide on purpose for ultras (L4). At 390 × 844 the title, display
figure, targets and Done are visible without scrolling even with the check-in unanswered and every
slot filled to its budget; the page needs one API call plus settings instead of six; and the
installed app opens, shows today's session and its explanation with the network off, and keeps a
check-in tapped offline until the connection returns. Desktop shows two columns.

### 7.2 Stories

- The first screen shows today's session as a duration, a title, a heart-rate ceiling or band, a
  pace guide and an effort range; no sheet is needed to find the steering number.
- With a hard session planned and a poor night, one row ("How do you feel today?": Fresh, Good,
  Normal, Tired, Drained) re-reads readiness in place: "An easy run is the better choice today.",
  the hero shows the eased session with its ceiling, and the signals are named. Readiness never adds
  load.
- On a warm day: "Cooler start: 06:00. WBGT about 17 C then, 25 C around 15:00." On a
  hot-for-steering day the targets lead with effort, the same test the watch uses.
- Done confirms the planned minutes and distance (prefilled) with RPE and feel; Not today moves or
  skips with "A skipped session is not made up later."; Explain opens the why drawer.
- The week strip shows done, today and ahead with run hours under it; tapping a day opens its sheet.
- For a 100-mile goal: days to the race and an explicitly wide finish range (grade D).
- After Monday's update, one line shows what changed, with Details.
- At a trailhead with no signal the installed app opens today's session (including a preview of
  tomorrow fetched the evening before) and says it is offline and when the data was saved.
- On a laptop, Today uses two columns.

### 7.3 Data model

None. Today reads existing rows; the check-in row writes `WellnessDay.fatigue` through the existing
`PUT /api/checkins/:date`. Client-side only: localStorage keys `rl_today_more` and
`rl_done_draft_<date>` (in try/catch), the IndexedDB outbox `rl-outbox`, and the Cache Storage
caches `rl-shell-<buildId>` (two generations kept), `rl-api-v1` and `rl-meta`. Health data in
`rl-api-v1` and `rl-outbox` is purged on logout and on any 401 (ADR 0012).

### 7.4 API

- `GET /api/today` gains `tz` (the server's IANA zone) and `coach: TodayCoach`: generated at,
  preview flag, verdict, up to three signals, the hero (session, advice, reasons, eased session,
  target, linked run, other sessions), the next session, the week strip, the race countdown (with
  `wide`, the minimum half-width and its rules), the change line (the stored revision summary),
  health (counts plus notes from registered producers) and the slots; `heat` gains `peakHour`,
  `coolerValue`, `index`, `hotForSteering`. `?date=` accepts today or up to two days ahead (else 400
  "Use today or one of the next two days."); a future date returns `preview: true`, no verdict and
  no signals, and never runs readiness with a future today. Later epics add fields only under
  `TodayCoach` (`slots`, `health.notes`, `fuel`, `disruptions`).
- Slot providers (`server/services/todaySlots.ts`) run under `Promise.allSettled`: a throwing
  provider leaves its slot null and the route succeeds; providers receive the requested date.
  Health-note producers (`server/services/todayHealth.ts`) are registered by E3 (sync paused, weekly
  update not run) and E1 (tomorrow's session not on the watch).
- The service takes its inputs from `loadAthleteContext` and the forecast cache; there is no
  fallback gather and no request-time forecast fetch.
- Static: `sw.js`, `manifest.webmanifest` and four PNG icons; `sw.js` and the manifest are served
  with `Cache-Control: no-cache`.

### 7.5 Engine

Section 4.6 is E2-2. E2-3 adds pure Today pieces:

- `readinessSignals(input, date)` (noted signals first: illness, pain, HRV, resting HR, sleep,
  check-in; at most `SIGNAL_LIMIT = 3`; HRV shown in ms with the usual range from
  `exp(mean ± P.j4.sdBelowMean × sd)`, "building your usual range (7 of 10 readings)" below
  `P.j4.minReadings`) and `readinessVerdict`; `restingHrEval` split from the private flag helper
  with no behaviour change (before E5-3's `illnessGate` split).
- `rangeLabel(target)` reusing the L2, L4 and L6 floors; `weekStrip` over an exhaustive status map
  (past planned days read "planned, no run logged"); `formatEstimate`; `isoDateInZone(now, tz)`.
- One new Param: `h4.climbNoteGainPerHourM` 150 m/h (D, rule H4,
  `hingrand-2023-power-vs-ascent-speed`, `jeker-2020-vertical-speed-ultra`). Rule I7 widens to "a
  cooler time of day for a run" (owner question Q4); the edit goes through `research-update`.
- No `changeLine` formatter: the line shows the stored revision summary (section 4.5).
- The owner validation after E2-2 must give byte-identical plans.

### 7.6 UI and copy

**Component tree** (`web/components/today/`, one CSS module each; `DashboardPage.tsx` becomes a
composer under 200 lines):

```
DashboardPage            useToday(), useSettings(); two columns from 900 px via useMediaQuery
  PageHeader "Today" + date; quiet "Log activity" link
  OfflineNote, HealthNotes (red-flag notes, unchanged copy)
  <TodaySlot name="disruption" budget=64>          E5 DisruptionBanner, or the "Set a rest window?" prompt
  ReadinessRead: Verdict (role=status) · SignalTokens · CheckinRow (radiogroup, folds away)
  SessionHero (<article> named by the title)
    HeroFigure · SessionTargets (<dl>) + <TodaySlot name="fuel" budget=26> (E6 FuelTargetLine)
    CoolerStart · KnowToday (<details> "What to know today") · WhyLine
    SessionActions: Done | Explain | Not today
    <TodaySlot name="watch" budget=24>             E1 WristLine
    AlsoToday (strength, mobility)
  WeekStrip (7 cells, Meter, caption, advisory line)
  <TodaySlot name="brief" budget=52>               ChangeLine until E4's BriefLine
  <TodaySlot name="fuelPrompt">                    E6 FuelPromptCard (below the fold, unbudgeted)
  RaceCountdown · FeedbackCard · DataHealth · RecentWeeks · DisclaimerNote
```

`TodaySlot` renders `<div data-slot data-budget-px>` only with content, so an empty slot costs zero
height. Above-the-fold slots read `coach.slots.<name>`; a slot whose data is missing offline renders
nothing. Each owning epic's e2e asserts its real content fits its budget at 360 px.

**Measured fold.** Estimated heights put Done's bottom edge at about 662 px unanswered on a warm day
with no slots, about 752 px with the disruption and fuel slots filled (inside the 788 px Playwright
viewport above the tab bar), and about 666 px answered with slots filled (inside 707 px in a
standalone PWA). E2-7 measures, not assumes: Done's bottom ≤ 788 at 390 × 844 unanswered with every
slot stubbed to its budget, and ≤ 707 at 390 × 707 answered.

**Copy** (templates in `shared/copy/today.ts`):

- Verdicts: "Ready as planned." / "Signals are a little low. Today's session is already easy, so it
  stays." / "An easy run is the better choice today." / "A rest day is the better choice today." /
  "Recent signals have stayed low for several days. A lighter week may help." / "No readiness
  signals yet. One tap below adds the first."
- Targets: "Heart rate: under 149 bpm" / "Heart rate: 149 to 165 bpm" / "Pace: about 9:20 to 10:28
  /mi. Effort and heart rate come first." / "Effort: 3 to 4 out of 10"; hot: effort first "(go by
  this today)" and "Heart rate: under 149 bpm. It runs high in heat."
- Eased: "Planned: Threshold, 50 min" muted above the eased "Easy run"; rest: "Rest day." with
  "Planned: Threshold, 50 min. Not today."
- Race: "Finish estimate 27 h 40 min to 36 h 20 min, most likely about 31 h 50 min." and "The range
  is wide on purpose. Predictions for 100 miles rest on thin evidence (grade D)."
- Done sheet: "Log today's run", "Planned: 45 min, 5.00 mi. Change anything that differs.", toast
  "Run saved"; offline: "Needs a connection. Your entries stay on this phone."
- Check-in: "Checked in: normal." with "Add more", and "Something hurts, or I'm ill" one tap away
  (pain and illness drive n-1 to n-3); offline: "Checked in: tired. Saved on this phone."
- Offline: "Offline. Showing the session saved at 06:12." / "Offline. This session was saved on Wed
  21 Oct. Today's is not loaded yet."

**Offline shell** (E2-8, hand-written `web/sw/sw.js`, no workbox). Precache the shell (entry chunk,
static imports, CSS, icons, latin fonts) under a build id; network-first with a 2.5 s timeout for
navigations and an API allowlist of exactly `/api/auth/me`, `/api/setup`, `/api/settings`,
`/api/today` (with or without `?date=`) and `/api/research/params`; 200 GETs only; a 36 h TTL (14
days for research params); a 401 clears `rl-api-v1`; the today fallback picks the cached entry whose
date is today in the cached `tz`; a throttled warm (once per 10 minutes) also fetches tomorrow's
preview. Update safety with the first lazy chunk (the recent-weeks chart): two shell generations are
kept and `/assets/*` is served from any of them, and `main.tsx` reloads once on `vite:preloadError`.
PNG icons (192, 512, maskable 512, 180) are rendered from `icon.svg` by Playwright chromium (no new
dependency); the manifest gains `id`, `scope` and two shortcuts. Settings shows "Offline use: ready
/ installing / not available (needs https)".

**Outbox** (`web/pwa/outbox.ts`): IndexedDB queue for allowlisted idempotent PUTs, coalesced by URL,
replayed oldest first on `online` and on foreground; a 4xx drops the entry with one inline message;
entries older than 7 days drop; purged on logout and any 401. E6 registers the fuel log in the same
allowlist array.

### 7.7 Jobs

None on the server. `useToday` refetches on focus, and `useServerToday()` refetches when the cached
`date` is no longer today in the server's zone.

### 7.8 Tests

Unit: readiness signals and verdict, eased session, targets, the cross-surface registry, heat
(cooler hour for any run, peak, `isHotForSteering` at 25 C and the flag, not at 20 C, never from air
temperature alone), `isToRun`, `rangeLabel`, week strip, `isoDateInZone` across midnight in another
zone, copy through the shared lint, the service-worker build plugin and the worker's rules in a `vm`
sandbox, PNG IHDR sizes. API `today-coach.test.ts`: shape, eased and rest cases, linked runs, the
race block following the plan's goal, health parity with the old client computation, slot failures,
preview read-only and 400 bounds, no network. Web: every hero variant, actions, check-in and outbox,
week strip, race, change line, slots, layouts, rollover. E2E `NN-today.spec.ts`: the two fold
measurements with every slot filled, one-tap check-in, Done, Not today, Explain, two columns with
the hero first in tab order, offline open with a check-in kept and sent, logout clears caches; the
360 px case.

### 7.9 Risks

- Hero overload; mitigated by folding, the disclosure, fixed slot budgets and the measured fold.
- Device caches hold health data; purge rules, TTL and ADR 0012 record it; a shared unlocked device
  remains the same exposure as the open page.
- Service workers need https or localhost; plain-http LAN installs get no offline shell and Settings
  says so.
- The two-generation update safety is unverified on a real device; iOS may evict caches and a queued
  check-in for a Safari tab not used for days.
- Today follows the server's day while the runner travels.
- Moving health counts server-side could regress silently; a parity test pins them before the client
  code is deleted.

## 8. E4 Explanations from the runner's own numbers, and a weekly brief

### 8.1 Goal

Asking "why?" about any number, session, warning or plan change gets an answer about the runner that
the runner could argue with. Every Explain opens with "From your numbers" (the figures the engine
read, in the runner's units, each with dated, linked sources, or a plain statement of what data is
missing) before the rule, grade and papers; parameter values read in plain words ("20% of the
duration", not "0.2 fraction of duration"); a Monday brief opens the week (what changed and why,
what the plan noticed, the next key session with the same target the watch shows) and presents R0's
revision with its undo; a "What stood out" card on every run gives up to three neutral facts. One
copy system and one lint sit behind all of it (section 4.5).

### 8.2 Stories

- Why on a long run first shows the longest run of the last 30 days with its date, last week's
  running time and the zone anchors with their sources, then the rule and papers.
- With too little data the drawer says what it needs and what it counts: "Not enough data yet:
  critical speed needs 3 efforts between 400 m and 5 km in the last 90 days; 2 found. Zones use
  heart rate and effort until then."
- A runner using miles sees miles and feet everywhere, including parameter values.
- On Monday one page says what changed and why, citing last week: "Last week you ran 212 of 240
  planned minutes. The plan holds steady: next week is up to 220 min."
- Each changed session shows before and after with its cause and a Why.
- Undo is one tap; when unavailable, the page says which session or sign blocks it.
- The brief names up to four noticed facts with the dates they rest on, and the next key session
  with "Readiness can only make this session easier on the day, never harder."
- Every run has a "What stood out" card.

### 8.3 Data model

- No `PlanRevision` columns: R0 owns them (including `decision` and `seenAt`). `PlanRevisionView`
  gains derived `causes` per diff line.
- **`WeeklyBrief`** (migration, E4-5; non-state): `userId`, `weekStart`, `planId` (plain column),
  `revisionId` (unique, `onDelete: SetNull`), `version` (`BRIEF_VERSION`), `facts` (JSON
  `BriefFacts`, no prose), `provisional`, `generatedAt`; unique `[userId, weekStart]`. A brief is
  seen when its revision's `seenAt` is set (or it has no revision); it has no seen column.
- **`ActivityInsight`** (migration, E4-7; non-state): `activityId` (primary key, cascade), `version`
  (`STANDOUT_VERSION`), `facts` (JSON), `computedAt`; stale when the version differs or the activity
  changed after `computedAt`.
- Shared shapes: `Quantity`, `SourceRef` (kind: activity, check-in, wellness, profile, session,
  review, screening or disruption; id; date; label),
  `InputFact { id, template, slots, rule, sources, moreSources, state: 'used' | 'insufficient', window? }`.

### 8.4 API

- `GET /api/explain`: Query is a Zod discriminated union on `subject`: session, week, decision,
  readiness, zone, prediction, rules (up to 12), brief, activity. 200
  `ExplainView { subject, asOf, frozen, rules, groups: [{ rule, facts }], rest }`. Reads
  `loadAthleteContext` and `memoByVersion` (heart-rate model, weekly decision) only; brief and
  activity subjects read frozen inputs. 404 for another user's records.
- `GET /api/brief`: `weekStart?` (default the server's current week); `{ brief }`, a `BriefView` or
  null, with `facts`, `seen`, `provisional`, the revision with R0's undo state, `since` (later
  revisions on the plan), `prev` and `next`. A missing current-week brief is built provisionally; a
  past week is never built on demand.
- `GET /api/briefs`: `limit` 1-52 (12); slim items with `decision`, `changeCount`, `undone`,
  `nextKey` for the history strip and Today's brief line.
- `POST /api/briefs/:weekStart/seen`: 204; stamps R0's `seenAt` on the brief's revision and its
  `since` revisions.
- `GET /api/activities/:id/standout`: `StandoutView { items (at most 3), more }`, computed lazily
  from the snapshot and the memoised heart-rate model (not `execution.ts`'s private `buildContext`),
  stored, recomputed after a rating, an edit or a version change; strength and cross return none.
- Revision routes: R0's (section 4.2); E4 renders every `UndoReasonCode` through one exhaustive
  `Record`.

### 8.5 Engine

- Display caps are constants in `shared/copy/limits.ts` (`EXPLAIN_MAX_SOURCES` 5,
  `STANDOUT_MAX_CARDS` 3, `BRIEF_MAX_NOTICED` 4, `KEY_LOOKAHEAD_DAYS` 7). Data thresholds are Params
  in `shared/engine/params/o-explain.ts`, rule `design-explain`, grade D with "Default:" notes:
  `standout.longestLookbackWeeks` 12, `standout.gradeNoteMinPct` 3, `standout.driftDeltaPp` 2
  (`nuuttila-2025-recreational-runners-durability`), `standout.hrDeltaMinBpm` 3
  (`bent-2020-ppg-inaccuracy`, `navalta-2020-trail-running-hr`). Heat copy cites the shared steering
  test, not an E4 threshold.
- `explainInputs(req, ctx)` with `INPUT_BUILDERS` keyed by rule id and `POLICY_ONLY_RULES`; a
  coverage test puts every `RULE_TITLES` id in exactly one, starting from an explicit PENDING list
  that is empty by E4-8. New exports with no behaviour change: `csEffortsOf`, `efficiencySamples`,
  `durabilityRuns`, `heatExcessC`, `wbgtOf`. HRV copy follows the engine (ln rMSSD against a 10-day
  mean), not the epic text's 60-day band.
- `describeParamValue(param, units)` translates every unit string in the registry; a test fails on
  an unmapped unit, including those other epics add.
- `attributeChange(change, ctx)` gives every diff line at least one cause (`decision-hold`,
  `decision-reduce`, `owner-target-kept`, `break-restart`, `post-race`, `disruption`, `trim`,
  `ramp`, `phase-calendar`, `state-update`). No pairing, no undo logic in E4.
- `buildBriefFacts(args)` (pure): last week, the decision, a replan note (`goal-passed`,
  `checklist`, `no-plan`, `not-run`, `error`), the changes, up to four noticed facts with frozen
  inputs, the key session (`pickKeySession` over `isToRun` sessions, target from `resolveTargets`,
  checked by the cross-surface test) and the countdown. The prediction line waits for two weekly
  `PredictionLog` rows a week apart (E10s-1).
- `standoutFacts` and `rankStandouts`: eleven selections (pain first, effort verdicts only with the
  runner's rating, heart-rate facts above wrist error, drift only from 90 min and below 25 C, grade,
  efficiency, longest, completion).
- No rule text changes; a G5 sentence about the lint may be added in E4-8 if the owner approves.

### 8.6 UI and copy

- **Why drawer:** "From your numbers" first; live intro "These are the figures the plan read, as of
  {date}. It reads them again every Monday."; frozen intro "These are the figures from {date}, when
  this was written."; "Based on" source lists with links ("and {n} more"); "Not enough data yet:";
  "This rests on the rule alone. It does not use your data."; failure keeps the rule section: "Your
  figures could not be loaded. The rule and papers below still apply. Close this panel and open it
  again to retry." Every Explain call site passes a subject, including E2's split Today components
  (never the old `DashboardPage.tsx`).
- **Diff and undo components** (`web/components/revisions/`: `PlanDiffView`, `RevisionDiff`,
  `UndoControl`), used by Plan "What changed", Review after save, the brief and E5's previews. Lines
  as from and to ("Thu 29 Oct: Threshold 40 min to Easy 30 min", "Sat 31 Oct: Long run 105 min,
  added", "Sun 1 Nov: Easy 45 min, taken out"), causes in a sentence, a quiet Why. Reason labels:
  "Plan generated", "Weekly update", "After a review", "Your edit", "Restart after a break", "Rest
  window", "Undo", "New plan for another goal". Undo opens an inline confirm with the restore diff:
  "Put the plan back as it was before this update? Sessions you have run since stay as they are.
  Sessions before today stay as they are." (auto revisions add "The next weekly update on {date} may
  make the same change if your data still points that way."); "Undo update" / "Keep"; toast "Plan
  restored to how it was on {date}." Unavailable undo shows a muted line, for example "{weekday}
  {date} was changed after this update.", "{weekday} {date} already has a run linked to it.", "A
  warning sign from your check-in is still active, so this update stays for now. It can be undone
  once the sign clears.", "Updates can be undone for {days} days.", "The earlier plan no longer
  meets the plan checks, so it cannot be restored.", "This update was made before undo existed."
  Unseen revisions carry a "New" marker until the panel opens.
- **Brief page** (`/brief`, `/brief/:weekStart`, linked from More and from Today's brief slot):
  headline, "What changed and why" (with RevisionDiff and Undo; "The plan did not change this
  week."; provisional "The weekly update has not run yet. This brief reads today's plan."; "The plan
  was not updated this week: {message}"), "What the plan noticed" (empty "Nothing stood out this
  week."), "Next key session" (target from the shared resolver; "No key session this week. The week
  is easy running."), "Since this brief". Two columns from 900 px. The brief is not cached offline.
- **Brief line** in E2's `brief` slot: "Since last week: 3 changes, next key session Saturday (long
  run)." with "Open the brief" and one quiet "New" marker.
- **What stood out** on the activity page above "How did it go?": up to three sentences with Why;
  empty "Nothing unusual to report on this run."

### 8.7 Jobs

After R0's weekly write returns, `runReplanJob` calls `generateBrief` in its own try/catch (a brief
failure never fails the re-plan); a blocked or failed re-plan still writes a brief with a replan
note. The catch-up (section 4.7) produces a normal brief, so a provisional brief only covers the
minutes after start-up. Run insights are computed when an activity is stored, edited or rated, in
the nightly matching sweep (last 7 days), and lazily on read. Concurrent brief builds resolve
through the unique key.

### 8.8 Tests

Unit: quantity formatting in both unit systems, template typing (a `ts-expect-error` proves an
undeclared slot fails to compile), the lint (each banned word positive and negative; RED-S and
"record" pass), parameter units over the whole registry, explain builders (dated sources,
insufficient states, `csEffortsOf` equals `fitnessOf`, determinism, no input mutation, coverage),
`attributeChange`, the exhaustive undo-copy record, brief and standout builders (50 fuzzed weeks
through the lint). API: explain (404s, frozen inputs survive a deleted activity, one heart-rate fit
per data version), revision presentation (brief undo state equals the list's), brief (job, replan
note, provisional replaced, seen stamps the revision, concurrent GETs create one row, writing a
brief leaves the data version unchanged), standout. Web: drawer, diff and undo states, brief page,
brief line, standout card, all through `expectCleanCopy`. E2E `NN-explain-brief.spec.ts`: Why opens
with inputs; a brief lists a change with its cause and can be undone; undo refused after the session
is run and while a warning sign is active; What stood out; miles.

### 8.9 Risks

- E4-4 to E4-6 wait for R0 and E3-7; E4-1, E4-2 and E4-7 do not.
- Template copy can read robotic at the edges; typed slots, the lint, fuzzed renders and an owner
  reading pass on real briefs in E4-8 bound it.
- Live Explain reads today's data for a plan made earlier; the drawer says "as of", and brief and
  activity explanations are frozen.
- The read-side undo state cannot predict the checklist, so a shown button can answer with a muted
  line; accepted over running the checklist on every list request.
- Stored `PlanRevision.summary` survives for old rows; new UI renders structured data.
- The brief could become a guilt surface; one quiet marker, no counts, "eases" for reductions, and
  the lint and a reading pass guard it.

## 9. E5 Disruptions: dial-back, what-if and moves

### 9.1 Goal

The runner is ill, carrying a niggle, travelling or short on time, and the plan adjusts without
guilt and shows the way back. One "Not 100%" action takes a reason, a start date that may be in the
past, an end date and a running mode; the engine turns it into a dated window (rest days, easy-only
days, per-day run caps, a return week held to the J7 restart fraction for the days lost). Minutes
lost are never added back (G-6). A what-if preview shows the diff that will be committed, for every
owner action including undo, and preview and commit share one code path. Move, swap, shorten and
skip are one action with structured guard reasons. Back-dating works honestly: a runner who opens
the app on Thursday after being ill since Monday gets a plan that stops asking about those days.

### 9.2 Stories

- A head cold: "Ill, above the neck", Until Thursday, a preview showing rest days, the symptom-free
  day as rest (n-3) and easy running after it; applied in under a minute.
- Ill Monday to Wednesday, opened on Thursday: the start is back-dated, the weekly decision stops
  counting those days, and the return is sized from the days actually lost.
- A 3 out of 10 calf niggle: two rest days, then easy-only days; ticking "It changes how I walk or
  run" tightens the return ramp and says why.
- Travelling with "Short easy runs, up to 30 min": the long run is not squeezed in and lost minutes
  do not move to next week.
- Moving Saturday's long run to Sunday in one step; a refusal names its rule and offers a one-tap
  swap.
- Shortening Thursday's 60-minute run to 40 survives the next re-plan.
- Feeling better early: "I'm better" with the first symptom-free day resizes the return.
- A window can be removed later; removal is a new revision with its own undo.

### 9.3 Data model (migration `disruptions`, E5-5)

```prisma
// A dated rest or limited-running window the runner reported. State.
model Disruption {
  id         String   @id @default(cuid())
  userId     String
  reason     String   // 'illness-above-neck' | 'illness-below-neck' | 'niggle' | 'short-on-time' | 'travel'
  mode       String   // 'rest' | 'limited'
  startDate  String   // YYYY-MM-DD; may be in the past
  endDate    String   // YYYY-MM-DD, inclusive; required
  maxRunMin  Int?     // 'limited' only
  area       String?  // niggle only
  pain       Int?     // niggle only, 0-10
  gaitChange Boolean  @default(false) // niggle only
  note       String?  // never read by the engine
  status     String   @default("active") // 'active' | 'undone'
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status, endDate])
}
```

Windows belong to the user, so a regenerate re-applies every active window within
`P.j9.maxWindowDays`. A window is engine input, not a set of check-ins: writing check-ins would make
undo edit rows that providers also write, and a check-in cannot hold a mode or a cap;
`illnessDays(input)` merges both sources for the engine. `PlanSession.status` gains `adjusted` (an
owner shorten, kept through re-plans, label "Shortened"); `SessionFlag` gains `rest-window`; week
flags gain `disrupted` and `disruption-return`.

### 9.4 API

- `GET /api/plan/disruptions`: `include=all`, `date`; `DisruptionView[]` with `phase` (upcoming,
  resting, rest-gate, easy-only, limited, returning, done), `runFrom`, `qualityFrom`,
  `returnWeekMin`, computed by the engine.
- `POST /api/plan/preview`: Adds `disruption-create`, `disruption-update`, `disruption-remove`
  (E5-5) and `adjust` (E5-6) to R0's union. Body rules: illness is rest only; `limited` requires
  `maxRunMin` 20-240; only a niggle takes area, pain and gait change; at most `P.j9.maxWindowDays`
  long; start no earlier than `P.j9.maxBackdateDays` ago; end no later than the goal date (400 with
  issues otherwise).
- `POST /api/plan/disruptions`: Body plus `expectHash`; one transaction: insert the window, mark
  back-dated unlinked planned sessions skipped (flag `rest-window`, original kept), re-plan through
  E3-7's write, record the revision (reason `disruption`, `disruptionId`). 201
  `{ disruption, revision }`; 409 stale-preview; 422 checklist.
- `PATCH /api/plan/disruptions/:id`: `endDate` and/or `maxRunMin` ("I'm better", "Extend"); same
  answers.
- `DELETE /api/plan/disruptions/:id`: Retracts a window as a forward revision with its own undo,
  never blocked by later edits; past skipped sessions stay skipped.
- `POST /api/plan/sessions/:id/adjust`: `adjustment` is one of move, swap, swap-kind, shorten, skip
  or restore, plus `dryRun` and `expectHash`; 200 `AdjustResult` (`allowed`, `guards`, `diff`,
  `session`, `revision`, `hash`); a refused commit is 409 with `details.guards` and the first
  guard's message. Updates the row in place.
- `PUT /api/plan/sessions/:id`: Kept as a thin wrapper over adjust until the web moves (E5-7).
- `GET /api/today`: `coach.disruptions` for the viewed date (a rest window tomorrow shows as rest in
  the cached preview).

### 9.5 Engine

- **Rule J9** (new, under section (j) of `engine-rules.md`, grade D as a whole): health windows hold
  running; illness follows n-3 exactly (rest through the first symptom-free day, then three easy
  days before intensity); a niggle has no symptom-free gate and `j9.niggleEasyDays` easy days after
  it; availability windows hold running or cap each day's longest run (20 min or more) with quality
  allowed where a run fits; a window that holds running for 7 days or more restarts at the J7
  fraction of the reference week for the layoff counted to the first run day, applied to the return
  week (prorated by open days) and the first full week after it (one low week alone would let the
  next return to 110% of the pre-window week); an injury report (niggle with pain at or above
  `pain.flagScore` or a gait change) tightens the ramp and the hard G-1 limit until the return plus
  the injury-return ladder's length (6 weeks) without changing the recovery cadence; a disrupted
  week's decision is a hold with a `disruption` signal, so one illness never cuts volume three
  times.
- New Params (`j-adapt.ts`, rule J9, grade D): `j9.maxWindowDays` 28 (pinned equal to
  `j7.tier3Days`), `j9.maxBackdateDays` 28, `j9.niggleEasyDays` 3, with existing evidence ids
  (`snyders-2022-respiratory-illness-rts`, `feely-2022-training-disruptions`,
  `mujika-2000-detraining-part1` and others). `revision.undoWindowDays` is R0's.
- `shared/engine/disruption.ts` (pure): `disruptionPlan`, `heldDates`, `illnessGate` (the only
  implementation of n-3; `illnessPhase` is rebuilt on it), `disruptionWeekCap`, `restSessions`,
  `validateDisruption`, `injuryReportOf`. `shared/engine/adjust.ts` holds the guard logic moved out
  of `planEngine.ts` plus rest-window, quiet-day, day-cap and spike guards and the shorten builder;
  every guard has a code, a fixed message with rule ids and, where possible, a `suggest`
  alternative. `undoGuard.ts` (R0) holds `undoSafety`, `undoEligibility` and `applyUndoPayload`.
- Integration: hold dates close slots in `placeWeek`; caps and quiet days pass through
  `ctx.dayRules`; `keptByReplan` releases owner edits that break a window (the diff shows it, undo
  restores it); `injuryTight(state)` replaces the `recentInjury` reads in limits, guards, checklist
  and start paths (`cycleWorkWeeks` keeps `recentInjury`); `weeklyDecision` returns early for a
  disrupted week; the checklist gains `disruption-window` and exempts disrupted weeks from cadence
  and level-differentiation items. `EngineInput.disruptions` is optional, so every existing fixture
  gives byte-identical output.
- Copy that states n-3 days, window limits or the undo window interpolates the Params.

### 9.6 UI and copy

- **Not 100% sheet** (three steps; bottom sheet below 900 px; dates from the server):
  - Step 1, "Not 100%", "Tell the plan what is going on. Minutes you rest are not added back
    later.": "Ill, above the neck" ("Cold, sore throat, blocked nose."), "Ill, below the neck"
    ("Chest, fever, aches, stomach."), "A niggle or pain", "Short on time", "Travelling".
  - Step 2: "From" ("You can start this in the past.") and "Until" ("The last day it affects
    training. You can change it later."), bounded by the Params. A niggle adds the area, a 0-10
    scale and "It changes how I walk or run", with the bone-pain notice and "Open today's check-in";
    below-the-neck illness adds the clinician line; illness shows "Running waits until you have had
    one symptom-free day, then three easy days before any hard session." (numbers from P); other
    reasons choose "No running" or "Short easy runs" with 20, 30, 45 or 60 minutes.
  - Step 3, "What would change": the summary ("Rest from Wed 22 Oct to Fri 24 Oct. Easy running only
    from Sun 26 Oct to Tue 28 Oct. Back to the planned week on Wed 29 Oct."), "Running time over the
    next four weeks: 1,240 min becomes 1,020 min. The minutes you rest are not added back.", the
    diff, warnings ("The window includes race day. The plan keeps the race; whether to start is your
    decision."), "Apply to my plan" / "Back" / "Cancel"; a stale preview swaps in: "The plan changed
    while you were reading. This is the new preview."; offline: "You are offline. Nothing was
    changed."
- **Disruption banner** on Plan and in Today's `disruption` slot: "Resting for illness until Fri 24
  Oct." with "I'm better", "Extend", "Remove window"; "One symptom-free day first, then easy running
  from Sun 26 Oct."; "Easy running only until Tue 28 Oct. Hard sessions return on Wed 29 Oct.";
  "Travelling: runs up to 30 min until Sat 25 Oct."; "Return week: up to 240 min." With no window
  and a check-in reporting illness or pain of 4 or more, the slot offers "Set a rest window and a
  return plan?" and creates nothing by itself.
- **Adjust section** in the session sheet: Move, Swap, Shorten, Skip with live dry-run guard
  messages, for example "Sun 26 Oct already has a run; one run a day keeps the week's spacing (rule
  F1)." and "Swap with Easy run 40 min instead"; shorten helper "Nothing is added back to another
  day."
- **Plan:** "Update plan from latest data" opens a preview; rest-window days read "Rest: illness"
  with meta "Rest window"; weeks carry "Rest window" and "Return week" chips. Undo of a rest-window
  revision refused for `edited-since` offers "Remove this rest window instead".

### 9.7 Jobs

No new job; windows need no tick because every phase derives from dates on each re-plan. The Monday
job reads active windows, so one created on Sunday evening is honoured. A race between the job and a
request is caught by the head-revision check: the request answers 409 stale-preview; the job
recomputes once and then logs.

### 9.8 Tests

Unit: window phases (illness equals `illnessPhase` for every date, property test), niggle tail,
limited caps, overlaps, return fractions at 6, 7, 15 and 29 lost days, mid-week returns, the injury
report, validation; integration over the matrix athletes (no run on a held day, back-dating, no
double restart, released owner edits, regenerate re-applies, disrupted decision); a seeded sweep
(every matrix athlete × reason and mode × start offsets −14 to +14 × lengths 1, 3, 7, 14, 28) in CI
under 60 seconds asserting the checklist, no added minutes, the J7 cap, determinism and baseline
restoration on removal; guards; undo guards and payload round trip; revision copy against P. API:
disruptions (preview writes nothing and leaves the data version unchanged, parity of preview and
commit per action, stale hash, back-dating, PATCH, DELETE, Today reflects the window at once,
`resetData` clears it), adjust (dry run, 409 guards, adjusted survives a re-plan, readers of
`isToRun`). Web: the sheet, banner, adjust section, revisions. E2E `NN-disruptions.spec.ts`:
back-dated illness applied and undone; a refused move and its swap; a shorten kept after an update;
Monday's undo after a Tuesday move; narrow viewport. The owner validation runs before and after E5-3
and E5-4 with a 3-day illness window.

### 9.9 Risks

- Windows can drive a week to zero or ramp from a zero baseline (STATUS follow-up 2); the sweep runs
  in CI and caps never go negative.
- Checklist items may fail on a hold week; disrupted weeks are exempted the way post-race weeks are,
  and a commit that still fails answers 422 after the preview showed it.
- A back-dated long illness meets the break restart twice; the cap is a minimum against a pre-break
  reference, and a test pins idempotence.
- A non-LIFO undo restores rows whose neighbours changed; hashes, the safety rule, the checklist and
  the window bound it.
- The tightened ramp after a niggle can make the plan slower than the feasibility label implies; the
  preview shows weekly totals before applying.
- `adjusted` reaches every status reader; `isToRun` and a reader test bound it.
- Back-dated sessions read "Skipped", which is accurate; Review and decision text never call those
  days lost.

## 10. E6 Fuel lab and gut training

### 10.1 Goal

The runner finds out what the gut tolerates before race day and arrives at the 100-miler with a fuel
rate tested in training, not copied from a calculator. After a long run of 2 h or more (or a 1 h run
in a gut-training week) a 20-second log records carbohydrate from the runner's own product list,
fluid, sodium, a 0-4 gut score and a 0-4 nausea score. A pure, replayed state machine turns the logs
into a tier ladder: the floor of 30-50 g/h, then 60, then 10 g/h steps to 90 (opt-in), then 100-120
(a second opt-in, low certainty). It steps up only after a tolerated run, holds after one run scored
2 or worse, falls back after two in a row (or at once after a 4), never steps up on a hot day, and
shows a nausea plan. Tonight's target appears on the long-run card and in the watch description. The
EAH safety card, thirst-led fluid wording, the gut-condition lock and the low-certainty labels
appear wherever fuel appears, with every number interpolated from its Param.

### 10.2 Stories

- After a 3-hour long run, a "Fuel log" card on Today offers "Same as last time"; one gut chip and
  Save finish it in about 20 seconds.
- A product list holds the gels, drink mixes and chews carried, with carbohydrate and sodium per
  serving.
- Tomorrow's long run shows "Fuel target: 60 g/h of carbohydrate" with one sentence and a Why, also
  when the run was moved or eased.
- The lab says in plain words whether the target rose, held or fell back, and why.
- On a hot day the target does not step up and the nausea plan shows; a run whose weather loaded
  after logging is still judged by the weather it had.
- A diagnosed gut condition locks the ladder at the floor, drops the gut-training block at the next
  re-plan and shows a clinician disclaimer.
- The 3-week gut-training block shows as dates ending before the taper, with "may improve tolerance"
  and no promise of speed; a 70-minute run in a block week counts even when the app did not link it
  to a session.
- The EAH card is always there: drink to thirst, never force fluids, sodium does not prevent it,
  which symptoms mean get medical care.
- A half-filled form survives a dropped connection.

### 10.3 Data model (migration `fuel_lab`, E6-4; all three state)

- `FuelProduct { userId, name, kind, servingLabel, carbsG, sodiumMg?, kcal?, multiCarb, archived }`
  (archive, never delete; names unique among live products by a service rule, because Prisma has no
  partial unique index).
- `FuelLog`: user, activity (unique, cascade), skipped, items (a JSON snapshot of each product),
  optional fluid and sodium, gut 0-4, nausea 0-4, `hotOverride Boolean?`, optional notes.
  `hotOverride` null means hot is derived on every replay from the activity's current weather: the
  weather job enriches 50 activities per 10-minute batch, so a flag stored at save time would
  usually be false and could open a rung on a hot day, which H7 forbids.
- `FuelSettings { userId (id), optIn90, optInAdvanced, giDisease, gutBlock }`.
- Derived, never stored: totals, g/h (elapsed time, because eating happens at stops), multi-carb
  share, hot, block credit, counting, every ladder step. `EngineInput.options.gutTraining?` lives in
  the existing `Plan.options` JSON.

### 10.4 API

- `GET /api/fuel`: `FuelLabView`: settings, the ladder (rungs, current, tolerated, held, locked,
  ceiling, the last 40 steps), the next target, the gut-training block, products, the last 30 logs,
  prompts, the EAH card and the disclaimers; the stable surface for E11 and E12.
- `PUT /api/fuel/settings`: Four booleans; a gut condition forces the others off; opting out of 90
  clears advanced; advanced before 90 g/h was tolerated is 400 on `optInAdvanced` ("This opens after
  a run at 90 g/h goes well."). Changes apply at the next weekly re-plan, visible in its diff.
- `/api/fuel/products`: GET (`archived=1`), POST, PUT, DELETE (archives); 409 for a duplicate live
  name or more than 100 live products.
- `/api/fuel/logs/:activityId`: GET (null when none); PUT (idempotent upsert, so the outbox may
  replay it; snapshots products; `hot` null means automatic); POST `/skip`; DELETE. Non-run
  activities 409. Response `{ log, ladder, message }`.
- `GET /api/fuel/targets`: `from`, `to` (span ≤ 62 days); targets for eligible `isToRun` sessions of
  the active plan.
- `GET /api/today`:
  `coach.fuel { targets (today, tomorrow), prompts (unlogged eligible runs of the last 7 days, at most 3) }`.

### 10.5 Engine

- Nine new `h7` Params (rule H7): `logMinDurationMin` 120 (A), and grade D defaults
  `rungReachFraction` 0.9, `multiCarbMinShare` 0.5, `stepUpToleratedRuns` 1,
  `immediateFallbackScore` 4, `nauseaContingencyScore` 2, `hotDayWbgtC` 18, `hotDayAirTempC` 25,
  `gutBlockSessionsPerWeek` 3, with evidence ids checked against `research/papers`. Rule text for
  the ladder, counting, score and movement, heat (judged by the run's actual weather) and the
  gut-training week joins H7 through `research-update`.
- `shared/engine/fuel.ts` (pure; imports `P`, types, `isToRun`, `weatherIndex`): `fuelRungs`,
  `ceilingIndex`, `runScore`, `isBlockRun` (a linked run follows its session's `fuel-practice` flag;
  an unlinked run counts when its date falls in a `gut-training` week),
  `runIsHot(weather, override)`, `replayLadder` (input-order independent), `fuelEligible`,
  `isHotForFuel`, `fuelTargetFor` (eligible `isToRun` sessions only; no target for race kind),
  `fuelTargetsFor`, `fuelLineForSession(ctx, session)` (synchronous, the call E1 uses),
  `fuelWatchLine` (at most 60 characters, no symptom words), `eahCard`. `FuelContext` is plain data
  loaded once by `loadFuelContext(deps, { userId, today, horizonDays })`.
- `shared/engine/fuelCopy.ts` holds every sentence; Param-bearing ones are functions over `P`.
- The gut-training block: `options.gutTraining === false` removes the week flags (the server sets it
  for a gut condition or an opt-out, inside R0's single `applyReplan` path); in a gut-training week
  up to three runs of an hour or more carry `fuel-practice` without changing minutes, days or zones.
  The block's placement before the taper is asserted by test. E6 does not edit `heat.ts`; it reuses
  `trainingHeatAdvice(...).peak` from E2-2.

### 10.6 UI and copy

- **Log form** (prompt card and activity page): product chips with steppers ("Add one {name}"),
  "Something else", "Same as last long run"; a live `<output>`: "You took {g} g of carbohydrate in
  {h:mm}: {rate} g/h. Target was {target}."; fluid chips; the reference note "That is above the 450
  to 750 mL/h reference range. Drink to thirst; more is not better." (figures from P); Gut and
  Nausea scales 0-4 with words (None to Very severe), gut required; "It was hot" starts from the
  activity's weather or shows "Weather for this run has not loaded. Tap if it was hot." and sends
  `null` until touched; "Save fuel log" / "Not this time"; toast from the server message ("Tolerated
  at 60 g/h. Next long run: 70 g/h."); the counts line ("Counted toward your ladder." or the
  reason); a draft in localStorage under `fuel-draft:<activityId>`.
- **Targets:** "Fuel target: 60 g/h of carbohydrate" with the basis sentence ("The last long run
  went well at 60 g/h, so this run tries 70 g/h." / "Warm day: the target stays at 60 g/h, the last
  rate you tolerated, instead of stepping up to 70 g/h." / ...), the certainty line above the floor,
  the fluid and sodium lines, and the nausea plan in a `<details>` "If your stomach turns". Watch
  line: "Fuel 60 g/h carbs. Drink to thirst."
- **Fuel lab** (`/fuel`, from More): target card, prompts, tier ladder (state words: Tolerated, Next
  up, Repeat, Later, Opt in to open, Opens after 90 g/h goes well, Not available with a gut
  condition; a grade per rung), history table (the replayed step note per row), products, the
  gut-training block card with "Gut training may improve how well you tolerate carbohydrate during a
  run. It does not promise a faster time, and it has not been shown to protect the gut lining.",
  settings, the EAH card (`role="note"`, a stronger variant above `P.n7.eahStrongerAlertHours` or in
  heat) and the general disclaimer.
- Today: `FuelPromptCard` in the `fuelPrompt` slot and `FuelTargetLine` in the `fuel` slot; E6 never
  edits `DashboardPage.tsx`.

### 10.7 Jobs

None. The ladder is replayed on every read from at most a few hundred rows joined to their
activities, so an edited activity, a late weather fill, a confirmed duplicate (whose log moves to
the original when it has none) or a deleted log takes effect on the next read. Fuel writes bump the
data version automatically.

### 10.8 Tests

Unit: the ladder over every event (step up, hold, fall back, severe, hold lifted, heat, below
target, opt-in ceilings, multi-carb share, gut condition, withdrawn opt-in clamps, order
independence), `isBlockRun`, `runIsHot`, eligibility over every to-run status, the watch line
length, copy through the shared lint, no fluid figure other than the reference range, Param
agreement and a source scan for hard-coded values, the EAH card, the gut-training flags and their
placement. API: products, logs (snapshots, idempotent upsert, late weather re-judges a run, owner
override survives), ladder replay, unlinked block runs, settings, gut condition removes the block on
regenerate, targets for moved and eased runs, Today fuel, the E1 seam. Web: the log form, lab page,
settings, EAH card, copy through `expectCleanCopy`. E2E `NN-fuel.spec.ts`: add a product, log a
3-hour run, the target steps up, two runs scored 2 drop it back with the explanation, the stronger
EAH card for a 100-mile goal; 360 px.

### 10.9 Risks

- The real risk is not logging; prompts, prefill, one required field, "Not this time" and the kept
  draft reduce the cost to about 20 seconds.
- Self-reported scores are noisy; the stop rule is conservative and the ladder changes only the fuel
  line, never sessions.
- Tolerance in training may not transfer to a 25-hour race; rates above the floor carry "low
  certainty" and "rehearsal, not a promise".
- Any fluid number is a hyponatraemia risk; only the reference range and the runner's own logged
  amount appear, tested.
- A step-up seen in a toast can be retracted when weather arrives; the lab always shows the current
  replay.
- The block takes the last three specific weeks; the lab says the ladder is meant to be climbed on
  long runs from the start of the build.

## 11. E10s Prediction back-test slice

### 11.1 Goal

"Show me how well the app's predictions held up against what I actually ran." Today a
`PredictionLog` row is written on every generate and re-plan (several per week, none for a goal
without a plan), `actualSec` is never written and nothing reads the log. The slice logs one
prediction per goal per local week (the latest of the week), records `RaceResult` linked to the goal
and optionally to the race activity, scores the pre-race predictions against it, and shows a
"Prediction track record" on the Goals page: per race the weekly predictions and their ranges
against the result, the signed difference in words ("4:10 slower than predicted, 1.8%"), range
coverage counted per race on the final prediction, and a cross-race pattern only after 3 scored
races (G3). Honest, not flattering: DNFs are shown unscored, predictions after the fact are never
scored, and no prediction changes in this slice.

### 11.2 Stories

- After the goal race the runner records the finish time (optionally picking the activity) and sees
  how the weekly predictions compared.
- Each weekly prediction is a point with its range against the result; the difference has a
  direction and is never pass or fail.
- A did-not-finish is recorded and not scored.
- The pattern across races appears once there are enough scored races, with how many more it needs.
- Editing or removing a result re-scores or un-scores without touching the log.
- A missed night never leaves a week out of the record.
- Linking the race activity marks it as a race, and the sheet says so before saving.

### 11.3 Data model (migration `race_results`, E10s-1)

- `PredictionLog` gains `weekStart` and `loggedOn` (computed in the hand-edited table copy from
  `inputs.today`, falling back to `createdAt`; no database default, so no drift) and an index
  `[userId, goalId, weekStart]`; `inputs` gains a `course` snapshot (distance, gain, surface, WBGT).
  Existing duplicates are kept and collapsed on read (owner question Q14). Non-state.
- `RaceResult`: user, goal (unique), activity (unique, set null on delete), date, distance, optional
  gain, outcome (`finished` or `did-not-finish`), optional time, optional note. State, because it
  retypes an activity and will feed the engine in E10.
- The migration's case in the shared chain test covers Wednesday and Sunday `inputs.today` and both
  `createdAt` storage types.

### 11.4 API

- `PUT /api/goals/:id/result` (full replacement): validation 400 with paths (finish time required
  when finished, date not in the future, a distance from the body, activity or goal, a run or race
  activity within `RESULT_ACTIVITY_WINDOW_DAYS = 3` of the date); 409 when the activity belongs to
  another result. One transaction: upsert, retype the linked activity to `race`, `syncActuals`
  (clear the goal's `actualSec`, then set it on rows logged before race day for a comparable
  course); then `runExecutionQuietly`. 201 or 200 `RaceResultView` with `scoredPredictions` (weeks)
  and `activityMarkedAsRace`.
- `DELETE /api/goals/:id/result`: 204; clears every `actualSec` of the goal and keeps the rows.
- `GET /api/predictions/record`: `TrackRecordView`: races newest first (points, headline, coverage,
  unscored count) and a summary (`raceCount` of scored races, inside count, median signed and
  absolute error in percent, `enough`, `needed`). All of a goal's rows load first and each week
  collapses to its newest row before scoring.
- `GET /api/predictions?goalId`: log entries gain `weekStart` and `loggedOn`, one per week.

### 11.5 Engine

- `shared/engine/backtest.ts` (pure): `daysBefore`, `weeksBefore`, `isComparableCourse`,
  `scorePredictions`, `scoreRace` (headline = the last prediction before race day; edges count as
  inside), `summariseRecord` (headlines only, one point per race, because weekly logs of one race
  are strongly dependent), `median`. Signed error = result minus prediction; negative is faster.
- New Params (`l-predict.ts`, rule L7, grade D): `l7.minRacesForSummary` 3
  (`hecksteden-2015-individual-response`, `mann-2014-high-low-responders`) and
  `l7.courseTolerancePct` 2 (`blythe-2016-individual-prediction`). L7's rule text is replaced with
  four bullets (weekly logging, scoring, per-race coverage and the 3-race pattern, no recalibration
  without acceptance); L6's "until running back-tests exist" becomes "until at least 3 scored races
  exist (L7)". Engine output does not change.
- Sentences live in `shared/copy/trackRecord.ts`.

### 11.6 UI and copy

- `GoalRow` shows "Record result" or "Edit result" (accessible names include the goal) once the goal
  date has arrived; `GoalOutlook` adds "{n} predictions logged so far, one a week. After the race,
  add the result to see how they compared."
- **Result sheet:** Outcome (Finished, Did not finish), Finish time ("Official time as h:mm:ss, like
  3:52:10."), Race date, Distance, Activity ("Not linked" or runs within 3 days; choosing one
  prefills time, date and distance and shows "Linking marks this activity as a race, so later
  predictions can use it as an anchor, and zones and watch targets may change with it."), Notes;
  "Save result"; "Remove result" with "Remove this result? The weekly predictions stay logged and
  are no longer compared."; toasts "Result saved. 12 predictions compared." and "Result saved.
  Nothing to compare for a race not finished."
- **Track record:** lead "The app writes down its predicted finish time once a week. After a race,
  each prediction is compared with what happened. The comparison describes the prediction, not the
  race."; summary "Across {n} races the result was inside the predicted range {k} times. The median
  difference was {x}% {slower|faster} than predicted." or "{No race|One race|Two races} compared so
  far. A summary across races needs {needed} more; until then each race stands on its own."; per
  race the headline "The last prediction, made {d} days before the race, was {predicted} ({low} to
  {high}). The result was {diff} {faster|slower} than predicted ({pct}%), {inside|outside} the
  range.", a Recharts chart (range area, predicted line, dashed result line labelled "Result"; in
  the static import graph) with an accessible name, and a captioned table ("Weeks before",
  "Predicted", "Range", "Result against prediction", "In range"); "Did not finish. There is nothing
  to compare, so these {n} predictions are not scored."

### 11.7 Jobs

`recordPrediction(db, { ..., mode })` replaces `logPrediction`: `refresh` (inside the plan write
transaction, a one-line swap at each existing call site) updates the week's newest row or creates
one; `ensure` creates only when missing. Nothing is logged on or after race day, once a result
exists, without a distance or without a prediction. `runPredictionJob` runs every 6 hours (first run
after 30 s), resolves the goal with `currentGoalFor`, returns before any engine work when the week
has a row, reads engine input through the snapshot (no request-time weather after E3-3), continues
past a failing user, and records a `job` run.

### 11.8 Tests

Unit: sign, edges, horizon, headline, per-race coverage, median, the 3-race threshold, comparable
course, DNFs; copy grid through the shared lint ("Prediction track record" and "Record result"
pass). API: one row per week, later weeks add rows, no rows on or after race day or with a result,
the ensure job (creates, never overwrites, no engine work when present, the shared goal resolver),
result routes (scoring, update, unlink, comparable course, DNF, 400 paths, retype and anchor in the
next engine input, 409, 404, cascade, delete), record (collapse prefers the newest row of a week).
Web: the result sheet and the track record. E2E `NN-track-record.spec.ts`: record, persist, edit,
remove; 360 px.

### 11.9 Risks

- One runner has one or two goal races a year; the summary will be absent for a long time, which is
  honest.
- A runner may record only good races; DNFs are visible and the lead sentence frames the comparison.
- Linking an activity retypes it and moves anchors, zones and watch targets; the sheet says so and a
  test proves the next engine input uses it.
- The prediction write is touched by E10s-1, E3-7 and R0-1; it stays a one-line call and the later
  merger re-points it.
- When E10 starts reading the record into the engine, `PredictionLog` must be reclassified as state
  in that PR; the classification test cannot catch that.

## 12. Decisions taken

Each decision is overturnable by the owner; section 13 lists the ones that most need a look.

### 12.1 Owner decisions (2026-10-22, under the mandate)

1. **The weekly re-plan stays automatic and becomes visible and undoable** (ADR 0007). Reason: a
   watch that receives a stale plan is worse than a visible, reversible change, and the mandate is a
   self-adjusting coach. Targets set by hand are never overwritten.
2. **Today's hero is today's session and readiness**; weekly hours move to the week strip (spec §4.7
   and the visual design's dashboard hierarchy are edited in E2-5). Reason: a coach's hero, not a
   tracker's.
3. **No GPS tracks in 3a.** Reason: the data-foundation privacy non-goal stands until the owner
   decides otherwise.
4. **Watch delivery through intervals.icu**, with the FIT download and the ICS feed as independent
   fallbacks, every failure visible, and no writes through the unofficial Garmin provider (ADR
   0008). Reason: Garmin's official API is closed to new applicants and intervals.icu already holds
   the Garmin link.
5. **Race facts are never committed or guessed.** Reason: the repository is public, and a guessed
   cutoff is worse than none.
6. **Three zones stay;** the activity page will map them to Garmin's five (3b). Reason: the engine's
   anchors are three domains.
7. **The 10.0 h plateau is examined in E13 and E8, not changed in 3a.** Reason: the peak is a
   ceiling by design.

### 12.2 Decisions forced by the review or by reconciling the designs

8. **One session identity** (section 4.1): uuid `externalId`, pairing by (date, kind, occurrence),
   row-level re-plan writes in E3-7. Reason: four definitions would have duplicated watch events,
   disagreed between diffs and reintroduced id churn.
9. **One revision foundation, R0**, split out of E3-9 and E5-1/E5-2, with E5's row-level payload,
   E4's `decision` field, one `seenAt`, one split and ADR 0007 written once. Reason: two models on
   one table and one route cannot both ship; row-level payloads are a few KB, full snapshots about
   100 KB.
10. **One undo policy**: block only on touched rows (by content hash), a 7-day window
    (`revision.undoWindowDays`, grade D), re-run the checklist on the restored plan, refuse while a
    cited safety flag is active (except the undo of a runner-reported rest window), restore only
    today onward. Reason: G6 makes the conservative rule win; blocking on any later revision would
    let one Tuesday move cancel Monday's undo. E3's "no window" and E4's "inform, not block" are not
    adopted.
11. **One diff shape** (`PlanDiff` with added, removed and changed lines keyed by `externalId`);
    "moved" is presentation. Reason: identity truth stays in data; wording stays in `shared/copy`.
12. **One preview path** (`computeAction` behind `POST /api/plan/preview` and every commit, with a
    preview hash). Reason: a what-if that can differ from the commit is worse than none.
13. **Diff and undo UI built once by E4-4** and reused by E5. Reason: E4 and E5 each designed a diff
    view; R0 ships server only.
14. **Shared delivery semantics in one wave-0 task (E2-2, absorbing E1-1):** E2's generic
    `easedSession` (keeps id and status; title "Easy run"; distance null), E2's `ResolvedTargets`
    shape plus E1's `hotNote`, an index-aware `isHotForSteering` reusing `P.i9.warnWbgtC` (25 C),
    the `peak` on `trainingHeatAdvice`, and `isToRun` in `shared/domain/sessionStatus.ts`. Reason:
    two eased sessions and three thresholds made Today and the watch disagree.
15. **E6 keeps its own fuel heat threshold (18 C WBGT)** and names the difference. Reason: holding a
    fuel step is a different question from dropping a heart-rate ceiling.
16. **One state cache contract** (section 4.3): automatic bumps, a transaction-end bump, no storing
    during transactions, a schema-driven classification test, `loadAthleteContext` and
    `memoByVersion`. Reason: the other epics assumed four different hooks, and `Disruption` would
    have been stale for five minutes.
17. **Model classification** as listed in section 4.3. Reason: derived tables written on read and
    the publisher's own tables must not invalidate; everything a deliverable reads must.
18. **One change detector for publishing** (data-version key plus today plus the forecast stamp,
    30-minute backstop). Reason: E1's watermark missed activities, the forecast, fuel logs and
    disruptions.
19. **ADR numbers**: 0007 re-plans, 0008 outbound publish channel, 0009 snapshot and data version,
    0010 rule-generated text, 0011 fuel ladder, 0012 offline shell. The publish channel is a new ADR
    that extends 0006 rather than an amendment inside it. Reason: the first write into a third-party
    account in the owner's name is a decision of its own with its own consent and failure model, and
    an accepted ADR is not rewritten after the fact (**Opinion**). This supersedes the review's
    assignment (0008 snapshot, 0009 text, 0010 fuel).
20. **`PARAMS_VERSION` policy**: the merging PR takes the next free suffix; no design claims one.
    Reason: three designs claimed `.3`.
21. **Display caps are constants; data thresholds are Params.** Reason: caps are presentation, not
    claims about the runner.
22. **Status codes**: 400 for validation everywhere, 422 for the checklist only,
    `conflict(message, details?)` added in E3-1. Reason: E6 and E10s specified 422 for input.
23. **One G5 lint** in `shared/copy/lint.ts`, banning "personal record" and "PR" but not "record",
    covering app-authored copy only. Reason: seven lists disagreed and one would have banned "Record
    result".
24. **Today slots** with fixed budgets (disruption 64, fuel 26, watch 24, brief 52 px) plus an
    unbudgeted below-the-fold `fuelPrompt` slot; E1's separate watch notice banner is dropped (the
    watch line covers today and a health note covers tomorrow); E5's "Set a rest window?" prompt
    uses the disruption slot. Reason: the fold must be measured with every line other epics add.
25. **One job and sync log** (`SyncRun` with `publish` and `job` channels) and a weekly catch-up.
    Reason: failures were visible in four places, and a restart could skip the Monday re-plan
    silently.
26. **Server's today everywhere**, with `tz` on `TodayView`. Reason: the service worker used the
    device clock; travel is recorded as a limitation.
27. **Offline outbox for idempotent PUTs only** (check-in, fuel log). Reason: a POST replayed twice
    logs two runs.
28. **Service workers blocked in Playwright** except the offline spec, and the lazy chart is made
    safe by two shell generations plus a reload on `vite:preloadError`. Reason: workers warmed
    caches and spent the shared rate-limit budget in every spec, and a lazy chunk broke the update
    argument.
29. **`resetData()` derived from the schema** and a shared migration-chain test. Reason: seven new
    tables would leak between specs, and ten migrations will sort out of order without regenerated
    folder names.
30. **Make active builds the plan, with a way back** (`GET /api/plan/archived`, restore). Reason:
    the countdown, the plan and the active badge must agree, and a destructive action needs an undo.
31. **Fuel hot is derived at replay** with an explicit owner override. Reason: weather arrives after
    logging in the common order.
32. **Fuel and E1 seam**: `loadFuelContext` once per run plus the synchronous `fuelLineForSession`.
    Reason: E1 expected a pure function and E6 offered an async service.
33. **E10s logs only the current goal** (the plan's goal, else the active goal) through the shared
    resolver, and its ensure job runs every 6 hours. Reason: one resolver; `daily()` skips after a
    restart.
34. **The FIT encoder lives in `server/`.** Reason: `fit-file-parser` must not reach the web build.
35. **The calendar feed is not a provider.** Reason: a registry entry would render a generic
    provider card with Disconnect and a sync history.

## 13. Open questions for the owner

Ranked by how much they change behaviour. Each has a default that the plan implements.

1. **Undo policy (Q1).** Default as decision 10. Overturning the safety refusal ("inform, not
   block") would set G6 aside for undo and needs an explicit decision; a different window length is
   a one-Param change.
2. **Hot-day thresholds (Q2).** Default: steering switches at 25 C WBGT (the I9 warn level, a
   conservative reading of a rule that names 25 C ambient); fuel holds at 18 C WBGT. Unify, lower
   the steering switch, or keep both?
3. **Fatigue-only one-row check-in (Q3).** Default: Fresh to Drained stored as fatigue 1-5, other
   items behind "Add more", pain and illness one tap away.
4. **Rule I7 widened to any run (Q4).** Default yes: a cooler hour for any run with a positive
   excess and enough gain. Against: the rule's author limited it to key sessions.
5. **Publishing off by default (Q5)** once intervals.icu is connected, because it writes into the
   owner's calendar.
6. **Live checks on the owner's account (Q6):** who runs the intervals.icu smoke test and loads the
   FIT files on the watch (and which Garmin model and manual route the help text should name)?
7. **Make active (Q7):** always builds the plan; is a third path wanted that archives the plan and
   leaves the goal active with no plan? And should marking the plan's goal done or dropped archive
   the plan?
8. **Niggle caution (Q8):** three easy days after a niggle window and six weeks of tightened ramp
   after pain of 4 or more or a gait change; right, or too heavy for a minor report?
9. **Above versus below the neck (Q9):** treated identically except for copy, because no source in
   the corpus separates them.
10. **Fuel ladder details (Q10):** one tolerated run opens the next 10 g/h; rungs 70-90 all sit
    behind the 90 opt-in; a bad hot-day run counts toward the fall-back; no decay of a tolerated
    rung after a layoff.
11. **Gut-condition switch timing (Q11):** next weekly re-plan (default) or an immediate visible
    revision.
12. **Windows as Params (Q12):** should the 60-day wellness, 16-week review and climatology windows
    become graded Params (a `PARAMS_VERSION` bump and a new validation baseline)?
13. **Climate wait (Q13):** plan generation waits up to 8 s for race climate on a cold cache;
    alternatively generate without race heat and re-plan when it arrives.
14. **Prediction duplicates (Q14):** keep pre-migration duplicates and collapse on read (default),
    or delete them and add a unique index.
15. **Recording a result marks the goal done? (Q15)** Default no; a toast prompt is the middle path.
16. **Smaller defaults to confirm:** sync log retention (200 runs, 90 days, idle runs kept); offset
    pagination; a required end date for windows; moves stay within the week; the snapshot freeze in
    production; the 28-day bar strip removed from Today; tomorrow's preview cached on the device;
    the theme colour moved to the paper surface; briefs kept forever; hike sessions published as
    runs; the race day absent from the watch.
