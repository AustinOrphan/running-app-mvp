import { useState, useEffect, useCallback } from 'react';

import { TrendAnalysis } from '../types';
import { logError } from '../utils/clientLogger';
import { apiGet } from '../utils/apiFetch';

export const useAnalyticsTrends = (
  token: string | null,
  period: 'weekly' | 'monthly' = 'weekly',
  dataPoints: number = 12
) => {
  const [trends, setTrends] = useState<TrendAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrends = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<TrendAnalysis>(
        `/api/analytics/trends?period=${period}&dataPoints=${dataPoints}`
      );
      setTrends(response.data);
    } catch (error) {
      logError(
        'Failed to fetch analytics trends',
        error instanceof Error ? error : new Error(String(error))
      );
      setError('Failed to load analytics trends');
    } finally {
      setLoading(false);
    }
  }, [token, period, dataPoints]);

  useEffect(() => {
    if (token) {
      fetchTrends();
    }
  }, [token, period, dataPoints, fetchTrends]);

  return {
    trends,
    loading,
    error,
    refetch: fetchTrends,
  };
};
