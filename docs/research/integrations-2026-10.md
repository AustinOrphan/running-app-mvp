# Integration feasibility, October 2026

Desk research of 2026-10-22 (vendor docs, GitHub repositories and issues, forums). "Unknown"
means it could not be verified; "secondary" means a third-party source rather than vendor
documentation. Re-check before relying on any of it: these APIs change without notice.

## Matrix

| Source                              | Individual access                                                   | Auth                       | Activities / files                                                                              | Wellness                                      | Verdict                                        |
| ----------------------------------- | ------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| intervals.icu                       | Yes, personal API key                                               | Basic `API_KEY:<key>`      | List, detail, original file (`GET /api/v1/activity/{id}/file`, not for Strava-sourced), streams | Wellness list (`/athlete/{id}/wellness.json`) | **Ship** (pull)                                |
| Strava                              | Yes, own API application                                            | OAuth2                     | List, streams (no original file via API)                                                        | No                                            | **Ship** (pull)                                |
| Garmin, official                    | Personal tier listed, but new applications paused since spring 2026 | OAuth2 PKCE                | FIT                                                                                             | Yes                                           | Not obtainable today                           |
| Garmin, unofficial                  | Own credentials                                                     | Mobile SSO, then DI OAuth2 | List, original FIT (ZIP)                                                                        | Sleep, HRV, resting HR                        | **Ship, experimental**                         |
| Apple Health via Health Auto Export | Yes (app's Premium tier)                                            | Bearer token we issue      | Workouts with HR series and route (JSON)                                                        | Resting HR, HRV (SDNN), sleep, weight         | **Ship** (push)                                |
| Apple Health export.zip             | Yes                                                                 | none                       | Workouts, routes (GPX)                                                                          | Records                                       | **Ship** (upload, history backfill)            |
| HealthFit (iOS)                     | Yes ($6.99)                                                         | n/a                        | FIT/GPX export; auto-sync to intervals.icu, Strava and others                                   | Via intervals.icu                             | Covered by files and intervals.icu             |
| Polar AccessLink                    | Yes, any Flow user                                                  | OAuth2                     | FIT/TCX/GPX, last 30 days                                                                       | Sleep, Nightly Recharge                       | Later, if a Polar is in use                    |
| WHOOP                               | Yes                                                                 | OAuth2 (rotating refresh)  | Workouts (no files)                                                                             | Recovery (rMSSD, resting HR)                  | Later, wellness only                           |
| Oura v2                             | OAuth2 app (personal tokens deprecated Dec 2025)                    | OAuth2                     | Workouts (no files)                                                                             | Readiness, sleep                              | Later, wellness only                           |
| Google Health API (Fitbit, Pixel)   | Google OAuth; personal-app verification unknown                     | OAuth2                     | Exercise sessions                                                                               | Yes                                           | Later; legacy Fitbit API off 2026-10-30        |
| COROS, Suunto, TrainingPeaks, Wahoo | Partner or approval only                                            | OAuth2                     | FIT (partners)                                                                                  | -                                             | Not feasible for personal use; use file export |
| Smashrun, Runalyze                  | Yes                                                                 | OAuth2 / token             | Limited reads                                                                                   | -                                             | Not worth it (Smashrun CSV import exists)      |
| Health Connect, Samsung Health      | No server API                                                       | -                          | Needs an Android relay app                                                                      | -                                             | Not feasible without a mobile app              |

## Garmin, unofficial (experimental provider)

- `garth` (Python) is deprecated (final release 2026-03-28) after Garmin changed its login.
  `python-garminconnect` 0.3.x ships a native login using TLS impersonation (`curl_cffi`) to
  pass Cloudflare; 0.3.19 released 2026-10-16. The npm `garmin-connect` package was last
  published 2024-01-17 and predates the change.
- Login: `POST https://sso.garmin.com/mobile/api/login?clientId=GCM_IOS_DARK&locale=en-US&service=https://mobile.integration.garmin.com/gcm/ios`
  with a JSON body of username, password, `rememberMe`, `captchaToken`; `responseStatus.type`
  is `SUCCESSFUL` (service ticket), `MFA_REQUIRED`, `INVALID_USERNAME_PASSWORD` or
  `CAPTCHA_REQUIRED`; HTTP 429 means rate limited, 403 a Cloudflare challenge.
- MFA: `POST https://sso.garmin.com/mobile/api/mfa/verifyCode` with the same session cookies.
- Token: `POST https://diauth.garmin.com/di-oauth2-service/oauth/token` (Basic client id,
  service-ticket grant); access token about 24 h, refresh token about 30 days, rotating.
- API base `https://connectapi.garmin.com` with a Bearer token and Garmin mobile user-agent
  headers. Activities: `/activitylist-service/activities/search/activities`; original file:
  `/download-service/files/activity/{id}` (ZIP containing the FIT); sleep:
  `/sleep-service/sleep/dailySleepData`; HRV: `/hrv-service/hrv/{date}`; daily summaries:
  `/usersummary-service/...`.
- Risks: undocumented and against the spirit of Garmin's terms; logins blocked by TLS
  fingerprint or 429 (reports of 48-hour account blocks); datacenter IPs get 401. Mitigations
  built in: password used once and never stored; refresh-token-only operation; one request
  per second at most; stop on 429 or 403; a token-import path for tokens bootstrapped with
  `python-garminconnect` on a trusted machine.

## Apple Health

- Health Auto Export REST automation posts `{"data":{"metrics":[...],"workouts":[...]}}`
  with custom headers (we use `Authorization: Bearer`); dates `yyyy-MM-dd HH:mm:ss Z`.
  Workouts carry `id` (HealthKit UUID, the dedupe key), `name`, `start`, `end`, `duration`,
  `distance` and `elevationUp/Down` as `{qty, units}`, `heartRateData`
  `[{date, Min, Avg, Max}]`, optional `route` points and `temperature`/`humidity`. Known
  quirk: `heartRateData` can hold the post-workout recovery series, so samples are clipped
  to the workout window. Metric names are not fully documented; match them loosely and
  report unknown ones.
- Apple's HRV is SDNN, not rMSSD; the two are stored separately.
- export.zip: `apple_health_export/export.xml` (`Record`, `Workout`, `ActivitySummary`;
  dates `YYYY-MM-DD HH:MM:SS ±HHMM`) and `workout-routes/*.gpx`. Files run to hundreds of
  MB, so parsing is streaming, in the browser, in two passes (workouts and daily metrics,
  then heart rate within workout windows).

## Sources

- https://intervals.icu/api/v1/docs (OpenAPI, checked 2026-10-22)
- https://developer.garmin.com/gc-developer-program/overview/
- https://github.com/cyberjunky/python-garminconnect
- https://github.com/matin/garth/issues/217
- https://github.com/philosowaffle/peloton-to-garmin/issues/837
- https://help.healthyapps.dev/en/health-auto-export/export-format/workouts/
- https://help.healthyapps.dev/en/health-auto-export/automations/rest-api/
- https://github.com/Lybron/health-auto-export/issues/60
- https://www.polar.com/accesslink-api/
- https://developer.whoop.com/api
- https://developers.google.com/health/migration
- https://apizone.suunto.com/
