import { useState, useEffect, useCallback } from 'react';

import { WeeklyInsights, RunTypeBreakdown, TrendsDataPoint, PersonalRecord } from '../types';
import { logError } from '../utils/clientLogger';

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
        const response = await fetch('/api/stats/insights-summary', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setWeeklyInsights(data);
        } else {
          throw new Error('Failed to fetch weekly insights');
        }
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
        const response = await fetch('/api/stats/type-breakdown', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setTypeBreakdown(data);
        } else {
          throw new Error('Failed to fetch type breakdown');
        }
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
        const response = await fetch(`/api/stats/trends?period=${period}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setTrendsData(data);
        } else {
          throw new Error('Failed to fetch trends data');
        }
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
        const response = await fetch('/api/stats/personal-records', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setPersonalRecords(data);
        } else {
          throw new Error('Failed to fetch personal records');
        }
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
