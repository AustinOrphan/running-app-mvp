# CI/CD Troubleshooting Guide

## Overview

This guide provides step-by-step solutions for common CI/CD pipeline failures and instructions for debugging issues locally before pushing to CI.

## Table of Contents

1. [Quick Diagnosis](#quick-diagnosis)
2. [Common CI Failures](#common-ci-failures)
3. [Local Debugging](#local-debugging)
4. [Environment Issues](#environment-issues)
5. [Test-Specific Issues](#test-specific-issues)
6. [Performance Issues](#performance-issues)
7. [Prevention Strategies](#prevention-strategies)
8. [Getting Help](#getting-help)

## Quick Diagnosis

### 🚨 Emergency Checklist

Before diving deep, check these common issues:

```bash
# 1. Check if you can reproduce locally
npm run test:all:complete

# 2. Verify environment setup
npm run validate-test-env

# 3. Check for recent changes
git log --oneline -10

# 4. Verify dependencies
npm ci --dry-run
```

### 📊 CI Status Quick Check

```bash
# Check current CI status
gh run list --limit 5

# View specific workflow run
gh run view <run-id>

# Download CI artifacts for analysis
gh run download <run-id>
```

## Common CI Failures

### 🧪 Unit Test Failures

#### Symptom: "Database connection failed" or "Prisma error P1012"

**Root Cause**: Missing environment variables in CI

**Solution**:

```bash
# 1. Check CI workflow has required env vars
cat .github/workflows/ci.yml | grep -A 20 "env:"

# 2. Verify locally with CI environment
export NODE_ENV=test
export DATABASE_URL="file:./prisma/test.db"
export JWT_SECRET="test-secret-key-for-ci-environment-must-be-longer-than-32-characters"
npm run test:coverage:unit:ci
```

**Prevention**:

- Always test with CI configuration locally: `npm run test:coverage:unit:ci`
- Verify environment variables in workflow files
- Use `npm run validate-test-env` before pushing

#### Symptom: "Test timeout" or tests hanging

**Root Cause**: Tests taking longer than CI timeout limits

**Solution**:

```bash
# 1. Identify slow tests
npm run analyze-test-performance

# 2. Run with extended timeout locally
npm run test -- --timeout 60000

# 3. Check for infinite loops or async issues
npm run test -- --reporter=verbose
```

**Quick Fix**:

```typescript
// In test file - increase timeout for specific tests
test('slow operation', async () => {
  // Test code
}, 30000); // 30 second timeout
```

#### Symptom: "Module not found" or import errors

**Root Cause**: Missing dependencies or path resolution issues

**Solution**:

```bash
# 1. Clean install dependencies
rm -rf node_modules package-lock.json
npm install

# 2. Check TypeScript configuration
npx tsc --noEmit

# 3. Verify import paths
npm run lint:check
```

### 🔗 Integration Test Failures

#### Symptom: "Database schema out of sync" or migration errors

**Root Cause**: Database migration issues in CI

**Solution**:

```bash
# 1. Reset database and run migrations
npm run ci-db-setup

# 2. Verify database schema
npx prisma db pull
npx prisma generate

# 3. Test locally with CI database setup
DATABASE_URL="file:./prisma/ci-test.db" npm run test:integration:ci
```

**Prevention**:

```bash
# Always run before pushing
npm run verify-db-setup
npm run test:integration:ci
```

#### Symptom: "Jest worker crashed" or "Exceeded worker timeout"

**Root Cause**: Memory issues or resource constraints

**Solution**:

```bash
# 1. Run with single worker
npm run test:integration -- --maxWorkers=1

# 2. Check for memory leaks
npm run test:memory

# 3. Increase worker timeout
# In jest.config.ci.js:
# workerIdleMemoryLimit: '1GB'
```

#### Symptom: "Database locked" or "SQLITE_BUSY"

**Root Cause**: Parallel database access

**Solution**:

```bash
# 1. Verify maxWorkers=1 in Jest config
cat jest.config.ci.js | grep maxWorkers

# 2. Check for lingering database connections
npm run ci-db-teardown
npm run ci-db-setup

# 3. Run tests sequentially
npm run test:integration -- --runInBand
```

### 🎭 E2E Test Failures

#### Symptom: "Browser not found" or "Chromium not installed"

**Root Cause**: Missing Playwright browsers

**Solution**:

```bash
# 1. Install browsers
npx playwright install --with-deps

# 2. Verify browser installation
npx playwright --version
ls -la ~/.cache/ms-playwright/

# 3. Test browser launch
npx playwright test --headed tests/e2e/example.test.ts
```

**CI Fix**: Ensure workflow includes:

```yaml
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium
```

#### Symptom: "Page timeout" or "Navigation timeout"

**Root Cause**: Slow page loads or network issues

**Solution**:

```bash
# 1. Run with headed browser locally
npm run test:e2e -- --headed

# 2. Increase timeouts
# In playwright.config.ci.ts:
# timeout: 60000
# actionTimeout: 15000

# 3. Check for network issues
npm run test:e2e -- --trace on
```

#### Symptom: "Element not found" or "Selector timeout"

**Root Cause**: Timing issues or changed UI

**Solution**:

```bash
# 1. Run with debug mode
npm run test:e2e -- --debug

# 2. Update selectors
npx playwright codegen http://localhost:3000

# 3. Add explicit waits
# await page.waitForSelector('[data-testid="element"]');
```

### 🏗️ Build Failures

#### Symptom: "TypeScript compilation failed"

**Root Cause**: Type errors in code

**Solution**:

```bash
# 1. Check TypeScript errors
npm run typecheck

# 2. Fix type issues
npm run lint:fix

# 3. Update type definitions
npm update @types/node @types/react
```

#### Symptom: "Bundle size exceeded" or "Memory limit"

**Root Cause**: Large bundle or memory usage

**Solution**:

```bash
# 1. Analyze bundle size
npm run build -- --analyze

# 2. Check for large dependencies
npm run quality:complexity

# 3. Optimize imports
# Use tree-shaking: import { specific } from 'library'
```

## Local Debugging

### 🔍 Pre-Push Checklist

**Always run before pushing**:

```bash
# 1. Complete test suite
npm run test:all:complete

# 2. Code quality checks
npm run quality:check

# 3. Build verification
npm run build

# 4. Performance validation
npm run test:performance:validate
```

### 🛠️ Debug CI Issues Locally

#### Simulate CI Environment

```bash
# 1. Set CI environment variables
export CI=true
export NODE_ENV=test
export DATABASE_URL="file:./prisma/test.db"
export JWT_SECRET="test-secret-key-for-ci-environment-must-be-longer-than-32-characters"

# 2. Use CI configurations
npm run test:coverage:unit:ci
npm run test:integration:ci
npm run test:e2e:ci

# 3. Clean build
rm -rf node_modules dist coverage
npm ci
npm run build
```

#### Debug Specific Test Suites

```bash
# Unit tests with debugging
npm run test -- --reporter=verbose --bail

# Integration tests with debugging
npm run test:integration -- --verbose --detectOpenHandles

# E2E tests with debugging
npm run test:e2e -- --headed --debug
```

#### Memory and Performance Debugging

```bash
# Check memory usage
npm run test:memory

# Profile test performance
npm run test:performance:track

# Analyze slow tests
npm run analyze-test-performance
```

### 🔬 Advanced Debugging

#### Database Debugging

```bash
# 1. Inspect database state
npx prisma studio

# 2. Check migrations
npx prisma migrate status

# 3. Reset database
npm run ci-db-teardown
npm run ci-db-setup

# 4. Validate schema
npx prisma validate
```

#### Network and Timing Issues

```bash
# 1. Test with delays
npm run test:e2e -- --timeout 120000

# 2. Network debugging
npm run test:e2e -- --trace on

# 3. Check for race conditions
npm run test -- --repeat-each 5
```

#### Browser Debugging

```bash
# 1. Visual debugging
npm run test:e2e -- --headed --slowMo 1000

# 2. Record test execution
npm run test:e2e -- --video on

# 3. Debug specific test
npx playwright test tests/e2e/specific.test.ts --debug
```

## Environment Issues

### 🌍 Node.js Version Issues

#### Symptom: "Unsupported Node.js version" or compatibility errors

**Solution**:

```bash
# 1. Check required version
cat package.json | grep '"node"'
cat .nvmrc

# 2. Use correct version
nvm use
# or
nvm install $(cat .nvmrc)

# 3. Verify compatibility
node --version
npm --version
```

### 📦 Dependency Issues

#### Symptom: "Package not found" or version conflicts

**Solution**:

```bash
# 1. Clean install
rm -rf node_modules package-lock.json
npm install

# 2. Check for conflicts
npm ls --depth=0
npm audit

# 3. Update dependencies
npm update
npm audit fix
```

#### Symptom: "Platform-specific binary" errors

**Solution**:

```bash
# 1. Rebuild native modules
npm rebuild

# 2. Clear npm cache
npm cache clean --force

# 3. Use platform-specific packages
npm install --platform=linux --arch=x64
```

### 🔐 Permission Issues

#### Symptom: "EACCES" or permission denied errors

**Solution**:

```bash
# 1. Fix npm permissions
sudo chown -R $(whoami) ~/.npm

# 2. Use npx instead of global installs
npx playwright install

# 3. Check file permissions
ls -la package.json
chmod 644 package.json
```

## Test-Specific Issues

### 🧪 Unit Test Problems

#### Flaky Tests

```bash
# 1. Identify flaky tests
npm run test -- --repeat-each 10

# 2. Analyze patterns
npm run test:performance:track

# 3. Fix timing issues
# Use proper async/await
# Add explicit waits
# Mock external dependencies
```

#### Mock Issues

```bash
# 1. Clear mocks between tests
afterEach(() => {
  vi.clearAllMocks();
});

# 2. Reset modules
beforeEach(() => {
  vi.resetModules();
});

# 3. Debug mock calls
console.log(mockFunction.mock.calls);
```

### 🔗 Integration Test Problems

#### Database State Issues

```bash
# 1. Ensure clean database
beforeEach(async () => {
  await cleanupDatabase();
});

# 2. Use transactions
await prisma.$transaction(async (tx) => {
  // Test operations
});

# 3. Verify data isolation
# Use unique test data per test
```

#### API Testing Issues

```bash
# 1. Verify server is running
curl http://localhost:3001/health

# 2. Check for port conflicts
lsof -i :3001

# 3. Debug API responses
npm run test:integration -- --verbose
```

### 🎭 E2E Test Problems

#### Timing Issues

```typescript
// 1. Use proper waits
await page.waitForSelector('[data-testid="element"]');
await page.waitForLoadState('networkidle');

// 2. Retry operations
await expect(async () => {
  await page.click('button');
  await expect(page.locator('.result')).toBeVisible();
}).toPass();

// 3. Add delays for animations
await page.waitForTimeout(1000);
```

#### Selector Issues

```bash
# 1. Generate reliable selectors
npx playwright codegen http://localhost:3000

# 2. Use data-testid attributes
<button data-testid="submit-button">Submit</button>

# 3. Debug selectors
await page.pause(); // Pause for manual inspection
```

## Performance Issues

### 🐌 Slow Tests

#### Diagnosis

```bash
# 1. Profile test execution
npm run test:performance:track

# 2. Identify slow tests
npm run analyze-test-performance

# 3. Check database operations
# Use batch operations
# Optimize queries
# Add database indexes
```

#### Optimization

```bash
# 1. Parallel execution
npm run test:parallel

# 2. Test categorization
npm run test:parallel:categorize

# 3. Resource monitoring
npm run test:performance:dashboard
```

### 💾 Memory Issues

#### Diagnosis

```bash
# 1. Monitor memory usage
npm run test:memory

# 2. Check for leaks
npm run test -- --detectOpenHandles --forceExit

# 3. Profile memory
node --inspect-brk --max-old-space-size=4096 node_modules/.bin/vitest
```

#### Solutions

```typescript
// 1. Clean up after tests
afterEach(async () => {
  await cleanup();
  global.gc && global.gc(); // If --expose-gc flag used
});

// 2. Limit concurrent operations
const queue = new PQueue({ concurrency: 2 });

// 3. Use streaming for large data
const stream = fs.createReadStream('large-file.json');
```

## Prevention Strategies

### 🛡️ Pre-Commit Hooks

```bash
# Set up pre-commit hooks
npx husky add .husky/pre-commit "npm run quality:check"
npx husky add .husky/pre-push "npm run test:all:complete"
```

### 📝 Code Quality

```bash
# Regular maintenance
npm run quality:all
npm run test:coverage:check
npm run security:audit
```

### 🔄 Continuous Monitoring

```bash
# Set up monitoring
npm run test:performance:track
npm run test:coverage:trends
npm run quality:metrics
```

### 📚 Documentation

- Keep CLAUDE.md updated with new commands
- Document environment-specific configurations
- Maintain troubleshooting knowledge base

## Getting Help

### 📞 Emergency Contacts

1. **Check CI.md** for environment configuration
2. **Review recent commits** for breaking changes
3. **Check GitHub Issues** for known problems
4. **Ask team members** familiar with the codebase

### 🔍 Diagnostic Information

When asking for help, provide:

```bash
# System information
node --version
npm --version
git log --oneline -5

# Error reproduction
npm run test:all:complete 2>&1 | tee error.log

# Environment setup
npm run validate-test-env
npm run verify-db-setup
```

### 📋 Issue Template

```markdown
## Problem Description

[Describe the issue]

## Environment

- Node.js version: [version]
- npm version: [version]
- Operating System: [OS]
- Branch: [branch name]

## Steps to Reproduce

1. [Step 1]
2. [Step 2]
3. [Error occurs]

## Expected Behavior

[What should happen]

## Actual Behavior

[What actually happens]

## Error Messages
```

[Copy error messages here]

```

## Attempted Solutions
- [x] Ran npm run test:all:complete locally
- [x] Checked environment variables
- [x] Verified database setup
- [ ] [Other attempts]
```

### 🚀 Quick Recovery

For urgent fixes:

```bash
# 1. Revert to last working commit
git revert <commit-hash>

# 2. Skip CI checks (emergency only)
git push --no-verify

# 3. Hotfix workflow
git checkout -b hotfix/urgent-fix
# Make minimal fix
git commit -m "hotfix: urgent fix"
git push origin hotfix/urgent-fix
```

---

**Remember**: Most CI issues can be reproduced and debugged locally using the CI-specific configurations. Always test locally before pushing!

**Last Updated**: $(date)
**Maintained By**: Development Team
