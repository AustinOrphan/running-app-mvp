# 0025. Strava stays on per-runner apps

Status: Proposed 2026-11-18

Supersedes the shared-registration decision of 2026-11-14 (`docs/STATUS.md`, answered items), which
the same file reopened on 2026-11-18. Builds on ADR 0006 (a pull provider takes its credentials from
the runner's own `Integration` row). The number 0021 is taken by the proposed Apple Watch companion
ADR (see ADR 0022); 0025 is the number the Strava design planned. The design that compared a shared
application with the per-runner card is `sv1-strava-shared.md` (job tmp, 2026-11-18); its section 2
is the source of the Strava facts below, and every Strava page was fetched on 2026-11-18.

## Context

Each runner registers their own Strava API application and enters its client id and secret on the
Strava card (spec 2.6.3). intervals.icu does not pass on runs it received from Strava
(`server/providers/intervals.ts` skips them), so a runner who records to Strava needs this card.

On 2026-11-14 the owner decided on one install-wide registration. On 2026-11-18 the design for it
read Strava's API Agreement and API Policy (both effective 2026-06-01) and found that the install
owner, as the developer of record, would hold the data duties for every runner. The owner then
decided, on 2026-11-18, to stay on per-runner applications and to build the deletion work that the
Policy asks for.

## Decision

- **No install-wide application.** Strava stays on the per-runner card: client id, client secret and
  an optional public address, entered by the runner and stored in that runner's `Integration` row.
  Nothing for a shared application is built (no `strava-app` row, no owner-only routes, no shared
  rate budget).
- **Disconnect revokes and deletes.** `DELETE /api/integrations/strava` posts the runner's refresh
  token to `https://www.strava.com/oauth/revoke` (HTTP Basic with the runner's client id and secret,
  through `ctx.fetch`, best effort), deletes the runner's Strava-sourced activities and removes the
  row. A confirmation dialog shows the count first and links to the full-data export.
- **A refused token deletes at once.** When Strava refuses the runner's refresh token or answers
  401, the sync (or the daily check) deletes the runner's Strava-sourced runs the way Disconnect
  does, through the same `removeStravaActivities` and `deleteActivities`, sets the row to
  `needs_auth`, notes `config.refusedAt` and clears the cursor. A network error or a 5xx deletes
  nothing. Connecting again clears the note and the next run reads the last year. Today's note for
  a source that needs signing in (J10) and the card say that Strava refused the connection and the
  runs were removed. A refusal inside a sync holds the runner's Strava lock, so a disconnect gets a
  409 instead of interleaving.
- **A daily check reconciles.** For each connected runner the daily job lists the runner's Strava
  activities once, from the oldest stored Strava run, and deletes the local Strava-sourced runs that
  Strava no longer lists. Only a complete listing deletes. A paused or failed listing, or an empty
  one while runs are stored, deletes nothing and records a `partial` job run.
- **A run held by another source keeps that copy.** A deleted Strava row first releases the rows
  flagged as its duplicates; a confirmed copy from another source takes over the plan session and
  the fuel and strength logs of the deleted row (`deleteActivities`, `activityStore.ts`).
- **The backup bound is 30 days.** `KEEP_WEEKS` is 3 and `OFF_HOST_SNAPSHOT_DAYS` is 29, so
  `deletedAccountRetention().longestDays` is 30 (it was 35). The data notice, the README and the
  homelab off-host requirement text follow. Pre-update and pre-restore copies keep the rule of the
  notice (30 days, the newest 3 of each kind stay).

## Reasons

Why the shared application was not built:

- **Fact (API Policy 6.2, https://www.strava.com/legal/api_policy, read 2026-11-18).** "You may not
  retain Strava Data in your cache for longer than seven (7) days. ... Except for such limited
  caching, you may not store Strava Data." A training log that keeps a year of Strava activities
  conflicts with a literal reading. With per-runner applications each runner is the developer of
  their own app and the data is their own; with a shared one the install owner would be the
  developer holding every runner's data past seven days.
- **Fact (API Agreement and Policy, https://www.strava.com/legal/api and the Policy above).** The
  developer of record owes consent disclosures (2.1), display of data only to that athlete (2.3),
  links and support (2.4), deletion on request with written confirmation (2.5), deletions on
  Strava reflected within 48 hours (6.3), deletion within 30 days of a request or a revocation
  (7.4), a privacy policy (7.3) and breach notice within 24 hours (8.3). A shared application would
  put these on the install owner for every runner; per-runner applications put each on the runner
  whose app it is.
- **Fact (API Agreement 2.2, same source).** Strava "reserves the right to revoke your API Token".
  One revocation of a shared application would cut every runner at once, and the bulk-export file
  import would be the only fallback.
- **Fact (https://developers.strava.com/docs/rate-limits/).** Limits are per application, so a
  shared application would share one budget between runners.
- **Fact (API Policy 5.3 and 5.7).** 5.3 forbids AI use of Strava Data, derived, aggregated and
  anonymized data included (as read in the design, not quoted). 5.7 forbids storing "geographic location information" outside the 6.2
  cache. Both apply to whichever application fetched the data, so they are not a reason for or
  against sharing; they are listed under what stays open.
- **Fact (https://developers.strava.com/docs/getting-started/).** "A Strava subscription is a
  prerequisite for creating an app". With per-runner applications every runner needs a
  subscription; with a shared one only the registering account does. This counts for sharing and is
  accepted.
- **Preference (owner, 2026-11-18).** Per-runner apps, and the deletion work built in full.

Why the deletion work is built this way:

- **Fact (API Policy 7.4 and 2.5, read 2026-11-18).** Deletion within 30 days on request, on
  revocation, on account deletion or when the developer stops using the API. Disconnect deletes the
  live rows at once, and so does a refused token (below); the 30-day backup bound (above) is the
  longest the copies then hold them, so both are clear of every copy within 30 days. Met, except
  the newest 3 safety copies of each kind (pre-update, pre-restore) kept for rollback, which the
  operator deletes on request, as the Data notice says. The safety copies are pruned at 29 days
  because the daily job adds up to a day.
- **Fact (https://developers.strava.com/docs/authentication/, read 2026-11-18).** `POST
/oauth/revoke` "is the recommended method for deauthorization" and will be the only one from
  2027-06-01. An athlete who disconnects here but stays authorised at Strava keeps the app
  authorised, so disconnect revokes.
- **Fact (https://developers.strava.com/docs/webhooks/, read 2026-11-18).** A webhook needs an
  address Strava's servers can reach, answers within two seconds and allows one subscription per
  application. The install sits on a LAN or tailnet, so revocation is found by polling (the refused
  token at the next hourly sync) instead of by a webhook.
- **Fact (API Policy 6.3).** Deletions on Strava are to be reflected within 48 hours. The daily
  reconcile does it with one listing per runner per day, at about 2 to 3 reads.
- **Rule.** Activities are written only by `server/services/activityStore.ts`, so the deletion path
  is there too, and plan links and the data version stay right (CLAUDE.md, Providers).
- **Opinion.** Deleting only after a complete listing is safer than an incremental diff: a short
  page or a paused run must never read as "Strava no longer has these".
- **Preference (owner, 2026-11-18).** No grace period after a refused token: the runs go at once,
  as in a disconnect. The Policy gives 30 days, so a delay would have been a taste, not a rule.

## Alternatives

- **One install-wide application (decided 2026-11-14, built nowhere).** Rejected for the facts above
  (the 7-day cache, the developer-of-record duties for every runner, one revocation cutting every
  runner). Its one gain, a subscription for one account only, is accepted as a cost of the card.
- **Webhooks for deauthorization.** Rejected (Fact above): no address Strava can reach.
- **Keep the activities on disconnect.** Rejected: Policy 7.4 asks for deletion on revocation.
- **A 25-day grace period after a refused token.** Built first, then dropped (owner decision
  2026-11-18, no grace period): a refusal is a revocation, Policy 7.4 asks for deletion within 30
  days of it, and with the clock a revoked runner's data could sit in the backups 55 days after the
  refusal. Deleting at once makes the 30-day backup bound meet 7.4.

## Consequences

- **Still open: the 7-day cache (Policy 6.2).** Each runner is the developer of their own app, so
  the log is theirs; how Strava reads 6.2 for a self-hosted log shown only to its athlete is not
  known (listed as not verified in the design).
- **Still open: the stored start point (Policy 5.7).** The provider stores `start_latlng` rounded to
  0.01 degrees (`server/providers/strava.ts`, `toParsed`), and weather and the rehearsal count read
  it. The owner has not decided whether to stop storing it; nothing changes here.
- **Still open: no AI use (Policy 5.3).** Any session or script that reads a live database must skip
  rows with `source = 'strava'`. This is an operator rule, not code.
- **Still open: derived data stays after a deletion.** `WeeklyBrief` rows and `PredictionLog` inputs
  that were built from Strava runs are not deleted: they are the runner's coaching history. Reason
  (Opinion): they are plan-level aggregates, and store no Strava field value (no distance, time,
  heart rate or position of a run). Whether Policy 6.2 or 7.4 reaches them is not verified.
- **Still open: the homelab off-host job.** It keeps 30 snapshots until it is changed to 29; the
  homelab repository is outside this one, so the requirement is stated in the README and STATUS only.
- **Open: breach notice, privacy policy, consent text (Policy 2.1, 7.3, 8.3).** The per-runner
  applications put these on each runner as the developer of their app; the install's data notice
  (README) is the operator's part.
- `config.refusedAt` on the Strava `Integration` row is the only stored state, so there is no
  migration. The job runs `strava-removal` and `strava-reconcile` are written to the sync log.
- Today's J10 note and the card for a refused Strava row say that Strava refused the connection,
  that the Strava runs were removed and that connecting again brings back up to a year; they are
  new templates under the G5 lint.
- A refusal is acted on at once, so a Strava outage must not look like one: only a refused refresh
  token or a 401 counts, and a network error or a 5xx deletes nothing (tested). A runner who
  revokes by mistake loses the imported copy until they connect again; the cursor is cleared so the
  next run reads the last year, and what Strava still holds comes back.
- Strava's new API base URL from 2027-01-04 (FAQ, not yet published) needs a follow-up in
  `server/providers/strava.ts`.
