import prisma from '../server/prisma.js';
import { RunDetail, Run, RunAnalytics } from '@prisma/client';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  subWeeks,
  subMonths,
  differenceInDays,
} from 'date-fns';

interface RunWithDetails extends Run {
  detail?: RunDetail | null;
}

interface TrendData {
  period: string;
  distance: number;
  duration: number;
  pace: number;
  runs: number;
  heartRate?: number;
  elevation?: number;
}

interface RunInsight {
  type: string;
  message: string;
  confidence: number;
  data?: any;
}

interface RunStatistics {
  totalRuns: number;
  totalDistance: number;
  totalDuration: number;
  avgPace: number;
  avgDistance: number;
  avgHeartRate?: number;
  totalElevationGain?: number;
  caloriesBurned?: number;
  longestRun?: number;
  fastestPace?: number;
  trends?: TrendData[];
  insights?: RunInsight[];
}

export class AnalyticsService {
  /**
   * Calculate statistics for a given period
   */
  static async calculateStatistics(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<RunStatistics> {
    const runs = (await prisma.run.findMany({
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
    })) as RunWithDetails[];

    if (runs.length === 0) {
      return {
        totalRuns: 0,
        totalDistance: 0,
        totalDuration: 0,
        avgPace: 0,
        avgDistance: 0,
      };
    }

    const totalRuns = runs.length;
    const totalDistance = runs.reduce((sum, run) => sum + run.distance, 0);
    const totalDuration = runs.reduce((sum, run) => sum + run.duration, 0);
    const avgPace = totalDuration / totalDistance;
    const avgDistance = totalDistance / totalRuns;

    // Heart rate statistics
    const heartRates = runs
      .map(run => run.detail?.avgHeartRate)
      .filter((hr): hr is number => hr !== null && hr !== undefined);

    const avgHeartRate =
      heartRates.length > 0
        ? heartRates.reduce((sum, hr) => sum + hr, 0) / heartRates.length
        : undefined;

    // Elevation statistics
    const elevationGains = runs
      .map(run => run.detail?.elevationGain)
      .filter((eg): eg is number => eg !== null && eg !== undefined);

    const totalElevationGain =
      elevationGains.length > 0 ? elevationGains.reduce((sum, eg) => sum + eg, 0) : undefined;

    // Find longest run and fastest pace
    const longestRun = Math.max(...runs.map(run => run.distance));
    const fastestPace = Math.min(...runs.map(run => run.duration / run.distance));

    // Calculate calories (rough estimate)
    const caloriesBurned = this.estimateCalories(totalDistance, totalDuration, avgHeartRate);

    return {
      totalRuns,
      totalDistance,
      totalDuration,
      avgPace,
      avgDistance,
      avgHeartRate,
      totalElevationGain,
      caloriesBurned,
      longestRun,
      fastestPace,
    };
  }

  /**
   * Generate trend analysis
   */
  static async generateTrends(
    userId: string,
    period: 'weekly' | 'monthly' | 'yearly',
    lookback: number = 12
  ): Promise<TrendData[]> {
    const trends: TrendData[] = [];
    const now = new Date();

    for (let i = 0; i < lookback; i++) {
      let startDate: Date;
      let endDate: Date;
      let periodLabel: string;

      switch (period) {
        case 'weekly':
          startDate = startOfWeek(subWeeks(now, i));
          endDate = endOfWeek(subWeeks(now, i));
          periodLabel = `Week ${i + 1}`;
          break;
        case 'monthly':
          startDate = startOfMonth(subMonths(now, i));
          endDate = endOfMonth(subMonths(now, i));
          periodLabel = `Month ${i + 1}`;
          break;
        case 'yearly':
          startDate = startOfYear(subMonths(now, i * 12));
          endDate = endOfYear(subMonths(now, i * 12));
          periodLabel = `Year ${i + 1}`;
          break;
      }

      const stats = await this.calculateStatistics(userId, startDate, endDate);

      trends.push({
        period: periodLabel,
        distance: stats.totalDistance,
        duration: stats.totalDuration,
        pace: stats.avgPace,
        runs: stats.totalRuns,
        heartRate: stats.avgHeartRate,
        elevation: stats.totalElevationGain,
      });
    }

    return trends.reverse(); // Chronological order
  }

  /**
   * Generate insights based on running data
   */
  static async generateInsights(userId: string): Promise<RunInsight[]> {
    const insights: RunInsight[] = [];

    // Get recent runs (last 30 days)
    const recentRuns = (await prisma.run.findMany({
      where: {
        userId,
        date: {
          gte: subDays(new Date(), 30),
        },
      },
      include: {
        detail: true,
      },
      orderBy: {
        date: 'desc',
      },
    })) as RunWithDetails[];

    // Get older runs for comparison (31-60 days ago)
    const olderRuns = (await prisma.run.findMany({
      where: {
        userId,
        date: {
          gte: subDays(new Date(), 60),
          lt: subDays(new Date(), 30),
        },
      },
      include: {
        detail: true,
      },
    })) as RunWithDetails[];

    // Consistency insight
    const runningDays = new Set(recentRuns.map(run => startOfDay(run.date).toISOString())).size;

    const consistencyScore = runningDays / 30;

    if (consistencyScore > 0.7) {
      insights.push({
        type: 'consistency',
        message: "Great consistency! You've been running regularly.",
        confidence: 0.9,
        data: { runningDays, totalDays: 30 },
      });
    } else if (consistencyScore < 0.3) {
      insights.push({
        type: 'consistency',
        message: 'Try to run more consistently for better results.',
        confidence: 0.8,
        data: { runningDays, totalDays: 30 },
      });
    }

    // Performance trend
    if (recentRuns.length > 5 && olderRuns.length > 5) {
      const recentAvgPace =
        recentRuns.reduce((sum, run) => sum + run.duration / run.distance, 0) / recentRuns.length;

      const olderAvgPace =
        olderRuns.reduce((sum, run) => sum + run.duration / run.distance, 0) / olderRuns.length;

      const paceImprovement = ((olderAvgPace - recentAvgPace) / olderAvgPace) * 100;

      if (paceImprovement > 5) {
        insights.push({
          type: 'performance',
          message: `Your pace has improved by ${paceImprovement.toFixed(1)}%!`,
          confidence: 0.85,
          data: { recentAvgPace, olderAvgPace, improvement: paceImprovement },
        });
      } else if (paceImprovement < -5) {
        insights.push({
          type: 'performance',
          message: 'Your pace has slowed recently. Consider rest or easier runs.',
          confidence: 0.75,
          data: { recentAvgPace, olderAvgPace, decline: Math.abs(paceImprovement) },
        });
      }
    }

    // Distance progression
    const recentTotalDistance = recentRuns.reduce((sum, run) => sum + run.distance, 0);
    const olderTotalDistance = olderRuns.reduce((sum, run) => sum + run.distance, 0);

    if (recentTotalDistance > olderTotalDistance * 1.2) {
      insights.push({
        type: 'volume',
        message:
          "You've increased your running volume significantly. Monitor for signs of overtraining.",
        confidence: 0.8,
        data: { recent: recentTotalDistance, older: olderTotalDistance },
      });
    }

    // Heart rate trends
    const recentHRs = recentRuns
      .map(run => run.detail?.avgHeartRate)
      .filter((hr): hr is number => hr !== null && hr !== undefined);

    if (recentHRs.length > 5) {
      const avgRecentHR = recentHRs.reduce((sum, hr) => sum + hr, 0) / recentHRs.length;

      // Check if HR is consistently high
      if (avgRecentHR > 160) {
        insights.push({
          type: 'heart_rate',
          message: 'Your average heart rate is quite high. Consider adding more easy runs.',
          confidence: 0.7,
          data: { avgHeartRate: avgRecentHR },
        });
      }
    }

    return insights;
  }

  /**
   * Update or create analytics records
   */
  static async updateAnalytics(
    userId: string,
    period: 'daily' | 'weekly' | 'monthly' | 'yearly'
  ): Promise<void> {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (period) {
      case 'daily':
        startDate = startOfDay(now);
        endDate = endOfDay(now);
        break;
      case 'weekly':
        startDate = startOfWeek(now);
        endDate = endOfWeek(now);
        break;
      case 'monthly':
        startDate = startOfMonth(now);
        endDate = endOfMonth(now);
        break;
      case 'yearly':
        startDate = startOfYear(now);
        endDate = endOfYear(now);
        break;
    }

    const stats = await this.calculateStatistics(userId, startDate, endDate);
    const trends = await this.generateTrends(userId, period === 'daily' ? 'weekly' : period);
    const insights = await this.generateInsights(userId);

    await prisma.runAnalytics.upsert({
      where: {
        userId_period_startDate: {
          userId,
          period,
          startDate,
        },
      },
      update: {
        endDate,
        totalRuns: stats.totalRuns,
        totalDistance: stats.totalDistance,
        totalDuration: stats.totalDuration,
        avgPace: stats.avgPace,
        avgDistance: stats.avgDistance,
        avgHeartRate: stats.avgHeartRate,
        totalElevationGain: stats.totalElevationGain,
        caloriesBurned: stats.caloriesBurned,
        trends: JSON.stringify(trends),
        insights: JSON.stringify(insights),
      },
      create: {
        userId,
        period,
        startDate,
        endDate,
        totalRuns: stats.totalRuns,
        totalDistance: stats.totalDistance,
        totalDuration: stats.totalDuration,
        avgPace: stats.avgPace,
        avgDistance: stats.avgDistance,
        avgHeartRate: stats.avgHeartRate,
        totalElevationGain: stats.totalElevationGain,
        caloriesBurned: stats.caloriesBurned,
        trends: JSON.stringify(trends),
        insights: JSON.stringify(insights),
      },
    });
  }

  /**
   * Estimate calories burned
   */
  private static estimateCalories(
    distance: number,
    duration: number,
    avgHeartRate?: number
  ): number {
    // Basic formula: calories = distance (km) * weight (kg) * 1.036
    // Assuming average weight of 70kg for now
    const baseCalories = distance * 70 * 1.036;

    // Adjust based on intensity (using pace or heart rate)
    const pace = duration / distance;
    let intensityMultiplier = 1;

    if (pace < 4)
      intensityMultiplier = 1.2; // Fast pace
    else if (pace < 5)
      intensityMultiplier = 1.1; // Moderate pace
    else if (pace > 6) intensityMultiplier = 0.9; // Slow pace

    // Further adjust based on heart rate if available
    if (avgHeartRate) {
      if (avgHeartRate > 160) intensityMultiplier *= 1.1;
      else if (avgHeartRate < 120) intensityMultiplier *= 0.9;
    }

    return Math.round(baseCalories * intensityMultiplier);
  }
}
