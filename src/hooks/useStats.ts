import { useState, useEffect, useCallback } from 'react';

import { WeeklyInsights, RunTypeBreakdown, TrendsDataPoint, PersonalRecord } from '../types';
import { logError } from '../utils/clientLogger';
import { apiGet } from '../../utils/apiFetch';

export const useStats = (token: string | null, period: string = '3m') => {
  const [weeklyInsights, setWeeklyInsights] = useState<WeeklyInsights | null>(null);
  const [typeBreakdown, setTypeBreakdown] = useState<RunTypeBreakdown[]>([]);
  const [trendsData, setTrendsData] = useState<TrendsDataPoint[]>([]);
  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllStats = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    const fetchWeeklyInsightsInner = async () => {
      const response = await apiGet<WeeklyInsights>('/api/stats/insights-summary');
      setWeeklyInsights(response.data);
    };

    const fetchTypeBreakdownInner = async () => {
      const response = await apiGet<RunTypeBreakdown[]>('/api/stats/type-breakdown');
      setTypeBreakdown(response.data);
    };

    const fetchTrendsDataInner = async () => {
      const response = await apiGet<TrendsDataPoint[]>(`/api/stats/trends?period=${period}`);
      setTrendsData(response.data);
    };

    const fetchPersonalRecordsInner = async () => {
      const response = await apiGet<PersonalRecord[]>('/api/stats/personal-records');
      setPersonalRecords(response.data);
    };

    try {
      await Promise.all([
        fetchWeeklyInsightsInner(),
        fetchTypeBreakdownInner(),
        fetchTrendsDataInner(),
        fetchPersonalRecordsInner(),
      ]);
    } catch (error) {
      // Centralized error handling - now reachable and functional
      logError(
        'Failed to fetch statistics',
        error instanceof Error ? error : new Error(String(error))
      );
      setError('Failed to load statistics');
    } finally {
      setLoading(false);
    }
  }, [token, period]);

  useEffect(() => {
    if (token) {
      fetchAllStats();
    }
  }, [token, period, fetchAllStats]);

  return {
    weeklyInsights,
    typeBreakdown,
    trendsData,
    personalRecords,
    loading,
    error,
    refetch: fetchAllStats,
  };
};
