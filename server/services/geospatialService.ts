import * as turf from '@turf/turf';
import type { LineString, Position, Feature, Polygon } from 'geojson';

export interface RouteCluster {
  routes: string[]; // Array of run IDs
  representative: string; // ID of the representative route
  centroid?: Position;
  count: number;
}

export interface Heatmap {
  type: 'FeatureCollection';
  features: Feature<Polygon>[];
  bbox?: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat] or null when empty
}

export class GeospatialService {
  /**
   * Cluster similar routes together using Hausdorff distance approximation
   * @param routes Array of routes with IDs and GeoJSON LineString data
   * @param thresholdKm Maximum distance in km for routes to be considered similar
   * @returns Array of route clusters
   */
  static clusterRoutes(
    routes: Array<{ id: string; geoJson: LineString }>,
    thresholdKm: number
  ): RouteCluster[] {
    if (routes.length === 0) {
      return [];
    }

    if (routes.length === 1) {
      return [
        {
          routes: [routes[0].id],
          representative: routes[0].id,
          count: 1,
        },
      ];
    }

    const clusters: RouteCluster[] = [];
    const assigned = new Set<number>();

    // For each route, find similar routes and create clusters
    for (let i = 0; i < routes.length; i++) {
      if (assigned.has(i)) continue;

      const cluster: string[] = [routes[i].id];
      assigned.add(i);

      // Compare with all other unassigned routes
      for (let j = i + 1; j < routes.length; j++) {
        if (assigned.has(j)) continue;

        const distance = this.calculateRouteDistance(routes[i].geoJson, routes[j].geoJson);

        if (distance <= thresholdKm) {
          cluster.push(routes[j].id);
          assigned.add(j);
        }
      }

      clusters.push({
        routes: cluster,
        representative: routes[i].id, // First route in cluster is representative
        count: cluster.length,
      });
    }

    // Sort clusters by size (most popular first)
    clusters.sort((a, b) => b.count - a.count);

    return clusters;
  }

  /**
   * Calculate approximate distance between two routes using Hausdorff-like approach
   * @param route1 First route as GeoJSON LineString
   * @param route2 Second route as GeoJSON LineString
   * @returns Distance in kilometers
   */
  static calculateRouteDistance(route1: LineString, route2: LineString): number {
    // If routes are identical, return 0
    if (JSON.stringify(route1.coordinates) === JSON.stringify(route2.coordinates)) {
      return 0;
    }

    // Simplified Hausdorff distance: calculate average distance between sampled points
    const points1 = route1.coordinates;
    const points2 = route2.coordinates;

    // Sample points along each route
    const sampleCount = Math.min(10, Math.max(points1.length, points2.length));
    const samples1 = this.samplePoints(points1, sampleCount);
    const samples2 = this.samplePoints(points2, sampleCount);

    // Calculate average minimum distance from samples1 to route2
    let totalDistance = 0;
    for (const point1 of samples1) {
      let minDist = Infinity;
      for (const point2 of samples2) {
        const dist = turf.distance(turf.point(point1), turf.point(point2), { units: 'kilometers' });
        minDist = Math.min(minDist, dist);
      }
      totalDistance += minDist;
    }

    // Calculate average minimum distance from samples2 to route1
    for (const point2 of samples2) {
      let minDist = Infinity;
      for (const point1 of samples1) {
        const dist = turf.distance(turf.point(point1), turf.point(point2), { units: 'kilometers' });
        minDist = Math.min(minDist, dist);
      }
      totalDistance += minDist;
    }

    // Return average distance (symmetric)
    return totalDistance / (samples1.length + samples2.length);
  }

  /**
   * Sample points evenly along a route
   * @param points Array of coordinates
   * @param count Number of samples to take
   * @returns Array of sampled positions
   */
  private static samplePoints(points: Position[], count: number): Position[] {
    if (points.length <= count) {
      return points;
    }

    const samples: Position[] = [];
    const step = (points.length - 1) / (count - 1);

    for (let i = 0; i < count; i++) {
      const index = Math.round(i * step);
      samples.push(points[index]);
    }

    return samples;
  }

  /**
   * Generate grid-based heatmap from GPS points
   * @param points Array of GPS coordinates [lng, lat]
   * @param gridSizeKm Grid cell size in kilometers
   * @returns GeoJSON FeatureCollection with density information
   */
  static generateHeatmap(points: Position[], gridSizeKm: number): Heatmap {
    if (points.length === 0) {
      return {
        type: 'FeatureCollection',
        features: [],
        bbox: null,
      };
    }

    // Calculate bounding box
    const lngs = points.map(p => p[0]);
    const lats = points.map(p => p[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    // Calculate grid dimensions
    // Approximate: 1 degree latitude ≈ 111km
    // 1 degree longitude ≈ 111km * cos(latitude)
    const avgLat = (minLat + maxLat) / 2;
    const latDegPerKm = 1 / 111;
    const lngDegPerKm = 1 / (111 * Math.cos((avgLat * Math.PI) / 180));

    const gridLatSize = gridSizeKm * latDegPerKm;
    const gridLngSize = gridSizeKm * lngDegPerKm;

    // Create grid cells and count points in each
    const grid = new Map<string, number>();

    for (const point of points) {
      const [lng, lat] = point;
      const cellLng = Math.floor((lng - minLng) / gridLngSize);
      const cellLat = Math.floor((lat - minLat) / gridLatSize);
      const cellKey = `${cellLng},${cellLat}`;

      grid.set(cellKey, (grid.get(cellKey) || 0) + 1);
    }

    // Convert grid to GeoJSON features
    const features: Feature<Polygon>[] = [];

    for (const [cellKey, density] of grid.entries()) {
      const [cellLng, cellLat] = cellKey.split(',').map(Number);

      const cellMinLng = minLng + cellLng * gridLngSize;
      const cellMaxLng = cellMinLng + gridLngSize;
      const cellMinLat = minLat + cellLat * gridLatSize;
      const cellMaxLat = cellMinLat + gridLatSize;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [cellMinLng, cellMinLat],
              [cellMaxLng, cellMinLat],
              [cellMaxLng, cellMaxLat],
              [cellMinLng, cellMaxLat],
              [cellMinLng, cellMinLat], // Close polygon
            ],
          ],
        },
        properties: {
          density,
        },
      });
    }

    return {
      type: 'FeatureCollection',
      features,
      bbox: [minLng, minLat, maxLng, maxLat],
    };
  }
}
