import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CreateGoalModal } from '../../../src/components/CreateGoalModal';
import { GOAL_TYPES, GOAL_PERIODS, GOAL_TYPE_CONFIGS } from '../../../src/types/goals';

// Mock the clientLogger
vi.mock('../../../src/utils/clientLogger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

import { logError } from '../../../src/utils/clientLogger';

describe('CreateGoalModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onSubmit: mockOnSubmit,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  describe('Modal Visibility', () => {
    it('renders when isOpen is true', () => {
      render(<CreateGoalModal {...defaultProps} />);

      expect(screen.getByText('Create New Goal')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      render(<CreateGoalModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('Create New Goal')).not.toBeInTheDocument();
    });

    it('calls onClose when overlay is clicked', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const overlay = document.querySelector('.modalOverlay');
      await user.click(overlay!);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const closeButton = screen.getByRole('button', { name: 'Close modal' });
      await user.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('does not call onClose when modal content is clicked', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const modal = document.querySelector('[role="dialog"]');
      await user.click(modal!);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Form Fields', () => {
    it('renders all required form fields', () => {
      render(<CreateGoalModal {...defaultProps} />);

      expect(screen.getByLabelText('Goal Title')).toBeInTheDocument();
      expect(screen.getByLabelText('Description')).toBeInTheDocument();
      expect(screen.getByLabelText('Goal Type')).toBeInTheDocument();
      expect(screen.getByLabelText('Target Value')).toBeInTheDocument();
      expect(screen.getByLabelText('Unit')).toBeInTheDocument();
      expect(screen.getByLabelText('Time Period')).toBeInTheDocument();
      expect(screen.getByLabelText('Start Date')).toBeInTheDocument();
      expect(screen.getByLabelText('End Date')).toBeInTheDocument();
      expect(screen.getByLabelText('Color')).toBeInTheDocument();
      expect(screen.getByLabelText('Icon')).toBeInTheDocument();
    });

    it('has correct default values', () => {
      render(<CreateGoalModal {...defaultProps} />);

      const titleInput = screen.getByLabelText('Goal Title') as HTMLInputElement;
      const typeSelect = screen.getByLabelText('Goal Type') as HTMLSelectElement;
      const periodSelect = screen.getByLabelText('Time Period') as HTMLSelectElement;

      expect(titleInput.value).toBe('');
      expect(typeSelect.value).toBe(GOAL_TYPES.DISTANCE);
      expect(periodSelect.value).toBe(GOAL_PERIODS.WEEKLY);
    });

    it('updates title field when user types', async () => {
      render(<CreateGoalModal {...defaultProps} />);

      const titleInput = screen.getByLabelText('Goal Title') as HTMLInputElement;

      // Use fireEvent.change for more reliable text input
      fireEvent.change(titleInput, { target: { value: 'Run 50km' } });

      expect(titleInput).toHaveValue('Run 50km');
    });

    it('updates description field when user types', async () => {
      render(<CreateGoalModal {...defaultProps} />);

      const descriptionInput = screen.getByLabelText('Description') as HTMLInputElement;

      // Use fireEvent.change for more reliable text input
      fireEvent.change(descriptionInput, { target: { value: 'Monthly running goal' } });

      expect(descriptionInput).toHaveValue('Monthly running goal');
    });
  });

  describe('Goal Type Selection', () => {
    it('displays all goal types in dropdown', () => {
      render(<CreateGoalModal {...defaultProps} />);

      const typeSelect = screen.getByLabelText('Goal Type');
      const options = typeSelect.querySelectorAll('option');

      expect(options).toHaveLength(Object.values(GOAL_TYPES).length);
      Object.values(GOAL_TYPES).forEach(type => {
        const config = GOAL_TYPE_CONFIGS[type];
        expect(screen.getByText(new RegExp(config.label))).toBeInTheDocument();
      });
    });

    it('updates unit options when goal type changes', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const typeSelect = screen.getByLabelText('Goal Type');
      const unitSelect = screen.getByLabelText('Unit');

      // Initially distance type with km units
      expect(unitSelect).toHaveValue('km');

      // Change to time type
      await user.selectOptions(typeSelect, GOAL_TYPES.TIME);

      // Should switch to default unit for time goals
      expect(unitSelect).toHaveValue('minutes');
    });

    it('updates color and icon when goal type changes', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const typeSelect = screen.getByLabelText('Goal Type');
      const iconInput = screen.getByLabelText('Icon') as HTMLInputElement;

      // Change to time type
      await user.selectOptions(typeSelect, GOAL_TYPES.TIME);

      expect(iconInput.value).toBe('⏱️');
    });
  });

  describe('Period Selection', () => {
    it('displays all goal periods in dropdown', () => {
      render(<CreateGoalModal {...defaultProps} />);

      const periodSelect = screen.getByLabelText('Time Period');
      const options = periodSelect.querySelectorAll('option');

      expect(options).toHaveLength(Object.values(GOAL_PERIODS).length);
      expect(screen.getByText('Weekly')).toBeInTheDocument();
      expect(screen.getByText('Monthly')).toBeInTheDocument();
      expect(screen.getByText('Yearly')).toBeInTheDocument();
    });

    it('updates end date when period changes', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const periodSelect = screen.getByLabelText('Time Period');
      const endDateInput = screen.getByLabelText('End Date') as HTMLInputElement;

      // Change to monthly
      await user.selectOptions(periodSelect, GOAL_PERIODS.MONTHLY);

      // End date should be updated (approximately 30 days from today)
      expect(endDateInput.value).toBeTruthy();

      const startDate = new Date();
      const endDate = new Date(endDateInput.value);
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBeGreaterThan(25); // Approximately monthly
      expect(daysDiff).toBeLessThan(35);
    });
  });

  describe('Date Handling', () => {
    it('sets default start date to today', () => {
      render(<CreateGoalModal {...defaultProps} />);

      const startDateInput = screen.getByLabelText('Start Date') as HTMLInputElement;
      const today = new Date().toISOString().split('T')[0];

      expect(startDateInput.value).toBe(today);
    });

    it('updates end date when start date changes', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const startDateInput = screen.getByLabelText('Start Date');
      const endDateInput = screen.getByLabelText('End Date') as HTMLInputElement;

      const newStartDate = '2024-07-01';
      await user.clear(startDateInput);
      await user.type(startDateInput, newStartDate);

      // End date should be updated based on period
      await waitFor(() => {
        expect(endDateInput.value).toBeTruthy();
      });
      expect(new Date(endDateInput.value)).toBeInstanceOf(Date);
    });

    it('allows manual end date modification', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const endDateInput = screen.getByLabelText('End Date');
      const customEndDate = '2024-08-15';

      await user.clear(endDateInput);
      await user.type(endDateInput, customEndDate);

      expect(endDateInput).toHaveValue(customEndDate);
    });
  });

  describe('Form Validation', () => {
    it('shows error when title is empty', async () => {
      render(<CreateGoalModal {...defaultProps} />);

      // Submit the form directly
      const form = screen.getByTestId('create-goal-form');
      fireEvent.submit(form);

      // The form should not call onSubmit when validation fails
      await waitFor(() => {
        expect(mockOnSubmit).not.toHaveBeenCalled();
      });

      // Wait for validation errors to appear
      await waitFor(() => {
        // Check if the input has error state
        const titleInput = screen.getByLabelText('Goal Title');
        expect(titleInput).toHaveAttribute('aria-invalid', 'true');
      });

      // Check for error message in the DOM
      await waitFor(
        () => {
          const errorMessage = screen.getByText('Goal title is required');
          expect(errorMessage).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('shows error when target value is empty', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const titleInput = screen.getByLabelText('Goal Title');
      await user.type(titleInput, 'Test Goal');

      // Ensure target value is cleared/empty - use fireEvent to directly set empty value
      const targetValueInput = screen.getByLabelText('Target Value');
      fireEvent.change(targetValueInput, { target: { value: '' } });

      // For number inputs, clearing results in null value in the DOM but empty string in React state
      expect(targetValueInput).toHaveValue(null);

      // Submit the form directly (like the working test)
      const form = screen.getByTestId('create-goal-form');
      fireEvent.submit(form);

      // Check for validation state first
      await waitFor(() => {
        const targetInput = screen.getByLabelText('Target Value');
        expect(targetInput).toHaveAttribute('aria-invalid', 'true');
      });

      // Then check for error message
      await waitFor(
        () => {
          expect(screen.getByText('Target value must be a positive number')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('shows error when target value is negative', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const titleInput = screen.getByLabelText('Goal Title');
      const targetValueInput = screen.getByLabelText('Target Value');

      await user.type(titleInput, 'Test Goal');
      await user.type(targetValueInput, '-5');

      const submitButton = screen.getByText('Create Goal');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Target value must be a positive number')).toBeInTheDocument();
      });
    });

    it('shows error when end date is before start date', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const titleInput = screen.getByLabelText('Goal Title');
      const targetValueInput = screen.getByLabelText('Target Value');
      const startDateInput = screen.getByLabelText('Start Date');
      const endDateInput = screen.getByLabelText('End Date');

      await user.type(titleInput, 'Test Goal');
      await user.type(targetValueInput, '10');
      await user.clear(startDateInput);
      await user.type(startDateInput, '2024-07-15');
      await user.clear(endDateInput);
      await user.type(endDateInput, '2024-07-10');

      const submitButton = screen.getByText('Create Goal');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('End date must be after start date')).toBeInTheDocument();
      });
    });

    it('applies error class to invalid fields', async () => {
      render(<CreateGoalModal {...defaultProps} />);

      // Clear required fields to trigger validation errors
      const titleInput = screen.getByLabelText('Goal Title');
      const targetValueInput = screen.getByLabelText('Target Value');
      fireEvent.change(titleInput, { target: { value: '' } });
      fireEvent.change(targetValueInput, { target: { value: '' } });

      // Submit the form directly
      const form = screen.getByTestId('create-goal-form');
      fireEvent.submit(form);

      await waitFor(() => {
        // Check for aria-invalid attribute instead of CSS class
        expect(titleInput).toHaveAttribute('aria-invalid', 'true');
        expect(targetValueInput).toHaveAttribute('aria-invalid', 'true');
      });
    });
  });

  describe('Form Submission', () => {
    it('submits valid form data', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      // Fill in valid form data
      await user.type(screen.getByLabelText('Goal Title'), 'Run 50km');
      // Use fireEvent for description field to ensure it's set correctly
      const descriptionInput = screen.getByLabelText('Description');
      fireEvent.change(descriptionInput, { target: { value: 'Monthly goal' } });
      await user.type(screen.getByLabelText('Target Value'), '50');

      const submitButton = screen.getByText('Create Goal');
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Run 50km',
            description: 'Monthly goal',
            targetValue: 50,
            type: GOAL_TYPES.DISTANCE,
            period: GOAL_PERIODS.WEEKLY,
            targetUnit: 'km',
            color: expect.any(String),
            icon: expect.any(String),
            startDate: expect.any(Date),
            endDate: expect.any(Date),
          })
        );
      });
    });

    it('handles submission with minimal data', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      await user.type(screen.getByLabelText('Goal Title'), 'Test Goal');
      await user.type(screen.getByLabelText('Target Value'), '10');

      const submitButton = screen.getByText('Create Goal');
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
        const callArgs = mockOnSubmit.mock.calls[0][0];
        expect(callArgs).toMatchObject({
          title: 'Test Goal',
          targetValue: 10,
          type: GOAL_TYPES.DISTANCE,
          period: GOAL_PERIODS.WEEKLY,
          targetUnit: 'km',
          color: expect.any(String),
          icon: expect.any(String),
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        });
        // Description should be undefined (not empty string)
        expect(callArgs.description).toBeUndefined();
      });
    });

    it('shows loading state during submission', async () => {
      const user = userEvent.setup();
      let resolveSubmit: (value: unknown) => void;
      mockOnSubmit.mockReturnValue(
        new Promise(resolve => {
          resolveSubmit = resolve;
        })
      );

      render(<CreateGoalModal {...defaultProps} />);

      await user.type(screen.getByLabelText('Goal Title'), 'Test Goal');
      await user.type(screen.getByLabelText('Target Value'), '10');

      const submitButton = screen.getByText('Create Goal');
      await user.click(submitButton);

      expect(screen.getByText('Creating...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Creating.../i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeDisabled();

      resolveSubmit!(undefined);

      await waitFor(() => {
        expect(screen.getByText('Create Goal')).toBeInTheDocument();
      });
    });

    it('resets form after successful submission', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const titleInput = screen.getByLabelText('Goal Title') as HTMLInputElement;
      const descriptionInput = screen.getByLabelText('Description') as HTMLInputElement;
      const targetValueInput = screen.getByLabelText('Target Value') as HTMLInputElement;

      await user.type(titleInput, 'Test Goal');
      await user.type(descriptionInput, 'Test description');
      await user.type(targetValueInput, '25');

      const submitButton = screen.getByText('Create Goal');
      await user.click(submitButton);

      await waitFor(() => {
        expect(titleInput.value).toBe('');
        expect(descriptionInput.value).toBe('');
        expect(targetValueInput.value).toBe('');
      });
    });

    it('handles submission error gracefully', async () => {
      const user = userEvent.setup();
      const mockLogError = vi.mocked(logError);
      mockOnSubmit.mockRejectedValue(new Error('Submission failed'));

      render(<CreateGoalModal {...defaultProps} />);

      await user.type(screen.getByLabelText('Goal Title'), 'Test Goal');
      await user.type(screen.getByLabelText('Target Value'), '10');

      const submitButton = screen.getByText('Create Goal');
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockLogError).toHaveBeenCalledWith('Failed to create goal', expect.any(Error));
        expect(screen.getByText('Create Goal')).toBeInTheDocument(); // Back to normal state
      });
    });
  });

  describe('Cancel Functionality', () => {
    it('calls onClose when cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('disables cancel button during submission', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<CreateGoalModal {...defaultProps} />);

      await user.type(screen.getByLabelText('Goal Title'), 'Test Goal');
      await user.type(screen.getByLabelText('Target Value'), '10');

      const submitButton = screen.getByText('Create Goal');
      await user.click(submitButton);

      await waitFor(() => {
        const cancelButton = screen.getByRole('button', { name: /Cancel/i });
        expect(cancelButton).toBeDisabled();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper labels for all form fields', () => {
      render(<CreateGoalModal {...defaultProps} />);

      expect(screen.getByLabelText('Goal Title')).toBeInTheDocument();
      expect(screen.getByLabelText('Description')).toBeInTheDocument();
      expect(screen.getByLabelText('Goal Type')).toBeInTheDocument();
      expect(screen.getByLabelText('Target Value')).toBeInTheDocument();
      expect(screen.getByLabelText('Unit')).toBeInTheDocument();
      expect(screen.getByLabelText('Time Period')).toBeInTheDocument();
      expect(screen.getByLabelText('Start Date')).toBeInTheDocument();
      expect(screen.getByLabelText('End Date')).toBeInTheDocument();
    });

    it('associates error messages with form fields', async () => {
      render(<CreateGoalModal {...defaultProps} />);

      // Submit the form directly
      const form = screen.getByTestId('create-goal-form');
      fireEvent.submit(form);

      await waitFor(() => {
        const titleInput = screen.getByLabelText('Goal Title');
        const errorMessage = screen.getByText('Goal title is required');

        // Check ARIA relationship
        const describedBy = titleInput.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(errorMessage).toHaveAttribute('id', expect.stringContaining('title-message'));
      });
    });

    it('has proper form structure', () => {
      render(<CreateGoalModal {...defaultProps} />);

      const form = screen.getByTestId('create-goal-form');
      expect(form).toBeInTheDocument();

      const submitButton = screen.getByRole('button', { name: /create goal/i });
      expect(submitButton).toHaveAttribute('type', 'submit');
    });
  });

  describe('Field Descriptions', () => {
    it('shows goal type description', () => {
      render(<CreateGoalModal {...defaultProps} />);

      // Should show description for default distance goal type
      expect(screen.getByText(/Total distance to run over time period/)).toBeInTheDocument();
    });

    it('updates description when goal type changes', async () => {
      const user = userEvent.setup();
      render(<CreateGoalModal {...defaultProps} />);

      const typeSelect = screen.getByLabelText('Goal Type');
      await user.selectOptions(typeSelect, GOAL_TYPES.TIME);

      expect(screen.getByText(/Total time to spend running/)).toBeInTheDocument();
    });
  });
});
