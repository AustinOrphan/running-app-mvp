import React, { useState, useEffect } from 'react';

import {
  GOAL_TYPES,
  GOAL_PERIODS,
  GOAL_TYPE_CONFIGS,
  GOAL_PERIOD_CONFIGS,
  Goal,
  GoalType,
  GoalPeriod,
} from '../types/goals';

interface EditGoalModalProps {
  isOpen: boolean;
  goal: Goal | null;
  onClose: () => void;
  onSubmit: (goalId: string, goalData: Partial<Goal>) => Promise<void>;
}

export const EditGoalModal: React.FC<EditGoalModalProps> = ({
  isOpen,
  goal,
  onClose,
  onSubmit,
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: GOAL_TYPES.DISTANCE as GoalType,
    period: GOAL_PERIODS.WEEKLY as GoalPeriod,
    targetValue: '',
    targetUnit: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].defaultUnit,
    startDate: '',
    endDate: '',
    color: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].color,
    icon: GOAL_TYPE_CONFIGS[GOAL_TYPES.DISTANCE].icon,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form data when goal prop changes
  useEffect(() => {
    if (goal) {
      setFormData({
        title: goal.title,
        description: goal.description || '',
        type: goal.type,
        period: goal.period,
        targetValue: goal.targetValue.toString(),
        targetUnit: goal.targetUnit,
        startDate: new Date(goal.startDate).toISOString().split('T')[0],
        endDate: new Date(goal.endDate).toISOString().split('T')[0],
        color: goal.color || GOAL_TYPE_CONFIGS[goal.type].color,
        icon: goal.icon || GOAL_TYPE_CONFIGS[goal.type].icon,
      });
    }
  }, [goal]);

  // Calculate default end date based on period
  const calculateEndDate = (startDate: string, period: GoalPeriod): string => {
    const start = new Date(startDate);
    const periodConfig = GOAL_PERIOD_CONFIGS[period];

    if (periodConfig.duration) {
      const end = new Date(start);
      end.setDate(start.getDate() + periodConfig.duration);
      return end.toISOString().split('T')[0];
    }

    // For custom period, keep current end date or default to 30 days
    const end = new Date(start);
    end.setDate(start.getDate() + 30);
    return end.toISOString().split('T')[0];
  };

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
    // Only auto-update end date if it's not a custom period or if user wants it
    if (period !== GOAL_PERIODS.CUSTOM) {
      const endDate = calculateEndDate(formData.startDate, period);
      setFormData(prev => ({
        ...prev,
        period,
        endDate,
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        period,
      }));
    }
  };

  // Update end date when start date changes (only for non-custom periods)
  const handleStartDateChange = (startDate: string) => {
    if (formData.period !== GOAL_PERIODS.CUSTOM) {
      const endDate = calculateEndDate(startDate, formData.period);
      setFormData(prev => ({
        ...prev,
        startDate,
        endDate,
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        startDate,
      }));
    }
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

    // Allow historical start dates for goal editing
    // Users may need to adjust goal periods or correct initial dates

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!goal || !validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const updatedData: Partial<Goal> = {
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

      await onSubmit(goal.id, updatedData);

      setErrors({});
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to update goal:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setErrors({});
    onClose();
  };

  if (!isOpen || !goal) return null;

  const selectedConfig = GOAL_TYPE_CONFIGS[formData.type];

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className='modal-overlay'
      onClick={handleClose}
      onKeyDown={e => e.key === 'Escape' && handleClose()}
      role='dialog'
      aria-modal='true'
      tabIndex={-1}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        className='modal'
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role='document'
        tabIndex={0}
      >
        <div className='modal-header'>
          <h3>Edit Goal</h3>
          <button className='btn-icon' onClick={handleClose} disabled={isSubmitting}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className='modal-body'>
            {/* Goal Title */}
            <div className='form-group'>
              <label htmlFor='edit-title'>Goal Title *</label>
              <input
                id='edit-title'
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
              <label htmlFor='edit-description'>Description</label>
              <textarea
                id='edit-description'
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder='Optional description of your goal...'
                rows={3}
              />
            </div>

            {/* Goal Type */}
            <div className='form-group'>
              <label htmlFor='edit-type'>Goal Type *</label>
              <select
                id='edit-type'
                value={formData.type}
                onChange={e => handleTypeChange(e.target.value as GoalType)}
                disabled={goal.isCompleted} // Prevent changing type of completed goals
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
              {goal.isCompleted && (
                <p className='field-description' style={{ color: '#f59e0b' }}>
                  Cannot change goal type for completed goals
                </p>
              )}
            </div>

            {/* Target Value and Unit */}
            <div className='form-row'>
              <div className='form-group'>
                <label htmlFor='edit-targetValue'>Target Value *</label>
                <input
                  id='edit-targetValue'
                  type='number'
                  step='0.1'
                  min='0'
                  value={formData.targetValue}
                  onChange={e => setFormData(prev => ({ ...prev, targetValue: e.target.value }))}
                  placeholder='0'
                  className={errors.targetValue ? 'error' : ''}
                />
                {errors.targetValue && <span className='error-message'>{errors.targetValue}</span>}
              </div>

              <div className='form-group'>
                <label htmlFor='edit-targetUnit'>Unit</label>
                <select
                  id='edit-targetUnit'
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
              <label htmlFor='edit-period'>Time Period *</label>
              <select
                id='edit-period'
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
                <label htmlFor='edit-startDate'>Start Date *</label>
                <input
                  id='edit-startDate'
                  type='date'
                  value={formData.startDate}
                  onChange={e => handleStartDateChange(e.target.value)}
                  className={errors.startDate ? 'error' : ''}
                />
                {errors.startDate && <span className='error-message'>{errors.startDate}</span>}
              </div>

              <div className='form-group'>
                <label htmlFor='edit-endDate'>End Date *</label>
                <input
                  id='edit-endDate'
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
                <label htmlFor='edit-color'>Color</label>
                <input
                  id='edit-color'
                  type='color'
                  value={formData.color}
                  onChange={e => setFormData(prev => ({ ...prev, color: e.target.value }))}
                />
              </div>

              <div className='form-group'>
                <label htmlFor='edit-icon'>Icon</label>
                <input
                  id='edit-icon'
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
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button type='submit' className='btn-primary' disabled={isSubmitting}>
              {isSubmitting ? 'Updating...' : 'Update Goal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
