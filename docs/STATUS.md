# Status

Current state only; rewritten at every boundary. History lives in `git log`, the specs and
plans under `docs/superpowers/`, the research corpus under `research/` and `docs/adr/`.

Last update: 2026-10-22.

## Where things stand

- **PR #528** (`rewrite/v2` → `main`): the clean rewrite, rebase-merged 2026-10-22.
- **PR #529** (`feat/evidence-engine` → `main`): the verified research corpus (300 papers), the
  data foundation (files, intervals.icu, Strava, experimental Garmin, Apple Health, watched
  folder, weather, profile, wellness, activity detail, feedback) and the evidence-based training
  engine. The rebase merge of #528 gave its commits new hashes, so the branch still carries the
  pre-rebase copies; a no-op merge of `main` (tree unchanged) makes the diff exact, and GitHub
  reports the branch mergeable but not rebaseable. Squash-merge it: a merge commit would add
  the 96 pre-rebase duplicates of #528's commits to `main`.
- Gates on `feat/evidence-engine` (2026-10-22): `npm run check` (lint, Prettier, typecheck,
  `research:check`, 2331 Vitest tests), `npm run build`, `npm run test:e2e` (18 Playwright
  specs), `npm audit --omit=dev` at 0, Docker image builds (602 MB), applies all three
  migrations on a fresh volume and serves health, setup and the Research page.
- A local validation against the owner's real history (kept outside the repository) builds the
  100-mile plan with 0 warnings and all 13 checklist items passing.

## Decisions for the owner

The engine design (`docs/superpowers/specs/2026-10-22-training-engine-design.md`, section 10)
lists eight builder calls made during validation (restart floor, generated runs kept in the
normal spike band, baseline rules, post-race weeks, ultra feasibility targets, run length
following the long run, no trims from unrated runs, multi-day files up to 240 h). Each is a
labelled default in `shared/engine/params`.

## Open follow-ups (none blocks a merge)

1. The weekly decision's "first days of heat" and "sleep efficiency drop" holds are not derived
   from data yet, so those two J5 signals never fire.
2. Manual activity entry still stops at 48 hours (file imports allow 240); a one-line change in
   the activity schema and form.
3. A session the engine trims after a hold decision is stored without its untrimmed version.
4. Lower-ranked review findings not yet addressed: nested sheets share the Escape key; Apple
   Health push skips the range checks the parsed import applies; the JSON body parsers for
   ingest and imports run before authentication; Garmin wellness that runs out of request budget
   records a successful run; Goals reads "1:45" as minutes and seconds; a few engine tests
   assert conditionally.
5. Behind a reverse proxy, rate limits key on the proxy's address (no trust-proxy setting by
   design: the environment variables are fixed).
6. "Make active" on a goal other than the plan's goal leaves the plan on the old goal.
7. Spec non-goals still open: readiness and race-decision gates as stored decisions, long-run
   lab and fueling logs, strength programming; Polar, WHOOP, Oura and Google Health providers.
8. Enable branch protection on `main` requiring the `ci` and `analyze` checks.

## Clean-up after the merges

- Delete obsolete remote branches: `feat/comprehensive-ci-cd-infrastructure`,
  `feature/phase3-test-fixes-complete`, the five `fix/*-pr298` branches, the eight July-2025
  rescue branches (`architectural-review-and-improvements`, `error-logging-standardization`,
  `feature/refactor-async-handlers-39`, `fix/footer-css-classes-issue-155`,
  `fix/issue-113-api-mocking-standardization`, `fix/limit-pace-decimal-places-108`,
  `issue-105-fix-unreachable-catch-stats`, `lint-react-hooks`).
- Delete the local `task/*` and `review/*` branches from the parallel agents, and remove the
  agent worktrees under `.claude/worktrees/wf_*` plus the stale `build e2e integration linting
unit-tests` worktrees; check `_main` out on `main`.
- Unset `core.hooksPath` in the bare repository; it points at a removed `.husky/_`.

## Environment notes

- Bare repository with worktrees (`~/src/BARE-REPO-WORKFLOW.md`). Isolated agent worktrees
  branch from `origin/main` and have no `node_modules`.
- Port 3101 is reserved by the Playwright web server, which also clears `test-results/`.
- The owner's intervals.icu account goes dormant without a login; Garmin's official API is
  closed to new applicants (October 2026).
- Personal training data stays in Google Sheets, Smashrun and the owner's own app database; the
  repository holds synthetic fixtures only.
