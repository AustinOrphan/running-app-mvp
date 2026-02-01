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
}
