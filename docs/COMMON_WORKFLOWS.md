# Common Development Workflows

This guide covers the most common development workflows you'll use when working on the Running App MVP.

## Table of Contents

- [Daily Development Workflow](#daily-development-workflow)
- [Feature Development Workflow](#feature-development-workflow)
- [Bug Fixing Workflow](#bug-fixing-workflow)
- [API Development Workflow](#api-development-workflow)
- [Database Changes Workflow](#database-changes-workflow)
- [Testing Workflow](#testing-workflow)
- [Code Review Workflow](#code-review-workflow)
- [Release Workflow](#release-workflow)
- [Hotfix Workflow](#hotfix-workflow)

## Daily Development Workflow

### Morning Routine

```bash
# 1. Update your local repository
git checkout main
git pull origin main

# 2. Check for any dependency updates
npm install

# 3. Run database migrations if any
npm run prisma:migrate

# 4. Start development servers
npm run dev:full

# 5. Run tests to ensure everything works
npm run test:run
```

### Before Starting Work

```bash
# 1. Create a new feature branch
git checkout -b feature/your-feature-name

# 2. Check current tasks
cat tasks.md | grep "[ ]"

# 3. Review any related issues
# Check GitHub issues or project board
```

### During Development

```bash
# Keep tests running in watch mode
npm run test:watch

# Check types continuously
npm run typecheck -- --watch

# Format code as you work
npm run format
```

### End of Day

```bash
# 1. Commit your work
git add .
git commit -m "feat: description of changes"

# 2. Push to remote
git push origin feature/your-feature-name

# 3. Create draft PR if work is ongoing
# Use GitHub UI or CLI
```

## Feature Development Workflow

### 1. Planning Phase

```bash
# Review requirements
# - Read user story/issue
# - Check acceptance criteria
# - Review existing code

# Create implementation plan
touch docs/features/FEATURE_NAME.md
```

### 2. Implementation Phase

#### Frontend Feature

```bash
# 1. Create component structure
mkdir -p src/components/feature-name
touch src/components/feature-name/FeatureName.tsx
touch src/components/feature-name/FeatureName.test.tsx
touch src/components/feature-name/index.ts

# 2. Create types
touch src/types/feature-name.ts

# 3. Add API service if needed
touch src/services/feature-name.ts

# 4. Implement incrementally
# - Start with component structure
# - Add state management
# - Connect to API
# - Add styling
# - Write tests
```

Example component structure:
```typescript
// src/components/feature-name/FeatureName.tsx
import React, { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { FeatureType } from '../../types/feature-name';

interface FeatureNameProps {
  // Props definition
}

export const FeatureName: React.FC<FeatureNameProps> = (props) => {
  const [state, setState] = useState<FeatureType>();
  const { data, loading, error } = useApi<FeatureType>('/api/feature');
  
  useEffect(() => {
    // Side effects
  }, []);
  
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <div className="feature-container">
      {/* Component JSX */}
    </div>
  );
};
```

#### Backend Feature

```bash
# 1. Create route file
touch server/routes/feature-name.ts

# 2. Create service if complex logic
touch server/services/featureService.ts

# 3. Update database schema if needed
# Edit prisma/schema.prisma

# 4. Create migration
npm run prisma:migrate dev -- --name add_feature_name

# 5. Add tests
touch tests/integration/api/feature-name.test.ts
```

Example route structure:
```typescript
// server/routes/feature-name.ts
import express from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { featureSchema } from '../schemas/feature';

const router = express.Router();

// GET /api/feature
router.get('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const results = await prisma.feature.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(results);
  } catch (error) {
    next(error);
  }
});

// POST /api/feature
router.post('/', authenticate, validate(featureSchema), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const feature = await prisma.feature.create({
      data: { ...req.body, userId }
    });
    res.status(201).json(feature);
  } catch (error) {
    next(error);
  }
});

export default router;
```

### 3. Testing Phase

```bash
# Run all tests
npm run test:all:complete

# Test specific feature
npm run test -- feature-name
npm run test:integration -- feature-name
npm run test:e2e -- feature-name

# Check coverage
npm run test:coverage
```

### 4. Documentation Phase

```bash
# Update API documentation
# Edit docs/API_DOCUMENTATION.md

# Update user documentation
# Edit relevant files in docs/

# Add JSDoc comments
# Document complex functions
```

### 5. Submission Phase

```bash
# 1. Final checks
npm run lint:check
npm run test:all:complete

# 2. Commit changes
git add .
git commit -m "feat: implement feature name

- Add component structure
- Implement business logic
- Add comprehensive tests
- Update documentation"

# 3. Push to remote
git push origin feature/feature-name

# 4. Create pull request
# Use GitHub UI or:
gh pr create --title "feat: Feature Name" --body "Description"
```

## Bug Fixing Workflow

### 1. Reproduce the Bug

```bash
# 1. Switch to main branch
git checkout main
git pull origin main

# 2. Try to reproduce the issue
npm run dev:full
# Follow steps from bug report

# 3. Write a failing test
touch tests/integration/api/bug-reproduction.test.ts
```

### 2. Investigate

```bash
# Check logs
tail -f logs/error.log

# Use debugger
# Add breakpoints in VS Code
# Or add debugger statements

# Check database state
npm run prisma:studio

# Review recent changes
git log --oneline -20
git blame path/to/suspicious/file.ts
```

### 3. Fix the Bug

```bash
# 1. Create bug fix branch
git checkout -b fix/issue-description

# 2. Make minimal changes to fix
# Edit only what's necessary

# 3. Verify the fix
npm run test -- bug-reproduction.test.ts

# 4. Check for regressions
npm run test:all:complete
```

### 4. Submit Fix

```bash
# Commit with descriptive message
git add .
git commit -m "fix: resolve issue with description

- Root cause: explanation
- Solution: what was changed
- Fixes #123"

# Push and create PR
git push origin fix/issue-description
```

## API Development Workflow

### 1. Design API Endpoint

```typescript
// Plan the endpoint
/*
 * POST /api/resource
 * Body: { name: string, value: number }
 * Response: { id: number, name: string, value: number, createdAt: Date }
 * Auth: Required
 */
```

### 2. Implement Route

```bash
# 1. Add route handler
# Edit server/routes/resource.ts

# 2. Add validation schema
mkdir -p server/schemas
touch server/schemas/resource.ts
```

### 3. Add Integration Tests

```typescript
// tests/integration/api/resource.test.ts
describe('POST /api/resource', () => {
  it('should create resource', async () => {
    const response = await request(app)
      .post('/api/resource')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', value: 42 });
      
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
  });
  
  it('should validate input', async () => {
    const response = await request(app)
      .post('/api/resource')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test' }); // Missing value
      
    expect(response.status).toBe(400);
  });
});
```

### 4. Document API

```markdown
## POST /api/resource

Create a new resource.

### Request

- **Method**: POST
- **Path**: `/api/resource`
- **Auth**: Required (Bearer token)
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>`

### Body

```json
{
  "name": "string (required)",
  "value": "number (required)"
}
```

### Response

**Success (201)**:
```json
{
  "id": 1,
  "name": "Resource Name",
  "value": 42,
  "createdAt": "2024-01-15T10:00:00Z"
}
```
```

### 5. Test with curl

```bash
# Get auth token
TOKEN=$(curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  | jq -r '.token')

# Test endpoint
curl -X POST http://localhost:3001/api/resource \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Test Resource","value":42}'
```

## Database Changes Workflow

### 1. Plan Schema Changes

```prisma
// prisma/schema.prisma
model NewModel {
  id        Int      @id @default(autoincrement())
  name      String
  userId    Int
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([userId])
}
```

### 2. Create Migration

```bash
# Create migration
npm run prisma:migrate dev -- --name add_new_model

# Review generated SQL
cat prisma/migrations/*/migration.sql
```

### 3. Update Types and Services

```bash
# Generate Prisma client
npm run prisma:generate

# Update TypeScript types
# Types are auto-generated by Prisma
```

### 4. Test Migration

```bash
# Reset database and re-run all migrations
npm run prisma:migrate reset

# Verify schema
npm run prisma:studio
```

### 5. Update Seeds (if needed)

```typescript
// prisma/seed.ts
async function seed() {
  // Add seed data for new model
  await prisma.newModel.createMany({
    data: [
      { name: 'Sample 1', userId: 1 },
      { name: 'Sample 2', userId: 1 }
    ]
  });
}
```

## Testing Workflow

### Unit Testing Workflow

```bash
# 1. Write test first (TDD)
touch src/utils/newFunction.test.ts

# 2. Run test (should fail)
npm run test -- newFunction.test.ts

# 3. Implement function
touch src/utils/newFunction.ts

# 4. Run test again (should pass)
npm run test -- newFunction.test.ts

# 5. Refactor if needed
# Tests ensure nothing breaks
```

### Integration Testing Workflow

```bash
# 1. Set up test database
npm run test:setup:db

# 2. Write integration test
touch tests/integration/feature.test.ts

# 3. Run integration tests
npm run test:integration -- feature.test.ts

# 4. Run all integration tests
npm run test:integration
```

### E2E Testing Workflow

```bash
# 1. Start application
npm run dev:full

# 2. Write E2E test
touch tests/e2e/user-flow.test.ts

# 3. Run E2E tests (headed mode for debugging)
npm run test:e2e:headed -- user-flow.test.ts

# 4. Run all E2E tests
npm run test:e2e
```

### Debugging Tests

```bash
# Debug unit test in VS Code
# 1. Set breakpoint in test or code
# 2. Use "Debug Vitest Tests" launch config

# Debug with console logs
npm run test -- --reporter=verbose

# Debug E2E with Playwright Inspector
PWDEBUG=1 npm run test:e2e -- test-name
```

## Code Review Workflow

### As a Reviewer

```bash
# 1. Check out PR locally
gh pr checkout 123
# or
git fetch origin pull/123/head:pr-123
git checkout pr-123

# 2. Run tests
npm run test:all:complete

# 3. Test functionality
npm run dev:full
# Manual testing

# 4. Review code
# Check for:
# - Logic errors
# - Security issues
# - Performance problems
# - Code style
# - Test coverage
```

### As an Author

```bash
# 1. Self-review before submitting
git diff main...HEAD

# 2. Ensure all checks pass
npm run lint:check
npm run test:all:complete

# 3. Update PR based on feedback
git add .
git commit -m "fix: address review comments"
git push origin feature-branch

# 4. Request re-review
# Comment on PR: "Changes addressed, ready for re-review"
```

## Release Workflow

### 1. Prepare Release

```bash
# 1. Create release branch
git checkout -b release/v1.2.0

# 2. Update version
npm version minor # or major, patch

# 3. Update changelog
touch CHANGELOG.md
# Add release notes

# 4. Run final tests
npm run test:all:complete
```

### 2. Deploy to Staging

```bash
# 1. Push release branch
git push origin release/v1.2.0

# 2. Deploy to staging (automatic via CI)
# Monitor deployment

# 3. Run smoke tests on staging
npm run test:e2e -- --baseURL=https://staging.example.com
```

### 3. Release to Production

```bash
# 1. Merge to main
git checkout main
git merge release/v1.2.0

# 2. Tag release
git tag -a v1.2.0 -m "Release version 1.2.0"
git push origin main --tags

# 3. Deploy to production
# Via CI/CD pipeline
```

## Hotfix Workflow

### Emergency Fix Process

```bash
# 1. Create hotfix from main
git checkout main
git checkout -b hotfix/critical-issue

# 2. Make minimal fix
# Only fix the critical issue

# 3. Test thoroughly
npm run test:all:complete

# 4. Deploy immediately
git push origin hotfix/critical-issue

# 5. Merge to main and develop
git checkout main
git merge hotfix/critical-issue
git checkout develop
git merge hotfix/critical-issue
```

## Tips and Best Practices

### Git Commit Messages

```bash
# Format: <type>: <description>

# Types:
# feat: New feature
# fix: Bug fix
# docs: Documentation
# style: Formatting
# refactor: Code restructuring
# test: Adding tests
# chore: Maintenance

# Examples:
git commit -m "feat: add pace calculator to run form"
git commit -m "fix: resolve date parsing issue in Safari"
git commit -m "docs: update API documentation for goals endpoint"
```

### Branch Naming

```bash
# Format: <type>/<description>

# Examples:
feature/user-statistics
fix/login-redirect-issue
chore/update-dependencies
docs/api-documentation
```

### Code Quality Checks

```bash
# Before every commit
npm run lint:fix
npm run format
npm run typecheck

# Before creating PR
npm run test:all:complete
npm run lint:check
```

### Performance Monitoring

```bash
# Check bundle size
npm run build
ls -lh dist/assets/*.js

# Profile tests
npm run test:performance:track

# Monitor build time
time npm run build
```

## Conclusion

These workflows cover the most common development scenarios. As you become familiar with the codebase, you'll develop your own patterns and preferences. The key is maintaining consistency and following the team's established practices.