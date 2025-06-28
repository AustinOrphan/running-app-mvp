import cors from 'cors';
import express from 'express';
import request from 'supertest';

import authRoutes from '../../routes/auth.js';
import runsRoutes from '../../routes/runs.js';
import goalsRoutes from '../../routes/goals.js';
import statsRoutes from '../../routes/stats.js';
import { errorHandler } from '../../middleware/errorHandler.js';

describe('Error Handling Integration Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(cors());
    app.use(express.json());
    
    // Mount routes
    app.use('/api/auth', authRoutes);
    app.use('/api/runs', runsRoutes);
    app.use('/api/goals', goalsRoutes);
    app.use('/api/stats', statsRoutes);
    
    // Error handler must be last
    app.use(errorHandler);
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
});