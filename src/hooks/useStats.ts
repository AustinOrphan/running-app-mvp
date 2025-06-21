import { useState, useEffect } from 'react';
import { WeeklyInsights, RunTypeBreakdown, TrendsDataPoint, PersonalRecord } from '../types';

export const useStats = (token: string | null, period: string = '3m') => {
  const [weeklyInsights, setWeeklyInsights] = useState<WeeklyInsights | null>(null);
  const [typeBreakdown, setTypeBreakdown] = useState<RunTypeBreakdown[]>([]);
  const [trendsData, setTrendsData] = useState<TrendsDataPoint[]>([]);
  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeeklyInsights = async () => {
    if (!token) return;
    
    try {
      const response = await fetch('/api/stats/insights-summary', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setWeeklyInsights(data);
      } else {
        throw new Error('Failed to fetch weekly insights');
      }
    } catch (error) {
      console.error('Failed to fetch weekly insights:', error);
      setError('Failed to load weekly insights');
    }
  };

  const fetchTypeBreakdown = async () => {
    if (!token) return;
    
    try {
      const response = await fetch('/api/stats/type-breakdown', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setTypeBreakdown(data);
      } else {
        throw new Error('Failed to fetch type breakdown');
      }
    } catch (error) {
      console.error('Failed to fetch type breakdown:', error);
      setError('Failed to load run type breakdown');
    }
  };

  const fetchTrendsData = async () => {
    if (!token) return;
    
    try {
      const response = await fetch(`/api/stats/trends?period=${period}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setTrendsData(data);
      } else {
        throw new Error('Failed to fetch trends data');
      }
    } catch (error) {
      console.error('Failed to fetch trends data:', error);
      setError('Failed to load trends data');
    }
  };

  const fetchPersonalRecords = async () => {
    if (!token) return;
    
    try {
      const response = await fetch('/api/stats/personal-records', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setPersonalRecords(data);
      } else {
        throw new Error('Failed to fetch personal records');
      }
    } catch (error) {
      console.error('Failed to fetch personal records:', error);
      setError('Failed to load personal records');
    }
  };

  const fetchAllStats = async () => {
    if (!token) return;
    
    setLoading(true);
    setError(null);
    
    try {
      await Promise.all([
        fetchWeeklyInsights(),
        fetchTypeBreakdown(),
        fetchTrendsData(),
        fetchPersonalRecords()
      ]);
    } catch (error) {
      setError('Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchAllStats();
    }
  }, [token, period]);

  return {
    weeklyInsights,
    typeBreakdown,
    trendsData,
    personalRecords,
    loading,
    error,
    refetch: fetchAllStats
  };
};