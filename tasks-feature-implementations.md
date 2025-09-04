# Tasks - Test Infrastructure & Remaining Issues

## Phase 1: Fix Critical Test Failures (Priority: High)
**Goal**: Achieve 100% test pass rate for CI deployment

### 1.1 Fix Goals API currentValue Persistence
- [X] **Issue**: PUT endpoint not properly updating currentValue field
- [X] Update Goals API PUT handler to include currentValue in update spread
  - [X] Locate PUT handler in server/routes/goals.ts
  - [X] Add currentValue to the update data spread operator
  - [X] Test the update with Postman/curl
- [X] Add transaction support for atomic updates
  - [X] Wrap update logic in Prisma transaction
  - [X] Handle rollback scenarios
- [X] Verify database schema supports currentValue updates
  - [X] Check Prisma schema for currentValue field
  - [X] Run prisma generate if needed
- [X] Add integration tests for currentValue scenarios
  - [X] Test updating currentValue alone
  - [X] Test updating currentValue with other fields
  - [X] Test edge cases (negative values, exceeding target)

### 1.2 Resolve HTTP Status Code Mismatches
- [X] **Issue**: Tests expecting 403 but receiving 404 for unauthorized access
- [X] **Root Cause**: Authorization checks happening after resource existence checks
- [X] Refactor route handlers to check authorization first
  - [X] Audit all protected routes in server/routes/
  - [X] Move authorization checks before resource queries
  - [X] Update error handling order
- [X] Standardize error response patterns across all APIs
  - [X] Create error response utility function
  - [X] Apply consistent error format
  - [X] Update all route handlers
- [X] Update tests to match corrected status codes
  - [X] Find all tests expecting 403
  - [X] Update expectations to match new behavior
  - [X] Run tests to verify
- [X] Document API error code conventions
  - [X] Create API_ERRORS.md
  - [X] Document when to use 403 vs 404
  - [X] Add examples for each scenario

### 1.3 Fix Date Input Test Handling
- [X] **Issue**: CreateGoalModal date input tests failing due to event handling
- [X] Standardize date input handling (fireEvent vs userEvent)
  - [X] Audit all date input tests
  - [X] Choose consistent approach (recommend: fireEvent for date inputs)
  - [X] Update test utilities
- [X] Update test utilities for consistent date manipulation
  - [X] Create dateTestUtils.ts
  - [X] Add helper functions for date input testing
  - [X] Apply to all date-related tests
- [X] Add date format validation tests
  - [X] Test various date formats
  - [X] Test invalid date inputs
  - [X] Test edge cases (leap years, month boundaries)
- [X] Ensure timezone handling in tests
  - [X] Mock Date/timezone in tests
  - [X] Test with different timezones
  - [X] Document timezone testing approach

## Phase 2: Optimize Test Performance (Priority: Medium)
**Goal**: Reduce CI runtime by 30%

### 2.1 Implement Test Parallelization
- [X] Enable Jest workers for unit tests
  - [X] Update jest.config.js with maxWorkers setting
  - [X] Test worker configuration locally
  - [X] Monitor memory usage
- [X] Configure Playwright sharding for E2E tests
  - [X] Update playwright.config.ts for sharding
  - [X] Set up shard distribution in CI
  - [X] Test shard execution
- [X] Set up test result caching
  - [X] Implement test result cache in CI
  - [X] Configure cache invalidation rules
  - [X] Monitor cache hit rates

### 2.2 Database Optimization
- [X] Implement in-memory SQLite for faster tests
  - [X] Configure Prisma for in-memory SQLite
  - [X] Update test setup scripts
  - [X] Benchmark performance improvement
- [X] Add database transaction rollback for test isolation
  - [X] Implement beforeEach transaction start
  - [X] Implement afterEach rollback
  - [X] Test isolation effectiveness
- [X] Create test data factories for reuse
  - [X] Create factory patterns for common entities
  - [X] Implement builder pattern for complex objects
  - [X] Document factory usage

## Phase 3: Enhance CI/CD Pipeline (Priority: Medium)
**Goal**: Production-ready CI/CD with monitoring

### 3.1 CI Pipeline Improvements
- [X] Implement branch protection rules
  - [X] Require PR reviews
  - [X] Require status checks to pass
  - [X] Prevent force pushes to main
- [X] Add automated dependency updates
  - [X] Configure Dependabot
  - [X] Set up automated security updates
  - [X] Configure update schedule
- [X] Set up security scanning (SAST/DAST)
  - [X] Enable GitHub code scanning
  - [X] Configure CodeQL analysis
  - [X] Set up vulnerability alerts
- [X] Configure deployment pipelines
  - [X] Create staging deployment workflow
  - [X] Create production deployment workflow
  - [X] Implement rollback procedures

### 3.2 Monitoring & Reporting
- [X] Set up test performance dashboards
  - [X] Create performance metrics collection
  - [X] Build dashboard UI
  - [X] Set up alerts for degradation
- [X] Implement flaky test tracking
  - [X] Integrate flaky test detection
  - [X] Create flaky test reports
  - [X] Set up auto-retry for flaky tests
- [X] Add coverage trend reporting
  - [X] Store coverage history
  - [X] Create trend visualizations
  - [X] Set coverage thresholds
- [X] Create automated PR comments with test results
  - [X] Build PR comment bot
  - [X] Format test results nicely
  - [X] Include coverage changes

## Phase 4: Documentation & Knowledge Transfer (Priority: Low)
**Goal**: Ensure maintainability

### 4.1 Documentation
- [X] Complete API documentation
  - [X] Document all endpoints
  - [X] Add request/response examples
  - [X] Generate OpenAPI spec
- [X] Create troubleshooting guides
  - [X] Common test failures
  - [X] CI/CD issues
  - [X] Local development problems
- [X] Document test patterns and best practices
  - [X] Unit test patterns
  - [X] Integration test patterns
  - [X] E2E test patterns
- [ ] Add architecture decision records (ADRs)
  - [ ] Document major decisions
  - [ ] Include rationale
  - [ ] Track alternatives considered

### 4.2 Developer Experience
- [ ] Create test debugging guides
  - [ ] VS Code debugging setup
  - [ ] Chrome DevTools for E2E
  - [ ] Test isolation techniques
- [ ] Add VS Code launch configurations
  - [ ] Debug unit tests
  - [ ] Debug integration tests
  - [ ] Debug E2E tests
- [ ] Set up pre-commit hooks
  - [ ] Lint checks
  - [ ] Type checks
  - [ ] Test affected files
- [ ] Create onboarding documentation
  - [ ] Setup instructions
  - [ ] Architecture overview
  - [ ] Common workflows

## Success Metrics Tracking
- [ ] **Test Reliability**: 100% pass rate, <1% flaky tests
- [ ] **Performance**: <5 min CI runtime for PRs
- [ ] **Coverage**: Maintain >80% code coverage
- [ ] **Developer Experience**: <30 min onboarding for new devs

## Next Immediate Actions
- [ ] Fix Goals API currentValue persistence (today)
- [ ] Resolve HTTP status code mismatches (today)
- [ ] Fix date input tests (tomorrow)
- [ ] Deploy to CI and validate all workflows (this week)

---
*Converted from plan-v002.md on 2025-07-26*