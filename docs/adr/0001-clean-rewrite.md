# 0001. Replace the old code with a clean rewrite

Status: Accepted 2026-10-22 (#528)

## Context

The previous `running-app-mvp` tree was a small Strava-style activity log wrapped in enterprise
scaffolding: three loggers, three chart families, 17 workflows, a vendored `packages/` directory,
dozens of root-level reports and a red CI. It was never deployed, so nothing needs to stay
compatible with it. The real product specification is the training workflow already worked out
in a Google Sheets tracker.

## Decision

Delete the old tree (git history keeps it) and build the new application from the design in
`docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md`.

Reasons:

- **Fact:** The audit on 2026-10-21 scored the old code 2/5, found almost nothing worth keeping,
  and found CI failing.
- **Fact:** No deployment exists, so no data or API contract has to survive.
- **Opinion:** A small tree that one person can read end to end is cheaper to keep correct than
  a large tree that has to be audited before each change.

Alternatives:

- **Keep the old code and prune it.** Against (**Opinion**): pruning means reading and
  re-testing every surviving module, which costs about as much as writing it again against a
  clear specification.

## Consequences

- Every earlier file disappears from the working tree; `git log` and `git show` remain the way
  to recover anything.
- The new tree has to reach feature parity with the sheet's workflow before it is useful, so
  the first release is larger than an incremental fix would have been.
