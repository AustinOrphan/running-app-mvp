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
import { logError } from '../utils/clientLogger';
import { Modal } from './UI/Modal';
import { Input, InputGroup, TextArea } from './UI/Input';
import { Button } from './UI/Button';

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

    if (!formData.targetValue || Number.parseFloat(formData.targetValue) <= 0) {
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
        targetValue: Number.parseFloat(formData.targetValue),
        targetUnit: formData.targetUnit,
        startDate: new Date(formData.startDate),
        endDate: new Date(formData.endDate),
        color: formData.color,
        icon: formData.icon,
      };

      await onSubmit(goal.id, updatedData);

      setErrors({});
    } catch (error) {
      logError('Failed to update goal', error instanceof Error ? error : new Error(String(error)));
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
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title="Edit Goal"
      size="large"
    >

      <form onSubmit={handleSubmit}>
        {/* Goal Title */}
        <Input
          id='edit-title'
          type='text'
          label='Goal Title'
          value={formData.title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          placeholder='e.g., Run 50km this month'
          error={!!errors.title}
          errorMessage={errors.title}
          required
        />

        {/* Goal Description */}
        <TextArea
          id='edit-description'
          label='Description'
          value={formData.description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder='Optional description of your goal...'
          rows={3}
        />

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
        <InputGroup horizontal label='Target Value'>
          <Input
            id='edit-targetValue'
            type='number'
            label='Target Value'
            value={formData.targetValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, targetValue: e.target.value }))}
            placeholder='0'
            error={!!errors.targetValue}
            errorMessage={errors.targetValue}
            required
            step='0.1'
            min='0'
          />
          
          <div className='form-group'>
            <label htmlFor='edit-targetUnit'>Unit</label>
            <select
              id='edit-targetUnit'
              value={formData.targetUnit}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormData(prev => ({ ...prev, targetUnit: e.target.value }))}
            >
              {selectedConfig.units.map(unit => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
        </InputGroup>

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
        <InputGroup horizontal label='Date Range'>
          <Input
            id='edit-startDate'
            type='date'
            label='Start Date'
            value={formData.startDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleStartDateChange(e.target.value)}
            error={!!errors.startDate}
            errorMessage={errors.startDate}
            required
          />
          
          <Input
            id='edit-endDate'
            type='date'
            label='End Date'
            value={formData.endDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
            error={!!errors.endDate}
            errorMessage={errors.endDate}
            required
          />
        </InputGroup>

        {/* Color and Icon */}
        <InputGroup horizontal label='Appearance'>
          <Input
            id='edit-color'
            type='color'
            label='Color'
            value={formData.color}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, color: e.target.value }))}
          />
          
          <Input
            id='edit-icon'
            type='text'
            label='Icon'
            value={formData.icon}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, icon: e.target.value }))}
            placeholder='🎯'
          />
        </InputGroup>
        
        <div className='modal-footer'>
          <Button
            type='button'
            variant='secondary'
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type='submit' variant='primary' disabled={isSubmitting}>
            {isSubmitting ? 'Updating...' : 'Update Goal'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
