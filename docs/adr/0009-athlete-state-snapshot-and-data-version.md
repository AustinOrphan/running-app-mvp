# 0009. One cached athlete snapshot, invalidated by an automatic data-version counter

Status: Accepted 2026-10-23 (#544)

## Context

Today, the Plan page's zones, Review, predictions, zones and every execution assessment each gather
the engine's input on their own: 365 days of full activity rows (parsing the heart-rate histogram of
each), 60 days of wellness, 16 weeks of reviews and a screening, with sequential awaits, and Today
and generation may call Open-Meteo inside the request (`server/services/engineInput.ts`). The phase
3 audit's performance lens (2026-10-22) measured this as the main cost of opening a page.

Phase 3a adds more readers of the same picture: the Today coach view, the watch publisher, the
explain drawer, the weekly brief, the run insight card and the prediction job. Each design first
assumed a different way of keeping a cache fresh (a "plan-changed hook", an explicit bump, a
watermark over `updatedAt` columns), and one table the engine reads (`Disruption`) would have been
left out of every one of them, showing stale zones for minutes after the runner reported an illness.

## Decision

The server keeps one in-memory snapshot of the athlete per user and day, and every reader goes
through it.

- `server/dataVersion.ts` keeps a counter per Prisma client. A Prisma query extension increments it
  after every write (create, update, upsert, delete and their `many` and `AndReturn` variants) to a
  model listed as state, also when the write throws. Callers never increment it; no public bump
  function exists.
- The client's `$transaction` is wrapped so it increments once more when a transaction ends, on
  commit or rollback, and counts open transactions. A snapshot built while a transaction is open, or
  one whose build overlapped an increment, is returned to its caller but not stored.
- The cache key combines a boot id, the counter, `PRAGMA data_version` (which changes when another
  connection or process writes the file), the local day and `PARAMS_VERSION`. A 5-minute TTL is a
  backstop, not the mechanism.
- Every Prisma model is classified as state or non-state in one place; a test parses
  `prisma/schema.prisma` and fails on any model that is not classified. A model is state when the
  snapshot, a memoised value or a published deliverable reads it. Derived tables written on a read
  (a lazy brief, a run insight) and the publisher's own tables are non-state.
- `loadAthleteContext(deps, { userId, today })` returns the deep-frozen snapshot (profile,
  activities, wellness, reviews, screening flags, zone changes, state, zones, readiness, the stored
  plan and predictions on demand); `memoByVersion` caches derived values (stats, the heart-rate
  model, the weekly decision, undo availability) under the same key and freezes them too. Concurrent
  readers of one key share one build, and a client keeps at most 8 snapshots and 64 memoised
  values. `GET /api/state` serves the snapshot with an ETag built from the key.
- Open-Meteo is reached only by the scheduler, which fills two cache tables; request handlers read
  them.
- Nothing about the snapshot is persisted.

Reasons:

- **Fact:** `gatherEngineInput` and `gatherContextInput` (`server/services/engineInput.ts`) load
  365 days of activities on every call and are called from the predictions route, the execution
  service and the plan engine service (read 2026-10-22); the audit's performance lens counted six
  routes that repeat the gather. One cached gather removes repeated work rather than speeding up a
  single query.
- **Fact:** better-sqlite3 is synchronous, so running the queries with `Promise.all` removes await
  hops but cannot parallelise the reads; the gain comes from building once per change, which the
  implementing PR measures and reports.
- **Fact:** a write hook that only bumps after each statement can leave a snapshot built after the
  last write of a transaction that later rolls back, with no further bump (phase 3a design review,
  2026-10-22); the transaction-end increment and the no-store rule close that ordering.
- **Fact:** `PRAGMA data_version` changes when another connection modifies the database file
  (SQLite documentation), which covers the e2e suite's `resetData`, a restore and command-line
  scripts that an in-process counter cannot see.
- **Rule:** the engine is deterministic for a given input and day (ADR 0005), so a snapshot keyed on
  the data, the day and the parameter version gives the same plan as a fresh gather; a test asserts
  that a warm and a cold build produce the same plan.
- **Opinion:** an automatic counter over a declared set of models cannot be forgotten by a new
  caller, which explicit bumps can; the classification test makes forgetting a new table fail the
  build instead.
- **Opinion:** a stale number after a write is worse than a slow page, so every guard errs towards
  rebuilding: a non-state table misclassified as state costs a rebuild, the reverse costs a wrong
  answer.
- **Preference:** an in-memory cache over a persisted one, because a single self-hosted process
  restarts rarely and a persisted snapshot would need invalidating on every engine change.

Alternatives:

- **No cache; parallel, column-selected queries only.** Against (**Fact**): the synchronous driver
  above; the repeated gathers remain.
- **Explicit `bumpDataVersion()` calls at every write site.** Against (**Opinion**): seven epics
  write state; one missed call is a stale screen, and nothing would catch it. It remains the
  documented fallback if the query extension does not fire inside interactive transactions with the
  better-sqlite3 adapter.
- **A watermark of `updatedAt` columns and row counts.** Against (**Fact**): the publisher's draft
  watermark missed activities, the forecast, fuel logs and disruptions (phase 3a design review,
  2026-10-22); every new table would need adding by hand.
- **A persisted snapshot table.** Against (**Opinion**): it adds invalidation on every
  `PARAMS_VERSION` and engine change for no gain in a single process.
- **One counter per user.** Against (**Opinion**): one runner uses the app; a global counter is
  simpler and correct, and can be split if the app ever hosts several active users.

## Consequences

- Every new Prisma model must be classified in the PR that adds it, and CLAUDE.md states that
  athlete data comes from `gatherEngineInput`, `loadAthleteContext` or `memoByVersion`, that nothing
  queries the history window or the stored plan outside them, and that no raw SQL writes a state
  table (a source test enforces the last).
- Deep-freezing the snapshot surfaces engine code that mutates its input in place; each site gets a
  local copy with no change in behaviour.
- `createPrisma` returns a proxy typed as `PrismaClient` through one documented cast, so existing
  `Pick<PrismaClient, ...>` types compile unchanged.
- A forecast-dependent deliverable (the watch publisher) composes its change key from the data
  version, the day and the forecast's fetch time, because the forecast cache is non-state.
- The global counter invalidates every user's snapshot on any state write; irrelevant for one runner.
- Request handlers never wait on Open-Meteo; plan generation may wait up to 8 seconds once for race
  climate on a cold cache. Until the weather cache replaces it, the goal model reads the race climate
  through `server/services/raceClimate.ts`, so a cold prediction can wait on the archive as it did
  before.
