# Training Calculations Quick Reference

A developer-friendly reference for all calculations used in the Advanced Training Plan Service.

## Core Calculations

### 1. VDOT (VO2max Estimate)
```typescript
// From race performance
const velocity = distance_meters / time_seconds;
const vo2 = -4.6 + 0.182258 * (velocity * 60) + 0.000104 * Math.pow(velocity * 60, 2);
const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * time_minutes) + 
                   0.2989558 * Math.exp(-0.1932605 * time_minutes);
const vdot = vo2 / percentMax;
```

**Source**: Daniels' Running Formula (2014)  
**Typical Values**: 30-40 (beginner), 45-55 (intermediate), 60-75 (advanced), 80+ (elite)

---

### 2. Training Paces from VDOT
```typescript
// Easy Pace (65-79% of VO2max)
const easyPace = 10.5 - (vdot - 30) * 0.1; // min/km

// Tempo Pace (83-88% of VO2max)  
const tempoPace = easyPace - 1.0; // min/km

// VO2max Pace (95-100% of VO2max)
const vo2maxPace = easyPace - 1.7; // min/km
```

**Source**: Daniels' pace tables

---

### 3. Critical Speed
```typescript
// From two time trials
const cs_mps = (distance2_m - distance1_m) / (time2_s - time1_s);
const cs_kph = cs_mps * 3.6;
```

**Source**: Jones & Vanhatalo (2017)  
**Typical Values**: 10-12 km/h (recreational), 14-16 km/h (competitive), 18+ km/h (elite)

---

### 4. Training Stress Score (TSS)
```typescript
// For a single workout
const intensityFactor = avgPace / thresholdPace;
const tss = (duration_seconds * Math.pow(intensityFactor, 2) * 100) / 3600;
```

**Source**: Coggan & Allen (2010)  
**Scale**: 
- <150: Low (recovery by next day)
- 150-300: Medium (some residual fatigue)
- 300-450: High (residual fatigue for days)
- >450: Very High (extended recovery needed)

---

### 5. Acute:Chronic Workload Ratio
```typescript
// Using exponentially weighted moving average
const ACUTE_TC = 7;    // days
const CHRONIC_TC = 28; // days

const acuteDecay = Math.exp(-1 / ACUTE_TC);
const chronicDecay = Math.exp(-1 / CHRONIC_TC);

// Update daily
acuteLoad = acuteLoad * acuteDecay + todayTSS * (1 - acuteDecay);
chronicLoad = chronicLoad * chronicDecay + todayTSS * (1 - chronicDecay);

const ratio = acuteLoad / chronicLoad;
```

**Source**: Gabbett (2016)  
**Safe Zone**: 0.8-1.3  
**Danger Zone**: >1.5 or <0.8

---

### 6. Running Economy
```typescript
// Estimate from HR and pace
const hrReserve = (avgHR - restingHR) / (maxHR - restingHR);
const estimatedVO2 = hrReserve * VO2max; // ml/kg/min
const speed = 1000 / (pace * 60); // m/min
const runningEconomy = estimatedVO2 / speed; // ml/kg/km
```

**Source**: Barnes & Kilding (2015)  
**Typical Values**: 180-230 ml/kg/km (lower is better)

---

### 7. Heart Rate Zones
```typescript
const zones = {
  recovery:     { min: 0.50 * maxHR, max: 0.60 * maxHR },
  easy:         { min: 0.60 * maxHR, max: 0.70 * maxHR },
  steady:       { min: 0.70 * maxHR, max: 0.80 * maxHR },
  tempo:        { min: 0.80 * maxHR, max: 0.87 * maxHR },
  threshold:    { min: 0.87 * maxHR, max: 0.92 * maxHR },
  vo2max:       { min: 0.92 * maxHR, max: 0.97 * maxHR },
  neuromuscular:{ min: 0.97 * maxHR, max: 1.00 * maxHR }
};
```

**Source**: Multiple (Daniels, Seiler, Coggan)

---

### 8. Injury Risk Score
```typescript
const injuryRisk = (acwr: number): number => {
  if (acwr > 1.5) return 0.8;      // High risk
  if (acwr > 1.3) return 0.6;      // Moderate risk  
  if (acwr < 0.8) return 0.4;      // Undertraining risk
  return 0.2;                      // Low risk
};
```

**Source**: Gabbett (2016), Hulin et al. (2014)

---

### 9. Taper Calculations
```typescript
// Exponential taper with 50% volume reduction
const taperWeeks = 2;
const normalVolume = 100;
const taperVolume = (week: number) => {
  const progress = week / taperWeeks;
  return normalVolume * (1 - 0.5 * progress);
};
```

**Source**: Bosquet et al. (2007)

---

### 10. Weekly Volume Progression
```typescript
// Safe progression with built-in recovery weeks
const weeklyVolume = (week: number, baseVolume: number) => {
  const isRecoveryWeek = week % 4 === 0;
  if (isRecoveryWeek) return baseVolume * 0.6;
  
  const progression = Math.min(week * 0.1, 0.5); // Max 50% increase
  return baseVolume * (1 + progression);
};
```

**Source**: 10% rule (Nielsen et al., 2012)

---

## Training Distribution

### Polarized Model (80/20)
```typescript
const weeklyMinutes = 300; // example
const distribution = {
  easy:      weeklyMinutes * 0.80,  // Zone 1-2
  moderate:  weeklyMinutes * 0.05,  // Zone 3 (minimal)
  hard:      weeklyMinutes * 0.15   // Zone 4-5
};
```

**Source**: Seiler (2010)

---

## Phase Distribution
```typescript
const phaseDistribution = {
  'FIRST_5K': { base: 0.40, build: 0.30, peak: 0.20, taper: 0.10 },
  'MARATHON': { base: 0.30, build: 0.30, peak: 0.30, taper: 0.10 }
};
```

**Source**: Bompa & Haff (2009)

---

## Utility Functions

### Pace Conversion
```typescript
// Min/km to km/h
const paceToSpeed = (pace: number) => 60 / pace;

// Seconds to MM:SS
const formatPace = (seconds: number) => {
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
};
```

### Training Age
```typescript
const trainingAge = (firstRunDate: Date) => {
  const days = differenceInDays(new Date(), firstRunDate);
  return days / 365; // years
};
```

---

## Constants

```typescript
const ADAPTATION_TIMELINE = {
  neuromuscular: 7,      // days
  anaerobic: 14,
  aerobic_power: 21,
  aerobic_capacity: 28,
  mitochondrial: 42,
  capillarization: 56
};

const MAX_WEEKLY_INCREASE = 0.10;  // 10%
const RECOVERY_WEEK_FACTOR = 0.60; // 60% of normal volume
const TAPER_REDUCTION = 0.50;      // 50% volume reduction
```

---

*All calculations are implemented in `/services/advancedTrainingPlanService.ts`*