import React from 'react';
import { Input, InputGroup, TextArea, Select } from '../UI';
import { Button, ButtonGroup } from '../UI';
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
    <form onSubmit={onSubmit}>
      <h3>{editingRun ? 'Edit Run' : 'Add New Run'}</h3>

      <InputGroup horizontal label='Run Details'>
        <Input
          id='run-date'
          type='date'
          label='Date'
          value={formData.date}
          onChange={e => onUpdateField('date', e.target.value)}
          error={!!errors.date}
          errorMessage={errors.date}
          required
        />

        <Input
          id='run-distance'
          type='number'
          label='Distance (km)'
          step='0.1'
          value={formData.distance}
          onChange={e => onUpdateField('distance', e.target.value)}
          placeholder='5.0'
          error={!!errors.distance}
          errorMessage={errors.distance}
          required
        />

        <Input
          id='run-duration'
          type='number'
          label='Duration (minutes)'
          value={formData.duration}
          onChange={e => onUpdateField('duration', e.target.value)}
          placeholder='30'
          error={!!errors.duration}
          errorMessage={errors.duration}
          required
        />
      </InputGroup>

      <Select
        id='run-tag'
        label='Tag (optional)'
        value={formData.tag}
        onChange={e => onUpdateField('tag', e.target.value)}
        placeholder='Select a tag'
        options={[
          { value: 'Training', label: 'Training' },
          { value: 'Race', label: 'Race' },
          { value: 'Easy', label: 'Easy' },
          { value: 'Long', label: 'Long Run' },
          { value: 'Speed', label: 'Speed Work' },
        ]}
      />

      <TextArea
        id='run-notes'
        label='Notes (optional)'
        value={formData.notes}
        onChange={e => onUpdateField('notes', e.target.value)}
        placeholder='How did it feel? Route details, weather, etc.'
        rows={3}
        autoResize
        maxAutoHeight={150}
      />

      <ButtonGroup align='justified'>
        <Button type='submit' variant='primary' loading={loading} disabled={loading}>
          {editingRun ? 'Update Run' : 'Save Run'}
        </Button>
        <Button type='button' variant='secondary' onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      </ButtonGroup>
    </form>
  );
};
