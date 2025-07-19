# Training Implementation Guide

This document maps scientific sources to specific implementations in the Advanced Training Plan Service.

## Code-to-Science Mapping

### 1. VDOT Calculation
**Location**: `services/advancedTrainingPlanService.ts` - `calculateVDOT()` method (lines 424-454)

**Implementation**:
```typescript
// Simplified VDOT calculation based on Daniels' formula
const velocity = distance / time;
const vo2 = -4.6 + 0.182258 * velocity * 60 + 0.000104 * Math.pow(velocity * 60, 2);
const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * time) + 0.2989558 * Math.exp(-0.1932605 * time);
return vo2 / percentMax;
```

**Source**: Daniels, J. (2014). *Daniels' Running Formula*, Chapter 2: "Aerobic Profile"

---

### 2. Critical Speed Calculation
**Location**: `services/advancedTrainingPlanService.ts` - `calculateCriticalSpeed()` method (lines 459-480)

**Implementation**:
```typescript
// 2-parameter hyperbolic model
const cs = (d2 - d1) / (t2 - t1);
return cs * 3.6; // Convert to km/h
```

**Source**: Jones & Vanhatalo (2017). "The 'critical power' concept", Sports Medicine

---

### 3. Training Stress Score (TSS)
**Location**: `services/advancedTrainingPlanService.ts` - `calculateTSS()` method (lines 540-546)

**Implementation**:
```typescript
// TSS = duration * intensity^2 * 100 / 60
return (duration * Math.pow(intensity, 2) * 100) / 60;
```

**Source**: Coggan & Allen (2010). *Training and Racing with a Power Meter*

---

### 4. Running Economy Estimation
**Location**: `services/advancedTrainingPlanService.ts` - `estimateRunningEconomy()` method (lines 485-503)

**Implementation**:
- Uses heart rate reserve to estimate VO2
- Calculates ml/kg/km based on pace and estimated oxygen consumption

**Source**: Barnes & Kilding (2015). "Running economy: Measurement, norms, and determining factors"

---

### 5. Acute:Chronic Workload Ratio
**Location**: `services/advancedTrainingPlanService.ts` - `calculateTrainingLoad()` method (lines 508-535)

**Implementation**:
```typescript
const acuteDecay = Math.exp(-1 / 7);
const chronicDecay = Math.exp(-1 / 28);
// EWMA calculation for both acute and chronic loads
```

**Source**: Gabbett (2016). "The training—injury prevention paradox", BJSM

---

### 6. Periodization Structure
**Location**: `services/advancedTrainingPlanService.ts` - `designPeriodizedTrainingBlocks()` method (lines 551-585)

**Phases Implemented**:
- Base (40% for beginners)
- Build (35%)
- Peak (20-30%)
- Taper (10%)

**Source**: Issurin (2016). *Building the Modern Athlete*

---

### 7. Polarized Training Distribution
**Location**: `services/advancedTrainingPlanService.ts` - `generateMicrocycle()` method (lines 697-744)

**Implementation**:
```typescript
// Polarized distribution: 80% easy, 20% hard
const easyLoad = weeklyLoad * 0.8;
const hardLoad = weeklyLoad * 0.2;
```

**Source**: Seiler (2010). "What is best practice for training intensity distribution"

---

### 8. Training Zones
**Location**: `services/advancedTrainingPlanService.ts` - `TRAINING_ZONES` constant (lines 111-119)

**Zones Based on**:
- Recovery: RPE 1, HR 50-60%
- Easy: RPE 2, HR 60-70%
- Steady: RPE 3, HR 70-80%
- Tempo: RPE 4, HR 80-87%
- Threshold: RPE 5, HR 87-92%
- VO2 Max: RPE 6, HR 92-97%
- Neuromuscular: RPE 7, HR 97-100%

**Sources**: 
- Daniels (2014) for pace zones
- Coggan & Allen (2010) for power-based zones
- Seiler (2010) for physiological markers

---

### 9. Workout Templates
**Location**: `services/advancedTrainingPlanService.ts` - `ADVANCED_WORKOUTS` object (lines 122-338)

**Evidence-Based Workouts**:

#### Lactate Threshold Workout
```typescript
LACTATE_THRESHOLD: {
  segments: [
    { duration: 20, intensity: 88, zone: 'Threshold' },
    // 2x20min at threshold with recovery
  ]
}
```
**Source**: Billat et al. (1999). "The concept of maximal lactate steady state"

#### VO2max Intervals
```typescript
VO2MAX_INTERVALS: {
  segments: [
    { duration: 3, intensity: 95, zone: 'VO2 Max' },
    // 4x3min at 95% with equal recovery
  ]
}
```
**Source**: Billat (2001). "Interval training for performance"

---

### 10. Adaptation Timeline
**Location**: `services/advancedTrainingPlanService.ts` - `ADAPTATION_TIMELINE` constant (lines 100-107)

```typescript
const ADAPTATION_TIMELINE = {
  neuromuscular: 7,      // days
  anaerobic: 14,
  aerobic_power: 21,
  aerobic_capacity: 28,
  mitochondrial: 42,
  capillarization: 56,
};
```

**Source**: Various physiological adaptation studies compiled in Bompa & Haff (2009)

---

## Best Practices Implemented

### 1. Recovery Week Protocol
**Implementation**: Every 4th week at 60% volume
**Source**: Bompa & Haff (2009) - 3:1 loading pattern

### 2. Taper Protocol
**Implementation**: 50% volume reduction over taper phase
**Source**: Bosquet et al. (2007). "Effects of tapering on performance: A meta-analysis"

### 3. Progression Rates
**Implementation**: 10% weekly increase maximum
**Source**: Nielsen et al. (2012). "Training errors and running related injuries"

### 4. Workout Spacing
**Implementation**: 48+ hours between hard sessions
**Source**: Laursen (2010). "Training for intense exercise performance"

---

## Validation Studies

The following studies validate our approach:

1. **Stöggl & Sperlich (2014)** - Showed polarized training superior to threshold training
2. **Muñoz et al. (2014)** - Validated 80/20 distribution in elite runners
3. **Gabbett et al. (2016)** - Confirmed A:C ratio predictive validity
4. **Buchheit (2014)** - Validated HRV-guided training adjustments

---

## Future Research Integration

Areas for continued improvement based on emerging research:

1. **Wearable Integration**
   - Real HRV data (Plews et al., 2013 protocols)
   - Running power metrics (Stryd validation studies)

2. **Machine Learning**
   - Performance prediction models (Claudino et al., 2019)
   - Injury risk ML models (Rossi et al., 2018)

3. **Environmental Factors**
   - Heat adaptation protocols (Tyler et al., 2016)
   - Altitude training responses (Chapman et al., 2014)

---

*This guide ensures our implementation maintains scientific rigor while providing practical training solutions.*