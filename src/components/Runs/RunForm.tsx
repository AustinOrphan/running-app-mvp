import React from 'react';

import { RunFormData, Run } from '../../types';

interface RunFormProps {
  formData: RunFormData;
  errors: { [key: string]: string };
  loading: boolean;
  editingRun: Run | null;
  onUpdateField: (field: keyof RunFormData, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export const RunForm: React.FC<RunFormProps> = ({
  formData,
  errors,
  loading,
  editingRun,
  onUpdateField,
  onSubmit,
  onCancel,
}) => {
  return (
    <form onSubmit={onSubmit} className='run-form'>
      <h3>{editingRun ? 'Edit Run' : 'Add New Run'}</h3>
      <div className='form-row'>
        <div className='form-group'>
          <label>Date</label>
          <input
            type='date'
            value={formData.date}
            onChange={e => onUpdateField('date', e.target.value)}
            className={errors.date ? 'error' : ''}
          />
          {errors.date && <span className='error-text'>{errors.date}</span>}
        </div>
        <div className='form-group'>
          <label>Distance (km)</label>
          <input
            type='number'
            step='0.1'
            value={formData.distance}
            onChange={e => onUpdateField('distance', e.target.value)}
            placeholder='5.0'
            className={errors.distance ? 'error' : ''}
          />
          {errors.distance && <span className='error-text'>{errors.distance}</span>}
        </div>
        <div className='form-group'>
          <label>Duration (minutes)</label>
          <input
            type='number'
            value={formData.duration}
            onChange={e => onUpdateField('duration', e.target.value)}
            placeholder='30'
            className={errors.duration ? 'error' : ''}
          />
          {errors.duration && <span className='error-text'>{errors.duration}</span>}
        </div>
      </div>
      <div className='form-row'>
        <div className='form-group'>
          <label>Tag (optional)</label>
          <select value={formData.tag} onChange={e => onUpdateField('tag', e.target.value)}>
            <option value=''>Select a tag</option>
            <option value='Training'>Training</option>
            <option value='Race'>Race</option>
            <option value='Easy'>Easy</option>
            <option value='Long'>Long Run</option>
            <option value='Speed'>Speed Work</option>
          </select>
        </div>
      </div>
      <div className='form-group'>
        <label>Notes (optional)</label>
        <textarea
          value={formData.notes}
          onChange={e => onUpdateField('notes', e.target.value)}
          placeholder='How did it feel? Route details, weather, etc.'
          rows={3}
        />
      </div>
      <div className='form-actions'>
        <button type='submit' className='primary-btn' disabled={loading}>
          {loading ? '⏳ Saving...' : editingRun ? 'Update Run' : 'Save Run'}
        </button>
        <button type='button' onClick={onCancel} className='secondary-btn' disabled={loading}>
          Cancel
        </button>
      </div>
    </form>
  );
};
