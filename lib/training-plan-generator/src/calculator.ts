import { RunData, FitnessMetrics, WeeklyPatterns, TrainingLoad } from './types';
import { startOfWeek, format } from 'date-fns';

/**
 * Calculate VDOT (VO2max estimate) from race performances
 * Based on Jack Daniels' Running Formula
 */
export function calculateVDOT(runs: RunData[]): number {
  // Filter for race performances or time trials
  const performances = runs.filter(run => run.isRace || (run.effortLevel && run.effortLevel >= 9));

  if (performances.length === 0) {
    // Estimate from regular runs
    const fastRuns = runs
      .filter(run => run.distance >= 3 && run.avgPace)
      .sort((a, b) => a.avgPace! - b.avgPace!)
      .slice(0, 3);

    if (fastRuns.length > 0) {
      const bestRun = fastRuns[0];
      const distance = bestRun.distance * 1000; // Convert to meters
      const time = bestRun.duration; // Already in minutes
      const velocity = distance / (time * 60); // m/s

      // Daniels' formula
      const vo2 = -4.6 + 0.182258 * (velocity * 60) + 0.000104 * Math.pow(velocity * 60, 2);
      const percentMax =
        0.8 + 0.1894393 * Math.exp(-0.012778 * time) + 0.2989558 * Math.exp(-0.1932605 * time);

      return Math.round(vo2 / percentMax);
    }
  }

  // Default VDOT for beginners
  return 35;
}

/**
 * Calculate Critical Speed using 2-parameter hyperbolic model
 * Jones & Vanhatalo (2017)
 */
export function calculateCriticalSpeed(runs: RunData[]): number {
  const timeTrials = runs
    .filter(run => run.distance >= 3 && run.effortLevel && run.effortLevel >= 8)
    .map(run => ({
      distance: run.distance * 1000, // meters
      time: run.duration * 60, // seconds
    }));

  if (timeTrials.length >= 2) {
    // Sort by distance
    const sorted = timeTrials.sort((a, b) => a.distance - b.distance);
    const d1 = sorted[0].distance;
    const t1 = sorted[0].time;
    const d2 = sorted[sorted.length - 1].distance;
    const t2 = sorted[sorted.length - 1].time;

    // Critical speed in m/s
    const cs = (d2 - d1) / (t2 - t1);
    return cs * 3.6; // Convert to km/h
  }

  return 10; // Default 10 km/h
}

/**
 * Estimate running economy from pace and heart rate data
 * Lower values indicate better economy
 */
export function estimateRunningEconomy(runs: RunData[]): number {
  const economyRuns = runs.filter(
    run =>
      run.avgHeartRate &&
      run.avgPace &&
      run.duration > 20 &&
      run.effortLevel &&
      run.effortLevel <= 6
  );

  if (economyRuns.length > 0) {
    // Calculate oxygen cost per km
    const economies = economyRuns.map(run => {
      const pace = run.avgPace!; // min/km
      const hrReserve = (run.avgHeartRate! - 60) / (190 - 60); // Assuming rest HR 60, max HR 190
      const estimatedVO2 = hrReserve * 50; // Rough estimate of VO2
      return estimatedVO2 / (60 / pace); // ml/kg/km
    });

    return Math.round(economies.reduce((sum, e) => sum + e, 0) / economies.length);
  }

  return 200; // Default running economy
}

/**
 * Calculate lactate threshold pace from VDOT
 */
export function calculateLactateThreshold(vdot: number): number {
  // Threshold is typically run at 88% of VO2max
  // This is a simplified calculation
  const thresholdVelocity = (vdot * 0.88) / 3.5; // km/h
  return thresholdVelocity;
}

/**
 * Calculate Training Stress Score for a single run
 */
export function calculateTSS(run: RunData, thresholdPace: number): number {
  if (!run.avgPace) return 0;

  const intensityFactor = thresholdPace / run.avgPace;
  const tss = (run.duration * Math.pow(intensityFactor, 2) * 100) / 60;

  return Math.round(tss);
}

/**
 * Calculate training load metrics using EWMA
 */
export function calculateTrainingLoad(runs: RunData[], thresholdPace: number): TrainingLoad {
  const sortedRuns = [...runs].sort((a, b) => a.date.getTime() - b.date.getTime());

  let acuteLoad = 0; // 7-day
  let chronicLoad = 0; // 28-day
  const acuteDecay = Math.exp(-1 / 7);
  const chronicDecay = Math.exp(-1 / 28);

  const loads = sortedRuns.map(run => {
    const tss = calculateTSS(run, thresholdPace);
    acuteLoad = acuteLoad * acuteDecay + tss * (1 - acuteDecay);
    chronicLoad = chronicLoad * chronicDecay + tss * (1 - chronicDecay);

    return {
      date: run.date,
      tss,
      acuteLoad,
      chronicLoad,
      ratio: chronicLoad > 0 ? acuteLoad / chronicLoad : 1,
    };
  });

  const current = loads[loads.length - 1] || { acuteLoad: 0, chronicLoad: 0, ratio: 1 };

  // Determine trend
  let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
  if (loads.length > 7) {
    const weekAgo = loads[loads.length - 8].acuteLoad;
    if (current.acuteLoad > weekAgo * 1.1) trend = 'increasing';
    else if (current.acuteLoad < weekAgo * 0.9) trend = 'decreasing';
  }

  // Generate recommendation
  let recommendation = '';
  if (current.ratio < 0.8) {
    recommendation = 'Training load is low. Consider increasing volume gradually.';
  } else if (current.ratio > 1.5) {
    recommendation = 'Training load is very high. Risk of overtraining. Consider recovery.';
  } else if (current.ratio > 1.3) {
    recommendation = 'Training load is high. Monitor fatigue carefully.';
  } else {
    recommendation = 'Training load is in optimal range for adaptation.';
  }

  return {
    acute: Math.round(current.acuteLoad),
    chronic: Math.round(current.chronicLoad),
    ratio: Math.round(current.ratio * 100) / 100,
    trend,
    recommendation,
  };
}

/**
 * Calculate injury risk score based on multiple factors
 */
export function calculateInjuryRisk(
  trainingLoad: TrainingLoad,
  weeklyMileageIncrease: number,
  recoveryScore: number
): number {
  let risk = 0;

  // Acute:Chronic ratio contribution (0-40 points)
  if (trainingLoad.ratio < 0.8)
    risk += 20; // Undertraining
  else if (trainingLoad.ratio > 1.5)
    risk += 40; // High risk
  else if (trainingLoad.ratio > 1.3)
    risk += 25; // Moderate risk
  else risk += 10; // Low risk

  // Weekly mileage increase contribution (0-30 points)
  if (weeklyMileageIncrease > 20) risk += 30;
  else if (weeklyMileageIncrease > 10) risk += 20;
  else if (weeklyMileageIncrease > 5) risk += 10;

  // Recovery score contribution (0-30 points)
  risk += Math.round((100 - recoveryScore) * 0.3);

  return Math.min(100, risk);
}

/**
 * Calculate recovery score based on HRV trends and recent training
 */
export function calculateRecoveryScore(runs: RunData[], restingHR?: number, hrv?: number): number {
  // Simplified recovery score
  let score = 70; // Base score

  // Recent high-intensity work
  const recentHardRuns = runs
    .filter(run => run.date > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    .filter(run => run.effortLevel && run.effortLevel >= 7);

  score -= recentHardRuns.length * 5;

  // Add HRV contribution if available
  if (hrv) {
    // Higher HRV generally indicates better recovery
    if (hrv > 60) score += 10;
    else if (hrv < 40) score -= 10;
  }

  // Add resting HR contribution if available
  if (restingHR) {
    // Lower resting HR generally indicates better recovery
    if (restingHR < 50) score += 10;
    else if (restingHR > 65) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Analyze weekly training patterns
 */
export function analyzeWeeklyPatterns(runs: RunData[]): WeeklyPatterns {
  const weeks: Map<string, RunData[]> = new Map();

  // Group runs by week
  runs.forEach(run => {
    const weekStart = format(startOfWeek(run.date), 'yyyy-MM-dd');
    if (!weeks.has(weekStart)) {
      weeks.set(weekStart, []);
    }
    weeks.get(weekStart)!.push(run);
  });

  // Calculate weekly metrics
  const weeklyDistances = Array.from(weeks.values()).map(weekRuns =>
    weekRuns.reduce((sum, run) => sum + run.distance, 0)
  );

  // Find typical training days
  const dayFrequency = new Array(7).fill(0);
  runs.forEach(run => {
    dayFrequency[run.date.getDay()]++;
  });

  const avgRunsPerWeek = runs.length / weeks.size;
  const optimalDays = dayFrequency
    .map((count, day) => ({ day, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.round(avgRunsPerWeek))
    .map(d => d.day);

  // Find typical long run day
  const longRuns = runs.filter(run => run.distance > 15);
  const longRunDays = new Array(7).fill(0);
  longRuns.forEach(run => {
    longRunDays[run.date.getDay()]++;
  });
  const typicalLongRunDay = longRunDays.indexOf(Math.max(...longRunDays));

  // Calculate consistency score
  const expectedRuns = avgRunsPerWeek * weeks.size;
  const actualRuns = runs.length;
  const consistencyScore = Math.round((actualRuns / expectedRuns) * 100);

  return {
    avgWeeklyMileage: Math.round(
      weeklyDistances.reduce((sum, d) => sum + d, 0) / weeklyDistances.length
    ),
    maxWeeklyMileage: Math.round(Math.max(...weeklyDistances)),
    avgRunsPerWeek: Math.round(avgRunsPerWeek * 10) / 10,
    consistencyScore: Math.min(100, consistencyScore),
    optimalDays,
    typicalLongRunDay,
  };
}

/**
 * Calculate fitness metrics from run data
 */
export function calculateFitnessMetrics(runs: RunData[]): FitnessMetrics {
  const vdot = calculateVDOT(runs);
  const criticalSpeed = calculateCriticalSpeed(runs);
  const runningEconomy = estimateRunningEconomy(runs);
  const lactateThreshold = calculateLactateThreshold(vdot);

  // Calculate threshold pace for TSS calculations
  const thresholdPace = 60 / lactateThreshold; // min/km

  const trainingLoad = calculateTrainingLoad(runs, thresholdPace);
  const recoveryScore = calculateRecoveryScore(runs);

  // Calculate weekly mileage increase
  const weeklyPatterns = analyzeWeeklyPatterns(runs);
  const recentWeekMileage = runs
    .filter(run => run.date > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    .reduce((sum, run) => sum + run.distance, 0);
  const weeklyIncrease =
    weeklyPatterns.avgWeeklyMileage > 0
      ? ((recentWeekMileage - weeklyPatterns.avgWeeklyMileage) / weeklyPatterns.avgWeeklyMileage) *
        100
      : 0;

  const injuryRisk = calculateInjuryRisk(trainingLoad, weeklyIncrease, recoveryScore);

  return {
    vdot,
    criticalSpeed,
    runningEconomy,
    lactateThreshold,
    trainingLoad,
    injuryRisk,
    recoveryScore,
  };
}
