# Troubleshooting Guide

This comprehensive guide covers common issues encountered during development, testing, and deployment of the Running App MVP. It includes solutions for test failures, CI/CD problems, and local development issues.

## Table of Contents

- [Common Test Failures](#common-test-failures)
- [CI/CD Issues](#cicd-issues)
- [Local Development Problems](#local-development-problems)
- [Database Issues](#database-issues)
- [Authentication Problems](#authentication-problems)
- [Performance Issues](#performance-issues)
- [Build and Deployment Issues](#build-and-deployment-issues)
- [Historical Issues](#historical-issues)

## Common Test Failures

### Unit Test Failures

#### Jest/Vitest Memory Leaks

**Symptoms:**

- Tests pass individually but fail when run together
- "EMFILE: too many open files" errors
- Memory usage continuously increasing

**Solutions:**

```bash
# 1. Check for unclosed resources
npm run test:memory

# 2. Increase file descriptor limits (macOS/Linux)
ulimit -n 4096

# 3. Run tests with specific memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run test

# 4. Clean up test environment
npm run test:setup
```

#### React Component Test Failures

**Common Error:** `ReferenceError: ResizeObserver is not defined`

**Solution:**

```javascript
// Add to test setup file
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
```

**Common Error:** `TypeError: Cannot read properties of undefined (reading 'useContext')`

**Solution:**

```javascript
// Wrap component in proper providers
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

test('component renders correctly', () => {
  render(
    <BrowserRouter>
      <YourComponent />
    </BrowserRouter>
  );
});
```

#### Date/Time Related Test Failures

**Common Error:** Tests failing due to timezone differences

**Solution:**

```javascript
// Mock Date in tests
beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2024-01-15T10:00:00Z'));
});

afterAll(() => {
  jest.useRealTimers();
});
```

### Integration Test Failures

#### Database Connection Issues

**Symptoms:**

- `P1001: Can't reach database server`
- `ECONNREFUSED` errors
- Timeout errors during database operations

**Solutions:**

```bash
# 1. Check database status
npm run verify-db-setup

# 2. Reset database
npm run ci-db-cleanup
npm run ci-db-setup

# 3. Use in-memory database for testing
USE_IN_MEMORY_DB=true npm run test:integration

# 4. Check Prisma connection
npx prisma db pull
npx prisma generate
```

#### Transaction Isolation Issues

**Symptoms:**

- Tests interfering with each other
- Data persisting between tests
- Race conditions in parallel tests

**Solutions:**

```bash
# 1. Run tests sequentially
npm run test:sequential:db

# 2. Use proper test isolation
npm run test:integration -- --runInBand

# 3. Clean database between tests
# Ensure proper setup/teardown in test files
```

#### Authentication Test Failures

**Common Error:** `401 Unauthorized` in tests

**Solution:**

```javascript
// Ensure proper test user setup
beforeEach(async () => {
  await testDb.user.deleteMany();
  testUser = await testDb.user.create({
    data: {
      email: 'test@example.com',
      password: await bcrypt.hash('password123', 10),
    },
  });

  // Generate valid token
  accessToken = jwt.sign({ id: testUser.id, email: testUser.email }, process.env.JWT_SECRET, {
    expiresIn: '15m',
  });
});
```

### End-to-End Test Failures

#### Playwright Browser Issues

**Common Error:** `Browser not found`

**Solution:**

```bash
# Install browsers
npx playwright install

# Install with dependencies
npx playwright install --with-deps chromium

# Check browser status
npx playwright install --dry-run
```

**Common Error:** `Page crashed` or `Navigation timeout`

**Solutions:**

```javascript
// Increase timeouts in playwright.config.ts
export default {
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    navigationTimeout: 30000,
    actionTimeout: 10000,
  },
};
```

#### Element Not Found Errors

**Solutions:**

```javascript
// Use more robust selectors
await page.waitForSelector('[data-testid="submit-button"]');
await page.click('[data-testid="submit-button"]');

// Wait for page state
await page.waitForLoadState('networkidle');

// Use explicit waits
await page.waitForFunction(() => document.querySelector('.loading-spinner') === null);
```

#### Test Environment Issues

**Common Error:** Tests pass locally but fail in CI

**Solutions:**

```bash
# 1. Use headless mode consistently
HEADLESS=true npm run test:e2e

# 2. Check CI-specific configuration
npm run test:e2e:ci

# 3. Enable verbose logging
DEBUG=pw:* npm run test:e2e
```

## CI/CD Issues

### GitHub Actions Failures

#### Dependency Installation Issues

**Symptoms:**

- `npm install` failures
- Package version conflicts
- Network timeouts

**Solutions:**

```yaml
# In .github/workflows/
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'

- name: Install dependencies with retry
  run: |
    npm ci --timeout=300000 || npm ci --timeout=300000 || npm ci --timeout=300000
```

#### Test Failures in CI

**Common Issues:**

- Tests pass locally but fail in CI
- Flaky tests causing build failures
- Memory issues in CI environment

**Solutions:**

```bash
# 1. Use CI-optimized test commands
npm run test:coverage:unit:ci
npm run test:integration:ci
npm run test:e2e:ci

# 2. Run flaky test detection
npm run flaky:track

# 3. Check CI memory limits
NODE_OPTIONS="--max-old-space-size=4096" npm run test:all:complete
```

#### Performance Timeouts

**Solutions:**

```yaml
# Increase timeout for long-running jobs
jobs:
  test:
    timeout-minutes: 30
    steps:
      - name: Run tests
        run: npm run test:all:complete
        timeout-minutes: 20
```

### Deployment Issues

#### Database Migration Failures

**Symptoms:**

- Migration stuck in pending state
- Schema drift errors
- Connection timeouts during migration

**Solutions:**

```bash
# 1. Check migration status
npx prisma migrate status

# 2. Reset and re-run migrations
npx prisma migrate reset
npx prisma migrate deploy

# 3. Generate client after migration
npx prisma generate
```

#### Environment Variable Issues

**Common Error:** `process.env.VARIABLE is undefined`

**Solutions:**

```bash
# 1. Check .env file exists and is loaded
cp .env.example .env

# 2. Verify environment variables in CI
echo $DATABASE_URL
echo $JWT_SECRET

# 3. Use fallback values
const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
```

## Local Development Problems

### Server Startup Issues

#### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::3001`

**Solutions:**

```bash
# 1. Find and kill process using port
lsof -ti:3001 | xargs kill -9

# 2. Use different port
PORT=3002 npm run dev

# 3. Kill all node processes (careful!)
killall node
```

#### Environment Setup Issues

**Symptoms:**

- Missing environment variables
- Database connection failures
- Authentication not working

**Solutions:**

```bash
# 1. Complete setup
npm run setup

# 2. Check environment file
cat .env

# 3. Verify database connection
npm run verify-db-setup

# 4. Reset everything
npm run ci-db-teardown
npm run setup
```

### Frontend Development Issues

#### Hot Reload Not Working

**Solutions:**

```bash
# 1. Clear Vite cache
rm -rf node_modules/.vite

# 2. Restart dev server
npm run dev:frontend

# 3. Check file watcher limits (Linux)
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

#### Module Resolution Errors

**Common Error:** `Cannot resolve module '@/components/...'`

**Solutions:**

```typescript
// Check tsconfig.json paths
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

```javascript
// Check vite.config.ts aliases
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### Package Management Issues

#### Dependency Conflicts

**Symptoms:**

- `npm install` warnings
- Version conflicts
- Peer dependency issues

**Solutions:**

```bash
# 1. Clean install
rm -rf node_modules package-lock.json
npm install

# 2. Check for conflicts
npm ls

# 3. Fix peer dependencies
npm install --legacy-peer-deps

# 4. Audit and fix
npm audit fix
```

#### TypeScript Compilation Errors

**Common Error:** `Property 'xyz' does not exist on type`

**Solutions:**

```bash
# 1. Clear TypeScript cache
npx tsc --build --clean

# 2. Regenerate types
npm run prisma:generate

# 3. Check TypeScript version
npm list typescript

# 4. Full type check
npm run typecheck
```

## Database Issues

### Prisma Issues

#### Schema Sync Problems

**Error:** `Schema drift detected`

**Solutions:**

```bash
# 1. Reset database
npx prisma db push --force-reset

# 2. Create new migration
npx prisma migrate dev --create-only

# 3. Apply pending migrations
npx prisma migrate deploy
```

#### Connection Pool Issues

**Symptoms:**

- `P2034: Transaction failed due to a write conflict`
- Connection timeout errors
- Too many connections

**Solutions:**

```javascript
// In prisma/schema.prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
  // Add connection pooling for production
  relationMode = "prisma"
}
```

```bash
# For testing, use in-memory database
USE_IN_MEMORY_DB=true npm run test
```

### Data Integrity Issues

#### Foreign Key Constraints

**Error:** `Foreign key constraint failed`

**Solutions:**

```javascript
// Check relationship definitions in schema
model Goal {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

#### Unique Constraint Violations

**Solutions:**

```javascript
// Handle in application code
try {
  await prisma.user.create({ data: userData });
} catch (error) {
  if (error.code === 'P2002') {
    throw new Error('Email already exists');
  }
  throw error;
}
```

## Authentication Problems

### JWT Token Issues

#### Token Expiration

**Symptoms:**

- Frequent 401 errors
- Users logged out unexpectedly

**Solutions:**

```javascript
// Implement automatic token refresh
const refreshToken = async () => {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: localStorage.getItem('refreshToken') }),
    });

    if (response.ok) {
      const { accessToken } = await response.json();
      localStorage.setItem('accessToken', accessToken);
      return accessToken;
    }
  } catch (error) {
    // Redirect to login
    window.location.href = '/login';
  }
};
```

#### Token Validation Errors

**Common Error:** `JsonWebTokenError: invalid signature`

**Solutions:**

```bash
# 1. Check JWT_SECRET is set
echo $JWT_SECRET

# 2. Ensure consistent secret across environments
# 3. Clear existing tokens
localStorage.clear();
```

### Session Management

#### Cross-Origin Issues

**Error:** `CORS policy: credentials omitted`

**Solutions:**

```javascript
// In server CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// In frontend requests
fetch('/api/endpoint', {
  credentials: 'include',
  headers: { Authorization: `Bearer ${token}` },
});
```

## Performance Issues

### Slow Query Performance

#### Database Query Optimization

**Solutions:**

```javascript
// Add database indexes
model Run {
  id     String   @id @default(cuid())
  userId String
  date   DateTime

  @@index([userId, date])
  @@index([userId])
}
```

```javascript
// Optimize queries with select
const runs = await prisma.run.findMany({
  where: { userId },
  select: {
    id: true,
    date: true,
    distance: true,
    // Only select needed fields
  },
  orderBy: { date: 'desc' },
  take: 50, // Limit results
});
```

### Memory Leaks

#### React Component Leaks

**Solutions:**

```javascript
// Clean up subscriptions
useEffect(() => {
  const controller = new AbortController();

  fetchData({ signal: controller.signal });

  return () => {
    controller.abort();
  };
}, []);
```

#### Test Memory Issues

**Solutions:**

```bash
# Monitor memory usage
npm run test:memory

# Run tests with memory tracking
NODE_OPTIONS="--expose-gc" npm run test
```

## Build and Deployment Issues

### Build Failures

#### TypeScript Build Errors

**Solutions:**

```bash
# 1. Clean build
rm -rf dist/
npm run build

# 2. Check TypeScript configuration
npx tsc --noEmit

# 3. Update dependencies
npm update
```

#### Asset Build Issues

**Common Error:** `Failed to resolve import`

**Solutions:**

```javascript
// Check import paths
import Component from '@/components/Component'; // Correct
import Component from '../../../components/Component'; // Avoid
```

### Production Deployment

#### Environment Configuration

**Checklist:**

```bash
# 1. Environment variables set
- [ ] DATABASE_URL
- [ ] JWT_SECRET
- [ ] NODE_ENV=production

# 2. Database migrations applied
npx prisma migrate deploy

# 3. Build assets
npm run build

# 4. Security headers configured
# 5. HTTPS enabled
# 6. Rate limiting configured
```

#### Health Check Failures

**Solutions:**

```javascript
// Add health check endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});
```

## Quick Diagnostic Commands

### Health Check Commands

```bash
# System health
npm run verify-db-setup
npm run validate-test-env
npm run typecheck

# Test health
npm run test:run
npm run test:integration -- --verbose
npm run test:e2e -- --headed

# Performance check
npm run test:performance:track
npm run analyze-test-performance
```

### Debug Information Collection

```bash
# Environment info
node --version
npm --version
npx prisma --version

# Database info
npx prisma db pull
npx prisma migrate status

# Test info
npm run flaky:analyze
npm run test:performance:report
```

### Log Analysis

```bash
# Application logs
tail -f logs/app.log

# Test logs
npm run test -- --verbose 2>&1 | tee test-output.log

# CI logs (GitHub Actions)
# Check Actions tab in GitHub repository
```

## Getting Help

### Documentation Resources

- **API Documentation**: `/docs/API_DOCUMENTATION.md`
- **API Examples**: `/docs/api/API_EXAMPLES.md`
- **Test Patterns**: Check test files for examples
- **Architecture**: `/docs/ARCHITECTURE.md` (if exists)

### Debugging Tools

- **VS Code**: Use launch configurations for debugging
- **Chrome DevTools**: For frontend debugging
- **Prisma Studio**: `npm run prisma:studio`
- **Database Browser**: For SQLite inspection

### Community Support

- **GitHub Issues**: Check existing issues and discussions
- **Documentation**: Refer to framework-specific docs
- **Stack Overflow**: Search for specific error messages

---

## Historical Issues

The following issues were encountered and resolved during development:

## Issue 1: ConfirmationModal Import Error

### Problem

```
ConfirmationModal.tsx:5 Uncaught SyntaxError: The requested module '/src/components/UI/Modal.tsx'
does not provide an export named 'UIConfirmationModal'
```

### Root Cause

The `ConfirmationModal.tsx` wrapper was trying to import a non-existent export `UIConfirmationModal` from the Modal component after PR #245 refactored the Modal system.

### Solution

Fixed the re-export statement in `ConfirmationModal.tsx`:

```typescript
// ❌ WRONG - This export doesn't exist
export { UIConfirmationModal as ConfirmationModal } from './UI/Modal';

// ✅ CORRECT - Direct re-export
export { ConfirmationModal } from './UI/Modal';
```

### What Didn't Work

- Initially tried to debug without checking PR history
- Assumed the problem was with the import rather than the export

### Lessons Learned

- Always check recent PRs when encountering import/export errors
- Component refactoring may leave behind outdated wrapper files

---

## Issue 2: Vite WebSocket Connection Failures

### Problem

**Date Discovered:** 2025-07-13  
**Context:** After fixing ConfirmationModal import errors and restarting dev servers

Frontend browser console shows repeated WebSocket connection failures:

```
[vite] server connection lost. Polling for restart...
WebSocket connection to 'ws://localhost:3000/' failed:
ping @ client:921
waitForSuccessfulPing @ client:940
handleMessage @ client:868
```

This error repeats continuously, indicating the Vite development server's Hot Module Replacement (HMR) WebSocket connection is failing.

### Root Cause Analysis

**Investigation Steps Taken:**

1. **Process Check**: Confirmed development servers are running

   ```bash
   ps aux | grep -E "(vite|tsx)" | grep -v grep
   # Shows tsx server running on backend
   # Need to verify Vite frontend server status
   ```

2. **Port Availability**: Attempted to check port usage

   ```bash
   lsof -i:3000,3001  # Failed
   netstat -an | grep -E "3000|3001"  # Failed
   ```

3. **HTTP Connectivity**: Tested HTTP endpoints

   ```bash
   curl -s http://localhost:3000/  # No output (concerning)
   curl -s http://localhost:3001/api/health  # Failed
   ```

4. **Vite Configuration Review**: Examined `vite.config.ts`
   ```typescript
   server: {
     port: 3000,
     proxy: {
       '/api': {
         target: 'http://localhost:3001',
         changeOrigin: true,
       },
     },
   }
   ```

### Likely Causes

Based on the investigation, the most probable causes are:

1. **Vite Development Server Crashed**: The frontend Vite server may have crashed while the backend tsx server continues running
2. **Port Conflict**: Another process may be using port 3000
3. **WebSocket Configuration Issue**: Vite's HMR WebSocket may be misconfigured
4. **Network Interface Binding**: Server may be bound to wrong interface (IPv4 vs IPv6)

### Symptoms

- ✅ Backend server appears to be running (tsx process found)
- ❌ Frontend HTTP requests return no response
- ❌ WebSocket connections to `ws://localhost:3000/` fail
- ❌ Vite HMR polling continuously fails
- 🔄 Browser shows "Polling for restart..." message

### Impact

- **Development Experience**: Hot Module Replacement doesn't work
- **Live Reloading**: Changes require manual browser refresh
- **Debugging**: Console spam makes debugging difficult
- **Performance**: Continuous failed polling consumes resources

### Immediate Debugging Steps

**Step 1: Verify Process Status**

```bash
# Check if Vite is actually running
ps aux | grep vite | grep -v grep

# Check what's listening on port 3000
sudo lsof -i :3000
# OR on macOS if lsof isn't working:
sudo netstat -an | grep :3000
```

**Step 2: Test Direct Connectivity**

```bash
# Test if anything responds on port 3000
telnet localhost 3000

# Check if we can reach the WebSocket endpoint
curl -I http://localhost:3000/
```

**Step 3: Restart Development Servers**

```bash
# Kill all related processes
pkill -f "vite"
pkill -f "tsx"

# Clean restart
npm run dev:full
```

### Potential Solutions

**Solution 1: Clean Server Restart**

```bash
# Stop all processes
lsof -ti:3000,3001 | xargs kill -9 2>/dev/null || true

# Start servers individually to isolate issues
npm run dev &          # Backend first
npm run dev:frontend   # Frontend second
```

**Solution 2: Alternative Port Configuration**
If port 3000 is conflicted, modify `vite.config.ts`:

```typescript
server: {
  port: 3002,  // Use different port
  host: '0.0.0.0',  // Bind to all interfaces
  // ... rest of config
}
```

**Solution 3: WebSocket Configuration**
Add explicit WebSocket configuration to `vite.config.ts`:

```typescript
server: {
  port: 3000,
  hmr: {
    port: 3000,
    host: 'localhost'
  },
  // ... rest of config
}
```

**Solution 4: Development Environment Reset**

```bash
# Clear Vite cache
rm -rf node_modules/.vite

# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules
npm install

# Restart servers
npm run dev:full
```

### Prevention

1. **Graceful Shutdown**: Always use Ctrl+C to stop servers instead of killing processes
2. **Port Management**: Use tools like `lsof` to check port usage before starting servers
3. **Process Monitoring**: Regularly check that both frontend and backend servers are running
4. **Configuration Validation**: Ensure Vite and backend configurations are compatible

### Resolution

**Root Cause Confirmed**: Vite development server crashed while backend remained running

**Investigation Results**:

```bash
ps aux | grep vite | grep -v grep
# No output - Vite process was not running
```

**Solution Applied**:

```bash
# Restarted frontend server
npm run dev:frontend

# Result: VITE v7.0.3 ready in 127 ms
# ➜  Local:   http://localhost:3000/
```

**Status**: ✅ **RESOLVED**

**Outcome**:

- WebSocket connection restored
- HMR (Hot Module Replacement) working
- No more polling errors in browser console
- Frontend accessible at http://localhost:3000/

### Related Issues

- See "Issue 1: ConfirmationModal Import Error" - This WebSocket issue appeared after fixing import errors and restarting servers
- May be related to process cleanup after multiple server restarts during development

---

## Issue 3: Login Failures and Timeouts

### Problem

Multiple cascading issues preventing login:

1. API requests timing out with multiple retry attempts
2. 401 Unauthorized errors
3. "Too many attempts" rate limit errors on first try

### Root Causes

#### 1. Database Misconfiguration

The `.env` file was pointing to the wrong database:

```bash
# ❌ WRONG - Test database with no data
DATABASE_URL="file:./prisma/test.db"

# ✅ CORRECT - Development database
DATABASE_URL="file:./prisma/dev.db"
```

#### 2. Database Not Initialized

The development database didn't exist and had no tables.

#### 3. No Test Users

Even after fixing the database, there were no users to login with.

#### 4. Overly Restrictive Rate Limiting

Auth rate limit was set to only 5 attempts per 15 minutes, causing immediate lockout.

### Solutions Applied (In Order)

#### Step 1: Fix Database Configuration

```bash
# Update .env to use dev.db instead of test.db
DATABASE_URL="file:./prisma/dev.db"
```

#### Step 2: Initialize Database

```bash
# Run Prisma migrations
npx prisma migrate dev --name init
```

#### Step 3: Create Test User

Created a script to add a test user:

```typescript
// scripts/create-test-user.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function createTestUser() {
  try {
    const hashedPassword = await bcrypt.hash('TestPassword123!', 12);

    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        password: hashedPassword,
        name: 'Test User',
      },
    });

    console.log('Test user created:', user.email);
  } catch (error) {
    console.error('Error creating test user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser();
```

Run with: `npx tsx scripts/create-test-user.ts`

#### Step 4: Disable Rate Limiting for Development

```bash
# .env changes
RATE_LIMITING_ENABLED=false  # Was true
AUTH_RATE_LIMIT_MAX=50       # Was 5
API_RATE_LIMIT_MAX=1000      # Was 100
```

### What Didn't Work

1. **Using curl with complex JSON** - Bash escaping issues made it difficult to send proper JSON
2. **Trying to fix rate limiting without restarting the server** - Environment changes require restart
3. **Debugging frontend issues first** - The problems were all backend-related

### Testing the Fix

After applying all fixes and restarting the backend:

```bash
# Stop the backend server (Ctrl+C)
# Restart it
npm run dev

# Login credentials now work:
Email: test@example.com
Password: TestPassword123!
```

### Key Takeaways

1. **Check the basics first**: Database connection, migrations, test data
2. **Development settings should be developer-friendly**: Disable or relax security features like rate limiting
3. **Environment changes require server restart**: The backend doesn't hot-reload .env changes
4. **Create helper scripts**: Having a create-test-user script saves time
5. **Follow the error trail**: Start with the first error (database) before debugging downstream issues

---

## Common Development Setup Checklist

To avoid these issues in the future:

1. **Database Setup**

   ```bash
   # Ensure correct database in .env
   DATABASE_URL="file:./prisma/dev.db"

   # Run migrations
   npx prisma migrate dev

   # Create test user
   npx tsx scripts/create-test-user.ts
   ```

2. **Development Environment**

   ```bash
   # .env for development
   RATE_LIMITING_ENABLED=false
   NODE_ENV=development
   ```

3. **Start Services**

   ```bash
   # Clean start (kill any existing processes first)
   lsof -ti:3000,3001 | xargs kill -9 2>/dev/null || true

   # Terminal 1: Backend
   npm run dev

   # Terminal 2: Frontend
   npm run dev:frontend

   # OR: Both together
   npm run dev:full
   ```

4. **Verify Setup**
   - Backend running on http://localhost:3001
   - Frontend running on http://localhost:3000
   - Can login with test credentials
   - WebSocket connection working (no polling errors in console)

---

## Debugging Tips

### For Import/Export Errors

1. Check recent PRs for component refactoring
2. Verify the actual exports in the source file
3. Look for outdated wrapper/compatibility layers

### For API/Backend Issues

1. Test the backend directly with curl/Postman
2. Check server logs for detailed errors
3. Verify database connection and migrations
4. Ensure test data exists
5. Check rate limiting and security settings

### For Vite/Frontend Issues

1. Check browser console for WebSocket errors
2. Verify Vite process is running: `ps aux | grep vite`
3. Test HTTP connectivity: `curl -I http://localhost:3000/`
4. Check port conflicts: `lsof -i :3000`
5. Clear Vite cache: `rm -rf node_modules/.vite`
6. Restart with clean slate: Kill all processes, then `npm run dev:full`

### For Environment Issues

1. Always restart the backend after .env changes
2. Verify which database you're connected to
3. Check if security features are blocking development
4. Ensure both frontend and backend servers are running simultaneously

---

_Document created: 2025-07-13_  
_Last updated: 2025-07-13 (Added WebSocket investigation)_
