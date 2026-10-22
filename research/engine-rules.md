# Engine Rules: Evidence-Based Training Plan Engine

Version 1, 2026-10-22. This document integrates 20 topic syntheses into one rule set. It is decision support for one recreational runner. It is not medical advice.

## How to read this document

- **Grades.** A = consistent meta-analyses or consensus statements. B = RCTs or large prospective cohorts. C = small trials, observational data, or a reasonable extrapolation from strong evidence. D = convention or engineering default. A grade D rule has no direct evidence; it was chosen to be conservative and must be labelled as a default in the code and the UI.
- **Units.** The rules state values in km, min and C to keep them readable. The engine stores distance in metres, duration in seconds, plan targets in minutes, and dates as `YYYY-MM-DD` in local days, with weeks starting on Monday (ADR 0003).
- **Conflicts.** Where two topics disagree, the rule says **Conflict** and explains which side wins and why.
- **Terrain.** The terrain-elevation topic was verified in a second pass on 2026-10-22 (17 papers). Its rules are folded into H4, H5, I11, I12 and L5 below; see `research/topics/terrain-elevation.md`.

## Global principles

- **G1 Deterministic core.** Sessions, volumes and paces come from rule code with schema validation. An LLM may only write explanatory text. Every plan must pass an automated quality checklist covering progression, recovery weeks, TID, taper and level differentiation before it is published. Grade C/D [duking-2024-chatgpt-running-plans, montaruli-2026-ai-marathon-programs].
- **G2 The FFM does not drive plans.** Fitness-fatigue models are only for monitoring and what-if views. Plan structure comes from the explicit rules below. Grade C [busso-2023-impulse-response-validity, hellard-2006-banister-limitations, marchal-2025-ffm-statistical-flaws].
- **G3 Priors, not optima.** Every target is a prior with an uncertainty band. Individual values move toward the athlete's own data by shrinkage, and only after at least 3 comparable observations (D). Grade C/D [hecksteden-2015-individual-response, mann-2014-high-low-responders].
- **G4 No responder labels.** If a block shows no improvement beyond measurement noise, change the stimulus before drawing any conclusion. Grade C [bonafiglia-2016-interval-response-variability].
- **G5 Copy discipline.** Targets are a sketch. The app never says "behind" or "missed" and never uses streaks or red states. It never claims that any limit prevents injury. Grade B [buist-2008-graded-training, damsted-2018-training-load-change].
- **G6 Safety first.** Rules never move toward more load when the evidence is weak. When rules collide, the more conservative one wins.

---

## (a) Athlete state estimation

- **A1 Separate stores.** Keep three separate stores: load (external: time, distance, gain, power; internal: sRPE, TRIMP), readiness (check-ins, HRV, resting HR, sleep) and performance (races, best efforts, CS). Moderators (age, sex, heat, sleep) are explicit inputs with wide uncertainty. Grade D [jeffries-2021-training-framework, impellizzeri-2019-internal-external-load, bourdon-2017-load-consensus].
- **A2 Chronic and acute load.** Use EWMA with a 7-day acute and a 42-day chronic time constant. These are a user-adjustable convention, shown as descriptive trends. Grade D [murray-2017-ewma-acwr, nakaoka-2021-acwr-runners].
- **A3 Longest recent run.** Keep the rolling 30-day maximum of completed runs, by distance and by duration. For a new user without logs, use the longest recent run they declare. Grade B [frandsen-2025-session-spike].
- **A4 Consistency.**
  - Count gaps of 7 or more days with no running in the last 16 weeks. Grade B [feely-2022-training-disruptions].
  - Record the share of planned weeks completed; above 80% counts as consistent (D) [lepers-2021-sub3-marathon-decades].
  - Record years of regular running [hoffman-2013-ultra-exercise-behavior].
- **A5 Experience class.** Classify the athlete as novice, returning (by layoff length), recreational or trained.
  - Novice means no running history or no running in the prior few months. The exact definition is the engine's own (D).
  - Novices carry about 2.3 times the injury rate per hour (17.8 vs 7.7 per 1000 h). Grade A [videbaek-2015-incidence].
- **A6 Fitness.**
  - Primary: CS from at least 3 best grade-adjusted efforts between 400 m and 5 km in a 90-day window. The window is D. Grade C [smyth-2020-cs-training-data].
  - With 2 or more races at different distances, fit a personal exponent. Grade C [blythe-2016-individual-prediction, vickers-2016-race-times].
  - Device VO2max is a smoothed trend only. Its limits of agreement are about ±10 ml/kg/min. Grade A [molinagarcia-2022-wearable-vo2max].
  - Do not use device kcal anywhere. Grade A [fuller-2020-wearables-systematic-review].
- **A7 Durability descriptor.**
  - Prior: threshold speed falls about 5.5% after 90 min, with a large spread. Grade C [hunter-2025-marathoners-durability-slt, nuuttila-2025-recreational-runners-durability].
  - Personalise only after 3 comparable long runs. Runs are comparable when duration is within 20%, ambient temperature is within 5 C, and the fuelling/fluid flag is the same (D) [hunter-2025-durability-methods].
  - Exclude runs at 25 C or warmer, and hot runs with no fluid or more than 2% body-mass loss. Grade C/D [wingo-2020-drift-vo2max-heat-running, montain-1992-dehydration-drift, ganio-2006-fluid-vo2peak-drift].
  - Make no drift-based fitness inference beyond 180 min. Grade D [mattsson-2011-late-drift-ultra].
- **A8 Efficiency index.** Track pace at a fixed HR, or HR at a fixed pace, on steady flat runs.
  - A rising index across weeks indicates adaptation.
  - A sustained fall with rising RPE is an overreaching signal. The threshold is athlete-relative; no cut-off is validated. Grade B [roete-2021-functional-overreaching-markers, nuuttila-2021-intensity-vs-volume-monitoring].
- **A9 Risk profile.** Record at onboarding, then update:
  - Running injury in the last 12 months (A for the factor; the window is D) [hulme-2017-risk-protective, vanderworp-2015-risk-factors].
  - Previous BSI, with OR about 5. Grade A [wright-2015-stress-fracture-meta].
  - REDs flags [mountjoy-2023-reds-consensus].
  - BSI factor count [barrack-2014-bone-stress-triad].
  - Novice soft flags: age 45-65, BMI above 30, a prior non-running musculoskeletal complaint, no running history. Grade C [kluitenberg-2015-nlstart2run, nielsen-2013-novice-predictors].
- **A10 FFM fitting.**
  - Fit only with at least 20 performance observations over 12 weeks (D).
  - Default to a fitness-only model. Enable the fatigue term or VDR only if forward-chaining CV lowers held-out error.
  - Benchmark against elastic net on EWMA features.
  - Never display time constants. Flag fits whose intervals are wider than 25 days.
  - Grade C [imbach-2022-generalisation, marchal-2025-ffm-statistical-flaws, hellard-2006-banister-limitations, busso-2003-variable-dose-response].

## (b) Load metrics per session

- **B1 Primary metric.** sRPE = minutes × CR-10. Ask for it on every run with fixed wording and visible anchors. Prompt about 30 min after the run; the timing is D and the rating stays editable. Grade C [foster-2001-session-rpe, haddad-2017-session-rpe-review, wallace-2014-load-methods-runners].
- **B2 Which metric when.**
  - **Chest-strap HR, or wrist HR on steady flat or treadmill runs that pass sample checks:** compute TRIMP alongside sRPE. Wrist bias is about −0.5 bpm on steady runs. Grade A [zhang-2020-wrist-ppg-meta, gillinov-2017-wearable-hr-aerobic].
  - **Wrist HR on hills, trail, intervals or non-running activity:** reject it for TRIMP and use sRPE. A Fenix 5 had 13% MAPE on a trail run. Grade C [navalta-2020-trail-running-hr, bent-2020-ppg-inaccuracy].
  - **Pace only (no HR, no RPE):** store external load only and derive the planned and executed zone from pace against CS. Internal load stays missing, not imputed. Grade C/D.
  - **RPE only:** use sRPE for both load and TID zone. Grade C [seiler-2006-tid-quantification].
- **B3 Sex-specific TRIMP.**
  - Banister TRIMP = duration × HRR fraction × weight. The exponent b is 1.92 for men and 1.67 for women, and the leading weights are 0.64 and 0.86.
  - These constants are unverified (Banister 1991 is not indexed). Show the formula. When sex is unspecified, use an explicit user setting, defaulting to the male constant. Grade D [wallace-2014-load-methods-runners, manzi-2009-individualized-trimp-marathon].
  - Individualised TRIMP from lactate or field-test data is opt-in. Grade C.
  - **Conflict:** the sex topic found no validated sex-specific load metric. Resolution: the Banister constants are part of the formula's definition, so they stay. They are the only sex term anywhere in load arithmetic.
- **B4 No cross-scale arithmetic.**
  - Never sum or convert sRPE and TRIMP. Use one metric per fit, store its id and version, and refit when it changes. Grade C [vermeire-2021-load-quantification, chen-2002-borg-rpe-meta].
  - Metric choice moved the implied timing of peak benefit by up to 19.6 days in [vermeire-2021-load-quantification].
- **B5 Divergence.** Show a session as divergent when the sRPE and HR-load z-scores, each against the athlete's own history, differ by more than 1.5 SD, with at least 8 prior sessions. Show it; never auto-correct. Grade D [chen-2002-borg-rpe-meta].
- **B6 External load hygiene.**
  - Use the device's own distance totals and smooth speed.
  - Treat elevation as noisy and prefer barometric or map-corrected values.
  - Down-weight pace-based intensity on slow climbs. Grade D [gloersen-2018-gnss-endurance].
  - Running power: Stryd is medium confidence and other devices are low. Never mix devices within a series. Grade C [cerezuela-2020-running-power-validity].
- **B7 Monotony and strain.** Show them descriptively, flagged only against the athlete's own range. Grade C [foster-1998-monotony-strain].
- **B8 Skin tone.** Apply no correction factor. Model quality per device and recommend a chest strap. Grade B [koerber-2022-skin-tone-wrist-hr].

## (c) Zones and thresholds

- **C1 Three-domain model.** LT1/VT1 separates the moderate and heavy domains. CS separates heavy and severe. The upper boundary is a range, because RCP, MLSS and CS fall at different speeds. Never define zones as fixed percentages of HRmax when a better anchor exists. Grade C [jamnick-2020-intensity-methods, nixon-2021-cs-vs-mlss, keir-2015-exercise-intensity-thresholds].
- **C2 Anchor hierarchy.**
  1. Tested thresholds or CS.
  2. Proxies: GPS CS, DFA a1, RPE or talk test.
  3. %HRmax.
  4. %HRR, only with a reliable resting HR; it is not shown to be better than %HRmax.

  Record the source of every boundary. Grade D [mann-2013-relative-intensity].

- **C3 HRmax.**
  - With no observation, use 208 − 0.7 × age, flagged as approximate with ±10.8 bpm. Never use 220 − age. Grade A [tanaka-2001-hrmax-equation, gellish-2007-longitudinal-hrmax, nes-2013-hunt-hrmax].
  - Replace it with an observed maximum: chest strap only, from a verified maximal effort, in a rolling window, never capped to the equation (D) [shookster-2020-hrmax-accuracy].
  - Age an old measurement down by 0.7 bpm per year. Grade C.
- **C4 LT1 when untested.** Use whichever is available:
  - Z1/Z2 boundary at 82.3% of CS. This is a data-derived cut-off from one large cohort. Grade C [muniz-pumares-2025-marathon-tid].
  - HR at DFA a1 = 0.75: chest strap only, fresh state, artefacts at or below 3%, ±11 bpm. Grade C [rogers-2021-dfa-a1-aerobic-threshold, vanhooren-2023-dfa-a1-runners, rogers-2022-dfa-a1-update].
  - Borg 10-11 RPE, or the equivocal talk test. Grade D [bok-2022-subjective-intensity].
- **C5 Continuous threshold work.**
  - Well-trained athletes, bouts of 30 min or less: at or below CS − 0.5 km/h. Grade C [nixon-2021-cs-vs-mlss].
  - Everyone else: at or below CS − 1.0 km/h. This roughly matches MLSS, which sits about 1.2 km/h below CS. Grade D.
  - Never schedule sustained work at DFA a1 = 0.5 speed. Grade C [gronwald-2024-dfa-a1-prolonged].
- **C6 Intervals above CS.** Each rep lasts at most 0.5 × the estimated time to exhaustion at that speed (the D′ budget). Grade D [poole-2016-critical-power].
- **C7 Boundaries as ranges.** Band widths are ±11 bpm (DFA), ±10.8 bpm (predicted HRmax), and otherwise 5 bpm or 5% of pace (D).
- **C8 Updating.**
  - Re-estimate on rolling data.
  - Exclude fatigued, late-in-run and heat-flagged samples [rogers-2021-dfa-a1-ultramarathon-fatigue].
  - Move a boundary only after 3 concordant observations (D).
  - Re-estimate paces from fresh data after any break of 2 weeks or more [coyle-1984-detraining-time-course].
  - Watch-reported LT pace is never an anchor; it overestimates by 12.7-25.8% MAPE. Watch LT HR is advisory. Grade C [lu-2025-smartwatch-lactate-threshold].

## (d) Goal modelling and feasibility

- **D1 Goal record.** Store distance, gain and loss, surface, altitude, continuous or staged, support level, date, start time and expected weather. An ultra is any race longer than 42.2 km. Rules branch on these descriptors, not on distance alone. Grade D [scheer-2020-defining-off-road-running].
- **D2 Goal type.** Each goal is either finish-first or a time goal. Volume floors apply only to time goals. For 100 miles and beyond, the default is finish-first. Grade C [knechtle-2018-ultra-physiology-review, coates-2021-physio-determinants-ultra].
- **D3 Floors for time goals** (soft; reach them only within the limits in section g):
  - Half-marathon: more than 32 km/week and a longest run above 21 km. Grade B [fokkema-2020-half-marathon-volume-long-run].
  - Marathon: at least 40 km/week in the build block and at least one long run of 25 km or more. Grade B, low confidence.
  - Marathon peak long run: 28-32 km, 1-3 times, only for athletes already at about 50 km/week. Grade D [doherty-2020-marathon-training-meta].
  - Typical session length of about 10 km or more before weekly volume becomes the main lever. Grade C [yamaguchi-2023-volume-frequency-run-distance].
- **D4 Feasibility check** (D). From the current 30-day longest run L0 to the target long run Lt:
  - weeks needed ≈ ⌈ln(Lt/L0) / ln(1.10)⌉ × 4/3, which allows for cutback weeks, plus the taper.
  - Weekly volume to its floor uses the same formula with the weekly ramp.
  - Result is one of three labels: "comfortable", "tight" or "not reachable within default limits". The last label offers a later race, a shorter distance or a finish goal.
  - Never refuse the goal, and never exceed the limits silently.
- **D5 Ultra readiness messages.** These are non-blocking and athlete-relative: weekly distance, sessions per week, goal pace against training pace. Grade B [sewry-2022-safer-xxi-dnf]. Two notes have fixed thresholds:
  - Average under 30 km/week over the last 12 weeks. Grade D [craddock-2020-acwr-two-oceans].
  - Fewer than 3 years of regular running before a first ultra. Grade D [hoffman-2013-ultra-exercise-behavior].
  - First-timer status alone is not a risk factor. Grade C [wegelin-2010-odds-finishing-161km].
- **D6 Race heat.** If forecast or climatological race WBGT is 18 C or higher (D), the macrocycle must include an acclimation block (section i).

## (e) Macrocycle

- **E1 Model.** Traditional sequence: base, build, specific, taper, with a hard-day/easy-day week. Grade B [casado-2022-elite-runners-review, gonzalezrave-2022-reverse-periodization].
  - Reverse periodization is offered only on request, with no benefit claimed.
  - Block periodization is opt-in and experimental, for trained athletes only. Grade C [molmen-2019-block-periodization-meta-analysis].
- **E2 Phase lengths.** Build the plan backwards from race day:
  1. Taper (section k).
  2. Specific phase of 6-8 weeks. The 8-week figure comes from the 5-10 km RCT design; every other length is D [filipas-2022-pyr-pol-periodization].
  3. Build.
  4. Base takes the remainder.

  Peak volume for an ultra falls about 3 weeks before the race. Grade D, n = 1 [byrne-2024-elite-24h-training]. Do not place a large overload block directly before the taper. Grade C [aubry-2014-overreaching-before-taper].

- **E3 Recovery weeks.**
  - Default 3:1. Use 2:1 for novices, post-injury athletes, athletes with the recent-injury flag, and while a fatigue flag is active.
  - Recovery-week volume drops 20-30%, keeping some intensity and frequency. Grade D [kiely-2018-periodization-critique, foster-1998-monotony-strain].
  - **Conflict:** the periodization topic assigns 2:1 to masters. The age topic says do not cut load by age alone, because reduced training mediates age-related decline. Both are grade D. Resolution: age does not select 2:1 by itself. A masters athlete gets 2:1 when the perceived-recovery gate (j6) or another flag fires [tanaka-2008-masters-endurance, borges-2018-masters-hiit-recovery].
- **E4 TID by phase.** All values are % of running time; anchor and counting method are always shown.

  | Phase    | 5 km-10 km                                                                                     | Half/marathon                              | Ultra                         |
  | -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------- |
  | Base     | Z1 ≥80, Z2 ≤12, Z3 ~5                                                                          | same                                       | Z1 ≥85, Z3 ≤5                 |
  | Build    | 80/12/8 ±5 pp                                                                                  | 80/12/8 ±5 pp                              | Z1 ≥85                        |
  | Specific | pyramidal; polarized option for competitive athletes, block under 12 weeks, load held constant | pyramidal; race pace moves into Z2, Z2 ≤25 | Z1 ≥85; race-effort long runs |
  | Taper    | intensity kept, volume cut                                                                     | same                                       | same                          |

  Hard rules: Z1 never below 70%; Z2 time never greater than Z1 time.

  Grades:
  - Z1 floor: B [haugen-2022-world-class-runners, sperlich-2023-tid-phases, esteve-lanao-2007-tid-runners, campos-2022-tid-runners-review].
  - Threshold cap: B [rosenblat-2019-pol-vs-thr].
  - Level-based choice of polarized vs pyramidal: A [rosenblat-2025-tid-ipd-nma, oliveira-2024-pol-meta].
  - Ultra column: D [fornasiero-2018-ultra-intensity].
  - Marathon tilt: C [casado-2022-elite-runners-review, kenneally-2021-race-pace-vs-physiological].

- **E5 Fixed blocks.**
  - Strength: a 10-14 week heavy-plus-plyometric block in base and early build (A), then 1 maintenance session per week (D).
  - Gut training: 2-4 weeks inside the specific phase, ending before the race (B).
  - Heat acclimation: 7-14 days ending close to the race (A).

## (f) Microcycle and session library

**Session library**

| Type                      | Prescription                                                                                                                     | Grade, ids                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Easy                      | Z1, below LT1. The bulk of all added volume goes here.                                                                           | C [muniz-pumares-2025-marathon-tid, casado-2021-easy-run-volume]                                                         |
| Long run                  | At least 90 min every 7-14 days for half-marathon and longer, once the base allows. Mostly Z1.                                   | C [zanini-2026-long-runs-economy-durability]                                                                             |
| Long run with fast finish | Final 20% of duration at goal marathon pace, at most once every 2 weeks. Never in heat-flagged or low-fluid conditions.          | D [jones-2025-resilience-training]                                                                                       |
| Threshold                 | Continuous or cruise intervals per C5                                                                                            | C [nixon-2021-cs-vs-mlss]                                                                                                |
| Intervals                 | Above CS, reps per C6                                                                                                            | D [poole-2016-critical-power]                                                                                            |
| Race pace                 | Defined against goal pace; counted in both anchors                                                                               | C [kenneally-2021-race-pace-vs-physiological]                                                                            |
| Strides/sprints           | 5-10 short sprints inside the plyometric dose                                                                                    | A [balsalobre-2016-running-economy-highly-trained]                                                                       |
| Heavy strength            | At least 80% 1RM (90% where tolerated); 2-4 exercises × 3-4 sets × 3-6 reps (D); 2-4 week ramp-in (D); include heavy calf raises | A method / D dose [llanoslagos-2024-economy-speeds, storen-2008-maximal-strength-economy, eihara-2024-middle-aged-pt-rt] |
| Plyometrics               | 200 contacts per session or fewer (the highest dose observed in trials); emphasise when pace is 12 km/h or slower                | A [llanoslagos-2024-economy-speeds]                                                                                      |
| Hip/core block            | Before runs, for novices; 2-3 per week (dose D)                                                                                  | B [leppanen-2024-hip-core-novice]                                                                                        |
| Run-walk                  | Novices and restarts; option for marathon                                                                                        | D/C [hottenrott-2016-run-walk-marathon]                                                                                  |
| Back-to-back              | Ultra only (h3)                                                                                                                  | D                                                                                                                        |

**Spacing and placement**

- **F1 Spacing after hard work.** Allow at least 48 h after high-intensity work and 24-48 h after threshold work before the next hard session. No consecutive hard days by default. Grade C [stanley-2013-parasympathetic-reactivation, casado-2022-elite-runners-review].
- **F2 Quality sessions.** 1-2 per week, sized from a minutes budget. Zone 2 and zone 3 together take about 20% of weekly time, never more than 25%. Grade D [sylta-2014-tid-quantification, casado-2022-elite-runners-review].
  - Do not raise performance at a fixed volume by adding extra runs. Grade C [yamaguchi-2023-volume-frequency-run-distance].
- **F3 Long-run placement.** The long run does not sit between two quality days (D).
- **F4 Strength placement.** Strength sessions are at least 3 h away from key runs, preferably on easy days, and never directly before the long run. Grade A, low confidence [schumann-2022-concurrent-compatibility, wilson-2012-concurrent-interference].
- **F5 Frequency.**
  - Novices: 3 non-consecutive run days per week.
  - Runners aged 40 and over: no more than 6 run days by default, overridable. Grade D [mckean-2006-masters-injury].
- **F6 One lever at a time.** In any block, progress either intensity or volume, not both. Grade B [ramskov-2018-run-clever].

## (g) Progression and safety limits

- **G-1 Session spike guard** (the primary guard). Compare every planned run with the 30-day longest completed run:

  | Ratio to 30-day longest run | Observed hazard   | Engine behaviour                                              |
  | --------------------------- | ----------------- | ------------------------------------------------------------- |
  | 1.10× or less               | reference         | normal                                                        |
  | Above 1.10× to 2.00×        | HRR about 1.5-1.6 | warn                                                          |
  | Above 2.00×                 | HRR about 2.3     | the generator never schedules it without an explicit override |

  Do not describe the 30-100% band as safer than the 10-30% band.
  - Check against completed runs, not planned runs.
  - When the longest run is short, the minimum step is 0.5 km (D).
  - Grade B [frandsen-2025-session-spike].

- **G-2 Weekly ramp.**
  - Default is a soft 10% per week; exceeding it gives a warning.
  - Hard ceiling: 30% growth over any 2-week window. Grade C [buist-2008-graded-training, nielsen-2014-weekly-progression, damsted-2018-training-load-change].
  - Novices progress by time, with a minimum step of +1 min of running per week (D) [buist-2008-graded-training].
  - **Conflict:** the periodization topic sets 30% as a per-week ceiling; the injury and beginner topics set 30% over 2 weeks. Resolution: the stricter 2-week window wins.
- **G-3 Tightened profiles.**
  - Recent-injury flag: the 1.10× session limit becomes a hard limit, the ramp is 5-7%, and a recovery week falls every 3rd week. Grade D.
  - Prior BSI: ramp at or below 5% plus a clinician prompt. Grade A for the factor, D for the values [wright-2015-stress-fracture-meta].
  - Two or more BSI factors: the ramp drops to 50% of the default. The factors are 12 h/week or more of training, BMI below 21 (women only), menstrual disturbance, dietary restraint, prior BSI, and low BMD. Grade B for the factors, D for the cap [barrack-2014-bone-stress-triad, stennett-2025-bsi-female-offroad-runners].
- **G-4 Sex-specific limits.** No sex-specific volume or ramp limits. Sex changes only the injury-specific caution copy: bone stress and energy availability for women, Achilles for men. Grade A [hollander-2021-sex-differences].
- **G-5 ACWR is never a gate.** No ratio band blocks, caps or justifies progression.
  - If shown, it uses EWMA, is labelled descriptive, needs 4 weeks of history first (D), and is hidden in taper and recovery weeks.
  - A ratio below 0.70 may be shown as information about a return from a break.
  - Grade B/C [nakaoka-2021-acwr-runners, impellizzeri-2020-acwr-pitfalls, wang-2020-acwr-lessons, griffin-2020-acwr-systematic-review].
  - **Conflict:** the volume and ultra topics propose a soft cap at 7:28 ≥ 1.5 [toresdahl-2023-nyc-marathon-training-injury, craddock-2020-acwr-two-oceans]. Resolution: display only. The per-day OR was 1.06, a large runner cohort showed an inverse association [frandsen-2025-session-spike], and G-1 already bounds the spikes.
- **G-6 Never make up missed volume.**
  - Next week's target = min(planned target, actual last week × (1 + ramp)).
  - Skipped or downgraded sessions are not rescheduled. Grade B [vesterinen-2016-hrv-runners-rct, duking-2021-hrv-guided-meta]; the formula itself is D.
- **G-7 Symptom check-ins are secondary.** Only 6.9-11.1% of overuse injuries had a reported problem beforehand, so check-ins never replace load guards. Grade C [frandsen-2025-sudden-onset].

## (h) Ultra-specific rules

Almost nothing in this section has trial evidence. Unless a rule cites evidence, it is a labelled engine default.

- **H1 Progression priority.** For goals of 100 km or more, grow weekly volume before adding pace work. For 50 km, keep speed work. Grade C [tanda-2015-training-anthropometry-100km, coates-2021-physio-determinants-ultra].
  - The experienced-ultrarunner median of about 64 km/week is a descriptive check only, never a target. Grade C [hoffman-2013-ultra-exercise-behavior].
- **H2 Time on feet.**
  - G-1 applies to both distance and duration. Grade D [frandsen-2025-session-spike].
  - Longest single training run is capped at the lesser of 6 h or 60% of expected race duration. One opt-in race simulation of up to 8 h is allowed, and only within G-1. Grade D. No study sets these numbers; the cap is chosen to limit exposure without evidence of benefit.
- **H3 Back-to-backs** (D).
  - At most one pair every 2 weeks, in build or specific phases only, never in the taper.
  - Day 2 is no longer than day 1.
  - The pair's combined duration is no more than 1.10× the largest 2-day total in the last 30 days. This extends G-1 by analogy.
  - The pair counts as one hard block; the next day is rest or easy.
- **H4 Vertical gain and descent.**
  - Per-session gain and per-session descent follow G-1 against their own 30-day maxima, with a minimum step of 100 m. Grade D.
  - Weekly gain follows the 10% soft ramp. Grade D.
  - In the specific phase, long runs work toward the race's gain per km. Grade D.
  - Prescribe climbing effort by RPE, HR or grade-adjusted effort, never by vertical speed: at similar VO2max, maximal ascent speed was about 32% higher at 25% slope than at 10%, while relative VO2 followed power. Grade C [hingrand-2023-power-vs-ascent-speed].
  - Hiking default: power-hike on grades of about 28% and steeper; between about 12.6% and 28% the faster gait depends on climbing rate (walking was cheaper above about 12.6% at 800 m/h). Practise hiking on long runs for trail ultras. Grade C [finiel-2026-uphill-walk-run, giovanelli-2016-vk-energetics, ortiz-2017-30deg-walk-run].
  - About 550 m/h is a reference for sustained ultra climbing only, not a target or a race-average figure. Grade C [jeker-2020-vertical-speed-ultra].
- **H5 Downhill conditioning.**
  - Start graded downhill running at least 8 weeks before a hilly race, using the descent limits in H4. Grade D.
  - The first moderate downhill exposure comes at least 3 weeks before any heavy downhill session (repeated-bout protection); protection beyond 3 weeks is untested. Grade C [khassetarash-2023-rbe-downhill, mchugh-2003-repeated-bout, bontemps-2020-downhill-review].
  - Treat an unaccustomed session near the research damaging protocol (about -12% slope for 40 min) as a high-damage load; introduce descents progressively. Grade D [bontemps-2020-downhill-review].
  - Downhill running builds knee-extensor strength (9-24%) but not aerobic capacity; keep aerobic work on level or uphill terrain. Grade C [toyomura-2018-downhill-training].
  - Use eccentric-biased strength inside the strength block. Rationale: knee-extensor force fell 29-38% after 110 km [temesi-2015-female-neuromuscular-fatigue]. There is no dose evidence for the block itself (D).
- **H6 Night.** For races expected to cross darkness, schedule 1-2 headlamp rehearsal runs in the specific phase. No sleep-deprivation training: there is no evidence of benefit and it adds clear risk. Grade D.
- **H7 Fuelling practice.** Long runs rehearse the race fuel plan.
  - Floor: 30-50 g/h carbohydrate, 150-400 kcal/h, and 5-10 g/h protein, from varied foods. Grade A [tiller-2019-issn-ultra-nutrition].
  - Higher tiers: 60 g/h, then 90 g/h (multiple transportable carbohydrates), each unlocked only after the previous tier was tolerated in training. Grade C [jeukendrup-2014-cho-intake, king-2022-high-cho-gut-training].
  - 90-120 g/h is an advanced opt-in, labelled low certainty. Grade C [urdampilleta-2020-cho-120, norte-2026-graded-cho-cp].
  - Gut training: 2-4 weeks of sessions of at least 1 h at the target rate, with symptoms logged on a 0-4 scale. Stop progressing when any symptom scores 2 or more on two sessions in a row. Grade B for the block, D for the stop rule [costa-2017-gut-training, miall-2018-gut-challenge, martinez-2023-gut-training-sr].
  - Never claim gut-barrier protection. No in-race carbohydrate scaling by body mass or sex.
  - **Conflict:** the ISSN range is 30-50 g/h; physiology-based guidance says up to 90 g/h. Resolution: the tested floor is the default, and higher rates are gated by tolerance, because GI distress is the leading DNF cause (35.6% of 161 km non-finishers) [stuempfle-2015-gi-distress-wser].
- **H8 Fluid and sodium.**
  - Drink to thirst, with 450-750 mL/h as a reference range. Never produce fixed volumes beyond thirst. The ACSM 2% limit does not apply. Grade B [hewbutler-2015-eah-consensus, hoffman-2015-sodium-supplementation-eah].
  - Sodium above 575 mg/L is for comfort only, never framed as EAH prevention. Grade C.
  - Weight loss up to 3% is fine; weight gain is a red flag. Grade B [hoffman-2013-eah-hydration-161km].
- **H9 Daily diet.** Carbohydrate 5-8 g/kg/day, periodised. Protein 1.6 g/kg/day, up to 2.5. Grade A [tiller-2019-issn-ultra-nutrition, podlogar-2022-cho-new-horizons].
- **H10 Strength.** A 12-week block at 2 sessions per week with slow-speed plyometric emphasis, plus knee-extensor and plantar-flexor work. Grade C [giovanelli-2017-ultra-sep, pastor-2022-trail-determinants-distances].
- **H11 Race pacing.** Keep HR at or below VT1 for about 85% of race time and flag any planned effort above VT2. Grade C [fornasiero-2018-ultra-intensity].
- **H12 Post-race recovery.** After a race of 100 km or more: 7 days without running, then at least 7 days of reduced running, scaled up by race load. Grade D [byrne-2024-elite-24h-training].
- **H13 Heat acclimation.** As i8; required for hot ultras.

## (i) Environment

- **I1 Weather index.** WBGT from the Liljegren model, using hourly forecast temperature, humidity, pressure, wind and solar radiation. Implement it as a pure function in `shared/`.
  - Fall back to air temperature (optimum 10-17.5 C) and label which index was used.
  - Add no separate humidity or pressure penalty.
  - Grade C [liljegren-2008-wbgt-model, mantzios-2022-weather-endurance, elhelou-2012-environment-marathon].
- **I2 Optimum band.** WBGT 7.5-15 C carries no penalty. Grade C.
- **I3 Hot-side race penalty.**
  - Elite slope: 0.35% per C above 15 C (range 0.3-0.4). Grade C [mantzios-2022-weather-endurance].
  - Marathon cross-check, relative to WBGT 5-10 C: +0.8% at 10-15, +1.6% at 15-20, +2.8% at 20-25. Grade C [ely-2007-weather-marathon].
  - **Conflict:** the prediction topic derives about 0.18% per C. Resolution: in the 20-25 C band the two sources agree (2.6% vs 2.8%), so use the slope, and use the table to check marathon outputs.
  - Do not extrapolate above WBGT 25 C; show a warning instead.
- **I4 Ability multiplier.** 1.0 at a 2:30 marathon-equivalent, rising linearly to 2.0 at 4:30 or slower. Calibrate from the athlete's own logs. Grade D [ely-2007-weather-marathon, knechtle-2019-boston-weather].
  - The prediction topic's 1.5 placeholder for runners over 4 h falls inside this ramp. The ramp is the more conservative choice for pacing.
  - No sex term.
- **I5 Pacing shape in heat.** Mid-pack and slower runners get a uniformly slower target. Fast (top-quartile) runners get a conservative first half. Grade C [ely-2008-pacing-temperature].
- **I6 Ultras.**
  - Apply the penalty only to hours in daytime heat, and relax it at night. The 161 km reference is about 8% slower in a hot year. Grade C [parise-2011-161km-pacing-heat].
  - Label every heat adjustment for events over 6 h as low confidence. Grade D [bouscaren-2019-marathon-vs-ultra-heat].
- **I7 Training in heat.**
  - Above the optimum band, prescribe by RPE or an HR cap; pace is secondary.
  - Show a hydration reminder and reduce intensity on the first hot days of a season. Grade D [periard-2021-exercise-heat-stress, racinais-2015-heat-consensus].
  - Use the forecast to suggest a cooler time of day for key sessions (D).
  - Never hold a fixed HR zone in heat: HR rose 17-19% at 35 C while capacity fell [wingo-2020-drift-vo2max-heat-running].
- **I8 Heat acclimation.**
  - Trigger: race WBGT 18 C or higher (D).
  - Block: 7-14 days of daily heat exposure, minimum 5, longer if time allows.
  - Decay: 2.5% of the adaptation per day, reaching zero credit at about 40 days (the 40 days is an extrapolation).
  - Top up inside the taper; re-acclimation is 8-12 times faster than decay.
  - Acclimation may reduce the penalty by at most 50% (D).
  - Grade A [racinais-2015-heat-consensus, tyler-2016-heat-adaptation-meta, daanen-2018-acclimation-decay, periard-2015-heat-acclimation-adaptations].
- **I9 Warnings.** Warn on WBGT above 25 C, high solar load, a large rise from one day to the next, and high specific humidity. WBGT is a screening index, not a safety guarantee. Grade C [thorsson-2021-pet-vs-wbgt].
- **I10 Cold.** No numeric cold penalty; show advisory copy only. Grade D [castellani-2015-cold-stress].
- **I11 Gradient and GAP.**
  - Convert terrain to flat-equivalent effort with the Minetti cost curve, as a ratio to level cost (3.40 J/kg/m): 5.6 at +45%, 0.51 at −20%, 1.15 at −45%. The full polynomial comes from the paper's text; the abstract gives anchors only. Grade C [minetti-2002-gradient-cost, vernillo-2017-graded-running-review].
  - Cap downhill credit at the −20% minimum and treat the result as an upper bound on speed. Do not turn the downhill metabolic saving into a full pace credit; personalise the cap from the athlete's own descents. Grade C [minetti-2002-gradient-cost, genitrini-2022-downhill-pacing].
  - Late in long mountain events, descent cost rises about 13% while level and uphill cost do not; the late-race term defaults to +13% on descents in events over 6 h and is flagged low confidence. Grade C [vernillo-2015-fatigue-energy-cost].
- **I12 Altitude.** On courses above about 800 m, expect acute VO2max to fall about 6.3% per 1,000 m (range 4.6-7.5%) and adjust effort expectations and predictions approximately; acclimatisation is not modelled. Grade C [wehrlin-2006-altitude-linear].

## (j) Adaptation (weekly re-plan plus daily readiness)

- **J1 Inputs.** Completed versus planned minutes, executed versus planned TID (flag easy runs that leave Z1 by more than 5 pp, D [munoz-2014-polarized-recreational]), load, efficiency index, the daily check-in, HRV, resting HR, sleep, pain, illness, and heat.
- **J2 Subjective first.** A daily check-in (fatigue, soreness, sleep, mood, stress, illness) is the primary readiness input. HRV and resting HR only corroborate it. Grade A [saw-2016-subjective-vs-objective-monitoring].
- **J3 Daily readiness changes downgrade only.**
  - A flag can turn a hard session into an easy one or a rest day. It never adds load. Grade A [duking-2021-hrv-guided-meta, manresa-rocamora-2021-hrv-guided-meta].
  - A flag counts only when it persists for 2 days, or when 1 flagged day comes with a poor subjective score. Grade D.
  - Zones remain the intensity anchor. Grade C [ranieri-2025-racepace-hr-hrv-rct].
- **J4 HRV.**
  - Use ln RMSSD, morning or nocturnal, against a rolling 10-day mean − 1 SD, or flag a 2-day decline. Require at least 10 valid readings. Grade C [kiviniemi-2007-hrv-guided-rct].
  - The change must also exceed the device noise floor: 10% for Garmin, Polar and Whoop class devices, 6% for Oura Gen 4 class, using 7-night averages. Grade C [dial-2025-nocturnal-wearables].
  - For users with menstrual cycles, use a baseline of about 35 days and widen the band by 9 pp. Grade B/D [dejager-2026-wearable-hrv-menstrual].
  - **Conflict:** the AI-coaching topic proposed a 7-day window. Resolution: Kiviniemi's 10-day window, because it is the RCT protocol.
  - HRV alone never triggers or clears a recovery week. Grade A [bellenger-2016-autonomic-hr-meta-analysis].
- **J5 Weekly decision.**
  - **Progress** when the week was completed, no flag is active, there is no pain, and the efficiency index is stable or rising.
  - **Hold** (keep the volume, trim the next hard session) on:
    - one sustained signal;
    - completing less than 80% of planned minutes (D);
    - a sleep warning: 7-night average under 7 h or under the athlete's stated need. Grade C [walsh-2021-sleep-athlete-consensus];
    - 2 or more REDs flags;
    - the first days of heat.
  - **Reduce** (insert a recovery week) when 2 independent signals (subjective decline, efficiency decline, a sleep-efficiency drop of about 2 pp) persist for about 7 days. Grade B, low confidence [roete-2021-functional-overreaching-markers, murphy-2024-overreaching-sleep]. Illness and pain also reduce (section n).
- **J6 Masters perceived-recovery gate.** If soreness, fatigue or motivation is still worse than the athlete's own median 48 h after a hard session, defer or convert the next quality session.
  - The recovery multiplier is 1.0 by default and may rise to 1.25 only from the athlete's own data. Grade C/D [borges-2018-masters-hiit-recovery].
- **J7 Breaks.**
  - Restart volume as a fraction of the pre-break week:

    | Layoff       | Restart volume                                                                                 |
    | ------------ | ---------------------------------------------------------------------------------------------- |
    | Under 7 days | 100%                                                                                           |
    | 7-14 days    | 90%                                                                                            |
    | 15-28 days   | 75%                                                                                            |
    | Over 28 days | 50-60%, with run-walk if the athlete had under 6 months of consistent running before the break |

    Then the normal limits apply. Grade D [mujika-2000-detraining-part1, coyle-1984-detraining-time-course, zheng-2022-detraining-vo2max].

  - **Conflict:** the volume topic says 50-70% after any gap of 7 days or more. Resolution: VO2max falls only about 7% by 21 days, so halving after 7-14 days is not justified. The 50-70% figure matches the tiers above 14 days.
  - A gap of 7 days or more in the 16 weeks before a race also widens and slows the projection by 5-8%. Grade B [feely-2022-training-disruptions].
  - Model detraining as saturating: 7% by day 21, 16% by day 56, capped at 15-20%.
  - Maintenance mode: 2 runs per week, volume cut 33-66%, intensity kept, for up to 15 weeks. Grade C [spiering-2021-minimal-dose, hickson-1981-reduced-frequency].
- **J8 Fatigue states.**
  - Three states: normal, possible accumulated fatigue, persistent suppression.
  - At 14 days of unexplained decline: suggest a deload and show a clinician checklist (energy intake, iron, illness, sleep).
  - At 28 days: a stronger medical-review prompt.
  - Never diagnose OTS or NFOR.
  - Grade D [meeusen-2013-overtraining-consensus, weakley-2022-ots-systematic-review].
  - **Conflict:** the topics gave 14 days and 4 weeks. Resolution: both are used, as two escalation steps.

## (k) Taper and race week

- **K1 Length.** Never longer than 21 days.

  | Race          | Taper length                       | Grade |
  | ------------- | ---------------------------------- | ----- |
  | 5 km          | 7-10 days                          | C     |
  | 10 km         | 10 days (range 7-14)               | C     |
  | Half-marathon | 14 days                            | A     |
  | Marathon      | 21 days (14 for low-volume builds) | B     |
  | 50-100 km     | 14 days                            | D     |
  | 100 miles     | 14-21 days                         | D     |

  Sources: [bosquet-2007-taper-meta-analysis, wang-2023-taper-endurance-sr-ma, smyth-2021-marathon-taper-big-data].
  - **Conflict:** the topic gives 14 days as the default for 10 km to half-marathon and 7-10 days for 5-10 km. Resolution: 10 km takes 10 days, the overlap point.

- **K2 Volume.**
  - Mean taper volume is 0.40-0.59 of the pre-taper reference week. Grade A.
  - Weekly multipliers: 3-week taper 0.75 / 0.55 / 0.35; 2-week taper 0.65 / 0.40. Grade D.
  - Taper weeks must decrease strictly, except that 7-10 day tapers may be step tapers. Grade B [thomas-2005-taper-model-simulation].
  - Heavier builds use the longer, deeper end of the range. Grade C.
- **K3 Intensity and frequency.**
  - At least 1 quality session per week at pre-taper pace, with fewer reps. Grade A [mujika-2010-intense-training-taper].
  - Run days fall by no more than 20%. Grade B [mujika-2002-taper-frequency-middle-distance].
- **K4 Overreaching at taper start.** Use the deeper end of the volume range, flag the higher illness risk, and do not extend the taper. Grade C [aubry-2014-overreaching-before-taper].
- **K5 Taper check-in.** A weekly check-in on illness, niggles and sleep. A concern leads to rest. An HRV drop needs corroboration before any alert. Grade C/D [hug-2014-taper-marathon-hrv, timpka-2020-health-complaints-heat-taper].
- **K6 Race week.**
  - For races of 90 min or more: 8-10 g/kg/day of carbohydrate in the final 24-48 h, with little running. Grade C [bussau-2002-carb-loading-one-day].
  - Heat top-up per I8.
  - Ultra fuel plan per H7, plus the EAH safety card (n).
  - Marathon pacing warning when the first half is faster than 94% of CS. Grade C [smyth-2020-cs-training-data, smyth-2018-pacing-start-end].
- **K7 Expected benefit.** Describe it as about 0.5-3%, as a sketch. The 2.6% marathon cohort median is an association, not a promise. Grade D.

## (l) Performance prediction with uncertainty

- **L1 Model hierarchy.**
  - Personal exponent or a two-parameter model when 2 or more races at different distances exist. Grade C [blythe-2016-individual-prediction, emig-2020-big-data, peronnet-1989-running-model].
  - Riegel with exponent 1.06 only for targets up to 21.1 km. Grade C [vickers-2016-race-times].
  - CP or CS fits only from efforts spanning 3-30 min; validated extrapolation reaches 60 min. Grade C [ruizalias-2023-long-duration-power].
  - Refit on a rolling 8-12 week window. Grade D [emig-2020-big-data].
- **L2 Marathon.**
  - From a single anchor of 21.1 km or shorter: add a 3% placeholder slowdown. Grade D.
  - The interval half-width is at least 6% of the predicted time. Reported errors are 5.9%, 7.7-8.0%, and 5.2% with durability added. Grade C [oficial-casado-2026-valencia-vdot, smyth-2022-durability-decoupling].
  - Target pace prior: 93% of CS at 150 min, falling to 79% at 360 min. Low-decoupling runners about 0.88 of CS, high-decoupling about 0.82. Grade C.
  - Decoupling bands: low below 1.1, moderate 1.1-1.2, high 1.2 or more; onset at 1.025. Grade C.
- **L3 Covariates.** Sex, age, BMI, weekly distance, tempo share, course and weather. Use at least 2 sources for any prediction. Grade A/C [keogh-2019-marathon-prediction-equations].
- **L4 Ultras.**
  - Anchor on the marathon PB and prior ultra results, plus weekly km, training pace and longest run. Grade D [knechtle-2011-100km-predictors, knechtle-2011-24h-ultra, knechtle-2010-100km-predictors].
  - Show a wide range; never hard-code a published equation.
- **L5 Trail.** Do not transfer road CS directly to trail targets: the classic road model explains trail performance less well. Widen the interval by 50% (the amount is D) and let it grow with gain per km. Grade A for widening, D for the amount [dewaal-2021-trail-physiology-sr, ehrstrom-2018-short-trail].
- **L6 Minimum band.** Every model-based forecast carries at least ±3% until running back-tests exist. Grade C [busso-2023-impulse-response-validity].
- **L7 Back-testing.** Log every prediction and the actual result, and recalibrate per athlete. Grade D.

## (m) Personalization verdicts

| Factor         | Adjust                                                                                                          | By how much                                                                                           | Not supported                                                                                                 | Grade, ids                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Age            | HRmax prior; long-term projection; masters recovery gate; strength and posterior chain                          | 208 − 0.7 × age; −0.7%/yr after 35 (0.5-1.0); ×1.5 after 70; ultra flat to 50                         | Age-based cuts to volume, quality or ramp; age-grade targets                                                  | A/C/D [tanaka-2001-hrmax-equation, ganse-2020-longitudinal-masters, lepers-2021-sub3-marathon-decades, knechtle-2012-100km-age, stones-2019-age-differences-marathon] |
| Sex            | Banister b; BSI/REDs vigilance; weak durability prior; HRV caveat                                               | b 1.67 vs 1.92; decoupling prior 0.05 lower for women                                                 | Cycle-phase or contraceptive multipliers; sex-specific zones, recovery, taper or volume limits; sex-based CHO | A/C/D [mcnulty-2020-menstrual-cycle-performance, elliottsale-2020-oral-contraceptives-performance, hollander-2021-sex-differences, smyth-2022-durability-decoupling]  |
| Body mass      | Daily CHO and protein (g/kg); prediction covariate; BSI flag BMI below 21 (women); novice flag BMI above 30     | per rules                                                                                             | In-race CHO scaling; device kcal; calorie targets                                                             | A/C [tiller-2019-issn-ultra-nutrition, barrack-2014-bone-stress-triad, kluitenberg-2015-nlstart2run]                                                                  |
| Experience     | Novice profile; ultra notes; volume-first above 100 km                                                          | 2.3× hazard per hour; run-walk; hip/core                                                              | First-timer as a risk factor                                                                                  | A/B [videbaek-2015-incidence, leppanen-2024-hip-core-novice]                                                                                                          |
| Injury history | Tightened profiles; BSI return timelines                                                                        | 1.10× hard; ramp 5-7% (≤5% after BSI); 44/56/107/127 days by site                                     | Treating the 10% rule as prevention                                                                           | A/D [hulme-2017-risk-protective, hoenig-2023-bsi-return-to-sport]                                                                                                     |
| Temperature    | Race and session pacing; acclimation                                                                            | 0.35%/C above 15 C WBGT × 1.0-2.0                                                                     | Cold penalty; humidity on top of WBGT; HR zones in heat                                                       | A/C/D [ely-2007-weather-marathon, daanen-2018-acclimation-decay]                                                                                                      |
| Heart rate     | Zones, TRIMP, decoupling, efficiency                                                                            | per sections b and c                                                                                  | Optical HR on trails; 220 − age; watch LT; HR-only readiness                                                  | A/C [navalta-2020-trail-running-hr, lu-2025-smartwatch-lactate-threshold]                                                                                             |
| Intensity      | TID by phase and level                                                                                          | 80/12/8 ±5; Z1 ≥70                                                                                    | Claims that polarized is superior; threshold-dominant weeks                                                   | A/B [rosenblat-2025-tid-ipd-nma]                                                                                                                                      |
| Speed          | CS anchors, thresholds, marathon fraction                                                                       | CS − 0.5 or 1.0 km/h; 0.94 CS first-half warning                                                      | Device VO2max paces                                                                                           | A/C [smyth-2020-cs-training-data]                                                                                                                                     |
| Distance       | Spike guard; floors; taper length                                                                               | 1.10×; 32 and 40 km/week                                                                              | ACWR gates                                                                                                    | B [frandsen-2025-session-spike, fokkema-2020-half-marathon-volume-long-run]                                                                                           |
| Duration       | Long-run staple; ultra guard on time                                                                            | ≥90 min; 1.10× on time                                                                                | Drift inference beyond 3 h                                                                                    | C/D [zanini-2026-long-runs-economy-durability, mattsson-2011-late-drift-ultra]                                                                                        |
| Elevation      | GAP via Minetti; vert spike rule; hiking default on steep grades; downhill priming; altitude effort expectation | 0.51 floor; 1.10×, minimum 100 m; hike ≥ about 28%; priming ≥ 3 weeks ahead; −6.3% VO2max per 1,000 m | Prescribing by vertical speed; full downhill pace credit; acclimatisation modelling                           | C/D [minetti-2002-gradient-cost, hingrand-2023-power-vs-ascent-speed, khassetarash-2023-rbe-downhill, wehrlin-2006-altitude-linear]                                   |
| Sleep/HRV      | Downgrade-only readiness; supporting overreaching signal                                                        | 10-day −1 SD plus noise floor; under 7 h warning; −2 pp efficiency                                    | HRV as sole trigger; adolescent 8 h cut-off; adding load from high HRV                                        | A/C [bellenger-2016-autonomic-hr-meta-analysis, milewski-2014-sleep-injury, dial-2025-nocturnal-wearables]                                                            |

## (n) Red flags and disclaimer

The app must surface each of these. It states facts and points to care; it does not diagnose or prescribe treatment.

1. **Focal bone pain or point tenderness.** Stop progression and recommend medical assessment.
   - High-risk BSI sites (femoral neck, navicular, anterior tibia, fifth metatarsal) require a date entered by a clinician before any running is generated.
   - After that, the return is walk-run, distance before intensity. Grade A/C/D [hoenig-2023-bsi-return-to-sport, george-2024-tibial-bsi-return-to-run, barrack-2014-bone-stress-triad].
2. **Pain that changes gait, or any injury report.** Hold progression and apply the recent-injury profile. Grade D.
3. **Illness symptoms.** Suspend intensity sessions. Return with 1 symptom-free day, then 3 easy days before any intensity. Never infer illness from HRV or resting HR alone. Grade D [snyders-2022-respiratory-illness-rts, schwellnus-2016-load-illness-ioc].
4. **REDs signs.** Unintended weight loss, menstrual dysfunction, recurrent BSI or illness, persistent fatigue, GI symptoms, disordered eating.
   - Screen all users at onboarding and every 12 weeks, including men on ultra plans. Offer the LEAF-Q to women.
   - Two or more flags hold progression and show a clinician prompt.
   - Grade A/C/D [mountjoy-2023-reds-consensus, melin-2014-leaf-q, hoeg-2022-ultramarathon-triad].
5. **Possible iron deficiency.** Fatigue or underperformance for 2 weeks at stable load: suggest blood testing through a clinician. Give no supplement advice. Grade D [sim-2019-iron-athlete, burden-2015-iron-treatment-meta].
6. **Persistent suppression.** Per J8. No overtraining diagnosis.
7. **EAH.** Nausea, headache, confusion, swelling or weight gain means seek medical care and do not drink more. Show a stronger alert for events over 17 h or in heat. Grade A [hewbutler-2015-eah-consensus, hewbutler-2017-eah-update].
8. **Heat.** WBGT above 25 C, high solar load, or the first hot days of a season (I9).
9. **Postpartum symptoms.** Pelvic heaviness, leaking or pain pause progression and refer to a pelvic health professional. Postpartum progression is gated by symptoms, not dates. Grade C/D [deering-2024-postpartum-return-to-running, moore-2021-postpartum-return-to-running].
10. **Cardiac symptoms.** Chest pain, fainting or palpitations during exercise mean stop and seek care. This is a safety convention; no study in the corpus covers it. Grade D.

**Disclaimer** (shown at onboarding, on every plan and on every race plan):

> This plan is a sketch built from published research on groups of runners and from conservative defaults where research is missing. It cannot guarantee safety or performance, and it is not medical, nutrition or injury advice. Stop and see a qualified clinician for pain, illness or the warning signs listed. Many numbers are defaults that should change with your own experience, and the app shows which ones.

---

## Numeric parameter table

| Parameter                               | Default                                   | Range                                | Grade | ids                                                                                        |
| --------------------------------------- | ----------------------------------------- | ------------------------------------ | ----- | ------------------------------------------------------------------------------------------ |
| Z1 time share                           | 80%                                       | floor 70; ultra ≥85                  | B/D   | haugen-2022-world-class-runners, sperlich-2023-tid-phases, fornasiero-2018-ultra-intensity |
| TID prior Z1/Z2/Z3                      | 80/12/8                                   | ±5 pp                                | C     | esteve-lanao-2007-tid-runners, sperlich-2023-tid-phases                                    |
| Z2 cap                                  | 12% base                                  | 25% any phase                        | B     | rosenblat-2019-pol-vs-thr                                                                  |
| Z3 share                                | 8%                                        | 5-10; ultra ≤5                       | C/D   | esteve-lanao-2007-tid-runners                                                              |
| Quality time budget                     | 20%                                       | max 25                               | D     | sylta-2014-tid-quantification                                                              |
| Polarized block length                  | under 12 weeks                            | —                                    | A     | oliveira-2024-pol-meta                                                                     |
| Quality sessions per week               | 1-2                                       | —                                    | D     | casado-2022-elite-runners-review                                                           |
| Spacing after hard work                 | 48 h (HIT)                                | 24-48 h (threshold)                  | C     | stanley-2013-parasympathetic-reactivation                                                  |
| Executed vs planned TID flag            | 5 pp                                      | —                                    | D     | munoz-2014-polarized-recreational                                                          |
| sRPE prompt delay                       | 30 min                                    | —                                    | D     | foster-2001-session-rpe                                                                    |
| TRIMP exponent b                        | 1.92 M / 1.67 F                           | —                                    | D     | wallace-2014-load-methods-runners                                                          |
| sRPE/HR divergence                      | 1.5 SD                                    | ≥8 prior sessions                    | D     | chen-2002-borg-rpe-meta                                                                    |
| EWMA acute/chronic                      | 7 / 42 days                               | user-adjustable                      | D     | murray-2017-ewma-acwr                                                                      |
| FFM minimum data                        | 20 observations / 12 weeks                | —                                    | D     | busso-2006-modeling-training-planning                                                      |
| FFM interval-width flag                 | 25 days                                   | —                                    | C     | hellard-2006-banister-limitations                                                          |
| HRmax prior                             | 208 − 0.7 × age                           | ±10.8 bpm                            | A     | tanaka-2001-hrmax-equation, nes-2013-hunt-hrmax                                            |
| HRmax drift                             | 0.7 bpm/yr                                | 5-7 bpm/decade                       | C     | gellish-2007-longitudinal-hrmax, pollock-1997-older-track-athletes                         |
| CS inputs                               | ≥3 efforts, 400-5000 m, 90 days           | —                                    | C/D   | smyth-2020-cs-training-data                                                                |
| Threshold margin below CS               | 0.5 km/h (well-trained)                   | 1.0 km/h otherwise                   | C/D   | nixon-2021-cs-vs-mlss                                                                      |
| LT1 proxy                               | 82.3% of CS                               | —                                    | C     | muniz-pumares-2025-marathon-tid                                                            |
| DFA a1 VT1                              | 0.75                                      | artefacts ≤3%; ±11 bpm               | C     | rogers-2021-dfa-a1-aerobic-threshold, vanhooren-2023-dfa-a1-runners                        |
| RPE anchors (Borg)                      | VT1 10-11                                 | RCP 13-15                            | D     | bok-2022-subjective-intensity                                                              |
| Rep fraction of time to exhaustion      | ≤0.5                                      | —                                    | D     | poole-2016-critical-power                                                                  |
| Boundary band                           | 5 bpm / 5% pace                           | —                                    | D     | faude-2009-lactate-thresholds                                                              |
| Comparable observations before a change | 3                                         | —                                    | D     | hecksteden-2015-individual-response                                                        |
| Session spike ratio                     | 1.10                                      | warn above 1.10; override above 2.00 | B     | frandsen-2025-session-spike                                                                |
| Minimum step                            | 0.5 km; +1 min/week (novices); 100 m gain | —                                    | D     | frandsen-2025-session-spike                                                                |
| Weekly ramp                             | 10% soft                                  | ceiling 30% over 2 weeks             | C     | buist-2008-graded-training, nielsen-2014-weekly-progression                                |
| Flagged-runner ramp                     | 5-7%                                      | ≤5% after BSI                        | D     | hulme-2017-risk-protective, wright-2015-stress-fracture-meta                               |
| BSI factor cap                          | 50% of default at ≥2 factors              | —                                    | B/D   | barrack-2014-bone-stress-triad                                                             |
| Recent injury window                    | 12 months                                 | —                                    | D     | hulme-2017-risk-protective                                                                 |
| Recovery cycle                          | 3:1                                       | 2:1 when flagged                     | D     | kiely-2018-periodization-critique                                                          |
| Recovery week cut                       | 20-30%                                    | —                                    | D     | foster-1998-monotony-strain                                                                |
| Low ACWR info / display warm-up         | 0.70 / 4 weeks                            | display only                         | C/D   | nakaoka-2021-acwr-runners, wang-2020-acwr-lessons                                          |
| Gap flag                                | 7 days in 16 weeks                        | +5-8% projection                     | B     | feely-2022-training-disruptions                                                            |
| Restart fractions                       | 100/90/75/50-60%                          | by layoff tier                       | D     | mujika-2000-detraining-part1                                                               |
| Detraining curve                        | 7% at 21 days; 16% at 56 days             | cap 15-20%                           | C     | coyle-1984-detraining-time-course, zheng-2022-detraining-vo2max                            |
| Maintenance mode                        | 2 runs/wk; −33-66%                        | ≤15 weeks                            | C     | spiering-2021-minimal-dose                                                                 |
| Long-run staple                         | ≥90 min                                   | every 7-14 days                      | C     | zanini-2026-long-runs-economy-durability                                                   |
| Fast-finish long run                    | final 20% at marathon pace                | ≤1 per 2 weeks                       | D     | jones-2025-resilience-training                                                             |
| Half-marathon floors                    | 32 km/wk; long run 21 km                  | —                                    | B     | fokkema-2020-half-marathon-volume-long-run                                                 |
| Marathon floors                         | 40 km/wk; long run ≥25 km                 | peak 28-32 km                        | B/D   | fokkema-2020-half-marathon-volume-long-run, doherty-2020-marathon-training-meta            |
| Strength frequency                      | 2 per week                                | 2-3; maintenance 1                   | A/D   | blagrove-2018-strength-determinants                                                        |
| Strength block                          | 10-14 weeks                               | minimum 8                            | A     | eihara-2022-heavy-vs-plyo                                                                  |
| Heavy load                              | ≥80% 1RM                                  | up to 90%                            | A     | llanoslagos-2024-economy-speeds                                                            |
| Plyometric contacts                     | ≤200 per session                          | —                                    | A     | balsalobre-2016-running-economy-highly-trained                                             |
| Strength separation from key runs       | ≥3 h                                      | —                                    | A     | schumann-2022-concurrent-compatibility                                                     |
| Masters run days                        | ≤6 per week                               | —                                    | D     | mckean-2006-masters-injury                                                                 |
| Taper length                            | 7-10 / 10 / 14 / 21 days                  | ultra 14-21                          | A/B/D | bosquet-2007-taper-meta-analysis, smyth-2021-marathon-taper-big-data                       |
| Taper mean volume                       | 0.40-0.59                                 | —                                    | A     | wang-2023-taper-endurance-sr-ma                                                            |
| Taper weekly multipliers                | 0.75/0.55/0.35                            | 2-week: 0.65/0.40                    | D     | spilsbury-2015-elite-runner-taper-survey                                                   |
| Taper frequency cut                     | ≤20%                                      | —                                    | B     | mujika-2003-taper-scientific-bases                                                         |
| Carbohydrate loading                    | 8-10 g/kg/day                             | final 24-48 h                        | C     | bussau-2002-carb-loading-one-day                                                           |
| WBGT optimum band                       | 7.5-15 C                                  | —                                    | C     | mantzios-2022-weather-endurance                                                            |
| Heat slope                              | 0.35%/C                                   | 0.3-0.4                              | C     | mantzios-2022-weather-endurance                                                            |
| Marathon heat table                     | +0.8 / +1.6 / +2.8%                       | WBGT 10-25 C                         | C     | ely-2007-weather-marathon                                                                  |
| Heat ability multiplier                 | 1.0-2.0                                   | —                                    | D     | ely-2007-weather-marathon                                                                  |
| Acclimation trigger / block             | WBGT ≥18 C / 7-14 days                    | minimum 5 days                       | D/A   | racinais-2015-heat-consensus, tyler-2016-heat-adaptation-meta                              |
| Acclimation decay                       | 2.5%/day                                  | zero credit at 40 days               | A/D   | daanen-2018-acclimation-decay                                                              |
| Acclimation discount                    | ≤50%                                      | —                                    | D     | periard-2015-heat-acclimation-adaptations                                                  |
| Durability heat flag / body-mass loss   | 25 C / 2%                                 | —                                    | D/C   | wingo-2020-drift-vo2max-heat-running, montain-1992-dehydration-drift                       |
| Threshold decline at 90 min             | 5.5%                                      | spread about 4-6                     | C     | hunter-2025-marathoners-durability-slt                                                     |
| HR drift at 90 min (easy)               | 5.5%                                      | —                                    | C     | nuuttila-2025-recreational-runners-durability                                              |
| Decoupling bands                        | <1.1 / 1.1-1.2 / ≥1.2                     | onset 1.025                          | C     | smyth-2022-durability-decoupling                                                           |
| Drift inference limit                   | 180 min                                   | —                                    | D     | mattsson-2011-late-drift-ultra                                                             |
| Marathon first-half warning             | 0.94 × CS                                 | —                                    | C     | smyth-2020-cs-training-data                                                                |
| Marathon fraction of CS                 | 0.93 at 150 min → 0.79 at 360 min         | —                                    | C     | smyth-2020-cs-training-data                                                                |
| Riegel exponent                         | 1.06, targets ≤21.1 km                    | —                                    | C     | vickers-2016-race-times                                                                    |
| Single-anchor marathon slowdown         | +3%                                       | —                                    | D     | vickers-2016-race-times                                                                    |
| Marathon interval                       | ±6% minimum                               | —                                    | C     | oficial-casado-2026-valencia-vdot                                                          |
| Forecast minimum band                   | ±3%                                       | —                                    | C     | busso-2023-impulse-response-validity                                                       |
| Trail interval widening                 | +50%                                      | —                                    | D     | ehrstrom-2018-short-trail                                                                  |
| Downhill cost floor                     | 0.51 at −20%                              | —                                    | C     | minetti-2002-gradient-cost                                                                 |
| Level running cost                      | 3.40 J/kg/m                               | —                                    | C     | minetti-2002-gradient-cost                                                                 |
| Late-race descent cost                  | +13% (events over 6 h)                    | —                                    | C     | vernillo-2015-fatigue-energy-cost                                                          |
| Hiking default grade                    | ≥ 28%                                     | 12.6-28% by climb rate               | C     | finiel-2026-uphill-walk-run, giovanelli-2016-vk-energetics                                 |
| Ultra climbing reference                | about 550 m/h                             | reference only                       | C     | jeker-2020-vertical-speed-ultra                                                            |
| Downhill priming lead                   | ≥ 3 weeks                                 | —                                    | C     | khassetarash-2023-rbe-downhill                                                             |
| Altitude VO2max decline                 | 6.3% per 1,000 m                          | 4.6-7.5; from about 800 m            | C     | wehrlin-2006-altitude-linear                                                               |
| Race carbohydrate                       | 30-50 g/h; 150-400 kcal/h                 | tiers 60 → 90 → 120                  | A/C   | tiller-2019-issn-ultra-nutrition, jeukendrup-2014-cho-intake                               |
| Daily CHO / protein                     | 5-8 / 1.6 g/kg                            | protein up to 2.5                    | A     | tiller-2019-issn-ultra-nutrition                                                           |
| Fluid                                   | thirst-led                                | 450-750 mL/h                         | B     | hewbutler-2015-eah-consensus                                                               |
| Sodium                                  | >575 mg/L                                 | —                                    | C     | tiller-2019-issn-ultra-nutrition                                                           |
| Weight-loss tolerance                   | ≤3%                                       | —                                    | B     | hoffman-2013-eah-hydration-161km                                                           |
| EAH alert                               | events over 17 h                          | —                                    | A     | hewbutler-2017-eah-update                                                                  |
| Gut training                            | 2-4 weeks, ≥1 h sessions                  | step +10 g/h                         | B/D   | costa-2017-gut-training                                                                    |
| GI progression stop                     | score ≥2 on 2 sessions in a row           | —                                    | D     | martinez-2023-gut-training-sr                                                              |
| Ultra notes                             | <30 km/wk; <3 years running               | —                                    | D     | craddock-2020-acwr-two-oceans, hoffman-2013-ultra-exercise-behavior                        |
| Ultra race time below VT1               | about 85%                                 | —                                    | C     | fornasiero-2018-ultra-intensity                                                            |
| Longest ultra training run              | min(6 h, 0.6 × race duration)             | opt-in 8 h                           | D     | none                                                                                       |
| Back-to-back pair                       | ≤1 per 2 weeks; 2-day total ≤1.10×        | —                                    | D     | frandsen-2025-session-spike (by analogy)                                                   |
| Post-ultra recovery                     | 7 days off + ≥7 days reduced              | —                                    | D     | byrne-2024-elite-24h-training                                                              |
| HRV baseline                            | 10-day mean − 1 SD                        | ≥10 readings; 35 days with cycles    | C/D   | kiviniemi-2007-hrv-guided-rct, dejager-2026-wearable-hrv-menstrual                         |
| HRV noise floor                         | 10% / 6%                                  | 7-night average                      | C     | dial-2025-nocturnal-wearables                                                              |
| Readiness persistence                   | 2 days                                    | or 1 day + poor subjective score     | D     | saw-2016-subjective-vs-objective-monitoring                                                |
| Adaptive recovery trigger               | 2 signals for about 7 days                | —                                    | B/D   | roete-2021-functional-overreaching-markers                                                 |
| Sleep warning / efficiency drop         | 7-night average <7 h / −2 pp              | —                                    | C/B   | walsh-2021-sleep-athlete-consensus, murphy-2024-overreaching-sleep                         |
| Illness return                          | 1 symptom-free day + 3 easy days          | —                                    | D     | snyders-2022-respiratory-illness-rts                                                       |
| Suppression escalation                  | 14 / 28 days                              | —                                    | D     | meeusen-2013-overtraining-consensus                                                        |
| REDs hold / rescreen                    | 2 flags / 12 weeks                        | —                                    | D/C   | mountjoy-2023-reds-consensus, melin-2014-leaf-q                                            |
| Age decline                             | 0.7%/yr after 35                          | 0.5-1.0; ×1.5 after 70               | C     | ganse-2020-longitudinal-masters, lepers-2021-sub3-marathon-decades                         |
| Masters recovery multiplier             | 1.0                                       | 1.0-1.25                             | D     | borges-2018-masters-hiit-recovery                                                          |
| Ultra age-neutral until                 | 50 years                                  | —                                    | C     | knechtle-2012-100km-age                                                                    |
| BSI earliest return                     | 44 / 56 / 107 / 127 days                  | by site                              | A     | hoenig-2023-bsi-return-to-sport                                                            |
| Novice run-walk                         | 3 days/wk, 6 weeks, run:walk 1:2          | —                                    | D     | kluitenberg-2015-nlstart2run                                                               |
| Cycle-phase load multiplier             | 1.0                                       | —                                    | A     | mcnulty-2020-menstrual-cycle-performance                                                   |

## Top 10 evidence gaps

1. There are no training trials (TID, volume, long run, back-to-backs, taper) in 50 km to 100-mile runners. The whole ultra section is extrapolated or convention.
2. Terrain evidence is thin: no dose data for vert progression or downhill conditioning, no trail-technicality penalty, no race-average vert/h, and the downhill pace-credit cap is unquantified.
3. The session-spike rule rests on one observational cohort. No RCT exists, and duration, gain and heat spikes are untested.
4. Nothing compares 3:1 with 2:1 recovery cycles or tests cutback size, and recovery time after long runs and ultras is unknown.
5. The Banister TRIMP sex constants and formula are unverified, and hrTSS and wearable load have no ultra-duration validation.
6. No model predicts 50 km to 100-mile trail times with a stated error, and no prediction interval has been calibrated.
7. No study shows that within-athlete changes in free-living drift or decoupling track changes in fitness.
8. The heat ability multiplier, the acclimation pace discount, ultra-specific heat slopes and the cold-side slope are missing.
9. Women and masters runners are under-represented across load, durability, strength and readiness evidence. Nothing covers runners over 50 or perimenopausal runners.
10. No trial shows that adaptive or AI-adjusted running plans (HRV- or wellness-driven) beat fixed plans for performance or injury over a season.

## What would change these rules

- **An RCT of session-spike capping.** It would turn G-1 into a causal rule or demote it, and it would set the values for H2 and H3.
- **Ultra TID or volume trials, or a validated position stand (for example from Scheer or Millet).** They would replace the grade D ultra values for Z1, time on feet, back-to-backs and taper.
- **Verified Banister source text, or a runner study of sex-specific TRIMP.** It would confirm or remove the only sex term in load.
- **Running studies of downhill and eccentric dose.** They would replace H4 and H5.
- **A cycle-length trial (3:1 vs 2:1), or masters recovery data in runners.** It would replace E3 and J6.
- **A calibrated ultra or trail prediction model, or an ITRA/UTMB index validation.** It would replace L4, L5 and the 50% widening.
- **Ultra 90-120 g/h fuelling RCTs.** They would move the H7 tiers and possibly the default.
- **Season-long trials of wearable-guided adaptation.** They would set the HRV windows and thresholds and could promote readiness beyond downgrade-only.
- **Published per-ability heat slopes and acclimation pace effects.** They would replace I4 and the I8 discount.
- **Running evidence on retraining speed and restart fractions.** It would replace the J7 tiers.
