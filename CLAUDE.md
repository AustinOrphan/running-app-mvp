# CLAUDE.md

Guidance for **Claude Code** working in this repository. This file is optimized for **effectiveness, verification, and low context overhead**. Keep changes **minimal**, **verifiable**, and **aligned with existing scripts and patterns**.

---

## Core Operating Rules (always follow)

- **Do not invent commands or scripts.** Only use `npm run <script>` entries that exist in `package.json`.
- **Verification is mandatory.** Every meaningful change must be validated via tests, typechecking, linting, or a reproducible manual check.
- **Prefer small diffs.** Avoid large refactors unless explicitly requested.
- **Summarize, don’t dump.** Never paste large logs; report outcomes and only the critical failure lines if needed.
- **Check the repo first.** Inspect scripts, configs, and patterns before asking questions.

---

## Stack & Runtime

- **Node:** >= 20 (Volta pinned to 24.5.0)
- **Module system:** ESM (`"type": "module"`)
- **Frontend:** React 18 + TypeScript + Vite (dev: `http://localhost:3000`)
- **Backend:** Express + TypeScript (TSX) (dev: `http://localhost:3001`)
- **Database:** SQLite via Prisma
- **Auth:** JWT + bcrypt

---

## Golden Commands (start here)

### Setup

```bash
npm run setup
```

Optional (Git hooks):

```bash
npm run setup:hooks
```

### Development

```bash
npm run dev          # backend
npm run dev:frontend # frontend
npm run dev:full     # both
```

### Required Quality Gate (before calling work “done”)

```bash
npm run lint:fix
npm run typecheck
npm run test:run
```

For stricter validation:

```bash
npm run lint:check
```

---

## Database / Prisma

Common commands:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

Schema & migration hygiene:

```bash
npm run verify-schema
npm run validate-migrations
npm run ensure-migrations
```

**Rule:** Any change to `prisma/schema.prisma` must include valid migrations and a regenerated Prisma client.

---

## Testing Strategy (use the smallest layer that proves correctness)

### Unit Tests (Vitest)

```bash
npm run test
npm run test:run
npm run test:watch
npm run test:coverage
```

### Integration Tests (Jest via repo scripts)

Preferred:

```bash
npm run test:integration
```

Local config:

```bash
npm run test:integration:direct
```

CI config:

```bash
npm run test:integration:ci
```

### End-to-End Tests (Playwright)

```bash
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:headed
npm run test:e2e:ci
```

### Accessibility & Visual Regression

```bash
npm run test:a11y
npm run test:a11y:e2e
npm run test:visual
npm run test:visual:update
```

---

## “Before You Push” Checklist

Minimum required:

```bash
npm run lint:fix
npm run typecheck
npm run test:run
```

If API or DB behavior changed:

```bash
npm run test:integration
```

If authentication, routing, or user flows changed:

```bash
npm run test:e2e
```

---

## CI / Test Environment Readiness

If tests fail due to environment or migration issues:

```bash
npm run validate-test-env
npm run test:ensure-ready:quick
npm run test:verify:prisma
```

CI database lifecycle helpers (debug/parity only):

```bash
npm run ci-db-setup
npm run ci-db-teardown
```

---

## Performance, Bundle Size & Lighthouse

Bundle checks:

```bash
npm run bundle:check
npm run build:analyze
```

Performance & Lighthouse:

```bash
npm run test:performance:basic
npm run test:performance:full
npm run test:lighthouse
npm run test:lighthouse:ci
```

---

## Troubleshooting Patterns

### Prisma or migrations out of sync

```bash
npm run ensure-migrations
npm run prisma:generate
npm run verify-schema
```

### Integration tests hanging / open handles

```bash
npm run test:integration:ci
```

### E2E timing or flakiness

```bash
npm run test:e2e:headed
npm run test:e2e -- --debug
```

---

## Standard Claude Workflow (non-trivial tasks)

1. Restate the goal and **explicit success criteria**.
2. Inspect only relevant files.
3. Implement the smallest possible diff.
4. Run verification commands appropriate to the change.
5. Report what changed, where, and how it was verified.

---

## Scope Rule

This file must remain **short and high-signal**. Deep CI internals, flake analysis, cache systems, or performance dashboards belong in `/docs/*` and should only be linked from here.

If this file starts reading like a manual, propose what should be moved out.

