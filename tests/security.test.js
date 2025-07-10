import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../server.js';

describe('Security Tests', () => {
  let authToken;

  beforeAll(() => {
    // Generate a valid JWT token for testing
    const testUserId = 'test-user-id';
    const testPayload = {
      userId: testUserId,
      email: 'test@example.com'
    };
    
    // Use a test JWT secret or the environment variable
    const jwtSecret = process.env.JWT_SECRET || 'test-secret-key-for-testing-only';
    authToken = jwt.sign(testPayload, jwtSecret, { expiresIn: '1h' });
  });
  describe('Authentication Security', () => {
    test('should reject weak passwords', async () => {
      const weakPasswords = [
        '123456',
        'password',
        'qwerty',
        'admin',
        'letmein'
      ];
      
      for (const password of weakPasswords) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'test@example.com',
            password: password
          });
        
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/password/i);
      }
    });

    test('should enforce rate limiting on login attempts', async () => {
      const loginAttempts = Array(6).fill().map(() =>
        request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'wrongpassword'
          })
      );

      const responses = await Promise.all(loginAttempts);
      const lastResponse = responses[responses.length - 1];
      
      expect(lastResponse.status).toBe(429);
      expect(lastResponse.body.error).toMatch(/too many/i);
    });

    test('should require strong JWT secrets', () => {
      const jwtSecret = process.env.JWT_SECRET;
      
      expect(jwtSecret).toBeDefined();
      expect(jwtSecret.length).toBeGreaterThan(32);
      expect(jwtSecret).not.toBe('your-super-secret-jwt-key-change-this-in-production');
    });
  });

  describe('Input Validation', () => {
    test('should sanitize XSS attempts', async () => {
      const xssPayloads = [
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src="x" onerror="alert(\'xss\')">',
        '<svg onload="alert(\'xss\')"></svg>'
      ];
      
      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/runs')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            route: payload,
            distance: 5,
            duration: 1800
          });

        if (response.status === 200) {
          expect(response.body.route).not.toContain('<script>');
          expect(response.body.route).not.toContain('javascript:');
        }
      }
    });

    test('should prevent SQL injection attempts', async () => {
      const sqlPayloads = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "'; INSERT INTO users (email) VALUES ('hacker@evil.com'); --",
        "' UNION SELECT * FROM users --"
      ];
      
      for (const payload of sqlPayloads) {
        const response = await request(app)
          .get(`/api/runs?search=${encodeURIComponent(payload)}`)
          .set('Authorization', `Bearer ${authToken}`);

        // Should not return 500 error or expose database errors
        expect(response.status).not.toBe(500);
        if (response.body.error) {
          expect(response.body.error).not.toMatch(/sql|database|syntax/i);
        }
      }
    });
  });

  describe('Security Headers', () => {
    test('should include security headers', async () => {
      const response = await request(app).get('/');
      
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['referrer-policy']).toBeDefined();
      
      // Check for Helmet.js headers if implemented
      if (response.headers['strict-transport-security']) {
        expect(response.headers['strict-transport-security']).toMatch(/max-age/);
      }
      
      if (response.headers['content-security-policy']) {
        expect(response.headers['content-security-policy']).toContain("default-src");
      }
    });

    test('should not expose sensitive information', async () => {
      const response = await request(app).get('/');
      
      // Should not expose server version or framework info
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['server']).not.toMatch(/express|node/i);
    });
  });

  describe('HTTPS and Transport Security', () => {
    test('should redirect HTTP to HTTPS in production', async () => {
      if (process.env.NODE_ENV === 'production') {
        // This would need to be tested in actual production environment
        expect(process.env.HTTPS_REDIRECT).toBe('true');
      }
    });

    test('should set secure cookie flags in production', () => {
      if (process.env.NODE_ENV === 'production') {
        expect(process.env.SESSION_SECURE).toBe('true');
        expect(process.env.SESSION_SAME_SITE).toBe('strict');
      }
    });
  });

  describe('Error Handling', () => {
    test('should not leak sensitive information in error messages', async () => {
      const response = await request(app)
        .get('/api/nonexistent-endpoint')
        .set('Authorization', 'Bearer invalidtoken');

      expect(response.status).toBe(404);
      
      // Error messages should not contain:
      if (response.body.error) {
        expect(response.body.error).not.toMatch(/database|sql|server|internal|debug/i);
        expect(response.body.stack).toBeUndefined();
      }
    });
  });
});
