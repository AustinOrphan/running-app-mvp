import { useState, useEffect } from 'react';

import { Run, RunFormData } from '../types';
import { calculatePace } from '../utils/formatters';
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../../utils/apiFetch';

export const useRuns = (token: string | null) => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchRuns = async () => {
    if (!token) return;

    setLoading(true);
    try {
      const response = await apiGet<Run[]>('/api/runs');
      setRuns(response.data);
    } catch (error) {
      console.error('Failed to fetch runs:', error);
      throw new Error('Failed to load runs');
    } finally {
      setLoading(false);
    }
  };

  const saveRun = async (formData: RunFormData, editingRun?: Run | null): Promise<void> => {
    if (!token) throw new Error('No authentication token');

    setSaving(true);
    const runData = {
      date: new Date(formData.date).toISOString(),
      distance: Number(formData.distance),
      duration: Number(formData.duration) * 60, // Convert minutes to seconds
      tag: formData.tag || null,
      notes: formData.notes || null,
    };

    try {
      if (editingRun) {
        await apiPut<Run>(`/api/runs/${editingRun.id}`, runData);
      } else {
        await apiPost<Run>('/api/runs', runData);
      }

      await fetchRuns(); // Refresh the list
    } catch (error) {
      console.error('Failed to save run:', error);
      const apiError = error as ApiError;
      throw new Error(
        apiError.data?.message ||
          apiError.message ||
          `Failed to ${editingRun ? 'update' : 'save'} run`
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteRun = async (runId: string): Promise<void> => {
    if (!token) throw new Error('No authentication token');

    try {
      await apiDelete(`/api/runs/${runId}`);
      await fetchRuns(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete run:', error);
      const apiError = error as ApiError;
      throw new Error(apiError.data?.message || apiError.message || 'Failed to delete run');
    }
  };

  useEffect(() => {
    if (token) {
      fetchRuns().catch(() => {
        // Error is already logged in fetchRuns, just prevent unhandled rejection
      });
    }
  }, [token]);

  return {
    runs,
    loading,
    saving,
    fetchRuns,
    saveRun,
    deleteRun,
  };
};
