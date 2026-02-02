import { describe, it, expect } from 'vitest';
import { GeospatialService } from '../../../server/services/geospatialService.js';
import type { LineString } from 'geojson';

describe('GeospatialService', () => {
  describe('clusterRoutes', () => {
    it('should cluster similar routes together', () => {
      // Two very similar routes (same start/end, slightly different path)
      const route1: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672], // Austin, TX
          [-97.7435, 30.268],
          [-97.744, 30.269],
          [-97.7445, 30.27],
        ],
      };

      const route2: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672], // Same start
          [-97.7436, 30.2681], // Slightly different middle
          [-97.7441, 30.2691],
          [-97.7445, 30.27], // Same end
        ],
      };

      const routes = [
        { id: 'run1', geoJson: route1 },
        { id: 'run2', geoJson: route2 },
      ];

      const clusters = GeospatialService.clusterRoutes(routes, 0.5); // 0.5km threshold

      expect(clusters).toBeDefined();
      expect(Array.isArray(clusters)).toBe(true);
      expect(clusters.length).toBe(1); // Should cluster together
      expect(clusters[0].routes.length).toBe(2);
    });

    it('should separate dissimilar routes', () => {
      const route1: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672], // Austin, TX
          [-97.7435, 30.268],
        ],
      };

      const route2: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.8431, 30.3672], // Different location, ~10km away
          [-97.8435, 30.368],
        ],
      };

      const routes = [
        { id: 'run1', geoJson: route1 },
        { id: 'run2', geoJson: route2 },
      ];

      const clusters = GeospatialService.clusterRoutes(routes, 0.5);

      expect(clusters.length).toBe(2); // Should be separate clusters
      expect(clusters[0].routes.length).toBe(1);
      expect(clusters[1].routes.length).toBe(1);
    });

    it('should identify the most popular route', () => {
      const route1: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672],
          [-97.7435, 30.268],
        ],
      };

      const route2: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672],
          [-97.7436, 30.2681],
        ],
      };

      const route3: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672],
          [-97.7437, 30.2682],
        ],
      };

      const routes = [
        { id: 'run1', geoJson: route1 },
        { id: 'run2', geoJson: route2 },
        { id: 'run3', geoJson: route3 },
      ];

      const clusters = GeospatialService.clusterRoutes(routes, 0.5);

      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters[0].routes.length).toBe(3);
      expect(clusters[0].representative).toBeDefined();
    });

    it('should handle empty routes array', () => {
      const clusters = GeospatialService.clusterRoutes([], 0.5);

      expect(clusters).toBeDefined();
      expect(Array.isArray(clusters)).toBe(true);
      expect(clusters.length).toBe(0);
    });

    it('should handle single route', () => {
      const route: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672],
          [-97.7435, 30.268],
        ],
      };

      const routes = [{ id: 'run1', geoJson: route }];

      const clusters = GeospatialService.clusterRoutes(routes, 0.5);

      expect(clusters.length).toBe(1);
      expect(clusters[0].routes.length).toBe(1);
      expect(clusters[0].representative).toBe('run1');
    });
  });

  describe('calculateRouteDistance', () => {
    it('should calculate distance between two routes', () => {
      const route1: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672],
          [-97.7435, 30.268],
        ],
      };

      const route2: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672],
          [-97.7436, 30.2681],
        ],
      };

      const distance = GeospatialService.calculateRouteDistance(route1, route2);

      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(0.2); // Very similar routes, < 200m apart
    });

    it('should return 0 for identical routes', () => {
      const route: LineString = {
        type: 'LineString',
        coordinates: [
          [-97.7431, 30.2672],
          [-97.7435, 30.268],
        ],
      };

      const distance = GeospatialService.calculateRouteDistance(route, route);

      expect(distance).toBe(0);
    });
  });
});
