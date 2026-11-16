# Road racing: half marathon and marathon pacing, fuel, heat and fluid

Pass of 2026-11-16 for decision D11 (owner decision D11, 2026-11-14: a road race plan for the half
marathon and the marathon needs a research pass on road pacing, fuel and heat; the design questions
of 2026-11-16 put the pass before the engine PR). Nineteen papers were added, each looked up in
Crossref (title, journal, year, authors, correction notices) and read as an abstract on Europe PMC
or PubMed on 2026-11-16. No full text was read. Findings are the abstracts' own statements; where an
abstract states no number, none is recorded here.

This topic changes no rule and no `Param`. It maps each block of the planned road plan (design
`design-d11-road-race-plan`, section 1) to the papers that bear on it and names what stays
unsupported, so that the engine PR can add a rule and a graded `Param` only where a paper is named.

## Block by block

### Expected time and average pace

Supported by the prediction papers already in the topics `performance-prediction` and
`terrain-elevation`; this pass adds nothing to the range itself. For the pace sentence the corpus
now holds three road-race records of the same direction.

- Marathoners slow in the second half at every level, and variability of speed is lower in faster
  finishers: 190,228 New York finishers, coefficient of variation of 5-km speed 7.8% and 6.6% in the
  top men and women against 8.3 to 14.4% in the rest [santos-lozano-2014-nyc-marathon-pacing].
- A first or a last stretch run too fast went with a slower finish in 1.7 million recreational
  marathon runners [smyth-2018-pacing-start-end].
- Older, female and faster runners paced better (last 9.7 km against the first 32.5 km), in the cool
  [march-2011-marathon-pacing-age-sex-time].
- The half marathon is paced more evenly than the marathon in a mass-participation field: average
  change of speed across five segments was 3.60% (men) and 3.36% (women) in the half against 5.46%
  and 4.12% in the marathon [cuk-2020-sex-pacing-half-marathon-marathon].

Grade C throughout (observational, retrospective results). What stays unsupported: a best shape.
Nothing here compares even and negative splits with randomised or matched assignment, and the
records are finish-list data with no effort measure. The plan states no split and no pace per
kilometre.

### First half (marathon only)

The one number is the K6 line already in the corpus: a first half above about 94% of critical speed
went with a second half more than a quarter slower in more than 25,000 recreational marathoners
[smyth-2020-cs-training-data] (question 10 of 2026-11-16: it rests on that paper). The new records
support the wording and its limit to the marathon: the half marathon is paced more evenly
[cuk-2020-sex-pacing-half-marathon-marathon], and the typical slowing is about 3 to 4% at 10 km
against 10 to 13% in the marathon [cuk-2021-pacing-10km-marathon]. So the line belongs on the
marathon and not on the half. Still unsupported: a first-half threshold by finishing time other than
the CS fraction, a second paper that repeats the 94% figure, and any threshold for the half.

### Heat

Marathon. The corpus holds the time cost by finishing time: Ely 2007 gives the progressive slowing
from WBGT 5 to 25 C, more for slower runners [ely-2007-weather-marathon]; Ely 2008 and Trubee 2014
bear on the shape [ely-2008-pacing-temperature][trubee-2014-heat-sex-pacing-marathon]; the median
finisher of six major marathons slowed in most races when it was hotter, with no slope stated
[llewellyn-2025-air-temperature-marathon-time]; the safety side is Roberts 2010 (unsuccessful starts
rose from a start WBGT of about 13 C, mass-casualty events at 21 to 22 C)
[roberts-2010-do-not-start-wbgt-marathon].

The studies disagree on the shape. Ely 2008 finds the slower runners' larger loss comes from a slower
speed throughout, not a greater late deceleration [ely-2008-pacing-temperature]; Trubee 2014 finds
heat an independent element of late-race slowing in the field, and magnified for non-elite men
against non-elite women, in one hot and one cold race [trubee-2014-heat-sex-pacing-marathon]. Both are
observational and small in races, so the rule I5 (a uniform slow-down for mid-pack runners) is neither
confirmed nor contradicted. The conservative reading is the existing one: no pacing shape.

Half marathon. One record: at the Great North Run, 2006 to 2019, temperature and heat index
significantly slowed amateur finishers, and the slowest amateurs more than the quickest
[hodgson-2022-great-north-run-heat-pollution]. The abstract states no slope. This is the only half
marathon source in the corpus, and it is directional. A per-degree road-race time cost for the half
is therefore unsupported; the plan can show the model's heat difference (an existing output) and the
direction, and should not state a half-specific figure.

10 km. Nothing was found that gives a time cost by temperature for 10 km. An 11.3 km warm road race
(Falmouth) records pacing and body temperature, not a time cost per degree
[adams-2017-falmouth-pace-deviation]. The heat block for a 10 km goal rests on the same existing
heat rules (I2, I3) and no 10 km paper.

### Fuel

What a carbohydrate rate rests on, by race length:

- About 1 h of hard running: the systematic review finds the gain comes from oral receptors, with
  dose and absorption irrelevant, and the benefit rises with exercise time
  [stellingwerff-2014-cho-supplementation-durations]. The one half-marathon trial found no significant
  gain from 1.1 g/kg of gel over placebo in a race of about 74 minutes and an impairment in the three
  runners with stomach trouble [burke-2005-half-marathon-gel].
- About 110 minutes (the under-2-hour half band): a crossover of 15 runners took 60 g/h (gel arms)
  or a 6% drink and finished in about 110 minutes; race time did not differ with fluid volume. No arm
  went without carbohydrate [lee-2014-half-marathon-fluid-cho]. That is tolerance, not benefit.
- Longer than 2 h: the review points to high delivery (above 90 g/h) when glycogen is stressed
  [stellingwerff-2014-cho-supplementation-durations]; the consensus-conference review gives
  30 to 60 g/h for longer events and up to 90 g/h above 2.5 h [burke-2011-cho-training-competition]; a
  small treadmill trial of a 3 h 10 min marathon-length effort held speed and finished about 2% faster
  on a 5.5% drink [tsintzas-1995-cho-drinks-marathon]. Existing ultra papers set the tolerated
  ladder [jeukendrup-2014-cho-intake][tiller-2019-issn-ultra-nutrition].
- The day before: more than 7 g/kg went with faster marathon speed in 257 London runners
  [atkinson-2011-prerace-carbohydrate-marathon], below the K6 8 to 10 g/kg line and in the same
  direction.
- Tolerance: about one in four recreational marathoners reported moderate stomach symptoms during the
  race, with no association with intake in the diaries [pugh-2018-marathon-gi-symptoms-recreational].

Answer to design question 5 (a half marathon under 2 hours): this pass finds no road study that
supports a carbohydrate rate for the band. The nearest sources are a null result at about 74 minutes,
a tolerance crossover at about 110 minutes and a review that has no statement between 1 h and 2 h.
The recommendation of the design stands: no rate for a half under two hours, and the engine PR adds
no `Param` for it. What also stays unsupported: a marathon-pace rate for a 3 to 5 h finisher from a
road trial, a dose-response in the 2 to 3 h band, fuel timing in a road marathon, and gut training
in road runners.

### Fluid and hyponatraemia

Overdrinking drives most hyponatraemia, and thirst is the guide: the 2015 consensus and its 2017
update are already in the corpus [hewbutler-2015-eah-consensus][hewbutler-2017-eah-update]. This pass
adds the road numbers. In the 2002 Boston Marathon 13% of 488 sampled runners were hyponatraemic;
weight gain (odds ratio 4.2) and a racing time over 4 hours (odds ratio 7.4 against under 3:30)
were independent risks, and the composition of the fluid was not [almond-2005-boston-marathon-hyponatremia].
In a warm half marathon of about 90 minutes, drinking to thirst (about 3% body-mass loss) matched
programmed drinking of about 1.4 L/h [dion-2013-half-marathon-thirst-fluid]. In an 11.3 km warm race a
larger body-mass loss went with a faster finish [adams-2017-falmouth-pace-deviation]. The older ACSM
stand's 2% limit [acsm-2007-fluid-replacement] is not supported by either result. Still unsupported:
a fluid volume for a road marathon that is safe and optimal for a given runner.

### 10 km

Typical slowing is about 3 to 4% at 10 km in a city race [cuk-2021-pacing-10km-marathon]. A
treadmill trial shows a fast opening, a slow drift and an end spurt in the better runners
[lima-silva-2010-pacing-10km-performance-level]. In a warm 11.3 km road race the first two miles'
deviation from predicted pace tracked the finish time [adams-2017-falmouth-pace-deviation]. Together
that supports the owner's scope (question 1 of 2026-11-16: the 10 km gets the time, pace and heat
blocks only) and no split pattern, no first-half line, no fuel.

## Established, contested, unknown

Established (grade C or better):

- Marathon finishers slow in the second half at every level, and slower finishers vary more.
- Heat slows marathon finishers, slower finishers more, and the safety risk rises from a start WBGT of
  about 13 C.
- A day-before carbohydrate intake above about 7 g/kg goes with a faster marathon.
- Overdrinking, weight gain and a long race go with hyponatraemia; thirst is as fast as programmed
  drinking in a half marathon in the warm.

Contested:

- The shape of heat slowing: late deceleration (Trubee) or a slower pace throughout (Ely 2008).
- Whether any in-race carbohydrate dose helps a race of 1.5 to 2 hours.

Unknown (not found in this pass; the plan states nothing on them):

- A best pacing shape for the marathon or the half, and a pace per kilometre.
- A half-marathon time cost per degree or per WBGT.
- A carbohydrate rate for a half marathon under 2 hours, and a road-trial rate for a 3 to 5 hour
  marathon.
- A fluid volume for a road marathon.
- A road race heart rate or RPE, a warm-up, and pre-cooling for a road race.

## How the engine should use this

1. Everything above is a statement of what the papers found, worded as findings and never as a limit
   or a target. No new number is added by this pass.
2. The marathon first-half line keeps the single source (smyth-2020) and the K6 `Param`; it is shown
   for the marathon only.
3. The half marathon plan states the time range, the average pace, the heat difference of the
   model, the fluid line and the race week; no rate for a half under two hours.
4. The 10 km plan states the time, pace and heat blocks only.
5. Any figure that a later paper supports enters as its own graded `Param` under the rule the engine
   PR adds, with these paper ids in its `evidence`.
