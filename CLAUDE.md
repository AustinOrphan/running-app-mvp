# Running log

Self-hosted training log and planner for one runner. Specs and the task plan are in
`docs/superpowers/`; where the design spec's section 7 differs from sections 1-6, section 7 wins.

## Commands

- `npm run check`: lint, typecheck, tests. Must pass before every commit.
- `npm run build`, `npm run test:e2e`, `npm run db:migrate`, `npm run dev`.

## Structure

- `server/` Express 5 API, `shared/` pure domain code, `web/` React SPA, `prisma/` SQLite schema.
- `tests/unit`, `tests/api`, `tests/web` (Vitest) and `tests/e2e` (Playwright).

## Conventions

- Relative imports carry the `.ts` or `.tsx` extension. No path aliases.
- Distance in metres, duration in seconds, plan targets in minutes, dates as `YYYY-MM-DD`
  strings, weeks start Monday (ADR 0003).
- npm only. Strict TypeScript. Prettier formats, ESLint 9 flat config lints.
- The repository is public: fixtures are synthetic, emails use `example.com`, no personal data.
- Commit subjects are imperative with a conventional prefix, at most 72 characters, with no
  attribution trailers. Comments, commits and ADRs avoid first and second person.
- Migrations under `prisma/migrations` are committed; never ignore them.
