import { useState, useEffect, useCallback } from 'react';

import { logError } from '../utils/clientLogger';
import { apiGet } from '../utils/apiFetch';

export interface HeatmapFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: {
    density: number;
  };
}

export interface Heatmap {
  type: 'FeatureCollection';
  features: HeatmapFeature[];
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

export const useAnalyticsHeatmap = (token: string | null, gridSize: number = 0.5) => {
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHeatmap = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<Heatmap>(`/api/analytics/heatmap?gridSize=${gridSize}`);
      setHeatmap(response.data);
    } catch (error) {
      logError(
        'Failed to fetch analytics heatmap',
        error instanceof Error ? error : new Error(String(error))
      );
      setError('Failed to load heatmap');
    } finally {
      setLoading(false);
    }
  }, [token, gridSize]);

  useEffect(() => {
    if (token) {
      fetchHeatmap();
    }
  }, [token, gridSize, fetchHeatmap]);

  return {
    heatmap,
    loading,
    error,
    refetch: fetchHeatmap,
  };
};
