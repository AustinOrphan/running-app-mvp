import { ZodError } from 'zod';

/**
 * Error thrown when configuration validation fails.
 * Provides clear, actionable error messages for configuration issues.
 */
export class ConfigValidationError extends Error {
  public readonly issues: Array<{
    path: string[];
    message: string;
  }>;

  constructor(zodError: ZodError) {
    const formattedIssues = zodError.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
    }));

    const errorMessages = formattedIssues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');

    const message = `Config validation failed:\n${errorMessages}`;

    super(message);
    this.name = 'ConfigValidationError';
    this.issues = formattedIssues;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigValidationError);
    }
  }
}
