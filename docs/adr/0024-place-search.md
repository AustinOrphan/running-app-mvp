# 0024. Place search: a town or postcode to a stored place, and the usual start

Status: Proposed 2026-11-16

Builds on ADR 0009 (the usual start is not engine data). Open-Meteo stays outside the provider
registry, as it does for the weather cache. Implements the owner decision of
2026-11-16. This ADR and the server routes come first (PL1); the web UI is a second PR.

## Context

The home place (`AthleteProfile.homeLat`, `homeLng`) and the race place (`Goal.raceLat`,
`raceLng`) are entered as coordinates, or with "Use my location", which needs a secure context and
is blocked over plain http. A runner has to look the numbers up elsewhere. Weather and climate need
only about 1 km, so both are stored rounded to 0.01 degrees.

## Decision

Owner decision of 2026-11-16: a runner sets the home place (Profile) and the race place (Goals) by
searching a town or postcode, and the home place also by "use where my runs start". Coordinates by
hand and "Use my location" stay. Not built: full street-address search and a map picker (a map
picker may come later).

- **Search.** `POST /api/places/search` takes `{ query }` (trimmed, 2 to 80 characters) and answers
  at most 8 `{ name, region, country, lat, lng }` places, coordinates rounded to 0.01 degrees, with
  entries that round to the same cell and have the same name merged. No match is
  `{ places: [] }`. A geocoder error or no answer within 5 seconds is a 502 with the code
  `places.unavailable` and a sentence from `shared/copy/places.ts`.
- **Geocoder.** Open-Meteo's geocoding API, called by `searchPlaces` in
  `server/providers/openMeteo.ts` through `Deps.fetch` with a 5 s `AbortSignal`. This is the one
  request path that waits on Open-Meteo's geocoder, apart from the forecast route's first fill.
- **What leaves the server.** Only the typed text, in the query string of one GET to Open-Meteo.
  No account, no coordinates and no stored place go with it. The typed text is not logged, stored or
  put in an error: the route is a POST so it is in no URL of the app's own request log, and the
  service drops the cause of a failure, since a fetch error can carry the URL.
- **Usual start.** `GET /api/places/usual-start` answers `{ start: { lat, lng, runs, of } | null }`.
  The value is the most common 0.01-degree cell among the first recorded positions of the runner's
  own runs and races with a stored track, over the last 365 days of the runner's local day. A tie
  goes to the cell with the most recent run (then, so input order never matters, to the lower
  latitude, then longitude). `runs` is the runs that started in the cell, `of` the runs with a
  track that were counted, and the value is `null` when none has a track. It makes no outside
  request, reads `ActivityTrack` as the map-area code does, and returns only the cell and counts: the
  stored polyline is served by `GET /api/activities/:id/track` alone. The pure rule is
  `usualStart` in `shared/domain/usualStart.ts`.
- **Limits.** Both routes sit behind `requireAuth` and the 1 MB parser, under the per-user limiter
  (1000 per 15 minutes). No narrower limiter: a search is one runner typing in a settings field, and
  the web PR debounces it.

## Reasons

- **Fact.** Open-Meteo already receives the home place's coordinates for the weather cache, so the
  search adds one request to a host the app already talks to and no new third party. Known from
  `server/providers/openMeteo.ts` and `server/services/weatherCache.ts`.
- **Fact (checked 2026-11-17 by sample requests).** Open-Meteo's geocoder takes place names without
  a key and matches postcodes only in part: `90210` returned Beverly Hills, California, United
  States; `60601` Chicago, Illinois, United States; `SW1A` Westminster Abbey, England, United
  Kingdom; `75001` Paris, Île-de-France, France first and then a US town; `10115` (a Berlin
  postcode) only New York, United States. A town name returned several same-named towns with their
  regions. The PL1 tests plan the answer, so no test calls the live service.
- **Fact.** The stored places are kept at 0.01 degrees, about 1 km, which is all weather and climate
  read, so a street address would add no precision the product uses. Known from
  `server/routes/profile.ts` (`round2`, the home place), `server/routes/goals.ts` (the race place)
  and the README section "Weather and privacy".
- **Opinion.** A home address typed into a search box is a more sensitive thing to send to a third
  party than a town name. Sending only a town or postcode keeps the outbound request to what the
  feature needs, so street-address search is left out.
- **Rule.** Network access goes only through `Deps.fetch`, never a global `fetch` (CLAUDE.md,
  Providers).
- **Fact.** A run counted twice would skew the cell count, so the usual start leaves out activities
  a duplicate pass marked `possible` or `confirmed`, as `server/serialize.ts` and
  `server/services/trendsDurability.ts` do.
- **Rule.** The stored polyline is never served except by the track route (CLAUDE.md, Providers,
  "Run tracks (M1a)"), so the usual start returns a rounded cell.
- **Opinion.** A POST for the search is worth its small departure from REST: a place a runner types
  is health-adjacent location data and should not sit in a URL or an access log.
- **Opinion.** The first recorded position of a run is a better guess of "home" than a centre of the
  track, since most runs start at the door; the cell count absorbs the runs that do not.
- **Preference.** A 5 s wait mirrors the forecast route's, so a screen never waits longer than it
  already does on Open-Meteo.

## Alternatives

- **Street-address search through a different geocoder.** Rejected (Opinion above, and the owner's
  decision): it sends a home address to a third party for a precision weather does not use.
- **A map picker.** Not now (owner decision of 2026-11-16): it needs tiles and a drawn control; it
  may come later and would write the same two stored places.
- **Search in a GET query string.** Rejected: the typed place would be in the URL (Opinion above).
- **A narrower rate limiter on the search.** Not added (Preference): the per-user limiter bounds the
  cost, and a limiter can be added keyed on `req.userId` if abuse appears.
- **The usual start from the centre of each track.** Rejected (Opinion above).

## Consequences

- Postcode matching is partial (Fact above), so each result carries its region and country for the
  runner to tell a wrong match, and a postcode that finds nothing or the wrong place falls back to
  the town name or to coordinates, which stay.
- `ApiErrorCode` gains `places.unavailable`.
- `shared/copy/places.ts` holds the one sentence, under the G5 lint.
- A new web PR adds the two controls; nothing here changes a stored place, a plan or a prediction.
- No Prisma model, migration, environment variable or Param.
