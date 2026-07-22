import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ConfigValidationError } from '../src/errors.js';

describe('ConfigValidationError', () => {
  it('should format single error message correctly', () => {
    const schema = z.object({
      port: z.number(),
    });

    const result = schema.safeParse({ port: 'invalid' });
    if (!result.success) {
      const error = new ConfigValidationError(result.error);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error.name).toBe('ConfigValidationError');
      expect(error.message).toContain('Config validation failed');
      expect(error.message).toContain('port');
      expect(error.issues).toHaveLength(1);
      expect(error.issues[0].path).toEqual(['port']);
    }
  });

  it('should format multiple error messages correctly', () => {
    const schema = z.object({
      port: z.number(),
      host: z.string().min(5),
    });

    const result = schema.safeParse({ port: 'invalid', host: 'abc' });
    if (!result.success) {
      const error = new ConfigValidationError(result.error);

      expect(error.message).toContain('Config validation failed');
      expect(error.message).toContain('port');
      expect(error.message).toContain('host');
      expect(error.issues).toHaveLength(2);
    }
  });

  it('should format nested path correctly', () => {
    const schema = z.object({
      database: z.object({
        url: z.string().url(),
      }),
    });

    const result = schema.safeParse({ database: { url: 'invalid' } });
    if (!result.success) {
      const error = new ConfigValidationError(result.error);

      expect(error.message).toContain('database.url');
      expect(error.issues[0].path).toEqual(['database', 'url']);
    }
  });

  it('should handle missing required field', () => {
    const schema = z.object({
      required: z.string(),
    });

    const result = schema.safeParse({});
    if (!result.success) {
      const error = new ConfigValidationError(result.error);

      expect(error.message).toContain('Config validation failed');
      expect(error.message).toContain('required');
      expect(error.issues[0].path).toEqual(['required']);
    }
  });

  it('should maintain stack trace', () => {
    const schema = z.object({
      test: z.string(),
    });

    const result = schema.safeParse({ test: 123 });
    if (!result.success) {
      const error = new ConfigValidationError(result.error);

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ConfigValidationError');
    }
  });
});
