import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  expectAccessible,
  testAccessibilityCompliance,
  accessibilityScenarios,
} from '../utils/accessibilityTestUtils';
import { Modal, ConfirmationModal, LoadingModal } from '../../src/components/UI/Modal';
import { Button } from '../../src/components/UI/Button';

expect.extend(toHaveNoViolations);

describe('Modal Component Accessibility Tests', () => {
  beforeEach(() => {
    // Clear any previous DOM content
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    // Clean up any remaining modals
    document.body.style.overflow = '';
    const modals = document.querySelectorAll('[role="dialog"]');
    modals.forEach(modal => modal.remove());
  });

  describe('Basic Modal Accessibility', () => {
    it('has no accessibility violations when open', async () => {
      const { container } = render(
        <Modal isOpen={true} onClose={vi.fn()} title='Test Modal'>
          <p>Modal content goes here</p>
        </Modal>
      );

      // Enhanced accessibility testing
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader', 'structure'],
      });
    });

    it('has proper dialog role and ARIA attributes', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title='Accessible Modal'>
          <p>Content</p>
        </Modal>
      );

      const modal = screen.getByRole('dialog');
      expect(modal).toHaveAttribute('aria-modal', 'true');
      expect(modal).toHaveAttribute('aria-labelledby');

      const titleId = modal.getAttribute('aria-labelledby');
      const title = document.getElementById(titleId!);
      expect(title).toHaveTextContent('Accessible Modal');
    });

    it('properly handles custom ARIA labeling', () => {
      render(
        <Modal
          isOpen={true}
          onClose={vi.fn()}
          aria-label='Custom modal label'
          aria-describedby='modal-description'
        >
          <p id='modal-description'>This modal has custom ARIA attributes</p>
        </Modal>
      );

      const modal = screen.getByRole('dialog');
      expect(modal).toHaveAttribute('aria-label', 'Custom modal label');
      expect(modal).toHaveAttribute('aria-describedby', 'modal-description');
    });

    it('has accessible close button', async () => {
      const handleClose = vi.fn();
      const { container } = render(
        <Modal isOpen={true} onClose={handleClose} title='Closable Modal'>
          <p>Content</p>
        </Modal>
      );

      const closeButton = screen.getByRole('button', { name: 'Close modal' });
      expect(closeButton).toHaveAttribute('aria-label', 'Close modal');

      // Test keyboard activation
      fireEvent.keyDown(closeButton, { key: 'Enter' });
      expect(handleClose).toHaveBeenCalledTimes(1);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('handles different modal sizes accessibly', async () => {
      const sizes = ['small', 'medium', 'large', 'fullscreen'] as const;

      for (const size of sizes) {
        const { container, unmount } = render(
          <Modal isOpen={true} onClose={vi.fn()} size={size} title={`${size} Modal`}>
            <p>Content for {size} modal</p>
          </Modal>
        );

        const modal = screen.getByRole('dialog');
        expect(modal).toBeInTheDocument();

        const results = await axe(container);
        expect(results).toHaveNoViolations();

        unmount();
      }
    });
  });

  describe('Focus Management', () => {
    it('traps focus within the modal', async () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title='Focus Trap Modal'>
          <div>
            <button>First Button</button>
            <input type='text' placeholder='Input field' />
            <button>Last Button</button>
          </div>
        </Modal>
      );

      const firstButton = screen.getByRole('button', { name: 'First Button' });
      const lastButton = screen.getByRole('button', { name: 'Last Button' });
      const input = screen.getByRole('textbox');
      const closeButton = screen.getByRole('button', { name: 'Close modal' });

      // Wait for focus to be set
      await waitFor(() => {
        expect(document.activeElement).toBe(firstButton);
      });

      // Test forward tab navigation
      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(input);

      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(lastButton);

      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(closeButton);

      // Test focus wrap-around (forward)
      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(firstButton);

      // Test backward tab navigation
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(closeButton);
    });

    it('restores focus to previous element when closed', async () => {
      const TriggerComponent = () => {
        const [isOpen, setIsOpen] = React.useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open Modal</button>
            <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title='Test Modal'>
              <p>Modal content</p>
            </Modal>
          </div>
        );
      };

      render(<TriggerComponent />);

      const triggerButton = screen.getByRole('button', { name: 'Open Modal' });

      // Focus and click the trigger
      triggerButton.focus();
      expect(triggerButton).toHaveFocus();

      fireEvent.click(triggerButton);

      // Modal should be open and focus should move
      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();

      // Close the modal
      const closeButton = screen.getByRole('button', { name: 'Close modal' });
      fireEvent.click(closeButton);

      // Focus should return to trigger button
      await waitFor(() => {
        expect(triggerButton).toHaveFocus();
      });
    });

    it('prevents background scrolling when modal is open', () => {
      const { unmount } = render(
        <Modal isOpen={true} onClose={vi.fn()} title='Scroll Prevention Modal'>
          <p>Content</p>
        </Modal>
      );

      expect(document.body.style.overflow).toBe('hidden');

      unmount();

      // Should restore scrolling after unmount
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('Keyboard Navigation', () => {
    it('closes on Escape key by default', () => {
      const handleClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} title='Escapable Modal'>
          <p>Press Escape to close</p>
        </Modal>
      );

      const modal = screen.getByRole('dialog');
      fireEvent.keyDown(modal, { key: 'Escape' });

      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('does not close on Escape when disabled', () => {
      const handleClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} closeOnEsc={false} title='Non-escapable Modal'>
          <p>Escape key disabled</p>
        </Modal>
      );

      const modal = screen.getByRole('dialog');
      fireEvent.keyDown(modal, { key: 'Escape' });

      expect(handleClose).not.toHaveBeenCalled();
    });

    it('closes on backdrop click by default', () => {
      const handleClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} title='Backdrop Modal'>
          <p>Click backdrop to close</p>
        </Modal>
      );

      // Click on the backdrop (overlay)
      const overlay = screen.getByRole('presentation');
      fireEvent.click(overlay);

      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('does not close on backdrop click when disabled', () => {
      const handleClose = vi.fn();
      render(
        <Modal
          isOpen={true}
          onClose={handleClose}
          closeOnBackdrop={false}
          title='Backdrop Disabled Modal'
        >
          <p>Backdrop click disabled</p>
        </Modal>
      );

      const overlay = screen.getByRole('presentation');
      fireEvent.click(overlay);

      expect(handleClose).not.toHaveBeenCalled();
    });

    it('does not close when clicking modal content', () => {
      const handleClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} title='Content Click Modal'>
          <p>Click me - should not close modal</p>
        </Modal>
      );

      const content = screen.getByText('Click me - should not close modal');
      fireEvent.click(content);

      expect(handleClose).not.toHaveBeenCalled();
    });
  });

  describe('Modal with Footer', () => {
    it('has no accessibility violations with custom footer', async () => {
      const { container } = render(
        <Modal
          isOpen={true}
          onClose={vi.fn()}
          title='Modal with Footer'
          footer={
            <>
              <Button variant='secondary' onClick={vi.fn()}>
                Cancel
              </Button>
              <Button variant='primary' onClick={vi.fn()}>
                Save
              </Button>
            </>
          }
        >
          <p>Modal with action buttons</p>
        </Modal>
      );

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      const saveButton = screen.getByRole('button', { name: 'Save' });

      expect(cancelButton).toBeInTheDocument();
      expect(saveButton).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('maintains proper focus order with footer buttons', async () => {
      render(
        <Modal
          isOpen={true}
          onClose={vi.fn()}
          title='Focus Order Modal'
          footer={
            <>
              <Button variant='secondary' onClick={vi.fn()}>
                Cancel
              </Button>
              <Button variant='primary' onClick={vi.fn()}>
                Save
              </Button>
            </>
          }
        >
          <div>
            <input type='text' placeholder='Name' />
            <textarea placeholder='Description'></textarea>
          </div>
        </Modal>
      );

      const nameInput = screen.getByRole('textbox', { name: '' });
      const description = screen.getByRole('textbox', { name: '' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      const saveButton = screen.getByRole('button', { name: 'Save' });
      const closeButton = screen.getByRole('button', { name: 'Close modal' });

      // Test tab order: input -> textarea -> cancel -> save -> close -> back to input
      await waitFor(() => {
        expect(document.activeElement).toBe(nameInput);
      });

      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(description);

      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(cancelButton);

      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(saveButton);

      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(closeButton);

      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(document.activeElement).toBe(nameInput);
    });
  });

  describe('ConfirmationModal Accessibility', () => {
    it('has no accessibility violations', async () => {
      const { container } = render(
        <ConfirmationModal
          isOpen={true}
          onClose={vi.fn()}
          type='danger'
          title='Delete Item'
          message='Are you sure you want to delete this item? This action cannot be undone.'
          confirmText='Delete'
          onConfirm={vi.fn()}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('properly labels confirmation actions', () => {
      render(
        <ConfirmationModal
          isOpen={true}
          onClose={vi.fn()}
          type='warning'
          title='Confirm Action'
          message='Are you sure you want to proceed?'
          confirmText='Yes, proceed'
          cancelText='No, cancel'
          onConfirm={vi.fn()}
        />
      );

      const confirmButton = screen.getByRole('button', { name: 'Yes, proceed' });
      const cancelButton = screen.getByRole('button', { name: 'No, cancel' });

      expect(confirmButton).toBeInTheDocument();
      expect(cancelButton).toBeInTheDocument();
    });

    it('handles loading state accessibly', async () => {
      const { container } = render(
        <ConfirmationModal
          isOpen={true}
          onClose={vi.fn()}
          type='info'
          title='Processing'
          message='Please wait while we process your request.'
          loading={true}
          onConfirm={vi.fn()}
        />
      );

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });

      expect(confirmButton).toBeDisabled();
      expect(confirmButton).toHaveAttribute('aria-busy', 'true');
      expect(cancelButton).toBeDisabled();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('provides appropriate icon context', () => {
      const types = ['warning', 'danger', 'info', 'success'] as const;

      types.forEach(type => {
        const { unmount } = render(
          <ConfirmationModal
            isOpen={true}
            onClose={vi.fn()}
            type={type}
            title={`${type} modal`}
            message={`This is a ${type} confirmation.`}
            onConfirm={vi.fn()}
          />
        );

        const modal = screen.getByRole('dialog');
        expect(modal).toBeInTheDocument();

        unmount();
      });
    });
  });

  describe('LoadingModal Accessibility', () => {
    it('has no accessibility violations', async () => {
      const { container } = render(
        <LoadingModal isOpen={true} message='Processing your request...' />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('cannot be dismissed by user', () => {
      render(<LoadingModal isOpen={true} message='Loading...' />);

      const modal = screen.getByRole('dialog');
      expect(modal).toHaveAttribute('aria-label', 'Loading');

      // Should not have close button
      expect(screen.queryByRole('button', { name: 'Close modal' })).not.toBeInTheDocument();

      // Should not respond to Escape key
      fireEvent.keyDown(modal, { key: 'Escape' });
      expect(modal).toBeInTheDocument();

      // Should not close on backdrop click
      const overlay = screen.getByRole('presentation');
      fireEvent.click(overlay);
      expect(modal).toBeInTheDocument();
    });

    it('properly announces loading state to screen readers', () => {
      render(<LoadingModal isOpen={true} message='Saving your changes...' />);

      const loadingText = screen.getByText('Saving your changes...');
      expect(loadingText).toBeInTheDocument();

      const spinner = document.querySelector('[aria-hidden="true"]');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('Enhanced Accessibility Compliance', () => {
    it('meets WCAG AA compliance standards', async () => {
      const { container } = render(
        <Modal
          isOpen={true}
          onClose={vi.fn()}
          title='Comprehensive Modal'
          footer={
            <>
              <Button variant='secondary' onClick={vi.fn()}>
                Cancel
              </Button>
              <Button variant='primary' onClick={vi.fn()}>
                Submit
              </Button>
            </>
          }
        >
          <form>
            <div>
              <label htmlFor='modal-input'>Enter your name:</label>
              <input id='modal-input' type='text' required />
            </div>
            <div>
              <label htmlFor='modal-select'>Choose an option:</label>
              <select id='modal-select'>
                <option value=''>Select...</option>
                <option value='option1'>Option 1</option>
                <option value='option2'>Option 2</option>
              </select>
            </div>
          </form>
        </Modal>
      );

      // Test comprehensive WCAG AA compliance
      await testAccessibilityCompliance(container, 'AA');

      // Test specific accessibility scenarios
      await accessibilityScenarios.testModal(container);
    });

    it('handles complex modal interactions accessibly', async () => {
      const ComplexModal = () => {
        const [step, setStep] = React.useState(1);
        return (
          <Modal
            isOpen={true}
            onClose={vi.fn()}
            title={`Step ${step} of 3`}
            aria-describedby='step-description'
          >
            <div id='step-description'>Complete this multi-step process to continue.</div>
            <div>
              {step === 1 && <p>First step content</p>}
              {step === 2 && <p>Second step content</p>}
              {step === 3 && <p>Final step content</p>}
            </div>
            <div>
              <Button
                variant='secondary'
                onClick={() => setStep(Math.max(1, step - 1))}
                disabled={step === 1}
              >
                Previous
              </Button>
              <Button
                variant='primary'
                onClick={() => setStep(Math.min(3, step + 1))}
                disabled={step === 3}
              >
                {step === 3 ? 'Finish' : 'Next'}
              </Button>
            </div>
          </Modal>
        );
      };

      const { container } = render(<ComplexModal />);

      const modal = screen.getByRole('dialog');
      expect(modal).toHaveAttribute('aria-describedby', 'step-description');

      const nextButton = screen.getByRole('button', { name: 'Next' });
      const prevButton = screen.getByRole('button', { name: 'Previous' });

      expect(prevButton).toBeDisabled();
      expect(nextButton).not.toBeDisabled();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('maintains accessibility during animations', async () => {
      const AnimatedModal = () => {
        const [isOpen, setIsOpen] = React.useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open Modal</button>
            <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title='Animated Modal'>
              <p>Modal with entrance/exit animations</p>
            </Modal>
          </div>
        );
      };

      const { container } = render(<AnimatedModal />);

      const triggerButton = screen.getByRole('button', { name: 'Open Modal' });
      fireEvent.click(triggerButton);

      // Modal should be accessible even during opening animation
      const modal = screen.getByRole('dialog');
      expect(modal).toHaveAttribute('aria-modal', 'true');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Error States and Edge Cases', () => {
    it('handles modal without title accessibly', async () => {
      const { container } = render(
        <Modal isOpen={true} onClose={vi.fn()} aria-label='Untitled modal' showCloseButton={false}>
          <p>Modal without a title but with aria-label</p>
        </Modal>
      );

      const modal = screen.getByRole('dialog');
      expect(modal).toHaveAttribute('aria-label', 'Untitled modal');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('maintains accessibility with dynamic content', async () => {
      const DynamicModal = () => {
        const [count, setCount] = React.useState(0);
        return (
          <Modal isOpen={true} onClose={vi.fn()} title={`Dynamic Modal (${count})`}>
            <p>Current count: {count}</p>
            <Button onClick={() => setCount(c => c + 1)}>Increment</Button>
          </Modal>
        );
      };

      const { container } = render(<DynamicModal />);

      const incrementButton = screen.getByRole('button', { name: 'Increment' });
      fireEvent.click(incrementButton);

      expect(screen.getByText('Current count: 1')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('handles nested interactive elements accessibly', async () => {
      const { container } = render(
        <Modal isOpen={true} onClose={vi.fn()} title='Nested Elements Modal'>
          <div>
            <button>Button 1</button>
            <div>
              <button>Nested Button</button>
              <input type='text' placeholder='Nested input' />
            </div>
            <button>Button 2</button>
          </div>
        </Modal>
      );

      const button1 = screen.getByRole('button', { name: 'Button 1' });
      const nestedButton = screen.getByRole('button', { name: 'Nested Button' });
      const nestedInput = screen.getByRole('textbox');
      const button2 = screen.getByRole('button', { name: 'Button 2' });

      // All elements should be in the tab order
      expect(button1).toBeInTheDocument();
      expect(nestedButton).toBeInTheDocument();
      expect(nestedInput).toBeInTheDocument();
      expect(button2).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
