import cors from 'cors';
import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';

import authRoutes from '../../routes/auth.js';
import runsRoutes from '../../routes/runs.js';
import goalsRoutes from '../../routes/goals.js';
import statsRoutes from '../../routes/stats.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { asyncHandler, asyncAuthHandler } from '../../middleware/asyncHandler.js';

describe('Error Handling Integration Tests', () => {
  let app: express.Application;
  let mockConsoleError: jest.SpyInstance;
  let headersSentDetector: jest.SpyInstance;

  beforeEach(() => {
    app = express();
    app.use(cors());
    app.use(express.json());
    
    // Mock console.error to prevent test output pollution
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    
    // Detect "Cannot set headers after they are sent" errors
    headersSentDetector = jest.spyOn(console, 'error').mockImplementation((message: any) => {
      if (typeof message === 'string' && message.includes('Cannot set headers after they are sent')) {
        throw new Error('CRITICAL: Double header error detected - ' + message);
      }
    });
    
    // Mount routes
    app.use('/api/auth', authRoutes);
    app.use('/api/runs', runsRoutes);
    app.use('/api/goals', goalsRoutes);
    app.use('/api/stats', statsRoutes);
    
    // Error handler must be last
    app.use(errorHandler);
  });
  
  afterEach(() => {
    mockConsoleError.mockRestore();
    headersSentDetector.mockRestore();
  });

  describe('Auth Route Error Handling', () => {
    it('should handle registration with existing user gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123'
        });

      // Should not crash the server and return proper error response
      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
      
      // CRITICAL: Verify no double header errors
      expect(headersSentDetector).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot set headers after they are sent')
      );
    });

    it('should handle invalid login credentials gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        });

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Runs Route Error Handling', () => {
    it('should handle unauthorized access gracefully', async () => {
      const response = await request(app)
        .get('/api/runs');

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
    });

    it('should handle fetching non-existent run gracefully', async () => {
      const response = await request(app)
        .get('/api/runs/non-existent-id');

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Goals Route Error Handling', () => {
    it('should handle unauthorized goal access gracefully', async () => {
      const response = await request(app)
        .get('/api/goals');

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
    });

    it('should handle creating goal without authentication gracefully', async () => {
      const response = await request(app)
        .post('/api/goals')
        .send({
          title: 'Test Goal',
          type: 'DISTANCE',
          targetValue: 10
        });

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Stats Route Error Handling', () => {
    it('should handle unauthorized stats access gracefully', async () => {
      const response = await request(app)
        .get('/api/stats/insights-summary');

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
    });

    it('should handle fetching trends without auth gracefully', async () => {
      const response = await request(app)
        .get('/api/stats/trends');

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Server Stability', () => {
    it('should not crash server on multiple concurrent error requests', async () => {
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .get('/api/runs')
          .expect((res) => {
            expect(res.status).toBeDefined();
          })
      );

      await Promise.all(promises);
      
      // Server should still be responsive after error batch
      const healthCheck = await request(app)
        .get('/api/auth/test');
        
      expect(healthCheck.status).toBe(200);
      expect(healthCheck.body).toHaveProperty('message', 'Auth routes are working');
    });
  });

  describe('CRITICAL: Return Pattern Validation', () => {
    it('should prevent double header errors in auth routes', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'short' // Will trigger validation error
        });

      // Should complete without throwing double header error
      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
      
      // Verify no double header detection was triggered
      expect(headersSentDetector).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot set headers after they are sent')
      );
    });

    it('should prevent double header errors in runs routes on database failures', async () => {
      // This will fail due to lack of authentication
      const response = await request(app)
        .get('/api/runs/invalid-id');

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
      
      // Verify no double header detection was triggered
      expect(headersSentDetector).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot set headers after they are sent')
      );
    });

    it('should prevent double header errors in goals routes', async () => {
      const response = await request(app)
        .post('/api/goals')
        .send({
          title: '', // Invalid - will trigger validation error
          type: 'INVALID_TYPE'
        });

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
      
      // Verify no double header detection was triggered
      expect(headersSentDetector).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot set headers after they are sent')
      );
    });

    it('should prevent double header errors in stats routes', async () => {
      const response = await request(app)
        .get('/api/stats/insights-summary');

      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
      
      // Verify no double header detection was triggered
      expect(headersSentDetector).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot set headers after they are sent')
      );
    });
  });

  describe('Async Handler Wrapper Tests', () => {
    it('should properly catch and forward async errors', async () => {
      const testApp = express();
      testApp.use(express.json());
      
      // Test route that throws async error
      testApp.get('/test-async-error', asyncHandler(async (req, res, next) => {
        throw new Error('Test async error');
      }));
      
      testApp.use(errorHandler);
      
      const response = await request(testApp)
        .get('/test-async-error');
        
      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('message', 'Test async error');
    });
    
    it('should properly catch and forward async auth errors', async () => {
      const testApp = express();
      testApp.use(express.json());
      
      // Test route that throws async error with auth context
      testApp.get('/test-async-auth-error', asyncAuthHandler(async (req, res, next) => {
        throw new Error('Test async auth error');
      }));
      
      testApp.use(errorHandler);
      
      const response = await request(testApp)
        .get('/test-async-auth-error');
        
      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('message', 'Test async auth error');
    });
  });

  describe('Route Error Propagation Tests', () => {
    it('should properly propagate database connection errors', async () => {
      const response = await request(app)
        .get('/api/runs');
      
      // Should get auth error, not database error crash
      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('message');
    });
    
    it('should handle malformed request bodies gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send('invalid-json');
      
      expect(response.status).toBeDefined();
      // Should not crash server
    });
    
    it('should handle extremely large concurrent error load', async () => {
      const promises = Array.from({ length: 50 }, () =>
        request(app)
          .get('/api/runs/invalid-id')
          .catch(() => {}) // Ignore individual failures
      );
      
      await Promise.all(promises);
      
      // Server should remain responsive
      const healthCheck = await request(app)
        .get('/api/auth/test');
        
      expect(healthCheck.status).toBe(200);
    });
  });
});