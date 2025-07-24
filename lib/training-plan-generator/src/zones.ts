export interface TrainingZone {
  name: string;
  rpe: number; // Rate of Perceived Exertion 1-10
  heartRateRange?: { min: number; max: number }; // % of max HR
  paceRange?: { min: number; max: number }; // % of threshold pace
  powerRange?: { min: number; max: number }; // % of critical power
  description: string;
  purpose: string;
}

/**
 * Standard training zones based on physiological markers
 */
export const TRAINING_ZONES: Record<string, TrainingZone> = {
  RECOVERY: {
    name: 'Recovery',
    rpe: 1,
    heartRateRange: { min: 50, max: 60 },
    paceRange: { min: 0, max: 75 },
    description: 'Very easy effort, conversational',
    purpose: 'Active recovery, promote blood flow',
  },
  EASY: {
    name: 'Easy',
    rpe: 2,
    heartRateRange: { min: 60, max: 70 },
    paceRange: { min: 75, max: 85 },
    description: 'Comfortable, conversational pace',
    purpose: 'Build aerobic base, improve fat oxidation',
  },
  STEADY: {
    name: 'Steady',
    rpe: 3,
    heartRateRange: { min: 70, max: 80 },
    paceRange: { min: 85, max: 90 },
    description: 'Moderate effort, slightly harder breathing',
    purpose: 'Aerobic development, mitochondrial density',
  },
  TEMPO: {
    name: 'Tempo',
    rpe: 4,
    heartRateRange: { min: 80, max: 87 },
    paceRange: { min: 90, max: 95 },
    description: 'Comfortably hard, controlled discomfort',
    purpose: 'Improve lactate clearance, mental toughness',
  },
  THRESHOLD: {
    name: 'Threshold',
    rpe: 5,
    heartRateRange: { min: 87, max: 92 },
    paceRange: { min: 95, max: 100 },
    description: 'Hard effort, sustainable for ~1 hour',
    purpose: 'Increase lactate threshold, improve efficiency',
  },
  VO2_MAX: {
    name: 'VO2 Max',
    rpe: 6,
    heartRateRange: { min: 92, max: 97 },
    paceRange: { min: 105, max: 115 },
    description: 'Very hard, heavy breathing',
    purpose: 'Maximize oxygen uptake, increase power',
  },
  NEUROMUSCULAR: {
    name: 'Neuromuscular',
    rpe: 7,
    heartRateRange: { min: 97, max: 100 },
    paceRange: { min: 115, max: 130 },
    description: 'Maximum effort, short duration',
    purpose: 'Improve speed, power, and running economy',
  },
};

/**
 * Calculate personalized training zones based on fitness metrics
 */
export function calculatePersonalizedZones(
  maxHR: number,
  thresholdPace: number, // min/km
  _vdot?: number
): Record<string, TrainingZone> {
  const zones: Record<string, TrainingZone> = {};

  // Calculate pace zones from threshold pace
  Object.entries(TRAINING_ZONES).forEach(([key, baseZone]) => {
    const zone = { ...baseZone };

    // Personalize heart rate ranges
    if (zone.heartRateRange) {
      zone.heartRateRange = {
        min: Math.round((zone.heartRateRange.min / 100) * maxHR),
        max: Math.round((zone.heartRateRange.max / 100) * maxHR),
      };
    }

    // Personalize pace ranges
    if (zone.paceRange) {
      zone.paceRange = {
        min: (thresholdPace * zone.paceRange.min) / 100,
        max: (thresholdPace * zone.paceRange.max) / 100,
      };
    }

    zones[key] = zone;
  });

  return zones;
}

/**
 * Get zone for a given intensity percentage
 */
export function getZoneByIntensity(intensity: number): TrainingZone {
  if (intensity < 60) return TRAINING_ZONES.RECOVERY;
  if (intensity < 70) return TRAINING_ZONES.EASY;
  if (intensity < 80) return TRAINING_ZONES.STEADY;
  if (intensity < 87) return TRAINING_ZONES.TEMPO;
  if (intensity < 92) return TRAINING_ZONES.THRESHOLD;
  if (intensity < 97) return TRAINING_ZONES.VO2_MAX;
  return TRAINING_ZONES.NEUROMUSCULAR;
}

/**
 * Calculate training pace from VDOT
 */
export function calculateTrainingPaces(vdot: number): Record<string, number> {
  // Based on Jack Daniels' VDOT tables
  // Returns paces in min/km

  const vdotMultipliers = {
    easy: 0.7, // % of VO2max
    marathon: 0.84,
    threshold: 0.88,
    interval: 0.98,
    repetition: 1.05,
  };

  // Simplified calculation - in real implementation, use full VDOT tables
  const vo2maxPace = 5.5 - (vdot - 30) * 0.05; // Rough approximation

  return {
    easy: vo2maxPace / vdotMultipliers.easy,
    marathon: vo2maxPace / vdotMultipliers.marathon,
    threshold: vo2maxPace / vdotMultipliers.threshold,
    interval: vo2maxPace / vdotMultipliers.interval,
    repetition: vo2maxPace / vdotMultipliers.repetition,
  };
}
