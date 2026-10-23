# Running log

A self-hosted training log and planner for one runner. It keeps activities, goal races, a
generated weekly plan, weekly reviews, a Today page that leads with the day's session and
readiness, and stats. One Node process serves the API and the built web app, and the data lives in
a single SQLite file. There is no telemetry. The app calls third parties only for the integrations
you connect and for weather (see Integrations).

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

## Integrations

Activities and daily health data can arrive without typing. Every source is a provider; the
Integrations page (More, then Integrations) shows one card each with its status, last sync and a
Disconnect button. Disconnecting forgets the stored credentials; the activities stay.

Pull providers sync hourly in the background, and the card's Sync now button runs one at once. The
first run reads the last year; set Backfill from on the card to go further back. Weather is added
afterwards by a background job that runs every ten minutes.

Credentials (API keys, client secrets, tokens) are encrypted with a key derived from
`SESSION_SECRET` and stored in the database. Rotating `SESSION_SECRET` makes them unreadable: the
card then says "Needs reconnecting" and the credentials must be entered again.

An activity that arrives from two sources (a watch file and the same run through Strava, say) is
kept once: the richer source wins and the other is marked as a duplicate. The detail page and the
activities list name the source of each activity.

| Provider       | How it connects                | Brings                                                   |
| -------------- | ------------------------------ | -------------------------------------------------------- |
| Activity files | Import dialog                  | Activities with heart rate, laps, elevation and a stream |
| intervals.icu  | API key, hourly pull           | Activities, resting HR, HRV (rMSSD), sleep, weight       |
| Strava         | Your own API app, OAuth, pull  | Activities with heart rate, cadence, power and elevation |
| Garmin Connect | Sign-in or pasted tokens, pull | Activities, resting HR, HRV (rMSSD), sleep. Experimental |
| Apple Health   | Health Auto Export push, file  | Workouts, resting HR, HRV (SDNN), sleep, weight, VO2 max |
| Watched folder | A folder on the server         | Any FIT, GPX or TCX file that lands in it                |

### Activity files and exports

On the Activities page, Import, then Activity files. Pick FIT, GPX or TCX files, or ZIP archives of
them. The browser opens archives inside archives and `.gz` files before uploading, so the Garmin
"Export your data" archive and the Strava bulk export (`*.fit.gz`, `*.gpx.gz`, `*.tcx.gz`) work as
downloaded, in batches of up to 20 files. The report lists every file that was skipped and why. A
file already imported is recognised by its content, so importing it twice changes nothing. Each
activity keeps its original file; the detail page offers it for download.

Apple Health history: on the iPhone open the Health app, tap your picture, choose Export All Health
Data, and import the resulting `export.zip` with Import, then Apple Health. The file is read in your
browser (it can be hundreds of megabytes); only workouts, routes and daily values are sent.

### intervals.icu

Needs an intervals.icu account that is active. It is the recommended route for Garmin: connect Garmin to
intervals.icu there (an official integration), then connect intervals.icu here.

1. In intervals.icu, open Settings, then Developer Settings, and create an API key.
2. Note the athlete id shown on the settings page (it looks like `i12345`).
3. On the Integrations page, enter both on the intervals.icu card and choose Connect.

The original FIT file is downloaded when intervals.icu has it. Activities that intervals.icu itself
received from Strava are not exposed through its API and no file is available for them; connect
Strava here as well to get those. Daily resting HR, HRV (rMSSD), sleep and weight come from the
wellness records.

### Strava

Strava needs your own API application, because the app is self-hosted and has no shared client.

1. Open <https://www.strava.com/settings/api> and create an application (any name and category).
2. Set Authorization Callback Domain to the host you open this app on, such as `running.example.com`
   or `localhost`. The card shows the exact value. It is a host name only, without `https://` or a
   path.
3. Copy the client id and client secret into the Strava card. The secret is stored encrypted.
4. If the app is reached through an address other than the one in your browser's address bar (for
   example behind a reverse proxy), fill in Public address so the callback uses it.
5. Choose Connect, then approve access on Strava (`read` and `activity:read_all`). Activities
   arrive on the next sync.

Strava brings activities with heart rate, cadence, power and altitude streams but no original files
and no wellness data. Strava rate-limits each application; a long backfill pauses at 80% of either
limit and continues on the next run.

### Garmin Connect (experimental)

Garmin's official developer programme is closed to new applicants, so this provider uses the same
sign-in and API as Garmin's mobile app. It is off until connected. Risks:

- It is unofficial and against the spirit of Garmin's terms. Garmin can change or block it at any
  time and it may stop working without notice.
- Repeated failed or rapid sign-ins can rate-limit or temporarily block the Garmin account
  (reports mention blocks of about 48 hours). The connect form requires ticking that you
  understand this.
- Cloudflare in front of Garmin may refuse the sign-in from a server (HTTP 403) or from a
  datacentre address. Use the token route below when that happens.
- Only tokens are stored, never the password. The password is sent once to Garmin and not logged.
- Sync is deliberately slow: one request per second, at most 200 per run. Any 403 or 429 pauses the
  provider for six hours.

To connect: enter the Garmin username and password on the card. If the account uses two-step
verification, enter the code Garmin sends within 10 minutes. If the sign-in is refused, run
`python-garminconnect` once on a trusted machine to sign in, and paste the token JSON it writes
(`access_token`, `refresh_token`, `expires_in` or `expires_at`) with Paste tokens instead.

It brings activities (the original FIT file where Garmin provides it), plus resting heart rate,
HRV (last-night average, rMSSD) and sleep for the last 30 days on each run. If intervals.icu already
receives the same Garmin data, prefer intervals.icu and leave this off.

### Apple Health

Two ways, which can be combined:

- **Health Auto Export (push).** The iOS app Health Auto Export (its Premium tier supports REST
  automations) posts workouts and daily metrics to this server as they happen.
  1. On the Apple Health card, choose Create push token. The token is shown once; copy it.
     Creating another replaces the first.
  2. In Health Auto Export, add an automation of type REST API. Set the URL to
     `https://<your host>/api/ingest/apple-health` (the card shows it). The phone must be able to
     reach the server, so a home server needs a VPN or a public HTTPS address.
  3. Add a header `Authorization` with the value `Bearer <token>`.
  4. Export format JSON, version 2. Turn Include Route Data on. Set the sync to Since Last Sync and
     select the Workouts data type and the metrics Resting Heart Rate, Heart Rate Variability,
     Sleep Analysis, Body Mass (weight) and VO2 Max.
     Workouts, heart-rate series, route altitude and the start location, temperature and humidity are
     used. Metrics with names the app does not know are counted and ignored, never an error. Apple's
     HRV is SDNN, which is stored separately from the rMSSD that Garmin and intervals.icu report and
     is never mixed with it.
- **Export file (history).** See Activity files and exports above.

### Watched folder

Point the Watched folder card at a directory on the server and any FIT, GPX or TCX file (also
`.zip` and `.gz`) that appears in it is imported. This suits HealthFit, a Garmin or Coros export
tool, or any app that can write files to iCloud Drive, Dropbox, Syncthing or a network share.

- The folder is read-only to the app. It is scanned every 5 minutes, including subfolders, and a
  file changed in the last few seconds waits for the next scan. Files are remembered by content, so
  moving or renaming one does not import it twice.
- The path must exist and be a directory.
- In Docker the folder must be mounted into the container, and the path on the card is the path
  inside it. Add a read-only bind mount to `docker-compose.yml`:

  ```yaml
  services:
    app:
      volumes:
        - app-data:/data
        - /srv/sync/running-files:/import:ro
  ```

  Then enter `/import` on the card. The container runs as uid 1000, so that user must be able to
  read the host folder.

### Weather and privacy

The app otherwise makes no third-party requests. With weather on, a background job sends
Open-Meteo (no account or key) the start location of each activity, rounded to about one
kilometre, and its time; for an activity without a location it uses the home location from the
Profile page when "use the home location for weather" is on. Turn that off, and leave the home
location empty, to send nothing. Providers see only what you connect: the app calls intervals.icu,
Strava and Garmin only after you connect them, and only for your own account.

## Sessions on the watch

A planned run reaches a watch by three routes. All three are rendered from one workout, so they
cannot disagree: an easy run carries one heart-rate ceiling, an interval session a pace band per
repeat and an open recovery, and a long run of two hours or more its fuel line. A session that the
day's readiness eases goes out as the easy version, without the reason; a rest advice takes it off
the watch.

| Route         | What it holds                                        | Where it is switched on                           |
| ------------- | ---------------------------------------------------- | ------------------------------------------------- |
| intervals.icu | The next 14 days of runs, kept in step with the plan | Integrations, intervals.icu card, Send sessions   |
| Workout file  | One `.fit` per session, one `.zip` per week          | Plan page: the session sheet, and the week's link |
| Calendar link | The next 28 days, as titles and durations only       | Integrations, Calendar link section               |

Only the first route needs an account, and it is the only one that writes to a third party. The file
and the calendar link keep working when intervals.icu or Garmin Connect is down.

### Through intervals.icu

Sending is off until "Send my next 14 days of runs to intervals.icu" is ticked on the connected
intervals.icu card. The app then creates one event per run in the intervals.icu calendar, updates it
when the plan changes (a move, a new zone, an eased day, an undo) within a few minutes, and removes
it when the session is skipped or readiness advises rest. An event deleted by hand in intervals.icu
is not created again until the session changes. "Send now" starts a send at once instead of waiting
for the next one.

intervals.icu forwards planned workouts to Garmin Connect, and from there to the watch, only when
that is switched on in intervals.icu (Settings, Garmin Connect). The second box on the card records
that choice. The app cannot check it, so Plan and Today say "Sent to intervals.icu" and say "On your
watch" only when the box is ticked, intervals.icu reports no error from Garmin Connect, and 15
minutes have passed since the send.

Turning sending off, or disconnecting intervals.icu, offers to remove the sessions already sent; the
removal needs the API key, so a failed removal keeps the connection and offers to disconnect without
it. intervals.icu closes accounts that are not logged in to for a long time; logging in now and then
keeps the plan reaching the watch.

### Workout files

The session sheet on the Plan page offers "Download the workout file", named by date and kind (for
example `2027-03-02-easy-run.fit`, never the session title). The strip at the top of the Plan page
offers "Download this week as .zip", and each opened week "Download the week of <date> as .zip", with
one file per run still to be done. A file is loaded onto the watch
by USB or through a Garmin app; the route that works depends on the watch model. The file holds
today's version of the session, with the current zones.

### Calendar link

The Calendar link section on the Integrations page makes a private address that any calendar app can
subscribe to (a `webcal://` link opens the app directly). Anyone holding the address can read the
titles and durations of the next 28 days; titles name the kind of run only ("Easy run, 45 min"),
never a reason, a figure of the body or a heart-rate or pace target. The address is shown once, when
it is made, because only a hash of it is stored; making a new one ends the old one at once, and
"Turn off the link" ends it without a replacement. A reverse proxy in front of the app may keep the
address in its own access log, which the app cannot clear; the app redacts the address from its own.

## Training engine

Plans come from a deterministic engine in `shared/engine/`: the same history, profile, goal and
date always give the same plan. It is pure TypeScript with no network calls, and no language model
chooses a session. Every number it uses is a record in a parameter registry, tied to a rule in
`research/engine-rules.md` and, where one exists, to the papers behind it.

### What it does

- Estimates your state from the last year of runs: load, the longest recent runs, consistency,
  fitness, and efficiency.
- Builds zones, in heart rate and pace, and records the source of each boundary.
- Plans backwards from race day: phases, recovery weeks, a taper, and day-level sessions placed on
  the days you have free. A goal carries distance, climb, surface, start time and support level, and
  gets a feasibility label (comfortable, tight, or not reachable within default limits) and a
  predicted time with a range.
- Holds every session and every week inside safety limits: a cap on the jump from your recent
  longest run, a weekly ramp, no make-up of missed volume, and caps on time on feet for ultras. A
  plan that would break a limit is not published; the page says which check failed.
- Links each run to the session it fulfils and compares them: duration, time in the target zone,
  how hard it felt (RPE and the feel rating), and heart rate at pace, corrected for heat and grade.
  Pain of 4 or more raises the matching warning at once.
- Re-plans from the Review page, from the Plan page ("Update plan from latest data") and every
  Monday. The past stays as it was; the "What changed" list shows each revision with its rule ids.
- Gives each day readiness advice that can only lower the day, never add to it.

### What it does not do

- It does not diagnose or treat anything. The red-flag notices and the energy-availability screen
  point to care.
- It does not add load because a signal looks good, and it does not reschedule missed sessions.
- It does not change your zones by itself. Zone changes are proposals that the Review page asks
  you to accept or decline.
- It does not let heart-rate variability or sleep decide a plan: they can lower a day, nothing more.
- It makes no claim about altitude: no evidence was retrieved for it.

The disclaimer, in full (the Today page shows a shortened form with a link to the grading):

> This plan is a sketch built from published research on groups of runners and from conservative defaults where research is missing. It cannot guarantee safety or performance, and it is not medical, nutrition or injury advice. Stop and see a qualified clinician for pain, illness or the warning signs listed. Many numbers are defaults that should change with your own experience, and the app shows which ones.

### How evidence and defaults are shown

The "Explain" and "Why this session" buttons of a Today session, and the "Why" buttons on Today,
Plan, Goals and Review, open one drawer. For each rule behind a number it shows the value and its
range, a grade badge, the papers with their findings and DOI links, and a plain note when the value
is a default. Grades:

| Grade | Meaning                                                                      |
| ----- | ---------------------------------------------------------------------------- |
| A     | consistent meta-analyses or consensus statements                             |
| B     | randomised trials or large prospective cohorts                               |
| C     | small trials, observational data, or a reasonable extrapolation              |
| D     | convention or engineering default; no direct evidence, chosen to be cautious |

Grade D values read "Default, not evidence" in the drawer. The Research page (More, then Research)
lists topics, rules and papers and filters by grade.

### Research corpus

`research/` holds the evidence: the papers as JSON (`papers/`), topic syntheses (`topics/`), the
rules per topic (`rules/`), the integrated rule set (`engine-rules.md`) and a method note
(`README.md`). Every DOI was checked against Crossref on 2026-10-22.

```sh
npm run research:check    # offline; schema, unique DOIs, every cited paper id exists. Part of npm run check
npm run research:verify   # online; re-checks DOIs against Crossref, one request at a time
```

To extend it, follow `research/README.md` ("How to extend") or the project skill
`.claude/skills/research-update/SKILL.md`: look up the paper, write its file, cite it in the topic,
rule and parameter that use it, then run both commands. A change to a number goes into
`engine-rules.md` first, then the parameter, then `PARAMS_VERSION`.

### Limits

- There are no training trials in runners of 50 km to 100 miles. The ultra rules (easy-running
  share, time on feet, back-to-backs, taper) are extrapolated from shorter distances or are
  conventions, and the drawer marks them as such.
- Heart-rate zones need a threshold heart rate, a measured maximum, or your age (for a predicted
  maximum of 208 minus 0.7 times age, with a band of about 11 bpm). With none of them there are no
  heart-rate targets.
- Pace zones need a threshold pace in the Profile, or three recent best efforts: runs of
  different distances between 400 m and 5 km inside the last 90 days. Without them, sessions are
  prescribed by effort (RPE) only.
- The prediction rests on your own races and efforts and has a stated range; no model for
  50 km to 100-mile trail times has been calibrated.
- Women, runners over 50 and perimenopausal runners are under-represented in the underlying
  studies.

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
There is no offline mode yet; the app needs the server. When the offline shell arrives, it will
need https or localhost: browsers run the service worker that keeps the offline copy only on a
secure origin, so an install reached over plain http (a home server by IP address, say) will keep
working online only.

## Design documents

- `docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md`: behaviour, data model and API
  (section 7 refines sections 1 to 6 and wins where they differ)
- `docs/superpowers/specs/2026-10-21-visual-design.md`: tokens, layout, components, charts and
  copy tone
- `docs/superpowers/plans/2026-10-21-running-app-rewrite.md`: the task plan the code was built from
- `docs/superpowers/specs/2026-10-22-data-foundation-design.md` and its plan: file import,
  providers, weather, profile and wellness
- `docs/research/integrations-2026-10.md`: feasibility research behind the provider list
- `docs/superpowers/specs/2026-10-22-training-engine-design.md` and its plan: the training engine
- `docs/superpowers/specs/2026-10-22-coach-phase3a-design.md` section 6 and `docs/adr/0008-outbound-publish-channel.md`:
  how sessions reach a watch
- `research/README.md` and `research/engine-rules.md`: the evidence base and the rules derived from it
- `docs/adr/`: architecture decision records

## Layout

- `server/`: Express app, auth, routes, services, `providers/` (one module per source), `jobs/`
- `shared/`: pure domain code used by server and web; `shared/engine/` is the training engine
- `research/`: the paper corpus, topic syntheses and `engine-rules.md`
- `web/`: React and Vite single-page app
- `prisma/`: schema and migrations; `prisma.config.ts` holds the CLI settings
- `generated/`: Prisma client, gitignored, written by `prisma generate` (the npm pre-scripts run it)
- `tests/`: unit, api, web and e2e

## Licence

MIT.
