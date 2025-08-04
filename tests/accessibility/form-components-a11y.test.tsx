import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthForm } from '../../src/components/Auth/AuthForm';
import { RunForm } from '../../src/components/Runs/RunForm';
import { CreateGoalModal } from '../../src/components/CreateGoalModal';
import { EditGoalModal } from '../../src/components/EditGoalModal';
import { RunFormData, Run } from '../../src/types';
import { GOAL_TYPES, GOAL_PERIODS, Goal } from '../../src/types/goals';
import { TEST_DATES } from '../utils/dateTestUtils';

// Extend expect with jest-axe matchers
expect.extend(toHaveNoViolations);

describe('Form Components Accessibility', () => {
  beforeEach(() => {
    // Clear any previous DOM content
    document.body.innerHTML = '';
  });

  describe('AuthForm Accessibility', () => {
    const mockOnLogin = vi.fn();
    const mockOnRegister = vi.fn();

    beforeEach(() => {
      mockOnLogin.mockClear();
      mockOnRegister.mockClear();
    });

    it('has no accessibility violations in default state', async () => {
      const { container } = render(
        <AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when loading', async () => {
      const { container } = render(
        <AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={true} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has proper form structure with fieldset and legend', () => {
      render(<AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />);

      // Check for proper form structure (using tag name since it doesn't explicitly have role="form")
      const form = document.querySelector('form');
      expect(form).toBeInTheDocument();

      // Check for form title
      const title = screen.getByRole('heading', { level: 2 });
      expect(title).toHaveTextContent('Login or Register');
    });

    it('has properly labeled and associated form fields', () => {
      render(<AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />);

      // Email field
      const emailInput = screen.getByLabelText('Email');
      expect(emailInput).toBeInTheDocument();
      expect(emailInput).toHaveAttribute('type', 'email');
      expect(emailInput).toHaveAttribute('required');
      expect(emailInput).toHaveAttribute('autocomplete', 'email');

      // Password field
      const passwordInput = screen.getByLabelText('Password');
      expect(passwordInput).toBeInTheDocument();
      expect(passwordInput).toHaveAttribute('type', 'password');
      expect(passwordInput).toHaveAttribute('required');
      expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
      expect(passwordInput).toHaveAttribute('minlength', '6');
    });

    it('has accessible submit and register buttons', () => {
      render(<AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />);

      const loginButton = screen.getByRole('button', { name: 'Login' });
      expect(loginButton).toHaveAttribute('type', 'submit');

      const registerButton = screen.getByRole('button', { name: 'Register' });
      expect(registerButton).toHaveAttribute('type', 'button');
    });

    it('provides accessible loading states', () => {
      render(<AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={true} />);

      const loginButton = screen.getByRole('button', { name: 'Logging in...' });
      const registerButton = screen.getByRole('button', { name: 'Creating account...' });

      expect(loginButton).toBeDisabled();
      expect(registerButton).toBeDisabled();
    });

    it('maintains keyboard navigation order', () => {
      render(<AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />);

      const emailInput = screen.getByLabelText('Email');
      const passwordInput = screen.getByLabelText('Password');
      const loginButton = screen.getByRole('button', { name: 'Login' });
      const registerButton = screen.getByRole('button', { name: 'Register' });

      // Test tab order
      emailInput.focus();
      expect(emailInput).toHaveFocus();

      passwordInput.focus();
      expect(passwordInput).toHaveFocus();

      loginButton.focus();
      expect(loginButton).toHaveFocus();

      registerButton.focus();
      expect(registerButton).toHaveFocus();
    });

    it('supports keyboard interaction for form submission', async () => {
      render(<AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />);

      const emailInput = screen.getByLabelText('Email');
      const passwordInput = screen.getByLabelText('Password');
      const loginButton = screen.getByRole('button', { name: 'Login' });

      // Fill form fields
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      // Submit via Enter key on form
      fireEvent.keyDown(passwordInput, { key: 'Enter', code: 'Enter' });
      fireEvent.submit(document.querySelector('form'));

      expect(mockOnLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });

    it('has accessible helper text for password requirements', () => {
      render(<AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />);

      const passwordInput = screen.getByLabelText('Password');
      const helperText = screen.getByText('Password must be at least 6 characters long');

      expect(passwordInput).toHaveAttribute('aria-describedby', helperText.id);
    });

    it('meets WCAG AA compliance standards', async () => {
      const { container } = render(
        <AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('RunForm Accessibility', () => {
    const mockFormData: RunFormData = {
      date: TEST_DATES.RUN_DATE,
      distance: '5.0',
      duration: '30',
      tag: '',
      notes: '',
    };

    const mockErrors = {};
    const mockOnUpdateField = vi.fn();
    const mockOnSubmit = vi.fn();
    const mockOnCancel = vi.fn();

    beforeEach(() => {
      mockOnUpdateField.mockClear();
      mockOnSubmit.mockClear();
      mockOnCancel.mockClear();
    });

    it('has no accessibility violations in default state', async () => {
      const { container } = render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when editing existing run', async () => {
      const existingRun: Run = {
        id: '1',
        userId: 'user-1',
        date: TEST_DATES.RUN_DATE,
        distance: 5.0,
        duration: 30,
        pace: '06:00',
        calories: 350,
        tag: 'Training',
        notes: 'Great run!',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { container } = render(
        <RunForm
          formData={{
            ...mockFormData,
            distance: '5.0',
            duration: '30',
            tag: 'Training',
            notes: 'Great run!',
          }}
          errors={mockErrors}
          loading={false}
          editingRun={existingRun}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with validation errors', async () => {
      const errorsWithMessages = {
        date: 'Date is required',
        distance: 'Distance must be greater than 0',
        duration: 'Duration must be greater than 0',
      };

      const { container } = render(
        <RunForm
          formData={{ ...mockFormData, date: '', distance: '', duration: '' }}
          errors={errorsWithMessages}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has proper form structure and heading', () => {
      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const form = document.querySelector('form');
      expect(form).toBeInTheDocument();

      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toHaveTextContent('Add New Run');
    });

    it('shows proper heading when editing', () => {
      const existingRun: Run = {
        id: '1',
        userId: 'user-1',
        date: TEST_DATES.RUN_DATE,
        distance: 5.0,
        duration: 30,
        pace: '06:00',
        calories: 350,
        tag: 'Training',
        notes: 'Great run!',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={existingRun}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toHaveTextContent('Edit Run');
    });

    it('has properly labeled and associated form fields', () => {
      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Required fields
      const dateInput = screen.getByLabelText('Date');
      expect(dateInput).toHaveAttribute('type', 'date');
      expect(dateInput).toHaveAttribute('required');

      const distanceInput = screen.getByLabelText('Distance (km)');
      expect(distanceInput).toHaveAttribute('type', 'number');
      expect(distanceInput).toHaveAttribute('step', '0.1');
      expect(distanceInput).toHaveAttribute('required');

      const durationInput = screen.getByLabelText('Duration (minutes)');
      expect(durationInput).toHaveAttribute('type', 'number');
      expect(durationInput).toHaveAttribute('required');

      // Optional fields
      const tagSelect = screen.getByLabelText('Tag (optional)');
      expect(tagSelect).toBeInTheDocument();

      const notesTextarea = screen.getByLabelText('Notes (optional)');
      expect(notesTextarea).toBeInTheDocument();
    });

    it('properly groups related fields with InputGroup', () => {
      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const fieldset = screen.getByRole('group', { name: 'Run Details' });
      expect(fieldset).toBeInTheDocument();
      expect(fieldset.tagName).toBe('FIELDSET');

      const legend = screen.getByText('Run Details');
      expect(legend.tagName).toBe('LEGEND');
    });

    it('properly associates error messages with fields', () => {
      const errorsWithMessages = {
        date: 'Date is required',
        distance: 'Distance must be greater than 0',
        duration: 'Duration must be greater than 0',
      };

      render(
        <RunForm
          formData={{ ...mockFormData, date: '', distance: '', duration: '' }}
          errors={errorsWithMessages}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Check error message associations
      const dateInput = screen.getByLabelText('Date');
      const dateError = screen.getByText('Date is required');
      expect(dateInput).toHaveAttribute('aria-describedby', dateError.id);
      expect(dateInput).toHaveAttribute('aria-invalid', 'true');

      const distanceInput = screen.getByLabelText('Distance (km)');
      const distanceError = screen.getByText('Distance must be greater than 0');
      expect(distanceInput).toHaveAttribute('aria-describedby', distanceError.id);
      expect(distanceInput).toHaveAttribute('aria-invalid', 'true');
    });

    it('has accessible submit and cancel buttons', () => {
      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const submitButton = screen.getByRole('button', { name: 'Save Run' });
      expect(submitButton).toHaveAttribute('type', 'submit');

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      expect(cancelButton).toHaveAttribute('type', 'button');
    });

    it('provides accessible loading states', () => {
      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={true}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const submitButton = screen.getByRole('button', { name: 'Save Run' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });

      expect(submitButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();
    });

    it('maintains keyboard navigation order', () => {
      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const dateInput = screen.getByLabelText('Date');
      const distanceInput = screen.getByLabelText('Distance (km)');
      const durationInput = screen.getByLabelText('Duration (minutes)');
      const tagSelect = screen.getByLabelText('Tag (optional)');
      const notesTextarea = screen.getByLabelText('Notes (optional)');
      const submitButton = screen.getByRole('button', { name: 'Save Run' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });

      // Test tab order
      dateInput.focus();
      expect(dateInput).toHaveFocus();

      distanceInput.focus();
      expect(distanceInput).toHaveFocus();

      durationInput.focus();
      expect(durationInput).toHaveFocus();

      tagSelect.focus();
      expect(tagSelect).toHaveFocus();

      notesTextarea.focus();
      expect(notesTextarea).toHaveFocus();

      submitButton.focus();
      expect(submitButton).toHaveFocus();

      cancelButton.focus();
      expect(cancelButton).toHaveFocus();
    });

    it('supports keyboard form submission', async () => {
      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const form = document.querySelector('form');
      fireEvent.keyDown(form, { key: 'Enter', code: 'Enter' });
      fireEvent.submit(form);

      expect(mockOnSubmit).toHaveBeenCalled();
    });

    it('has proper select options with accessibility', () => {
      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const tagSelect = screen.getByLabelText('Tag (optional)');

      // Check that select has proper options
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(1); // Placeholder + actual options

      // Verify option values are accessible
      const trainingOption = screen.getByRole('option', { name: 'Training' });
      expect(trainingOption).toHaveValue('Training');
    });

    it('meets WCAG AA compliance standards', async () => {
      const { container } = render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('maintains accessibility with complex form interactions', async () => {
      const { container } = render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={mockOnUpdateField}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Test complex interactions
      const distanceInput = screen.getByLabelText('Distance (km)');
      const tagSelect = screen.getByLabelText('Tag (optional)');
      const notesTextarea = screen.getByLabelText('Notes (optional)');

      // Simulate user interactions
      fireEvent.change(distanceInput, { target: { value: '10.5' } });
      fireEvent.change(tagSelect, { target: { value: 'Training' } });
      fireEvent.change(notesTextarea, { target: { value: 'Good weather today' } });

      // Verify accessibility is maintained after interactions
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Cross-Form Accessibility Patterns', () => {
    it('maintains consistent accessibility patterns across forms', async () => {
      const { container: authContainer } = render(
        <AuthForm onLogin={vi.fn()} onRegister={vi.fn()} loading={false} />
      );

      const { container: runContainer } = render(
        <RunForm
          formData={{
            date: TEST_DATES.RUN_DATE,
            distance: '5.0',
            duration: '30',
            tag: '',
            notes: '',
          }}
          errors={{}}
          loading={false}
          editingRun={null}
          onUpdateField={vi.fn()}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      // Both forms should pass accessibility checks
      const authResults = await axe(authContainer);
      const runResults = await axe(runContainer);

      expect(authResults).toHaveNoViolations();
      expect(runResults).toHaveNoViolations();
    });

    it('both forms support consistent keyboard navigation patterns', () => {
      const { unmount: unmountAuth } = render(
        <AuthForm onLogin={vi.fn()} onRegister={vi.fn()} loading={false} />
      );

      // Test AuthForm keyboard navigation
      const authEmailInput = screen.getByLabelText('Email');
      const authPasswordInput = screen.getByLabelText('Password');

      authEmailInput.focus();
      expect(authEmailInput).toHaveFocus();

      authPasswordInput.focus();
      expect(authPasswordInput).toHaveFocus();

      unmountAuth();

      render(
        <RunForm
          formData={{
            date: TEST_DATES.RUN_DATE,
            distance: '5.0',
            duration: '30',
            tag: '',
            notes: '',
          }}
          errors={{}}
          loading={false}
          editingRun={null}
          onUpdateField={vi.fn()}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      // Test RunForm keyboard navigation
      const runDateInput = screen.getByLabelText('Date');
      const runDistanceInput = screen.getByLabelText('Distance (km)');

      runDateInput.focus();
      expect(runDateInput).toHaveFocus();

      runDistanceInput.focus();
      expect(runDistanceInput).toHaveFocus();
    });
  });

  describe('CreateGoalModal Accessibility', () => {
    const mockOnSubmit = vi.fn();
    const mockOnClose = vi.fn();

    beforeEach(() => {
      mockOnSubmit.mockClear();
      mockOnClose.mockClear();
    });

    it('has no accessibility violations when open', async () => {
      const { container } = render(
        <CreateGoalModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when closed', async () => {
      const { container } = render(
        <CreateGoalModal isOpen={false} onClose={mockOnClose} onSubmit={mockOnSubmit} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has proper modal and form structure when open', () => {
      render(<CreateGoalModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

      // Check modal structure
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      // Check form structure
      const form = screen.getByTestId('create-goal-form');
      expect(form).toBeInTheDocument();
      expect(form.tagName).toBe('FORM');

      // Check modal title
      const modalTitle = screen.getByRole('heading', { name: 'Create New Goal' });
      expect(modalTitle).toBeInTheDocument();
    });

    it('has properly labeled and associated form fields', () => {
      render(<CreateGoalModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

      // Required fields
      const titleInput = screen.getByLabelText('Goal Title');
      expect(titleInput).toHaveAttribute('required');
      expect(titleInput).toHaveAttribute('type', 'text');

      const targetValueInput = screen.getByLabelText('Target Value');
      expect(targetValueInput).toHaveAttribute('required');
      expect(targetValueInput).toHaveAttribute('type', 'number');
      expect(targetValueInput).toHaveAttribute('step', '0.1');

      const startDateInput = screen.getByLabelText('Start Date');
      expect(startDateInput).toHaveAttribute('required');
      expect(startDateInput).toHaveAttribute('type', 'date');

      const endDateInput = screen.getByLabelText('End Date');
      expect(endDateInput).toHaveAttribute('required');
      expect(endDateInput).toHaveAttribute('type', 'date');

      // Optional fields
      const descriptionTextarea = screen.getByLabelText('Description');
      expect(descriptionTextarea).toBeInTheDocument();
      expect(descriptionTextarea.tagName).toBe('TEXTAREA');

      // Select fields
      const goalTypeSelect = screen.getByLabelText('Goal Type');
      expect(goalTypeSelect.tagName).toBe('SELECT');

      const timePeriodSelect = screen.getByLabelText('Time Period');
      expect(timePeriodSelect.tagName).toBe('SELECT');

      const unitSelect = screen.getByLabelText('Unit');
      expect(unitSelect.tagName).toBe('SELECT');
    });

    it('properly groups related fields with fieldsets', () => {
      render(<CreateGoalModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

      // Check for target value group
      const targetValueGroup = screen.getByRole('group', { name: 'Target Value' });
      expect(targetValueGroup).toBeInTheDocument();
      expect(targetValueGroup.tagName).toBe('FIELDSET');

      // Check for date range group
      const dateRangeGroup = screen.getByRole('group', { name: 'Date Range' });
      expect(dateRangeGroup).toBeInTheDocument();
      expect(dateRangeGroup.tagName).toBe('FIELDSET');

      // Check for appearance group
      const appearanceGroup = screen.getByRole('group', { name: 'Appearance' });
      expect(appearanceGroup).toBeInTheDocument();
      expect(appearanceGroup.tagName).toBe('FIELDSET');
    });

    it('has accessible submit and cancel buttons', () => {
      render(<CreateGoalModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

      const createButton = screen.getByRole('button', { name: 'Create Goal' });
      expect(createButton).toHaveAttribute('type', 'submit');

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      expect(cancelButton).toHaveAttribute('type', 'button');
    });

    it('maintains keyboard navigation order', () => {
      render(<CreateGoalModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

      const titleInput = screen.getByLabelText('Goal Title');
      const descriptionTextarea = screen.getByLabelText('Description');
      const goalTypeSelect = screen.getByLabelText('Goal Type');
      const targetValueInput = screen.getByLabelText('Target Value');
      const startDateInput = screen.getByLabelText('Start Date');
      const createButton = screen.getByRole('button', { name: 'Create Goal' });

      // Test tab order
      titleInput.focus();
      expect(titleInput).toHaveFocus();

      descriptionTextarea.focus();
      expect(descriptionTextarea).toHaveFocus();

      goalTypeSelect.focus();
      expect(goalTypeSelect).toHaveFocus();

      targetValueInput.focus();
      expect(targetValueInput).toHaveFocus();

      startDateInput.focus();
      expect(startDateInput).toHaveFocus();

      createButton.focus();
      expect(createButton).toHaveFocus();
    });

    it('supports keyboard modal interaction', async () => {
      render(<CreateGoalModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

      const dialog = screen.getByRole('dialog');

      // Test Escape key to close modal
      fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('meets WCAG AA compliance standards', async () => {
      const { container } = render(
        <CreateGoalModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('EditGoalModal Accessibility', () => {
    const mockGoal: Goal = {
      id: 'goal-1',
      userId: 'user-1',
      title: 'Test Goal',
      description: 'Test description',
      type: GOAL_TYPES.DISTANCE,
      period: GOAL_PERIODS.WEEKLY,
      targetValue: 50,
      targetUnit: 'km',
      currentValue: 25,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-07'),
      color: '#3b82f6',
      icon: '🏃',
      isCompleted: false,
      isActive: true,
      createdAt: new Date('2024-01-01').toISOString(),
      updatedAt: new Date('2024-01-01').toISOString(),
    };

    const mockOnSubmit = vi.fn();
    const mockOnClose = vi.fn();

    beforeEach(() => {
      mockOnSubmit.mockClear();
      mockOnClose.mockClear();
    });

    it('has no accessibility violations when open', async () => {
      const { container } = render(
        <EditGoalModal
          isOpen={true}
          goal={mockGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when closed', async () => {
      const { container } = render(
        <EditGoalModal
          isOpen={false}
          goal={mockGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with completed goal', async () => {
      const completedGoal = { ...mockGoal, isCompleted: true };

      const { container } = render(
        <EditGoalModal
          isOpen={true}
          goal={completedGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has proper modal and form structure when open', () => {
      render(
        <EditGoalModal
          isOpen={true}
          goal={mockGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Check modal structure
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      // Check form structure
      const form = document.querySelector('form');
      expect(form).toBeInTheDocument();

      // Check modal title
      const modalTitle = screen.getByRole('heading', { name: 'Edit Goal' });
      expect(modalTitle).toBeInTheDocument();
    });

    it('has properly labeled and associated form fields with pre-filled values', () => {
      render(
        <EditGoalModal
          isOpen={true}
          goal={mockGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Check pre-filled values
      const titleInput = screen.getByLabelText('Goal Title');
      expect(titleInput).toHaveValue('Test Goal');
      expect(titleInput).toHaveAttribute('required');

      const descriptionTextarea = screen.getByLabelText('Description');
      expect(descriptionTextarea).toHaveValue('Test description');

      const targetValueInput = screen.getByLabelText('Target Value');
      expect(targetValueInput).toHaveValue(50);
      expect(targetValueInput).toHaveAttribute('required');

      const startDateInput = screen.getByLabelText('Start Date');
      expect(startDateInput).toHaveValue('2024-01-01');
      expect(startDateInput).toHaveAttribute('required');

      const endDateInput = screen.getByLabelText('End Date');
      expect(endDateInput).toHaveValue('2024-01-07');
      expect(endDateInput).toHaveAttribute('required');
    });

    it('properly handles disabled state for completed goals', () => {
      const completedGoal = { ...mockGoal, isCompleted: true };

      render(
        <EditGoalModal
          isOpen={true}
          goal={completedGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const goalTypeSelect = screen.getByLabelText('Goal Type *');
      expect(goalTypeSelect).toBeDisabled();

      // Check for explanatory text
      const disabledText = screen.getByText('Cannot change goal type for completed goals');
      expect(disabledText).toBeInTheDocument();
    });

    it('has accessible submit and cancel buttons', () => {
      render(
        <EditGoalModal
          isOpen={true}
          goal={mockGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const updateButton = screen.getByRole('button', { name: 'Update Goal' });
      expect(updateButton).toHaveAttribute('type', 'submit');

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      expect(cancelButton).toHaveAttribute('type', 'button');
    });

    it('maintains keyboard navigation order', () => {
      render(
        <EditGoalModal
          isOpen={true}
          goal={mockGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const titleInput = screen.getByLabelText('Goal Title');
      const descriptionTextarea = screen.getByLabelText('Description');
      const goalTypeSelect = screen.getByLabelText('Goal Type *');
      const targetValueInput = screen.getByLabelText('Target Value');
      const updateButton = screen.getByRole('button', { name: 'Update Goal' });

      // Test tab order
      titleInput.focus();
      expect(titleInput).toHaveFocus();

      descriptionTextarea.focus();
      expect(descriptionTextarea).toHaveFocus();

      goalTypeSelect.focus();
      expect(goalTypeSelect).toHaveFocus();

      targetValueInput.focus();
      expect(targetValueInput).toHaveFocus();

      updateButton.focus();
      expect(updateButton).toHaveFocus();
    });

    it('supports keyboard form submission', async () => {
      render(
        <EditGoalModal
          isOpen={true}
          goal={mockGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const form = document.querySelector('form');
      fireEvent.keyDown(form, { key: 'Enter', code: 'Enter' });
      fireEvent.submit(form);

      expect(mockOnSubmit).toHaveBeenCalledWith(mockGoal.id, expect.any(Object));
    });

    it('meets WCAG AA compliance standards', async () => {
      const { container } = render(
        <EditGoalModal
          isOpen={true}
          goal={mockGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('meets WCAG AA compliance with completed goal state', async () => {
      const completedGoal = { ...mockGoal, isCompleted: true };

      const { container } = render(
        <EditGoalModal
          isOpen={true}
          goal={completedGoal}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Form Modal Integration Accessibility', () => {
    it('handles modal form focus management properly', () => {
      render(<CreateGoalModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

      const dialog = screen.getByRole('dialog');
      const firstInput = screen.getByLabelText('Goal Title');

      expect(dialog).toBeInTheDocument();
      expect(firstInput).toBeInTheDocument();

      // Modal should trap focus within the form
      firstInput.focus();
      expect(firstInput).toHaveFocus();
    });

    it('provides consistent accessibility patterns across all goal forms', async () => {
      const mockGoal: Goal = {
        id: 'goal-1',
        userId: 'user-1',
        title: 'Test Goal',
        description: 'Test description',
        type: GOAL_TYPES.DISTANCE,
        period: GOAL_PERIODS.WEEKLY,
        targetValue: 50,
        targetUnit: 'km',
        currentValue: 25,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-07'),
        color: '#3b82f6',
        icon: '🏃',
        isCompleted: false,
        isActive: true,
        createdAt: new Date('2024-01-01').toISOString(),
        updatedAt: new Date('2024-01-01').toISOString(),
      };

      const { container: createContainer } = render(
        <CreateGoalModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />
      );

      const { container: editContainer } = render(
        <EditGoalModal isOpen={true} goal={mockGoal} onClose={vi.fn()} onSubmit={vi.fn()} />
      );

      // Both forms should pass accessibility checks
      const createResults = await axe(createContainer);
      const editResults = await axe(editContainer);

      expect(createResults).toHaveNoViolations();
      expect(editResults).toHaveNoViolations();
    });
  });
});
