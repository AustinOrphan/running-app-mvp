import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Button } from '../../../src/components/UI/Button';
import { Input } from '../../../src/components/UI/Input';
import { axe, expectNoAccessibilityViolations } from '../../setup/axeSetup.js';

describe('Accessibility Tests - Basic UI Components', () => {
  describe('Button Component Accessibility', () => {
    it('should have no accessibility violations with text content', async () => {
      const { container } = render(<Button>Click me</Button>);

      const results = await axe(container);
      expectNoAccessibilityViolations(results.violations);
    });

    it('should have proper accessible name', () => {
      render(<Button>Save Changes</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveAccessibleName('Save Changes');
    });

    it('should have proper accessible name with aria-label', async () => {
      const { container } = render(<Button aria-label='Close dialog'>×</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveAccessibleName('Close dialog');

      const results = await axe(container);
      expectNoAccessibilityViolations(results.violations);
    });

    it('should handle disabled state accessibly', async () => {
      const { container } = render(<Button disabled>Disabled Button</Button>);

      const button = screen.getByRole('button');
      expect(button).toBeDisabled();

      const results = await axe(container);
      expectNoAccessibilityViolations(results.violations);
    });

    it('should handle different variants accessibly', async () => {
      const variants: Array<'primary' | 'secondary' | 'danger'> = [
        'primary',
        'secondary',
        'danger',
      ];

      for (const variant of variants) {
        const { container } = render(<Button variant={variant}>Test {variant}</Button>);

        const results = await axe(container);
        expectNoAccessibilityViolations(results.violations);
      }
    });
  });

  describe('Input Component Accessibility', () => {
    it('should have no accessibility violations with label', async () => {
      const { container } = render(<Input label='Email Address' type='email' />);

      const results = await axe(container);
      expectNoAccessibilityViolations(results.violations);
    });

    it('should properly associate label with input', () => {
      render(<Input label='Full Name' type='text' />);

      const input = screen.getByRole('textbox');
      expect(input).toHaveAccessibleName('Full Name');
    });

    it('should handle required fields accessibly', async () => {
      const { container } = render(<Input label='Required Field' required />);

      const input = screen.getByRole('textbox');
      expect(input).toBeRequired();

      const results = await axe(container);
      expectNoAccessibilityViolations(results.violations);
    });

    it('should handle error state accessibly', async () => {
      const { container } = render(
        <Input label='Password' type='password' error errorMessage='Password is required' />
      );

      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-invalid', 'true');

      // Check that error message exists
      const errorMessage = screen.getByText('Password is required');
      expect(errorMessage).toBeInTheDocument();

      const results = await axe(container);
      expectNoAccessibilityViolations(results.violations);
    });

    it('should handle different input types accessibly', async () => {
      const inputTypes: Array<'email' | 'password' | 'text' | 'tel'> = [
        'email',
        'password',
        'text',
        'tel',
      ];

      for (const type of inputTypes) {
        const { container } = render(<Input label={`Test ${type}`} type={type} />);

        const results = await axe(container);
        expectNoAccessibilityViolations(results.violations);
      }
    });

    it('should be keyboard accessible', () => {
      render(<Input label='Keyboard Test' />);

      const input = screen.getByRole('textbox');
      input.focus();
      expect(input).toHaveFocus();
    });
  });

  describe('Form Integration Accessibility', () => {
    it('should handle basic form with multiple inputs accessibly', async () => {
      const { container } = render(
        <form>
          <Input label='First Name' type='text' required />
          <Input label='Email' type='email' required />
          <Button type='submit'>Submit Form</Button>
        </form>
      );

      // Check that form elements are properly accessible
      const firstNameInput = screen.getByRole('textbox', { name: /first name/i });
      const emailInput = screen.getByRole('textbox', { name: /email/i });
      const submitButton = screen.getByRole('button', { name: /submit form/i });

      expect(firstNameInput).toBeRequired();
      expect(emailInput).toBeRequired();
      expect(submitButton).toHaveAttribute('type', 'submit');

      const results = await axe(container);
      expectNoAccessibilityViolations(results.violations);
    });

    it('should handle form with validation errors accessibly', async () => {
      const { container } = render(
        <form>
          <Input
            label='Email'
            type='email'
            required
            error
            errorMessage='Please enter a valid email address'
          />
          <Input
            label='Password'
            type='password'
            required
            error
            errorMessage='Password must be at least 8 characters'
          />
          <Button type='submit' disabled>
            Submit
          </Button>
        </form>
      );

      const emailInput = screen.getByRole('textbox', { name: /email/i });
      const passwordInput = screen.getByRole('textbox', { name: /password/i });

      expect(emailInput).toHaveAttribute('aria-invalid', 'true');
      expect(passwordInput).toHaveAttribute('aria-invalid', 'true');

      // Check error messages are accessible
      expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();

      const results = await axe(container);
      expectNoAccessibilityViolations(results.violations);
    });
  });

  describe('Focus Management', () => {
    it('should handle focus states properly', () => {
      render(
        <div>
          <Button>First Button</Button>
          <Input label='Test Input' />
          <Button>Second Button</Button>
        </div>
      );

      const buttons = screen.getAllByRole('button');
      const input = screen.getByRole('textbox');

      // All interactive elements should be focusable
      buttons.forEach(button => {
        button.focus();
        expect(button).toHaveFocus();
      });

      input.focus();
      expect(input).toHaveFocus();
    });

    it('should provide proper tab order', () => {
      render(
        <form>
          <Input label='First Field' />
          <Input label='Second Field' />
          <Button type='submit'>Submit</Button>
        </form>
      );

      const inputs = screen.getAllByRole('textbox');
      const submitButton = screen.getByRole('button');

      // Elements should be in proper tab order
      inputs.forEach(input => {
        expect(input).not.toHaveAttribute('tabindex', '-1');
      });

      expect(submitButton).not.toHaveAttribute('tabindex', '-1');
    });
  });
});
