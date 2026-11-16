# 0022. A runner's day is the calendar date in the runner's own zone

Status: Accepted 2026-11-16 (#754).

Supersedes two consequences of ADR 0003: "Code that needs today calls `todayIso`, the only function
that reads local time" and "A server running in a different timezone from the runner computes the
wrong current week; the Docker setup passes `TZ` through for that reason." Builds on ADR 0007, 0009
and 0012. The rollout is six steps; this record is added in step 1. The number 0021 is taken by the
proposed Apple Watch companion ADR (`docs/superpowers/specs/2026-11-09-apple-watch-companion-design.md`).

## Context

Every day the server decides (Today, the current week, plan reads and writes, the night and Monday
jobs, ETags and memo keys) comes from the process zone (`TZ`). A tester in another zone, or the
owner while travelling, sees Today change at the server's midnight. Owner decision D10, 2026-11-14
(`docs/STATUS.md`, #740): per-runner days now, not an addendum to ADR 0003 that limits invites to
the server's zone.

## Decision

- Owner decisions of 2026-11-16 on the design's questions: a stored `'UTC'` reads as unset (question
  1); a new ADR records this (question 6); offset-less imports keep UTC dating (question 7).
- A runner's day is the calendar date in `runnerZone(AthleteProfile.timezone)` (`server/runnerDay.ts`).
  The stored zone is used when it is a zone the server's ICU knows and is not the literal `'UTC'`;
  `'UTC'`, no profile row and an unknown zone mean the server's zone. A stored zone is never
  canonicalised: `Etc/UTC` is how a runner asks for UTC days.
- Requests carry `req.runnerDay` (`{ tz, today, now }`, read once in `requireAuth`) and jobs read
  `runnerDays`. `today` is a required argument of the services, so the type checker finds a caller
  that was not given a day. After step 6, nothing under `server/` reads the process zone except the
  backup slot, the log clock and the named UTC exceptions (the Garmin and intervals.icu pull windows,
  the backup's retention buckets, the duplicate pass's date shift, the climate archive bound). Until
  then the scanner allowlists name what remains, among them the Smashrun offset
  (`server/routes/imports.ts`, step 6) and the two offset-less `Date` constructions in
  `server/services/brief.ts` (the brief's week bounds, owned by the step that makes the brief take a
  runner's day). The scanner tests hold this and their allowlists only shrink.
- Matching, the Monday re-plan and the forced publish run on the runner's clock; the backup runs on
  the server's. The week's update is guarded by the week's brief and by a weekly revision written
  since the runner's Monday 00:00. A brief that failed to write, in a week with a move of more than
  3 hours west across Monday's slot, allows a second weekly update.
- Stored dates keep the zone in force when they were written. A day read from an instant (a
  revision's day, an insight's day) uses the zone in force now. A week around a long move can hold a
  23- or 25-hour local day, so a day of data can sit in the neighbouring week.
- Imports date an offset-less time in the stored zone, `'UTC'` literally, as before D10 (owner
  decision 2026-11-16, question 7 of the design).
- No schema change, no migration, no Param, no engine change, no new environment variable.
- Rollout: step 1 adds the resolver (answering with the server zone for every runner), the zone-clock
  helpers in `shared/dates.ts`, the scanners and a start-up line that names the runners whose day
  moves at step 5; steps 2 to 4 carry the day through requests, jobs and pages with no change of any
  runner's day; step 5 makes `runnerZone` return the stored zone.

## Reasons

- **Rule:** D10, owner decision 2026-11-14 (`docs/STATUS.md`, #740).
- **Fact:** under `server/` the process zone is read by 87 `todayIso(` calls (counted 2026-11-16 at
  `cad56d4a`, with two unused ones since deleted in step 1) and by the slot functions, so a runner in
  another zone sees Today change at the server's midnight.
- **Fact:** `'UTC'` already means "not chosen" in `web/pages/ProfilePage.tsx` and
  `server/routes/settings.ts`, and a profile row gets it from any write that leaves the zone out
  (`PUT /api/profile` merges into `defaultProfile()`).
- **Fact:** `replanActivePlan` writes a revision on every call (`server/services/replan.ts`), so a
  repeated weekly update needs a stored guard, not idempotence.
- **Fact:** `storeParsed` writes `date` on every update of an existing row
  (`server/services/activityStore.ts`), so a change in the zone imports are dated in moves a re-seen
  run near midnight to another day.
- **Fact:** nothing stores the zone of an instant, so a revision's `createdAt` cannot say which local
  week it was written in after a zone change; the brief's `weekStart` can.
- **Opinion:** an explicit `today` argument is better than an ambient zone (async-local storage): the
  code already passes `today`, and a required argument lets the type checker find a missed caller.
- **Opinion:** the morning jobs follow the runner's clock because they exist to finish before the
  runner's morning; the backup is one copy of the whole database for every runner.

## Alternatives

- **The same-zone limit on invites (an ADR 0003 addendum).** Against (**Rule**): the owner chose
  per-runner days on 2026-11-14.
- **A per-runner opt-in flag.** Against (**Opinion**): a second setting beside the zone, a migration
  and a removal PR, for a risk the `'UTC'` rule removes.
- **`process.env.TZ` set per request.** Against (**Fact**): one zone per process, wrong for
  concurrent requests.
- **A script that copies the server zone into `'UTC'` rows.** Against (**Opinion**): a data write at
  cutover, and rows written later without a zone would be UTC days again.
- **Imports dated in `runnerZone`.** Against (**Fact**, above): a re-seen run near midnight moves a
  day for every runner with no zone chosen.
- **A guard on revisions alone.** Against (**Fact**, above): a revision carries no zone, so a
  westward move of more than 3 hours is missed.

## Consequences

- ADR 0003's two consequences above no longer hold from step 5; ADR 0003 points here.
- `TZ` stays the server zone: the fallback, the backup slot and the log clock.
