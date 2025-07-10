#!/usr/bin/env node

/**
 * Security Improvements Implementation Script
 * 
 * This script demonstrates the recommended security improvements
 * for the Running App MVP based on the security audit.
 * 
 * Run with: node scripts/security-improvements.js
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

console.log('🔒 Running App MVP - Security Improvements');
console.log('=====================================\n');

// Check if running in a real project directory
const packageJsonPath = path.join(process.cwd(), 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error('❌ Please run this script from the project root directory');
  process.exit(1);
}

// 1. Generate secure secrets
console.log('1. 🔑 Generating secure secrets...');

const generateSecret = (length = 32) => {
  return crypto.randomBytes(length).toString('base64');
};

const jwtSecret = generateSecret(32);
const sessionSecret = generateSecret(32);

console.log('✅ JWT Secret generated (256-bit)');
console.log('✅ Session Secret generated (256-bit)');

// 2. Create .env.security template
console.log('\n2. 📄 Creating security environment template...');

const securityEnvTemplate = `# Security Environment Variables Template
# Copy to .env and update values for your environment

# JWT Configuration
JWT_SECRET=${jwtSecret}
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=7d
JWT_ALGORITHM=HS256

# Session Security
SESSION_SECRET=${sessionSecret}
SESSION_SECURE=true
SESSION_SAME_SITE=strict

# Password Security
BCRYPT_ROUNDS=12
PASSWORD_MIN_LENGTH=12

# Rate Limiting
RATE_LIMITING_ENABLED=true
AUTH_RATE_LIMIT_WINDOW=15
AUTH_RATE_LIMIT_MAX=5
API_RATE_LIMIT_WINDOW=15
API_RATE_LIMIT_MAX=100

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
CORS_CREDENTIALS=true

# Security Headers
CSP_ENABLED=true
HSTS_ENABLED=true
HSTS_MAX_AGE=31536000

# Database Security
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=true

# Monitoring & Logging
SECURITY_LOGGING_ENABLED=true
LOG_LEVEL=info
PII_HASHING_ENABLED=true

# Production Security
NODE_ENV=development
HTTPS_REDIRECT=false
`;

fs.writeFileSync('.env.security.template', securityEnvTemplate);
console.log('✅ Created .env.security.template');

// 3. Check current security implementation
console.log('\n3. 🔍 Auditing current security implementation...');

const auditResults = {
  jwtImplementation: false,
  passwordSecurity: false,
  rateLimiting: false,
  inputValidation: false,
  securityHeaders: false,
  cors: false
};

// Check for JWT implementation
const authFiles = [
  'middleware/requireAuth.js', 'middleware/requireAuth.ts',
  'routes/auth.js', 'routes/auth.ts'
];

for (const file of authFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('jwt') || content.includes('jsonwebtoken')) {
      auditResults.jwtImplementation = true;
      break;
    }
  }
}

// Check for password security
const authRouteFiles = ['routes/auth.js', 'routes/auth.ts'];
for (const file of authRouteFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('bcrypt')) {
      auditResults.passwordSecurity = true;
      break;
    }
  }
}

// Check for rate limiting
const rateLimitFiles = [
  'middleware/rateLimiting.js', 'middleware/rateLimiting.ts',
  'server.js', 'server.ts'
];

for (const file of rateLimitFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('rate-limit') || content.includes('rateLimit')) {
      auditResults.rateLimiting = true;
      break;
    }
  }
}

// Check for input validation
const validationFiles = [
  'middleware/validation.js', 'middleware/validation.ts',
  'routes/auth.js', 'routes/auth.ts'
];

for (const file of validationFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('zod') || content.includes('joi') || content.includes('validator')) {
      auditResults.inputValidation = true;
      break;
    }
  }
}

// Check for security headers
const serverFiles = ['server.js', 'server.ts'];
for (const file of serverFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('helmet') || content.includes('X-Frame-Options')) {
      auditResults.securityHeaders = true;
      break;
    }
  }
}

// Check for CORS
for (const file of serverFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('cors')) {
      auditResults.cors = true;
      break;
    }
  }
}

// Display audit results
console.log('\nSecurity Implementation Audit:');
Object.entries(auditResults).forEach(([feature, implemented]) => {
  const status = implemented ? '✅' : '❌';
  const featureName = feature.replace(/([A-Z])/g, ' $1').toLowerCase();
  console.log(`${status} ${featureName}`);
});

// 4. Generate security improvement recommendations
console.log('\n4. 💡 Security Improvement Recommendations...');

const recommendations = [];

if (!auditResults.securityHeaders) {
  recommendations.push({
    priority: 'HIGH',
    title: 'Install and configure Helmet.js',
    command: 'npm install helmet',
    description: 'Add comprehensive security headers to protect against common attacks'
  });
}

if (!auditResults.cors) {
  recommendations.push({
    priority: 'HIGH',
    title: 'Configure CORS properly',
    command: 'npm install cors',
    description: 'Restrict cross-origin requests to authorized domains only'
  });
}

recommendations.push({
  priority: 'CRITICAL',
  title: 'Update JWT configuration',
  description: 'Reduce token expiration from 7 days to 1 hour and implement refresh tokens'
});

recommendations.push({
  priority: 'HIGH',
  title: 'Strengthen password requirements',
  description: 'Increase minimum length to 12 characters and add complexity requirements'
});

recommendations.push({
  priority: 'MEDIUM',
  title: 'Implement token blacklisting',
  description: 'Add logout functionality and token revocation mechanism'
});

recommendations.push({
  priority: 'MEDIUM',
  title: 'Add security monitoring',
  description: 'Implement security event logging and failed attempt tracking'
});

// Display recommendations
console.log('\nPrioritized Security Improvements:');
recommendations.forEach((rec, index) => {
  const priorityIcon = rec.priority === 'CRITICAL' ? '🚨' : 
                      rec.priority === 'HIGH' ? '⚠️' : '💡';
  
  console.log(`\n${index + 1}. ${priorityIcon} ${rec.priority}: ${rec.title}`);
  console.log(`   ${rec.description}`);
  if (rec.command) {
    console.log(`   Command: ${rec.command}`);
  }
});

// 5. Create security test template
console.log('\n5. 🧪 Creating security test template...');

const securityTestTemplate = `import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';

describe('Security Tests', () => {
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
        '<img src="x" onerror="alert(\\'xss\\')">',
        '<svg onload="alert(\\'xss\\')"></svg>'
      ];
      
      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/runs')
          .set('Authorization', 'Bearer validtoken')
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
          .get(\`/api/runs?search=\${encodeURIComponent(payload)}\`)
          .set('Authorization', 'Bearer validtoken');

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
`;

fs.writeFileSync('tests/security.test.js', securityTestTemplate);
console.log('✅ Created tests/security.test.js');

// 6. Create security package.json scripts
console.log('\n6. 📦 Recommended package.json security scripts...');

const securityScripts = {
  'security:audit': 'npm audit --audit-level=moderate',
  'security:fix': 'npm audit fix',
  'security:test': 'vitest run tests/security.test.js',
  'security:scan': 'node scripts/security-scan.js',
  'security:headers': 'npm run test:security:headers',
  'security:dependencies': 'npm audit && npm run security:scan',
  'security:full': 'npm run security:dependencies && npm run security:test'
};

console.log('\nAdd these scripts to your package.json:');
console.log(JSON.stringify({ scripts: securityScripts }, null, 2));

// 7. Create security checklist
console.log('\n7. ✅ Creating security deployment checklist...');

const securityChecklist = `# Security Deployment Checklist

## Pre-Deployment Security Checks

### Environment & Configuration
- [ ] JWT_SECRET is cryptographically secure (32+ bytes, base64 encoded)
- [ ] PASSWORD_MIN_LENGTH is set to 12 or higher
- [ ] BCRYPT_ROUNDS is set to 12 or higher
- [ ] NODE_ENV is set to 'production'
- [ ] Database connection uses SSL/TLS
- [ ] CORS is configured for production domains only
- [ ] Rate limiting is enabled and properly configured

### Dependencies & Code
- [ ] All dependencies are up to date (\`npm audit\`)
- [ ] No known vulnerabilities in dependencies
- [ ] Security headers are implemented (Helmet.js)
- [ ] Input validation is comprehensive (Zod schemas)
- [ ] Error handling doesn't leak sensitive information
- [ ] No hardcoded secrets in source code

### Authentication & Authorization
- [ ] JWT tokens expire within 1 hour
- [ ] Refresh token mechanism is implemented
- [ ] Token blacklisting/revocation is functional
- [ ] Password complexity requirements are enforced
- [ ] Failed login attempts are rate limited
- [ ] Session security is properly configured

### Transport & Infrastructure
- [ ] HTTPS is enforced (HTTP redirects to HTTPS)
- [ ] Security headers are present in responses
- [ ] CSP (Content Security Policy) is configured
- [ ] HSTS (HTTP Strict Transport Security) is enabled
- [ ] Database connections use SSL
- [ ] File uploads (if any) are properly secured

### Monitoring & Logging
- [ ] Security events are logged
- [ ] PII is anonymized in logs
- [ ] Failed authentication attempts are monitored
- [ ] Rate limiting violations are logged
- [ ] Error rates are monitored
- [ ] Log retention policy is defined

### Testing
- [ ] Security test suite passes
- [ ] Authentication tests pass
- [ ] Input validation tests pass
- [ ] Rate limiting tests pass
- [ ] XSS prevention tests pass
- [ ] SQL injection prevention tests pass

## Post-Deployment Security Checks

### Runtime Verification
- [ ] HTTPS certificate is valid and properly configured
- [ ] Security headers are present in production responses
- [ ] Rate limiting is functional
- [ ] Authentication flow works correctly
- [ ] Error pages don't expose sensitive information

### Monitoring Setup
- [ ] Security event monitoring is active
- [ ] Failed login alerts are configured
- [ ] Rate limiting alerts are configured
- [ ] SSL certificate expiration monitoring
- [ ] Dependency vulnerability monitoring

### Documentation
- [ ] Security incident response plan is documented
- [ ] Security contact information is updated
- [ ] Security policy is published
- [ ] Team has access to security procedures

## Regular Security Maintenance

### Monthly
- [ ] Update dependencies (\`npm update\`)
- [ ] Review security audit (\`npm audit\`)
- [ ] Check for new vulnerabilities
- [ ] Review access logs for anomalies

### Quarterly
- [ ] Security configuration review
- [ ] Password policy effectiveness review
- [ ] Rate limiting effectiveness review
- [ ] Incident response plan review

### Annually
- [ ] Full security audit
- [ ] Penetration testing
- [ ] Security training for team
- [ ] Update security documentation
`;

fs.writeFileSync('SECURITY_CHECKLIST.md', securityChecklist);
console.log('✅ Created SECURITY_CHECKLIST.md');

// 8. Summary and next steps
console.log('\n8. 🎯 Summary and Next Steps...');

console.log('\n📋 Files Created:');
console.log('• .env.security.template - Environment variables template');
console.log('• tests/security.test.js - Security test suite');
console.log('• SECURITY_CHECKLIST.md - Deployment security checklist');

console.log('\n🚀 Immediate Next Steps:');
console.log('1. Copy .env.security.template to .env and update values');
console.log('2. Install recommended security packages:');
console.log('   npm install helmet');
console.log('3. Update JWT configuration to use 1-hour expiration');
console.log('4. Implement stronger password requirements');
console.log('5. Configure CORS for production domains');
console.log('6. Run security tests: npm run security:test');

console.log('\n🔒 Critical Security Actions:');
console.log('• Replace default JWT secret immediately');
console.log('• Configure CORS for production domains only');
console.log('• Add Helmet.js for security headers');
console.log('• Implement refresh token mechanism');
console.log('• Set up security monitoring and alerting');

console.log('\n✨ Security improvement script completed successfully!');
console.log('For detailed implementation guidance, see:');
console.log('• SECURITY.md - Security policy and procedures');
console.log('• docs/SECURITY_CONFIGURATION.md - Implementation guide');
console.log('• SECURITY_CHECKLIST.md - Deployment checklist');