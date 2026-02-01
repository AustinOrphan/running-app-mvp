import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { AnalyticsService } from '../../../server/services/analyticsService.js';
import { prisma } from '../../setup/jestSetup.js';
import { createTestUser, createTestRuns } from '../../fixtures/testDatabase.js';

describe('AnalyticsService', () => {
  let userId: string;

  beforeAll(() => {
    // Set the Prisma instance for testing
    AnalyticsService.setPrismaInstance(prisma);
  });

  beforeEach(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  describe('getStatistics', () => {
    it('should aggregate weekly statistics correctly', async () => {
      // Create test runs for the past week
      const now = new Date();

      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Morning run',
        },
        {
          date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 10.0,
          duration: 3000,
          tag: 'long',
          notes: 'Weekend long run',
        },
        {
          date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 8.0,
          duration: 2400,
          tag: 'tempo',
          notes: 'Tempo run',
        },
      ]);

      const stats = await AnalyticsService.getStatistics(userId, 'weekly');

      expect(stats).toBeDefined();
      expect(stats.period).toBe('weekly');
      expect(stats.totalRuns).toBe(3);
      expect(stats.totalDistance).toBe(23.0);
      expect(stats.totalDuration).toBe(6900);
      expect(stats.avgPace).toBeCloseTo(5.0, 1); // 6900s / 23km = ~5 min/km
      expect(stats.longestRun).toBe(10.0);
      expect(stats.startDate).toBeDefined();
      expect(stats.endDate).toBeDefined();
    });

    it('should aggregate monthly statistics correctly', async () => {
      const now = new Date();
      // Create runs at the start and middle of current month
      const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 2);
      const midMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      await createTestRuns(userId, [
        {
          date: startOfCurrentMonth.toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Run 1',
        },
        {
          date: midMonth.toISOString(),
          distance: 10.0,
          duration: 3000,
          tag: 'long',
          notes: 'Run 2',
        },
      ]);

      const stats = await AnalyticsService.getStatistics(userId, 'monthly');

      expect(stats).toBeDefined();
      expect(stats.period).toBe('monthly');
      expect(stats.totalRuns).toBe(2);
      expect(stats.totalDistance).toBe(15.0);
      expect(stats.totalDuration).toBe(4500);
    });

    it('should calculate fastest pace correctly', async () => {
      const now = new Date();

      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500, // 5 min/km
          tag: 'tempo',
          notes: 'Fast run',
        },
        {
          date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 10.0,
          duration: 3600, // 6 min/km
          tag: 'easy',
          notes: 'Easy run',
        },
      ]);

      const stats = await AnalyticsService.getStatistics(userId, 'weekly');

      expect(stats.fastestPace).toBeCloseTo(5.0, 1); // Fastest is 5 min/km
      expect(stats.avgPace).toBeCloseTo(5.67, 1); // Average: (1500 + 3600) / (5 + 10)
    });

    it('should return zero values when no runs exist', async () => {
      const stats = await AnalyticsService.getStatistics(userId, 'weekly');

      expect(stats).toBeDefined();
      expect(stats.totalRuns).toBe(0);
      expect(stats.totalDistance).toBe(0);
      expect(stats.totalDuration).toBe(0);
      expect(stats.avgPace).toBe(0);
      expect(stats.fastestPace).toBe(0);
      expect(stats.longestRun).toBe(0);
    });

    it('should filter by yearly period correctly', async () => {
      const now = new Date();
      const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'This year',
        },
        {
          date: lastYear.toISOString(),
          distance: 10.0,
          duration: 3000,
          tag: 'long',
          notes: 'Last year',
        },
      ]);

      const stats = await AnalyticsService.getStatistics(userId, 'yearly');

      // Should only count current year run
      expect(stats.totalRuns).toBe(1);
      expect(stats.totalDistance).toBe(5.0);
    });
  });

  describe('edge cases', () => {
    it('should handle single run statistics', async () => {
      const now = new Date();

      await createTestRuns(userId, [
        {
          date: now.toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Solo run',
        },
      ]);

      const stats = await AnalyticsService.getStatistics(userId, 'weekly');

      expect(stats.totalRuns).toBe(1);
      expect(stats.totalDistance).toBe(5.0);
      expect(stats.avgPace).toBeCloseTo(5.0, 1);
      expect(stats.fastestPace).toBeCloseTo(5.0, 1);
      expect(stats.longestRun).toBe(5.0);
    });

    it('should handle runs with heart rate data', async () => {
      const now = new Date();

      const runs = await createTestRuns(userId, [
        {
          date: now.toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'With HR',
        },
      ]);

      // Add heart rate detail
      await prisma.runDetail.create({
        data: {
          runId: runs[0].id,
          avgHeartRate: 150,
          maxHeartRate: 170,
        },
      });

      const stats = await AnalyticsService.getStatistics(userId, 'weekly');

      expect(stats.avgHeartRate).toBe(150);
      expect(stats.maxHeartRate).toBe(170);
    });

    it('should handle runs with elevation data', async () => {
      const now = new Date();

      const runs = await createTestRuns(userId, [
        {
          date: now.toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'trail',
          notes: 'Hilly run',
        },
        {
          date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 10.0,
          duration: 3000,
          tag: 'trail',
          notes: 'Mountain run',
        },
      ]);

      // Add elevation details
      await prisma.runDetail.create({
        data: {
          runId: runs[0].id,
          elevationGain: 100,
          elevationLoss: 95,
        },
      });

      await prisma.runDetail.create({
        data: {
          runId: runs[1].id,
          elevationGain: 250,
          elevationLoss: 245,
        },
      });

      const stats = await AnalyticsService.getStatistics(userId, 'weekly');

      expect(stats.totalElevation).toBe(350); // Sum of elevation gain
    });
  });

  describe('getTrends', () => {
    it('should calculate improving pace trend', async () => {
      const now = new Date();

      // Create runs with improving pace (getting faster)
      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1800, // 6 min/km
          tag: 'easy',
          notes: 'Week 3',
        },
        {
          date: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1650, // 5.5 min/km
          tag: 'easy',
          notes: 'Week 2',
        },
        {
          date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500, // 5 min/km
          tag: 'easy',
          notes: 'Week 1',
        },
      ]);

      const trends = await AnalyticsService.getTrends(userId, 'weekly', 3);

      expect(trends).toBeDefined();
      expect(trends.period).toBe('weekly');
      expect(trends.dataPoints).toBe(3);
      expect(trends.paceTrend).toBe('improving');
      expect(trends.paceChangePercent).toBeLessThan(0); // Negative = faster
      expect(trends.consistencyScore).toBeGreaterThan(0);
    });

    it('should calculate declining pace trend', async () => {
      const now = new Date();

      // Create runs with declining pace (getting slower)
      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500, // 5 min/km
          tag: 'easy',
          notes: 'Week 3',
        },
        {
          date: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1650, // 5.5 min/km
          tag: 'easy',
          notes: 'Week 2',
        },
        {
          date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1800, // 6 min/km
          tag: 'easy',
          notes: 'Week 1',
        },
      ]);

      const trends = await AnalyticsService.getTrends(userId, 'weekly', 3);

      expect(trends.paceTrend).toBe('declining');
      expect(trends.paceChangePercent).toBeGreaterThan(0); // Positive = slower
    });

    it('should calculate increasing volume trend', async () => {
      const now = new Date();

      // Create runs with increasing weekly mileage
      // Use specific Wednesday dates to ensure they're in different calendar weeks
      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Week 2',
        },
        {
          date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 10.0,
          duration: 3000,
          tag: 'long',
          notes: 'Week 1',
        },
        {
          date: now.toISOString(),
          distance: 15.0,
          duration: 4500,
          tag: 'long',
          notes: 'This week',
        },
      ]);

      const trends = await AnalyticsService.getTrends(userId, 'weekly', 3);

      // Volume should be increasing: 5 → (10 + 15)/2 = 5 → 12.5
      expect(trends.volumeTrend).toBe('increasing');
      expect(trends.volumeChangePercent).toBeGreaterThan(0);
    });

    it('should calculate consistency score', async () => {
      const now = new Date();

      // Create consistent runs (one per week)
      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Week 3',
        },
        {
          date: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Week 2',
        },
        {
          date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Week 1',
        },
      ]);

      const trends = await AnalyticsService.getTrends(userId, 'weekly', 3);

      expect(trends.consistencyScore).toBeGreaterThan(0);
      expect(trends.consistencyScore).toBeLessThanOrEqual(1);
    });

    it('should handle stable trends', async () => {
      const now = new Date();

      // Create runs with stable pace and volume
      // Use specific dates to ensure they're in different calendar weeks
      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Week 2',
        },
        {
          date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Week 1',
        },
        {
          date: now.toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'This week',
        },
      ]);

      const trends = await AnalyticsService.getTrends(userId, 'weekly', 3);

      expect(trends.paceTrend).toBe('stable');
      expect(trends.volumeTrend).toBe('stable');
      expect(Math.abs(trends.paceChangePercent)).toBeLessThan(5);
      expect(Math.abs(trends.volumeChangePercent)).toBeLessThan(5);
    });

    it('should handle monthly trends', async () => {
      const now = new Date();
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      await createTestRuns(userId, [
        {
          date: twoMonthsAgo.toISOString(),
          distance: 20.0,
          duration: 6000,
          tag: 'long',
          notes: 'Month 1',
        },
        {
          date: oneMonthAgo.toISOString(),
          distance: 25.0,
          duration: 7500,
          tag: 'long',
          notes: 'Month 2',
        },
        {
          date: thisMonth.toISOString(),
          distance: 30.0,
          duration: 9000,
          tag: 'long',
          notes: 'Month 3',
        },
      ]);

      const trends = await AnalyticsService.getTrends(userId, 'monthly', 3);

      expect(trends.period).toBe('monthly');
      expect(trends.dataPoints).toBe(3);
      expect(trends.volumeTrend).toBe('increasing');
    });
  });

  describe('generateInsights', () => {
    it('should generate consistency insight for good adherence', async () => {
      const now = new Date();

      // Create consistent runs (4 runs this week)
      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Run 1',
        },
        {
          date: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Run 2',
        },
        {
          date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Run 3',
        },
        {
          date: now.toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Run 4',
        },
      ]);

      const insights = await AnalyticsService.generateInsights(userId);

      expect(insights).toBeDefined();
      expect(Array.isArray(insights)).toBe(true);

      // Should have at least one consistency insight
      const consistencyInsights = insights.filter(i => i.type === 'consistency');
      expect(consistencyInsights.length).toBeGreaterThan(0);
      expect(consistencyInsights[0].priority).toBe('high');
    });

    it('should generate recovery warning for overtraining', async () => {
      const now = new Date();

      // Create runs every day (no rest days)
      const runs = [];
      for (let i = 0; i < 7; i++) {
        runs.push({
          date: new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: `Day ${i + 1}`,
        });
      }

      await createTestRuns(userId, runs);

      const insights = await AnalyticsService.generateInsights(userId);

      // Should have a recovery warning
      const recoveryInsights = insights.filter(i => i.type === 'recovery');
      expect(recoveryInsights.length).toBeGreaterThan(0);
      expect(recoveryInsights[0].priority).toBe('high');
      expect(recoveryInsights[0].message).toContain('rest');
    });

    it('should generate performance insight for pace improvement', async () => {
      const now = new Date();

      // Create runs showing pace improvement over 3 months
      // Need at least 6 runs for performance insights
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      await createTestRuns(userId, [
        // Month 1: slower pace (6 min/km)
        {
          date: new Date(twoMonthsAgo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1800,
          tag: 'easy',
          notes: 'Month 1 run 1',
        },
        {
          date: twoMonthsAgo.toISOString(),
          distance: 5.0,
          duration: 1800,
          tag: 'easy',
          notes: 'Month 1 run 2',
        },
        // Month 2: moderate pace (5.5 min/km)
        {
          date: new Date(oneMonthAgo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1650,
          tag: 'easy',
          notes: 'Month 2 run 1',
        },
        {
          date: oneMonthAgo.toISOString(),
          distance: 5.0,
          duration: 1650,
          tag: 'easy',
          notes: 'Month 2 run 2',
        },
        // Month 3: fast pace (5 min/km)
        {
          date: new Date(thisMonth.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Month 3 run 1',
        },
        {
          date: thisMonth.toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Month 3 run 2',
        },
      ]);

      const insights = await AnalyticsService.generateInsights(userId);

      // Should have a performance insight
      const performanceInsights = insights.filter(i => i.type === 'performance');
      expect(performanceInsights.length).toBeGreaterThan(0);
      expect(performanceInsights[0].message).toContain('improved');
    });

    it('should generate volume warning for sudden increase', async () => {
      const now = new Date();

      // Sudden increase from 10km/week to 30km/week
      await createTestRuns(userId, [
        // Two weeks ago: 10km total
        {
          date: new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 10.0,
          duration: 3000,
          tag: 'long',
          notes: 'Normal week',
        },
        // This week: 30km total (3x increase)
        {
          date: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 15.0,
          duration: 4500,
          tag: 'long',
          notes: 'Big week 1',
        },
        {
          date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 15.0,
          duration: 4500,
          tag: 'long',
          notes: 'Big week 2',
        },
      ]);

      const insights = await AnalyticsService.generateInsights(userId);

      // Should warn about volume increase
      const volumeInsights = insights.filter(i => i.type === 'volume');
      expect(volumeInsights.length).toBeGreaterThan(0);
      expect(volumeInsights[0].priority).toBe('high');
    });

    it('should return empty array when no runs exist', async () => {
      const insights = await AnalyticsService.generateInsights(userId);

      expect(insights).toBeDefined();
      expect(Array.isArray(insights)).toBe(true);
      expect(insights.length).toBe(0);
    });

    it('should sort insights by priority', async () => {
      const now = new Date();

      // Create runs that will trigger multiple insights
      await createTestRuns(userId, [
        {
          date: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Run 1',
        },
        {
          date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          distance: 5.0,
          duration: 1500,
          tag: 'easy',
          notes: 'Run 2',
        },
      ]);

      const insights = await AnalyticsService.generateInsights(userId);

      // High priority insights should come first
      const priorities = insights.map(i => i.priority);
      const highCount = priorities.filter(p => p === 'high').length;
      const mediumCount = priorities.filter(p => p === 'medium').length;
      const lowCount = priorities.filter(p => p === 'low').length;

      // Verify high priority comes before medium/low
      if (highCount > 0 && (mediumCount > 0 || lowCount > 0)) {
        const firstMediumOrLow = priorities.findIndex(p => p === 'medium' || p === 'low');
        const lastHigh = priorities.lastIndexOf('high');
        expect(lastHigh).toBeLessThan(firstMediumOrLow);
      }
    });
  });
});
