import { Request, Response, NextFunction } from 'express';
import { createError } from './errorHandler.js';

interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'date';
  min?: number;
  max?: number;
}

export const validateBody = (rules: ValidationRule[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const errors: string[] = [];

      for (const rule of rules) {
        const value = req.body[rule.field];

        if (rule.required && (value === undefined || value === null || value === '')) {
          errors.push(`${rule.field} is required`);
          continue;
        }

        if (value === undefined || value === null) {
          continue;
        }

        if (rule.type) {
          switch (rule.type) {
            case 'string':
              if (typeof value !== 'string') {
                errors.push(`${rule.field} must be a string`);
              }
              break;
            case 'number':
              if (typeof value !== 'number' && isNaN(Number(value))) {
                errors.push(`${rule.field} must be a number`);
              }
              break;
            case 'boolean':
              if (typeof value !== 'boolean') {
                errors.push(`${rule.field} must be a boolean`);
              }
              break;
            case 'date':
              if (isNaN(Date.parse(value))) {
                errors.push(`${rule.field} must be a valid date`);
              }
              break;
          }
        }

        if (rule.min !== undefined) {
          if (rule.type === 'number' && Number(value) < rule.min) {
            errors.push(`${rule.field} must be at least ${rule.min}`);
          } else if (rule.type === 'string' && value.length < rule.min) {
            errors.push(`${rule.field} must be at least ${rule.min} characters`);
          }
        }

        if (rule.max !== undefined) {
          if (rule.type === 'number' && Number(value) > rule.max) {
            errors.push(`${rule.field} must be at most ${rule.max}`);
          } else if (rule.type === 'string' && value.length > rule.max) {
            errors.push(`${rule.field} must be at most ${rule.max} characters`);
          }
        }
      }

      if (errors.length > 0) {
        throw createError(`Validation failed: ${errors.join(', ')}`, 400);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};