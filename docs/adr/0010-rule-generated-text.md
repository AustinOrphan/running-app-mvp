# 0010. App text is rendered at read time from stored facts by typed templates; no model writes it, and one lint covers it

Status: Accepted 2026-10-23 (#542)

## Context

ADR 0005 keeps every plan decision deterministic and allows a language model to write explanatory
text around a decision only after the engine has made it. Phase 3a (design spec
`docs/superpowers/specs/2026-10-22-coach-phase3a-design.md`) adds many more sentences about the
runner: a section of the runner's own figures at the top of every Explain, a Monday brief, a "What stood out" card on every run,
revision and undo text, Today's verdicts and targets, and fuel and prediction lines. Seven epics
would each have written their own sentences, their own number formatting and their own list of
words the app must not use.

Before the shared design existed, the epic designs held five formatters for revision text and seven
G5 word lists that disagreed with each other. The existing code already shows the pattern: engine
messages are written in metres and kilometres and converted to the runner's units afterwards by
regular expressions (`web/components/engineText.ts`), and the why drawer printed a parameter as
`0.2 fraction of duration`.

## Decision

Every sentence the app writes about the runner is a template in `shared/copy/`, and a stored record
holds structured facts, never prose.

- A template (`tpl`) is text with `{name}` placeholders and one declared slot per placeholder. A slot
  is a `Quantity` (pace, speed, distance, climb, duration, minutes, bpm, percent, share, count,
  temperature, date or weekday, in metric base units and ISO dates) or plain text. `formatQuantity`
  is the only code that turns a quantity into words, in the runner's units.
- A stored fact (`InputFact`) keeps a template id and its slot values. `renderFact` renders it when
  it is read, so a copy fix and a change of units reach records written earlier.
- A slot that is missing, of the wrong kind or not a usable number throws under test and renders the
  template's fallback elsewhere, so a page never shows `undefined`, `NaN` or an ISO date.
- Parameter values reach the screen through `describeParamValue`, which has one reading for every
  unit string in the parameter registry and fails its test on a unit without one.
- A number that restates a Param is interpolated from the Param, and a test compares the sentence
  with it.
- No language model writes app text in phase 3a.
- One lint (`shared/copy/lint.ts`) holds the G5 word list. A test renders every registered template
  and fails on a banned word, an undeclared or unused slot, more than 160 characters or a missing
  final stop; rendered page tests call `expectCleanCopy`. No epic keeps a list of its own. The lint
  covers copy the app authors; text a provider or the system returns is shown verbatim inside an
  app-authored sentence, quoted as the service's own words, and is outside it.

Reasons:

- **Rule:** ADR 0005 and G1 in `research/engine-rules.md` keep plan decisions and the sentences
  about them deterministic; the phase 3a design (section 1, point 4) states that every sentence is
  rule-generated.
- **Rule:** ADR 0005 requires its own ADR, covering data handling, before any model call carries
  training data to a third party. This decision does not make that call.
- **Rule:** G5 in `research/engine-rules.md` bans "behind" and "missed", streaks and red states, and
  any personal injury probability. The design (section 4.5, decision 23) fixes the word list.
- **Rule:** ADR 0003 stores distances in metres and durations in seconds, so units can only change
  how a value is shown, not what is stored.
- **Fact:** The first run of the lint test, on 2026-10-23, found a banned word in existing copy: the
  why drawer intro read "Every number in the plan has a rule behind it", and the test flagged
  "behind". Word lists kept apart would have missed it.
- **Fact:** The parameter registry at `PARAMS_VERSION` 2026-10-22.2 holds 561 parameters with 163
  distinct unit strings, counted with `allParams()` on 2026-10-23; the unit tests read every one in
  both unit systems.
- **Opinion:** Stored facts keep a copy fix and a units change effective for old briefs and
  explanations. Stored prose would freeze the wording, the units and any wording mistake at the time
  of writing.
- **Opinion:** Typed slots catch a missing or mistyped number when the code compiles, which review
  by eye does not; a fallback rather than a throw in production keeps one bad record from blanking
  a page.
- **Opinion:** A closed set of templates can be linted, length-checked and compared with the Params
  in tests before any runner sees it. Free text from a model could be checked only after it was
  written.
- **Preference:** Short sentences with at most one figure each, over long paragraphs, so a reading
  pass over the template files is feasible for one owner.

Alternatives:

- **Store the rendered sentence with each record, as `PlanRevision.summary` does.** Against
  (**Opinion**): the wording, the units and any G5 slip are fixed when the record is written, and a
  fix needs a data migration.
- **A language model writes explanations and briefs from the facts.** Against (**Rule**): ADR 0005's
  data-handling condition is unmet and no ADR proposes it. Against (**Opinion**): an assertion that
  the text matches the engine's numbers cannot be made for free text the way it can for a template
  rendered from the Param.
- **Each epic keeps its own strings and word list.** Against (**Fact**): the design review found
  seven lists that disagreed, and one would have banned "Record result" (decision 23).
- **A message-format library (ICU MessageFormat) for the strings.** Against (**Rule**): phase 3a adds
  no runtime dependency (design section 3, Environment). Against (**Opinion**): the app has one
  language, and the need is slot kinds checked by the compiler, which would still be a layer to
  write on top of the library.
- **Lint by code review only.** Against (**Opinion**): a rule that depends on a reader remembering
  seven lists is not applied; the lint test applies it to every template and every rendered page.

## Consequences

- A new sentence is one entry in `TEMPLATES` (or in a file spread into it). The lint test picks it
  up without an edit.
- A template id that stored facts reference is not renamed, and its meaning does not change: wording
  can be fixed in place, but a different meaning gets a new id. An unknown id renders a neutral line
  instead of failing.
- A new unit string in the parameter registry needs an entry in `shared/copy/paramUnits.ts` in the
  same change; the test fails otherwise.
- Grammar that varies (plurals, "a" and "an") is handled by separate templates, not by logic inside
  one. Template copy can read stiffly at the edges; the design (section 8.9) bounds this with fuzzed
  renders and an owner reading pass.
- The word lint matches whole words, so it can flag a harmless use. The reply is to reword the
  sentence, not to add an exception.
- A future model-written commentary needs its own ADR for data handling (ADR 0005), and its output
  would be shown as commentary beside the rendered facts, not stored in place of them.
