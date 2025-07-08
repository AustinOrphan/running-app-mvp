# Testing Infrastructure TODO

## Priority Items

### 🔴 Critical: Missing testHelpers Module

**Issue**: E2E tests reference non-existent `testHelpers` module causing compilation errors.

**Impact**: 
- `tests/e2e/auth-improved.test.ts` fails to compile
- Code duplication across test files
- Inconsistent testing patterns
- Poor developer experience

**Files Affected**:
- `tests/e2e/auth-improved.test.ts` (imports missing module)
- All E2E test files (could benefit from helpers)

**Related**: 
- PR #131 discussion: https://github.com/AustinOrphan/running-app-mvp/pull/131#discussion_r2192780446
- Issue template created: `.github/ISSUE_TEMPLATE/test_helpers_enhancement.md`
- Implementation plan: `docs/test-helpers-implementation-plan.md`

### 🟡 Medium: Test Type Safety Issues

**Issue**: Multiple E2E tests have TypeScript errors with `testUser` possibly undefined.

**Files Affected**:
- `tests/e2e/accessibility.test.ts`
- `tests/e2e/mobile-responsiveness.test.ts` 
- `tests/e2e/navigation-swipe.test.ts`
- `tests/e2e/runs.test.ts`
- `tests/e2e/stats.test.ts`
- `tests/e2e/visual-regression.test.ts`

**Solution**: Add proper null checks or assertions before using `testUser`.

### 🟡 Medium: Playwright API Issues

**Issue**: Tests use non-existent Playwright methods.

**Examples**:
- `expect(element).toBeStable()` doesn't exist in Playwright
- Should use `waitForLoadState('networkidle')` instead

**Files Affected**:
- `tests/e2e/utils/reliability.ts`

## Recommended Actions

### Immediate (This Sprint)

1. **Create testHelpers Module**
   - Start with basic element and form helpers
   - Update `auth-improved.test.ts` to use helpers
   - Document usage patterns

2. **Fix TypeScript Errors**
   - Add null checks for `testUser` in all affected files
   - Fix Playwright API usage issues

### Short Term (Next Sprint)

1. **Expand testHelpers**
   - Add authentication helpers
   - Add navigation helpers
   - Add database helpers

2. **Migrate Existing Tests**
   - Update other E2E tests to use helpers
   - Reduce code duplication
   - Standardize patterns

### Long Term (Next Quarter)

1. **Advanced Testing Features**
   - Network simulation helpers
   - Visual regression helpers
   - Performance testing helpers
   - Accessibility testing helpers

2. **Test Infrastructure**
   - Parallel test execution optimization
   - Test data management
   - CI/CD test reliability improvements

## Quick Wins

### 1. Fix Immediate Compilation Errors
```bash
# Temporarily disable problematic imports
# Add null checks for testUser usage
# Replace non-existent Playwright methods
```

### 2. Create Minimal testHelpers
```typescript
// tests/e2e/utils/testHelpers.ts
export function createE2EHelpers(page: Page, testDb: TestDatabase) {
  return {
    auth: {
      async login(email: string, password: string) { /* impl */ }
    },
    forms: {
      async fillForm(fields: Record<string, string>) { /* impl */ }
    },
    elements: {
      async waitForElement(selector: string) { /* impl */ }
    }
  };
}
```

### 3. Update One Test File
Start with `auth-improved.test.ts` as a proof of concept.

## Benefits After Implementation

- ✅ Reduced test code duplication by ~70%
- ✅ Improved test reliability and consistency  
- ✅ Better developer experience writing tests
- ✅ Easier maintenance and updates
- ✅ Standardized testing patterns across project
- ✅ Faster test development cycles

## Resources

- **Implementation Plan**: `docs/test-helpers-implementation-plan.md`
- **Issue Template**: `.github/ISSUE_TEMPLATE/test_helpers_enhancement.md`
- **Current Test Files**: `tests/e2e/`
- **Existing Reliability Utils**: `tests/e2e/utils/reliability.ts`

---

*Last Updated: 2025-01-08*
*Status: Planning Phase*
*Priority: High*