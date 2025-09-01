import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditGoalModal } from '../../../src/components/EditGoalModal';
import { Goal, GOAL_TYPES, GOAL_PERIODS } from '../../../src/types/goals';

// Mock client logger
vi.mock('../../../src/utils/clientLogger', () => ({
  logError: vi.fn(),
}));

// Mock CSS modules
vi.mock('../../../src/styles/components/Modal.module.css', () => ({
  default: {
    modal: 'modal',
    modalHeader: 'modalHeader',
    modalBody: 'modalBody',
    modalFooter: 'modalFooter',
  },
}));

// Mock UI components
vi.mock('../../../src/components/UI/Modal', () => ({
  Modal: ({ isOpen, onClose, title, children }: any) =>
    isOpen ? (
      <div data-testid='modal' role='dialog' aria-label={title}>
        <h1>{title}</h1>
        <button onClick={onClose} data-testid='modal-close'>
          ×
        </button>
        {children}
      </div>
    ) : null,
}));

vi.mock('../../../src/components/UI/Input', () => ({
  Input: ({ id, label, value, onChange, error, errorMessage, type, ...props }: any) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type || 'text'}
        value={value}
        onChange={onChange}
        data-testid={id}
        aria-invalid={error}
        {...props}
      />
      {error && errorMessage && <span data-testid={`${id}-error`}>{errorMessage}</span>}
    </div>
  ),
  TextArea: ({ id, label, value, onChange }: any) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} value={value} onChange={onChange} data-testid={id} />
    </div>
  ),
  InputGroup: ({ children, label }: any) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
}));

vi.mock('../../../src/components/UI/Button', () => ({
  Button: ({ children, onClick, disabled, type, variant, ...props }: any) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-testid={`button-${variant || 'default'}`}
      {...props}
    >
      {children}
    </button>
  ),
}));

// Test constants and setup
const MODAL_TITLE = 'Edit Goal';
const EDIT_TITLE_ID = 'edit-title';
const EDIT_DESCRIPTION_ID = 'edit-description';
const EDIT_START_DATE_ID = 'edit-startDate';
const EDIT_END_DATE_ID = 'edit-endDate';
const EDIT_TARGET_VALUE_ID = 'edit-targetValue';
const EDIT_COLOR_ID = 'edit-color';
const EDIT_ICON_ID = 'edit-icon';
const BUTTON_PRIMARY_ID = 'button-primary';
const BUTTON_SECONDARY_ID = 'button-secondary';
const GOAL_TYPE_LABEL = 'Goal Type *';
const TIME_PERIOD_LABEL = 'Time Period *';
const UNIT_LABEL = 'Unit';

const mockOnClose = vi.fn();
const mockOnSubmit = vi.fn();

const BASE_GOAL_START_DATE = '2024-01-01';
const BASE_GOAL_END_DATE = '2024-01-31';
const BASE_GOAL_UPDATED_DATE = '2024-01-15';
const BASE_GOAL_TITLE = 'Run 50km this month';
const BASE_GOAL_DESCRIPTION = 'Monthly running goal for fitness';

const baseGoal: Goal = {
  id: 'test-goal-1',
  userId: 'test-user',
  title: BASE_GOAL_TITLE,
  description: BASE_GOAL_DESCRIPTION,
  type: GOAL_TYPES.DISTANCE,
  period: GOAL_PERIODS.MONTHLY,
  targetValue: 50,
  targetUnit: 'km',
  startDate: new Date(BASE_GOAL_START_DATE),
  endDate: new Date(BASE_GOAL_END_DATE),
  currentValue: 25,
  isCompleted: false,
  completedAt: undefined,
  color: '#3b82f6',
  icon: '🎯',
  isActive: true,
  createdAt: new Date(BASE_GOAL_START_DATE),
  updatedAt: new Date(BASE_GOAL_UPDATED_DATE),
};

const renderModal = (props: Partial<EditGoalModalProps> = {}) => {
  return render(
    <EditGoalModal
      isOpen={true}
      goal={baseGoal}
      onClose={mockOnClose}
      onSubmit={mockOnSubmit}
      {...props}
    />
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EditGoalModal', () => {
  // Modal Visibility Tests
  it('renders nothing when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('renders nothing when goal is null', () => {
    renderModal({ goal: null });
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('renders modal when isOpen is true and goal is provided', () => {
    renderModal();
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByText(MODAL_TITLE)).toBeInTheDocument();
  });

  it('calls onClose when modal close button is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  // Form Pre-population Tests
  it('pre-populates form with goal data', () => {
    renderModal();

    expect(screen.getByDisplayValue(BASE_GOAL_TITLE)).toBeInTheDocument();
    expect(screen.getByDisplayValue(BASE_GOAL_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByDisplayValue(50)).toBeInTheDocument();
    expect(screen.getByDisplayValue('🎯')).toBeInTheDocument();
    expect(screen.getByDisplayValue('#3b82f6')).toBeInTheDocument();
  });

  it('handles goal without description', () => {
    renderModal({ goal: { ...baseGoal, description: undefined } });
    expect(screen.getByTestId(EDIT_DESCRIPTION_ID)).toHaveValue('');
  });

  it('formats dates correctly for form inputs', () => {
    renderModal();
    expect(screen.getByTestId(EDIT_START_DATE_ID)).toHaveValue(BASE_GOAL_START_DATE);
    expect(screen.getByTestId(EDIT_END_DATE_ID)).toHaveValue(BASE_GOAL_END_DATE);
  });

  it('updates form when goal prop changes', () => {
    const { rerender } = renderModal();
    expect(screen.getByDisplayValue(BASE_GOAL_TITLE)).toBeInTheDocument();

    const newGoal = { ...baseGoal, title: 'Run 100km this month', targetValue: 100 };
    rerender(
      <EditGoalModal isOpen={true} goal={newGoal} onClose={mockOnClose} onSubmit={mockOnSubmit} />
    );

    expect(screen.getByDisplayValue('Run 100km this month')).toBeInTheDocument();
    expect(screen.getByDisplayValue(100)).toBeInTheDocument();
  });

  // Goal Type Change Tests
  it('updates unit options when goal type changes', () => {
    renderModal();
    const typeSelect = screen.getByLabelText(GOAL_TYPE_LABEL);
    fireEvent.change(typeSelect, { target: { value: GOAL_TYPES.TIME } });
    expect(screen.getByLabelText(UNIT_LABEL)).toHaveValue('minutes');
  });

  it('updates color when goal type changes', () => {
    renderModal();
    const typeSelect = screen.getByLabelText(GOAL_TYPE_LABEL);
    fireEvent.change(typeSelect, { target: { value: GOAL_TYPES.TIME } });
    expect(screen.getByTestId(EDIT_COLOR_ID)).toHaveValue('#10b981');
  });

  it('updates icon when goal type changes', () => {
    renderModal();
    const typeSelect = screen.getByLabelText(GOAL_TYPE_LABEL);
    fireEvent.change(typeSelect, { target: { value: GOAL_TYPES.TIME } });
    expect(screen.getByTestId(EDIT_ICON_ID)).toHaveValue('⏱️');
  });

  it('disables goal type for completed goals', () => {
    renderModal({ goal: { ...baseGoal, isCompleted: true } });
    expect(screen.getByLabelText(GOAL_TYPE_LABEL)).toBeDisabled();
  });

  it('shows warning message for completed goals', () => {
    renderModal({ goal: { ...baseGoal, isCompleted: true } });
    expect(screen.getByText('Cannot change goal type for completed goals')).toBeInTheDocument();
  });

  // Period and Date Logic Tests
  it('calculates end date when period changes', () => {
    renderModal();
    const periodSelect = screen.getByLabelText(TIME_PERIOD_LABEL);
    fireEvent.change(periodSelect, { target: { value: GOAL_PERIODS.WEEKLY } });
    expect(screen.getByTestId(EDIT_END_DATE_ID)).toHaveValue('2024-01-08');
  });

  it('recalculates end date when start date changes', () => {
    renderModal();
    const startDateInput = screen.getByTestId(EDIT_START_DATE_ID);
    fireEvent.change(startDateInput, { target: { value: '2024-02-01' } });
    expect(screen.getByTestId(EDIT_END_DATE_ID)).toHaveValue('2024-03-02');
  });

  it('does not auto-update end date for custom periods', () => {
    renderModal({ goal: { ...baseGoal, period: GOAL_PERIODS.CUSTOM } });
    const endDateInput = screen.getByTestId(EDIT_END_DATE_ID);
    const originalEndDate = endDateInput.getAttribute('value');
    fireEvent.change(screen.getByTestId(EDIT_START_DATE_ID), { target: { value: '2024-02-01' } });
    expect(endDateInput).toHaveValue(originalEndDate);
  });

  // Form Validation Tests
  it('prevents submission for empty title', async () => {
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByTestId(EDIT_TITLE_ID), { target: { value: '' } });
      fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID));
    });
    await waitFor(() => {
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  it('prevents submission for invalid target value', async () => {
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByTestId(EDIT_TARGET_VALUE_ID), { target: { value: '0' } });
      fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID));
    });
    await waitFor(() => {
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  it('prevents submission when end date is before start date', async () => {
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByTestId(EDIT_START_DATE_ID), { target: { value: '2024-01-15' } });
      fireEvent.change(screen.getByTestId(EDIT_END_DATE_ID), { target: { value: '2024-01-10' } });
      fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID));
    });
    await waitFor(() => {
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  it('prevents submission for missing start date', async () => {
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByTestId(EDIT_START_DATE_ID), { target: { value: '' } });
      fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID));
    });
    await waitFor(() => {
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  it('prevents submission for missing end date', async () => {
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByTestId(EDIT_END_DATE_ID), { target: { value: '' } });
      fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID));
    });
    await waitFor(() => {
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  // Form Submission Tests
  it('submits form with valid data', async () => {
    mockOnSubmit.mockResolvedValue(undefined);
    renderModal();
    fireEvent.change(screen.getByTestId(EDIT_TITLE_ID), {
      target: { value: 'Updated Goal Title' },
    });
    fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        baseGoal.id,
        expect.objectContaining({
          title: 'Updated Goal Title',
          description: BASE_GOAL_DESCRIPTION,
          type: GOAL_TYPES.DISTANCE,
          period: GOAL_PERIODS.MONTHLY,
          targetValue: 50,
          targetUnit: 'km',
          color: '#3b82f6',
          icon: '🎯',
        })
      );
    });
  });

  it('shows loading state during submission', async () => {
    let resolveSubmit: () => void;
    const submitPromise = new Promise<void>(resolve => {
      resolveSubmit = resolve;
    });
    mockOnSubmit.mockReturnValue(submitPromise);
    renderModal();
    const submitButton = screen.getByTestId(BUTTON_PRIMARY_ID);

    fireEvent.click(submitButton);
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent('Updating...');

    resolveSubmit!();
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
      expect(submitButton).toHaveTextContent('Update Goal');
    });
  });

  it('handles submission errors gracefully', async () => {
    mockOnSubmit.mockRejectedValue(new Error('Submission failed'));
    renderModal();
    const submitButton = screen.getByTestId(BUTTON_PRIMARY_ID);

    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });

    expect(submitButton).not.toBeDisabled();
    expect(submitButton).toHaveTextContent('Update Goal');
  });

  it('trims whitespace from title and description', async () => {
    mockOnSubmit.mockResolvedValue(undefined);
    renderModal();
    fireEvent.change(screen.getByTestId(EDIT_TITLE_ID), { target: { value: '  Trimmed Title  ' } });
    fireEvent.change(screen.getByTestId(EDIT_DESCRIPTION_ID), {
      target: { value: '  Trimmed Description  ' },
    });
    fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        baseGoal.id,
        expect.objectContaining({
          title: 'Trimmed Title',
          description: 'Trimmed Description',
        })
      );
    });
  });

  it('sets description to undefined when empty', async () => {
    mockOnSubmit.mockResolvedValue(undefined);
    renderModal();
    fireEvent.change(screen.getByTestId(EDIT_DESCRIPTION_ID), { target: { value: '' } });
    fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        baseGoal.id,
        expect.objectContaining({
          description: undefined,
        })
      );
    });
  });

  // Field Interaction Tests
  it('updates title field correctly', () => {
    renderModal();
    const titleInput = screen.getByTestId(EDIT_TITLE_ID);
    fireEvent.change(titleInput, { target: { value: 'New Goal Title' } });
    expect(titleInput).toHaveValue('New Goal Title');
  });

  it('updates description field correctly', () => {
    renderModal();
    const descriptionInput = screen.getByTestId(EDIT_DESCRIPTION_ID);
    fireEvent.change(descriptionInput, { target: { value: 'New description' } });
    expect(descriptionInput).toHaveValue('New description');
  });

  it('updates target value correctly', () => {
    renderModal();
    const targetValueInput = screen.getByTestId(EDIT_TARGET_VALUE_ID);
    fireEvent.change(targetValueInput, { target: { value: '75' } });
    expect(targetValueInput).toHaveValue(75);
  });

  it('updates color field correctly', () => {
    renderModal();
    const colorInput = screen.getByTestId(EDIT_COLOR_ID);
    fireEvent.change(colorInput, { target: { value: '#ff0000' } });
    expect(colorInput).toHaveValue('#ff0000');
  });

  it('updates icon field correctly', () => {
    renderModal();
    const iconInput = screen.getByTestId(EDIT_ICON_ID);
    fireEvent.change(iconInput, { target: { value: '🏃' } });
    expect(iconInput).toHaveValue('🏃');
  });

  // Modal Close Behavior Tests
  it('clears errors when modal is closed', () => {
    renderModal();
    fireEvent.change(screen.getByTestId(EDIT_TITLE_ID), { target: { value: '' } });
    fireEvent.click(screen.getByTestId(BUTTON_PRIMARY_ID)); // Try to submit
    fireEvent.click(screen.getByTestId(BUTTON_SECONDARY_ID)); // Close modal
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel button is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByTestId(BUTTON_SECONDARY_ID));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('disables cancel button during submission', async () => {
    let resolveSubmit: () => void;
    const submitPromise = new Promise<void>(resolve => {
      resolveSubmit = resolve;
    });
    mockOnSubmit.mockReturnValue(submitPromise);
    renderModal();

    const submitButton = screen.getByTestId(BUTTON_PRIMARY_ID);
    const cancelButton = screen.getByTestId(BUTTON_SECONDARY_ID);
    fireEvent.click(submitButton);

    expect(submitButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    resolveSubmit!();
    await waitFor(() => {
      expect(cancelButton).not.toBeDisabled();
    });
  });

  // Edge Case Tests
  it('handles goal with very long title', () => {
    const longTitle = 'A'.repeat(200);
    renderModal({ goal: { ...baseGoal, title: longTitle } });
    expect(screen.getByDisplayValue(longTitle)).toBeInTheDocument();
  });

  it('handles goal with very long description', () => {
    const longDescription = 'B'.repeat(500);
    renderModal({ goal: { ...baseGoal, description: longDescription } });
    expect(screen.getByDisplayValue(longDescription)).toBeInTheDocument();
  });

  it('handles goal with decimal target value', () => {
    renderModal({ goal: { ...baseGoal, targetValue: 12.5 } });
    expect(screen.getByDisplayValue(12.5)).toBeInTheDocument();
  });

  it('handles goal with custom color and icon', () => {
    renderModal({
      goal: {
        ...baseGoal,
        color: '#ff5733',
        icon: '🔥',
      },
    });
    expect(screen.getByDisplayValue('#ff5733')).toBeInTheDocument();
    expect(screen.getByDisplayValue('🔥')).toBeInTheDocument();
  });

  it('handles rapid form field changes', () => {
    renderModal();
    const titleInput = screen.getByTestId(EDIT_TITLE_ID);
    fireEvent.change(titleInput, { target: { value: 'First' } });
    fireEvent.change(titleInput, { target: { value: 'Second' } });
    fireEvent.change(titleInput, { target: { value: 'Final' } });
    expect(titleInput).toHaveValue('Final');
  });
});
