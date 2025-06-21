import { useState, useEffect } from 'react';
import { Run, RunFormData } from '../types';
import { calculatePace } from '../utils/formatters';

export const useRuns = (token: string | null) => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchRuns = async () => {
    if (!token) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/runs', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const runsData = await response.json();
        setRuns(runsData);
      }
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
      notes: formData.notes || null
    };

    try {
      const url = editingRun ? `/api/runs/${editingRun.id}` : '/api/runs';
      const method = editingRun ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(runData)
      });

      if (response.ok) {
        await fetchRuns(); // Refresh the list
        return; // Success
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to ${editingRun ? 'update' : 'save'} run`);
      }
    } catch (error) {
      console.error('Failed to save run:', error);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const deleteRun = async (runId: string): Promise<void> => {
    if (!token) throw new Error('No authentication token');

    try {
      const response = await fetch(`/api/runs/${runId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        await fetchRuns(); // Refresh the list
      } else {
        throw new Error('Failed to delete run');
      }
    } catch (error) {
      console.error('Failed to delete run:', error);
      throw error;
    }
  };

  useEffect(() => {
    if (token) {
      fetchRuns();
    }
  }, [token]);

  return {
    runs,
    loading,
    saving,
    fetchRuns,
    saveRun,
    deleteRun
  };
};