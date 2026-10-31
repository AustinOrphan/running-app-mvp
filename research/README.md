# Research base

The evidence behind the training engine: 396 papers, 20 topic syntheses, the rules derived from
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
10. **Strength gap pass (2026-10-25).** Written for the strength epic (`docs/superpowers/specs/2026-10-24-strength-phase3b-design.md`, section 4.4 and task E14-1). The twelve gaps of that section were searched by hand on Crossref and Europe PMC, one query set per gap, because the topic `strength-plyometrics` already exists and the corpus workflow was not needed. Twenty papers were added (376 to 396): each was looked up on Crossref, its abstract was read on Europe PMC that day, and `npm run research:verify` found no mismatch. Candidates with no abstract in Europe PMC or PubMed, with no DOI, whose abstract held no result on the gap, or that studied patients under treatment were left out; several admitted papers give no dose, and their records say so. The papers add something on ten of the twelve gaps and close none: no paper compares ways of progressing a load in runners, validates an equation for a maximum in runners, or gives a calf, jump, maintenance or taper dose for runners, and none concerns runners over about 50, 100-mile runners or eccentric work in trail runners. Rules F7 to F9 of `engine-rules.md` (and the amended E5, F-lib, F4, H5 and H10), the numeric table, the eight new rules of `rules/strength-plyometrics.json` and the section of `topics/strength-plyometrics.md` carry the result. Every dose they set is grade D, and every `Param` of F7 to F9 says so. The raw search results are kept outside the repository.
11. **Record edits (2026-10-31).** Written for task S0 of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (decisions 2 and 3, gate R1 of section 3.3). Three records changed and no paper was added; the rule `volume-long-run-share` (`rules/volume-performance.json`) and its row in `topics/volume-performance.md` carry the same provenance. The Daniels long-run limit (`runningmagazine-2023-daniels-long-run-limit`) is labelled as Running Magazine reports it, in the record and in the note of `macroDesign.longRunShareOfWeek`: the article was read and the book was not, and the date of that read (2026-10-22) stands. The records of Tyler 2016 and Mountjoy 2023 now name the Crossref notices listed against them (`10.1007/s40279-016-0572-3` and `10.1136/bjsports-2023-106994corr1`). Both publishers' pages answered with a bot check and Europe PMC holds no text for either notice, so neither was read and what each changed is unknown; the records say so. No rule, grade, value, `Param` value or `PARAMS_VERSION` changed.
12. **Vetting rubric (2026-10-31).** Written for task S2 of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (decisions 1, 2 and 4, section 3.3). The six gates, the sign-off and the caps by class for a source outside the journals are in the section below, the optional book fields are in `paperSchema` and `tools/write-corpus.mjs` keeps them, and a preprint or registration that waits is listed in `docs/research/watch-list.md`. No paper was added, and no rule, grade, `Param` value or `PARAMS_VERSION` changed.
13. **Practice records re-vetted (2026-10-31).** Written for task S4 of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (decision 2: one standard across the corpus). Each of the 19 practice records of step 7 was checked against the gates R1 to R6 of the section below, and its `vetting` and `interests` now state the results. The pages of NHS, Galloway, CTS, iRunFar (three articles), Active.com, Outside and Trail Runner (three), Running Magazine and andrewskurka.com, and the PDFs of Sanford Health, the BJSM blog and the University of Arizona copy of the original Couch-to-5K plan, were fetched on 2026-10-31. halhigdon.com dropped the connection of a plain HTTP client, so its novice 5K, intermediate 5K and advanced 10K pages were read in Wayback copies of 2026-10-12, 2026-04-07 and 2025-01-29 (each R1 note says which); the advanced 5K page could not be read, because its only Wayback capture is the host's captcha page. Each author was checked against a record independent of the author (Penguin Random House, Olympedia, a Wesleyan University notice, GOV.UK, ProPublica, the Western States and Hardrock result lists, University of Colorado Athletics, Human Kinetics, Athletics Illustrated, Outside Run). Fifteen records pass R1 and R2 and left `PREDATES_RUBRIC`. Four stay on it: `runningmagazine-2023-daniels-long-run-limit` fails R1 (Daniels's rule is known only by the magazine's report, the article names no book, and the book was not read), `higdon-2024-advanced-5k` holds on R1 (page not read), `clark-2026-couch-to-5k-original` holds on R1 and R2 (a university-hosted copy whose original site is gone) and `bjsm-2019-bone-stress-return-to-run` holds on R2 (an unsigned adaptation of Warden et al, original not read). R4 or R5 hold on the Strava columns, the Orton and Koop interview, the NHS and Clark plans and the Daniels record: the sources are one family, or they disagree, or a `Param` extends the population without labelling it. `signedOff` says one reading pass; the owner signs off at merge. No paper was added or removed, and no rule, grade, `Param` value or `PARAMS_VERSION` changed.
14. **Second reading pass on the practice records (2026-10-31).** Written for task S4b of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (decision 2: two independent reading passes sign an admission off). A second pass read the source of each of the 19 practice records of step 7 before it opened the notes of step 13: the live pages were fetched on 2026-10-31 with a plain HTTP client (the four halhigdon.com pages answered this time, so the advanced 5K page was read), the PDFs were read with `pdftotext`, and the Outside original of the Western States column was read beside its Trail Runner copy, which has the same text. The findings of every record were checked line by line against its source and all matched. The pass judged R1 to R6 on its own reading, compared them with step 13, and changed a gate only to the stricter result; it re-checked the authors against records independent of them (Olympedia, Human Kinetics, Open Library, the Hardrock finisher list, the Western States 2012 results, University of Colorado Athletics, GOV.UK, CNN). It disagreed on five gates in four records, each a pass raised to hold: `sanford-2024-return-to-running` R4 (the sheet gives different rest between runs, and `injuryReturn.restDaysBetween` takes 1 day beside the tendon levels where the sheet says 2 to 3 days) and R5, and R5 of `bjsm-2019-bone-stress-return-to-run`, `cts-2025-koop-ultra-recovery` and `skurka-2017-roche-100-recovery` (the notes of the `injuryReturn` and `h12` Params that apply them to any recent-injury flag, or to marathon and 50K returns, do not call that an extrapolation). On R2 of `clark-2026-couch-to-5k-original` it would pass the author (CNN confirms the plan is Clark's) and kept the hold of step 13, because nothing shows that the university copy matches his text. The advanced 5K page of Higdon, which step 13 could not read, matches its record, but only one pass has read it: its R1 stays hold, its `signedOff` says so, and it stays in `PREDATES_RUBRIC` (a second read or the owner's sign-off removes it). The other 18 records carry "two independent reading passes, S4 and S4b, 2026-10-31". No paper was added or removed, and no rule, grade, `Param` value, citation or `PARAMS_VERSION` changed.

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

## Sources outside the journals

A book, a programme page, a column, a conference abstract, a thesis or a report outside a journal is a
record only after it passes six gates, and its record states each result in `vetting` (a journal
record may carry `vetting` too). The decision is ADR 0015; the reasoning is section 3 of
`docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md`.

**The gates.**

- **R1 Provenance (hard).** The claim is located (edition and page, table, or URL and fetch date)
  and read in the source in the session that records it; a DOI resolves and Crossref's
  `updated-by` is read. Fails: known by report, from an agent's summary or from a mirror.
- **R2 Author (hard).** Named; credentials or track record confirmed in a record independent of
  the author (a university, a federation, a publisher), the author's own site only as a second;
  interests recorded. A seller is not excluded; an undisclosed interest in the claim is.
- **R3 Currency.** Date and edition recorded; the latest edition read or the difference stated;
  later consensus and corpus papers checked. Supersession decides, not age.
- **R4 Agreement.** Two independent sources agree (a magazine quoting a book is one source, as
  are papers that share authors), or a graded corpus paper does; disagreement recorded and the
  conservative reading used (G6). A single source is held unless it is the sole source of a
  practice.
- **R5 Applicability.** Population stated (distance, level, volume, age, sex, terrain); use
  outside it labelled extrapolated.
- **R6 Grade cap.** The cap of the table below, for a source outside the journals only; a journal
  paper keeps the level of its design.

**Results and sign-off.** A gate is `pass`, `fail`, `hold` or `n/a`, with a short note. A source is
admitted as evidence (at the level of its design) or as practice (grade D), held, or left out. R1 and
R2 are hard gates: a source that does not pass both is not admitted, whatever the other gates say. The
owner, or two independent reading passes that each read the source (method steps 2 and 3), sign an
admission off, and `vetting.signedOff` says who and when.

**Caps by class.**

| Class                            | May                                                       | May not                                                | Cap               |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ | ----------------- |
| Coaching books and manuals       | describe a prescription read in the book; fill a rule gap | raise a grade; move toward more load; enter by summary | D                 |
| Programme pages, columns         | find the primary study; be the sole source of a practice  | stand in for the study they report                     | D                 |
| Consensus statements, guidelines | grade by content (rigour, base of studies)                | take a grade from the label                            | A to D by content |
| Conference abstracts, theses     | report a result read in the abstract or thesis            | outrank the peer-reviewed version                      | C                 |
| Preprints                        | sit on the watch list until published                     | be cited by a rule or a `Param`                        | not admitted      |
| Trial registrations              | show what a trial planned to measure                      | carry a result                                         | not admitted      |
| Data reports outside journals    | describe distributions                                    | show that a plan works; set a default toward more load | D                 |

A dataset analysis in a journal stays a paper graded by its design. The D cap is a rule (method step 7).
The C cap and keeping preprints out are opinions, argued in ADR 0015. A `Param` that cites only
practice sources (programme pages, columns, books, data reports) is grade D, and a test holds it.

**What stays out.** Forums (they may locate a claim, never support one); anonymous or uncited blogs;
marketing; calculator pages; mirrored books; retracted work; text written by a language model,
including a model's summary of a book (ADR 0005: a language model never chooses a session, and the two
corpus studies of model-written plans, `duking-2024-chatgpt-running-plans` and
`montaruli-2026-ai-marathon-programs`, test plans, not summaries).

**Book fields.** A `book-or-guideline` record may carry `edition`, `isbn` (checksum checked),
`pagesRead` (the pages or sections read) and `interests` (what the author sells or has a stake in,
from R2), and `vetting`: `r1` to `r6`, each `{ result, note }`, and `signedOff`. Only `vetting` is
allowed on other designs. A book record is written by hand in the session that reads the pages, not
by the corpus workflow, whose agents return summaries. A `Param` cites a book by its paper id like any
other paper; a book alone gives grade D. `research:check` fails a `book-or-guideline` record whose `vetting` lacks R1
and R2 `pass`.

**The 19 practice records.** The 19 practice records admitted before the rubric (method step 7) were
re-vetted against R1 to R6 by task S4 (method step 13), and each states its results in `vetting`.
`PREDATES_RUBRIC` in `scripts/research-check.ts` now lists the four whose R1 and R2 do not both pass;
it exempts them from that check, and an entry is removed once both pass.

**Watch list.** A preprint or a trial registration is not admitted. `docs/research/watch-list.md`
records it by DOI or registry id with the reason and what would move it into the corpus; no rule,
topic or `Param` cites it.

## Checks

```
npm run research:check    offline; part of npm run check and CI
npm run research:verify   online, Crossref, one request at a time; run by hand
```

`research:check` fails when a paper does not match the schema or its file name, a paper uses an
unknown topic, two papers share a DOI, a book field sits on a record that is not a
`book-or-guideline`, a `book-or-guideline` record lacks `vetting` with R1 and R2 `pass` (the
records in `PREDATES_RUBRIC` excepted), or a paper id cited in `rules/`, `topics/`,
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
- **Add a source outside the journals.** Read the claim in the source, run the six gates above,
  write each result in `vetting` and have the admission signed off. The skill `research-update`
  has the steps.
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
