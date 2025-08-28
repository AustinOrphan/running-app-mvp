# Repository Cleanup Inventory

## Duplicate Files to Remove

### Documentation Files with Duplicates
- `CI 2.md` (duplicate of CI.md)
- `CLAUDE.local 2.md` (duplicate of CLAUDE.local.md)
- `CI_STATUS_CHECK_REPORT 2.md` (duplicate of CI_STATUS_CHECK_REPORT.md)
- `DEPLOYMENT_README 2.md` (duplicate of DEPLOYMENT_README.md)
- `PERFORMANCE_THRESHOLDS 2.md` (duplicate of PERFORMANCE_THRESHOLDS.md)
- `tasks 2.md` and `tasks 3.md` (duplicates of tasks.md)

### Configuration Files with Duplicates
- `.lighthouserc 2.json` (duplicate of lighthouserc.json)
- `jest.config 2.js` (duplicate of jest.config.js)
- `performance-baseline 2.json` (duplicate of performance-baseline.json)
- `performance-thresholds-detailed 2.json` (duplicate of performance-thresholds-detailed.json)
- `playwright.config.headless 2.ts` (duplicate of playwright.config.headless.ts)
- `vitest.config.parallel 2.ts` (duplicate of vitest.config.parallel.ts)

### Duplicate Directories
- `node_modules 2/` (duplicate node_modules - should be deleted)
- `--version/` (appears to be accidentally created directory)

## Cache and Temporary Files to Remove

### Cache Directories
- `.jest-cache/`
- `.playwright-cache/`
- `.vitest-cache/`
- `.test-results/`
- `test-results/`
- `playwright-report/`
- `playwright-results/`
- `coverage-integration/`
- `tmp/`

### Test Output Files
- `test-output-19.log`
- `test-output-20.log`
- `test-output-21.log`
- `test-output-22.log`

### Build Artifacts
- `dist/` (should be git-ignored)
- `reports/` (should be git-ignored or kept minimal)

## Redundant Configuration Files

### Testing Configurations (Multiple per Tool)

#### Jest Configurations (5 files - need only 1)
- `jest.config.js`
- `jest.config 2.js`
- `jest.config.ci.js`
- `jest.retry.config.js`
- `jest-resolver.js`
- `jest-resolver.cjs`

#### Vitest Configurations (5 files - need only 1)
- `vitest.config.ts`
- `vitest.config.ci.ts`
- `vitest.config.parallel.ts`
- `vitest.config.parallel 2.ts`
- `vitest.retry.config.ts`

#### Playwright Configurations (4 files - need only 1)
- `playwright.config.ts`
- `playwright.config.ci.ts`
- `playwright.config.headless.ts`
- `playwright.config.headless 2.ts`
- `playwright.retry.config.ts`

#### Lighthouse Configurations (2 files - need only 1)
- `lighthouserc.json`
- `lighthouserc.ci.json`
- `.lighthouserc 2.json`

### ESLint Configurations (2 files - need only 1)
- `eslint.config.js`
- `eslint.config.quality.js`

### Performance Configurations (Multiple overlapping)
- `performance-baseline.json`
- `performance-baseline 2.json`
- `performance-results.json`
- `performance-thresholds.json`
- `performance-thresholds-detailed.json`
- `performance-thresholds-detailed 2.json`

## Redundant Documentation Files (30+ files)

### CI/CD Documentation (Merge into single CI.md)
- `CI.md`
- `CI 2.md`
- `CI_FAILURE_RESOLUTION_PLAN.md`
- `CI_FAILURE_RESOLUTION_TRACKING.xml`
- `CI_FIXES_SUMMARY.md`
- `CI_STATUS_CHECK_REPORT 2.md`
- `CONTINUOUS_VALIDATION_PLAN.md`

### Deployment Documentation (Merge into single DEPLOYMENT.md)
- `DEPLOYMENT_GUIDE.md`
- `DEPLOYMENT_README 2.md`
- `MASTER_DEPLOYMENT_PLAN.md`
- `NEXT_STEPS_DEPLOYMENT.md`
- `PHASE1_INFRASTRUCTURE_SETUP.md`

### Testing Documentation (Merge into single TESTING.md)
- `TESTING.md`
- `TESTING_INFRASTRUCTURE_SUMMARY.md`
- `TESTING_STRATEGY.md`
- `TEST_IMPROVEMENT_PLAN.md`
- `TEST_VALIDATION_REPORT.md`
- `TEST_VALIDATION_SUMMARY.md`
- `COMPREHENSIVE_TEST_COVERAGE_REPORT.md`
- `INTEGRATION_TEST_FIX_STRATEGY.md`
- `PHASE2_AUTHENTICATION_TESTING.md`
- `PHASE2_GOALS_API_TESTING.md`
- `PHASE2_MIDDLEWARE_TESTING.md`
- `PHASE2_RUNS_API_TESTING.md`
- `PHASE3_INTEGRATION_TESTING.md`

### Setup/Installation Documentation (Merge into single SETUP.md)
- `QUICKSTART.md`
- `GIT_WORKTREE_SETUP.md`
- `ROADMAP_SETUP.md`
- `quick-start.sh`
- `setup.sh`
- `codex-setup.sh`

### GitHub Documentation (Merge into single GITHUB.md)
- `GITHUB_SETUP.md`
- `GITHUB_SETUP_NEXT_STEPS.md`
- `GITHUB_REPOSITORY_SETUP_COMPLETE.md`
- `GITHUB_WORKFLOWS_REVIEW.md`
- `GITHUB_APPS_RECOMMENDATIONS.md`

### Obsolete Planning Documents (Move to docs/archive/)
- `plan-v001.md`
- `plan-v002.md`
- `plan-v003.md`
- `phase1-prompt.md`
- `REPOSITORY_CLEANUP_PLAN.md` (old version)
- `PR_MERGE_EXECUTION_CHECKLIST.md`
- `PR_MERGE_SUMMARY_REPORT.md`
- `PR_MONITORING_DASHBOARD.md`
- `PR_ROLLBACK_PROCEDURES.md`

## Redundant Scripts and Files

### Test Scripts (Should be npm scripts or consolidated)
- `check-backend.sh`
- `test-currentvalue-update.sh`
- `test-goals-api.js`
- `test-goals-currentvalue.js`
- `test-http-status-codes.js`
- `test-order-validation.js`
- `start-dev.sh`

### Deployment Scripts (Consolidate)
- `deploy-agents.ps1`
- `deploy-agents.sh`
- `launch-agents`

### GitHub Scripts (Move to .github/scripts/)
- `create-milestones.sh`
- `organize-issues.sh`
- `setup-project-board.sh`

## Server Code Duplication

### Multiple Server Entry Points (Choose one)
- `server.ts` (root level)
- `server/` directory
- `src/server/` directory

### Scattered Backend Code
- `middleware/` (root level - should be in server/)
- `routes/` (root level - should be in server/)
- `utils/` (root level - duplicates src/utils/)
- `lib/` (root level - should be in src/)
- `types/` (root level - should be in src/shared/)

## NPM Scripts Analysis

### Current State
- **Total Scripts**: 100+ scripts in package.json
- **Test Scripts**: ~80 are test-related variations
- **Duplicate Functionality**: Many scripts do the same thing with slight variations

### Categories of Redundant Scripts
1. **Test Coverage Variations** (15+ scripts)
   - test:coverage, test:coverage:all, test:coverage:unit:ci, etc.

2. **Parallel Test Variations** (10+ scripts)
   - test:parallel, test:parallel:safe, test:parallel:unit, etc.

3. **Cache Management** (15+ scripts)
   - cache:clear, cache:clear:unit, cache:check, cache:warm, etc.

4. **Performance Testing** (10+ scripts)
   - test:performance, test:performance:ci, test:performance:full, etc.

5. **Database Setup** (10+ scripts)
   - ci-db-setup, ci-integration-db-setup, test:setup:db, etc.

## TypeScript Errors Summary

### Files with Errors (69 total errors)
1. `tsconfig.json` - 3 errors
2. `src/hooks/useAuth.ts` - 1 error
3. `vite.config.ts` - 12 errors
4. `lib/prisma.ts` - 9 errors
5. `server.ts` - 16 errors
6. `src/components/Auth/AuthForm.tsx` - 14 errors
7. `server/routes/auth.ts` - 7 errors
8. `src/hooks/useConnectivityStatus.ts` - 6 errors
9. `src/contexts/HealthCheckContext.tsx` - 3 errors

### Common Error Patterns
- Module resolution issues
- Missing type definitions
- Incorrect import paths
- Duplicate identifier errors
- Configuration conflicts

## Files That Should Be Git-Ignored

### Add to .gitignore
```
# Cache directories
.jest-cache/
.vitest-cache/
.playwright-cache/
.test-results/
test-results/
playwright-report/
playwright-results/
coverage/
coverage-*/
.nyc_output/

# Build artifacts
dist/
build/
.next/

# Test outputs
*.log
test-output-*
reports/
tmp/

# IDE specific
.idea/
*.swp
*.swo
*~
.DS_Store

# Environment
.env.local
.env.*.local

# Dependencies
node_modules/
```

## Priority Cleanup Targets

### Immediate (High Impact, Low Risk)
1. Delete all files with " 2" or " 3" suffixes
2. Remove cache directories
3. Delete test output logs
4. Remove "node_modules 2" directory
5. Update .gitignore

### Short Term (High Impact, Medium Risk)
1. Consolidate documentation files
2. Choose single test framework per test type
3. Reduce npm scripts to essential ones
4. Fix TypeScript configuration

### Medium Term (Medium Impact, Higher Risk)
1. Reorganize server code structure
2. Migrate all tests to chosen frameworks
3. Update CI/CD pipelines
4. Consolidate configuration files

## Estimated Cleanup Impact

### Storage Reduction
- **Cache/temp files**: ~500MB
- **Duplicate node_modules**: ~300MB
- **Test outputs/reports**: ~50MB
- **Total potential reduction**: ~850MB

### Complexity Reduction
- **Scripts**: From 100+ to ~20 (80% reduction)
- **Documentation files**: From 30+ to 8 (73% reduction)
- **Configuration files**: From 25+ to 10 (60% reduction)
- **Test frameworks**: From 3 to 2 (Vitest + Playwright)

### Maintenance Improvement
- **Clearer project structure**: Single source of truth for each component
- **Faster onboarding**: Simplified documentation and setup
- **Easier debugging**: Consistent test infrastructure
- **Better CI/CD**: Simplified pipelines with fewer variations

---

**Generated**: [Current Date]
**Purpose**: Comprehensive inventory for repository cleanup
**Next Step**: Execute Phase 1 of cleanup plan