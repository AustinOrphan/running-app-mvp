# 0004. Vitest for unit, API and component tests; Playwright for end to end

Status: Accepted 2026-10-22 (#528)

## Context

The old repository had Jest and Playwright with separate configuration, and its tests ran only
in deploy workflows. The new code has pure domain functions, an Express API, React components
and a handful of browser journeys.

## Decision

Vitest runs every test below the browser: unit tests on `shared/` and `server/`, API tests with
supertest against a temporary SQLite file, and component tests under jsdom with Testing Library.
Playwright with chromium runs only the end-to-end golden paths. Both run in CI on every push.

Reasons:

- **Preference:** The maintainer's other repositories already use Vitest and Playwright.
- **Opinion:** One runner for unit, API and component tests removes configuration drift between
  them and lets Vite's transform serve the web code.
- **Rule:** Design spec section 4.8 requires two Vitest projects (node and jsdom) and
  Playwright golden paths.

Alternatives:

- **Jest.** Against (**Opinion**): it needs a separate transform setup for ESM and TypeScript
  that Vitest gets from Vite.
- **Playwright component testing.** Against (**Opinion**): slower than jsdom for logic that
  does not need a real browser.

## Consequences

- API tests copy a migrated template SQLite file per test file, so no test shares a database.
- jsdom does not implement layout, so layout-dependent behaviour is covered only by Playwright.
