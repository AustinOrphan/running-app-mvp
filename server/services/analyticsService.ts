import { PrismaClient } from '@prisma/client';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

// Default Prisma instance (can be overridden for testing)
let prismaInstance = new PrismaClient();

export interface AggregatedStats {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  startDate: Date;
  endDate: Date;
  totalRuns: number;
  totalDistance: number;
  totalDuration: number;
  avgPace: number;
  fastestPace: number;
  longestRun: number;
  totalElevation?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
}

export interface TrendAnalysis {
  period: string;
  dataPoints: number;
  paceTrend: 'improving' | 'stable' | 'declining';
  volumeTrend: 'increasing' | 'stable' | 'decreasing';
  paceChangePercent: number;
  volumeChangePercent: number;
  consistencyScore: number; // 0-1
}

export class AnalyticsService {
  /**
   * Set the Prisma instance (for testing)
   */
  static setPrismaInstance(instance: PrismaClient) {
    prismaInstance = instance;
  }

  /**
   * Get aggregated statistics for a user within a time period
   */
  static async getStatistics(
    userId: string,
    period: 'weekly' | 'monthly' | 'yearly'
  ): Promise<AggregatedStats> {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    // Determine date range based on period
    switch (period) {
      case 'weekly':
        startDate = startOfWeek(now, { weekStartsOn: 1 }); // Monday
        endDate = endOfWeek(now, { weekStartsOn: 1 });
        break;
      case 'monthly':
        startDate = startOfMonth(now);
        endDate = endOfMonth(now);
        break;
      case 'yearly':
        startDate = startOfYear(now);
        endDate = endOfYear(now);
        break;
      default:
        throw new Error(`Invalid period: ${period}`);
    }

    // Fetch runs within the date range
    const runs = await prismaInstance.run.findMany({
      where: {
        userId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        detail: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Return zeros if no runs found
    if (runs.length === 0) {
      return {
        period,
        startDate,
        endDate,
        totalRuns: 0,
        totalDistance: 0,
        totalDuration: 0,
        avgPace: 0,
        fastestPace: 0,
        longestRun: 0,
        totalElevation: undefined,
        avgHeartRate: undefined,
        maxHeartRate: undefined,
      };
    }

    // Aggregate statistics
    const totalRuns = runs.length;
    const totalDistance = runs.reduce((sum, run) => sum + run.distance, 0);
    const totalDuration = runs.reduce((sum, run) => sum + run.duration, 0);

    // Calculate paces (minutes per kilometer)
    const avgPace = totalDistance > 0 ? totalDuration / 60 / totalDistance : 0;

    // Find fastest pace (minimum pace = fastest run)
    const fastestPace =
      runs.length > 0
        ? Math.min(
            ...runs.map(run => (run.distance > 0 ? run.duration / 60 / run.distance : Infinity))
          )
        : 0;

    const longestRun = runs.length > 0 ? Math.max(...runs.map(run => run.distance)) : 0;

    // Calculate elevation if available
    const runsWithElevation = runs.filter(run => run.detail?.elevationGain != null);
    const totalElevation =
      runsWithElevation.length > 0
        ? runsWithElevation.reduce((sum, run) => sum + (run.detail?.elevationGain || 0), 0)
        : undefined;

    // Calculate heart rate metrics if available
    const runsWithHR = runs.filter(run => run.detail?.avgHeartRate != null);
    const avgHeartRate =
      runsWithHR.length > 0
        ? Math.round(
            runsWithHR.reduce((sum, run) => sum + (run.detail?.avgHeartRate || 0), 0) /
              runsWithHR.length
          )
        : undefined;

    const maxHeartRate =
      runsWithHR.length > 0
        ? Math.max(...runsWithHR.map(run => run.detail?.maxHeartRate || 0))
        : undefined;

    return {
      period,
      startDate,
      endDate,
      totalRuns,
      totalDistance,
      totalDuration,
      avgPace,
      fastestPace: fastestPace === Infinity ? 0 : fastestPace,
      longestRun,
      totalElevation,
      avgHeartRate,
      maxHeartRate,
    };
  }

  /**
   * Analyze trends over multiple time periods
   */
  static async getTrends(
    userId: string,
    period: 'weekly' | 'monthly',
    dataPoints: number
  ): Promise<TrendAnalysis> {
    if (dataPoints < 2 || dataPoints > 52) {
      throw new Error('dataPoints must be between 2 and 52');
    }

    const now = new Date();
    const periodStats: Array<{ startDate: Date; distance: number; pace: number; runs: number }> =
      [];

    // Collect statistics for each period
    for (let i = 0; i < dataPoints; i++) {
      let periodStart: Date;
      let periodEnd: Date;

      if (period === 'weekly') {
        const weeksAgo = dataPoints - 1 - i;
        periodStart = startOfWeek(new Date(now.getTime() - weeksAgo * 7 * 24 * 60 * 60 * 1000), {
          weekStartsOn: 1,
        });
        periodEnd = endOfWeek(new Date(now.getTime() - weeksAgo * 7 * 24 * 60 * 60 * 1000), {
          weekStartsOn: 1,
        });
      } else {
        // monthly
        const monthsAgo = dataPoints - 1 - i;
        periodStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1));
        periodEnd = endOfMonth(new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1));
      }

      // Get runs for this period
      const runs = await prismaInstance.run.findMany({
        where: {
          userId,
          date: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
      });

      if (runs.length > 0) {
        const totalDistance = runs.reduce((sum, run) => sum + run.distance, 0);
        const totalDuration = runs.reduce((sum, run) => sum + run.duration, 0);
        const avgPace = totalDistance > 0 ? totalDuration / 60 / totalDistance : 0;

        periodStats.push({
          startDate: periodStart,
          distance: totalDistance,
          pace: avgPace,
          runs: runs.length,
        });
      } else {
        periodStats.push({
          startDate: periodStart,
          distance: 0,
          pace: 0,
          runs: 0,
        });
      }
    }

    // Calculate trends (compare first half to second half)
    const midpoint = Math.floor(periodStats.length / 2);
    const firstHalf = periodStats.slice(0, midpoint);
    const secondHalf = periodStats.slice(midpoint);

    // Average pace for each half (only count periods with runs)
    const firstHalfWithRuns = firstHalf.filter(p => p.runs > 0);
    const secondHalfWithRuns = secondHalf.filter(p => p.runs > 0);

    const firstHalfPace =
      firstHalfWithRuns.length > 0
        ? firstHalfWithRuns.reduce((sum, p) => sum + p.pace, 0) / firstHalfWithRuns.length
        : 0;

    const secondHalfPace =
      secondHalfWithRuns.length > 0
        ? secondHalfWithRuns.reduce((sum, p) => sum + p.pace, 0) / secondHalfWithRuns.length
        : 0;

    // Average volume for each half
    const firstHalfVolume = firstHalf.reduce((sum, p) => sum + p.distance, 0) / firstHalf.length;
    const secondHalfVolume = secondHalf.reduce((sum, p) => sum + p.distance, 0) / secondHalf.length;

    // Calculate percent changes
    const paceChangePercent =
      firstHalfPace > 0 ? ((secondHalfPace - firstHalfPace) / firstHalfPace) * 100 : 0;

    const volumeChangePercent =
      firstHalfVolume > 0 ? ((secondHalfVolume - firstHalfVolume) / firstHalfVolume) * 100 : 0;

    // Determine trends (threshold: 5%)
    const paceTrend =
      paceChangePercent < -5 ? 'improving' : paceChangePercent > 5 ? 'declining' : 'stable';

    const volumeTrend =
      volumeChangePercent > 5 ? 'increasing' : volumeChangePercent < -5 ? 'decreasing' : 'stable';

    // Calculate consistency score (0-1)
    // Based on: how many periods had at least one run
    const periodsWithRuns = periodStats.filter(p => p.runs > 0).length;
    const consistencyScore = periodsWithRuns / periodStats.length;

    return {
      period,
      dataPoints: periodStats.length,
      paceTrend,
      volumeTrend,
      paceChangePercent,
      volumeChangePercent,
      consistencyScore,
    };
  }
}
