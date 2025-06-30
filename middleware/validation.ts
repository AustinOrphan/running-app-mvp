import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { createError } from './errorHandler.js';

/**
 * Enhanced validation middleware using Zod schemas
 * Provides comprehensive input validation, sanitization, and consistent error handling
 */

// Common validation patterns
const emailSchema = z.string().email('Invalid email format').toLowerCase().trim();
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');
const positiveNumberSchema = z.number().positive('Must be a positive number');
const dateSchema = z.string().refine(date => !isNaN(Date.parse(date)), 'Invalid date format');
const uuidSchema = z.string().uuid('Invalid ID format');

// Auth validation schemas
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

// Run validation schemas
export const createRunSchema = z.object({
  date: dateSchema,
  distance: positiveNumberSchema,
  duration: positiveNumberSchema,
  tag: z.string().trim().max(50, 'Tag must be 50 characters or less').optional().nullable(),
  notes: z.string().trim().max(1000, 'Notes must be 1000 characters or less').optional().nullable(),
  routeGeoJson: z.any().optional().nullable(), // GeoJSON validation would be complex, keeping flexible
});

export const updateRunSchema = z.object({
  date: dateSchema.optional(),
  distance: positiveNumberSchema.optional(),
  duration: positiveNumberSchema.optional(),
  tag: z.string().trim().max(50, 'Tag must be 50 characters or less').optional().nullable(),
  notes: z.string().trim().max(1000, 'Notes must be 1000 characters or less').optional().nullable(),
  routeGeoJson: z.any().optional().nullable(),
});

// Race validation schemas
export const createRaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  raceDate: dateSchema,
  distance: positiveNumberSchema,
  targetTime: positiveNumberSchema.optional(),
  actualTime: positiveNumberSchema.optional(),
  notes: z.string().trim().max(1000, 'Notes must be 1000 characters or less').optional().nullable(),
});

export const updateRaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or less').optional(),
  raceDate: dateSchema.optional(),
  distance: positiveNumberSchema.optional(),
  targetTime: positiveNumberSchema.optional(),
  actualTime: positiveNumberSchema.optional(),
  notes: z.string().trim().max(1000, 'Notes must be 1000 characters or less').optional().nullable(),
});

// Goal validation schemas
export const createGoalSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(100, 'Title must be 100 characters or less'),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or less')
      .optional()
      .nullable(),
    type: z.enum(['DISTANCE', 'TIME', 'FREQUENCY', 'PACE', 'LONGEST_RUN'], {
      errorMap: () => ({ message: 'Invalid goal type' }),
    }),
    period: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'], {
      errorMap: () => ({ message: 'Invalid goal period' }),
    }),
    targetValue: positiveNumberSchema,
    targetUnit: z
      .string()
      .trim()
      .min(1, 'Target unit is required')
      .max(20, 'Target unit must be 20 characters or less'),
    startDate: dateSchema,
    endDate: dateSchema,
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format')
      .optional()
      .nullable(),
    icon: z.string().trim().max(10, 'Icon must be 10 characters or less').optional().nullable(),
  })
  .refine(data => new Date(data.startDate) < new Date(data.endDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

export const updateGoalSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(100, 'Title must be 100 characters or less')
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or less')
      .optional()
      .nullable(),
    type: z
      .enum(['DISTANCE', 'TIME', 'FREQUENCY', 'PACE', 'LONGEST_RUN'], {
        errorMap: () => ({ message: 'Invalid goal type' }),
      })
      .optional(),
    period: z
      .enum(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'], {
        errorMap: () => ({ message: 'Invalid goal period' }),
      })
      .optional(),
    targetValue: positiveNumberSchema.optional(),
    targetUnit: z
      .string()
      .trim()
      .min(1, 'Target unit is required')
      .max(20, 'Target unit must be 20 characters or less')
      .optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format')
      .optional()
      .nullable(),
    icon: z.string().trim().max(10, 'Icon must be 10 characters or less').optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine(
    data => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) < new Date(data.endDate);
      }
      return true;
    },
    {
      message: 'End date must be after start date',
      path: ['endDate'],
    }
  );

// Parameter validation schemas
export const idParamSchema = z.object({
  id: uuidSchema,
});

// Query parameter schemas
export const statsQuerySchema = z.object({
  period: z.enum(['1m', '3m', '6m', '1y']).optional().default('3m'),
});

/**
 * Generic validation middleware factory
 */
export function validateRequest<T>(
  schema: ZodSchema<T>,
  target: 'body' | 'params' | 'query' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const dataToValidate = req[target];
      const result = schema.safeParse(dataToValidate);

      if (!result.success) {
        const errorMessages = result.error.issues.map(issue => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'field';
          return `${path}: ${issue.message}`;
        });

        throw createError(`Validation failed: ${errorMessages.join(', ')}`, 400);
      }

      // Replace the original data with parsed/sanitized data
      (req as Request & Record<string, unknown>)[target] = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Specific validation middleware functions for common use cases
 */

// Body validation
export const validateBody = <T>(schema: ZodSchema<T>) => validateRequest(schema, 'body');
export const validateParams = <T>(schema: ZodSchema<T>) => validateRequest(schema, 'params');
export const validateQuery = <T>(schema: ZodSchema<T>) => validateRequest(schema, 'query');

// Pre-defined middleware for common schemas
export const validateRegister = validateBody(registerSchema);
export const validateLogin = validateBody(loginSchema);
export const validateCreateRun = validateBody(createRunSchema);
export const validateUpdateRun = validateBody(updateRunSchema);
export const validateCreateGoal = validateBody(createGoalSchema);
export const validateUpdateGoal = validateBody(updateGoalSchema);
export const validateCreateRace = validateBody(createRaceSchema);
export const validateUpdateRace = validateBody(updateRaceSchema);
export const validateIdParam = validateParams(idParamSchema);
export const validateStatsQuery = validateQuery(statsQuerySchema);

/**
 * Input sanitization middleware
 * Removes potentially dangerous characters and normalizes input
 */
export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Sanitize body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }

    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query) as typeof req.query;
    }

    next();
  } catch {
    next(createError('Input sanitization failed', 400));
  }
};

/**
 * Recursively sanitize an object
 */
function sanitizeObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Sanitize a string by removing/escaping dangerous characters
 */
function sanitizeString(str: string): string {
  if (typeof str !== 'string') return str;

  return (
    str
      .trim()
      // Remove null bytes
      .replace(/\0/g, '')
      // Remove control characters except tabs, newlines, and carriage returns
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize unicode
      .normalize('NFKC')
  );
}

/**
 * Security headers middleware
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  next();
};
