import {
  validateRequest,
  validateBody,
  validateParams,
  validateQuery,
  sanitizeInput,
  securityHeaders,
  // Pre-defined validators
  validateRegister,
  validateLogin,
  validateCreateRun,
  validateUpdateRun,
  validateCreateGoal,
  validateUpdateGoal,
  validateCreateRace,
  validateUpdateRace,
  validateIdParam,
  validateStatsQuery,
  // Schemas
  registerSchema,
  loginSchema,
  createRunSchema,
  updateRunSchema,
  createGoalSchema,
  updateGoalSchema,
  createRaceSchema,
  updateRaceSchema,
  idParamSchema,
  statsQuerySchema,
} from '../../../server/middleware/validation.js';
import express from 'express';
import request from 'supertest';
import type { Request, Response } from 'express';

describe('Validation Middleware', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(securityHeaders);
  });

  describe('validateBody', () => {
    beforeEach(() => {
      app.post('/test-register', validateRegister, (req: Request, res: Response) => {
        res.json({ success: true, data: req.body });
      });
    });

    it('should pass valid registration data', async () => {
      const validData = {
        email: 'test@example.com',
        password: 'ValidPassword123!',
        name: 'Test User',
      };

      const response = await request(app).post('/test-register').send(validData).expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject invalid email', async () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'ValidPassword123!',
        name: 'Test User',
      };

      await request(app).post('/test-register').send(invalidData).expect(400);
    });

    it('should reject weak password', async () => {
      const invalidData = {
        email: 'test@example.com',
        password: '123',
        name: 'Test User',
      };

      await request(app).post('/test-register').send(invalidData).expect(400);
    });
  });

  describe('validateLogin', () => {
    beforeEach(() => {
      app.post('/test-login', validateLogin, (req: Request, res: Response) => {
        res.json({ success: true, data: req.body });
      });
    });

    it('should pass valid login data', async () => {
      const validData = {
        email: 'test@example.com',
        password: 'ValidPassword123!',
      };

      const response = await request(app).post('/test-login').send(validData).expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject missing email', async () => {
      const invalidData = {
        password: 'ValidPassword123!',
      };

      await request(app).post('/test-login').send(invalidData).expect(400);
    });
  });

  describe('validateCreateRun', () => {
    beforeEach(() => {
      app.post('/test-run', validateCreateRun, (req: Request, res: Response) => {
        res.json({ success: true, data: req.body });
      });
    });

    it('should pass valid run data', async () => {
      const validData = {
        distance: 5.0,
        duration: 1800,
        date: '2024-01-01',
        pace: '06:00',
      };

      const response = await request(app).post('/test-run').send(validData).expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject negative distance', async () => {
      const invalidData = {
        distance: -1,
        duration: 1800,
        date: '2024-01-01',
        pace: '06:00',
      };

      await request(app).post('/test-run').send(invalidData).expect(400);
    });
  });

  describe('validateParams', () => {
    beforeEach(() => {
      app.get('/test-id/:id', validateIdParam, (req: Request, res: Response) => {
        res.json({ success: true, id: req.params.id });
      });
    });

    it('should pass valid numeric ID', async () => {
      const response = await request(app).get('/test-id/123').expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject non-numeric ID', async () => {
      await request(app).get('/test-id/abc').expect(400);
    });
  });

  describe('sanitizeInput', () => {
    beforeEach(() => {
      app.post('/test-sanitize', sanitizeInput, (req: Request, res: Response) => {
        res.json({ success: true, data: req.body });
      });
    });

    it('should sanitize malicious input', async () => {
      const maliciousData = {
        name: '<script>alert("xss")</script>Test User',
        description: 'Test & description',
      };

      const response = await request(app).post('/test-sanitize').send(maliciousData).expect(200);

      // Should have sanitized the script tag
      expect(response.body.data.name).not.toContain('<script>');
    });
  });

  describe('Security Headers', () => {
    beforeEach(() => {
      app.get('/test-headers', (req: Request, res: Response) => {
        res.json({ success: true });
      });
    });

    it('should add security headers', async () => {
      const response = await request(app).get('/test-headers').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });
  });

  describe('Schema Validation', () => {
    it('should validate register schema directly', () => {
      const validData = {
        email: 'test@example.com',
        password: 'ValidPassword123!',
        name: 'Test User',
      };

      const result = registerSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid register data', () => {
      const invalidData = {
        email: 'invalid-email',
        password: '123',
        name: '',
      };

      const result = registerSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should validate run schema directly', () => {
      const validData = {
        distance: 5.0,
        duration: 1800,
        date: '2024-01-01',
        pace: '06:00',
      };

      const result = createRunSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate goal schema directly', () => {
      const validData = {
        type: 'distance',
        target: 100,
        period: 'weekly',
        description: 'Run 100km per week',
      };

      const result = createGoalSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });
});
