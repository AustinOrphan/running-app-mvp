import { useState } from 'react';
import { RunFormData } from '../types';

export const useRunForm = (initialData?: Partial<RunFormData>) => {
  const [formData, setFormData] = useState<RunFormData>({
    date: new Date().toISOString().split('T')[0],
    distance: '',
    duration: '',
    tag: '',
    notes: '',
    ...initialData
  });
  
  const [errors, setErrors] = useState<{[key: string]: string}>({});

  const updateField = (field: keyof RunFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validate = (): boolean => {
    const newErrors: {[key: string]: string} = {};
    
    if (!formData.distance || Number(formData.distance) <= 0) {
      newErrors.distance = 'Distance must be greater than 0';
    }
    if (!formData.duration || Number(formData.duration) <= 0) {
      newErrors.duration = 'Duration must be greater than 0';
    }
    if (!formData.date) {
      newErrors.date = 'Date is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const reset = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      distance: '',
      duration: '',
      tag: '',
      notes: ''
    });
    setErrors({});
  };

  return {
    formData,
    errors,
    updateField,
    validate,
    reset,
    setFormData
  };
};