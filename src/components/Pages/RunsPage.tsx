import React, { useState } from 'react';

import { useRunForm } from '../../hooks/useRunForm';
import { Run, RunFormData } from '../../types';
import { LoadingSpinner, EmptyState } from '../Common/LoadingSpinner';
import { RunCard } from '../Runs/RunCard';
import { RunForm } from '../Runs/RunForm';

interface RunsPageProps {
  runs: Run[];
  loading: boolean;
  saving: boolean;
  onSaveRun: (formData: RunFormData, editingRun?: Run | null) => Promise<void>;
  onDeleteRun: (runId: string) => Promise<void>;
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const RunsPage: React.FC<RunsPageProps> = ({
  runs,
  loading,
  saving,
  onSaveRun,
  onDeleteRun,
  onShowToast,
}) => {
  const [showRunForm, setShowRunForm] = useState(false);
  const [editingRun, setEditingRun] = useState<Run | null>(null);

  const { formData, errors, updateField, validate, reset, setFormData } = useRunForm();

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      onShowToast('Please fix the errors below', 'error');
      return;
    }

    try {
      await onSaveRun(formData, editingRun);
      const pace =
        formData.distance && formData.duration
          ? ` (${Math.round((Number(formData.duration) / Number(formData.distance)) * 100) / 100}min/km)`
          : '';
      const action = editingRun ? 'updated' : 'saved';
      onShowToast(
        `🏃‍♂️ Run ${action}! ${formData.distance}km in ${formData.duration}min${pace}`,
        'success'
      );
      handleFormCancel();
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : 'Failed to save run', 'error');
    }
  };

  const handleFormCancel = () => {
    reset();
    setEditingRun(null);
    setShowRunForm(false);
  };

  const handleEditRun = (run: Run) => {
    setEditingRun(run);
    setFormData({
      date: new Date(run.date).toISOString().split('T')[0],
      distance: run.distance.toString(),
      duration: Math.round(run.duration / 60).toString(),
      tag: run.tag || '',
      notes: run.notes || '',
    });
    setShowRunForm(true);
  };

  const handleDeleteRun = async (runId: string) => {
    try {
      await onDeleteRun(runId);
      onShowToast('Run deleted successfully', 'success');
    } catch (error) {
      onShowToast('Failed to delete run', 'error');
    }
  };

  const toggleForm = () => {
    if (showRunForm) {
      handleFormCancel();
    } else {
      setShowRunForm(true);
    }
  };

  return (
    <div className='runs-section tab-panel'>
      <div className='section-header'>
        <h2>Your Runs ({runs.length})</h2>
        <button onClick={toggleForm} className='primary-btn' disabled={saving}>
          {showRunForm ? 'Cancel' : '+ Add Run'}
        </button>
      </div>

      {showRunForm && (
        <RunForm
          formData={formData}
          errors={errors}
          loading={saving}
          editingRun={editingRun}
          onUpdateField={updateField}
          onSubmit={handleFormSubmit}
          onCancel={handleFormCancel}
        />
      )}

      {loading ? (
        <LoadingSpinner count={5} />
      ) : runs.length === 0 ? (
        <EmptyState
          message='Start your running journey by adding your first run above.'
          icon='🏃‍♂️'
        />
      ) : (
        <div className='runs-grid'>
          {runs.map(run => (
            <RunCard key={run.id} run={run} onEdit={handleEditRun} onDelete={handleDeleteRun} />
          ))}
        </div>
      )}
    </div>
  );
};
