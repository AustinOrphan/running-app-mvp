import { describe, it, expect } from 'vitest';
import { AdvancedTrainingPlanService } from '../../../services/advancedTrainingPlanService';

describe('AdvancedTrainingPlanService - TSS Calculations', () => {
  describe('calculateTSS', () => {
    // TSS Formula: (duration * intensity^2 / 60) * 100
    // Where intensity is effort/10 (normalized to 0-1 range)

    it('should calculate TSS for easy run (10km at 6 min/km = 3600 sec, effort 4)', () => {
      // Easy run: 3600 seconds (60 minutes), 10km (6 min/km pace)
      // paceMinPerKm = 3600 / 60 / 10 = 6
      // Pace 5.5-6.5: effort = 4, intensity = 0.4
      // TSS = (3600 * 0.16 / 60) * 100 = (576 / 60) * 100 = 960
      const run = {
        distance: 10,
        duration: 3600,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(960, 5);
    });

    it('should calculate TSS for tempo run (6.5km at 4.3 min/km = 1680 sec, effort 8)', () => {
      // Tempo run: 1680 seconds (~28 minutes), 6.5km (4.31 min/km pace)
      // paceMinPerKm = 1680 / 60 / 6.5 ≈ 4.31
      // Pace 4.0-4.5: effort = 8, intensity = 0.8
      // TSS = (1680 * 0.64 / 60) * 100 ≈ 1792
      const run = {
        distance: 6.5,
        duration: 1680,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(1792, 10);
    });

    it('should calculate TSS for interval run (5km at 3.5 min/km = 1050 sec, effort 10)', () => {
      // Interval run: 1050 seconds (17.5 minutes), 5km (3.5 min/km pace)
      // paceMinPerKm = 1050 / 60 / 5 = 3.5
      // Pace < 4.0: effort = 10, intensity = 1.0
      // TSS = (1050 * 1.0 / 60) * 100 = 1750
      const run = {
        distance: 5,
        duration: 1050,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(1750, 10);
    });

    it('should calculate TSS for short recovery run (4km at 7 min/km = 1680 sec, effort 2)', () => {
      // Recovery run: 1680 seconds (28 minutes), 4km (7 min/km pace)
      // paceMinPerKm = 1680 / 60 / 4 = 7
      // Pace > 6.5: effort = 2, intensity = 0.2
      // TSS = (1680 * 0.04 / 60) * 100 = 112
      const run = {
        distance: 4,
        duration: 1680,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(112, 5);
    });

    it('should calculate TSS for long run (15km at 6 min/km = 5400 sec, effort 4)', () => {
      // Long run: 5400 seconds (90 minutes), 15km (6 min/km pace)
      // paceMinPerKm = 5400 / 60 / 15 = 6
      // Pace 5.5-6.5: effort = 4, intensity = 0.4
      // TSS = (5400 * 0.16 / 60) * 100 = 1440
      const run = {
        distance: 15,
        duration: 5400,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(1440, 10);
    });

    it('should calculate TSS for threshold workout (7.5km at 4.0 min/km = 1800 sec, effort 8)', () => {
      // Threshold workout: 1800 seconds (30 minutes), 7.5km (4.0 min/km pace)
      // paceMinPerKm = 1800 / 60 / 7.5 = 4.0
      // Pace 4.0-4.5: effort = 8, intensity = 0.8
      // TSS = (1800 * 0.64 / 60) * 100 = 1920
      const run = {
        distance: 7.5,
        duration: 1800,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(1920, 10);
    });

    it('should scale TSS with duration proportionally at same pace', () => {
      // Same pace/intensity, but double duration should approximately double TSS
      const run1 = {
        distance: 5,
        duration: 1200, // 4 min/km (5km in 20 minutes)
      };

      const run2 = {
        distance: 10,
        duration: 2400, // same pace (4 min/km), double duration, double distance
      };

      const tss1 = AdvancedTrainingPlanService.calculateTSS(run1);
      const tss2 = AdvancedTrainingPlanService.calculateTSS(run2);

      expect(tss2).toBeCloseTo(tss1 * 2, 10);
    });

    it('should increase TSS with intensity exponentially', () => {
      // Higher intensity should dramatically increase TSS for same duration
      const easyRun = {
        distance: 10,
        duration: 3600, // 6 min/km, effort 4
      };

      const hardRun = {
        distance: 5,
        duration: 1080, // 3.6 min/km, effort 10
      };

      const easyTss = AdvancedTrainingPlanService.calculateTSS(easyRun);
      const hardTss = AdvancedTrainingPlanService.calculateTSS(hardRun);

      expect(hardTss).toBeGreaterThan(easyTss);
    });
  });

  describe('Pace Zone Classifications', () => {
    it('should classify very fast pace as high effort (effort 10)', () => {
      // Pace < 4.0 min/km
      const run = {
        distance: 5,
        duration: 1140, // 5km in 1140 sec (19 min) = 3.8 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // paceMinPerKm = 1140 / 60 / 5 = 3.8
      // effort = 10, intensity = 1.0, TSS = (1140 * 1.0 / 60) * 100 = 1900
      expect(tss).toBeCloseTo(1900, 10);
    });

    it('should classify fast pace as high effort (effort 8)', () => {
      // Pace 4.0-4.5 min/km
      const run = {
        distance: 6.5,
        duration: 1620, // 6.5km in 1620 sec (27 min) = 4.15 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // paceMinPerKm = 1620 / 60 / 6.5 ≈ 4.15
      // effort = 8, intensity = 0.8, TSS = (1620 * 0.64 / 60) * 100 = 1728
      expect(tss).toBeCloseTo(1728, 10);
    });

    it('should classify moderate pace as medium effort (effort 6)', () => {
      // Pace 4.5-5.5 min/km
      const run = {
        distance: 10,
        duration: 3120, // 10km in 3120 sec (52 min) = 5.2 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // paceMinPerKm = 3120 / 60 / 10 = 5.2
      // effort = 6, intensity = 0.6, TSS = (3120 * 0.36 / 60) * 100 = 1872
      expect(tss).toBeCloseTo(1872, 10);
    });

    it('should classify easy pace as low effort (effort 4)', () => {
      // Pace 5.5-6.5 min/km
      const run = {
        distance: 10,
        duration: 3720, // 10km in 3720 sec (62 min) = 6.2 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // paceMinPerKm = 3720 / 60 / 10 = 6.2
      // effort = 4, intensity = 0.4, TSS = (3720 * 0.16 / 60) * 100 = 992
      expect(tss).toBeCloseTo(992, 10);
    });

    it('should classify very easy pace as very low effort (effort 2)', () => {
      // Pace > 6.5 min/km
      const run = {
        distance: 10,
        duration: 4500, // 10km in 4500 sec (75 min) = 7.5 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // paceMinPerKm = 4500 / 60 / 10 = 7.5
      // effort = 2, intensity = 0.2, TSS = (4500 * 0.04 / 60) * 100 = 300
      expect(tss).toBeCloseTo(300, 10);
    });
  });

  describe('TSS Edge Cases', () => {
    it('should handle minimum reasonable workout', () => {
      const run = {
        distance: 1,
        duration: 10, // 10-minute run
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeGreaterThan(0);
      expect(tss).toBeLessThan(100);
    });

    it('should handle maximum intensity run', () => {
      const run = {
        distance: 3,
        duration: 12, // Very fast run: 3km in 12 min = 4 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeGreaterThan(0);
    });
  });
});

describe('VDOT Calculations', () => {
  describe('calculateVDOT', () => {
    it('calculates VDOT for a 5K race performance (20 minutes)', () => {
      const runs = [
        {
          distance: 5.0,
          duration: 1200, // 20 minutes
          notes: 'race',
        },
      ];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      // 5K in 20 min = 4:00/km pace = elite level VDOT ~59
      expect(vdot).toBeGreaterThan(55);
      expect(vdot).toBeLessThan(62);
    });

    it('calculates VDOT for a Marathon race (3:30)', () => {
      const runs = [
        {
          distance: 42.195,
          duration: 12600, // 3.5 hours
          notes: 'race',
        },
      ];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      expect(vdot).toBeGreaterThan(42);
      expect(vdot).toBeLessThan(46);
    });

    it('estimates VDOT from fastest regular runs when no race data available', () => {
      const runs = [
        {
          distance: 10.0,
          duration: 3600, // 60 min = 6:00/km pace
        },
        {
          distance: 5.0,
          duration: 1800, // 30 min = 6:00/km pace
        },
        {
          distance: 8.0,
          duration: 2400, // 40 min = 5:00/km pace
        },
      ];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      expect(vdot).toBeGreaterThan(0);
      expect(vdot).toBeLessThan(100);
    });

    it('returns default VDOT for beginners with insufficient data', () => {
      const runs = [
        {
          distance: 2.0, // Too short
          duration: 600,
        },
      ];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      expect(vdot).toBe(35);
    });

    it('handles empty runs array with default VDOT', () => {
      const runs: any[] = [];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      expect(vdot).toBe(35);
    });

    it('filters runs by effort level for race-based VDOT calculation', () => {
      const runs = [
        {
          distance: 5.0,
          duration: 2400, // 40 min = 8:00/km (easy pace)
        },
        {
          distance: 5.0,
          duration: 1200, // 20 min = 4:00/km (hard/race pace)
          notes: 'race',
        },
      ];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      expect(vdot).toBeGreaterThan(40);
    });

    it('calculates VDOT from 10K performance (40 minutes)', () => {
      const runs = [
        {
          distance: 10.0,
          duration: 2400, // 40 minutes = 4:00/km pace
          notes: 'time trial',
        },
      ];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      // 10K in 40 min = 4:00/km pace = same as 5K in 20 min, so similar VDOT
      expect(vdot).toBeGreaterThan(55);
      expect(vdot).toBeLessThan(62);
    });

    it('handles multiple runs and uses fastest relevant one', () => {
      const runs = [
        {
          distance: 5.0,
          duration: 1800, // 30 min = 6:00/km
        },
        {
          distance: 5.0,
          duration: 1500, // 25 min = 5:00/km
        },
        {
          distance: 5.0,
          duration: 1200, // 20 min = 4:00/km
          notes: 'race',
        },
      ];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      expect(vdot).toBeGreaterThan(48);
    });
  });

  describe('VDOT edge cases', () => {
    it('calculates VDOT from ultra-long runs', () => {
      const runs = [
        {
          distance: 50.0, // Ultra distance
          duration: 18000, // 5 hours
          notes: 'race',
        },
      ];

      const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);

      expect(vdot).toBeGreaterThan(0);
    });
  });
});

describe('Training Pace Zones', () => {
  describe('calculateZonePaces', () => {
    it('calculates training paces for VDOT 50', () => {
      const vdot = 50;

      const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);

      expect(paces).toHaveProperty('recovery');
      expect(paces).toHaveProperty('easy');
      expect(paces).toHaveProperty('steady');
      expect(paces).toHaveProperty('tempo');
      expect(paces).toHaveProperty('threshold');
      expect(paces).toHaveProperty('vo2max');
    });

    it('ensures recovery pace is slowest', () => {
      const vdot = 45;
      const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);

      const recoveryMax = paces.recovery.max;
      const easyMax = paces.easy.max;

      expect(recoveryMax).toBeGreaterThan(easyMax);
    });

    it('ensures VO2Max pace is fastest', () => {
      const vdot = 45;
      const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);

      const vo2maxMin = paces.vo2max.min;
      const thresholdMin = paces.threshold.min;

      expect(vo2maxMin).toBeLessThan(thresholdMin);
    });

    it('calculates proper pace ranges for different VDOT levels', () => {
      const lowVDOT = AdvancedTrainingPlanService['getDefaultZonePaces'](35);
      const highVDOT = AdvancedTrainingPlanService['getDefaultZonePaces'](55);

      // Higher VDOT should have faster easy pace
      expect(lowVDOT.easy.max).toBeGreaterThan(highVDOT.easy.max);
    });

    it('maintains monotonic decrease in pace as intensity increases', () => {
      const vdot = 50;
      const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);

      const zones = [
        { name: 'recovery', paces: paces.recovery },
        { name: 'easy', paces: paces.easy },
        { name: 'steady', paces: paces.steady },
        { name: 'tempo', paces: paces.tempo },
        { name: 'threshold', paces: paces.threshold },
        { name: 'vo2max', paces: paces.vo2max },
      ];

      for (let i = 0; i < zones.length - 1; i++) {
        const currentMax = zones[i].paces.max;
        const nextMin = zones[i + 1].paces.min;

        expect(currentMax).toBeGreaterThanOrEqual(nextMin);
      }
    });

    it('returns valid pace values (min < max for each zone)', () => {
      const vdot = 48;
      const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);

      const zoneEntries = Object.entries(paces);
      for (const [, zone] of zoneEntries) {
        expect(zone.min).toBeLessThan(zone.max);
        expect(zone.min).toBeGreaterThan(0);
        expect(zone.max).toBeGreaterThan(0);
      }
    });

    it('calculates different paces for VDOT 40 vs VDOT 60', () => {
      const paces40 = AdvancedTrainingPlanService['getDefaultZonePaces'](40);
      const paces60 = AdvancedTrainingPlanService['getDefaultZonePaces'](60);

      // VDOT 40 should have slower easy pace than VDOT 60
      expect(paces40.easy.min).toBeGreaterThan(paces60.easy.min);
      expect(paces40.easy.max).toBeGreaterThan(paces60.easy.max);
    });
  });

  describe('Pace zone consistency', () => {
    it('returns consistent pace ranges for same VDOT', () => {
      const vdot = 50;
      const paces1 = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);
      const paces2 = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);

      expect(paces1).toEqual(paces2);
    });

    it('handles very low VDOT (beginner)', () => {
      const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](30);

      // For VDOT 30: easyPace = 10.5 - (30 - 30) * 0.1 = 10.5
      // easy.max = easyPace + 1 = 11.5
      expect(paces.easy.max).toBeLessThan(12);
      expect(Object.keys(paces).length).toBe(6);
    });

    it('handles very high VDOT (elite)', () => {
      const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](70);

      expect(paces.vo2max.max).toBeGreaterThan(0);
      expect(paces.vo2max.min).toBeGreaterThan(0);
    });
  });
});

describe('Integration: VDOT to Training Paces', () => {
  it('calculates complete training zones from race performance', () => {
    const runs = [
      {
        distance: 5.0,
        duration: 1200,
        notes: 'race',
      },
    ];

    const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);
    const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);

    expect(vdot).toBeGreaterThan(55);
    // For high VDOT (59.3): easyPace = 10.5 - (59.3 - 30) * 0.1 = 7.57
    // easy.min = 7.57, easy.max = 8.57
    expect(paces.easy.min).toBeGreaterThan(4);
    expect(paces.easy.max).toBeLessThan(9);
  });

  it('generates realistic training plan paces for intermediate runner', () => {
    const runs = [
      {
        distance: 10.0,
        duration: 2400, // 40 min = 4:00/km pace
        notes: 'time trial',
      },
    ];

    const vdot = AdvancedTrainingPlanService['calculateVDOT'](runs);
    const paces = AdvancedTrainingPlanService['getDefaultZonePaces'](vdot);

    // For 10K in 40min (VDOT ~59.3): easyPace = 7.57 min/km = 454 seconds/km
    // Elite runners have easy pace close to race pace (easy pace/race pace ~1.9x slower)
    const racePace = 2400 / 10.0; // 240 seconds per km = 4:00/km
    const easyPaceMin = paces.easy.min * 60; // Convert to seconds

    expect(easyPaceMin).toBeGreaterThan(racePace);
    // Elite runners run easy at ~1.9x race pace, so 240 * 1.9 = 456 seconds
    expect(easyPaceMin).toBeLessThan(racePace * 2);
  });
});
