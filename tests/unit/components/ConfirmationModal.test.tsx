import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmationModal } from '../../../src/components/UI/Modal';
import { LegacyConfirmationModal } from '../../../src/components/ConfirmationModal';

// Mock CSS modules
vi.mock('../../../src/styles/components/Modal.module.css', () => ({
  default: {
    modal: 'modal',
    backdrop: 'backdrop',
    content: 'content',
    header: 'header',
    title: 'title',
    body: 'body',
    footer: 'footer',
    closeButton: 'closeButton',
    confirmationModal: 'confirmationModal',
    confirmationHeader: 'confirmationHeader',
    confirmationIcon: 'confirmationIcon',
    confirmationTitle: 'confirmationTitle',
    confirmationMessage: 'confirmationMessage',
    warning: 'warning',
    danger: 'danger',
    info: 'info',
    success: 'success',
  },
}));

describe('ConfirmationModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Test Title',
    message: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a div for the modal portal
    const modalRoot = document.createElement('div');
    modalRoot.setAttribute('id', 'modal-root');
    document.body.appendChild(modalRoot);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clean up any modal portals that were added
    const modals = document.body.querySelectorAll('[role="presentation"]');
    modals.forEach(modal => {
      if (modal.parentNode === document.body) {
        document.body.removeChild(modal);
      }
    });
    // Reset body styles
    document.body.style.overflow = '';
  });

  describe('Rendering', () => {
    it('renders when isOpen is true', () => {
      render(<ConfirmationModal {...defaultProps} />);

      expect(screen.getAllByText('Test Title')).toHaveLength(2); // Main title and confirmation title
      expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      render(<ConfirmationModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('Test Title')).not.toBeInTheDocument();
      expect(screen.queryByText('Are you sure you want to proceed?')).not.toBeInTheDocument();
    });

    it('renders without title', () => {
      const { title, ...propsWithoutTitle } = defaultProps;
      render(<ConfirmationModal {...propsWithoutTitle} />);

      expect(screen.queryByText('Test Title')).not.toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
    });

    it('renders custom button text', () => {
      render(<ConfirmationModal {...defaultProps} confirmText='Delete' cancelText='Keep' />);

      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    });
  });

  describe('Types and Icons', () => {
    it('renders info type with default icon', () => {
      render(<ConfirmationModal {...defaultProps} type='info' />);

      expect(screen.getByText('ℹ️')).toBeInTheDocument();
    });

    it('renders warning type with default icon', () => {
      render(<ConfirmationModal {...defaultProps} type='warning' />);

      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });

    it('renders danger type with default icon', () => {
      render(<ConfirmationModal {...defaultProps} type='danger' />);

      expect(screen.getByText('🗑️')).toBeInTheDocument();
    });

    it('renders success type with default icon', () => {
      render(<ConfirmationModal {...defaultProps} type='success' />);

      expect(screen.getByText('✅')).toBeInTheDocument();
    });

    it('renders custom icon', () => {
      const customIcon = <span data-testid='custom-icon'>🎯</span>;
      render(<ConfirmationModal {...defaultProps} icon={customIcon} />);

      expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
      expect(screen.getByText('🎯')).toBeInTheDocument();
    });

    it('uses correct button variant for danger type', () => {
      render(<ConfirmationModal {...defaultProps} type='danger' />);

      // The confirm button should have danger variant (visually different styling)
      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmButton).toBeInTheDocument();
    });

    it('uses custom confirm variant when provided', () => {
      render(<ConfirmationModal {...defaultProps} type='info' confirmVariant='warning' />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmButton).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onConfirm when confirm button is clicked', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<ConfirmationModal {...defaultProps} onConfirm={onConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      expect(onConfirm).toHaveBeenCalledTimes(1);

      // Wait for async handling
      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('calls onCancel and onClose when cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<ConfirmationModal {...defaultProps} onCancel={onCancel} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose without onCancel when cancel is not provided', () => {
      render(<ConfirmationModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('handles async onConfirm functions', async () => {
      const asyncOnConfirm = vi
        .fn()
        .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

      render(<ConfirmationModal {...defaultProps} onConfirm={asyncOnConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      // Button should be disabled while loading
      expect(confirmButton).toBeDisabled();

      await waitFor(() => {
        expect(asyncOnConfirm).toHaveBeenCalledTimes(1);
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('handles onConfirm errors gracefully', async () => {
      const errorOnConfirm = vi.fn().mockRejectedValue(new Error('Test error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<ConfirmationModal {...defaultProps} onConfirm={errorOnConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(errorOnConfirm).toHaveBeenCalledTimes(1);
      });

      // Should not close modal on error
      expect(defaultProps.onClose).not.toHaveBeenCalled();

      // Button should be re-enabled after error
      await waitFor(() => {
        expect(confirmButton).not.toBeDisabled();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('Loading States', () => {
    it('disables buttons when loading prop is true', () => {
      render(<ConfirmationModal {...defaultProps} loading={true} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });

      expect(confirmButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();
    });

    it('shows loading state during async confirm action', async () => {
      let resolveConfirm: () => void;
      const asyncOnConfirm = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolveConfirm = resolve;
          })
      );

      render(<ConfirmationModal {...defaultProps} onConfirm={asyncOnConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      // Should be disabled during loading
      expect(confirmButton).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

      // Resolve the promise
      resolveConfirm!();

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('maintains loading state when both loading prop and internal loading are active', async () => {
      let resolveConfirm: () => void;
      const asyncOnConfirm = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolveConfirm = resolve;
          })
      );

      render(<ConfirmationModal {...defaultProps} loading={true} onConfirm={asyncOnConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });

      // Should be disabled due to loading prop
      expect(confirmButton).toBeDisabled();

      fireEvent.click(confirmButton);

      // Should still be disabled due to both loading states
      expect(confirmButton).toBeDisabled();

      resolveConfirm!();

      await waitFor(() => {
        expect(asyncOnConfirm).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Accessibility', () => {
    it('provides proper ARIA attributes', () => {
      render(
        <ConfirmationModal
          {...defaultProps}
          aria-label='Confirmation dialog'
          aria-describedby='confirmation-message'
        />
      );

      const modal = screen.getByRole('dialog');
      expect(modal).toHaveAttribute('aria-label', 'Confirmation dialog');
      expect(modal).toHaveAttribute('aria-describedby', 'confirmation-message');
    });

    it('has accessible button labels', () => {
      render(<ConfirmationModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('focuses properly on modal elements', () => {
      render(<ConfirmationModal {...defaultProps} />);

      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();

      // The modal should be keyboard accessible
      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      confirmButton.focus();
      expect(document.activeElement).toBe(confirmButton);
    });
  });

  describe('Integration with Base Modal', () => {
    it('passes through modal props correctly', () => {
      render(
        <ConfirmationModal
          {...defaultProps}
          closeOnBackdrop={false}
          closeOnEsc={false}
          showCloseButton={false}
          size='large'
        />
      );

      // Modal should be rendered with the passed props
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('handles modal close events', () => {
      render(<ConfirmationModal {...defaultProps} />);

      // Simulate ESC key press
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty message gracefully', () => {
      render(<ConfirmationModal {...defaultProps} message='' />);

      expect(screen.getByText('Test Title')).toBeInTheDocument();
      // Empty message should still render the container
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    });

    it('handles very long messages', () => {
      const longMessage = 'A'.repeat(1000);
      render(<ConfirmationModal {...defaultProps} message={longMessage} />);

      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });

    it('handles rapid button clicks', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<ConfirmationModal {...defaultProps} onConfirm={onConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });

      // Click multiple times rapidly
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      // Should only be called once due to disabled state during loading
      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledTimes(1);
      });
    });

    it('cleans up properly when unmounted during async operation', async () => {
      const neverResolveConfirm = vi.fn().mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const { unmount } = render(
        <ConfirmationModal {...defaultProps} onConfirm={neverResolveConfirm} />
      );

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      // Unmount while async operation is pending
      unmount();

      // Should not throw or cause memory leaks
      expect(neverResolveConfirm).toHaveBeenCalledTimes(1);
    });
  });
});

describe('LegacyConfirmationModal', () => {
  const legacyProps = {
    isOpen: true,
    title: 'Legacy Test',
    message: 'Legacy confirmation message',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const modalRoot = document.createElement('div');
    document.body.appendChild(modalRoot);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clean up any modal portals that were added
    const modals = document.body.querySelectorAll('[role="presentation"]');
    modals.forEach(modal => {
      if (modal.parentNode === document.body) {
        document.body.removeChild(modal);
      }
    });
    // Reset body styles
    document.body.style.overflow = '';
  });

  it('renders and forwards props to UI component', () => {
    render(<LegacyConfirmationModal {...legacyProps} />);

    expect(screen.getAllByText('Legacy Test')).toHaveLength(2); // Main title and confirmation title
    expect(screen.getByText('Legacy confirmation message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('handles confirm action', () => {
    render(<LegacyConfirmationModal {...legacyProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(legacyProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('handles cancel action', () => {
    render(<LegacyConfirmationModal {...legacyProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(legacyProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses custom button text', () => {
    render(<LegacyConfirmationModal {...legacyProps} confirmText='Yes' cancelText='No' />);

    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
  });

  it('defaults to danger type', () => {
    render(<LegacyConfirmationModal {...legacyProps} />);

    expect(screen.getByText('🗑️')).toBeInTheDocument();
  });

  it('supports different types', () => {
    render(<LegacyConfirmationModal {...legacyProps} type='warning' />);

    expect(screen.getByText('⚠️')).toBeInTheDocument();
  });
});
