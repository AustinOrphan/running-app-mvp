# 0005. A deterministic, evidence-graded training engine; a language model writes text only

Status: Accepted 2026-10-22 (#529)

## Context

Version-1 plans came from a small rule set in `shared/domain/plan.ts`. The owner asked for a plan
builder that uses current research, adapts to history, age, heat, heart rate and terrain, scales to
100 miles and beyond, and learns from how each planned session went. Three designs were possible: a
language model writes the plan, a fitted model (for example a fitness-fatigue model) shapes it, or
explicit rules in code build it. The research corpus under `research/` (papers, topic syntheses and
`engine-rules.md`) exists to support the third.

## Decision

The plan comes from a pure, deterministic engine in `shared/engine/`: the same input and the same
`today` give the same output, with no I/O, randomness or clock reads. Each number in it is a `Param`
record in `shared/engine/params/` with a grade (A to D), a rule id in `research/engine-rules.md` and
cited paper ids. A grade D value is a default and carries a note that says so. Every plan passes an
automated quality checklist before it is stored, and a failed check blocks publishing.

A language model may write explanatory text around a decision the engine has already made. It does
not choose sessions, volumes, paces, limits or zone changes, and no code path turns model output
into a prescription.

Reasons:

- **Rule:** `research/engine-rules.md` G1 ("Deterministic core") states that sessions, volumes and
  paces come from rule code with schema validation and that a model may only write explanatory
  text. The training engine design (`docs/superpowers/specs/2026-10-22-training-engine-design.md`,
  section 1) lists model-generated sessions as a non-goal.
- **Fact:** The corpus holds two studies of language-model running plans
  (`duking-2024-chatgpt-running-plans`, `montaruli-2026-ai-marathon-programs`), cited under G1; the
  rule's grade, C/D, reflects how thin that evidence is. The corpus holds no trial in which an
  adaptive or model-adjusted plan beat a fixed one over a season (evidence gap 10 in
  `engine-rules.md`).
- **Fact:** The plan matrix test (`tests/unit/engine/matrix.test.ts`) can assert every safety limit
  in every week for synthetic athletes only because the output is reproducible.
- **Opinion:** Safety limits that hold by construction are worth more to one runner than any gain a
  less predictable generator might give. A model's output cannot be checked against a limit before
  it is shown, a rule's output can.
- **Opinion:** Showing the rule, the grade and the papers behind each number (the "why" drawer) is
  honest only if the number came from that rule. With a generative step in between, the drawer
  would describe a rule that did not produce the number.
- **Rule:** `research/engine-rules.md` G2 keeps fitness-fatigue models out of plan structure
  (monitoring and what-if views only), because the corpus shows their parameters do not hold up
  statistically.

Alternatives:

- **A language model writes sessions, checked afterwards.** Against (**Opinion**): a checker that
  rejects most output is a generator with extra steps, and the checks cannot cover what the rules
  do not state. Against (**Fact**): see the evidence on model-written plans above.
- **A fitted fitness-fatigue model drives load.** Against (**Rule**): G2.
- **Keep the version-1 rules and tune them.** Against (**Opinion**): the version-1 rules have no
  concept of session spikes, heat, terrain, goal descriptors or execution, so each would be added
  beside code that assumes it away.

## Consequences

- The numbers in a plan can be traced to a rule and to papers or to a stated default. Changing a
  number means editing `engine-rules.md`, the matching `Param` and `PARAMS_VERSION`, in that order
  (project skill `research-update`).
- Plans carry `generatorVersion` 2. Version-1 plans stay readable; `POST /api/plan/generate` always
  runs the engine.
- The engine cannot say more than its evidence allows. Where the corpus has no direct trials (50 km
  to 100-mile training), the values are conventions and the app labels them as defaults.
- A future explanatory-text feature calls a model after the engine and shows the text as
  commentary. It needs its own ADR for data handling, because it would be the first third-party
  call that carries training data.
