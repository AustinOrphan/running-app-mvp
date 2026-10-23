# 0008. An outbound publish channel for planned sessions, with intervals.icu as the first target

Status: Accepted 2026-10-23 (#546)

Extends ADR 0006.

## Context

ADR 0006 defines one provider interface with three channels, all inbound: `pull`, `push` and
`upload`. The plan now has to reach the runner's watch, so the runner heads out with today's
session already loaded instead of re-typing it. The owner decided on 2026-10-22 (phase 3 decision 4)
that intervals.icu is the primary route, with a FIT workout file and a private calendar feed as
independent fallbacks, and that the unofficial Garmin provider never writes.

Garmin offers no open write path: its official API has paused new applications, and the
experimental provider speaks the mobile app's private sign-in. intervals.icu already holds the
owner's Garmin link and accepts planned workouts through its API, and uploads them to Garmin
Connect when the runner switches that on in intervals.icu.

This is the first time the app writes into a third-party account in the runner's name. It changes
what a provider may do, what can go wrong and what the runner must consent to, so it is recorded as
its own decision rather than as an edit to ADR 0006.

## Decision

A provider may declare a fourth channel, `publish`, implemented as a `PublishProvider` beside its
other channels in the same module: `reference(ctx)` reads the remote settings needed to write
targets (maximum heart rate, threshold heart rate, threshold pace), `upsert(workouts, reference,
ctx)` creates or updates events, `withdraw(refs, ctx)` removes them and `list(range, ctx)` reads back
what the remote holds, including delivery errors.

- The rules of ADR 0006 carry over: network only through `ctx.fetch`, secrets only through
  `server/crypto.ts` and never logged or returned, refreshed secrets through `ctx.saveSecret`, no new
  environment variable. A publish provider never writes to the database;
  `server/services/publish.ts` owns the publication rows, as `activityStore.ts` owns imported
  activities.
- Publishing is off until the runner turns it on, writes only run sessions of the next 14 days, and
  never goes through the experimental Garmin provider. Disabling it, or disconnecting intervals.icu,
  first offers to withdraw what was sent, because the key is needed to remove it.
- Each published session is identified as `rl-<user tag>-<externalId>`, where `externalId` is the
  durable session identity of the foundation epic and the user tag is a short hash of the user id.
  The remote event id is stored and used for updates.
- One provider-neutral workout model is rendered three ways (intervals.icu text, a FIT workout file,
  an ICS outline), and a cross-surface test asserts that they carry the same numbers as Today and the
  session sheet.
- A publish run starts when the data-version key, the local day or the home forecast changes, with a
  30-minute refresh as a backstop and a forced run at 04:45. Each run is recorded in the shared run
  history (`SyncRun`, channel `publish`). Every failure is stored per session and shown in words.
- The app says "On your watch" only when the runner ticked that intervals.icu uploads to Garmin
  Connect, intervals.icu reports no delivery error, and 15 minutes have passed; otherwise it says
  "Sent to intervals.icu".
- The private calendar feed is not a provider channel: it has no account to connect, sync or
  disconnect. It is a route behind a 256-bit token whose SHA-256 hash is stored, with titles from a
  closed allowlist of session kinds and no health information.
- Only intervals.icu implements `publish` in this release.

Reasons:

- **Fact:** the intervals.icu API documents `POST /api/v1/athlete/{id}/events/bulk` with an
  `upsert` flag keyed on `external_id`, `PUT /api/v1/athlete/{id}/events/bulk-delete` by id or
  `external_id`, `GET /api/v1/athlete/{id}/events` with category and date filters, and an
  `Event.push_errors` list (OpenAPI document at intervals.icu/api/v1/docs, read 2026-10-22).
- **Fact:** the same document limits `upsert` to events created by the calling OAuth application, so
  the stored remote id, not `external_id` matching, is relied on for an API-key caller.
- **Fact:** Garmin's official API paused new applications in spring 2026
  (`docs/research/integrations-2026-10.md`, checked 2026-10-22), so a direct Garmin write is not
  obtainable; ADR 0006 keeps the experimental provider read-only.
- **Rule:** ADR 0005 and rule G1 keep session choice in rule code; the publish channel moves a
  finished prescription and chooses nothing.
- **Rule:** ADR 0006 already requires one module per source, injected `fetch` and encrypted secrets;
  a fourth channel keeps those properties instead of adding a second integration pattern.
- **Opinion:** writing to a calendar the runner already uses is visible and reversible (withdraw),
  which an unofficial Garmin write is not.
- **Opinion:** two fallbacks that need no third party (a FIT file and a calendar feed) keep a dormant
  intervals.icu account or a Garmin sync fault from blocking a run.
- **Opinion:** recording the publish channel as its own ADR keeps ADR 0006 an accurate record of
  what was decided when it was accepted, and gives the first outbound write its own consent and
  failure model.
- **Preference:** the owner chose intervals.icu as the primary route.

Alternatives:

- **Amend ADR 0006 in place.** Against (**Opinion**): an accepted decision would change meaning
  after the fact, and a reader of 0006 would find an outbound write in a decision about reading
  data.
- **Write workouts through the experimental Garmin provider.** Against (**Rule**): owner decision 4
  and ADR 0006 keep it read-only. Against (**Opinion**): a blocked or changed private API would fail
  silently on the device the runner relies on.
- **FIT files and the calendar feed only.** Against (**Opinion**): a manual step every week is
  exactly the re-typing the epic removes; the fallbacks remain for when intervals.icu fails.
- **Publishing on by default once intervals.icu is connected.** Against (**Opinion**): it writes into
  the runner's calendar, which needs an explicit choice; the owner may overturn this.
- **The calendar feed as a provider with an `Integration` row.** Against (**Fact**):
  `GET /api/integrations` lists every registry entry and the Integrations page renders a generic card
  with Disconnect and a sync history for each, which does not fit a feed with no account.

## Consequences

- `ProviderInfo.channels` accepts `publish`; intervals.icu declares `pull` and `publish`.
- Two tables, `DeliveryChannel` (settings, the feed token hash, the scheduler's state) and
  `WristPublication` (what the remote should hold, per session identity), both classified as
  non-state so a publish run never triggers the next.
- Delivery to the watch depends on intervals.icu's Garmin upload, which the app cannot observe; a
  wrong tick by the runner gives a false "On your watch", and the copy states the dependency.
- intervals.icu closes accounts that are not logged in to for a long time; the card says so.
- Pace targets need a running threshold pace in intervals.icu; without it the steps carry the paces
  in text only and the session says so.
- The feed token sits in a URL path, so reverse-proxy logs outside the app may record it; the app
  redacts it from its own log, sends no referrer and lets the runner rotate or revoke it.
- Parts of the intervals.icu text syntax and three FIT details cannot be confirmed offline; one live
  run against the owner's account and one load of each file kind on the owner's watch are manual
  acceptance steps, recorded without account data.
