import React, { useState, useEffect } from 'react';

import { CreateGoalData, GoalPeriod } from '../../types/goals';
import { GoalTemplate } from '../../types/goalTemplates';

interface TemplateCustomizationModalProps {
  template: GoalTemplate | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (goalData: CreateGoalData) => void;
}

export const TemplateCustomizationModal: React.FC<TemplateCustomizationModalProps> = ({
  template,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    targetValue: 0,
    period: 'WEEKLY' as GoalPeriod,
    startDate: '',
    endDate: '',
    color: '#3b82f6',
    icon: '🎯',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initialize form data when template changes
  useEffect(() => {
    if (template) {
      const today = new Date();
      const startDate = today.toISOString().split('T')[0];

      let endDate = '';
      switch (template.period) {
        case 'WEEKLY': {
          const weekEnd = new Date(today);
          weekEnd.setDate(today.getDate() + 6);
          endDate = weekEnd.toISOString().split('T')[0];
          break;
        }
        case 'MONTHLY': {
          const monthEnd = new Date(today);
          monthEnd.setMonth(today.getMonth() + 1);
          monthEnd.setDate(0); // Last day of current month
          endDate = monthEnd.toISOString().split('T')[0];
          break;
        }
        case 'YEARLY': {
          const yearEnd = new Date(today);
          yearEnd.setFullYear(today.getFullYear() + 1);
          yearEnd.setDate(yearEnd.getDate() - 1);
          endDate = yearEnd.toISOString().split('T')[0];
          break;
        }
        case 'CUSTOM':
        default: {
          // For custom periods, set a reasonable default based on template type
          const customEnd = new Date(today);
          if (template.estimatedTimeframe.includes('week')) {
            const weeks = parseInt(template.estimatedTimeframe.match(/(\d+)/)?.[1] || '12');
            customEnd.setDate(today.getDate() + weeks * 7);
          } else if (template.estimatedTimeframe.includes('month')) {
            const months = parseInt(template.estimatedTimeframe.match(/(\d+)/)?.[1] || '3');
            customEnd.setMonth(today.getMonth() + months);
          } else {
            customEnd.setDate(today.getDate() + 84); // 12 weeks default
          }
          endDate = customEnd.toISOString().split('T')[0];
          break;
        }
      }

      setFormData({
        title: template.name,
        description: template.description,
        targetValue: template.targetValue,
        period: template.period,
        startDate,
        endDate,
        color: template.color,
        icon: template.icon,
      });
    }
  }, [template]);

  const handleInputChange = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Goal title is required';
    }

    if (formData.targetValue <= 0) {
      newErrors.targetValue = 'Target value must be greater than 0';
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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!template || !validateForm()) {
      return;
    }

    const goalData: CreateGoalData = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      type: template.type,
      targetValue: formData.targetValue,
      targetUnit: template.targetUnit,
      period: formData.period,
      startDate: new Date(formData.startDate),
      endDate: new Date(formData.endDate),
      color: formData.color,
      icon: formData.icon,
    };

    onConfirm(goalData);
  };

  const formatTargetLabel = () => {
    if (!template) return 'Target';

    switch (template.type) {
      case 'TIME':
        return 'Target Time (seconds)';
      case 'DISTANCE':
        return `Target Distance (${template.targetUnit})`;
      case 'FREQUENCY':
        return `Target Frequency (${template.targetUnit})`;
      case 'PACE':
        return 'Target Pace (seconds)';
      case 'LONGEST_RUN':
        return `Longest Run (${template.targetUnit})`;
      default:
        return `Target (${template.targetUnit})`;
    }
  };

  const getTimeInputHelp = () => {
    if (template?.type === 'TIME') {
      const minutes = Math.floor(formData.targetValue / 60);
      const seconds = formData.targetValue % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    return '';
  };

  if (!isOpen || !template) return null;

  return (
    <div
      className='modal-overlay'
      role='button'
      tabIndex={0}
      aria-label='Close modal'
      onClick={onClose}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className='modal template-customization-modal'
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role='dialog'
        aria-modal='true'
        aria-labelledby='template-customization-title'
        tabIndex={-1}
      >
        <div className='modal-header'>
          <div className='template-modal-title'>
            <div className='template-modal-icon' style={{ color: template.color }}>
              {template.icon}
            </div>
            <div>
              <h3 id='template-customization-title'>Customize Goal Template</h3>
              <p className='template-modal-subtitle'>{template.name}</p>
            </div>
          </div>
          <button className='btn-icon' onClick={onClose} type='button'>
            ×
          </button>
        </div>

        <div className='modal-body'>
          <form onSubmit={handleSubmit}>
            <div className='template-info'>
              <div className='template-info-section'>
                <h4>About This Template</h4>
                <p>{template.description}</p>
                <div className='template-meta'>
                  <span className='template-difficulty'>
                    Difficulty: <strong>{template.difficulty}</strong>
                  </span>
                  <span className='template-timeframe'>
                    Timeframe: <strong>{template.estimatedTimeframe}</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className='form-group'>
              <label htmlFor='title'>Goal Title</label>
              <input
                type='text'
                id='title'
                value={formData.title}
                onChange={e => handleInputChange('title', e.target.value)}
                className={errors.title ? 'error' : ''}
                placeholder='Enter a custom name for your goal'
              />
              {errors.title && <span className='error-message'>{errors.title}</span>}
            </div>

            <div className='form-group'>
              <label htmlFor='description'>Description (Optional)</label>
              <textarea
                id='description'
                value={formData.description}
                onChange={e => handleInputChange('description', e.target.value)}
                placeholder='Add your own notes or motivation'
                rows={3}
              />
            </div>

            <div className='form-row'>
              <div className='form-group'>
                <label htmlFor='targetValue'>{formatTargetLabel()}</label>
                <input
                  type='number'
                  id='targetValue'
                  value={formData.targetValue}
                  onChange={e => handleInputChange('targetValue', Number(e.target.value))}
                  className={errors.targetValue ? 'error' : ''}
                  min='0'
                  step={template.type === 'DISTANCE' ? '0.1' : '1'}
                />
                {template.type === 'TIME' && formData.targetValue > 0 && (
                  <span className='field-description'>Time: {getTimeInputHelp()}</span>
                )}
                {errors.targetValue && <span className='error-message'>{errors.targetValue}</span>}
              </div>

              <div className='form-group'>
                <label htmlFor='period'>Goal Period</label>
                <select
                  id='period'
                  value={formData.period}
                  onChange={e => handleInputChange('period', e.target.value)}
                >
                  <option value='WEEKLY'>Weekly</option>
                  <option value='MONTHLY'>Monthly</option>
                  <option value='YEARLY'>Yearly</option>
                  <option value='CUSTOM'>Custom Period</option>
                </select>
              </div>
            </div>

            <div className='form-row'>
              <div className='form-group'>
                <label htmlFor='startDate'>Start Date</label>
                <input
                  type='date'
                  id='startDate'
                  value={formData.startDate}
                  onChange={e => handleInputChange('startDate', e.target.value)}
                  className={errors.startDate ? 'error' : ''}
                />
                {errors.startDate && <span className='error-message'>{errors.startDate}</span>}
              </div>

              <div className='form-group'>
                <label htmlFor='endDate'>End Date</label>
                <input
                  type='date'
                  id='endDate'
                  value={formData.endDate}
                  onChange={e => handleInputChange('endDate', e.target.value)}
                  className={errors.endDate ? 'error' : ''}
                />
                {errors.endDate && <span className='error-message'>{errors.endDate}</span>}
              </div>
            </div>

            <div className='form-row'>
              <div className='form-group'>
                <label htmlFor='icon'>Icon</label>
                <input
                  type='text'
                  id='icon'
                  value={formData.icon}
                  onChange={e => handleInputChange('icon', e.target.value)}
                  placeholder='🎯'
                  maxLength={2}
                />
              </div>

              <div className='form-group'>
                <label htmlFor='color'>Color</label>
                <input
                  type='color'
                  id='color'
                  value={formData.color}
                  onChange={e => handleInputChange('color', e.target.value)}
                />
              </div>
            </div>

            {template.tips && template.tips.length > 0 && (
              <div className='template-tips'>
                <h4>Training Tips</h4>
                <ul>
                  {template.tips.slice(0, 3).map((tip, index) => (
                    <li key={index}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </form>
        </div>

        <div className='modal-footer'>
          <button type='button' className='btn-secondary' onClick={onClose}>
            Cancel
          </button>
          <button type='submit' className='btn-primary' onClick={handleSubmit}>
            Create Goal
          </button>
        </div>
      </div>
    </div>
  );
};
