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
import { logError } from '../utils/clientLogger';
import { Modal } from './UI/Modal';
import { Input, InputGroup, TextArea } from './UI/Input';
import { Button } from './UI/Button';

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
        targetValue: Number.parseFloat(formData.targetValue),
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
      logError('Failed to create goal', error instanceof Error ? error : new Error(String(error)));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const selectedConfig = GOAL_TYPE_CONFIGS[formData.type];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title='Create New Goal' size='large'>
      <form data-testid='create-goal-form' onSubmit={handleSubmit}>
        {/* Goal Title */}
        <Input
          id='title'
          type='text'
          label='Goal Title'
          value={formData.title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormData(prev => ({ ...prev, title: e.target.value }))
          }
          placeholder='e.g., Run 50km this month'
          error={!!errors.title}
          errorMessage={errors.title}
          required
        />

        {/* Goal Description */}
        <TextArea
          id='description'
          label='Description'
          value={formData.description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setFormData(prev => ({ ...prev, description: e.target.value }))
          }
          placeholder='Optional description of your goal...'
          rows={3}
        />

        {/* Goal Type */}
        <div className='form-group'>
          <label htmlFor='type' className='required'>
            Goal Type
          </label>
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
        <InputGroup horizontal label='Target Value'>
          <Input
            id='targetValue'
            type='number'
            label='Target Value'
            value={formData.targetValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData(prev => ({ ...prev, targetValue: e.target.value }))
            }
            placeholder='0'
            error={!!errors.targetValue}
            errorMessage={errors.targetValue}
            required
            step='0.1'
          />

          <div className='form-group'>
            <label htmlFor='targetUnit'>Unit</label>
            <select
              id='targetUnit'
              value={formData.targetUnit}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setFormData(prev => ({ ...prev, targetUnit: e.target.value }))
              }
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
          <label htmlFor='period' className='required'>
            Time Period
          </label>
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
        <InputGroup horizontal label='Date Range'>
          <Input
            id='startDate'
            type='date'
            label='Start Date'
            value={formData.startDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              handleStartDateChange(e.target.value)
            }
            error={!!errors.startDate}
            errorMessage={errors.startDate}
            required
          />

          <Input
            id='endDate'
            type='date'
            label='End Date'
            value={formData.endDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData(prev => ({ ...prev, endDate: e.target.value }))
            }
            error={!!errors.endDate}
            errorMessage={errors.endDate}
            required
          />
        </InputGroup>

        {/* Color and Icon */}
        <InputGroup horizontal label='Appearance'>
          <Input
            id='color'
            type='color'
            label='Color'
            value={formData.color}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData(prev => ({ ...prev, color: e.target.value }))
            }
          />

          <Input
            id='icon'
            type='text'
            label='Icon'
            value={formData.icon}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData(prev => ({ ...prev, icon: e.target.value }))
            }
            placeholder='🎯'
          />
        </InputGroup>

        <div className='modal-footer'>
          <Button type='button' variant='secondary' onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type='submit' variant='primary' disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Goal'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
