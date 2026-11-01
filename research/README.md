# Research base

The evidence behind the training engine: 425 papers, 22 topic syntheses, the rules derived from
them and the one document that turns the rules into engine behaviour. It is decision support for
one recreational runner, not medical advice.

## What is here

| Path               | Content                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `papers/<id>.json` | One verified paper: metadata, design, findings, limitations, implications, verification    |
| `topics/<key>.md`  | One synthesis per topic: what is established, contested, unknown, plus rules and papers    |
| `rules/<key>.json` | The rules of one topic as data: statement, parameter, value, grade, confidence, evidence   |
| `engine-rules.md`  | The integrated rule set, organised by engine stage (a-p), with the numeric parameter table |
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
13. **Treff 2019 and the G-5 sentence (2026-10-31).** Written for task H5 of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (section 5, decisions 9 and 11). One paper was added, `treff-2019-polarization-index` (a hypothesis paper that proposes the polarization index; level D; 396 to 397 papers), so that the comments of the evaluation harness cite a corpus id and not a bare DOI. It was looked up in Crossref (no `updated-by` notice) and its abstract and full text were read on Europe PMC that day; the formulas, the worked values and every row of its Table 1 were recomputed, and `npm run research:verify -- treff-2019-polarization-index` found no mismatch. The paper prints its Eq. 2 (the case of an empty zone 2) ambiguously, and the record states which reading its Table 1 supports. Its `vetting` states R1 to R6 (R6 is n/a for a journal paper) after one reading pass, with the sign-off pending at merge. No rule cites the paper: `topics/intensity-distribution.md` mentions it and lists it. Rule G-5 of `engine-rules.md` gained one sentence: a descriptive figure in a report gates, caps and justifies nothing, so it is not the ratio band the rule forbids (the precedent is ADR 0013; ADR 0016 applies it to the plan report). No rule value, grade, `Param` or `PARAMS_VERSION` changed.
14. **Practice records re-vetted (2026-10-31).** Written for task S4 of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (decision 2: one standard across the corpus). Each of the 19 practice records of step 7 was checked against the gates R1 to R6 of the section below, and its `vetting` and `interests` now state the results. The pages of NHS, Galloway, CTS, iRunFar (three articles), Active.com, Outside and Trail Runner (three), Running Magazine and andrewskurka.com, and the PDFs of Sanford Health, the BJSM blog and the University of Arizona copy of the original Couch-to-5K plan, were fetched on 2026-10-31. halhigdon.com dropped the connection of a plain HTTP client, so its novice 5K, intermediate 5K and advanced 10K pages were read in Wayback copies of 2026-10-12, 2026-04-07 and 2025-01-29 (each R1 note says which); the advanced 5K page could not be read, because its only Wayback capture is the host's captcha page. Each author was checked against a record independent of the author (Penguin Random House, Olympedia, a Wesleyan University notice, GOV.UK, ProPublica, the Western States and Hardrock result lists, University of Colorado Athletics, Human Kinetics, Athletics Illustrated, Outside Run). Fifteen records pass R1 and R2 and left `PREDATES_RUBRIC`. Four stay on it: `runningmagazine-2023-daniels-long-run-limit` fails R1 (Daniels's rule is known only by the magazine's report, the article names no book, and the book was not read), `higdon-2024-advanced-5k` holds on R1 (page not read), `clark-2026-couch-to-5k-original` holds on R1 and R2 (a university-hosted copy whose original site is gone) and `bjsm-2019-bone-stress-return-to-run` holds on R2 (an unsigned adaptation of Warden et al, original not read). R4 or R5 hold on the Strava columns, the Orton and Koop interview, the NHS and Clark plans and the Daniels record: the sources are one family, or they disagree, or a `Param` extends the population without labelling it. `signedOff` says one reading pass; the owner signs off at merge. No paper was added or removed, and no rule, grade, `Param` value or `PARAMS_VERSION` changed.
15. **Second reading pass on the practice records (2026-10-31).** Written for task S4b of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (decision 2: two independent reading passes sign an admission off). A second pass read the source of each of the 19 practice records of step 7 before it opened the notes of step 14: the live pages were fetched on 2026-10-31 with a plain HTTP client (the four halhigdon.com pages answered this time, so the advanced 5K page was read), the PDFs were read with `pdftotext`, and the Outside original of the Western States column was read beside its Trail Runner copy, which has the same text. The findings of every record were checked line by line against its source and all matched. The pass judged R1 to R6 on its own reading, compared them with step 14, and changed a gate only to the stricter result; it re-checked the authors against records independent of them (Olympedia, Human Kinetics, Open Library, the Hardrock finisher list, the Western States 2012 results, University of Colorado Athletics, GOV.UK, CNN). It disagreed on five gates in four records, each a pass raised to hold: `sanford-2024-return-to-running` R4 (the sheet gives different rest between runs, and `injuryReturn.restDaysBetween` takes 1 day beside the tendon levels where the sheet says 2 to 3 days) and R5, and R5 of `bjsm-2019-bone-stress-return-to-run`, `cts-2025-koop-ultra-recovery` and `skurka-2017-roche-100-recovery` (the notes of the `injuryReturn` and `h12` Params that apply them to any recent-injury flag, or to marathon and 50K returns, do not call that an extrapolation). On R2 of `clark-2026-couch-to-5k-original` it would pass the author (CNN confirms the plan is Clark's) and kept the hold of step 14, because nothing shows that the university copy matches his text. The advanced 5K page of Higdon, which step 14 could not read, matches its record, but only one pass has read it: its R1 stays hold, its `signedOff` says so, and it stays in `PREDATES_RUBRIC` (a second read or the owner's sign-off removes it). The other 18 records carry "two independent reading passes, S4 and S4b, 2026-10-31". No paper was added or removed, and no rule, grade, `Param` value, citation or `PARAMS_VERSION` changed.
16. **Methods research (2026-10-31).** Written for task M1 of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (sections 4.1, 4.2 and 4.6; decisions 5, 6 and 13): the candidates of the method families and of the question whether a characteristic of the runner predicts the better method, read in the source; the topic `training-methods`, written by hand because the corpus workflow's agents return summaries; and section (p) of `engine-rules.md` with rules P1 to P4. Each source was located by DOI or URL and read on 2026-10-31, Crossref was read for every DOI (none lists an `updated-by` notice), and no bot check or paywall was circumvented. Nine records were added (397 to 406); the gate results are R1 to R6 in the order of the rubric, and every journal record has R6 not applicable. Read in full on Europe PMC (open access): `casado-2023-lactate-guided-threshold` (the Norwegian lactate-guided model; narrative review, D; pass, pass, pass, hold, hold), `festa-2019-polarized-vs-focused-recreational` (38 recreational runners, 8 weeks; randomised trial, C; pass, pass, pass, hold, pass), `boullosa-2020-recreational-runners-review` (no consensus for recreational runners; narrative review, D; pass, pass, pass, hold, pass) and `meixner-2025-zone2-variability-cyclists` (50 cyclists; cross-sectional, C; pass, pass, pass, hold, hold). Read by abstract only, because the full text is closed access and was not fetched: `seiler-2010-best-practice-tid` (about 80% of sessions easy in competitive athletes; narrative review, D; pass, pass, pass, pass, hold), `zinner-2018-tid-mesocycles-recreational` (42 recreational runners; controlled trial, C; pass, pass, pass, hold, pass) and `scudamore-2018-vdot-paces-evaluation` (the VDOT calculator against laboratory values in 20 runners; cross-sectional, C; pass, pass, hold, hold, pass). Two programme pages that a preset would credit, read in full and recorded at the D cap of their class: `furman-2023-first-three-quality-runs` (FIRST, three quality runs a week; pass, pass, hold, hold, hold, pass) for P2 and `lydiardfoundation-2026-lydiard-principles` (base first, six phases written back from the goal; pass, pass, hold, pass, hold, pass) for P4. The books are task S3's: no book was recorded from a page about it. `gonzalezrave-2022-reverse-periodization` was re-read in full and its findings match; its limitations gained the count of 230 athletes in the Results text against 200 in the abstract and the three running studies, and its `checkedAt` moved to 2026-10-31. Two readings of the proposal's candidates changed on the full text: Casado 2023 names double-threshold days and states that no controlled study tests the model, and Meixner 2025's abstract says VT1 and FatMax align where its Table 2 gives 200 W and 125 W. Left out: Qin 2025 (10.1038/s41598-025-25369-7), read in full with its seven tables and figures 1, 3, 7 and 9, and not admitted, because R4 and R5 hold and its own text and tables do not reconcile (the training is not described and no registration is named, the between-group p-values of Table 6 and the cluster shares cannot be reproduced from the printed numbers, Figure 9a plots two outcomes per runner in a parallel-group design, and Table 7's falling pyramidal gain with experience has the opposite sign to the r = 0.72 of the Results); its headline conflicts with the null of `rosenblat-2025-tid-ipd-nma`, the reasons are in `topics/training-methods.md`, and what would change the verdict is a registration or protocol, the data, a correction or a replication. Also left out: Burnley 2022 and Foster 2022 (invited commentaries in Medicine & Science in Sports & Exercise with no abstract and no open full text, so not read) and the pages of Pfitzinger, Hansons, Hudson, Koop, Uphill Athlete and Maffetone (no preset of P2 to P4 credits them, and their books are task S3's). Every record's `vetting` says one reading pass, with the second pass or the owner's sign-off pending at merge. The rules P1 to P4 are grade D, "a choice, not a better plan"; P3 is not offered (decision 6). `npm run research:verify -- <ids>` checked 8 DOIs (the seven new ones and the re-read paper) with 0 mismatches and 0 Crossref correction notices; the two programme pages have no DOI and were skipped. No `Param`, value, grade, `PARAMS_VERSION` or oracle digest changed: the values of P2 and P4 are task M2's.
17. **Second reading pass on the methods records (2026-10-31).** Written for task M1b of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (decision 2: two independent reading passes sign an admission off). A second pass read the source of each of the nine records of step 16 before it opened their `vetting` notes: the full texts of Casado 2023, Festa 2019, Boullosa 2020 and Meixner 2025 on Europe PMC, the abstracts of Seiler 2010, Zinner 2018 and Scudamore 2018 on Crossref and Europe PMC (the full texts are closed access and were not fetched), and the live pages of the FIRST programme (furman.edu) and the Lydiard Foundation (principles, FAQ and the Stepping Out plan). Crossref was read for every DOI (none lists an `updated-by` notice), and the findings of every record were checked against its source. The pass judged R1 to R6 on its own reading, compared them with step 16, and changed a gate only to the stricter result; it re-checked authorship against records independent of the authors (Open Library for the authors of the FIRST book, Olympedia for Moller's Olympic bronze) and looked for later literature (the Europe PMC citations of the journal papers other than Seiler 2010, which has too many). It disagreed on one gate of 54: R3 of `zinner-2018-tid-mesocycles-recreational`, a pass raised to hold, because two 2019 comment letters on the paper (one on confounding by intensity) are listed on Europe PMC and neither pass read them. It also disagreed with one finding and did not apply it, because a disagreement over a finding is reported and not applied: finding 1 of `furman-2023-first-three-quality-runs` says that the page names no study, while its FAQ names "our 2004 marathon training study cited in RW", with no citation, sample size or result. All nine records now carry "two independent reading passes, M1 and M1b, 2026-10-31", and the three read by abstract only add "(abstract only)". Qin 2025 (10.1038/s41598-025-25369-7) was read in full a second time, with its seven tables, Figures 7 and 9 and a recomputation of its statistics. The verdict of step 16 stands: R1, R2 and R3 pass, R4 and R5 hold, R6 is not applicable, and no record is written. The second reading adds checks that the text does not reconcile (the sample-size sentence, the pace of Figure 7c, the markers of Figure 9a, and the p-values of Table 6 under both readings of the printed spread), and the entry in `topics/training-methods.md` and a row of `docs/research/watch-list.md` say what would move it in. No paper was added or removed, and no level, finding, rule, grade, `Param` value, citation, `PARAMS_VERSION` or oracle digest changed.
18. **Repetitions in reserve (2026-10-31).** Written for task RU1 of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (the owner's decision of the same date: the logging sheet keeps reps left, and a `research-update` pass grounds the RIR `Param`s) and for gaps 1, 2 and 11 of `docs/superpowers/specs/2026-10-24-strength-phase3b-design.md`. The wording of gap 2 there (no paper mentions repetitions in reserve) was already out of date: the gap pass of step 10 had added the RIR scale, the accuracy review, the autoregulation synthesis and the two papers on estimating a maximum on 2026-10-25, each from its abstract. The literature was found by Crossref and Europe PMC searches and read in the source on 2026-10-31; no bot check or paywall was circumvented, and Crossref lists no `updated-by` notice for any of the 25 DOIs. Eighteen records were added (406 to 424) and seven earlier ones were re-read. The topic `strength-autoregulation` was written by hand (the topics are now 22) because the corpus workflow's agents return summaries. The gate results are R1 to R6 in the order of the rubric, and every record has R6 not applicable. Read in full on Europe PMC or the journal's open-access page: `helms-2016-rir-rpe-application` (narrative review, D; pass, pass, pass, hold, pass; its Tables 1 and 2 are images behind a bot check and were not read), `helms-2018-rpe-vs-percent-loading` (controlled trial, C; pass, pass, pass, pass, pass), `steele-2017-predict-repetitions-failure` (cross-sectional, C; pass, pass, pass, hold, pass), `grgic-2022-failure-vs-nonfailure` (meta-analysis, A; pass, pass, pass, pass, pass), `refalo-2022-proximity-hypertrophy` (meta-analysis, A; pass, pass, hold, pass, pass: a comment and the authors' response are paywalled and unread), `richens-2014-reps-at-percent-runners` (8 runners and 8 weightlifters, cross-sectional, C; pass, pass, pass, pass, pass), `martikainen-2025-varying-proximity-failure` (randomised trial, C; pass, pass, pass, hold, pass), `wiedenmann-2026-rir-trainability` (repeated measures, C; pass, pass, pass, pass, pass) and `currier-2026-acsm-resistance-prescription` (the 2026 ACSM position stand, an overview of 137 reviews, consensus statement, A; pass, pass, pass, pass, pass), with `hickmott-2022-autoregulation-meta` and `nuzzo-2023-reps-at-percent-1rm` re-read in full (the tables of values of the latter are images and were not read). Read by abstract only, because the full text is closed access and was not fetched: `graham-2021-rir-autoregulation-fixed` (the publisher's abstract in Crossref; PubMed and Europe PMC hold none and the publisher's page refused; controlled trial, C; pass, pass, pass, pass, pass), `hackett-2017-accuracy-repetitions-failure` (cross-sectional, C; pass, pass, pass, pass, pass), `zourdos-2021-intraset-rir-accuracy`, `remmert-2023-rir-accuracy-trained-untrained`, `refalo-2023-rir-accuracy-bench` and `lovegrove-2021-rir-reliability-novices` (each C; pass, pass, pass, hold, pass), `vieira-2021-failure-vs-nonfailure` (meta-analysis, A; pass, pass, pass, pass, pass), `mann-2010-apre-vs-linear` (non-randomised trial, C; pass, pass, pass, hold, pass) and `lesuer-1997-1rm-equations` (the abstract on the publisher's page; C; pass, pass, pass, pass, pass); the re-read `zourdos-2016-rir-rpe-scale`, `reynolds-2006-1rm-prediction` (pass, pass, pass, hold, pass), `halperin-2021-rir-prediction-accuracy` (pass, pass, pass, pass, pass), `robinson-2024-proximity-failure-meta` (pass, pass, pass, hold, pass) and `acsm-2009-progression-models-resistance` (pass, pass, **fail**, hold, pass: the 2026 update supersedes it, so the record stays as the previous guideline that the `Param`s cite and supports nothing above D). The 2026 stand was found while checking R3 and changes the account: it says that training to the limit is not necessary, names near-limit or 2-3 in reserve as enough effort, says there is insufficient evidence to quantify exact targets, and does not restate the 2009 step criterion. Left out, with the reason in the topic: Larsen 2021 (read in full; one searcher and no pooled estimate, on the same two trials), Shattock and Tee 2020, Helms 2018 on volume autoregulation, Cowley 2025, Mansfield 2020, Ormsbee 2019 and McLeod 2024 (abstracts; compare other methods, add nothing new or share authors with the 2026 stand), Gismondi 2024 (cardiac rehabilitation patients), Julio 2012 (the publisher answered with a bot check), two conference abstracts of the ACSM meeting (not fetched) and the preprints of Halperin 2021 and Robinson 2024 (not admitted). Every record's `vetting` says one reading pass, with the second pass or the owner's sign-off pending at merge. What it supports: stopping short of the limit costs no strength in lifters, the count of repetitions left is good to about one repetition near the limit and off by several far from it and in long sets (usually understating the reserve), and choosing loads by the count was not worse than fixed percentages in trained men; nothing is tested in runners, and no paper tests a threshold of the count for raising a load. One grade changed: `f7.heavyRir` from D to C, an extrapolation from lifters; `f7.easyRir`, `f8.progressMinRir`, `f8.bigStepRir`, `f8.e1rmDivisor` and `f8.e1rmMaxReps` stay D and no value changed. A larger `f8.e1rmDivisor` is proposed and not made: the pooled counts for lower-body lifts and the one study of runners imply about 44 to 81 against 30, a change toward less load (G6), but no paper prints a divisor and the tables behind the pooled counts were not read in full. `PARAMS_VERSION` moved to `2026-10-31.2` because a grade changed; `history-oracle.json` is unchanged (`planDigest` blanks the version and `buildPlan` does not read the strength `Param`s) and `npm run plan:report` differs only in its version line. `npm run research:verify` checked the 25 DOIs with 0 mismatches and 0 Crossref correction notices. The evidence is in `topics/strength-autoregulation.md`, rules F7 and F8 and gaps S1, S2 and S11 of `engine-rules.md`.
19. **Second reading pass on the repetitions-in-reserve records (2026-10-31).** Written for task RU1b of `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` (decision 2: two independent reading passes sign an admission off). A second pass read the `findings` and the DOI of each of the 25 records of step 18, located the source and read it, judged R1 to R6 on its own reading, and only then opened the `vetting` notes. One record, `helms-2016-rir-rpe-application`, was opened by mistake at its limitations and its first gates before its source was read; its gates were judged on the text. The full text was read on Europe PMC for ten records (`helms-2016-rir-rpe-application`, `helms-2018-rpe-vs-percent-loading`, `steele-2017-predict-repetitions-failure`, `wiedenmann-2026-rir-trainability`, `grgic-2022-failure-vs-nonfailure`, `refalo-2022-proximity-hypertrophy`, `currier-2026-acsm-resistance-prescription`, `richens-2014-reps-at-percent-runners`, `hickmott-2022-autoregulation-meta`, `nuzzo-2023-reps-at-percent-1rm`) and in the journal's open-access PDF for `martikainen-2025-varying-proximity-failure`. The author's accepted manuscript was read for three records that the first pass could read only by abstract, found through OpenAlex's list of locations: `graham-2021-rir-autoregulation-fixed` and `lovegrove-2021-rir-reliability-novices` (St Mary's University repository) and `zourdos-2016-rir-rpe-scale` (Auckland University of Technology repository). The abstract was read for the other eleven (the publisher's page, Crossref and Europe PMC); for `halperin-2021-rir-prediction-accuracy` the author's OSF preprint, marked not peer reviewed, was also read for context and no gate rests on it. Not read: the tables of Helms 2016 (images; the image host answered with a bot check, which was not circumvented), the tables of values in Figures 2 to 4 of Nuzzo 2023, Figure 1 of Richens 2014, and the comment of Fonseca and colleagues on Refalo 2022 with the authors' response (10.1007/s40279-023-01946-6 and -01947-5; the publisher's pages show a preview of subscription content and Europe PMC holds neither). Crossref was read for every DOI and none lists an `updated-by` notice. **Gates.** The second pass agreed with 145 of the 150 gate results. It changed three results, each to the stricter reading, all R4 pass to hold: `wiedenmann-2026-rir-trainability` (the trainability finding has one corroborating record, which is itself held, and the paper's discussion calls the earlier trainability studies inconsistent), `richens-2014-reps-at-percent-runners` (the runner counts have no second source that was read, and the pooled leg press interval of Nuzzo 2023 sits with the weightlifters and not the runners) and `currier-2026-acsm-resistance-prescription` (its conclusion on failure summarises reviews already in the corpus and its sentence on 2-3 in reserve cites the practitioner column `helms-2016-rir-rpe-application`, so the agreement is not independent confirmation). On R4 of `zourdos-2021-intraset-rir-accuracy` and `refalo-2023-rir-accuracy-bench` the second pass would pass, and the first pass's hold stands as the stricter reading. All 25 records now carry "two independent reading passes, RU1 and RU1b, 2026-10-31"; the eleven read by abstract in both passes add "(abstract only)", and the three above say that RU1 read the abstract only. **Reported and not applied** (each would move a finding, a level or a `Param`): finding 7 of `hickmott-2022-autoregulation-meta` says that calls of 5, 7 and 9 RPE came about 5, 4 and 2 repetitions before failure, while the source and `zourdos-2021-intraset-rir-accuracy` give 5, 4 and 2 as the repetitions left beyond the call (a call of 1 left was followed by about 3 more); finding 3 of `martikainen-2025-varying-proximity-failure` says the authors do not read the squat result as a difference, while the discussion calls the gains of the varied group slightly more consistent and attributes them to lower fatigue (the interaction was not significant); finding 4 of `wiedenmann-2026-rir-trainability` repeats "significant from session 4" where Table 2 shows bench press at 4 in reserve not significant at session 5 (p = 0.078), and its "no age difference" is a non-significant result that the paper says is not evidence of equivalence; finding 5 of `helms-2018-rpe-vs-percent-loading` drops the source's "at all times" (training to failure at all times is not necessary); the level A of `robinson-2024-proximity-failure-meta` (exploratory, modest fit, indirect reserve estimates) and of `halperin-2021-rir-prediction-accuracy` (exploratory, I2 97.9%) is arguable; the `evidence` of `f7.heavyRir` omits the stand that its note and rule F8 cite; and the note of `f8.e1rmDivisor` says a divisor of 30 fits the bench press counts, which imply 33 to 36 (below). The accepted manuscript of Lovegrove 2022 gives 77.2% for the deadlift load at 1 in reserve for sets of 8 in its Results and 79.2% in its abstract, and a coach stepped its loads while consulting a textbook table of repetitions at a percentage. **Grade C of `f7.heavyRir`: justified, narrowly.** For: grade C is "small trials, observational data, or a reasonable extrapolation from strong evidence", and the claim that stopping short of the limit costs no strength has consistent A-level support (`grgic-2022-failure-vs-nonfailure`, `vieira-2021-failure-vs-nonfailure`, `robinson-2024-proximity-failure-meta`, the 2026 stand, and a third meta-analysis found and read in full by this pass, Wu 2026, 10.1186/s13102-026-01861-z, which favours stopping short for dynamic strength, SMD 0.24, 95% CI 0.06 to 0.42) and one randomised trial that spans the engine's range (`martikainen-2025-varying-proximity-failure`: 1 against 4 falling to 1 in reserve); most trials were in untrained adults, who resemble runners new to lifting; the direction is the safe one (G6, and Grgic's caution on concurrent training points the same way); and the corpus grades a strength dose extrapolated to ultra runners C where the supporting trials are strong (`h10.strengthBlockWeeks`). Against: the five sources are less independent than their count suggests (the three syntheses pool overlapping trials, the stand summarises them and takes its 2-3 in reserve from the practitioner column and the meta-regression, and Schoenfeld is an author of the stand, of Grgic 2022 and of Martikainen 2025); no study tests 1-3 against another target and the stand says no exact target can be fixed, so the grade supports the zone and not the numbers, as the note says; the outcome is 1RM in lifters and not running economy, the one runner trial of heavy lifting in the corpus (`storen-2008-maximal-strength-economy`) used sets of 4RM, which leave 0 in reserve, and the stand's own section on running performance finds insufficient data on whether standard resistance training changes it; and the corpus grades thinner extrapolations D (S10, the knee-extensor emphasis of H10) and doses resting on reviews of non-athletes D (`f7.maintenanceSets`). D would also be defensible and B would not. The grade moves no behaviour. **Divisor check of `f8.e1rmDivisor` (not changed).** With e1RM = load x (1 + n / d), n repetitions to the limit at a fraction f of the maximum imply d = n f / (1 - f). From the Discussion of `nuzzo-2023-reps-at-percent-1rm` (rounded values; its tables were not read): the general model gives 45 at 90% (about 5 repetitions) and 35 at 70% (about 15); the bench press 36, 35 and 33 at 90, 80 and 70% (about 4, 8.8 and 14.1); the leg press 81, 52 and 44 (about 9, 13.1 and 19.0); the textbook table 36 at 90% and 26 at 70%. From Table 2 of `richens-2014-reps-at-percent-runners`: the 8 runners 97, 79 and 93 at 90, 80 and 70% (10.8, 19.8 and 39.9 repetitions) and the 8 weightlifters 63, 47 and 42. The figures of the proposal therefore hold: 33 to 45 for the general and bench press models, and 44 to 97 for the leg press and the runners (44 to 81 for the leg press alone; the "about 44 to 81" of step 18 leaves out the runners, 79 to 97). They are sensitive to rounding at 90% (4.5 to 5.5 repetitions gives 40 to 50), and the runners' first 1RM may have been submaximal. Two further checks from abstracts: the 5RM equations of `reynolds-2006-1rm-prediction` imply 52 for the leg press and 38 for the chest press with the intercept ignored, and the loads at 1 in reserve of `lovegrove-2021-rir-reliability-novices` imply 30 to 34 for the deadlift and 35 to 53 for the bench press (stepped with a textbook table). A divisor of 30 predicts 3.3, 7.5 and 12.9 repetitions at 90, 80 and 70%, below every pooled count. A larger divisor lowers every estimate and the 90% ceiling (by 5.6% at n = 6 and 8.3% at n = 10 for d = 45), the direction of less load. One argument against changing it as proposed: the count the engine reads is the lifter's, and `halperin-2021-rir-prediction-accuracy` finds that it understates the reserve by about one repetition, which lowers the estimate by itself. For the bench press the two errors cancel at d = 30 (5 repetitions with 1 called and 2 left give an exact estimate) and a divisor of 35 would underestimate by 2.4%; for the leg press d = 30 overestimates by 5.8% and a divisor near 52 is closer (-1.7%). A larger divisor is supported for lower-body lifts and not for the bench press. No paper was added or removed, and no level, finding, rule, grade, `Param` value, citation, `PARAMS_VERSION` or oracle digest changed.
20. **The last two days before a long race (2026-11-01).** Written for task RF3 (rule K6, the "little running" of the final 24-48 hours). The taper papers and the pre-race week were re-read from their records; Europe PMC and Crossref were searched for a study of a shake-out or of a run on the day before a race, and none was found. One paper was added by "Add a paper", `sherman-1981-exercise-diet-glycogen` (an experimental study of trained runners, C; 424 to 425): its abstract fixes the running of the last days of one carbohydrate-loading protocol (runs of 90, 40, 40, 20 and 20 min and a rest day before a 20.9-km run) and finds no effect of the loading on the run time. The DOI resolved in Crossref (no `updated-by` notice) and the abstract was read in Europe PMC on 2026-11-01; the abstract states no number of runners, so the record has none. The synthesis in `topics/taper.md` says what the corpus supports and what it does not, and the two `Param`s of rule K6 that follow (`k6.dayBeforeMaxMin`, `k6.easyDaysBefore`) are grade D defaults: no study tests a run on the day before a race.

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
re-vetted against R1 to R6 by task S4 (method step 14), and each states its results in `vetting`.
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
