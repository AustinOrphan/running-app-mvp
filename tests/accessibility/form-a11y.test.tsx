import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthForm } from '../../src/components/Auth/AuthForm';
import { RunForm } from '../../src/components/Runs/RunForm';
import { RunFormData, Run } from '../../src/types';
import { TEST_DATES } from '../utils/dateTestUtils';
import {
  expectAccessible,
  testAccessibilityCompliance,
  accessibilityScenarios,
} from '../utils/accessibilityTestUtils';

// Extend expect with jest-axe matchers
expect.extend(toHaveNoViolations);

describe('Form Components Accessibility', () => {
  beforeEach(() => {
    // Clear any previous DOM content
    document.body.innerHTML = '';
  });

  describe('AuthForm Accessibility', () => {
    const mockProps = {
      onLogin: vi.fn(),
      onRegister: vi.fn(),
      loading: false,
    };

    it('has no accessibility violations in default state', async () => {
      const { container } = render(<AuthForm {...mockProps} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when loading', async () => {
      const { container } = render(<AuthForm {...mockProps} loading={true} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('provides proper form structure with fieldset and legend', () => {
      render(<AuthForm {...mockProps} />);

      // Check for proper form structure
      const form = screen.getByRole('form');
      expect(form).toBeInTheDocument();

      // Check that form has proper heading structure
      const title = screen.getByRole('heading', { name: /login or register/i });
      expect(title).toBeInTheDocument();
    });

    it('properly associates labels with form controls', () => {
      render(<AuthForm {...mockProps} />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);

      expect(emailInput).toBeInTheDocument();
      expect(passwordInput).toBeInTheDocument();
      expect(emailInput).toHaveAttribute('type', 'email');
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('has proper ARIA attributes for required fields', () => {
      render(<AuthForm {...mockProps} />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);

      expect(emailInput).toHaveAttribute('aria-required', 'true');
      expect(passwordInput).toHaveAttribute('aria-required', 'true');
      expect(emailInput).toBeRequired();
      expect(passwordInput).toBeRequired();
    });

    it('properly associates helper text with password field', () => {
      render(<AuthForm {...mockProps} />);

      const passwordInput = screen.getByLabelText(/password/i);
      const helperText = screen.getByText(/password must be at least 6 characters long/i);

      expect(passwordInput).toHaveAttribute('aria-describedby', helperText.id);
    });

    it('has accessible button group with proper roles', () => {
      render(<AuthForm {...mockProps} />);

      const loginButton = screen.getByRole('button', { name: /login/i });
      const registerButton = screen.getByRole('button', { name: /register/i });

      expect(loginButton).toBeInTheDocument();
      expect(registerButton).toBeInTheDocument();
      expect(loginButton).toHaveAttribute('type', 'submit');
      expect(registerButton).toHaveAttribute('type', 'button');
    });

    it('provides proper loading state announcements', () => {
      render(<AuthForm {...mockProps} loading={true} />);

      const loginButton = screen.getByRole('button', { name: /logging in/i });
      const registerButton = screen.getByRole('button', { name: /creating account/i });

      expect(loginButton).toBeDisabled();
      expect(registerButton).toBeDisabled();
      expect(loginButton).toHaveAttribute('aria-disabled', 'true');
      expect(registerButton).toHaveAttribute('aria-disabled', 'true');
    });

    it('maintains proper tab order', () => {
      render(<AuthForm {...mockProps} />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const loginButton = screen.getByRole('button', { name: /login/i });
      const registerButton = screen.getByRole('button', { name: /register/i });

      // Test tab navigation
      emailInput.focus();
      expect(emailInput).toHaveFocus();

      passwordInput.focus();
      expect(passwordInput).toHaveFocus();

      loginButton.focus();
      expect(loginButton).toHaveFocus();

      registerButton.focus();
      expect(registerButton).toHaveFocus();
    });

    it('supports keyboard form submission', async () => {
      const onLogin = vi.fn();
      render(<AuthForm {...mockProps} onLogin={onLogin} />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const form = screen.getByRole('form');

      // Fill out form
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      // Submit with Enter key
      fireEvent.keyDown(form, { key: 'Enter', code: 'Enter' });
      fireEvent.submit(form);

      expect(onLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });

    it('meets WCAG AA compliance standards', async () => {
      const { container } = render(<AuthForm {...mockProps} />);

      await testAccessibilityCompliance(container, 'AA');
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader', 'color-contrast'],
      });
    });
  });

  describe('RunForm Accessibility', () => {
    const mockFormData: RunFormData = {
      date: TEST_DATES.RECENT_RUN,
      distance: '5.0',
      duration: '30',
      tag: '',
      notes: '',
    };

    const mockProps = {
      formData: mockFormData,
      errors: {},
      loading: false,
      editingRun: null,
      onUpdateField: vi.fn(),
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };

    it('has no accessibility violations in default state', async () => {
      const { container } = render(<RunForm {...mockProps} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with errors', async () => {
      const propsWithErrors = {
        ...mockProps,
        errors: {
          date: 'Date is required',
          distance: 'Distance must be positive',
          duration: 'Duration must be positive',
        },
      };

      const { container } = render(<RunForm {...propsWithErrors} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when editing', async () => {
      const editingRun: Run = {
        id: '1',
        userId: 'user1',
        date: TEST_DATES.RECENT_RUN,
        distance: 5.0,
        duration: 30,
        tag: 'Training',
        notes: 'Good run',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { container } = render(<RunForm {...mockProps} editingRun={editingRun} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when loading', async () => {
      const { container } = render(<RunForm {...mockProps} loading={true} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('provides proper form structure with fieldset groups', () => {
      render(<RunForm {...mockProps} />);

      const form = screen.getByRole('form');
      expect(form).toBeInTheDocument();

      // Check for proper heading
      const heading = screen.getByRole('heading', { name: /add new run/i });
      expect(heading).toBeInTheDocument();

      // Check for fieldset group
      const runDetailsGroup = screen.getByRole('group', { name: /run details/i });
      expect(runDetailsGroup).toBeInTheDocument();
      expect(runDetailsGroup.tagName).toBe('FIELDSET');
    });

    it('properly associates labels with all form controls', () => {
      render(<RunForm {...mockProps} />);

      const dateInput = screen.getByLabelText(/date/i);
      const distanceInput = screen.getByLabelText(/distance/i);
      const durationInput = screen.getByLabelText(/duration/i);
      const tagSelect = screen.getByLabelText(/tag/i);
      const notesTextArea = screen.getByLabelText(/notes/i);

      expect(dateInput).toBeInTheDocument();
      expect(distanceInput).toBeInTheDocument();
      expect(durationInput).toBeInTheDocument();
      expect(tagSelect).toBeInTheDocument();
      expect(notesTextArea).toBeInTheDocument();

      expect(dateInput).toHaveAttribute('type', 'date');
      expect(distanceInput).toHaveAttribute('type', 'number');
      expect(durationInput).toHaveAttribute('type', 'number');
      expect(tagSelect.tagName).toBe('SELECT');
      expect(notesTextArea.tagName).toBe('TEXTAREA');
    });

    it('has proper ARIA attributes for required fields', () => {
      render(<RunForm {...mockProps} />);

      const dateInput = screen.getByLabelText(/date/i);
      const distanceInput = screen.getByLabelText(/distance/i);
      const durationInput = screen.getByLabelText(/duration/i);

      expect(dateInput).toHaveAttribute('aria-required', 'true');
      expect(distanceInput).toHaveAttribute('aria-required', 'true');
      expect(durationInput).toHaveAttribute('aria-required', 'true');
      expect(dateInput).toBeRequired();
      expect(distanceInput).toBeRequired();
      expect(durationInput).toBeRequired();
    });

    it('properly associates error messages with form controls', () => {
      const propsWithErrors = {
        ...mockProps,
        errors: {
          date: 'Date is required',
          distance: 'Distance must be positive',
          duration: 'Duration must be positive',
        },
      };

      render(<RunForm {...propsWithErrors} />);

      const dateInput = screen.getByLabelText(/date/i);
      const distanceInput = screen.getByLabelText(/distance/i);
      const durationInput = screen.getByLabelText(/duration/i);

      const dateError = screen.getByText('Date is required');
      const distanceError = screen.getByText('Distance must be positive');
      const durationError = screen.getByText('Duration must be positive');

      expect(dateInput).toHaveAttribute('aria-describedby', dateError.id);
      expect(distanceInput).toHaveAttribute('aria-describedby', distanceError.id);
      expect(durationInput).toHaveAttribute('aria-describedby', durationError.id);

      expect(dateInput).toHaveAttribute('aria-invalid', 'true');
      expect(distanceInput).toHaveAttribute('aria-invalid', 'true');
      expect(durationInput).toHaveAttribute('aria-invalid', 'true');
    });

    it('provides appropriate placeholders and helper text', () => {
      render(<RunForm {...mockProps} />);

      const distanceInput = screen.getByLabelText(/distance/i);
      const durationInput = screen.getByLabelText(/duration/i);
      const notesTextArea = screen.getByLabelText(/notes/i);

      expect(distanceInput).toHaveAttribute('placeholder', '5.0');
      expect(durationInput).toHaveAttribute('placeholder', '30');
      expect(notesTextArea).toHaveAttribute(
        'placeholder',
        'How did it feel? Route details, weather, etc.'
      );
    });

    it('has accessible select options with proper structure', () => {
      render(<RunForm {...mockProps} />);

      const tagSelect = screen.getByLabelText(/tag/i);
      const options = screen.getAllByRole('option');

      expect(options).toHaveLength(6); // 5 tag options + placeholder
      expect(options[0]).toHaveTextContent('Select a tag');
      expect(options[1]).toHaveTextContent('Training');
      expect(options[2]).toHaveTextContent('Race');
      expect(options[3]).toHaveTextContent('Easy');
      expect(options[4]).toHaveTextContent('Long Run');
      expect(options[5]).toHaveTextContent('Speed Work');
    });

    it('has accessible button group with proper roles', () => {
      render(<RunForm {...mockProps} />);

      const saveButton = screen.getByRole('button', { name: /save run/i });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      expect(saveButton).toBeInTheDocument();
      expect(cancelButton).toBeInTheDocument();
      expect(saveButton).toHaveAttribute('type', 'submit');
      expect(cancelButton).toHaveAttribute('type', 'button');
    });

    it('provides proper loading state announcements', () => {
      render(<RunForm {...mockProps} loading={true} />);

      const saveButton = screen.getByRole('button', { name: /save run/i });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      expect(saveButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();
      expect(saveButton).toHaveAttribute('aria-disabled', 'true');
      expect(cancelButton).toHaveAttribute('aria-disabled', 'true');
    });

    it('maintains proper tab order for all form elements', () => {
      render(<RunForm {...mockProps} />);

      const dateInput = screen.getByLabelText(/date/i);
      const distanceInput = screen.getByLabelText(/distance/i);
      const durationInput = screen.getByLabelText(/duration/i);
      const tagSelect = screen.getByLabelText(/tag/i);
      const notesTextArea = screen.getByLabelText(/notes/i);
      const saveButton = screen.getByRole('button', { name: /save run/i });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Test tab navigation
      dateInput.focus();
      expect(dateInput).toHaveFocus();

      distanceInput.focus();
      expect(distanceInput).toHaveFocus();

      durationInput.focus();
      expect(durationInput).toHaveFocus();

      tagSelect.focus();
      expect(tagSelect).toHaveFocus();

      notesTextArea.focus();
      expect(notesTextArea).toHaveFocus();

      saveButton.focus();
      expect(saveButton).toHaveFocus();

      cancelButton.focus();
      expect(cancelButton).toHaveFocus();
    });

    it('supports keyboard form submission and cancellation', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(<RunForm {...mockProps} onSubmit={onSubmit} onCancel={onCancel} />);

      const form = screen.getByRole('form');
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Test form submission with Enter
      fireEvent.keyDown(form, { key: 'Enter', code: 'Enter' });
      fireEvent.submit(form);
      expect(onSubmit).toHaveBeenCalled();

      // Test cancel with keyboard
      cancelButton.focus();
      fireEvent.keyDown(cancelButton, { key: 'Enter', code: 'Enter' });
      fireEvent.click(cancelButton);
      expect(onCancel).toHaveBeenCalled();
    });

    it('updates form title appropriately when editing', () => {
      const editingRun: Run = {
        id: '1',
        userId: 'user1',
        date: TEST_DATES.RECENT_RUN,
        distance: 5.0,
        duration: 30,
        tag: 'Training',
        notes: 'Good run',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      render(<RunForm {...mockProps} editingRun={editingRun} />);

      const heading = screen.getByRole('heading', { name: /edit run/i });
      const updateButton = screen.getByRole('button', { name: /update run/i });

      expect(heading).toBeInTheDocument();
      expect(updateButton).toBeInTheDocument();
    });

    it('meets WCAG AA compliance standards', async () => {
      const { container } = render(<RunForm {...mockProps} />);

      await testAccessibilityCompliance(container, 'AA');
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader', 'color-contrast'],
      });
    });

    it('meets WCAG AA compliance with error states', async () => {
      const propsWithErrors = {
        ...mockProps,
        errors: {
          date: 'Date is required',
          distance: 'Distance must be positive',
          duration: 'Duration must be positive',
        },
      };

      const { container } = render(<RunForm {...propsWithErrors} />);

      await testAccessibilityCompliance(container, 'AA');
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader', 'color-contrast'],
      });
    });
  });

  describe('Form Integration Accessibility', () => {
    it('handles complex form interactions accessibly', async () => {
      const onUpdateField = vi.fn();

      const { container } = render(
        <RunForm
          {...{
            formData: mockFormData,
            errors: {},
            loading: false,
            editingRun: null,
            onUpdateField,
            onSubmit: vi.fn(),
            onCancel: vi.fn(),
          }}
        />
      );

      // Test form field interactions
      const distanceInput = screen.getByLabelText(/distance/i);
      const tagSelect = screen.getByLabelText(/tag/i);

      // Test input changes
      fireEvent.change(distanceInput, { target: { value: '10.5' } });
      expect(onUpdateField).toHaveBeenCalledWith('distance', '10.5');

      fireEvent.change(tagSelect, { target: { value: 'Training' } });
      expect(onUpdateField).toHaveBeenCalledWith('tag', 'Training');

      // Test accessibility compliance during interactions
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader'],
      });
    });

    it('provides accessible feedback for form validation', async () => {
      const { container, rerender } = render(
        <RunForm
          {...{
            formData: { ...mockFormData, distance: '', duration: '' },
            errors: {},
            loading: false,
            editingRun: null,
            onUpdateField: vi.fn(),
            onSubmit: vi.fn(),
            onCancel: vi.fn(),
          }}
        />
      );

      // Initially no errors
      let results = await axe(container);
      expect(results).toHaveNoViolations();

      // Add validation errors
      rerender(
        <RunForm
          {...{
            formData: { ...mockFormData, distance: '', duration: '' },
            errors: {
              distance: 'Distance is required',
              duration: 'Duration is required',
            },
            loading: false,
            editingRun: null,
            onUpdateField: vi.fn(),
            onSubmit: vi.fn(),
            onCancel: vi.fn(),
          }}
        />
      );

      // Still accessible with errors
      results = await axe(container);
      expect(results).toHaveNoViolations();

      // Verify error association
      const distanceInput = screen.getByLabelText(/distance/i);
      const durationInput = screen.getByLabelText(/duration/i);

      expect(distanceInput).toHaveAttribute('aria-invalid', 'true');
      expect(durationInput).toHaveAttribute('aria-invalid', 'true');
    });

    it('maintains accessibility across form state changes', async () => {
      const { container, rerender } = render(
        <AuthForm onLogin={vi.fn()} onRegister={vi.fn()} loading={false} />
      );

      // Test initial state
      let results = await axe(container);
      expect(results).toHaveNoViolations();

      // Test loading state
      rerender(<AuthForm onLogin={vi.fn()} onRegister={vi.fn()} loading={true} />);

      results = await axe(container);
      expect(results).toHaveNoViolations();

      // Verify loading state accessibility
      const loginButton = screen.getByRole('button', { name: /logging in/i });
      expect(loginButton).toHaveAttribute('aria-disabled', 'true');
      expect(loginButton).toBeDisabled();
    });
  });

  describe('Advanced Form Accessibility Scenarios', () => {
    it('supports screen reader navigation patterns', async () => {
      const { container } = render(
        <div>
          <AuthForm onLogin={vi.fn()} onRegister={vi.fn()} loading={false} />
          <RunForm
            {...{
              formData: mockFormData,
              errors: {},
              loading: false,
              editingRun: null,
              onUpdateField: vi.fn(),
              onSubmit: vi.fn(),
              onCancel: vi.fn(),
            }}
          />
        </div>
      );

      // Test comprehensive form accessibility
      await accessibilityScenarios.testForm(container);

      // Verify forms can be distinguished
      const forms = screen.getAllByRole('form');
      expect(forms).toHaveLength(2);

      // Each form should have distinct accessible names
      const authHeading = screen.getByRole('heading', { name: /login or register/i });
      const runHeading = screen.getByRole('heading', { name: /add new run/i });

      expect(authHeading).toBeInTheDocument();
      expect(runHeading).toBeInTheDocument();
    });

    it('provides appropriate landmark structure', () => {
      const { container } = render(
        <main>
          <AuthForm onLogin={vi.fn()} onRegister={vi.fn()} loading={false} />
        </main>
      );

      const main = screen.getByRole('main');
      const form = screen.getByRole('form');

      expect(main).toBeInTheDocument();
      expect(form).toBeInTheDocument();
      expect(main).toContainElement(form);
    });

    it('handles complex keyboard navigation scenarios', async () => {
      render(
        <div>
          <AuthForm onLogin={vi.fn()} onRegister={vi.fn()} loading={false} />
          <RunForm
            {...{
              formData: mockFormData,
              errors: {},
              loading: false,
              editingRun: null,
              onUpdateField: vi.fn(),
              onSubmit: vi.fn(),
              onCancel: vi.fn(),
            }}
          />
        </div>
      );

      // Get all focusable elements
      const allButtons = screen.getAllByRole('button');
      const allInputs = screen.getAllByRole('textbox');
      const allSelects = screen.getAllByRole('combobox');

      // Verify all interactive elements are keyboard accessible
      [...allButtons, ...allInputs, ...allSelects].forEach(element => {
        element.focus();
        expect(element).toHaveFocus();
      });
    });
  });
});
