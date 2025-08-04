import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Input, TextArea, Select, InputGroup } from '../../src/components/UI';
import { TEST_DATES } from '../utils/dateTestUtils';
import {
  expectAccessible,
  testAccessibilityCompliance,
  accessibilityScenarios,
} from '../utils/accessibilityTestUtils';

// Extend expect with jest-axe matchers
expect.extend(toHaveNoViolations);

describe('Input Component System Accessibility', () => {
  beforeEach(() => {
    // Clear any previous DOM content
    document.body.innerHTML = '';
  });

  describe('Input Component Accessibility', () => {
    it('has no accessibility violations in default state', async () => {
      const { container } = render(<Input label='Username' value='testuser' onChange={vi.fn()} />);

      // Enhanced accessibility testing
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader'],
      });
    });

    it('has no accessibility violations with error state', async () => {
      const { container } = render(
        <Input
          label='Email'
          value='invalid-email'
          onChange={vi.fn()}
          error={true}
          errorMessage='Please enter a valid email address'
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with success state', async () => {
      const { container } = render(
        <Input
          label='Username'
          value='validuser'
          onChange={vi.fn()}
          success={true}
          successMessage='Username is available'
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with helper text', async () => {
      const { container } = render(
        <Input
          label='Password'
          type='password'
          value='password123'
          onChange={vi.fn()}
          helperText='Password must be at least 8 characters with numbers and symbols'
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with leading and trailing icons', async () => {
      const { container } = render(
        <Input
          label='Search'
          value='search term'
          onChange={vi.fn()}
          leadingIcon={<span aria-hidden='true'>🔍</span>}
          trailingIcon={<span aria-hidden='true'>✕</span>}
          onTrailingIconClick={vi.fn()}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when disabled', async () => {
      const { container } = render(
        <Input label='Disabled Input' value='disabled value' onChange={vi.fn()} disabled />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations when required', async () => {
      const { container } = render(
        <Input label='Required Field' value='' onChange={vi.fn()} required />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly associates label with input', () => {
      render(<Input label='Email Address' value='test@example.com' onChange={vi.fn()} />);

      const input = screen.getByLabelText('Email Address');
      const label = screen.getByText('Email Address');

      expect(input).toBeInTheDocument();
      expect(label).toBeInTheDocument();
      expect(input.id).toBe(label.getAttribute('for'));
    });

    it('properly associates error message with input', () => {
      render(
        <Input
          label='Email'
          value='invalid'
          onChange={vi.fn()}
          error={true}
          errorMessage='Invalid email format'
        />
      );

      const input = screen.getByLabelText('Email');
      const errorMessage = screen.getByText('Invalid email format');

      expect(input).toHaveAttribute('aria-describedby', errorMessage.id);
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('properly associates helper text with input', () => {
      render(
        <Input
          label='Username'
          value='user123'
          onChange={vi.fn()}
          helperText='Must be 3-20 characters'
        />
      );

      const input = screen.getByLabelText('Username');
      const helperText = screen.getByText('Must be 3-20 characters');

      expect(input).toHaveAttribute('aria-describedby', helperText.id);
    });

    it('sets aria-required for required fields', () => {
      render(<Input label='Required Field' value='' onChange={vi.fn()} required />);

      const input = screen.getByLabelText('Required Field');
      expect(input).toHaveAttribute('aria-required', 'true');
      expect(input).toBeRequired();
    });
  });

  describe('Password Toggle Accessibility', () => {
    it('has no accessibility violations with password toggle', async () => {
      const { container } = render(
        <Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has proper ARIA label for password toggle button', () => {
      render(<Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />);

      const toggleButton = screen.getByRole('button');
      expect(toggleButton).toHaveAttribute(
        'aria-label',
        expect.stringMatching(/show password|hide password/i)
      );
    });

    it('updates ARIA label when password visibility changes', async () => {
      render(<Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />);

      const toggleButton = screen.getByRole('button');

      // Initial state - should show "Show password"
      expect(toggleButton).toHaveAttribute('aria-label', expect.stringContaining('Show password'));

      // Click to show password
      fireEvent.click(toggleButton);
      expect(toggleButton).toHaveAttribute('aria-label', expect.stringContaining('Hide password'));
    });

    it('maintains proper tab order with password toggle', () => {
      render(
        <div>
          <Input label='Username' value='' onChange={vi.fn()} />
          <Input type='password' label='Password' value='secret' onChange={vi.fn()} />
          <button type='submit'>Submit</button>
        </div>
      );

      const usernameInput = screen.getByLabelText('Username');
      const passwordInput = screen.getByLabelText('Password');
      const passwordToggle = screen.getByRole('button', { name: /show password/i });
      const submitButton = screen.getByRole('button', { name: 'Submit' });

      // Check tab order - inputs don't have explicit tabindex by default
      expect(usernameInput).not.toHaveAttribute('tabindex');
      expect(passwordInput).not.toHaveAttribute('tabindex');
      expect(passwordToggle).toHaveAttribute('tabindex', '0');
      expect(submitButton).not.toHaveAttribute('tabindex');
    });
  });

  describe('Search Clear Accessibility', () => {
    it('has no accessibility violations with search clear button', async () => {
      const { container } = render(
        <Input type='search' label='Search' value='search term' onChange={vi.fn()} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has proper ARIA label for clear button', () => {
      render(<Input type='search' label='Search' value='search term' onChange={vi.fn()} />);

      const clearButton = screen.getByRole('button', { name: /clear search/i });
      expect(clearButton).toHaveAttribute('aria-label', expect.stringContaining('Clear search'));
    });

    it('removes clear button from tab order when search is empty', () => {
      render(<Input type='search' label='Search' value='' onChange={vi.fn()} />);

      // No clear button should be present
      expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument();
    });

    it('maintains keyboard accessibility for clear button', async () => {
      const handleChange = vi.fn();

      render(<Input type='search' label='Search' value='search term' onChange={handleChange} />);

      const clearButton = screen.getByRole('button', { name: /clear search/i });

      // Should be focusable and clickable with keyboard
      clearButton.focus();
      expect(clearButton).toHaveFocus();

      fireEvent.keyDown(clearButton, { key: 'Enter', code: 'Enter' });
      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe('TextArea Accessibility', () => {
    it('has no accessibility violations in default state', async () => {
      const { container } = render(
        <TextArea label='Comments' value='Some comments here' onChange={vi.fn()} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with auto-resize', async () => {
      const { container } = render(
        <TextArea
          label='Description'
          value='A longer description that might need auto-resize'
          onChange={vi.fn()}
          autoResize
          maxAutoHeight={200}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with character count', async () => {
      const { container } = render(
        <TextArea label='Bio' value='Short bio' onChange={vi.fn()} maxLength={500} showCharCount />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly associates character count with textarea', () => {
      render(
        <TextArea label='Bio' value='Short bio' onChange={vi.fn()} maxLength={100} showCharCount />
      );

      const textarea = screen.getByLabelText('Bio');
      const charCount = screen.getByText('9/100');

      // Character count should be part of the description
      expect(textarea).toHaveAttribute('aria-describedby', expect.stringContaining(charCount.id));
    });
  });

  describe('Select Component Accessibility', () => {
    const options = [
      { value: 'option1', label: 'Option 1' },
      { value: 'option2', label: 'Option 2' },
      { value: 'option3', label: 'Option 3', disabled: true },
    ];

    it('has no accessibility violations in default state', async () => {
      const { container } = render(
        <Select label='Choose Option' value='option1' onChange={vi.fn()} options={options} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with placeholder', async () => {
      const { container } = render(
        <Select
          label='Choose Option'
          value=''
          onChange={vi.fn()}
          placeholder='Select an option'
          options={options}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with error state', async () => {
      const { container } = render(
        <Select
          label='Required Select'
          value=''
          onChange={vi.fn()}
          options={options}
          error={true}
          errorMessage='Please select an option'
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly marks disabled options', () => {
      render(<Select label='Choose Option' value='' onChange={vi.fn()} options={options} />);

      const disabledOption = screen.getByRole('option', { name: 'Option 3' });
      expect(disabledOption).toBeDisabled();
    });

    it('properly associates error message with select', () => {
      render(
        <Select
          label='Category'
          value=''
          onChange={vi.fn()}
          options={options}
          error={true}
          errorMessage='Category is required'
        />
      );

      const select = screen.getByLabelText('Category');
      const errorMessage = screen.getByText('Category is required');

      expect(select).toHaveAttribute('aria-describedby', errorMessage.id);
      expect(select).toHaveAttribute('aria-invalid', 'true');
    });

    it('maintains proper option group structure', () => {
      render(
        <Select label='Grouped Options' value='' onChange={vi.fn()}>
          <optgroup label='Group 1'>
            <option value='g1o1'>Group 1 Option 1</option>
            <option value='g1o2'>Group 1 Option 2</option>
          </optgroup>
          <optgroup label='Group 2'>
            <option value='g2o1'>Group 2 Option 1</option>
          </optgroup>
        </Select>
      );

      const optgroups = screen.getAllByRole('group');
      expect(optgroups).toHaveLength(2);
      expect(optgroups[0]).toHaveAttribute('label', 'Group 1');
      expect(optgroups[1]).toHaveAttribute('label', 'Group 2');
    });
  });

  describe('InputGroup Accessibility', () => {
    it('has no accessibility violations with grouped inputs', async () => {
      const { container } = render(
        <InputGroup label='Personal Information'>
          <Input label='First Name' value='John' onChange={vi.fn()} />
          <Input label='Last Name' value='Doe' onChange={vi.fn()} />
        </InputGroup>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with horizontal layout', async () => {
      const { container } = render(
        <InputGroup horizontal label='Date Range'>
          <Input type='date' label='Start Date' value={TEST_DATES.GOAL_START} onChange={vi.fn()} />
          <Input type='date' label='End Date' value={TEST_DATES.GOAL_END} onChange={vi.fn()} />
        </InputGroup>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly implements fieldset structure', () => {
      render(
        <InputGroup label='Contact Information'>
          <Input label='Email' value='' onChange={vi.fn()} />
          <Input label='Phone' value='' onChange={vi.fn()} />
        </InputGroup>
      );

      const fieldset = screen.getByRole('group', { name: 'Contact Information' });
      const legend = screen.getByText('Contact Information');

      expect(fieldset).toBeInTheDocument();
      expect(fieldset.tagName).toBe('FIELDSET');
      expect(legend.tagName).toBe('LEGEND');
    });

    it('associates helper text with fieldset', () => {
      render(
        <InputGroup label='Address' helperText='Enter your complete mailing address'>
          <Input label='Street' value='' onChange={vi.fn()} />
          <Input label='City' value='' onChange={vi.fn()} />
        </InputGroup>
      );

      const helperText = screen.getByText('Enter your complete mailing address');
      expect(helperText).toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation', () => {
    it('maintains proper tab order for form with mixed inputs', async () => {
      render(
        <form>
          <Input label='Name' value='' onChange={vi.fn()} />
          <Input type='password' label='Password' value='secret' onChange={vi.fn()} />
          <Select
            label='Category'
            value=''
            onChange={vi.fn()}
            options={[{ value: 'cat1', label: 'Category 1' }]}
          />
          <TextArea label='Notes' value='' onChange={vi.fn()} />
          <button type='submit'>Submit</button>
        </form>
      );

      const nameInput = screen.getByLabelText('Name');
      const passwordInput = screen.getByLabelText('Password');
      const passwordToggle = screen.getByRole('button', { name: /show password/i });
      const categorySelect = screen.getByLabelText('Category');
      const notesTextarea = screen.getByLabelText('Notes');
      const submitButton = screen.getByRole('button', { name: 'Submit' });

      // Test tab navigation
      nameInput.focus();
      expect(nameInput).toHaveFocus();

      passwordInput.focus();
      expect(passwordInput).toHaveFocus();

      passwordToggle.focus();
      expect(passwordToggle).toHaveFocus();

      categorySelect.focus();
      expect(categorySelect).toHaveFocus();

      notesTextarea.focus();
      expect(notesTextarea).toHaveFocus();

      submitButton.focus();
      expect(submitButton).toHaveFocus();
    });

    it('supports keyboard interaction for password toggle', async () => {
      render(<Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />);

      const passwordInput = screen.getByLabelText('Password');
      const toggleButton = screen.getByRole('button', { name: /show password/i });

      // Initially password type
      expect(passwordInput).toHaveAttribute('type', 'password');

      // Focus and activate toggle with keyboard
      toggleButton.focus();
      expect(toggleButton).toHaveFocus();

      fireEvent.keyDown(toggleButton, { key: 'Enter', code: 'Enter' });
      expect(passwordInput).toHaveAttribute('type', 'text');

      fireEvent.keyDown(toggleButton, { key: ' ', code: 'Space' }); // Space should also work
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('supports keyboard interaction for search clear', async () => {
      const handleChange = vi.fn();

      render(<Input type='search' label='Search' value='search term' onChange={handleChange} />);

      const clearButton = screen.getByRole('button', { name: /clear search/i });

      clearButton.focus();
      expect(clearButton).toHaveFocus();

      fireEvent.keyDown(clearButton, { key: 'Enter', code: 'Enter' });
      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ value: '' }),
        })
      );
    });
  });

  describe('Screen Reader Support', () => {
    it('provides appropriate role information', () => {
      render(
        <div>
          <Input label='Text Input' value='' onChange={vi.fn()} />
          <Select label='Select Input' value='' onChange={vi.fn()} options={[]} />
          <TextArea label='Textarea Input' value='' onChange={vi.fn()} />
        </div>
      );

      const textInput = screen.getByLabelText('Text Input');
      const selectInput = screen.getByLabelText('Select Input');
      const textareaInput = screen.getByLabelText('Textarea Input');

      expect(textInput).not.toHaveAttribute('role'); // Default role
      expect(selectInput.tagName).toBe('SELECT');
      expect(textareaInput.tagName).toBe('TEXTAREA');
    });

    it('announces validation states to screen readers', () => {
      render(
        <Input
          label='Email'
          value='invalid'
          onChange={vi.fn()}
          error={true}
          errorMessage='Please enter a valid email address'
        />
      );

      const input = screen.getByLabelText('Email');
      expect(input).toHaveAttribute('aria-invalid', 'true');

      const errorMessage = screen.getByText('Please enter a valid email address');
      expect(input).toHaveAttribute('aria-describedby', errorMessage.id);
    });

    it('provides live region updates for dynamic content', () => {
      render(
        <TextArea
          label='Comment'
          value='This is a sample comment'
          onChange={vi.fn()}
          maxLength={100}
          showCharCount
        />
      );

      const charCount = screen.getByText('24/100');
      expect(charCount).toBeInTheDocument();

      // Character count should be announced when it changes
      const textarea = screen.getByLabelText('Comment');
      expect(textarea).toHaveAttribute('aria-describedby', expect.stringContaining(charCount.id));
    });
  });

  describe('Enhanced Accessibility Compliance', () => {
    it('Complete form meets WCAG AA compliance', async () => {
      const { container } = render(
        <form>
          <InputGroup label='Personal Information'>
            <Input
              label='First Name'
              value='John'
              onChange={vi.fn()}
              required
              aria-describedby='firstname-help'
            />
            <div id='firstname-help'>Enter your legal first name</div>

            <Input
              label='Email Address'
              type='email'
              value='john@example.com'
              onChange={vi.fn()}
              error={false}
              successMessage='Email is valid'
            />

            <Select
              label='Preferred Contact Method'
              value='email'
              onChange={vi.fn()}
              options={[
                { value: 'email', label: 'Email' },
                { value: 'phone', label: 'Phone' },
                { value: 'sms', label: 'SMS' },
              ]}
            />

            <TextArea
              label='Additional Comments'
              value='Optional comments here'
              onChange={vi.fn()}
              maxLength={500}
              showCharCount
            />
          </InputGroup>

          <button type='submit'>Submit Form</button>
        </form>
      );

      // Test comprehensive WCAG AA compliance
      await testAccessibilityCompliance(container, 'AA');

      // Use specialized form accessibility testing
      await accessibilityScenarios.testForm(container);
    });

    it('Error states provide accessible feedback', async () => {
      const { container } = render(
        <div>
          <Input
            label='Password'
            type='password'
            value='weak'
            onChange={vi.fn()}
            error={true}
            errorMessage='Password must be at least 8 characters with numbers and symbols'
            aria-invalid='true'
            aria-describedby='password-error'
          />

          <Select
            label='Country'
            value=''
            onChange={vi.fn()}
            options={[{ value: 'us', label: 'United States' }]}
            error={true}
            errorMessage='Please select your country'
            aria-invalid='true'
          />
        </div>
      );

      // Test error state accessibility
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['screen-reader', 'color-contrast'],
      });

      // Verify ARIA error associations
      const passwordInput = screen.getByLabelText('Password');
      const passwordError = screen.getByText(
        'Password must be at least 8 characters with numbers and symbols'
      );
      expect(passwordInput).toHaveAttribute('aria-describedby', passwordError.id);
      expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
    });

    it('Complex input interactions are keyboard accessible', async () => {
      const handleChange = vi.fn();
      const { container } = render(
        <div>
          <Input
            type='search'
            label='Search Users'
            value='john doe'
            onChange={handleChange}
            leadingIcon={<span aria-hidden='true'>🔍</span>}
          />

          <Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />
        </div>
      );

      // Test keyboard accessibility thoroughly
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard'],
      });

      // Test specific keyboard interactions
      const searchInput = screen.getByLabelText('Search Users');
      const clearButton = screen.getByRole('button', { name: /clear search/i });
      const passwordToggle = screen.getByRole('button', { name: /show password/i });

      // Verify all interactive elements are keyboard accessible
      expect(clearButton).toHaveAttribute('tabindex', '0');
      expect(passwordToggle).toHaveAttribute('tabindex', '0');
    });
  });

  describe('High Contrast and Visual Accessibility', () => {
    it('maintains accessibility in error states', async () => {
      const { container } = render(
        <div>
          <Input
            label='Required Field'
            value=''
            onChange={vi.fn()}
            error={true}
            errorMessage='This field is required'
          />
          <Select
            label='Required Select'
            value=''
            onChange={vi.fn()}
            options={[{ value: 'opt1', label: 'Option 1' }]}
            error={true}
            errorMessage='Please select an option'
          />
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('maintains accessibility with various size variants', async () => {
      const { container } = render(
        <div>
          <Input label='Small Input' size='small' value='' onChange={vi.fn()} />
          <Input label='Medium Input' size='medium' value='' onChange={vi.fn()} />
          <Input label='Large Input' size='large' value='' onChange={vi.fn()} />
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
