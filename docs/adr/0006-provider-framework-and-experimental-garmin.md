# 0006. One provider interface for data sources, with Garmin Connect as an experimental provider

Status: Accepted 2026-10-22 (#529)

## Context

The training engine needs heart rate, elevation, weather, laps and daily wellness (resting heart
rate, HRV, sleep), and the owner does not want to type them. The data sits in several places: files
from a watch, intervals.icu, Strava, Apple Health and Garmin Connect. The first ruling on Garmin
(`docs/superpowers/specs/2026-10-22-data-foundation-design.md`, section 1) was no, because the
official API is for approved businesses and the unofficial login is fragile. The owner asked for it a
second time.

## Decision

Every source is a provider: one module in `server/providers/<key>.ts` plus one entry in
`server/providers/registry.ts` with its `ProviderInfo`. A provider implements only the channels it
declares, `pull` (scheduled fetch), `push` (the source posts to `/api/ingest/<key>` with a bearer
token) or `upload` (the browser sends an export); the watched folder has no module because the
scheduler scans it. A provider returns `ParsedActivity` and `WellnessInput` values and never writes
to the database; `server/services/activityStore.ts` is the only writer of imported activities. All
network access goes through the injected `ctx.fetch`, secrets go through `server/crypto.ts` and are
never logged or returned, and no new environment variable is added.

Garmin Connect ships as an experimental pull provider, off until connected. It speaks the mobile
app's sign-in and API. The card states the risks and the connect form requires ticking that the
runner understands them. Only tokens are stored, never the password. The provider makes at most one
request per second and 200 per run, and any 403 or 429 pauses it for six hours. A pasted-token route
covers the case where the sign-in is refused.

Reasons:

- **Fact:** Garmin's official API lists a personal tier but has paused new applications since spring
  2026, so it is not obtainable today; the unofficial route is the only direct one
  (`docs/research/integrations-2026-10.md`, checked 2026-10-22).
- **Fact:** The same research found that COROS, Suunto, TrainingPeaks and Wahoo offer partner or
  approval-only access, and that Polar AccessLink and WHOOP are possible later as single modules. One interface makes each of those a single added module.
- **Rule:** Design spec data foundation, section 2.6, defines the three channels and the
  `ProviderCtx` that carries the injected `fetch`, timezone, secrets and a rate-limit budget.
- **Opinion:** A provider that returns values and never writes keeps duplicate handling (the richer
  source wins, the other is marked) in one place, so a new source cannot double-count a run.
- **Opinion:** Keeping the Garmin provider experimental, off by default and throttled limits the harm
  of a block or a change by Garmin to one disabled card, and none of the other providers depend on it.
- **Preference:** The owner asked twice for direct Garmin access, so it ships behind a clear warning
  instead of staying out.

Alternatives:

- **Leave Garmin out and route it through intervals.icu.** Against (**Fact**): this still works and
  the card says so; it does not give a direct connection, which was the request. It stays the
  recommended route.
- **A third-party aggregator service.** Against (**Rule**): the project makes no third-party
  requests beyond the integrations a runner connects, and keeps all data in one SQLite file.
- **One module that handles every source.** Against (**Opinion**): sources differ in channel, auth
  and failure modes, and a shared module would grow a branch per source.

## Consequences

- Garmin can change or block the unofficial API at any time; the provider can stop working without a
  code change on this side. The card shows "Needs reconnecting" or a pause, and file imports or
  intervals.icu remain available.
- Repeated failed sign-ins can rate-limit the Garmin account. The throttle and the acknowledgement
  checkbox reduce that risk and do not remove it.
- Cloudflare in front of Garmin may refuse a server or datacentre address with a 403; the token
  route is the fallback.
- Adding a source later is one module and one registry entry, with synthetic fixtures and no network
  in tests.
