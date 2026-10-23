# 0011. Fuel targets come from a ladder replayed from the runner's own logs, not from a calculator or a model

Status: Accepted 2026-10-23

## Context

Race fuel is the training variable where published guidance disagrees most and where a mistake can
end a race. The corpus holds a position stand at 30-50 g/h
of carbohydrate (`tiller-2019-issn-ultra-nutrition`), a physiology-based guideline at about 90 g/h
(`jeukendrup-2014-cho-intake`) and two small studies that favour 120 g/h
(`urdampilleta-2020-cho-120`, `norte-2026-graded-cho-cp`); none was run in ultra racing.

Phase 3a (design spec `docs/superpowers/specs/2026-10-22-coach-phase3a-design.md`, section 10) lets
a runner with a 100-mile goal find out what the gut tolerates before race day. Four choices needed
a decision: how a number is arrived at, where the ladder's position lives, what counts as a hot
day, and whether the fuel hold shares the heat-steering threshold of Today and the watch. Section
13, question 10, lists the ladder details as defaults that ship unless changed; they are Params
under `h7`, so a change is a Param change and does not reopen this decision.

## Decision

The fuel target is one rung of a ladder that a pure function replays from the runner's logs on
every read. The position on the ladder is never stored, and no language model writes a fuel plan
or a fuel sentence.

- **Ladder.** The floor (30-50 g/h), 60 g/h, then 70, 80 and 90 g/h in steps of 10 g/h, then 100,
  110 and 120 g/h. The rungs from 70 to 90 g/h open after an opt-in to 90 g/h; the rungs above 90
  g/h need a second opt-in that opens only after a run at 90 g/h went well. A diagnosed gut
  condition locks the ladder at the floor, removes the gut-training block and shows a clinician
  disclaimer.
- **Log.** After a run of 2 hours or more (1 hour or more in a gut-training week) the runner records
  carbohydrate from a personal product list, fluid, sodium, a gut score and a nausea score (0-4),
  and optionally whether it was hot. Each log keeps a snapshot of the products used, so editing or
  archiving a product leaves history unchanged.
- **Movement.** A counted run scored below 2 steps the target up one rung, except on a hot day; a
  run scored 2 or more holds it; two in a row, or one scored 4, return it to the last tolerated rung. A counted run
  reached 0.9 of the target rate and, above 60 g/h, took at least half its carbohydrate from
  multiple-source products. The numbers are the nine new `h7` Params and the existing gut-training
  ones, and the rule text is H7 in `research/engine-rules.md`.
- **Heat.** A run is hot when the weather it had reached 18 C WBGT, or 25 C air temperature when no
  WBGT exists, unless the runner answered otherwise. This is derived at read time. A hot day never
  steps the target up, and a bad hot-day run still counts toward the hold and the fall-back. The
  threshold is the fuel threshold (`h7.hotDayWbgtC`), separate from `isHotForSteering`, which
  uses `i9.warnWbgtC` (25 C WBGT) to drop a heart-rate ceiling.
- **Copy.** Every fuel sentence is a template under ADR 0010. The EAH safety card, the thirst-led
  fluid wording, the gut-condition lock and the low-certainty labels appear wherever fuel appears,
  with every number interpolated from its Param.
- **Data.** `FuelProduct`, `FuelLog` and `FuelSettings` are state models under ADR 0009.

Reasons:

- **Rule:** G1 and G6 in `research/engine-rules.md`, and ADR 0005, keep numbers that reach a runner
  deterministic and conservative where rules collide. H7 gates every rate above the floor on
  tolerance in training, and H8 allows no fluid figure beyond the reference range and thirst.
- **Rule:** H7 forbids carbohydrate scaling by body mass or sex, which rules out the usual
  calculator inputs.
- **Fact:** GI symptoms were reported by 96.0% of 272 respondents to a 161 km race and were a reason
  for dropping out for 35.6% of non-finishers, nausea being the most common
  (`stuempfle-2015-gi-distress-wser`, checked against its abstract on 2026-10-22).
- **Fact:** The corpus holds no ultra-distance trial of gut training or of 90-120 g/h. The two gut
  training trials ran 2 weeks in 25 and 18 runners and a review found eight small studies
  (`costa-2017-gut-training`, `miall-2018-gut-challenge`, `martinez-2023-gut-training-sr`); the
  gaps list of `research/topics/ultra-nutrition.md` states that no direct ultra comparison resolves
  30-50 against 60-120 g/h.
- **Fact:** A review puts the threshold for significant gut strain at 2 hours at about 60% VO2max
  and finds heat worsens it (`costa-2017-eigs-sr`), the source of the 2-hour log threshold and the
  direction of the hot-day rule. No study sets a temperature for it.
- **Fact:** The weather job fills 50 activities per 10-minute run (`WEATHER_BATCH` and
  `WEATHER_INTERVAL_MS` in `server/jobs/scheduler.ts`, read 2026-10-23), so a run logged soon after
  it syncs can still lack weather.
- **Opinion:** Tolerance is personal and the guidance does not agree with itself, so a number the
  runner has eaten without trouble on long runs is worth more than any formula. A ladder that
  starts at the tested floor and moves one rung at a time is also the cheapest way to find a
  mistake before race day.
- **Opinion:** Replaying the ladder from logs keeps it right when an activity is edited, a duplicate
  is merged, weather arrives late or a log is deleted. A stored step would need repair in each case.
- **Opinion:** A hot day for fuel is a lower bar than a hot day for steering, because stepping up
  the fuel rate on a warm day is the riskier mistake and holding it costs one run, while switching
  a session to effort-based targets at 18 C WBGT would take heart-rate guidance away on many
  ordinary days.
- **Preference:** Steps of 10 g/h and one tolerated run per step are taste within the evidence; the
  Params are labelled defaults for that reason.

Alternatives:

- **A model-written fuel plan.** Against (**Rule**): ADR 0005 keeps a model out of prescriptions,
  ADR 0010 allows no model to write app text in phase 3a, and a model call on training data needs
  its own data-handling ADR first. Against (**Opinion**): a limit on fuel and fluid cannot be
  checked against free text before it is shown, and a wrong figure on fluid is a hyponatraemia risk.
- **A fixed calculator** (a grams-per-hour figure from duration, pace or body mass). Against
  (**Rule**): H7 rules out body-mass and sex scaling. Against (**Fact**): the sources disagree by
  a factor of two to three and no ultra comparison settles it. Against (**Opinion**): a formula
  cannot know a runner's gut, and a confident number tempts a runner to try it first on race day.
- **No ladder** (show the floor of 30-50 g/h and stop). Against (**Opinion**): a 100-mile goal gives
  months to rehearse, and the floor alone leaves the question of whether the runner could take
  more unanswered, with nothing logged to answer it. For (**Opinion**): it is the simplest and the
  safest; the ladder is worth its cost only if logging stays near 20 seconds.
- **A hot flag saved with the log.** Against (**Fact**): the weather job above means the flag would
  usually be false at save time and could open a rung on a hot day, which H7 forbids. Against
  (**Opinion**): a stored flag is wrong again whenever weather loads or changes, and the runner's
  own answer already covers the case where the weather record is wrong.

## Consequences

- The ladder is recomputed on each read from at most a few hundred logs joined to their activities.
  Fuel writes raise the data version through the models' state classification, and no job exists.
- A toast that reports a step-up can be retracted when weather for that run arrives; the fuel lab
  always shows the current replay.
- A day can be hot for fuel and not for steering (18 C against 25 C WBGT). Both Params name the other
  in their notes, and a test pins the order.
- Rates above the floor are labelled low certainty, and a target is a rehearsal. Tolerance on
  training runs may not carry to a 25-hour race, and self-reported scores are noisy; the hold and
  fall-back rules are conservative for that reason, and the ladder changes only the fuel line,
  never a session.
- A tolerated rung does not decay after a layoff, and a bad run on a hot day counts toward the
  fall-back. Both are defaults that a Param or a rule edit can change without a new ADR.
- The unit of change is a Param under `h7` and its rule in `research/engine-rules.md`, bumped
  together under `PARAMS_VERSION`.
