# Status

Current state only; rewritten at every boundary. History lives in `git log`, the design doc
(`docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md`), the plan
(`docs/superpowers/plans/2026-10-21-running-app-rewrite.md`) and `docs/adr/`.

Last update: 2026-10-22.

## Where things stand

- Branch `rewrite/v2` replaces the whole tree with the clean rewrite. Draft PR #528 targets
  `main`; the owner merges.
- Gates on the branch: `npm run check` (lint, Prettier, typecheck, Vitest unit + API),
  `npm run build`, `npm run test:e2e` (Playwright, chromium), `npm audit --omit=dev` at 0,
  Docker image builds and stops cleanly. CI runs the first three plus CodeQL on every push.
- CodeQL on the PR reports "2 configurations not found" because old `main` scanned JavaScript
  and TypeScript as separate configurations; it clears once the new `codeql.yml` is on `main`.

## Open follow-ups (none blocks the merge)

1. Behind a reverse proxy, rate limits key on the proxy's address. Add a trust-proxy setting
   when deploying that way (review finding skipped on purpose: the env var list is fixed at six).
2. "Make active" on a goal other than the plan's goal leaves the plan on the old goal; the
   dashboard follows the plan's goal. Decide whether activation should prompt to regenerate.
3. Imports and activity edits run their duplicate pass in separate statements; a crash
   part-way can leave flags inconsistent. Acceptable for one user; revisit if it bites.
4. Spec non-goals still open: readiness and race-decision gates as stored decisions, long-run
   lab and fueling logs, strength programming, live Smashrun sync.
5. Enable branch protection on `main` requiring the `ci` and `analyze` checks.
6. The Docker runtime image is 594 MB; most of it is the Prisma CLI needed for
   `migrate deploy`. A smaller migration path would shrink it.

## Clean-up after the merge

- Delete obsolete remote branches: `feat/comprehensive-ci-cd-infrastructure`,
  `feature/phase3-test-fixes-complete`, the five `fix/*-pr298` branches, the eight July-2025
  rescue branches (`architectural-review-and-improvements`, `error-logging-standardization`,
  `feature/refactor-async-handlers-39`, `fix/footer-css-classes-issue-155`,
  `fix/issue-113-api-mocking-standardization`, `fix/limit-pace-decimal-places-108`,
  `issue-105-fix-unreachable-catch-stats`, `lint-react-hooks`), and the `task/*` and
  `review/*` branches from the rewrite's parallel agents.
- Remove the stale worktrees in the bare repository (`build e2e integration linting
unit-tests` and `.claude/worktrees/wf_*`) and check `_main` out on `main`.
- Close the open Dependabot PRs; their targets no longer exist.
- Unset `core.hooksPath` in the bare repository; it points at a removed `.husky/_`.

## Environment notes

- Bare repository with worktrees (`~/src/BARE-REPO-WORKFLOW.md`). Isolated agent worktrees
  branch from `origin/main` and have no `node_modules`.
- Port 3101 is reserved by the Playwright web server.
- Personal training data stays in Google Sheets and Smashrun; the repository holds synthetic
  fixtures only.
