import { useState, useEffect, useCallback } from 'react';

import { AggregatedStats } from '../types';
import { logError } from '../utils/clientLogger';
import { apiGet } from '../utils/apiFetch';

export const useAnalyticsStatistics = (
  token: string | null,
  period: 'weekly' | 'monthly' | 'yearly' = 'weekly'
) => {
  const [statistics, setStatistics] = useState<AggregatedStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatistics = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<AggregatedStats>(
        `/api/analytics/statistics?period=${period}`
      );
      setStatistics(response.data);
    } catch (error) {
      logError(
        'Failed to fetch analytics statistics',
        error instanceof Error ? error : new Error(String(error))
      );
      setError('Failed to load analytics statistics');
    } finally {
      setLoading(false);
    }
  }, [token, period]);

  useEffect(() => {
    if (token) {
      fetchStatistics();
    }
  }, [token, period, fetchStatistics]);

  return {
    statistics,
    loading,
    error,
    refetch: fetchStatistics,
  };
};
