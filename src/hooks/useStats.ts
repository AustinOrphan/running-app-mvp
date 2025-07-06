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
      try {
        const response = await apiGet<WeeklyInsights>('/api/stats/insights-summary');
        setWeeklyInsights(response.data);
      } catch (error) {
        logError(
          'Failed to fetch weekly insights',
          error instanceof Error ? error : new Error(String(error))
        );
        setError('Failed to load weekly insights');
      }
    };

    const fetchTypeBreakdownInner = async () => {
      try {
        const response = await apiGet<RunTypeBreakdown[]>('/api/stats/type-breakdown');
        setTypeBreakdown(response.data);
      } catch (error) {
        logError(
          'Failed to fetch type breakdown',
          error instanceof Error ? error : new Error(String(error))
        );
        setError('Failed to load run type breakdown');
      }
    };

    const fetchTrendsDataInner = async () => {
      try {
        const response = await apiGet<TrendsDataPoint[]>(`/api/stats/trends?period=${period}`);
        setTrendsData(response.data);
      } catch (error) {
        logError(
          'Failed to fetch trends data',
          error instanceof Error ? error : new Error(String(error))
        );
        setError('Failed to load trends data');
      }
    };

    const fetchPersonalRecordsInner = async () => {
      try {
        const response = await apiGet<PersonalRecord[]>('/api/stats/personal-records');
        setPersonalRecords(response.data);
      } catch (error) {
        logError(
          'Failed to fetch personal records',
          error instanceof Error ? error : new Error(String(error))
        );
        setError('Failed to load personal records');
      }
    };

    try {
      await Promise.all([
        fetchWeeklyInsightsInner(),
        fetchTypeBreakdownInner(),
        fetchTrendsDataInner(),
        fetchPersonalRecordsInner(),
      ]);
    } catch {
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
