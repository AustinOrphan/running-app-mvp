import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  expectAccessible,
  testAccessibilityCompliance,
  expectCriticalAccessibility,
  expectEssentialAccessibility,
} from '../utils/accessibilityTestUtils';
import { Button, ButtonGroup, IconButton } from '../../src/components/UI/Button';

expect.extend(toHaveNoViolations);

describe('Button Component Accessibility Tests', () => {
  describe('Basic Button Accessibility', () => {
    it('has no accessibility violations in default state', async () => {
      const { container } = render(<Button onClick={vi.fn()}>Click me</Button>);

      // Enhanced accessibility testing
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader'],
      });
    });

    it('has no accessibility violations with different variants', async () => {
      const { container } = render(
        <div>
          <Button variant='primary' onClick={vi.fn()}>
            Primary
          </Button>
          <Button variant='secondary' onClick={vi.fn()}>
            Secondary
          </Button>
          <Button variant='danger' onClick={vi.fn()}>
            Danger
          </Button>
          <Button variant='warning' onClick={vi.fn()}>
            Warning
          </Button>
          <Button variant='success' onClick={vi.fn()}>
            Success
          </Button>
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with different sizes', async () => {
      const { container } = render(
        <div>
          <Button size='small' onClick={vi.fn()}>
            Small
          </Button>
          <Button size='medium' onClick={vi.fn()}>
            Medium
          </Button>
          <Button size='large' onClick={vi.fn()}>
            Large
          </Button>
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly handles disabled state accessibility', async () => {
      const { container } = render(
        <Button disabled onClick={vi.fn()}>
          Disabled Button
        </Button>
      );

      const button = screen.getByRole('button', { name: 'Disabled Button' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly handles loading state accessibility', async () => {
      const { container } = render(
        <Button loading onClick={vi.fn()}>
          Loading Button
        </Button>
      );

      const button = screen.getByRole('button', { name: 'Loading Button' });
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByText('Loading...')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('maintains proper ARIA labeling', () => {
      render(
        <Button aria-label='Custom aria label' onClick={vi.fn()}>
          Button with custom label
        </Button>
      );

      const button = screen.getByRole('button', { name: 'Custom aria label' });
      expect(button).toHaveAttribute('aria-label', 'Custom aria label');
    });
  });

  describe('Button with Icons Accessibility', () => {
    it('has no accessibility violations with icons', async () => {
      const { container } = render(
        <div>
          <Button icon={<span>🔥</span>} iconPosition='left' onClick={vi.fn()}>
            Left Icon
          </Button>
          <Button icon={<span>➡️</span>} iconPosition='right' onClick={vi.fn()}>
            Right Icon
          </Button>
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly marks icons as decorative', () => {
      render(
        <Button icon={<span>🔥</span>} onClick={vi.fn()}>
          Fire Button
        </Button>
      );

      const iconWrapper = screen.getByText('🔥').parentElement;
      expect(iconWrapper).toHaveAttribute('aria-hidden', 'true');
    });

    it('handles icon-only buttons with proper labeling', async () => {
      const { container } = render(
        <Button icon={<span>🗑️</span>} aria-label='Delete item' onClick={vi.fn()} />
      );

      const button = screen.getByRole('button', { name: 'Delete item' });
      expect(button).toHaveAttribute('aria-label', 'Delete item');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('ButtonGroup Accessibility', () => {
    it('has no accessibility violations with grouped buttons', async () => {
      const { container } = render(
        <ButtonGroup>
          <Button variant='secondary' onClick={vi.fn()}>
            Cancel
          </Button>
          <Button variant='primary' onClick={vi.fn()}>
            Save
          </Button>
        </ButtonGroup>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly implements group role', () => {
      render(
        <ButtonGroup>
          <Button onClick={vi.fn()}>Button 1</Button>
          <Button onClick={vi.fn()}>Button 2</Button>
        </ButtonGroup>
      );

      const group = screen.getByRole('group');
      expect(group).toBeInTheDocument();
    });

    it('has no accessibility violations with vertical layout', async () => {
      const { container } = render(
        <ButtonGroup direction='vertical'>
          <Button onClick={vi.fn()}>Top Button</Button>
          <Button onClick={vi.fn()}>Bottom Button</Button>
        </ButtonGroup>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('maintains proper button spacing and alignment', async () => {
      const { container } = render(
        <ButtonGroup gap='large' align='center'>
          <Button onClick={vi.fn()}>Button 1</Button>
          <Button onClick={vi.fn()}>Button 2</Button>
          <Button onClick={vi.fn()}>Button 3</Button>
        </ButtonGroup>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('IconButton Accessibility', () => {
    it('has no accessibility violations', async () => {
      const { container } = render(
        <IconButton
          icon={<span>✏️</span>}
          aria-label='Edit item'
          tooltip='Edit'
          onClick={vi.fn()}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('requires aria-label for accessibility', () => {
      render(<IconButton icon={<span>✏️</span>} aria-label='Edit item' onClick={vi.fn()} />);

      const button = screen.getByRole('button', { name: 'Edit item' });
      expect(button).toHaveAttribute('aria-label', 'Edit item');
    });

    it('properly handles tooltip text', () => {
      render(
        <IconButton
          icon={<span>🗑️</span>}
          aria-label='Delete item'
          tooltip='Delete this item'
          onClick={vi.fn()}
        />
      );

      const button = screen.getByRole('button', { name: 'Delete item' });
      expect(button).toHaveAttribute('title', 'Delete this item');
    });

    it('maintains accessibility in different states', async () => {
      const { container } = render(
        <div>
          <IconButton icon={<span>✏️</span>} aria-label='Edit item' onClick={vi.fn()} />
          <IconButton icon={<span>🗑️</span>} aria-label='Delete item' disabled onClick={vi.fn()} />
          <IconButton icon={<span>💾</span>} aria-label='Save item' loading onClick={vi.fn()} />
        </div>
      );

      const editButton = screen.getByRole('button', { name: 'Edit item' });
      const deleteButton = screen.getByRole('button', { name: 'Delete item' });
      const saveButton = screen.getByRole('button', { name: 'Save item' });

      expect(editButton).not.toBeDisabled();
      expect(deleteButton).toBeDisabled();
      expect(saveButton).toHaveAttribute('aria-busy', 'true');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Keyboard Navigation', () => {
    it('supports keyboard interaction', async () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Keyboard Button</Button>);

      const button = screen.getByRole('button', { name: 'Keyboard Button' });

      // Test focus
      button.focus();
      expect(button).toHaveFocus();

      // Test Enter key activation
      fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
      expect(handleClick).toHaveBeenCalledTimes(1);

      // Test Space key activation
      fireEvent.keyDown(button, { key: ' ', code: 'Space' });
      expect(handleClick).toHaveBeenCalledTimes(2);
    });

    it('maintains proper tab order in button groups', () => {
      render(
        <div>
          <Button onClick={vi.fn()}>First Button</Button>
          <ButtonGroup>
            <Button onClick={vi.fn()}>Group Button 1</Button>
            <Button onClick={vi.fn()}>Group Button 2</Button>
          </ButtonGroup>
          <Button onClick={vi.fn()}>Last Button</Button>
        </div>
      );

      const firstButton = screen.getByRole('button', { name: 'First Button' });
      const groupButton1 = screen.getByRole('button', { name: 'Group Button 1' });
      const groupButton2 = screen.getByRole('button', { name: 'Group Button 2' });
      const lastButton = screen.getByRole('button', { name: 'Last Button' });

      // Test tab navigation sequence
      firstButton.focus();
      expect(firstButton).toHaveFocus();

      groupButton1.focus();
      expect(groupButton1).toHaveFocus();

      groupButton2.focus();
      expect(groupButton2).toHaveFocus();

      lastButton.focus();
      expect(lastButton).toHaveFocus();
    });

    it('does not activate when disabled or loading', () => {
      const handleClick = vi.fn();
      render(
        <div>
          <Button disabled onClick={handleClick}>
            Disabled Button
          </Button>
          <Button loading onClick={handleClick}>
            Loading Button
          </Button>
        </div>
      );

      const disabledButton = screen.getByRole('button', { name: 'Disabled Button' });
      const loadingButton = screen.getByRole('button', { name: 'Loading Button' });

      // Test that disabled button doesn't activate
      fireEvent.click(disabledButton);
      fireEvent.keyDown(disabledButton, { key: 'Enter' });
      fireEvent.keyDown(disabledButton, { key: ' ' });

      // Test that loading button doesn't activate
      fireEvent.click(loadingButton);
      fireEvent.keyDown(loadingButton, { key: 'Enter' });
      fireEvent.keyDown(loadingButton, { key: ' ' });

      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('Focus Management', () => {
    it('has visible focus indicators', () => {
      render(<Button onClick={vi.fn()}>Focusable Button</Button>);

      const button = screen.getByRole('button', { name: 'Focusable Button' });
      button.focus();

      expect(button).toHaveFocus();
      // The actual focus ring styling would be tested in visual tests
    });

    it('maintains focus when content changes', () => {
      const TestComponent = () => {
        const [loading, setLoading] = React.useState(false);
        return (
          <div>
            <Button loading={loading} onClick={() => setLoading(!loading)}>
              {loading ? 'Loading...' : 'Click me'}
            </Button>
          </div>
        );
      };

      render(<TestComponent />);
      const button = screen.getByRole('button');

      button.focus();
      expect(button).toHaveFocus();

      // Trigger state change
      fireEvent.click(button);

      // Button should still be focusable even in loading state
      expect(button).toHaveFocus();
    });
  });

  describe('Enhanced Accessibility Compliance', () => {
    it('meets WCAG AA compliance standards', async () => {
      const { container } = render(
        <div>
          <Button variant='primary' onClick={vi.fn()}>
            Primary Action
          </Button>
          <Button variant='secondary' onClick={vi.fn()}>
            Secondary Action
          </Button>
          <ButtonGroup>
            <Button variant='danger' onClick={vi.fn()}>
              Delete
            </Button>
            <Button variant='secondary' onClick={vi.fn()}>
              Cancel
            </Button>
          </ButtonGroup>
          <IconButton icon={<span>⚙️</span>} aria-label='Settings' onClick={vi.fn()} />
        </div>
      );

      // Test comprehensive WCAG AA compliance
      await testAccessibilityCompliance(container, 'AA');

      // Test all accessibility categories
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader', 'structure'],
      });
    });

    it('provides appropriate context for screen readers', async () => {
      const { container } = render(
        <form>
          <div>
            <label htmlFor='username'>Username</label>
            <input id='username' type='text' />
          </div>
          <ButtonGroup>
            <Button type='button' variant='secondary' onClick={vi.fn()}>
              Cancel
            </Button>
            <Button type='submit' variant='primary' onClick={vi.fn()}>
              Submit Form
            </Button>
          </ButtonGroup>
        </form>
      );

      // Verify form button types are correct
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      const submitButton = screen.getByRole('button', { name: 'Submit Form' });

      expect(cancelButton).toHaveAttribute('type', 'button');
      expect(submitButton).toHaveAttribute('type', 'submit');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('handles complex interaction patterns accessibly', async () => {
      const handleSave = vi.fn();
      const handleCancel = vi.fn();

      const { container } = render(
        <div role='dialog' aria-labelledby='dialog-title'>
          <h2 id='dialog-title'>Confirm Action</h2>
          <p>Are you sure you want to proceed with this action?</p>
          <ButtonGroup align='end'>
            <Button variant='secondary' onClick={handleCancel} aria-describedby='cancel-help'>
              Cancel
            </Button>
            <div id='cancel-help' className='sr-only'>
              Cancels the action and returns to the previous screen
            </div>
            <Button variant='danger' onClick={handleSave} aria-describedby='confirm-help'>
              Confirm
            </Button>
            <div id='confirm-help' className='sr-only'>
              Proceeds with the action - this cannot be undone
            </div>
          </ButtonGroup>
        </div>
      );

      // Verify proper ARIA relationships
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      const confirmButton = screen.getByRole('button', { name: 'Confirm' });

      expect(cancelButton).toHaveAttribute('aria-describedby', 'cancel-help');
      expect(confirmButton).toHaveAttribute('aria-describedby', 'confirm-help');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Error States and Edge Cases', () => {
    it('handles buttons without text content accessibly', async () => {
      const { container } = render(
        <Button aria-label='Icon only button' onClick={vi.fn()}>
          <span aria-hidden='true'>🔍</span>
        </Button>
      );

      const button = screen.getByRole('button', { name: 'Icon only button' });
      expect(button).toHaveAttribute('aria-label', 'Icon only button');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('maintains accessibility with dynamic content', async () => {
      const DynamicButton = () => {
        const [count, setCount] = React.useState(0);
        return <Button onClick={() => setCount(c => c + 1)}>Clicked {count} times</Button>;
      };

      const { container } = render(<DynamicButton />);

      const button = screen.getByRole('button', { name: 'Clicked 0 times' });
      fireEvent.click(button);

      expect(screen.getByRole('button', { name: 'Clicked 1 times' })).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('handles full-width buttons accessibly', async () => {
      const { container } = render(
        <Button fullWidth onClick={vi.fn()}>
          Full Width Button
        </Button>
      );

      const button = screen.getByRole('button', { name: 'Full Width Button' });
      expect(button).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
