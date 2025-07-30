# Training Plan Generator

A scientific, advanced training plan generation library for running based on proven sports science principles.

## Features

- **VDOT-based fitness assessment** - Calculate VO2max from race performances
- **Critical Speed modeling** - 2-parameter hyperbolic model for endurance capacity
- **Periodized training plans** - Base, Build, Peak, Taper phases
- **Polarized training distribution** - 80/20 easy/hard intensity split
- **Acute:Chronic workload monitoring** - Injury prevention through load management
- **Personalized pacing** - Training zones based on individual fitness
- **Recovery optimization** - Built-in recovery recommendations

## Installation

```bash
npm install @yourusername/training-plan-generator
```

## Quick Start

```javascript
import { TrainingPlanGenerator } from '@yourusername/training-plan-generator';

// Generate from configuration
const config = {
  name: 'Marathon Training',
  goal: 'MARATHON',
  startDate: new Date(),
  targetDate: new Date('2024-10-15'),
  currentFitness: {
    weeklyMileage: 40,
    longestRecentRun: 20,
    vdot: 45,
  },
};

const generator = new TrainingPlanGenerator(config);
const plan = generator.generatePlan();
```

## Generate from Run History

```javascript
import {
  TrainingPlanGenerator,
  calculateFitnessMetrics,
} from '@yourusername/training-plan-generator';

// Analyze recent runs
const runs = [
  {
    date: new Date('2024-01-15'),
    distance: 10, // km
    duration: 45, // minutes
    avgHeartRate: 145,
    effortLevel: 6,
  },
  // ... more runs
];

// Generate plan from run history
const plan = TrainingPlanGenerator.fromRunHistory(runs, 'HALF_MARATHON', new Date('2024-06-01'));
```

## Fitness Calculations

```javascript
import {
  calculateVDOT,
  calculateCriticalSpeed,
  calculateTrainingLoad,
  analyzeWeeklyPatterns,
} from '@yourusername/training-plan-generator';

// Calculate VDOT from performances
const vdot = calculateVDOT(runs);

// Calculate critical speed
const criticalSpeed = calculateCriticalSpeed(runs);

// Analyze training load
const load = calculateTrainingLoad(runs, thresholdPace);
console.log(`Acute:Chronic ratio: ${load.ratio}`);
console.log(`Recommendation: ${load.recommendation}`);
```

## Training Zones

```javascript
import { calculatePersonalizedZones } from '@yourusername/training-plan-generator';

const zones = calculatePersonalizedZones(
  185, // max heart rate
  4.5 // threshold pace (min/km)
);

// Access zones
console.log(zones.TEMPO.heartRateRange); // { min: 148, max: 161 }
console.log(zones.TEMPO.paceRange); // { min: 4.7, max: 5.0 }
```

## Workout Templates

The library includes scientifically-backed workout templates:

```javascript
import { WORKOUT_TEMPLATES } from '@yourusername/training-plan-generator';

const thresholdWorkout = WORKOUT_TEMPLATES.LACTATE_THRESHOLD_2X20;
// {
//   type: 'threshold',
//   segments: [...],
//   adaptationTarget: 'Lactate threshold improvement',
//   estimatedTSS: 90,
//   recoveryTime: 36
// }
```

## Configuration Options

### Training Goals

- `FIRST_5K` - Beginner 5K plan
- `IMPROVE_5K` - Intermediate/Advanced 5K
- `FIRST_10K` - Beginner 10K
- `HALF_MARATHON` - Half marathon preparation
- `MARATHON` - Full marathon training
- `ULTRA` - Ultra-distance preparation
- `GENERAL_FITNESS` - General running fitness

### Fitness Assessment

```typescript
interface FitnessAssessment {
  vdot?: number; // VO2max estimate (30-80)
  criticalSpeed?: number; // km/h
  weeklyMileage: number; // Current weekly distance
  longestRecentRun: number; // Longest run in past month
  trainingAge?: number; // Years of consistent training
  recoveryRate?: number; // 0-100 based on HRV
}
```

### Training Preferences

```typescript
interface TrainingPreferences {
  availableDays: number[]; // [0,2,4,6] = Sun, Tue, Thu, Sat
  preferredIntensity: 'low' | 'moderate' | 'high';
  crossTraining: boolean;
  strengthTraining: boolean;
  timeConstraints?: Record<number, number>; // Day to minutes
}
```

## Plan Structure

Generated plans include:

- **Training Blocks** - Periodized phases with specific adaptations
- **Weekly Microcycles** - Structured weekly patterns
- **Individual Workouts** - Detailed session plans with segments
- **Progress Tracking** - Built-in metrics and load monitoring

Example workout structure:

```javascript
{
  id: 'workout-1-3',
  date: '2024-02-15',
  type: 'threshold',
  name: 'Build Phase: Lactate Threshold Workout',
  workout: {
    segments: [
      { duration: 10, intensity: 65, zone: 'Easy', description: 'Warm-up' },
      { duration: 20, intensity: 88, zone: 'Threshold', description: 'Threshold pace' },
      { duration: 5, intensity: 60, zone: 'Recovery', description: 'Recovery' },
      { duration: 20, intensity: 88, zone: 'Threshold', description: 'Threshold pace' },
      { duration: 10, intensity: 60, zone: 'Recovery', description: 'Cool-down' }
    ],
    estimatedTSS: 90,
    recoveryTime: 36
  }
}
```

## Scientific Basis

This library implements evidence-based training principles from:

- Jack Daniels' VDOT system
- Critical Speed model (Jones & Vanhatalo, 2017)
- Polarized training (Seiler, 2010)
- Acute:Chronic workload ratios (Gabbett, 2016)
- Nonlinear periodization (Kiely, 2012)

See the [training-science-docs](https://github.com/yourusername/training-science-docs) repository for complete scientific references.

## License

MIT

## Contributing

Contributions welcome! Please ensure all algorithms are backed by peer-reviewed research.
