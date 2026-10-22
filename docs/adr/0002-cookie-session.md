# 0002. Cookie session instead of bearer tokens

Status: Proposed 2026-10-21

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
