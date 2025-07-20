# Test Improvement Roadmap

**Current Status**: 68% pass rate (785/1093 tests passing)  
**Target**: 90%+ pass rate  
**Timeline**: Immediate → Short Term → Complete

## Quick Reference

### Current Test Metrics

```
Test Files:  47 total (31 failed | 15 passed | 1 skipped)
Tests:       1093 total (283 failed | 785 passed | 25 skipped)
Pass Rate:   68% (Target: 90%+)
```

### Priority Issues

1. 🔴 **Global fetch mock** - Cascading API failures
2. 🔴 **Health check endpoint** - Infrastructure tests blocked
3. 🔴 **Frontend HTML serving** - Integration tests failing
4. 🟡 **JWT token validation** - Auth tests failing
5. 🟡 **Test database seeding** - Data-dependent tests failing

## Phase 2A: Critical Infrastructure Fixes

### 🔴 Priority 1: Global Fetch Mock Issue

**File**: `tests/setup/testSetup.ts:36-41`
**Problem**:

```javascript
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve([]),  // ← Empty arrays causing failures
  text: () => Promise.resolve(''),
}) as any;
```

**Impact**: API calls return empty arrays instead of expected data
**Affected Tests**: Goals, authentication, all API integration tests
**Estimated Fix Impact**: +15% pass rate (~160 tests)

**Solution Strategy**:

1. Replace global mock with endpoint-specific mocks
2. Create test data factories for consistent responses
3. Use MSW (Mock Service Worker) for better API mocking

**Implementation**:

```javascript
// Replace generic mock with:
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url, options) => {
    if (url.includes('/api/health')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString() }),
      });
    }
    if (url.includes('/api/goals')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockGoalsData),
      });
    }
    // Default fallback
    return Promise.resolve({ ok: false, status: 404 });
  });
});
```

### 🔴 Priority 2: Health Check Endpoint Failure

**Test**: `tests/infrastructure/startup.test.ts:219-233`
**Problem**: Health endpoint returning `undefined` instead of `'ok'`
**Root Cause Investigation Needed**:

1. **Server startup in test environment**:

   ```bash
   # Check if server starts properly in test
   npm run dev &
   curl http://localhost:3001/api/health
   ```

2. **Port conflicts**:

   ```bash
   # Check for port conflicts
   lsof -i :3001
   ```

3. **Test isolation issues**:
   - Multiple test processes trying to bind same port
   - Test server not waiting for proper startup

**Solution Strategy**:

- Add proper server startup waiting in tests
- Use dynamic port allocation for test environment
- Improve test isolation between infrastructure tests

### 🔴 Priority 3: Frontend HTML Serving

**Test**: `tests/infrastructure/startup.test.ts:270-285`
**Problem**: Frontend not serving HTML with `<div id="root">`
**Root Cause**: Vite test environment configuration

**Investigation**:

1. Check `vite.config.ts` test settings
2. Verify HTML template loading in test mode
3. Ensure proxy configuration works in tests

**Solution Strategy**:

- Fix Vite test environment HTML serving
- Add proper HTML template validation
- Ensure frontend build works in test mode

## Phase 2B: Authentication & Data Fixes

### 🟡 Priority 4: JWT Token Validation

**Error Pattern**: "Authentication token-validation failed"
**Files**: Integration tests in `tests/integration/api/`

**Problem Analysis**:

- Test JWT tokens malformed or expired
- Test user creation not working properly
- Auth middleware rejecting test tokens

**Solution Strategy**:

1. **Fix test token generation**:

   ```javascript
   // Create proper test JWT tokens
   const testToken = jwt.sign(
     { userId: 'test-user-id', email: 'test@example.com' },
     process.env.JWT_SECRET || 'test-secret',
     { expiresIn: '1h' }
   );
   ```

2. **Update test auth setup**:
   - Ensure consistent test user creation
   - Fix token format and signing
   - Add proper auth headers in test requests

### 🟡 Priority 5: Test Database Seeding

**Problem**: Empty responses instead of expected test data
**Impact**: Goals tests, user data tests, progress calculations

**Solution Strategy**:

1. **Fix Prisma test client**:

   ```javascript
   // Ensure proper test database isolation
   beforeEach(async () => {
     await prisma.$transaction([
       prisma.goal.deleteMany(),
       prisma.run.deleteMany(),
       prisma.user.deleteMany(),
     ]);

     // Seed test data
     await createTestUser();
     await createTestGoals();
   });
   ```

2. **Add test data factories**:
   - Consistent test user creation
   - Proper goal and run test data
   - Predictable progress calculations

## Phase 2C: Feature-Specific Fixes

### 🟢 Priority 6: Goals API Functionality

**Problem**: Progress calculations returning 0 instead of expected values
**Tests**: `tests/unit/hooks/useGoals.test.ts`

**Solution Strategy**:

1. Fix goals test data setup
2. Ensure proper API mocking for goals endpoints
3. Fix async/await timing in goals tests

### 🟢 Priority 7: Async/Timing Issues

**Problem**: Tests timing out at 1000ms+
**Solution**: Fix Promise handling and add proper await patterns

### 🟢 Priority 8: Test Environment Validation

**Problem**: Test environment validation failures
**Solution**: Update test environment expectations post-cleanup

## Implementation Checklist

### Phase 2A (Critical - Week 1)

- [ ] Fix global fetch mock in `testSetup.ts`
- [ ] Debug health check endpoint failure
- [ ] Fix frontend HTML serving in tests
- [ ] Validate infrastructure tests pass
- [ ] **Target**: 68% → 78% pass rate

### Phase 2B (High Priority - Week 1-2)

- [ ] Fix JWT token generation for tests
- [ ] Update test database seeding
- [ ] Improve test isolation between runs
- [ ] Fix authentication integration tests
- [ ] **Target**: 78% → 86% pass rate

### Phase 2C (Medium Priority - Week 2)

- [ ] Fix goals API test mocking
- [ ] Resolve async timing issues
- [ ] Update deprecated test patterns
- [ ] Clean up test warnings
- [ ] **Target**: 86% → 90%+ pass rate

## Success Metrics & Validation

### Milestone Validation

After each phase, run full test suite:

```bash
npm run test:all:complete
npm run test:coverage:check
```

### Target Metrics

- **Phase 2A Complete**: 78% pass rate (853 tests passing)
- **Phase 2B Complete**: 86% pass rate (940 tests passing)
- **Phase 2C Complete**: 90%+ pass rate (985+ tests passing)

### Quality Gates

- All infrastructure tests must pass
- No authentication test failures
- 85%+ test coverage maintained
- CI/CD pipeline validates successfully

## Risk Mitigation

### Backup Strategy

```bash
# Create backup branch before test fixes
git checkout -b backup/test-fixes-$(date +%Y%m%d)
git push origin backup/test-fixes-$(date +%Y%m%d)
```

### Incremental Validation

- Fix one category at a time
- Validate improvements after each fix
- Commit working states frequently
- Use feature flags for risky changes

### Rollback Procedures

- Keep detailed commit history
- Document what each fix addresses
- Maintain ability to revert individual changes
- Test in isolation before integration

## Timeline Estimate

### Immediate (Next Session)

- **1-2 hours**: Fix global fetch mock
- **1 hour**: Debug health check issue
- **1 hour**: Fix frontend HTML serving
- **Expected**: +15% pass rate improvement

### Short Term (This Week)

- **2-3 hours**: Authentication fixes
- **2-3 hours**: Database seeding fixes
- **1-2 hours**: Goals API fixes
- **Expected**: +20% additional improvement

### Total Timeline: **8-12 hours** for 90%+ pass rate

This roadmap provides a systematic approach to achieving excellent test reliability while maintaining all existing functionality.
