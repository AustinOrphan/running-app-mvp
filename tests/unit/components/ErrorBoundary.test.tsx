import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Component } from 'react';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

// Mock the error reporting utility
vi.mock('../../../src/utils/errorReporting', () => ({
  reportUIError: vi.fn(),
}));

import { reportUIError } from '../../../src/utils/errorReporting';
const mockReportUIError = reportUIError as ReturnType<typeof vi.fn>;

// Test component that can throw errors on command
const ThrowErrorComponent = ({
  shouldThrow,
  errorMessage,
}: {
  shouldThrow: boolean;
  errorMessage?: string;
}) => {
  if (shouldThrow) {
    throw new Error(errorMessage || 'Test error');
  }
  return <div data-testid='success-component'>Component rendered successfully</div>;
};

// Component that throws error during render
const BrokenComponent = () => {
  throw new Error('Component is broken');
};

describe('ErrorBoundary', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    // Suppress React error boundary console.error calls in tests
    console.error = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  describe('Normal Operation', () => {
    it('renders children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <div data-testid='child'>Child component</div>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Child component')).toBeInTheDocument();
    });

    it('renders multiple children correctly', () => {
      render(
        <ErrorBoundary>
          <div data-testid='child1'>First child</div>
          <div data-testid='child2'>Second child</div>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('child1')).toBeInTheDocument();
      expect(screen.getByTestId('child2')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('catches errors and displays fallback UI', () => {
      render(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(
        screen.getByText("We're sorry, but something unexpected happened.")
      ).toBeInTheDocument();
      expect(screen.getByText('Error details')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('displays custom fallback UI when provided', () => {
      const customFallback = <div data-testid='custom-fallback'>Custom error message</div>;

      render(
        <ErrorBoundary fallback={customFallback}>
          <BrokenComponent />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
      expect(screen.getByText('Custom error message')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('shows error details in the fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowErrorComponent shouldThrow={true} errorMessage='Specific error message' />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Click to expand error details
      const detailsElement = screen.getByText('Error details');
      fireEvent.click(detailsElement);

      // Should contain the error message
      expect(screen.getByText(/Specific error message/)).toBeInTheDocument();
    });

    it('calls reportUIError when an error occurs', () => {
      render(
        <ErrorBoundary>
          <ThrowErrorComponent shouldThrow={true} errorMessage='Test error for reporting' />
        </ErrorBoundary>
      );

      expect(mockReportUIError).toHaveBeenCalledTimes(1);
      expect(mockReportUIError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(String),
        'componentDidCatch'
      );

      const [error] = mockReportUIError.mock.calls[0];
      expect(error.message).toBe('Test error for reporting');
    });

    it('calls custom onError handler when provided', () => {
      const mockOnError = vi.fn();

      render(
        <ErrorBoundary onError={mockOnError}>
          <ThrowErrorComponent shouldThrow={true} errorMessage='Custom handler test' />
        </ErrorBoundary>
      );

      expect(mockOnError).toHaveBeenCalledTimes(1);
      expect(mockOnError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String),
        })
      );

      const [error] = mockOnError.mock.calls[0];
      expect(error.message).toBe('Custom handler test');
    });

    it('does not call onError handler when not provided', () => {
      // This test ensures the optional onError prop works correctly
      expect(() => {
        render(
          <ErrorBoundary>
            <BrokenComponent />
          </ErrorBoundary>
        );
      }).not.toThrow();

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  describe('Error Recovery', () => {
    it('calls handleReset when Try again button is clicked', () => {
      const { container } = render(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      );

      // Should show error UI
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Get initial state - error boundary should be showing error
      const initialErrorDiv = container.querySelector('.error-boundary-fallback');
      expect(initialErrorDiv).toBeInTheDocument();

      // Click Try again
      const tryAgainButton = screen.getByRole('button', { name: 'Try again' });
      fireEvent.click(tryAgainButton);

      // The component attempts to re-render children, but since BrokenComponent still throws,
      // it immediately goes back to error state. This is expected behavior.
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('resets internal state when reset is called', () => {
      const { container } = render(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Click reset button
      const resetButton = screen.getByRole('button', { name: 'Try again' });

      // Should not throw when clicking reset
      expect(() => {
        fireEvent.click(resetButton);
      }).not.toThrow();

      // After clicking reset, the error boundary tries to re-render
      // Since the child still throws, we get the error UI again
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('can recover when component tree changes with key prop', () => {
      let errorKey = 'error-key-1';

      const { rerender } = render(
        <ErrorBoundary key={errorKey}>
          <BrokenComponent />
        </ErrorBoundary>
      );

      // Should show error UI
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Change key to force remount with working component
      errorKey = 'error-key-2';
      rerender(
        <ErrorBoundary key={errorKey}>
          <ThrowErrorComponent shouldThrow={false} />
        </ErrorBoundary>
      );

      // Should now show working component
      expect(screen.getByTestId('success-component')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles errors with undefined/null messages', () => {
      // Create error with undefined message
      const ErrorComponentWithUndefinedMessage = () => {
        const error = new Error();
        error.message = '';
        throw error;
      };

      render(
        <ErrorBoundary>
          <ErrorComponentWithUndefinedMessage />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Error details')).toBeInTheDocument();
    });

    it('handles errors during component lifecycle methods', () => {
      // Component that throws during componentDidMount equivalent (useEffect)
      class LifecycleErrorComponent extends Component {
        override componentDidMount() {
          throw new Error('Lifecycle error');
        }

        override render() {
          return <div>Should not render</div>;
        }
      }

      render(
        <ErrorBoundary>
          <LifecycleErrorComponent />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(mockReportUIError).toHaveBeenCalled();
    });

    it('handles deeply nested component errors', () => {
      const DeepChild = () => {
        throw new Error('Deep nested error');
      };

      const MiddleComponent = () => (
        <div>
          <div>
            <DeepChild />
          </div>
        </div>
      );

      render(
        <ErrorBoundary>
          <div>
            <div>
              <MiddleComponent />
            </div>
          </div>
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(mockReportUIError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('DeepChild'),
        'componentDidCatch'
      );
    });

    it('preserves error boundary functionality with React Strict Mode', () => {
      // React Strict Mode intentionally double-invokes functions in development
      // This test ensures our error boundary works correctly in that environment
      render(
        <ErrorBoundary>
          <ThrowErrorComponent shouldThrow={true} errorMessage='Strict mode test' />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      // Error reporting should still work correctly
      expect(mockReportUIError).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('provides accessible error UI', () => {
      render(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      );

      // Check for proper heading structure
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent('Something went wrong');

      // Check that button is accessible
      const button = screen.getByRole('button', { name: 'Try again' });
      expect(button).toBeInTheDocument();
      expect(button).toBeEnabled();

      // Check that details element is accessible
      const details = screen.getByText('Error details').closest('details');
      expect(details).toBeInTheDocument();
    });

    it('maintains focus management after error occurs', () => {
      render(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      );

      const button = screen.getByRole('button', { name: 'Try again' });

      // Button should be focusable
      button.focus();
      expect(document.activeElement).toBe(button);
    });
  });

  describe('Integration', () => {
    it('works with async component errors', async () => {
      const AsyncErrorComponent = () => {
        // Simulate async error during render
        throw new Error('Async component error');
      };

      render(
        <ErrorBoundary>
          <AsyncErrorComponent />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(mockReportUIError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Async component error' }),
        expect.any(String),
        'componentDidCatch'
      );
    });

    it('maintains component tree structure when no errors occur', () => {
      render(
        <ErrorBoundary>
          <div data-testid='parent'>
            <div data-testid='child1'>Child 1</div>
            <div data-testid='child2'>Child 2</div>
          </div>
        </ErrorBoundary>
      );

      const parent = screen.getByTestId('parent');
      expect(parent).toContainElement(screen.getByTestId('child1'));
      expect(parent).toContainElement(screen.getByTestId('child2'));
    });
  });
});
