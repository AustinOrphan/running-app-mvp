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

## Issue 2: Login Failures and Timeouts

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
   # Terminal 1: Backend
   npm run dev

   # Terminal 2: Frontend
   npm run dev:frontend
   ```

4. **Verify Setup**
   - Backend running on http://localhost:3001
   - Frontend running on http://localhost:3000
   - Can login with test credentials

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

### For Environment Issues

1. Always restart the backend after .env changes
2. Verify which database you're connected to
3. Check if security features are blocking development

---

_Document created: 2025-07-13_
_Last updated: 2025-07-13_
