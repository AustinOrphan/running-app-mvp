import * as turf from '@turf/turf';
import { FeatureCollection, Point, LineString } from 'geojson';
import prisma from '../server/prisma.js';

interface GPSPoint {
  latitude: number;
  longitude: number;
  timestamp?: Date;
  elevation?: number;
  heartRate?: number;
  pace?: number;
}

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  intensity: number;
  avgPace?: number;
  totalDistance?: number;
}

interface RunRoute {
  coordinates: [number, number][];
  elevation?: number[];
  heartRate?: number[];
  pace?: number[];
  splits?: { distance: number; time: number; pace: number }[];
}

export class GeospatialService {
  /**
   * Parse GeoJSON or GPS data from a run
   */
  static parseRunRoute(routeData: string | null): RunRoute | null {
    if (!routeData) return null;

    try {
      const parsed = JSON.parse(routeData);

      if (parsed.type === 'LineString' && parsed.coordinates) {
        return {
          coordinates: parsed.coordinates,
          elevation: parsed.properties?.elevation,
          heartRate: parsed.properties?.heartRate,
          pace: parsed.properties?.pace,
          splits: parsed.properties?.splits,
        };
      }

      // Handle array of GPS points
      if (Array.isArray(parsed)) {
        return {
          coordinates: parsed.map(p => [p.longitude || p.lng, p.latitude || p.lat]),
          elevation: parsed.map(p => p.elevation).filter(Boolean),
          heartRate: parsed.map(p => p.heartRate).filter(Boolean),
          pace: parsed.map(p => p.pace).filter(Boolean),
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Calculate distance between two GPS points using Haversine formula
   */
  static calculateDistance(point1: GPSPoint, point2: GPSPoint): number {
    const from = turf.point([point1.longitude, point1.latitude]);
    const to = turf.point([point2.longitude, point2.latitude]);
    return turf.distance(from, to, { units: 'kilometers' });
  }

  /**
   * Generate heatmap data from user's runs
   */
  static async generateHeatmap(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<HeatmapPoint[]> {
    const runs = await prisma.run.findMany({
      where: {
        userId,
        ...(startDate && endDate
          ? {
              date: {
                gte: startDate,
                lte: endDate,
              },
            }
          : {}),
      },
      select: {
        routeGeoJson: true,
        distance: true,
        duration: true,
      },
    });

    const heatmapData = new Map<string, HeatmapPoint>();

    for (const run of runs) {
      const route = this.parseRunRoute(run.routeGeoJson);
      if (!route) continue;

      const pace = run.duration / run.distance; // minutes per km

      for (const coord of route.coordinates) {
        const key = `${coord[1].toFixed(4)},${coord[0].toFixed(4)}`;
        const existing = heatmapData.get(key);

        if (existing) {
          existing.intensity += 1;
          existing.totalDistance =
            (existing.totalDistance || 0) + run.distance / route.coordinates.length;
          existing.avgPace = ((existing.avgPace || pace) + pace) / 2;
        } else {
          heatmapData.set(key, {
            latitude: coord[1],
            longitude: coord[0],
            intensity: 1,
            avgPace: pace,
            totalDistance: run.distance / route.coordinates.length,
          });
        }
      }
    }

    // Update database with heatmap data
    const heatmapPoints = Array.from(heatmapData.values());

    for (const point of heatmapPoints) {
      await prisma.locationHeatmap.upsert({
        where: {
          userId_latitude_longitude: {
            userId,
            latitude: point.latitude,
            longitude: point.longitude,
          },
        },
        update: {
          frequency: point.intensity,
          totalDistance: point.totalDistance || 0,
          avgPace: point.avgPace,
          lastVisited: new Date(),
        },
        create: {
          userId,
          latitude: point.latitude,
          longitude: point.longitude,
          frequency: point.intensity,
          totalDistance: point.totalDistance || 0,
          avgPace: point.avgPace,
        },
      });
    }

    return heatmapPoints;
  }

  /**
   * Calculate elevation gain/loss from GPS data
   */
  static calculateElevationMetrics(elevations: number[]): {
    gain: number;
    loss: number;
    max: number;
    min: number;
  } {
    if (!elevations || elevations.length < 2) {
      return { gain: 0, loss: 0, max: 0, min: 0 };
    }

    let gain = 0;
    let loss = 0;
    let max = elevations[0];
    let min = elevations[0];

    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);

      if (elevations[i] > max) max = elevations[i];
      if (elevations[i] < min) min = elevations[i];
    }

    return { gain, loss, max, min };
  }

  /**
   * Generate splits for a run based on GPS data
   */
  static generateSplits(route: RunRoute, splitDistance: number = 1): any[] {
    if (!route.coordinates || route.coordinates.length < 2) return [];

    const splits = [];
    let accumulatedDistance = 0;
    let splitStartIdx = 0;
    let splitStartTime = 0;

    for (let i = 1; i < route.coordinates.length; i++) {
      const from = turf.point(route.coordinates[i - 1]);
      const to = turf.point(route.coordinates[i]);
      const segmentDistance = turf.distance(from, to, { units: 'kilometers' });

      accumulatedDistance += segmentDistance;

      if (accumulatedDistance >= splitDistance) {
        const splitTime = i - splitStartIdx; // simplified - would need actual timestamps
        const splitPace = splitTime / splitDistance;

        splits.push({
          distance: splitDistance,
          time: splitTime,
          pace: splitPace,
          avgHeartRate: route.heartRate
            ? route.heartRate.slice(splitStartIdx, i).reduce((a, b) => a + b, 0) /
              (i - splitStartIdx)
            : undefined,
          elevation: route.elevation
            ? this.calculateElevationMetrics(route.elevation.slice(splitStartIdx, i))
            : undefined,
        });

        accumulatedDistance = accumulatedDistance - splitDistance;
        splitStartIdx = i;
        splitStartTime = i;
      }
    }

    return splits;
  }

  /**
   * Find popular routes based on overlapping paths
   */
  static async findPopularRoutes(userId: string, minOverlap: number = 0.5): Promise<any[]> {
    const runs = await prisma.run.findMany({
      where: { userId },
      select: {
        id: true,
        routeGeoJson: true,
        distance: true,
        date: true,
      },
    });

    const routes: Array<{ id: string; line: any; distance: number }> = [];

    for (const run of runs) {
      const route = this.parseRunRoute(run.routeGeoJson);
      if (route && route.coordinates.length > 1) {
        routes.push({
          id: run.id,
          line: turf.lineString(route.coordinates),
          distance: run.distance,
        });
      }
    }

    // Find overlapping routes
    const popularRoutes = [];
    const processed = new Set<string>();

    for (let i = 0; i < routes.length; i++) {
      if (processed.has(routes[i].id)) continue;

      const overlappingRuns = [routes[i]];

      for (let j = i + 1; j < routes.length; j++) {
        if (processed.has(routes[j].id)) continue;

        try {
          const overlap = turf.lineOverlap(routes[i].line, routes[j].line);
          const overlapLength = turf.length(overlap, { units: 'kilometers' });

          if (overlapLength / routes[i].distance > minOverlap) {
            overlappingRuns.push(routes[j]);
            processed.add(routes[j].id);
          }
        } catch {
          // Handle geometry errors
        }
      }

      if (overlappingRuns.length > 1) {
        popularRoutes.push({
          baseRouteId: routes[i].id,
          frequency: overlappingRuns.length,
          avgDistance:
            overlappingRuns.reduce((sum, r) => sum + r.distance, 0) / overlappingRuns.length,
          runs: overlappingRuns.map(r => r.id),
        });
      }
    }

    return popularRoutes.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Create a grid-based heatmap for visualization
   */
  static async createGridHeatmap(
    userId: string,
    cellSize: number = 0.5,
    units: 'kilometers' | 'miles' = 'kilometers'
  ): Promise<FeatureCollection> {
    const points = await prisma.locationHeatmap.findMany({
      where: { userId },
    });

    if (points.length === 0) {
      return turf.featureCollection([]);
    }

    // Create bounding box
    const coords = points.map(p => [p.longitude, p.latitude]);
    const pointCollection = turf.points(coords);
    const bbox = turf.bbox(pointCollection);

    // Create grid
    const grid = turf.pointGrid(bbox, cellSize, { units });

    // Interpolate values
    const interpolated = turf.interpolate(
      turf.featureCollection(
        points.map(p =>
          turf.point([p.longitude, p.latitude], {
            intensity: p.frequency,
            avgPace: p.avgPace,
            totalDistance: p.totalDistance,
          })
        )
      ),
      cellSize,
      { gridType: 'point', property: 'intensity', units }
    );

    return interpolated;
  }
}
