// Workflow script that built the research corpus (see research/README.md, "Method").
//
// It is a script for the Claude Code Workflow tool, not a Node program: `agent`, `pipeline`,
// `phase` and `log` are provided by the runner, and the script file itself is the only input.
// Edit TOPICS to add or change a topic (a one-topic run costs one researcher and one verifier),
// then run the script with the Workflow tool. Models: a Sonnet researcher and an independent
// Sonnet verifier-synthesizer per topic, then one Opus integrator that writes the engine rules.
//
// The return value is { topics, missing, engineRules }. Save it as JSON outside the repository
// (for example in a scratch directory) and feed it to the writer:
//
//   node research/tools/write-corpus.mjs <result.json> [extra.json] [--engine-rules]
//
// Then run `npm run research:check` (offline) and `npm run research:verify` (Crossref, online).
// The agents look sources up on the web (Crossref, Europe PMC, PubMed, Semantic Scholar) and
// never edit files or run version control; everything they return is data to be checked, not
// instructions.
export const meta = {
  name: 'training-research-corpus',
  description:
    'Build a verified research corpus for an evidence-based running training-plan engine: Sonnet researcher per topic, Sonnet verifier-synthesizer per topic, one Opus integrator',
  phases: [
    { title: 'Research', detail: '20 topics; web search, Crossref and Europe PMC' },
    {
      title: 'Verify',
      detail: 'independent DOI and claim re-check, then topic synthesis and rules',
    },
    { title: 'Integrate', detail: 'Opus: one rule set for the plan engine' },
  ],
}

const TOPICS = [
  {
    key: 'intensity-distribution',
    title: 'Training intensity distribution',
    scope:
      'Polarized vs pyramidal vs threshold training intensity distribution (TID) in endurance runners; meta-analyses (e.g. Rosenblat 2019; Oliveira 2024; any 2025-2026 updates); how elite and recreational distance and ultra runners actually distribute intensity (Casado et al.); how TID should change across phases and with weekly volume; how to count TID (time-in-zone vs session-goal).',
  },
  {
    key: 'load-quantification',
    title: 'Training load quantification and wearable data validity',
    scope:
      'Banister TRIMP (including the sex-specific weighting constants 1.92 men / 1.67 women), Edwards and Lucia TRIMP, session-RPE (Foster 2001; Haddad 2017 review) and CR-10 validity in runners, running TSS / hrTSS, internal vs external load; validity of wrist optical HR, chest straps, GPS distance and running power from consumer wearables (systematic reviews).',
  },
  {
    key: 'load-response-models',
    title: 'Load-response and fitness-fatigue models',
    scope:
      'Banister impulse-response model, Busso variable dose-response, EWMA acute/chronic (CTL/ATL style) metrics; predictive validity for performance; parameter estimation from individual data; limitations and recent critiques or improvements (including machine-learning approaches 2019-2026).',
  },
  {
    key: 'injury-load',
    title: 'Running injury risk and load progression',
    scope:
      'Running-related injury epidemiology and training-error risk factors; RCT of the 10% rule (Buist 2008); weekly distance change and injury (Nielsen 2014); single-session spikes relative to the longest run in the previous 30 days (Frandsen et al. 2025, BJSM, Garmin-RUNSAFE); acute:chronic workload ratio evidence and its critiques (Impellizzeri 2020; Lolli 2019 coupling; Wang 2020); previous injury as risk factor; bone stress injury risk factors in runners.',
  },
  {
    key: 'periodization-recovery',
    title: 'Periodization, recovery weeks and overreaching',
    scope:
      'Traditional vs block vs reverse periodization in endurance athletes (systematic reviews, Rønnestad, Issurin); recovery/cutback week frequency (3:1 vs 2:1) evidence; hard-easy sequencing and recovery time after high-intensity sessions and long runs; functional/non-functional overreaching and overtraining syndrome (Meeusen 2013 ECSS/ACSM consensus) and warning signs usable by an app.',
  },
  {
    key: 'taper',
    title: 'Tapering',
    scope:
      'Bosquet 2007 meta-analysis (duration, volume reduction, intensity, frequency); Mujika reviews; big-data marathon taper studies (Smyth & Lawlor 2021); taper for ultramarathons; pre-race week.',
  },
  {
    key: 'zones-thresholds',
    title: 'Intensity zones, thresholds and HRmax',
    scope:
      'HRmax prediction equations (Tanaka 2001, Gellish 2007, Nes 2013) and their error; heart-rate reserve (Karvonen); LT1/LT2 and VT1/VT2 concepts and three-zone models; critical speed and D-prime (Jones & Vanhatalo; Poole 2016); DFA-alpha1 for threshold detection (Rogers 2021 and later validation); talk test; field tests for runners; mapping between HR, pace and RPE zone systems.',
  },
  {
    key: 'performance-prediction',
    title: 'Performance prediction',
    scope:
      'Riegel power law and the endurance exponent; Daniels VDOT; Vickers & Vertosick 2016 marathon prediction; Smyth & Muniz-Pumares 2020 critical speed from training data predicts marathon time; Emig & Peltonen 2020 big-data running performance model; prediction for trail and ultramarathon (elevation, ITRA/UTMB index, fade); prediction uncertainty.',
  },
  {
    key: 'durability-drift',
    title: 'Durability and cardiovascular drift',
    scope:
      'Durability / physiological resilience concept (Maunder 2021; Jones 2024 J Physiol and later work); cardiovascular drift and aerobic decoupling during prolonged running; whether long-run HR drift or pace:HR decoupling can track aerobic fitness; effects of heat and hydration on drift.',
  },
  {
    key: 'heat-weather',
    title: 'Heat, humidity and weather',
    scope:
      'Weather effects on marathon and ultra performance (Ely 2007 WBGT by performance level; El Helou 2012; Vihma 2010; Knechtle ultra/weather studies); how to compute WBGT or heat index from temperature, humidity, solar load; heat acclimation and acclimatization protocols (Racinais 2015 consensus; Periard 2015/2021; Tyler 2016 meta); heat-adjusted pace and HR guidance; cold weather briefly.',
  },
  {
    key: 'terrain-elevation',
    title: 'Terrain, gradient and elevation',
    scope:
      'Energy cost of running on gradients (Minetti 2002) and grade-adjusted pace models (including large-data models such as Strava GAP if published); walk-run transition on uphills and power hiking efficiency; downhill running, eccentric muscle damage and the repeated-bout effect; trail technicality; vertical gain per hour in trail ultras; altitude briefly.',
  },
  {
    key: 'ultra-training',
    title: 'Ultramarathon training characteristics',
    scope:
      'Training characteristics and predictors of finishing and performance in 50 km to 100 mile and longer races (Knechtle reviews; Hoffman & Krishnan 2014 ULTRA study; Tiller et al. 2019; Scheer et al. 2020/2021 ultra-trail position statements; Western States studies); weekly volume, longest runs, back-to-back long runs, time on feet; DNF reasons; first-time 100-mile preparation; multi-day and 200-mile events.',
  },
  {
    key: 'ultra-nutrition',
    title: 'Ultramarathon nutrition, hydration and gut training',
    scope:
      'ISSN position stand on ultramarathon nutrition (Tiller 2019); carbohydrate intake rates 60-90 g/h and 90-120 g/h evidence; gut training (Costa 2017 and later RCTs); gastrointestinal symptoms prevalence; exercise-associated hyponatremia (Hoffman; Hew-Butler 2015 consensus); sodium and fluid guidance; practicing fueling in long training runs.',
  },
  {
    key: 'strength-plyometrics',
    title: 'Strength and plyometric training for runners',
    scope:
      'Effects of strength, plyometric and heavy resistance training on running economy and performance (Blagrove 2018; Balsalobre-Fernandez 2016; Llanos-Lagos 2024 meta-analyses); strength training and sports injury prevention (Lauersen 2014/2018); dosing (sessions per week, sets, intensity); concurrent training interference; strength for masters and trail runners.',
  },
  {
    key: 'age-masters',
    title: 'Age and masters runners',
    scope:
      'Age-related decline in endurance performance and VO2max (Tanaka & Seals); recovery differences in masters athletes (Fell & Williams 2008; Borges 2018 review); training adaptations in older runners; age grading (WMA); HRmax and age; injury risk with age; implications for session spacing and cycle length.',
  },
  {
    key: 'sex-female-athlete',
    title: 'Sex differences and the female athlete',
    scope:
      'Sex differences in endurance and ultra performance and fatigue resistance (Hunter; Temesi 2015; Besson 2022); menstrual cycle phase effects on performance (McNulty 2020 meta) and cycle-based training evidence; Relative Energy Deficiency in Sport (IOC 2023 consensus) and low energy availability screening; iron deficiency in endurance athletes (Sim 2019 consensus); bone stress injury risk; return to running postpartum (Goom 2019 guideline). Also sex-specific load metrics.',
  },
  {
    key: 'readiness-monitoring',
    title: 'Readiness, HRV and recovery monitoring',
    scope:
      'HRV-guided training meta-analyses (Duking 2021; Granero-Gallegos 2020) and RCTs in runners (Vesterinen 2016; Javaloyes); resting HR trends; subjective wellness measures outperforming objective markers (Saw 2016 systematic review); sleep and performance/injury (Fullagar 2015; Milewski 2014); illness and return to training; how consumer HRV/sleep data should and should not change daily training.',
  },
  {
    key: 'beginners-return',
    title: 'Novice runners, run-walk and return to running',
    scope:
      'Novice running programs and injury incidence (Nielsen 2014; Videbaek 2015 meta of injury incidence); run-walk methods; return-to-run progressions after injury or layoff; detraining and retraining rates (Mujika & Padilla 2000; more recent); how fast fitness returns after breaks; minimum effective dose for maintaining fitness.',
  },
  {
    key: 'volume-performance',
    title: 'Training volume and race performance',
    scope:
      'Relationships between weekly volume, long-run length, intensity and marathon/half performance in recreational runners (Doherty 2020 meta of training characteristics; big-data Strava/wearable studies by Smyth and others; Emig 2020); minimum training for finishing a marathon; diminishing returns; consistency vs peak volume.',
  },
  {
    key: 'ai-coaching',
    title: 'Algorithmic and data-driven training planning',
    scope:
      'Research on recommender systems and machine learning for running training and pacing (Smyth & Cunningham; Feely, Caulfield, Lawlor, Smyth 2020-2023; Berndsen 2019); adaptive or individualized training plan algorithms; evaluations of app-based or AI-generated training plans and their safety (2023-2026 studies, including LLM-generated plans); how commercial systems (Firstbeat/Garmin training status, TrainingPeaks PMC, intervals.icu, Runna, Stryd) model load where documented; individual response heterogeneity to training (Mann 2014; Bouchard).',
  },
]

const PAPER = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description:
        'kebab-case: firstauthorlastname-year-keyword, ascii only, e.g. bosquet-2007-taper',
    },
    title: { type: 'string' },
    authors: {
      type: 'string',
      description: 'e.g. "Bosquet L, Montpetit J, Arvisais D, Mujika I"; use "et al." after 6',
    },
    year: { type: 'integer' },
    journal: { type: 'string' },
    doi: {
      type: ['string', 'null'],
      description: 'bare DOI like 10.1249/mss.0b013e318057f9a6, lowercase',
    },
    pmid: { type: ['string', 'null'] },
    url: { type: 'string' },
    design: {
      type: 'string',
      enum: [
        'meta-analysis',
        'systematic-review',
        'consensus-statement',
        'rct',
        'prospective-cohort',
        'retrospective-cohort',
        'cross-sectional',
        'case-control',
        'experimental-crossover',
        'modelling',
        'narrative-review',
        'book-or-guideline',
        'other',
      ],
    },
    population: { type: 'string' },
    sampleSize: { type: ['integer', 'null'] },
    findings: {
      type: 'array',
      items: { type: 'string' },
      description: '2-6 findings, each with the numbers stated in the abstract or paper',
    },
    limitations: { type: 'string' },
    implications: {
      type: 'array',
      items: { type: 'string' },
      description:
        '1-4 concrete implications for an automated running plan generator, with parameter values where justified',
    },
    evidenceLevel: {
      type: 'string',
      enum: ['A', 'B', 'C', 'D'],
      description:
        'A: meta-analysis/systematic review/consensus of good quality; B: RCT or large prospective cohort; C: small studies, cross-sectional, modelling; D: expert opinion, narrative',
    },
    verification: {
      type: 'object',
      properties: {
        doiResolved: { type: 'boolean' },
        metadataMatches: {
          type: 'boolean',
          description: 'Crossref title/year/journal match the entry',
        },
        abstractSource: {
          type: 'string',
          enum: ['europepmc', 'pubmed', 'crossref', 'publisher', 'semanticscholar', 'none'],
        },
        findingsSupported: {
          type: 'boolean',
          description: 'the findings are stated in the abstract or accessible full text',
        },
        notes: { type: 'string' },
      },
      required: ['doiResolved', 'metadataMatches', 'abstractSource', 'findingsSupported', 'notes'],
    },
  },
  required: [
    'id',
    'title',
    'authors',
    'year',
    'journal',
    'doi',
    'pmid',
    'url',
    'design',
    'population',
    'sampleSize',
    'findings',
    'limitations',
    'implications',
    'evidenceLevel',
    'verification',
  ],
}

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    papers: { type: 'array', items: PAPER },
    searchLog: { type: 'string', description: 'queries run and sources used, briefly' },
  },
  required: ['topic', 'papers', 'searchLog'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    papers: {
      type: 'array',
      items: PAPER,
      description: 'only papers that survived verification, with corrected fields',
    },
    dropped: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
        required: ['id', 'reason'],
      },
    },
    synthesis: {
      type: 'string',
      description:
        'markdown, 500-1200 words: what is established, what is contested, what is unknown, and exactly how a plan generator should use it. Cite papers by [id].',
    },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'kebab-case rule id, prefixed with the topic key' },
          statement: { type: 'string' },
          parameter: { type: ['string', 'null'] },
          value: { type: ['string', 'null'] },
          unit: { type: ['string', 'null'] },
          appliesTo: { type: 'string' },
          grade: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          confidence: { type: 'string', enum: ['high', 'moderate', 'low'] },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'id',
          'statement',
          'parameter',
          'value',
          'unit',
          'appliesTo',
          'grade',
          'confidence',
          'evidence',
        ],
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['topic', 'papers', 'dropped', 'synthesis', 'rules', 'gaps'],
}

const TOOLS = `Tools and sources (use Bash with curl; keep each response small with head -c or jq-like filtering via node -e):
- Europe PMC search (discovery, sorted by citations): curl -s "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=<url-encoded query>&format=json&pageSize=25&sort=CITED%20desc&resultType=lite"
- Europe PMC abstract by DOI: curl -s "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:%22<doi>%22&resultType=core&format=json"  (read abstractText)
- Crossref metadata by DOI: curl -s "https://api.crossref.org/works/<doi>"  (title, container-title, issued, author)
- PubMed: curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=20&term=<query>" then efetch with rettype=abstract&retmode=text
- Semantic Scholar (rate limited, back off on 429): curl -s "https://api.semanticscholar.org/graph/v1/paper/search?query=<q>&fields=title,year,externalIds,citationCount,venue&limit=10"
- WebSearch / WebFetch (load them with ToolSearch "select:WebSearch,WebFetch") for consensus statements, very recent (2024-2026) work and grey literature.
Do not edit any files and do not run git. Never invent a DOI, number or finding: every paper you return must have been looked up in this session.`

function researchPrompt(t) {
  return `You are a sports-science research librarian building an evidence corpus for an automated, evidence-based running training-plan generator (distances from 5 km to 100 miles and beyond, one recreational athlete with wearable data). Your topic: ${t.title}.

Scope: ${t.scope}

Find the 8-14 most important papers for this topic. Prioritize: meta-analyses, systematic reviews and consensus/position statements; then RCTs and large prospective cohorts; seminal classics that define a method the engine will implement; and the most recent work (2022-2026). Include papers that CRITIQUE popular methods, not only ones that support them. Avoid duplicate coverage (one paper per finding).

For EACH paper: look up the DOI in Crossref and confirm title, year and journal; fetch the abstract (Europe PMC or PubMed); write findings only from what the abstract or accessible full text states, with its numbers; write implications as concrete rules or parameter values a plan generator could use (or "no change justified"). Fill the verification object honestly. If you cannot verify a paper, leave it out.

${TOOLS}

Return the structured result.`
}

function verifyPrompt(t, r) {
  return `You are an independent, skeptical verifier and synthesizer for an evidence corpus behind an automated running training-plan generator. Topic: ${t.title}. Scope: ${t.scope}

A researcher returned these entries:
${JSON.stringify(r.papers, null, 1)}

STEP 1, VERIFY every entry yourself (do not trust the researcher's verification object): re-fetch the DOI from Crossref and compare title, year, journal, first author; re-fetch the abstract (Europe PMC by DOI, else PubMed) and check that every finding and number is actually stated there (or in accessible full text). Fix wrong metadata, rewrite unsupported findings to what the source says, correct the design and evidenceLevel if misclassified. DROP entries whose DOI does not resolve, whose metadata does not match a real paper, or whose central claim cannot be supported; list them under dropped with the reason. If an obviously essential paper for this topic is missing (a major meta-analysis or consensus statement), you may add up to 3, verified the same way.

STEP 2, SYNTHESIZE: write the topic synthesis (markdown, 500-1200 words) for the engineers building the plan engine: what is well established, what is contested, what is unknown, and exactly how the engine should use this evidence, citing papers by [id]. Then write concrete rules (6-15) the engine can implement, each with parameter, value, unit, who it applies to, a grade (A-D, the strength of the best supporting evidence), a confidence, and evidence ids. Where the evidence does not justify a specific number, say so and give a conservative default with grade D. List gaps.

${TOOLS}

Return the structured result.`
}

phase('Research')
const results = await pipeline(
  TOPICS,
  (t) =>
    agent(researchPrompt(t), {
      label: `research:${t.key}`,
      phase: 'Research',
      schema: RESEARCH_SCHEMA,
      model: 'sonnet',
      effort: 'high',
    }),
  (r, t) => {
    if (!r || !r.papers || !r.papers.length) {
      log(`research:${t.key} returned nothing`)
      return null
    }
    log(`${t.key}: ${r.papers.length} candidate papers`)
    return agent(verifyPrompt(t, r), {
      label: `verify:${t.key}`,
      phase: 'Verify',
      schema: VERIFY_SCHEMA,
      model: 'sonnet',
      effort: 'high',
    }).then((v) => (v ? { key: t.key, title: t.title, candidates: r.papers.length, ...v } : null))
  },
)

const topics = results.filter(Boolean)
const missing = TOPICS.filter((t) => !topics.find((x) => x.key === t.key)).map((t) => t.key)
if (missing.length) log(`no result for: ${missing.join(', ')}`)
const kept = topics.reduce((n, t) => n + t.papers.length, 0)
const dropped = topics.reduce((n, t) => n + t.dropped.length, 0)
log(`${topics.length}/${TOPICS.length} topics; ${kept} papers kept, ${dropped} dropped`)

phase('Integrate')
const digest = topics.map((t) => ({
  topic: t.key,
  title: t.title,
  synthesis: t.synthesis,
  rules: t.rules,
  gaps: t.gaps,
  papers: t.papers.map(
    (p) => `${p.id}: ${p.authors.split(',')[0]} ${p.year}, ${p.design}, level ${p.evidenceLevel}`,
  ),
}))
const engineRules = await agent(
  `You are the lead sports scientist designing the rule set of an automated, evidence-based training-plan engine for ONE recreational runner (any goal from 5 km to 100 miles and beyond, including trail ultras), fed by wearable data (pace, distance, duration, heart rate, elevation, temperature, RPE, HRV/resting HR/sleep when available) and an athlete profile (age, sex, experience, injury history, availability). Below are 20 verified topic syntheses with their rules and paper ids.

Write the integrated ENGINE RULES document (markdown, 3000-6000 words). Requirements:
1. Organize by engine stage: (a) athlete state estimation from history (fitness, chronic load, consistency, longest recent runs, durability); (b) load metrics per session (which metric when HR, RPE or only pace is available; sex-specific TRIMP); (c) zones and thresholds (defaults when untested, how to update from data); (d) goal modelling (distance, elevation, terrain, heat at race, date) and feasibility; (e) macrocycle (phases, lengths, TID per phase); (f) microcycle and session library (session types, spacing, hard-easy, long-run and back-to-back rules); (g) progression and safety limits (weekly load, single-session spike limits, cutbacks), with the exact numbers and how strong each is; (h) ultra-specific rules (time on feet, vert, back-to-backs, night, fueling practice, heat acclimation, downhill conditioning); (i) environment (heat-adjusted pace and HR, weather forecast use, elevation/GAP); (j) adaptation (weekly re-planning from compliance, load, HR response, subjective review, HRV/resting HR; never make up missed volume; what triggers reduce/hold/progress); (k) taper and race week; (l) performance prediction with uncertainty; (m) personalization factors: give a verdict for EACH of age, sex, body mass, experience, injury history, temperature, heart rate, intensity, speed, distance, duration, elevation, sleep/HRV - what the evidence supports adjusting, by how much, and what it does NOT support; (n) red flags the app must surface (pain, illness, REDs signs, overtraining) and the safety disclaimer.
2. Every rule: the rule, parameter values and defaults, grade A-D, and paper ids in [brackets]. Resolve conflicts between topics explicitly and say why. Prefer conservative defaults where evidence is weak, and label conventions as conventions.
3. End with: a table of all numeric parameters (name, default, range, grade, ids); the top 10 evidence gaps; and a short list of what would change the rules if new research appeared.
Return only the markdown document.

TOPIC SYNTHESES:
${JSON.stringify(digest)}`,
  { label: 'integrate', phase: 'Integrate', model: 'opus', effort: 'high' },
)

return { topics, missing, engineRules }
