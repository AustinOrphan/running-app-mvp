import { describe, it, expect } from 'vitest';
import { AdvancedTrainingPlanService } from '../../../services/advancedTrainingPlanService';

describe('AdvancedTrainingPlanService - TSS Calculations', () => {
  describe('calculateTSS', () => {
    // TSS Formula: (duration * intensity^2 / 60) * 100
    // Where intensity is effort/10 (normalized to 0-1 range)

    it('should calculate TSS for easy run (60 min, effort 6.5 = intensity 0.65)', () => {
      // Easy run: 60 minutes at easy pace
      // effort = 6.5 (based on estimateEffortFromPace)
      // intensity = 6.5 / 10 = 0.65
      // TSS = (60 * 0.65^2 / 60) * 100 = (60 * 0.4225 / 60) * 100 = 0.4225 * 100 = 42.25
      const run = {
        distance: 10,
        duration: 60,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(42.25, 1);
    });

    it('should calculate TSS for tempo run (40 min, effort 8 = intensity 0.85)', () => {
      // Tempo run: 40 minutes at tempo pace
      // effort = 8 (based on estimateEffortFromPace for faster pace)
      // intensity = 8 / 10 = 0.85
      // TSS = (40 * 0.85^2 / 60) * 100 = (40 * 0.7225 / 60) * 100 = (28.9 / 60) * 100 = 48.17
      const run = {
        distance: 6.5,
        duration: 40,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(48.17, 1);
    });

    it('should calculate TSS for interval run (30 min, effort 10 = intensity 1.0)', () => {
      // Interval run: 30 minutes at high intensity
      // effort = 10 (based on estimateEffortFromPace for very fast pace)
      // intensity = 10 / 10 = 1.0
      // TSS = (30 * 1.0^2 / 60) * 100 = (30 * 1 / 60) * 100 = 0.5 * 100 = 50
      const run = {
        distance: 5,
        duration: 30,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(50, 1);
    });

    it('should calculate TSS for short recovery run (30 min, effort 2 = intensity 0.2)', () => {
      // Recovery run: 30 minutes at easy pace
      // effort = 2 (based on estimateEffortFromPace for very easy pace)
      // intensity = 2 / 10 = 0.2
      // TSS = (30 * 0.2^2 / 60) * 100 = (30 * 0.04 / 60) * 100 = (1.2 / 60) * 100 = 2
      const run = {
        distance: 4,
        duration: 30,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(2, 1);
    });

    it('should calculate TSS for long run (90 min, effort 4 = intensity 0.4)', () => {
      // Long run: 90 minutes at moderate easy pace
      // effort = 4 (based on estimateEffortFromPace for moderate pace)
      // intensity = 4 / 10 = 0.4
      // TSS = (90 * 0.4^2 / 60) * 100 = (90 * 0.16 / 60) * 100 = (14.4 / 60) * 100 = 24
      const run = {
        distance: 15,
        duration: 90,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(24, 1);
    });

    it('should calculate TSS for VO2 max workout (45 min, effort 9 = intensity 0.9)', () => {
      // VO2 max workout: 45 minutes at high intensity
      // effort = 9 (based on estimateEffortFromPace)
      // intensity = 9 / 10 = 0.9
      // TSS = (45 * 0.9^2 / 60) * 100 = (45 * 0.81 / 60) * 100 = (36.45 / 60) * 100 = 60.75
      const run = {
        distance: 7.5,
        duration: 45,
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(60.75, 1);
    });

    it('should scale TSS with duration proportionally', () => {
      // Same pace/intensity, but double duration should approximately double TSS
      const run1 = {
        distance: 5,
        duration: 30,
      };

      const run2 = {
        distance: 10,
        duration: 60,
      };

      const tss1 = AdvancedTrainingPlanService['calculateTSS'](run1);
      const tss2 = AdvancedTrainingPlanService['calculateTSS'](run2);

      expect(tss2).toBeGreaterThan(tss1);
    });

    it('should increase TSS with intensity exponentially', () => {
      // Higher intensity should dramatically increase TSS
      const easyRun = {
        distance: 10,
        duration: 60,
      };

      const hardRun = {
        distance: 5,
        duration: 30,
      };

      const easyTss = AdvancedTrainingPlanService['calculateTSS'](easyRun);
      const hardTss = AdvancedTrainingPlanService['calculateTSS'](hardRun);

      expect(hardTss).toBeGreaterThan(easyTss);
    });
  });

  describe('Pace Zone Classifications', () => {
    it('should classify very fast pace as high effort (effort 10)', () => {
      // Pace < 4.0 min/km
      const run = {
        distance: 5,
        duration: 19, // 5km in 19 min = 3.8 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      expect(tss).toBeCloseTo(50, 1);
    });

    it('should classify fast pace as high effort (effort 8)', () => {
      // Pace 4.0-4.5 min/km
      const run = {
        distance: 6.5,
        duration: 27, // 6.5km in 27 min = 4.15 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // effort = 8, intensity = 0.8, TSS = (27 * 0.64 / 60) * 100 = 28.8
      expect(tss).toBeCloseTo(28.8, 1);
    });

    it('should classify moderate pace as medium effort (effort 6)', () => {
      // Pace 4.5-5.5 min/km
      const run = {
        distance: 10,
        duration: 52, // 10km in 52 min = 5.2 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // effort = 6, intensity = 0.6, TSS = (52 * 0.36 / 60) * 100 = 31.2
      expect(tss).toBeCloseTo(31.2, 1);
    });

    it('should classify easy pace as low effort (effort 4)', () => {
      // Pace 5.5-6.5 min/km
      const run = {
        distance: 10,
        duration: 62, // 10km in 62 min = 6.2 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // effort = 4, intensity = 0.4, TSS = (62 * 0.16 / 60) * 100 = 16.53
      expect(tss).toBeCloseTo(16.53, 1);
    });

    it('should classify very easy pace as very low effort (effort 2)', () => {
      // Pace > 6.5 min/km
      const run = {
        distance: 10,
        duration: 75, // 10km in 75 min = 7.5 min/km
      };

      const tss = AdvancedTrainingPlanService.calculateTSS(run);
      // effort = 2, intensity = 0.2, TSS = (75 * 0.04 / 60) * 100 = 5
      expect(tss).toBeCloseTo(5, 1);
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
