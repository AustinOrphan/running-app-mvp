# Research base

The evidence behind the training engine: 376 papers, 20 topic syntheses, the rules derived from
them and the one document that turns the rules into engine behaviour. It is decision support for
one recreational runner, not medical advice.

## What is here

| Path               | Content                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `papers/<id>.json` | One verified paper: metadata, design, findings, limitations, implications, verification    |
| `topics/<key>.md`  | One synthesis per topic: what is established, contested, unknown, plus rules and papers    |
| `rules/<key>.json` | The rules of one topic as data: statement, parameter, value, grade, confidence, evidence   |
| `engine-rules.md`  | The integrated rule set, organised by engine stage (a-o), with the numeric parameter table |
| `tools/`           | The workflow script that built the corpus and the writer that stores its result            |

The corpus ships in the repository. The web app bundles `papers/*.json` and `topics/*.md` at build
time for the Research page and the "why" drawer.

## Method

1. **20 topics.** Training intensity distribution, load quantification, load-response models,
   injury and load progression, periodization and recovery, taper, zones and thresholds,
   performance prediction, durability and drift, heat and weather, terrain and elevation, ultra
   training, ultra nutrition, strength and plyometrics, age, sex and the female athlete,
   readiness and HRV, novice and return to running, volume and performance, and algorithmic
   planning. The scope of each is in `tools/build-corpus.workflow.js`.
2. **Researcher.** One agent per topic searched Crossref, Europe PMC, PubMed and Semantic Scholar
   for the 8-14 most important papers (meta-analyses, consensus statements, RCTs, large cohorts,
   classics that define a method, recent work, and papers that critique popular methods). It read
   each abstract and wrote findings only from what the abstract or accessible full text states.
3. **Independent verifier.** A second agent per topic did not trust the first. It re-fetched every
   DOI and abstract, corrected metadata, rewrote unsupported findings, dropped papers that could
   not be verified, added up to three essential papers, wrote the topic synthesis and 6-15 rules,
   and listed the gaps.
4. **Opus integration.** One Opus agent read the 20 syntheses and wrote `engine-rules.md`: one rule
   set organised by engine stage, with conflicts between topics resolved explicitly, conservative
   defaults where evidence is weak, and a numeric parameter table.
5. **Crossref check.** On 2026-10-22 every DOI in the corpus was checked against Crossref (title,
   year, journal). One paper has no DOI (`nielsen-2012-training-errors`). `npm run research:verify`
   repeats the check.
6. **Terrain second pass.** The terrain-elevation topic was researched and verified a second time
   on 2026-10-22 and folded into H4, H5, I11, I12 and L5 of `engine-rules.md`.
7. **Second pass (2026-10-22) on five questions.** The topics beginners-return, injury-load,
   periodization-recovery, ultra-training and volume-performance were revisited for five engine
   defaults: the starting dose for novices and returners, the session spike and weekly ramp,
   recovery after marathons and ultras, the longest training run for ultras, and the long run for
   5 km and 10 km goals. Each question had a finder (Crossref, Europe PMC, PubMed and the practice
   sources a coach or runner cites), a verifier that re-fetched every source and corrected or
   dropped what it could not support, an adversarial pass per source that tried to refute it or
   show it was not relevant, a synthesis that rewrote the topic's synthesis, rules and gaps, and
   one integration that checked the five proposals against each other and the standing
   principles (a change toward more load needs stronger evidence; the conservative rule wins).
   Where the proposals differed, the recorded decisions fixed the outcome, and `engine-rules.md` follows them. The corpus grew by 70
   records, from 300 to 370: 48 with a DOI (checked with `npm run research:verify` on
   2026-10-22; one year was corrected to Crossref's online-first year), 3 scholarly records
   without a DOI (a conference abstract and two PubMed-only papers), and 19 practice sources (the
   NHS and original Couch-to-5K plans, coaching, clinical and magazine pages) kept as grade D
   conventions: they may set a default and never raise a grade. One blog post was not admitted.
   Sources verified twice under different ids merged by DOI, so each paper has one id.
8. **Disruption rule J9 (2026-10-23).** Written for phase 3a from papers already in the corpus, with
   no new paper: illness follows n-3, the restart after a long hold follows J7, and the tightened
   profile after a reported niggle follows G-3. The rule is grade D as a whole, and its three
   parameters (window length, back-dating, easy days after a niggle) are labelled defaults.
9. **Tissue and load-change papers (2026-10-25).** Six papers were added for the load-progression
   work, from a list of sixteen candidates narrowed to these six on 2026-10-24 (decision 11 of
   `docs/superpowers/specs/2026-10-24-load-progression-proposal.md`): two tendon studies of
   unloading and detraining in young non-runners, a meta-analysis of tendon adaptation to loading,
   two reviews of bone stress injury in runners and a conceptual framework of running injury
   (capacity against load). Each was looked up in Crossref and its abstract read on Europe PMC that
   day (the second bone review also from its open-access author manuscript); the corpus went from
   370 to 376 papers, and `npm run research:verify` found no mismatch. The papers support a caution
   after a reduction in running and no number: no paper gives a retraining rate for runners, and no
   paper dates tendon or bone capacity in runners after a partial reduction. No rule, `Param` or
   `PARAMS_VERSION` changed. The evidence is in `topics/injury-load.md`, the rule
   `injury-tissue-capacity-no-rate`, G-2 and J7 of `engine-rules.md`.

## Evidence levels and grades

A paper has an **evidence level** by design and quality:

- **A** meta-analysis, systematic review or consensus statement of good quality
- **B** randomised trial or large prospective cohort
- **C** small study, cross-sectional study or modelling
- **D** expert opinion or narrative review

A rule has a **grade** for the strength of its best support, using the same letters:

- **A** consistent meta-analyses or consensus statements
- **B** RCTs or large prospective cohorts
- **C** small trials, observational data, or a reasonable extrapolation from strong evidence
- **D** convention or engineering default. There is no direct evidence; the value was chosen to be
  conservative and the code and the UI must say that it is a default.

Where a rule states two grades (for example "C/D"), the parameter takes the weaker one unless the
rule says which value carries which grade.

## How rules relate to parameters

`engine-rules.md` is the source. Every number in it lives in `shared/engine/params/` as a `Param`
record, and engine code uses only those records (`P.g1.spikeRatioWarn.value`):

```ts
{ id: 'g1.spikeRatioWarn', value: 1.1, grade: 'B', rule: 'g-1',
  evidence: ['frandsen-2025-session-spike'], unit: '...', note: '...' }
```

- `id` is `<group>.<name>` and is the path under `P`. A group is named after its rule: `g1` holds
  rule G-1, `h4` rule H4. Execution defaults from the design (`expectedRpe`, `completion`,
  `effort`, `hrModel`, `matching`, `trim`) have their own groups in `m-execution.ts`.
- `rule` is the rule id in `engine-rules.md` (`g-1`, `H4`, `C3`). Rules of section n use `n-<number>`
  for the numbered list item. Execution defaults use `design-4.1` to `design-4.3` for the design
  sections.
- `evidence` lists paper ids from `papers/`. A grade D parameter may have none.
- A grade D parameter has a `note` that says it is a default. The why drawer shows the rule, grade,
  note and papers.
- A `note` is app copy. It passes the G5 lint (`shared/copy/lint.ts`; a test lints every note), and
  the why drawer reads its kilometre, metre, km/h, m/h and "per km" figures in the runner's units
  (`localiseParamNote`). Race classes are written `5K`, `10K`, `50K` and `100K`, as on the Goals
  page, because a distance such as "50 km" would be converted.
- Section files are `a-state`, `b-load`, `c-zones`, `d-goal`, `e-macro`, `f-micro`, `g-limits`,
  `h-ultra`, `i-env`, `j-adapt`, `k-taper`, `l-predict` and `m-execution`; `index.ts` merges them
  into `P` and holds `PARAMS_VERSION`.
- Where the rules give a range and the engine needs one number, `value` is the stated default or an
  end or midpoint of the range, and the `note` says which. The range stays in `range`.

A plan stores the `PARAMS_VERSION` it was generated with. Bump the version when any value, grade
or rule of a parameter changes.

## Checks

```
npm run research:check    offline; part of npm run check and CI
npm run research:verify   online, Crossref, one request at a time; run by hand
```

`research:check` fails when a paper does not match the schema or its file name, a paper uses an
unknown topic, two papers share a DOI, or a paper id cited in `rules/`, `topics/`,
`engine-rules.md` or the parameter registry does not exist. `tests/unit/research/corpus.test.ts`
and `tests/unit/engine/params.test.ts` run the same checks and more (every grade D parameter has a
default note, every parameter points to an `engine-rules.md` heading, ids are unique).

`research:verify` passes a paper when its DOI resolves, at least 60% of the shorter title's words
appear in the other title, and the year is within one of Crossref's. Fix a mismatch in the paper
file, or remove the paper and every citation of it.

## How to extend

Never invent a paper id, DOI or finding. Every paper is looked up, and its abstract read, in the
session that adds it.

- **Add a paper.** Look up the DOI in Crossref and the abstract in Europe PMC or PubMed. Write
  `papers/<firstauthor>-<year>-<keyword>.json` with every field of an existing file (copy one),
  list the topic keys it belongs to, and set `verification.checkedAt` to the date. Cite it where
  it matters (`topics/*.md`, `rules/*.json`, `engine-rules.md`, params). Run `npm run research:check`
  and `npm run research:verify -- <id>`.
- **Add a topic.** Add an entry to `TOPICS` in `tools/build-corpus.workflow.js`, run the script with
  the Claude Code Workflow tool, save its result as JSON outside the repository and run
  `node research/tools/write-corpus.mjs <result.json>`. The writer merges into `research/` and
  never deletes a file. Then read the new synthesis, update `engine-rules.md`, and update the
  parameters.
- **Change a rule or a number.** Edit `engine-rules.md` first (rule text, grade, evidence), then the
  matching `Param` in `shared/engine/params/`, then bump `PARAMS_VERSION`, then the unit tests
  that pin the number. A change that moves toward more load needs stronger evidence than one that
  moves toward less.
- **Re-derive after new research.** The last section of `engine-rules.md` lists what would change
  each rule. Re-run the affected topic, compare its rules with the current ones, and record a
  resolved conflict in `engine-rules.md` with the reason.

The project skill `research-update` (`.claude/skills/research-update/SKILL.md`) walks a session
through these steps.

## Limits

The corpus is a reading of published studies, not a systematic review. Most ultra, terrain and
masters rules are extrapolated or conventions; the top evidence gaps are listed in
`engine-rules.md`. Some constants are unverified (the Banister TRIMP sex constants) and are marked
so. Women and masters runners are under-represented in the underlying studies.
