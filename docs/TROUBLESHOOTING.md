# Troubleshooting Guide

This document captures common issues encountered during development and their solutions.

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
