# Plan v003

## 🎯 **Master Plan: Fix Remaining CI Test Failures**

### **Current Status**

- ✅ 35 workflows passing (infrastructure fixed)
- ❌ 30 workflows failing (test execution issues)

---

## **Phase 1: Root Cause Diagnosis** 🔍

**Priority: HIGH | Timeline: 30 minutes**

### Objectives:

1. Analyze failure patterns across all test types
2. Identify common root causes
3. Prioritize fixes by impact

### Actions:

1. **Check test file existence**
   - Verify E2E test files exist in `tests/e2e/`
   - Confirm accessibility tests in `tests/accessibility/`
   - Validate performance test setup

2. **Examine test configurations**
   - Review `playwright.config.ts` for E2E
   - Check `vitest.config.ts` for unit tests
   - Verify `jest.config.js` for integration tests

3. **Identify missing dependencies**
   - Check for missing test utilities
   - Verify database seed data
   - Confirm test environment variables

---

## **Phase 2: Fix E2E Test Failures** 🎭

**Priority: HIGH | Timeline: 1-2 hours**

### Root Issues:

- All 3 shards failing at test execution
- Setup succeeds but tests fail

### Fix Strategy:

1. **Check test file structure**

   ```bash
   find tests/e2e -name "*.test.ts" -o -name "*.spec.ts"
   ```

2. **Verify Playwright configuration**
   - Ensure test patterns match actual files
   - Check shard configuration
   - Validate baseURL and test server setup

3. **Fix test implementation**
   - Add missing test files if needed
   - Fix import paths
   - Ensure proper async/await usage

4. **Test locally first**
   ```bash
   npm run test:e2e -- --shard=1/3
   ```

---

## **Phase 3: Fix fast-ci & Unit Test Failures** ⚡

**Priority: HIGH | Timeline: 1 hour**

### Root Issues:

- Unit tests failing in CI but passing locally
- Platform-specific test issues

### Fix Strategy:

1. **Standardize test utilities**
   - Replace remaining `userEvent` with `fireEvent`
   - Fix timezone-sensitive tests
   - Handle platform differences

2. **Fix test database setup**
   - Ensure Prisma client generation
   - Add proper test isolation
   - Fix seed data issues

3. **Update test timeouts**
   - Increase timeouts for CI environment
   - Add retry logic for flaky tests

---

## **Phase 4: Fix Accessibility Test Failures** ♿

**Priority: HIGH | Timeline: 1 hour**

### Root Issues:

- Missing accessibility test implementation
- Axe-core configuration issues

### Fix Strategy:

1. **Verify test setup**
   - Check `@axe-core/react` integration
   - Validate test file locations
   - Ensure proper component mounting

2. **Fix test implementation**
   - Add proper accessibility assertions
   - Configure axe-core rules
   - Handle async component loading

3. **Add missing tests**
   - Create tests for key components
   - Test keyboard navigation
   - Verify ARIA attributes

---

## **Phase 5: Fix Performance Test Failures** 📊

**Priority: MEDIUM | Timeline: 45 minutes**

### Root Issues:

- Missing performance benchmarks
- Lighthouse CI configuration

### Fix Strategy:

1. **Configure performance baselines**
   - Set realistic thresholds
   - Create `lighthouserc.json` if missing
   - Configure bundle size limits

2. **Fix test execution**
   - Ensure build completes before testing
   - Add proper wait conditions
   - Handle CI environment constraints

---

## **Phase 6: Fix Integration Test Failures** 🔧

**Priority: MEDIUM | Timeline: 1 hour**

### Root Issues:

- Database connection issues
- API endpoint failures
- Test isolation problems

### Fix Strategy:

1. **Fix database setup**
   - Ensure migrations run properly
   - Add proper transaction handling
   - Fix connection pooling

2. **Resolve API test issues**
   - Add proper authentication setup
   - Fix request/response mocking
   - Handle async operations

3. **Improve test isolation**
   - Clean database between tests
   - Reset application state
   - Fix test order dependencies

---

## **Phase 7: Resolve CodeQL Issues** 🔒

**Priority: LOW | Timeline: 30 minutes**

### Root Issues:

- Security Summary job configuration
- Workflow dependency issues

### Fix Strategy:

1. **Fix workflow configuration**
   - Review Security Summary job
   - Fix job dependencies
   - Handle empty scan results

2. **Update security policies**
   - Configure allowed vulnerabilities
   - Set proper severity thresholds

---

## **Phase 8: Final Validation & Cleanup** ✅

**Priority: MEDIUM | Timeline: 30 minutes**

### Objectives:

1. **Verify all fixes**
   - Run full test suite locally
   - Check CI status
   - Monitor for flaky tests

2. **Documentation**
   - Update CLAUDE.md with fixes
   - Document test patterns
   - Add troubleshooting guide

3. **Performance optimization**
   - Enable test caching
   - Parallelize where possible
   - Optimize CI runtime

---

## **Implementation Order**

### Day 1 (Immediate):

1. **Phase 1**: Diagnose root causes (30 min)
2. **Phase 2**: Fix E2E tests (2 hours)
3. **Phase 3**: Fix unit tests (1 hour)

### Day 2:

4. **Phase 4**: Fix accessibility tests (1 hour)
5. **Phase 5**: Fix performance tests (45 min)
6. **Phase 6**: Fix integration tests (1 hour)

### Day 3:

7. **Phase 7**: Resolve CodeQL (30 min)
8. **Phase 8**: Final validation (30 min)

---

## **Success Metrics**

- 🎯 All CI workflows passing (100% green)
- ⏱️ CI runtime under 10 minutes
- 🔄 No flaky test failures
- 📊 Test coverage above 80%
- 🚀 Reliable deployment pipeline

---

## **Quick Wins** (Do First):

1. Check if E2E test files actually exist
2. Add missing test files with basic smoke tests
3. Fix obvious configuration issues
4. Standardize test patterns across all test types

This plan provides a systematic approach to achieving 100% passing CI tests within 2-3 days of focused effort.

---

Created: 2025-07-30 16:00:33 UTC
