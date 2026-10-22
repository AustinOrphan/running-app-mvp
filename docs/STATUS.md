# Status

Current state only; rewritten at every boundary. History lives in `git log`, the specs and
plans under `docs/superpowers/`, the research corpus under `research/` and `docs/adr/`.

Last update: 2026-10-22.

## Where things stand

- **On `main`:** the clean rewrite (#528, rebase-merged) and the evidence engine, data
  foundation and research corpus (#529, squash-merged as `2e17f23a`); the CodeQL escaping fix
  (#536).
- **PR `feat/engine-defaults-round2` → `main`:** the owner's answers to the eight section-10
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

## Decisions for the owner

None pending. The section-10 items are confirmed; the builder calls the second pass added are
listed there (experienced returner after 90 days off restarts at 3 × 20; ladder weeks exempt from
the soft ramp warning only; BMI > 30 holds rung 1 for three weeks; the ultra weekly feasibility
path measures toward the long-run week, not the class peak; the check-in gate is computed, not
stored, and a check-in older than 3 days neither delays nor releases a step).

## Open follow-ups (none blocks a merge)

1. The weekly decision's "first days of heat" and "sleep efficiency drop" holds are not derived
   from data yet, so those two J5 signals never fire.
2. The 8 h race-simulation opt-in (H2) and the "no later than 3 weeks before race day" timing are
   design intent: no code reads `h2.raceSimulationMaxHours`.
3. A declared longest run (A3) has no profile field; a runner with no logs starts at rung 1 or, if
   experienced and unflagged, at 3 × 20. The n1 walk-jog stages for bone stress injuries are not
   implemented: a recent bone stress injury takes the same injury-return ladder.
4. Post-race: strength sessions stay at 0 through the window with no evidence either way; the
   first-finish modifier applies to a runner with no race history at all; the window trigger for a
   new plan uses the D1 class (so a 40 km race counts as a marathon) while G-1 uses the literal
   42,195 m.
5. A session the engine trims after a hold decision is stored without its untrimmed version.
6. Lower-ranked review findings not yet addressed: nested sheets share the Escape key; Apple
   Health push skips the range checks the parsed import applies; the JSON body parsers for ingest
   and imports run before authentication; Garmin wellness that runs out of request budget records
   a successful run; Goals reads "1:45" as minutes and seconds; a few engine tests assert
   conditionally.
7. Behind a reverse proxy, rate limits key on the proxy's address (no trust-proxy setting by
   design: the environment variables are fixed).
8. "Make active" on a goal other than the plan's goal leaves the plan on the old goal.
9. Spec non-goals still open: readiness and race-decision gates as stored decisions, long-run lab
   and fueling logs, strength programming; Polar, WHOOP, Oura and Google Health providers.
10. Enable branch protection on `main` requiring the `ci` and `analyze` checks.

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
- Port 3101 is reserved by the Playwright web server, which also clears `test-results/`.
- The owner's intervals.icu account goes dormant without a login; Garmin's official API is
  closed to new applicants (October 2026).
- Personal training data stays in Google Sheets, Smashrun and the owner's own app database; the
  repository holds synthetic fixtures only.
