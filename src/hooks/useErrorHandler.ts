// Custom hook for component-level error handling
import { useCallback } from 'react';
import { reportUIError, reportValidationError, ErrorCategory } from '../utils/errorReporting';

export const useErrorHandler = (componentName: string) => {
  const handleError = useCallback((error: Error, action?: string) => {
    reportUIError(error, componentName, action);
  }, [componentName]);

  const handleValidationError = useCallback((field: string, message: string, value?: unknown) => {
    const error = new Error(`Validation failed for ${field}: ${message}`);
    reportValidationError(error, field, value);
  }, []);

  const handleAsyncError = useCallback(async <T,>(
    asyncFn: () => Promise<T>,
    action: string
  ): Promise<T | null> => {
    try {
      return await asyncFn();
    } catch (error) {
      handleError(error as Error, action);
      return null;
    }
  }, [handleError]);

  return {
    handleError,
    handleValidationError,
    handleAsyncError,
  };
};