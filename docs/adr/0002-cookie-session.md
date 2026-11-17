# 0002. Cookie session instead of bearer tokens

Status: Accepted 2026-10-22 (#528)

## Context

The application has one account and the browser app is served from the same origin as the API.
The old code kept tokens in `localStorage`, held a logout blacklist in memory and contained a
production login bypass.

## Decision

Login sets an httpOnly, SameSite=Lax cookie holding a signed JWT valid for 30 days. Mutating
requests must carry a matching `Origin` or `Sec-Fetch-Site: same-origin`. There are no refresh
tokens, no tokens in `localStorage` and no server-side blacklist.

Reasons:

- **Fact:** The 2026-10-21 audit found tokens in `localStorage`, an in-memory logout blacklist
  and a production login bypass.
- **Opinion:** A same-origin single-page app needs no refresh flow; one cookie is the simplest
  mechanism that script injection cannot read.
- **Rule:** Design spec section 4.2 sets the cookie lifetime and the same-origin check.

Alternatives:

- **Bearer token in a header.** Against (**Opinion**): the browser has to store the token where
  scripts can read it, and a refresh flow follows.
- **Server-side session table.** Against (**Preference**): extra state and a cleanup job for a
  single account.

Against this decision:

- **Fact:** A JWT cannot be revoked before it expires. Mitigation: rotating `SESSION_SECRET`
  invalidates every session at once.

## Consequences

- Logout clears the cookie but does not invalidate a copy of the token that was already taken.
- Rotating `SESSION_SECRET` signs the account out everywhere; the README documents this.
- API clients other than the bundled web app need to send the cookie and a same-origin header.

## Addendum 2026-11-17: the session slides, up to a cap (SS1)

Status: Accepted 2026-11-17 (owner decision).

`requireAuth` renews the cookie: when the verified cookie was issued more than 24 hours ago, the
response carries a fresh one with the same `sessionVersion`, the same flags (httpOnly, SameSite=Lax,
Secure as configured) and a new 30-day life. The cookie carries a `sat` claim (the sign-in time in
seconds), set at sign-in and copied on every renewal. A cookie ends at the earlier of 30 days from its
issue and `sat` plus 120 days (`SESSION_ABSOLUTE_MAX_AGE_SEC`, beside `SESSION_MAX_AGE_SEC` in
`server/auth/session.ts`); a cookie that already ends at the cap is not renewed. A cookie issued
before this change has no `sat` and reads its `iat` as the sign-in time. The calendar feed and the
ingest routes sit above `requireAuth`, take no cookie and are unchanged. The earlier "there are no
refresh tokens" still holds: the renewal is a fresh cookie of the same kind, not a second token.

Reasons:

- **Fact:** A fixed 30-day cookie ended the session on day 30 for a runner who used the app daily.
  The next 401 runs `purgeDeviceData()` (ADR 0012), which empties the outbox (a queued Done), every
  draft, the race card's crew notes (kept only on the device) and the cached reads. Checked in
  `server/auth/session.ts` and `web/pwa/outbox.ts`, 2026-11-17.
- **Rule:** The owner decided on 2026-11-17 to renew the session while the runner uses the app, with
  a cap.
- **Rule:** `User.sessionVersion` (B1) still ends every session of an account: a renewal copies the
  version the cookie carries after `requireAuth` has matched it with the account's, so a changed
  version is refused before any renewal, and rotating `SESSION_SECRET` still ends every cookie.
- **Opinion:** Renewing at most once a day keeps the cost to one extra header per day, and a longer
  threshold would let a runner who opens the app every other week lose the session anyway.
- **Opinion:** 120 days bounds how long a copied cookie (the one risk in "Against this decision")
  can be kept alive by use, while a runner signs in again about three times a year. Four months is a
  round figure that spans a training block plus a race and its recovery; it is not derived from a
  measurement, and it is not an engine Param.
- **Fact:** The renewed `Set-Cookie` does no harm to the offline worker. The worker builds the
  response it stores in `rl-api-v1` anew in `web/sw/sw.js` (`save`), copying only `Content-Type` and
  its own saved-at header, so no `Set-Cookie` reaches the Cache API; the Cache API stores no cookies,
  and the browser applies the header of a network response to its cookie jar before the worker
  reads it. A copy served offline carries no cookie header, so it cannot replace a cookie.

Alternatives:

- **Keep the fixed 30 days.** Against (**Fact**): the day-30 purge above.
- **Renew with no cap.** Against (**Opinion**): a stolen cookie in regular use would never expire;
  only a password change or a secret rotation would end it.
- **A longer fixed life (for example 120 days) with no renewal.** Against (**Opinion**): the same
  exposure for a copied cookie, with no gain over the cap for a runner who is active.
- **A server-side session table with a rolling expiry.** Against (**Preference**): the extra state
  that this ADR declined for one account.

Against this decision:

- **Fact:** A copied cookie in use now lives up to 120 days, not 30. Mitigation: the cap, and
  `sessionVersion`, which a password change raises.
