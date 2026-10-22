# 0003. Metres, seconds and date strings

Status: Proposed 2026-10-21

## Context

Activities and plans mix distances, durations and calendar days. The old code stored dates as
UTC-midnight `DateTime` values, which shifted a run to the wrong day for anyone west of UTC.

## Decision

- Distance is stored in metres (integer), duration in seconds (integer) and plan targets in
  minutes (integer). Display units (miles by default, kilometres supported) are a user setting.
- A date is a `YYYY-MM-DD` string in the runner's local day, with an optional `HH:MM` start
  time. Date arithmetic runs on UTC timestamps built from those strings.
- Weeks start on Monday and are keyed by the Monday's date string.
- Derived numbers (weekly totals, completion, streaks) are never stored.

Reasons:

- **Fact:** The 2026-10-21 audit found a day-shift bug caused by storing dates as UTC-midnight
  `DateTime` values.
- **Rule:** Design spec section 4.3 fixes these units and the Monday week.
- **Fact:** Integer storage avoids floating-point drift in sums; conversions happen only at the
  display edge.
- **Opinion:** A string date has no timezone to get wrong, so a log entry means the same day on
  every machine.

Alternatives:

- **`DateTime` columns.** Against (**Fact**): the source of the day-shift bug above.
- **Store miles.** Against (**Opinion**): switching the display unit would require converting
  stored data.

## Consequences

- Code that needs "today" calls `todayIso`, the only function that reads local time.
- A server running in a different timezone from the runner computes the wrong current week;
  the Docker setup passes `TZ` through for that reason.
- Sorting by date is a plain string sort.
