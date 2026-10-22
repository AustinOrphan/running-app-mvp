// Plain-language titles for the rule ids the engine emits (`research/engine-rules.md` and the
// design spec), so the why drawer never shows a bare id. A test checks that every id the engine
// emits has a title.

/**
 * Rule id to title. Ids are the engine's own spelling: `g-1` is the session spike guard of the
 * limits section and `G1` the first global principle, so case and hyphen matter.
 */
export const RULE_TITLES: Record<string, string> = {
  // global principles
  G1: 'Deterministic core',
  G2: 'Fitness-fatigue models do not drive plans',
  G3: 'Priors, not optima',
  G4: 'No responder labels',
  G5: 'Copy discipline',
  G6: 'Safety first',
  // (a) athlete state
  A1: 'Separate stores',
  A2: 'Chronic and acute load',
  A3: 'Longest recent run',
  A4: 'Consistency',
  A5: 'Experience class',
  A6: 'Fitness',
  A7: 'Durability descriptor',
  A8: 'Efficiency index',
  A9: 'Risk profile',
  A10: 'Fitness-fatigue model fitting',
  // (b) load
  B1: 'Primary load metric',
  B2: 'Which metric when',
  B3: 'Sex-specific TRIMP',
  B4: 'No cross-scale arithmetic',
  B5: 'Divergence between scales',
  B6: 'External load hygiene',
  B7: 'Monotony and strain',
  B8: 'Skin tone and wrist HR',
  // (c) zones
  C1: 'Three-domain model',
  C2: 'Anchor hierarchy',
  C3: 'Maximum heart rate',
  C4: 'First threshold when untested',
  C5: 'Continuous threshold work',
  C6: 'Intervals above critical speed',
  C7: 'Boundaries as ranges',
  C8: 'Updating zones',
  // (d) goal
  D1: 'Goal record',
  D2: 'Goal type',
  D3: 'Floors for time goals',
  D4: 'Feasibility check',
  D5: 'Ultra readiness messages',
  D6: 'Race-day heat',
  // (e) macrocycle
  E1: 'Model',
  E2: 'Phase lengths',
  E3: 'Recovery weeks',
  E4: 'Intensity distribution by phase',
  E5: 'Fixed blocks',
  // (f) microcycle
  F1: 'Spacing after hard work',
  F2: 'Quality sessions',
  F3: 'Long-run placement',
  F4: 'Strength placement',
  F5: 'Run frequency and availability',
  F6: 'One lever at a time',
  'F-lib': 'Session library',
  // (g) limits
  'g-1': 'Session spike guard',
  'g-2': 'Weekly ramp',
  'g-3': 'Tightened profiles',
  'g-4': 'Sex-specific limits',
  'g-5': 'Load ratio is never a gate',
  'g-6': 'Never make up missed volume',
  'g-7': 'Symptom check-ins are secondary',
  'G-6': 'Never make up missed volume',
  // (h) ultra
  H1: 'Progression priority',
  H2: 'Time on feet',
  H3: 'Back-to-back runs',
  H4: 'Climbing and descent',
  H5: 'Downhill conditioning',
  H6: 'Night running',
  H7: 'Fuelling practice',
  H8: 'Fluid and sodium',
  H9: 'Daily diet',
  H10: 'Strength',
  H11: 'Race pacing',
  H12: 'Recovery after the race',
  H13: 'Heat acclimation blocks',
  // (i) environment
  I1: 'Weather index',
  I2: 'Optimum temperature band',
  I3: 'Hot-side race penalty',
  I4: 'Ability multiplier',
  I5: 'Pacing shape in heat',
  I6: 'Ultras in heat',
  I7: 'Training in heat',
  I8: 'Heat acclimation',
  I9: 'Heat warnings',
  I10: 'Cold',
  I11: 'Gradient and grade-adjusted pace',
  I12: 'Altitude',
  // (j) adaptation
  J1: 'Inputs',
  J2: 'Subjective first',
  J3: 'Daily readiness only downgrades',
  J4: 'Heart rate variability',
  J5: 'Weekly decision',
  J6: 'Perceived-recovery gate',
  J7: 'Breaks',
  J8: 'Fatigue states',
  // (k) taper
  K1: 'Taper length',
  K2: 'Taper volume',
  K3: 'Taper intensity and frequency',
  K4: 'Overreaching at taper start',
  K5: 'Taper check-in',
  K6: 'Race week',
  K7: 'Expected benefit',
  // (l) prediction
  L1: 'Prediction model hierarchy',
  L2: 'Marathon prediction',
  L3: 'Prediction covariates',
  L4: 'Ultra prediction',
  L5: 'Trail prediction',
  L6: 'Minimum prediction band',
  L7: 'Back-testing',
  // (m) personalisation
  'm-age': 'Age',
  'm-sex': 'Sex',
  // (n) red flags
  'n-1': 'Focal bone pain',
  'n-2': 'Pain that changes gait',
  'n-3': 'Illness symptoms',
  'n-4': 'Energy-availability signs',
  'n-5': 'Possible iron deficiency',
  'n-6': 'Persistent suppression',
  'n-7': 'Exercise-associated hyponatraemia',
  // design decisions that have no research rule
  'design-macro': 'Plan structure defaults',
  'design-sessions': 'Session design defaults',
  'design-3.2': 'Daily check-in',
  'design-4.1': 'Matching activities to sessions',
  'design-4.2': 'Execution assessment',
  'design-4.3': 'Trimming the next quality session',
}

/** Case, hyphen and spelling aside, the same lookup the drawer uses for parameters. */
const loose = (id: string) => id.toLowerCase().replace(/-/g, '')

/**
 * The title of a rule id: an exact match first (`g-1` and `G1` are different rules), then a match
 * that ignores case and hyphens, else null.
 */
export function ruleTitle(id: string): string | null {
  const exact = RULE_TITLES[id]
  if (exact !== undefined) return exact
  const key = loose(id)
  const found = Object.keys(RULE_TITLES).find((candidate) => loose(candidate) === key)
  return found === undefined ? null : (RULE_TITLES[found] ?? null)
}
