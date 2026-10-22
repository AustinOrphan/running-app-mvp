# Running log

A self-hosted training log and planner for one runner. It keeps activities, goal races, a
generated weekly plan, weekly reviews, a dashboard and stats. One Node process serves the API and
the built web app, and the data lives in a single SQLite file. There is no telemetry and the app
makes no requests to third parties.

Targets are a sketch, not minimums: the plan never makes up missed volume, and a suggestion never
changes a target by itself.

## Quick start

Requires Node 24 (`.nvmrc`; `engines` allows 22 and newer) and npm.

```sh
npm install
npm run setup        # creates .env from .env.example and fills SESSION_SECRET
npm run db:migrate   # applies the Prisma migrations
npm run dev          # API on :3001, web app on :5173
```

Open <http://localhost:5173>.

### First run

A fresh database sends every visitor to the setup page. Enter an email, an optional display name
and a password of at least 12 characters (72 bytes at most). That creates the one account for the
install; the setup page closes afterwards. A second account needs `ALLOW_REGISTRATION=true`.

Sign-in sets an httpOnly cookie that lasts 30 days. Sign-in is limited to 10 attempts per address
per 15 minutes (successful ones count too); the limit is held in memory and resets on restart.

## Commands

| Command                             | Purpose                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `npm run dev`                       | API and Vite dev server with reload                      |
| `npm run check`                     | lint, Prettier check, typecheck, unit, API and web tests |
| `npm run build`                     | build the web app and compile the server into `dist`     |
| `npm start`                         | run the built server                                     |
| `npm run test:e2e`                  | Playwright golden paths against the production build     |
| `npm run format`                    | rewrite files with Prettier                              |
| `npm run db:migrate`                | apply migrations (`prisma migrate deploy`)               |
| `npm run reset-password -- <email>` | set a new password from the command line                 |

The e2e suite needs a build first and a Chromium install once: `npx playwright install chromium`.

## Environment variables

Read from the process environment, or from `.env` in development. Nothing else is read.

| Variable             | Default              | Meaning                                                         |
| -------------------- | -------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`       | `file:./data/app.db` | SQLite file. A relative path resolves against `prisma/`.        |
| `SESSION_SECRET`     | none, required       | At least 32 characters. Signs the session cookie.               |
| `PORT`               | `3001`               | Port the server listens on.                                     |
| `NODE_ENV`           | `development`        | `development`, `test` or `production`.                          |
| `ALLOW_REGISTRATION` | `false`              | `true` allows creating more than one account.                   |
| `LOG_LEVEL`          | `info`               | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |

Rotating `SESSION_SECRET` invalidates every session cookie, so the next request sends you to the
sign-in page. Nothing else is lost; sign in again with the same password.

The server derives "today" and the current week from its own clock. In Docker, set `TZ` to your
time zone (an operating-system setting, not an application variable).

## Importing activities

Activities page, then Import. Rows already imported are skipped, so importing the same file twice
changes nothing. The report lists every row that was skipped and why; unreadable rows are never
dropped silently.

- **Smashrun CSV.** The 26-column Smashrun export, with or without a header row and with an
  optional leading index column. Pick the distance unit used in the file: Smashrun writes distances
  in the unit of the Smashrun account (miles or kilometres), and the file does not say which. A
  wrong choice scales every distance, so check one known run after the first import. Each row
  becomes a run; the local `Start Date` decides the calendar day.
- **Generic CSV.** A header row with `date` (`YYYY-MM-DD`), `minutes` and `miles` (always miles),
  plus optional `type` (only `run` is accepted) and `notes`.

A manual run on the same day within 80 m of an imported one is flagged as a possible duplicate and
left out of totals until you confirm or dismiss it. Files up to 10 MB are accepted. Excel-saved
files (byte-order mark, Windows line endings) import like clean ones.

Activities can be exported again from Settings as CSV.

## Docker

```sh
export SESSION_SECRET="$(openssl rand -base64 48)"
docker compose up -d
```

The app listens on port 3001 and keeps its database in the `app-data` volume mounted at `/data`.
`docker compose` refuses to start without `SESSION_SECRET`; keep the value somewhere safe, because
a new value signs you out. The container runs as the unprivileged `node` user (uid 1000), so a
bind mount instead of the volume needs `chown 1000:1000` on the host directory. Migrations run on
every start.

Without Compose:

```sh
docker build -t running-log .
docker run -d -p 3001:3001 -v running-log-data:/data \
  -e SESSION_SECRET="$(openssl rand -base64 48)" -e TZ=Europe/London running-log
```

Back up the database while the app runs with `sqlite3 /data/app.db ".backup 'backup.db'"`; copying
the file alone can miss changes still in the write-ahead log.

## Resetting the password

```sh
npm run reset-password -- you@example.com
```

In Docker, run the compiled script inside the container (it prompts for the password, or reads one
line from standard input):

```sh
docker compose exec app node dist/scripts/reset-password.js you@example.com
```

## Installing as an app

The web app has a manifest and icon, so a phone or desktop browser can add it to the home screen.
There is no offline mode; the app needs the server.

## Design documents

- `docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md`: behaviour, data model and API
  (section 7 refines sections 1 to 6 and wins where they differ)
- `docs/superpowers/specs/2026-10-21-visual-design.md`: tokens, layout, components, charts and
  copy tone
- `docs/superpowers/plans/2026-10-21-running-app-rewrite.md`: the task plan the code was built from
- `docs/adr/`: architecture decision records

## Layout

- `server/`: Express app, auth, routes, services
- `shared/`: pure domain code used by server and web
- `web/`: React and Vite single-page app
- `prisma/`: schema and migrations; `prisma.config.ts` holds the CLI settings
- `generated/`: Prisma client, gitignored, written by `prisma generate` (the npm pre-scripts run it)
- `tests/`: unit, api, web and e2e

## Licence

MIT.
