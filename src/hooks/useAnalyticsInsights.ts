import { useState, useEffect, useCallback } from 'react';

import { Insight } from '../types';
import { logError } from '../utils/clientLogger';
import { apiGet } from '../utils/apiFetch';

export const useAnalyticsInsights = (token: string | null) => {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiGet<{ insights: Insight[] }>('/api/analytics/insights');
      setInsights(response.data.insights);
    } catch (error) {
      logError(
        'Failed to fetch analytics insights',
        error instanceof Error ? error : new Error(String(error))
      );
      setError('Failed to load insights');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchInsights();
    }
  }, [token, fetchInsights]);

  return {
    insights,
    loading,
    error,
    refetch: fetchInsights,
  };
};
