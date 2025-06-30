import React, { useState } from 'react';

import {
  GOAL_TYPES,
  GOAL_PERIODS,
  GOAL_TYPE_CONFIGS,
  GOAL_PERIOD_CONFIGS,
  CreateGoalData,
  GoalType,
  GoalPeriod,
} from '../types/goals';

interface CreateGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (goalData: CreateGoalData) => Promise<void>;
}

export const CreateGoalModal: React.FC<CreateGoalModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const initialStart = new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState(() => ({
    title: '',
    description: '',
    type: GOAL_TYPES.DISTANCE as GoalType,
    period: GOAL_PERIODS.WEEKLY as GoalPeriod,
    targetValue: '',
    targetUnit: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].defaultUnit,
    startDate: initialStart,
    endDate: calculateEndDate(initialStart, GOAL_PERIODS.WEEKLY),
    color: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].color,
    icon: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].icon,
  }));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Calculate default end date based on period
  function calculateEndDate(startDate: string, period: GoalPeriod): string {
    if (!startDate) return '';
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return '';
    const periodConfig = GOAL_PERIOD_CONFIGS[period];

    if (periodConfig.duration) {
      const end = new Date(start);
      end.setDate(start.getDate() + periodConfig.duration);
      return end.toISOString().split('T')[0];
    }

    // For custom period, default to 30 days
    const end = new Date(start);
    end.setDate(start.getDate() + 30);
    return end.toISOString().split('T')[0];
  }

  // Update form data when goal type changes
  const handleTypeChange = (type: GoalType) => {
    const config = GOAL_TYPE_CONFIGS[type];
    setFormData(prev => ({
      ...prev,
      type,
      targetUnit: config.defaultUnit,
      color: config.color,
      icon: config.icon,
    }));
  };

  // Update form data when period changes
  const handlePeriodChange = (period: GoalPeriod) => {
    const endDate = calculateEndDate(formData.startDate, period);
    setFormData(prev => ({
      ...prev,
      period,
      endDate,
    }));
  };

  // Update end date when start date changes
  const handleStartDateChange = (startDate: string) => {
    const endDate = startDate ? calculateEndDate(startDate, formData.period) : '';
    setFormData(prev => ({
      ...prev,
      startDate,
      endDate,
    }));
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Goal title is required';
    }

    if (!formData.targetValue || parseFloat(formData.targetValue) <= 0) {
      newErrors.targetValue = 'Target value must be a positive number';
    }

    if (!formData.startDate) {
      newErrors.startDate = 'Start date is required';
    }

    if (!formData.endDate) {
      newErrors.endDate = 'End date is required';
    }

    if (formData.startDate && formData.endDate && formData.startDate >= formData.endDate) {
      newErrors.endDate = 'End date must be after start date';
    }

    // Allow goals to start in the past for historical tracking
    // Users may want to track goals that started earlier

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const goalData: CreateGoalData = {
        title: formData.title.trim(),
        description: formData.description.trim() || undefined,
        type: formData.type,
        period: formData.period,
        targetValue: parseFloat(formData.targetValue),
        targetUnit: formData.targetUnit,
        startDate: new Date(formData.startDate),
        endDate: new Date(formData.endDate),
        color: formData.color,
        icon: formData.icon,
      };

      await onSubmit(goalData);

      // Reset form
      setFormData({
        title: '',
        description: '',
        type: GOAL_TYPES.DISTANCE,
        period: GOAL_PERIODS.WEEKLY,
        targetValue: '',
        targetUnit: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].defaultUnit,
        startDate: new Date().toISOString().split('T')[0],
        endDate: '',
        color: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].color,
        icon: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].icon,
      });
      setErrors({});
    } catch (error) {
      console.error('Failed to create goal:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const selectedConfig = GOAL_TYPE_CONFIGS[formData.type];

  return (
    <div
      className='modal-overlay'
      onClick={onClose}
      role='button'
      aria-label='Close modal'
      tabIndex={0}
      onKeyDown={e => e.key === 'Escape' && onClose()}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div className='modal' onClick={e => e.stopPropagation()} role='dialog' tabIndex={-1}>
        <div className='modal-header'>
          <h3>Create New Goal</h3>
          <button className='btn-icon' onClick={onClose} disabled={isSubmitting}>
            ✕
          </button>
        </div>

        <form data-testid='create-goal-form' onSubmit={handleSubmit}>
          <div className='modal-body'>
            {/* Goal Title */}
            <div className='form-group'>
              <label htmlFor='title'>Goal Title *</label>
              <input
                id='title'
                type='text'
                value={formData.title}
                onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder='e.g., Run 50km this month'
                className={errors.title ? 'error' : ''}
              />
              {errors.title && <span className='error-message'>{errors.title}</span>}
            </div>

            {/* Goal Description */}
            <div className='form-group'>
              <label htmlFor='description'>Description</label>
              <textarea
                id='description'
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder='Optional description of your goal...'
                rows={3}
              />
            </div>

            {/* Goal Type */}
            <div className='form-group'>
              <label htmlFor='type'>Goal Type *</label>
              <select
                id='type'
                value={formData.type}
                onChange={e => handleTypeChange(e.target.value as GoalType)}
              >
                {Object.values(GOAL_TYPES).map(type => {
                  const config = GOAL_TYPE_CONFIGS[type];
                  return (
                    <option key={type} value={type}>
                      {config.icon} {config.label}
                    </option>
                  );
                })}
              </select>
              <p className='field-description'>{selectedConfig.description}</p>
            </div>

            {/* Target Value and Unit */}
            <div className='form-row'>
              <div className='form-group'>
                <label htmlFor='targetValue'>Target Value *</label>
                <input
                  id='targetValue'
                  type='number'
                  step='0.1'
                  value={formData.targetValue}
                  onChange={e => setFormData(prev => ({ ...prev, targetValue: e.target.value }))}
                  placeholder='0'
                  className={errors.targetValue ? 'error' : ''}
                />
                {errors.targetValue && <span className='error-message'>{errors.targetValue}</span>}
              </div>

              <div className='form-group'>
                <label htmlFor='targetUnit'>Unit</label>
                <select
                  id='targetUnit'
                  value={formData.targetUnit}
                  onChange={e => setFormData(prev => ({ ...prev, targetUnit: e.target.value }))}
                >
                  {selectedConfig.units.map(unit => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Goal Period */}
            <div className='form-group'>
              <label htmlFor='period'>Time Period *</label>
              <select
                id='period'
                value={formData.period}
                onChange={e => handlePeriodChange(e.target.value as GoalPeriod)}
              >
                {Object.values(GOAL_PERIODS).map(period => {
                  const config = GOAL_PERIOD_CONFIGS[period];
                  return (
                    <option key={period} value={period}>
                      {config.label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Date Range */}
            <div className='form-row'>
              <div className='form-group'>
                <label htmlFor='startDate'>Start Date *</label>
                <input
                  id='startDate'
                  type='date'
                  value={formData.startDate}
                  onChange={e => handleStartDateChange(e.target.value)}
                  className={errors.startDate ? 'error' : ''}
                />
                {errors.startDate && <span className='error-message'>{errors.startDate}</span>}
              </div>

              <div className='form-group'>
                <label htmlFor='endDate'>End Date *</label>
                <input
                  id='endDate'
                  type='date'
                  value={formData.endDate}
                  onChange={e => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                  className={errors.endDate ? 'error' : ''}
                />
                {errors.endDate && <span className='error-message'>{errors.endDate}</span>}
              </div>
            </div>

            {/* Color and Icon */}
            <div className='form-row'>
              <div className='form-group'>
                <label htmlFor='color'>Color</label>
                <input
                  id='color'
                  type='color'
                  value={formData.color}
                  onChange={e => setFormData(prev => ({ ...prev, color: e.target.value }))}
                />
              </div>

              <div className='form-group'>
                <label htmlFor='icon'>Icon</label>
                <input
                  id='icon'
                  type='text'
                  value={formData.icon}
                  onChange={e => setFormData(prev => ({ ...prev, icon: e.target.value }))}
                  placeholder='🎯'
                />
              </div>
            </div>
          </div>

          <div className='modal-footer'>
            <button
              type='button'
              className='btn-secondary'
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button type='submit' className='btn-primary' disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Goal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
