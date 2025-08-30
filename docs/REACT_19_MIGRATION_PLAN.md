# React 19 Migration Plan

## Overview

This document outlines the strategy for migrating from React 18.3.1 to React 19.1.1, including related dependencies and breaking changes.

## Current State

- **React**: 18.3.1 → 19.1.1 (target)
- **React DOM**: 18.3.1 → 19.1.1 (target)
- **@types/react**: 18.3.24 → 19.1.12 (target)
- **@types/react-dom**: 18.3.7 → 19.1.9 (target)
- **@vitejs/plugin-react**: 4.7.0 → 5.0.2 (target)
- **Zod**: 3.25.76 → 4.1.4 (target)

## Phase 1: Pre-Migration Analysis

### Code Analysis Required

1. **Test Import Analysis**
   - Search for `import {act} from 'react-dom/test-utils'` → migrate to `import {act} from 'react'`
   - Verify all test files use correct act import

2. **PropTypes Usage Analysis**
   - Search for `PropTypes` usage in function components
   - Identify components using `defaultProps`
   - Plan TypeScript conversion strategy

3. **Ref Usage Analysis**
   - Search for string refs (should be none due to modern codebase)
   - Verify `useRef()` calls have arguments
   - Check ref callback patterns

4. **Legacy Context API**
   - Search for `contextTypes`, `getChildContext`, `childContextTypes`
   - Should be minimal/none in modern codebase

### Commands for Analysis

```bash
# Search for potential breaking changes
grep -r "react-dom/test-utils" src/ tests/
grep -r "PropTypes" src/
grep -r "defaultProps" src/
grep -r "contextTypes" src/
grep -r "getChildContext" src/
grep -r "useRef()" src/
```

## Phase 2: Migration Steps

### Step 1: Update Dependencies

```bash
# Update React ecosystem
npm install --save-exact react@^19.0.0 react-dom@^19.0.0
npm install --save-exact @types/react@^19.0.0 @types/react-dom@^19.0.0
npm install @vitejs/plugin-react@^5.0.0
```

### Step 2: Run Automated Codemods

```bash
# Run all React 19 migration codemods
npx codemod@latest react/19/migration-recipe

# Individual codemods if needed:
npx codemod@latest react/19/replace-act-import
npx codemod@latest react/19/replace-string-ref
npx types-react-codemod@latest preset-19 ./src
```

### Step 3: TypeScript Fixes

```bash
# Fix TypeScript issues
npx types-react-codemod@latest react-element-default-any-props ./src
```

### Step 4: Manual Code Updates

- Update any remaining PropTypes to TypeScript interfaces
- Convert defaultProps to ES6 default parameters
- Fix ref callback return issues
- Update useRef calls without arguments

## Phase 3: Testing Strategy

### Test Categories

1. **Unit Tests (Vitest)**
   - Verify component rendering
   - Test hooks behavior
   - Validate TypeScript types

2. **Integration Tests (Jest)**
   - API functionality
   - Database interactions
   - Authentication flows

3. **E2E Tests (Playwright)**
   - Full user workflows
   - Cross-browser compatibility
   - Accessibility compliance

### Testing Commands

```bash
# Progressive testing approach
npm run typecheck                    # TypeScript compilation
npm run lint                         # Code quality
npm run test:run                     # Unit tests
npm run test:integration             # Integration tests
npm run test:e2e                     # End-to-end tests
npm run test:a11y                    # Accessibility tests
```

## Phase 4: Zod Migration (Separate)

### Zod 3→4 Changes Analysis

- Research Zod v4 breaking changes
- Update schema definitions
- Test validation logic
- Update error handling patterns

### Migration Steps

```bash
# After React migration is stable
npm install zod@^4.0.0
# Review and update schema definitions
# Test validation thoroughly
```

## Phase 5: Rollback Strategy

### Quick Rollback

```bash
# Revert to React 18 if issues arise
npm install --save-exact react@^18.3.1 react-dom@^18.3.1
npm install --save-exact @types/react@^18.3.24 @types/react-dom@^18.3.7
npm install @vitejs/plugin-react@^4.7.0
git checkout -- package-lock.json  # If needed
```

### Git Strategy

- Create feature branch: `feat/react-19-migration`
- Commit changes incrementally
- Tag stable points for easy rollback
- Merge only after full testing passes

## Phase 6: Deployment Strategy

### Staging Deployment

1. Deploy to staging environment
2. Run comprehensive test suite
3. Performance testing
4. User acceptance testing

### Production Deployment

1. Deploy during low-traffic period
2. Monitor error rates
3. Have rollback plan ready
4. Gradual rollout if possible

## Risk Assessment

### High Risk

- **React Core Changes**: Framework-level breaking changes
- **TypeScript Types**: Potential compilation errors
- **Build Pipeline**: Vite plugin compatibility

### Medium Risk

- **Test Suite**: Act import changes, potential test failures
- **Third-party Components**: Compatibility with React 19

### Low Risk

- **Component Logic**: Most components should work unchanged
- **Styling**: CSS/Tailwind should be unaffected

## Success Criteria

- [ ] All tests pass (unit, integration, E2E)
- [ ] TypeScript compilation succeeds without errors
- [ ] Build process completes successfully
- [ ] No runtime errors in development
- [ ] Performance metrics maintained or improved
- [ ] Accessibility compliance maintained

## Timeline Estimate

- **Phase 1**: 2-3 hours (analysis)
- **Phase 2**: 4-6 hours (migration)
- **Phase 3**: 6-8 hours (testing)
- **Phase 4**: 2-3 hours (Zod migration)
- **Phase 5**: As needed (rollback preparation)
- **Phase 6**: 2-4 hours (deployment)

**Total Estimate**: 16-24 hours of dedicated work

## Notes

- This migration should be treated as a separate major undertaking
- Consider scheduling during a sprint specifically dedicated to technical debt
- Ensure all team members are aware of the migration timeline
- Have dedicated time for thorough testing before production deployment
