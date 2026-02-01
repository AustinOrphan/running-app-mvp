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
});
