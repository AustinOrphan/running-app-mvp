# 0020. My paces are derived on read from the zones, the heart-rate line and the predictions

Status: Proposed 2026-11-07

Builds on ADR 0005, 0009, 0010 and 0012. Adds rule C9 to `research/engine-rules.md` and the Param
`c9.exampleGradePct`; `PARAMS_VERSION` is `2026-11-07.6`.

## Context

The owner asked on 2026-11-07 for help finding an easy pace, or an achievable pace for a set
distance, from heart-rate data. The engine holds every piece: the zones (`buildZones`), the runner's
heart-rate-at-speed line (`fitHrModel`, rule A8), critical speed (`criticalSpeed`, rule A6), the
predictions (`predictFromState`, rules L1 to L6) and the cost of a grade (`gradeAdjustedSpeed`, rule
I11). No screen answered either question: the Profile lists zones, and a prediction exists only for a
goal.

## Decision

My paces is one pure function of the athlete snapshot, evaluated on every read and stored nowhere, as
the race plan (ADR 0018) and the strength workout (ADR 0014) are.

- `myPaces` and `eventRow` in `shared/engine/myPaces.ts`; text in `shared/copy/myPaces.ts` under the
  G5 lint; the route is `GET /api/paces` (`server/routes/paces.ts`), the service
  `server/services/myPaces.ts`, the hook `useMyPaces` (`web/api/paces.ts`), the page `/paces`.
- Easy pace, in order: the speed at which the runner's own line meets the top of zone 1, as a range to
  the slow edge of zone 1 (`c2.z1PaceSlowFactor`); else the zone 1 pace range of the zones, named by
  the anchor it came from (a tested threshold pace or critical speed); else none, with what would give
  one. The line is used only where it speaks: a minimum slope, the solved speed inside the fitted
  speeds widened by a margin, not slower than a walk and under critical speed (or, with none, under
  a ceiling on easy speed), all Params of rule C9 (grade D). The hot-day speed is held to the same slow bound (the fitted speeds widened by the margin,
  never a walk); beyond it there is no hot figure and the page says to go by effort. When the line
  does not speak, the view says why in one of four plain lines (flat, outside the runs, too fast, too
  slow).
- A hot day moves the line by its heat term at `i9.warnWbgtC`. The term is the runner's own with
  `hrModel.shrinkagePriorRuns` or more hot runs and the population default otherwise, and the page
  labels the figure so; a climb moves the pace by
  the cost ratio of `c9.exampleGradePct` (5%). A basis with no line shows the climb and no heat figure.
- The zones are not read again: the page shows `GET /api/zones` through `ZoneSummary`, the component
  the Profile uses.
- Events are the five standard distances (`shared/domain/paceEvents.ts`) and one course the runner
  names, with its climb. Each is `predictFromState` with no goal and no race-day weather. The grade of
  an event is the lowest grade among the Params it reads: the methods', the fit they stand on (A6),
  the widening for one source (`l3.singleSourceWideningPct`) or for climb (L5) and the floor of its
  interval. Almost every row is therefore grade D, because a default sets the figure.
- Thin data offers the critical-speed test of rule A6, worded from the Params of the fit.
- The memo `paces.view` is keyed by data version and day. A custom course is one more `eventRow` over
  the same snapshot and is outside the memo. The response carries a tag of the data version, the day
  and the course, and a current tag is answered 304.
- The route is not one of the five reads the service worker keeps (ADR 0012); offline the page says
  it needs a connection.

## Reasons

- **Fact:** `fitHrModel` needs `hrModel.minQualifyingRuns` (8) steady flat runs of the last
  `hrModel.windowWeeks` (8) weeks and returns null otherwise (`execution.ts`, read 2026-11-07), so the
  fallback to the zones is the normal case for a new runner.
- **Fact:** `buildZones` drops the pace anchors after a break of `c8.breakDays` days, so a runner
  after a break has no zone pace and no easy pace until fresh runs arrive (rule C8).
- **Fact:** the Z1 pace range of the zones is `[lt1Pace x c2.z1PaceSlowFactor, lt1Pace]`, so a range
  from the line with the same slow factor reads the same way as the table beside it.
- **Rule:** ADR 0005 and 0010: rules decide, templates write, no model touches the text. Rule G5: a
  prediction is a range and a sketch; the page promises nothing and sets no target.
- **Rule:** ADR 0009: athlete data comes through the snapshot and `memoByVersion` (`hrModelOf`).
- **Opinion:** reusing `ZoneSummary` and `GET /api/zones` is better than a second zone reader in the
  paces payload, because the Profile and My paces cannot then state different zones.
- **Opinion:** the example climb is a Param, and not a number in the page, because every number the
  engine shows is in the registry with a grade; the cost of any other grade follows the same curve.
- **Preference:** pace ranges follow the app's convention of the slow end first in the easy pace and
  the zone table, and the fast end first beside a time, so the two lines of an event run the same way.

## Alternatives

- Fitting a new pace model for the page. Rejected: no new model without a rule (G1, G3), and the
  corpus holds none better than the line and critical speed.
- Storing the figures. Rejected: the snapshot changes without a re-plan, as the prediction does
  (ADR 0014, ADR 0018).
- Predictions only through a goal. Rejected: the question was about distances the runner has no goal
  for.

## Addendum 2026-11-07: the climb row and the grade table read the personal curve (rule I13)

- `myPaces` computes `gradeCurve` (`shared/engine/gradeCurve.ts`) from the snapshot's activities
  (`context.activities` already carries `Activity.terrainBins`, so no new reader and no new query of
  the history window; runs only, flagged duplicates out) and returns it as `MyPaces.terrain`, inside
  the memo `paces.view`. The curve is therefore keyed by the data version and the day like the rest.
- The example climb uses the runner's own ratio for the band that holds `c9.exampleGradePct` when
  the curve shows one there, and the cost of the grade (I11) otherwise, with the reason
  (`EasyPace.climb.source`, `reason`). A section "Climbs and descents" lists every band with its
  share of flat speed, its source and its minutes, and the grade where walking passes half the time.
- Display only: `personalGainEquivalent` stays uncalled and no prediction row reads the curve
  (`myPaces.test.ts` checks the events are equal with and without bins).
- The page's failed load now uses the shared `ErrorState` and `useLoadView`.
