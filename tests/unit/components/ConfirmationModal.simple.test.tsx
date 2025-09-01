import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmationModal } from '../../../src/components/UI/Modal';
import { LegacyConfirmationModal } from '../../../src/components/ConfirmationModal';

// Mock CSS modules
vi.mock('../../../src/styles/components/Modal.module.css', () => ({
  default: {
    modal: 'modal',
    backdrop: 'backdrop',
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

describe('ConfirmationModal - Core Functionality', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Test Title',
    message: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders the confirmation message', () => {
      render(<ConfirmationModal {...defaultProps} />);
      expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
    });

    it('renders confirm and cancel buttons', () => {
      render(<ConfirmationModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('renders custom button text', () => {
      render(<ConfirmationModal {...defaultProps} confirmText='Delete' cancelText='Keep' />);
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    });
  });

  describe('Icon Types', () => {
    it('renders info icon by default', () => {
      render(<ConfirmationModal {...defaultProps} />);
      expect(screen.getByText('ℹ️')).toBeInTheDocument();
    });

    it('renders warning icon', () => {
      render(<ConfirmationModal {...defaultProps} type='warning' />);
      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });

    it('renders danger icon', () => {
      render(<ConfirmationModal {...defaultProps} type='danger' />);
      expect(screen.getByText('🗑️')).toBeInTheDocument();
    });

    it('renders success icon', () => {
      render(<ConfirmationModal {...defaultProps} type='success' />);
      expect(screen.getByText('✅')).toBeInTheDocument();
    });

    it('renders custom icon', () => {
      const customIcon = <span data-testid='custom-icon'>🎯</span>;
      render(<ConfirmationModal {...defaultProps} icon={customIcon} />);
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    });
  });

  describe('Button Interactions', () => {
    it('calls onConfirm when confirm button is clicked', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<ConfirmationModal {...defaultProps} onConfirm={onConfirm} />);

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<ConfirmationModal {...defaultProps} onCancel={onCancel} />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when cancel button is clicked', () => {
      render(<ConfirmationModal {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('handles async onConfirm functions', async () => {
      let resolvePromise: () => void;
      const asyncPromise = new Promise<void>(resolve => {
        resolvePromise = resolve;
      });
      const asyncOnConfirm = vi.fn().mockReturnValue(asyncPromise);

      render(<ConfirmationModal {...defaultProps} onConfirm={asyncOnConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      // Button should be disabled during async operation
      expect(confirmButton).toBeDisabled();

      // Resolve the promise
      resolvePromise!();

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('handles onConfirm errors gracefully', async () => {
      const errorOnConfirm = vi.fn().mockRejectedValue(new Error('Test error'));

      render(<ConfirmationModal {...defaultProps} onConfirm={errorOnConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(errorOnConfirm).toHaveBeenCalledTimes(1);
      });

      // Modal should not close on error
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });

  describe('Loading States', () => {
    it('disables buttons when loading', () => {
      render(<ConfirmationModal {...defaultProps} loading={true} />);

      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('shows loading during async confirm', async () => {
      let resolveConfirm: () => void;
      const asyncPromise = new Promise<void>(resolve => {
        resolveConfirm = resolve;
      });
      const asyncOnConfirm = vi.fn().mockReturnValue(asyncPromise);

      render(<ConfirmationModal {...defaultProps} onConfirm={asyncOnConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      expect(confirmButton).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

      resolveConfirm!();
      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles empty message', () => {
      render(<ConfirmationModal {...defaultProps} message='' />);
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    });

    it('handles rapid clicks', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<ConfirmationModal {...defaultProps} onConfirm={onConfirm} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });

      // Click multiple times rapidly
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      // Should only be called once due to loading state
      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledTimes(1);
      });
    });

    it('handles very long messages', () => {
      const longMessage = 'A'.repeat(500);
      render(<ConfirmationModal {...defaultProps} message={longMessage} />);
      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });
  });
});

describe('LegacyConfirmationModal - Wrapper Functionality', () => {
  const legacyProps = {
    isOpen: true,
    title: 'Legacy Test',
    message: 'Legacy confirmation message',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders confirmation message', () => {
    render(<LegacyConfirmationModal {...legacyProps} />);
    expect(screen.getByText('Legacy confirmation message')).toBeInTheDocument();
  });

  it('forwards onConfirm calls', () => {
    render(<LegacyConfirmationModal {...legacyProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(legacyProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('forwards onCancel calls', () => {
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
    expect(screen.getByText('🗑️')).toBeInTheDocument(); // Danger icon
  });

  it('supports different types', () => {
    render(<LegacyConfirmationModal {...legacyProps} type='warning' />);
    expect(screen.getByText('⚠️')).toBeInTheDocument(); // Warning icon
  });

  it('supports info type', () => {
    render(<LegacyConfirmationModal {...legacyProps} type='info' />);
    expect(screen.getByText('ℹ️')).toBeInTheDocument(); // Info icon
  });
});
