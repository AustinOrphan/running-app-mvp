import express from 'express';
import request from 'supertest';
import { validateBody } from '../../../server/middleware/validateBody.js';
import { errorHandler } from '../../../server/middleware/errorHandler.js';
import type { Request, Response, NextFunction } from 'express';

describe('ValidateBody Middleware', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('Basic validation', () => {
    const userRules = [
      { field: 'name', required: true, type: 'string' as const, min: 1 },
      { field: 'email', required: true, type: 'string' as const },
      { field: 'age', required: true, type: 'number' as const, min: 1 },
    ];

    beforeEach(() => {
      app.post('/user', validateBody(userRules), (req: Request, res: Response) => {
        res.json({ success: true, data: req.body });
      });
      app.use(errorHandler);
    });

    it('passes valid data through', async () => {
      const validData = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 25,
      };

      const response = await request(app).post('/user').send(validData).expect(200);

      expect(response.body).toEqual({
        success: true,
        data: validData,
      });
    });

    it('rejects missing required fields', async () => {
      const incompleteData = {
        name: 'John Doe',
        age: 25,
      };

      const response = await request(app).post('/user').send(incompleteData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('email is required');
    });

    it('rejects wrong data types', async () => {
      const wrongTypeData = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 'twenty-five',
      };

      const response = await request(app).post('/user').send(wrongTypeData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('age must be a number');
    });

    it('validates string type', async () => {
      const invalidData = {
        name: 123,
        email: 'john@example.com',
        age: 25,
      };

      const response = await request(app).post('/user').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('name must be a string');
    });

    it('validates minimum string length', async () => {
      const invalidData = {
        name: '',
        email: 'john@example.com',
        age: 25,
      };

      const response = await request(app).post('/user').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      // Empty string is treated as required error, not length error
      expect(response.body.message).toContain('name is required');
    });

    it('validates minimum number value', async () => {
      const invalidData = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 0,
      };

      const response = await request(app).post('/user').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('age must be at least 1');
    });
  });

  describe('Type validation', () => {
    const typeRules = [
      { field: 'stringField', required: true, type: 'string' as const },
      { field: 'numberField', required: true, type: 'number' as const },
      { field: 'booleanField', required: true, type: 'boolean' as const },
      { field: 'dateField', required: true, type: 'date' as const },
    ];

    beforeEach(() => {
      app.post('/types', validateBody(typeRules), (req: Request, res: Response) => {
        res.json({ success: true });
      });
      app.use(errorHandler);
    });

    it('validates all types correctly', async () => {
      const validData = {
        stringField: 'hello',
        numberField: 42,
        booleanField: true,
        dateField: '2023-01-01',
      };

      const response = await request(app).post('/types').send(validData).expect(200);

      expect(response.body.success).toBe(true);
    });

    it('rejects invalid string type', async () => {
      const invalidData = {
        stringField: 123,
        numberField: 42,
        booleanField: true,
        dateField: '2023-01-01',
      };

      const response = await request(app).post('/types').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('stringField must be a string');
    });

    it('rejects invalid boolean type', async () => {
      const invalidData = {
        stringField: 'hello',
        numberField: 42,
        booleanField: 'yes',
        dateField: '2023-01-01',
      };

      const response = await request(app).post('/types').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('booleanField must be a boolean');
    });

    it('rejects invalid date format', async () => {
      const invalidData = {
        stringField: 'hello',
        numberField: 42,
        booleanField: true,
        dateField: 'not-a-date',
      };

      const response = await request(app).post('/types').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('dateField must be a valid date');
    });
  });

  describe('Min/Max validation', () => {
    const rangeRules = [
      { field: 'username', required: true, type: 'string' as const, min: 3, max: 20 },
      { field: 'age', required: true, type: 'number' as const, min: 18, max: 100 },
      { field: 'bio', required: false, type: 'string' as const, max: 500 },
    ];

    beforeEach(() => {
      app.post('/register', validateBody(rangeRules), (req: Request, res: Response) => {
        res.json({ success: true });
      });
      app.use(errorHandler);
    });

    it('validates string length constraints', async () => {
      const invalidData = {
        username: 'ab', // too short
        age: 25,
        bio: 'Valid bio',
      };

      const response = await request(app).post('/register').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('username must be at least 3 characters');
    });

    it('validates string max length', async () => {
      const longUsername = 'a'.repeat(25);
      const invalidData = {
        username: longUsername,
        age: 25,
      };

      const response = await request(app).post('/register').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('username must be at most 20 characters');
    });

    it('validates number min constraint', async () => {
      const invalidData = {
        username: 'validuser',
        age: 16, // too young
      };

      const response = await request(app).post('/register').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('age must be at least 18');
    });

    it('validates number max constraint', async () => {
      const invalidData = {
        username: 'validuser',
        age: 150, // too old
      };

      const response = await request(app).post('/register').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('age must be at most 100');
    });
  });

  describe('Edge cases', () => {
    const rules = [{ field: 'required', required: true, type: 'string' as const }];

    beforeEach(() => {
      app.post('/test', validateBody(rules), (req: Request, res: Response) => {
        res.json({ success: true });
      });
      app.use(errorHandler);
    });

    it('handles empty body', async () => {
      const response = await request(app).post('/test').send({}).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('required is required');
    });

    it('handles null body', async () => {
      const response = await request(app).post('/test').type('json').send('null').expect(400);

      expect(response.body.error).toBe(true);
      // Null JSON causes a parsing error before reaching validation
      expect(response.body.message).toContain('not valid JSON');
    });

    it('handles fields with null values', async () => {
      const response = await request(app).post('/test').send({ required: null }).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('required is required');
    });

    it('handles fields with undefined values', async () => {
      const response = await request(app).post('/test').send({ required: undefined }).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('required is required');
    });

    it('handles fields with empty string values for required fields', async () => {
      const response = await request(app).post('/test').send({ required: '' }).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('required is required');
    });
  });

  describe('Optional fields', () => {
    const optionalRules = [
      { field: 'name', required: true, type: 'string' as const },
      { field: 'email', required: false, type: 'string' as const },
      { field: 'age', required: false, type: 'number' as const, min: 18 },
    ];

    beforeEach(() => {
      app.post('/optional', validateBody(optionalRules), (req: Request, res: Response) => {
        res.json({ success: true, data: req.body });
      });
      app.use(errorHandler);
    });

    it('allows optional fields to be omitted', async () => {
      const data = {
        name: 'John Doe',
      };

      const response = await request(app).post('/optional').send(data).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({ name: 'John Doe' });
    });

    it('validates optional fields when provided', async () => {
      const data = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 25,
      };

      const response = await request(app).post('/optional').send(data).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(data);
    });

    it('validates optional field constraints when provided', async () => {
      const data = {
        name: 'John Doe',
        age: 16, // below minimum
      };

      const response = await request(app).post('/optional').send(data).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('age must be at least 18');
    });
  });

  describe('Number string conversion', () => {
    const numberConversionRules = [
      { field: 'stringNumber', required: true, type: 'number' as const },
    ];

    beforeEach(() => {
      app.post('/convert', validateBody(numberConversionRules), (req: Request, res: Response) => {
        res.json({ success: true, data: req.body });
      });
      app.use(errorHandler);
    });

    it('accepts numeric strings for number validation', async () => {
      const data = {
        stringNumber: '42',
      };

      const response = await request(app).post('/convert').send(data).expect(200);

      expect(response.body.success).toBe(true);
    });

    it('accepts actual numbers', async () => {
      const data = {
        stringNumber: 42,
      };

      const response = await request(app).post('/convert').send(data).expect(200);

      expect(response.body.success).toBe(true);
    });

    it('rejects non-numeric strings', async () => {
      const data = {
        stringNumber: 'not-a-number',
      };

      const response = await request(app).post('/convert').send(data).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('stringNumber must be a number');
    });
  });

  describe('Multiple middleware instances', () => {
    it('can use different rules for different routes', async () => {
      const userRules = [{ field: 'name', required: true, type: 'string' as const }];
      const productRules = [
        { field: 'title', required: true, type: 'string' as const },
        { field: 'price', required: true, type: 'number' as const },
      ];

      app.post('/user', validateBody(userRules), (req: Request, res: Response) => {
        res.json({ type: 'user', data: req.body });
      });

      app.post('/product', validateBody(productRules), (req: Request, res: Response) => {
        res.json({ type: 'product', data: req.body });
      });

      app.use(errorHandler);

      // Test user endpoint
      const userResponse = await request(app).post('/user').send({ name: 'John' }).expect(200);

      expect(userResponse.body.type).toBe('user');

      // Test product endpoint
      const productResponse = await request(app)
        .post('/product')
        .send({ title: 'Widget', price: 9.99 })
        .expect(200);

      expect(productResponse.body.type).toBe('product');

      // Test wrong data on user endpoint
      const wrongResponse = await request(app)
        .post('/user')
        .send({ title: 'Widget', price: 9.99 })
        .expect(400);

      expect(wrongResponse.body.error).toBe(true);
      expect(wrongResponse.body.message).toContain('name is required');
    });
  });

  describe('Error handler integration', () => {
    it('passes errors to next middleware', async () => {
      const rules = [{ field: 'required', required: true, type: 'string' as const }];
      let errorHandlerCalled = false;

      app.post('/test', validateBody(rules), (req: Request, res: Response) => {
        res.json({ success: true });
      });

      // Custom error handler
      app.use(
        (err: Error & { statusCode?: number }, req: Request, res: Response, next: NextFunction) => {
          errorHandlerCalled = true;
          res.status(err.statusCode || 500).json({
            customError: true,
            message: err.message,
          });
        }
      );

      const response = await request(app).post('/test').send({}).expect(400);

      expect(errorHandlerCalled).toBe(true);
      expect(response.body.customError).toBe(true);
      expect(response.body.message).toContain('required is required');
    });
  });

  describe('Multiple validation errors', () => {
    const multipleRules = [
      { field: 'name', required: true, type: 'string' as const, min: 2 },
      { field: 'age', required: true, type: 'number' as const, min: 18 },
      { field: 'email', required: true, type: 'string' as const },
    ];

    beforeEach(() => {
      app.post('/multiple', validateBody(multipleRules), (req: Request, res: Response) => {
        res.json({ success: true });
      });
      app.use(errorHandler);
    });

    it('reports all validation errors in a single message', async () => {
      const invalidData = {
        name: 'A', // too short
        age: 16, // too young
        email: 123, // wrong type
      };

      const response = await request(app).post('/multiple').send(invalidData).expect(400);

      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('name must be at least 2 characters');
      expect(response.body.message).toContain('age must be at least 18');
      expect(response.body.message).toContain('email must be a string');
    });
  });
});
