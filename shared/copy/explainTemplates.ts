// The sentences of "From your numbers" (phase 3a design 8.4 and 8.6): one fact per figure a rule
// read, rendered from a template id and its slots by `renderFact`. They are spread into `TEMPLATES`,
// so the copy-lint test renders every one. The builders are in `shared/engine/explainInputs.ts`.
//
// Ids are `explain.<rule or topic>-<name>` and never change meaning once a record may hold them. A
// gap sentence says what the rule needs and what was found; the drawer puts "Not enough data yet:"
// in front of it. Plurals that vary are avoided by wording ("Days since then: 12"), not by logic.
import { tpl, type Template } from './template.ts'

export const EXPLAIN_TEMPLATES = {
  // A3 and g-1: the longest recent run
  'explain.longest-distance': tpl(
    'Your longest run in the last {days} days was {distance} on {date}.',
    { days: 'count', distance: 'distance', date: 'date' },
  ),
  'explain.longest-duration': tpl(
    'Your longest run by time in the last {days} days was {duration} on {date}.',
    { days: 'count', duration: 'duration', date: 'date' },
  ),
  'explain.longest-gap': tpl(
    'No completed run in the last {days} days, so there is no longest run to compare a new run with.',
    { days: 'count' },
  ),
  'explain.g1-session': tpl('This session is {share} of that distance.', { share: 'share' }),
  'explain.g1-warn': tpl('Runs longer than {limit} get a warning.', { limit: 'distance' }),
  'explain.g1-override': tpl('Runs longer than {limit} are not planned unless you ask.', {
    limit: 'distance',
  }),

  // g-2: the weekly ramp
  'explain.g2-last-week': tpl('Running time in the week of {week} was {minutes}.', {
    week: 'date',
    minutes: 'minutes',
  }),
  'explain.g2-ramp': tpl('The plan adds at most {pct} to a week of running.', { pct: 'percent' }),
  'explain.g2-plan-week': tpl('The plan sets the week of {week} at up to {minutes}.', {
    week: 'date',
    minutes: 'minutes',
  }),
  // A week set at no running (a rest window, the rest after a race) has no minutes to state.
  'explain.g2-plan-week-none': tpl('The plan sets no running for the week of {week}.', {
    week: 'date',
  }),
  'explain.g2-gap': tpl(
    'The ramp needs a week of running in the last {weeks} weeks; none found. The plan starts from a default week.',
    { weeks: 'count' },
  ),

  // g-6: lost volume is never made up
  'explain.g6-completion': tpl('In the week of {week} you ran {actual} of {planned} planned.', {
    week: 'date',
    actual: 'minutes',
    planned: 'minutes',
  }),
  'explain.g6-cap': tpl(
    'The week of {week} is capped at {minutes}: the lower of the plan and the week before plus {pct}.',
    { week: 'date', minutes: 'minutes', pct: 'percent' },
  ),
  'explain.g6-gap': tpl(
    'No planned minutes are on file for the week of {week}, so there is nothing to compare your running with.',
    { week: 'date' },
  ),

  // g-8: the history-informed rebuild [rules g-8, proposal 4.6]. The block and the gap name the
  // count of weeks from the Param ("Four steady weeks") in a text slot, and the held and capped
  // lines say what `load.held` and `load.capped` say on the Plan page.
  // The figure is the block's score: the mean of its weeks without the highest, which is not the
  // mean of all four (`HistoryBlock.blockMin`).
  'explain.g8-block': tpl(
    '{blocks} ending {ago} ago; without the highest, they averaged {minutes} a week.',
    {
      blocks: 'text',
      ago: 'text',
      minutes: 'minutes',
    },
  ),
  'explain.g8-taper': tpl(
    'The block ended {weeks} weeks ago, so it counts for {share} of its size.',
    {
      weeks: 'count',
      share: 'share',
    },
  ),
  'explain.g8-kept': tpl(
    'This plan began with that block, counted at {share} of its size, and keeps it until a week reaches {minutes}.',
    { share: 'share', minutes: 'minutes' },
  ),
  'explain.g8-zone': tpl(
    'While a week is under {minutes}, the plan adds up to {pct} a week; past that it adds up to {soft}.',
    { minutes: 'minutes', pct: 'percent', soft: 'percent' },
  ),
  'explain.g8-setting': tpl(
    'Load setting: {position}. It sets how fast the plan adds running time while rebuilding.',
    { position: 'text' },
  ),
  'explain.g8-held': tpl('The steady step applies for now: {reason}.', { reason: 'text' }),
  'explain.g8-capped': tpl('The setting is held at Standard: age {age} or over.', {
    age: 'count',
  }),
  'explain.g8-response': tpl(
    'The last {n} weeks averaged {mean} a week, above the {planned} planned, so the next week builds from {from}.',
    { n: 'count', mean: 'minutes', planned: 'minutes', from: 'minutes' },
  ),
  'explain.g8-none': tpl(
    'No {blocks} in the last {weeks} weeks, so the plan builds from recent weeks.',
    { blocks: 'text', weeks: 'count' },
  ),
  // The start and return weeks are exempt from the ceiling (rules E6, G-3, H12, J7), so the line
  // says "stays within" and names the exception.
  'explain.g8-limits': tpl(
    'Long runs keep the {days}-day rule, and weekly growth stays within {pct} over {span} apart from the start and return weeks.',
    { days: 'count', pct: 'percent', span: 'text' },
  ),

  // A2: chronic and acute load
  'explain.a2-load': tpl(
    'Load over the last {acuteDays} days is {acute} and over the last {chronicDays} days {chronic}, counted in {metric}.',
    {
      acuteDays: 'count',
      acute: 'count',
      chronicDays: 'count',
      chronic: 'count',
      metric: 'text',
    },
  ),
  'explain.a2-gap': tpl('No activity in the last {days} days, so there is no load to describe.', {
    days: 'count',
  }),

  // A5 and J7: the last run
  'explain.last-run': tpl('Your last run was on {date}. Days since then: {days}.', {
    date: 'date',
    days: 'count',
  }),

  // A5: experience class
  'explain.a5-class': tpl('The plan treats you as a {experience} runner.', { experience: 'text' }),
  'explain.a5-weeks': tpl('You ran in {n} of the last {weeks} weeks.', {
    n: 'count',
    weeks: 'count',
  }),
  'explain.a5-years': tpl('Your profile says you have been running since {year}.', {
    year: 'text',
  }),
  'explain.a5-gap': tpl(
    'No run found in the last {days} days and no start year in your profile, so you count as a novice until runs are logged.',
    { days: 'count' },
  ),

  // A6, C4 and C5: critical speed
  'explain.a6-cs': tpl(
    'Your critical speed is {speed}, a pace of {pace}, from {n} efforts in the last {days} days.',
    { speed: 'speed', pace: 'pace', n: 'count', days: 'count' },
  ),
  'explain.cs-gap': tpl(
    'Critical speed needs {need} efforts between {from} and {to} in the last {days} days; {found} found. Zones use heart rate and effort until then.',
    { need: 'count', from: 'distance', to: 'distance', days: 'count', found: 'count' },
  ),
  'explain.cs-spread-gap': tpl(
    'The {found} efforts found are too close in length to fit critical speed; they need to differ by a factor of {ratio}.',
    { found: 'count', ratio: 'count' },
  ),

  'explain.c-break-gap': tpl(
    'Pace anchors are cleared after a break of {days} days or more and return with fresh efforts. Zones use heart rate and effort until then.',
    { days: 'count' },
  ),

  // A7: durability
  'explain.a7-drift': tpl(
    'On {n} comparable long runs, pace and heart rate drifted apart by {pct} (median).',
    { n: 'count', pct: 'percent' },
  ),
  'explain.a7-gap': tpl(
    'Durability needs {need} comparable long runs in the cool, under {temp}; {found} found. The default is used until then.',
    { need: 'count', temp: 'temp', found: 'count' },
  ),

  // A8: efficiency
  'explain.a8-up': tpl(
    'On steady flat runs you cover {pct} more ground per heartbeat than in the weeks before.',
    { pct: 'percent' },
  ),
  'explain.a8-down': tpl(
    'On steady flat runs you cover {pct} less ground per heartbeat than in the weeks before.',
    { pct: 'percent' },
  ),
  'explain.a8-hr-model': tpl(
    'At {pace}, the top of easy pace, your heart rate tends to sit near {bpm}, from {n} steady runs.',
    { pace: 'pace', bpm: 'bpm', n: 'count' },
  ),
  'explain.a8-gap': tpl(
    'Efficiency needs {need} steady flat runs of {from} to {to} in each of two windows; {recent} found in the latest and {prior} in the one before.',
    { need: 'count', from: 'minutes', to: 'minutes', recent: 'count', prior: 'count' },
  ),

  // C1: zones and the session's target
  'explain.c1-target-ceiling': tpl(
    'This session keeps your heart rate under {bpm}, the top of your zone 1.',
    { bpm: 'bpm' },
  ),
  'explain.c1-target-band': tpl(
    'This session targets a heart rate of {low} to {high}, your zone {zone}.',
    { low: 'bpm', high: 'bpm', zone: 'count' },
  ),
  'explain.c1-target-pace': tpl('This session targets a pace of {slow} to {fast}.', {
    slow: 'pace',
    fast: 'pace',
  }),
  'explain.c1-target-effort': tpl('This session goes by effort, {low} to {high} out of 10.', {
    low: 'count',
    high: 'count',
  }),
  'explain.c1-target-rpe': tpl('The effort should feel like {low} to {high} out of 10.', {
    low: 'count',
    high: 'count',
  }),
  'explain.c1-pace-guide': tpl('Pace is a guide here: {slow} to {fast}.', {
    slow: 'pace',
    fast: 'pace',
  }),
  'explain.c1-zones-hr': tpl('Your zone 1 tops out at {z1}, zone 2 at {z2} and zone 3 at {z3}.', {
    z1: 'bpm',
    z2: 'bpm',
    z3: 'bpm',
  }),
  'explain.c1-gap': tpl(
    'Zones need a maximum heart rate or your age, and a threshold; none found. Targets go by effort until then.',
  ),

  // C2: anchors and their sources
  'explain.c2-anchor': tpl('Your {anchor} comes from {source}, as of {date}.', {
    anchor: 'text',
    source: 'text',
    date: 'date',
  }),
  'explain.c2-cs': tpl('Your critical speed is fitted from your recent efforts, as of {date}.', {
    date: 'date',
  }),
  'explain.c2-gap': tpl(
    'No anchor is on file yet. Add a maximum heart rate or your age to your profile, or log a few hard efforts.',
  ),

  // C3: maximum heart rate
  'explain.c3-measured': tpl(
    'Your maximum heart rate is {bpm}, a measured value from your profile.',
    {
      bpm: 'bpm',
    },
  ),
  'explain.c3-profile': tpl('Your maximum heart rate is {bpm}, as entered in your profile.', {
    bpm: 'bpm',
  }),
  'explain.c3-age': tpl(
    'Your maximum heart rate is estimated at {bpm} from your age, give or take {band}.',
    { bpm: 'bpm', band: 'bpm' },
  ),
  'explain.c3-gap': tpl(
    'No maximum heart rate or age is on file, so heart-rate zones cannot be set. Add either in your profile.',
  ),

  // C4: the line between zones 1 and 2
  'explain.c4-cs': tpl(
    'The line between zones 1 and 2 sits at {share} of your critical speed, a pace of {pace}.',
    { share: 'share', pace: 'pace' },
  ),
  'explain.c4-profile': tpl(
    'The line between zones 1 and 2 is a pace of {pace}, worked out from the threshold pace in your profile.',
    { pace: 'pace' },
  ),
  'explain.c4-hr': tpl('By heart rate, the line between zones 1 and 2 sits at {bpm}.', {
    bpm: 'bpm',
  }),

  // C5: threshold pace
  'explain.c5-cs': tpl('Threshold pace is {pace}, {margin} slower than your critical speed.', {
    pace: 'pace',
    margin: 'speed',
  }),
  'explain.c5-profile': tpl('Threshold pace is {pace}, the threshold pace in your profile.', {
    pace: 'pace',
  }),
  'explain.c5-gap': tpl(
    'Threshold pace needs critical speed or a tested threshold; none found. Threshold work goes by effort until then.',
  ),

  // J2: the check-in comes first
  'explain.j2-checkins': tpl('You checked in on {n} of the last {days} days.', {
    n: 'count',
    days: 'count',
  }),
  'explain.j2-low': tpl('Check-ins on the low side: {n}.', { n: 'count' }),
  'explain.j2-gap': tpl(
    'No check-in in the last {days} days. Readiness leans on other signals until one is added.',
    { days: 'count' },
  ),

  // J3: readiness only makes a session easier
  'explain.j3-normal': tpl('Readiness on {date} reads normal: no signal is flagged.', {
    date: 'date',
  }),
  'explain.j3-fatigue': tpl(
    'Readiness on {date} shows possible fatigue, so a session can be made easier but never harder.',
    { date: 'date' },
  ),
  'explain.j3-suppression': tpl(
    'Readiness has stayed low for at least {days} days as of {date}, so a lighter week may help.',
    { days: 'count', date: 'date' },
  ),
  'explain.j3-gap': tpl(
    'No check-in or wearable reading for {date}, so readiness reads normal by default.',
    { date: 'date' },
  ),

  // J4: heart-rate variability (the readings themselves reuse the today.signal.hrv sentences)
  'explain.j4-gap': tpl(
    'HRV needs {need} readings in the last {days} days; {found} found. Readiness leans on your check-in until then.',
    { need: 'count', days: 'count', found: 'count' },
  ),

  'explain.j4-today-gap': tpl(
    'No HRV reading for {date}, so your check-in carries readiness today.',
    { date: 'date' },
  ),

  // J5: the weekly decision
  'explain.j5-progress': tpl(
    'For the week of {week} the plan reads progress, so the next week is up to {minutes}.',
    { week: 'date', minutes: 'minutes' },
  ),
  'explain.j5-hold': tpl(
    'For the week of {week} the plan holds the volume, so the next week is up to {minutes}.',
    { week: 'date', minutes: 'minutes' },
  ),
  'explain.j5-reduce': tpl(
    'For the week of {week} the plan eases the volume, so the next week is up to {minutes}.',
    { week: 'date', minutes: 'minutes' },
  ),
  // The same three sentences when the suggested minutes are zero: "up to 0 min" would read as a
  // week with nothing to run, which is not what the decision says.
  'explain.j5-progress-bare': tpl('For the week of {week} the plan reads progress.', {
    week: 'date',
  }),
  'explain.j5-hold-bare': tpl('For the week of {week} the plan holds the volume.', {
    week: 'date',
  }),
  'explain.j5-reduce-bare': tpl('For the week of {week} the plan eases the volume.', {
    week: 'date',
  }),
  'explain.j5-completion': tpl(
    '{actual} of {planned} planned were run, under the {share} the plan looks for.',
    { actual: 'minutes', planned: 'minutes', share: 'share' },
  ),
  'explain.j5-reds': tpl('The energy-availability screen showed {n} signs, so progression holds.', {
    n: 'count',
  }),
  'explain.j5-signal': tpl('The week also showed {sign}, which the plan acts on.', {
    sign: 'text',
  }),
  'explain.j5-post-race': tpl(
    'The week of {week} falls in the window after your race, so the return schedule governs it.',
    { week: 'date' },
  ),
  'explain.j5-gap': tpl(
    'No plan covers the week of {week}, so there is no weekly decision to explain.',
    { week: 'date' },
  ),

  // J7: breaks
  'explain.j7-restart': tpl(
    'After a break this long, the first week back is {share} of the week before the break.',
    { share: 'share' },
  ),
  'explain.j7-gap': tpl(
    'No run is on file, so no break can be measured. The first week follows your start path.',
  ),

  // L1 to L6: the prediction
  'explain.l1-basis': tpl('The prediction rests on {basis}.', { basis: 'text' }),
  'explain.l1-anchor': tpl(
    'Your closest race to this distance is {distance} in {duration} on {date}.',
    { distance: 'distance', duration: 'duration', date: 'date' },
  ),
  'explain.l-gap': tpl(
    'A prediction needs a race result or critical speed from {need} efforts; none found. Add a race result to see one.',
    { need: 'count' },
  ),
  'explain.l2-gap': tpl(
    'A marathon prediction needs a race result or critical speed to start from; none found.',
  ),
  'explain.l2-single': tpl(
    'One race of {distance} or shorter adds {pct} for the longer distance.',
    {
      distance: 'distance',
      pct: 'percent',
    },
  ),
  'explain.l2-drift': tpl(
    'Pace and heart rate drift apart by {pct} on your long runs, which sets the share of critical speed you hold.',
    { pct: 'percent' },
  ),
  'explain.l3-sources': tpl(
    'Sources used for this prediction: {n}; the rule asks for at least {min}.',
    {
      n: 'count',
      min: 'count',
    },
  ),
  'explain.l3-gap': tpl(
    'A prediction needs at least {min} sources, such as a race and critical speed; none can be used yet.',
    {
      min: 'count',
    },
  ),
  'explain.l3-widened': tpl('With fewer sources the range is {pct} wider.', { pct: 'percent' }),
  'explain.l4-band': tpl(
    'For a distance this long the range is at least {pct} either side of the time.',
    { pct: 'percent' },
  ),
  'explain.l4-gap': tpl(
    'An ultra prediction starts from a marathon or ultra result and your long runs; none found.',
  ),
  'explain.l5-climb': tpl('{gain} of climb counts as {distance} of flat distance.', {
    gain: 'climb',
    distance: 'distance',
  }),
  'explain.l5-trail': tpl('On a trail course the range is widened by {pct}.', { pct: 'percent' }),
  'explain.l5-gap': tpl(
    'A trail prediction starts from a road estimate, which needs a race result or critical speed; none found.',
  ),
  'explain.l6-gap': tpl(
    'The minimum range applies once there is a prediction; none can be made yet.',
  ),
  'explain.l6-range': tpl('The predicted time is {predicted}, with a range of {low} to {high}.', {
    predicted: 'duration',
    low: 'duration',
    high: 'duration',
  }),
  'explain.l6-floor': tpl(
    'The range is never narrower than {pct} either side of the predicted time.',
    {
      pct: 'percent',
    },
  ),
  // ---------------------------------------------------------------------------------------------
  // The remaining rules (phase 3a E4-8). A rule with no runner figure to state is a policy entry
  // in `explainInputs.ts`; the ones below read the snapshot, the stored plan or the goal.
  // ---------------------------------------------------------------------------------------------

  // Gaps shared by several rules.
  'explain.goal-gap': tpl('No goal is set, so there is no race for this rule to read.'),
  'explain.plan-gap': tpl(
    'No plan is active, so there is nothing in the plan for this rule to show.',
  ),
  'explain.heat-gap': tpl(
    'Race-day heat needs a forecast or a climate record for the race place and date; none is on file yet.',
  ),

  // A4: consistency
  'explain.a4-gaps': tpl(
    'Stretches of {days} days or more without a run in the last {weeks} weeks: {n}.',
    { days: 'count', weeks: 'count', n: 'count' },
  ),
  'explain.a4-gap': tpl(
    'Consistency counts stretches without running in the last {weeks} weeks; no run is on file yet.',
    { weeks: 'count' },
  ),

  // A9: the start flags
  'explain.a9-flags': tpl('These details make the start gentler: {flags}.', { flags: 'text' }),
  'explain.a9-none': tpl('Nothing in your profile makes the start gentler.'),
  'explain.a9-gap': tpl(
    'Start flags also look at your age, height and weight; some of these are missing from your profile.',
  ),

  // B1 to B3: which measure counts load
  'explain.b1-rated': tpl(
    '{n} of the {total} runs in the last {days} days have an effort rating. Load uses session effort when {share} or more do.',
    { n: 'count', total: 'count', days: 'count', share: 'share' },
  ),
  'explain.b1-gap': tpl(
    'Load needs runs in the last {days} days; none found, so it counts minutes of running.',
    { days: 'count' },
  ),
  'explain.b2-hr': tpl(
    '{n} of the {total} runs in the last {days} days have heart-rate data that passes the sample checks.',
    { n: 'count', total: 'count', days: 'count' },
  ),
  'explain.b2-metric': tpl('Load is counted in {metric}, one measure for the whole series.', {
    metric: 'text',
  }),
  'explain.b3-sex': tpl('Heart-rate load uses the weights for {sex} runners, from your profile.', {
    sex: 'text',
  }),
  'explain.b3-default': tpl(
    'Your profile gives no sex, so heart-rate load uses the default weights.',
  ),
  'explain.b3-unused': tpl('Load is counted in {metric}, so the heart-rate weights are not used.', {
    metric: 'text',
  }),
  'explain.b3-gap': tpl(
    'Heart-rate load needs a maximum and a resting heart rate; one or both are missing.',
  ),

  // C6 to C8: intervals, ranges and updates
  'explain.c6-dprime': tpl(
    "Your D' is {distance}, the distance you can cover above critical speed. A rep lasts at most {share} of the time you could hold its pace.",
    { distance: 'distance', share: 'share' },
  ),
  'explain.c7-hr': tpl('Your {anchor} is a range, {low} to {high}, not a single value.', {
    anchor: 'text',
    low: 'bpm',
    high: 'bpm',
  }),
  'explain.c7-pace': tpl('Your {anchor} is a range, {slow} to {fast}, not a single value.', {
    anchor: 'text',
    slow: 'pace',
    fast: 'pace',
  }),
  'explain.c7-gap': tpl(
    'Boundaries are ranges around an anchor; no anchor is on file yet, so there is no range to show.',
  ),
  'explain.c8-break': tpl(
    'Your last run was {days} days ago. After a break of {limit} days or more, paces are estimated again from fresh efforts.',
    { days: 'count', limit: 'count' },
  ),
  'explain.c8-change': tpl(
    'The last change you accepted to {boundary} was on {date}. Only efforts after it count toward the next one.',
    { boundary: 'text', date: 'date' },
  ),
  'explain.c8-rule': tpl('A boundary moves only after {n} efforts that point the same way.', {
    n: 'count',
  }),
  'explain.c8-gap': tpl('No run is on file, so there is nothing to update the zones from.'),

  // F5: run days
  'explain.f5-plan': tpl('The plan sets {n} run days in the week of {week}.', {
    n: 'count',
    week: 'date',
  }),
  'explain.f5-available': tpl('You marked {n} days a week as available for running.', {
    n: 'count',
  }),
  'explain.f5-novice': tpl(
    'A new runner keeps to {n} run days a week or fewer, not on consecutive days.',
    { n: 'count' },
  ),
  'explain.f5-masters': tpl('From age {age} the plan keeps run days to {n} a week or fewer.', {
    age: 'count',
    n: 'count',
  }),

  // g-3: tightened profiles
  'explain.g3-ramp': tpl('Your weekly ramp is {pct} instead of {soft}, because of {reasons}.', {
    pct: 'percent',
    soft: 'percent',
    reasons: 'text',
  }),
  'explain.g3-none': tpl('No tightened profile applies, so the weekly ramp is {pct}.', {
    pct: 'percent',
  }),
  'explain.g3-gap': tpl(
    'Tightened profiles read your injury list and your recent running; no runs are on file yet.',
  ),
  'explain.g3-low': tpl(
    'Your logged runs average under {n} a week over the last {weeks} weeks, so the plan treats you as a new runner for the ramp and the recovery cycle.',
    { n: 'count', weeks: 'count' },
  ),

  // J6: the masters recovery check
  'explain.j6-on': tpl(
    'At age {age} the plan compares your fatigue, soreness and mood {hours} hours after a hard session with your own median of the last {days} days.',
    { age: 'count', hours: 'count', days: 'count' },
  ),
  'explain.j6-under': tpl(
    'The masters recovery check starts at age {masters}; your age is {age}, so it does not apply.',
    { masters: 'count', age: 'count' },
  ),
  'explain.j6-checkins': tpl(
    'The check needs {min} check-ins in the last {days} days; {found} found.',
    { min: 'count', days: 'count', found: 'count' },
  ),
  'explain.j6-gap': tpl(
    'The masters recovery check needs your age; no birth year is in your profile.',
  ),

  // J8 and n-6: fatigue states
  'explain.j8-normal': tpl(
    'No unexplained decline is running. After {days} days of one the plan suggests a lighter week.',
    { days: 'count' },
  ),
  'explain.j8-watch': tpl(
    'Readiness shows possible fatigue as of {date}. After {days} days of unexplained decline the plan suggests a lighter week.',
    { date: 'date', days: 'count' },
  ),
  'explain.j8-review': tpl(
    'Readiness has stayed lower than usual for {days} days or more as of {date}. A medical review is worth considering.',
    { days: 'count', date: 'date' },
  ),
  'explain.j8-gap': tpl(
    'The fatigue state needs check-ins or wearable readings; none found for {date}, so it reads normal by default.',
    { date: 'date' },
  ),

  // J9: rest and limited-running windows
  'explain.j9-window': tpl(
    '{reason}: from {from} to {to}. The minutes of those days are not added back.',
    { reason: 'text', from: 'date', to: 'date' },
  ),
  'explain.j9-limited': tpl(
    '{reason}: from {from} to {to}, with runs of {max} or less. The minutes of those days are not added back.',
    { reason: 'text', from: 'date', to: 'date', max: 'minutes' },
  ),
  'explain.j9-gap': tpl('No rest or limited-running window is set, so no day is held.'),

  // m-age and m-sex
  'explain.mage-age': tpl(
    'Your age is {age}, from your profile. It sets the maximum heart rate estimate and the masters rules, which start at {masters}.',
    { age: 'count', masters: 'count' },
  ),
  'explain.mage-gap': tpl(
    'No birth year is in your profile, so the maximum heart rate estimate and the masters rules have no age to read.',
  ),
  'explain.msex-set': tpl(
    'Your profile gives your sex as {sex}. It sets the heart-rate load weights, the bone-stress count and the HRV window, not your volume.',
    { sex: 'text' },
  ),
  'explain.msex-gap': tpl(
    'No sex is set in your profile, so the plan uses the default heart-rate load weights and the general bone-stress and HRV settings.',
  ),

  // n-1 to n-4 and n-7: red flags
  'explain.n1-active': tpl(
    'Focal bone pain was reported in the check-in of {date}. Progression holds until a later check-in does not report it.',
    { date: 'date' },
  ),
  'explain.n1-clear': tpl('No focal bone pain is reported in your latest check-in, of {date}.', {
    date: 'date',
  }),
  'explain.n1-gap': tpl('Focal bone pain comes from the daily check-in; none is on file.'),
  'explain.n2-pain': tpl(
    'Pain of {pain} out of 10 was reported in the last two days, at or above the {score} where progression holds.',
    { pain: 'count', score: 'count' },
  ),
  'explain.n2-below': tpl(
    'Pain of {pain} out of 10 was reported in the last two days, under the {score} where progression holds.',
    { pain: 'count', score: 'count' },
  ),
  'explain.n2-none': tpl('No pain was reported in the last two days.'),
  'explain.n2-gap': tpl(
    'Pain comes from the check-in or a rating on a run; none was reported in the last two days.',
  ),
  'explain.n3-rest': tpl(
    'Illness was reported on {date}. Intensity is suspended until a symptom-free day has passed.',
    { date: 'date' },
  ),
  'explain.n3-easy': tpl(
    'After illness on {date}, easy running only for {days} days before any intensity.',
    { date: 'date', days: 'count' },
  ),
  'explain.n3-clear': tpl('No illness is reported, so intensity is not held back.'),
  'explain.n3-gap': tpl('Illness comes from the check-in or a rest window; neither is on file.'),
  'explain.n4-flags': tpl(
    'Signs on the latest energy-availability screen: {n}. Progression holds at {hold} or more.',
    { n: 'count', hold: 'count' },
  ),
  'explain.n4-none': tpl('No energy-availability signs are on file.'),
  'explain.n4-gap': tpl(
    'No energy-availability screen is on file. The screen is offered every {weeks} weeks.',
    { weeks: 'count' },
  ),
  'explain.n7-event': tpl(
    'The event is expected to take {duration}. The stronger fluid-safety alert applies over {hours} hours and in heat.',
    { duration: 'duration', hours: 'count' },
  ),
  'explain.n7-gap': tpl(
    'The fluid-safety alert depends on how long the event takes; no goal time or prediction is available.',
  ),

  // O1: targets on the device
  'explain.o1-ceiling': tpl(
    'A watch alerts only above {bpm}, the top of your zone 1, in a band that starts at {floor}.',
    { bpm: 'bpm', floor: 'bpm' },
  ),
  'explain.o1-gap': tpl(
    'Heart-rate alerts on a watch need a maximum heart rate or your age; none found, so easy steps go by effort.',
  ),

  // D1 to D7: the goal
  'explain.d1-goal': tpl(
    'Your goal is {distance} on a {surface} course, with {gain} of climb, on {date}.',
    { distance: 'distance', surface: 'text', gain: 'climb', date: 'date' },
  ),
  'explain.d1-goal-flat': tpl('Your goal is {distance} on a {surface} course, on {date}.', {
    distance: 'distance',
    surface: 'text',
    date: 'date',
  }),
  'explain.d1-ultra': tpl(
    'At more than {limit} this counts as an ultra, so the ultra rules apply.',
    { limit: 'distance' },
  ),
  'explain.d1-not-ultra': tpl(
    'At {limit} or less this is not an ultra, so the ultra rules do not apply.',
    { limit: 'distance' },
  ),
  'explain.d2-time': tpl('Your goal is a time goal of {duration}.', { duration: 'duration' }),
  'explain.d2-time-open': tpl('Your goal is a time goal with no target time set yet.'),
  'explain.d2-finish': tpl('Your goal is to finish. Volume floors apply to time goals only.'),
  'explain.d2-finish-long': tpl('From {distance} a goal is to finish by default.', {
    distance: 'distance',
  }),
  'explain.d3-floors': tpl(
    'A time goal at this distance works toward {weekly} a week and a long run of {long}, reached only within the ramp limits.',
    { weekly: 'distance', long: 'distance' },
  ),
  'explain.d3-now': tpl(
    'Your last {weeks} weeks averaged {weekly} a week, and your longest run in the last {days} days was {long}.',
    { weeks: 'count', weekly: 'distance', days: 'count', long: 'distance' },
  ),
  'explain.d3-gap': tpl(
    'The weekly floor is compared with your last {weeks} weeks of running; no runs are on file.',
    { weeks: 'count' },
  ),
  'explain.d4-label': tpl(
    'The outlook for this goal reads {label}: about {needed} weeks of building against {available} weeks on the plan.',
    { label: 'text', needed: 'count', available: 'count' },
  ),
  'explain.d5-weekly': tpl(
    'You averaged {weekly} a week over the last {weeks} weeks. The plan notes an average under {low} before an ultra.',
    { weekly: 'distance', weeks: 'count', low: 'distance' },
  ),
  'explain.d5-years': tpl(
    'Your profile gives {years} years of running. The plan notes fewer than {min} before a first ultra.',
    { years: 'count', min: 'count' },
  ),
  'explain.d5-gap': tpl(
    'The ultra notes compare your last {weeks} weeks of running with the rule; no runs are on file.',
    { weeks: 'count' },
  ),
  'explain.d6-hot': tpl(
    'The race-day WBGT is about {temp}, at or above {trigger}, so the plan includes a heat acclimation block.',
    { temp: 'temp', trigger: 'temp' },
  ),
  'explain.d6-cool': tpl(
    'The race-day WBGT is about {temp}, under {trigger}, so the plan adds no heat acclimation block.',
    { temp: 'temp', trigger: 'temp' },
  ),
  'explain.d7-tier': tpl(
    'Your typical week is {typical}, which caps the longest run for this goal at {cap}.',
    { typical: 'minutes', cap: 'minutes' },
  ),
  // After a break of 7 days or more the plan restarts from a lower typical week [rules J7].
  'explain.d7-tier-break': tpl(
    'After your break the plan restarts from a typical week of {typical}, which caps the longest run for this goal at {cap}.',
    { typical: 'minutes', cap: 'minutes' },
  ),
  'explain.d7-gap': tpl(
    'The longest run for a 5 km or 10 km goal comes from your typical week; no weeks with a run are on file.',
  ),

  // E2 to E4 and E6: the plan's structure
  'explain.e2-phases': tpl(
    'Weeks of base: {base}. Build: {build}. Race-specific: {specific}. Taper and race week: {taper}.',
    { base: 'count', build: 'count', specific: 'count', taper: 'count' },
  ),
  'explain.e2-race': tpl('Weeks until the goal race: {weeks}.', { weeks: 'count' }),
  'explain.e3-cycle': tpl('The plan puts a recovery week after every {n} weeks of work.', {
    n: 'count',
  }),
  'explain.e3-short': tpl(
    'The cycle is shorter than the usual {usual} weeks because of {reason}.',
    {
      usual: 'count',
      reason: 'text',
    },
  ),
  'explain.e3-next': tpl(
    'The next recovery week in your plan starts on {week}, with up to {minutes} of running.',
    { week: 'date', minutes: 'minutes' },
  ),
  // A recovery week that a rest window holds whole has no minutes to state.
  'explain.e3-next-none': tpl(
    'The next recovery week in your plan starts on {week}, with no running set.',
    { week: 'date' },
  ),
  'explain.e4-week': tpl(
    'The week of {week} is a {phase} week, with about {z1} of running time in zone 1, {z2} in zone 2 and {z3} in zone 3.',
    { week: 'date', phase: 'text', z1: 'percent', z2: 'percent', z3: 'percent' },
  ),
  'explain.e6-ladder': tpl(
    'You start on rung {rung} of {rungs} of a run-walk ladder, because of your recent running.',
    { rung: 'count', rungs: 'count' },
  ),
  'explain.e6-floor': tpl('You start with {n} runs of {session} a week, then build from there.', {
    n: 'count',
    session: 'minutes',
  }),
  // The route that let the floor session rise above the 20-minute floor [rules E6, g-8].
  'explain.e6-lift-years': tpl(
    'Sessions longer than {floor} are allowed at the start because of {years} or more years of running and no flag that holds a start back.',
    { floor: 'minutes', years: 'count' },
  ),
  // The route of the block, in two sentences to stay within the 160 characters of a template
  // (`COPY_MAX_CHARS`). {years} is `a5.noviceMaxYears` in words ("one year"); {minimum} is the
  // threshold of `blockLiftMin`, the mean of the block's weeks without the highest
  // (`HistoryBlock.blockMin`), and {weeks} the credit window.
  'explain.e6-lift-block': tpl(
    'Sessions longer than {floor} are allowed at the start: at least {years} of running and a recent block of steady weeks.',
    { floor: 'minutes', years: 'text' },
  ),
  'explain.e6-lift-block-weeks': tpl(
    'That block is {blocks} steady weeks that, without the highest, averaged at least {minimum} a week and ended within {weeks} weeks.',
    { blocks: 'count', minimum: 'minutes', weeks: 'count' },
  ),
  'explain.e6-injury': tpl(
    'You start on the return ladder at runs of {session}, because of an injury in your profile.',
    { session: 'minutes' },
  ),
  'explain.e6-none': tpl(
    'You already run enough to skip a start path: the plan builds from your start level of {level} a week.',
    { level: 'minutes' },
  ),
  // The gap names what is missing only; the path sentence beside it says where the plan starts.
  'explain.e6-gap': tpl('No run is on file in the last {days} days.', { days: 'count' }),

  // H2 to H13: ultra, course and fuel
  'explain.h2-cap': tpl(
    'Your longest training run is capped at {cap}: the lesser of {hours} hours and {share} of the {race} expected for the race.',
    { cap: 'duration', hours: 'count', share: 'share', race: 'duration' },
  ),
  'explain.h4-climb': tpl(
    'Your race climbs {gain} over {distance}. The plan grows weekly climbing by at most {ramp} a week.',
    { gain: 'climb', distance: 'distance', ramp: 'percent' },
  ),
  'explain.h4-week': tpl('The plan sets the week of {week} at about {gain} of climbing.', {
    week: 'date',
    gain: 'climb',
  }),
  'explain.h4-gap': tpl(
    'No climb is entered for this goal, so the plan carries no climbing target for the race.',
  ),
  'explain.h5-descent': tpl(
    'Your race descends {loss} over {distance}. Graded downhill running starts {weeks} weeks before it.',
    { loss: 'climb', distance: 'distance', weeks: 'count' },
  ),
  'explain.h5-gap': tpl(
    'No descent is entered for this goal, so the plan has no descent figure to build toward.',
  ),
  'explain.h6-dark': tpl(
    'The race is expected to run into darkness, so the specific phase adds {low} to {high} headlamp rehearsal runs.',
    { low: 'count', high: 'count' },
  ),
  'explain.h6-day': tpl(
    'The race is expected to finish in daylight, so no headlamp runs are added.',
  ),
  'explain.h7-weeks': tpl(
    'Gut-training weeks in your plan, before the taper: {n}. The first is the week of {week}.',
    { n: 'count', week: 'date' },
  ),
  'explain.h7-none': tpl('Your plan has no gut-training weeks.'),
  'explain.h7-sessions': tpl('Runs flagged for fuel practice in the week of {week}: {n}.', {
    week: 'date',
    n: 'count',
  }),
  'explain.h10-week': tpl('Strength sessions the plan sets in the week of {week}: {n}.', {
    week: 'date',
    n: 'count',
  }),
  'explain.h10-pref': tpl('Your profile asks for {n} strength sessions a week.', { n: 'count' }),
  'explain.h12-hold': tpl(
    'After your goal race the plan holds {days} days without running, then returns in {steps} steps.',
    { days: 'count', steps: 'count' },
  ),
  'explain.h12-steps': tpl('After your goal race the plan returns in one step of reduced running.'),
  'explain.h12-modified': tpl(
    'The hold is lengthened from {base} to {days} days because of {reasons}.',
    { base: 'count', days: 'count', reasons: 'text' },
  ),
  'explain.h12-past': tpl(
    'Your race on {date} puts you in the weeks after a race until {until}, with {days} days without running first.',
    { date: 'date', until: 'date', days: 'count' },
  ),
  'explain.i8-credit': tpl(
    'Heat adaptation from your recent hot runs stands at {share} of a full block.',
    { share: 'share' },
  ),
  'explain.i8-gap': tpl(
    'No run of {min} or longer at {temp} or warmer in the last {days} days, so no heat adaptation is credited.',
    { min: 'minutes', temp: 'temp', days: 'count' },
  ),
  'explain.i2-band': tpl(
    'The race-day WBGT is about {temp}, inside the {low} to {high} band that carries no penalty.',
    { temp: 'temp', low: 'temp', high: 'temp' },
  ),
  'explain.i3-slope': tpl(
    'The race-day WBGT is about {temp}. From {start} to {end} the estimate adds {low} to {high} for each degree, more for a slower runner.',
    { temp: 'temp', start: 'temp', end: 'temp', low: 'percent', high: 'percent' },
  ),
  'explain.i2-cool': tpl(
    'The race-day WBGT is about {temp}, under {low}. A cool race carries no numeric penalty either.',
    { temp: 'temp', low: 'temp' },
  ),

  // K1 and K2: the taper
  'explain.k1-taper': tpl('A taper for this distance runs {days} days.', { days: 'count' }),
  'explain.k1-start': tpl(
    'A taper for this distance runs {days} days; your plan starts it in the week of {week}.',
    { days: 'count', week: 'date' },
  ),
  'explain.k2-week': tpl('The taper week of {week} is set at up to {minutes}.', {
    week: 'date',
    minutes: 'minutes',
  }),
  // A taper week that a rest window holds whole has no minutes to state.
  'explain.k2-week-none': tpl('The taper week of {week} has no running set.', { week: 'date' }),
  'explain.k2-gap': tpl('No taper weeks are in the plan yet.'),
} satisfies Record<string, Template>
