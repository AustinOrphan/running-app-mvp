# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Setup and Installation

```bash
npm install
npx prisma migrate dev --name init  # Setup database
npx prisma generate                 # Generate Prisma client
```

### Development Servers

```bash
npm run dev                    # Backend server (port 3001)
npm run dev:frontend          # Frontend server (port 3000)
npm run dev:full              # Both servers concurrently
```

### Code Quality

```bash
npm run lint                  # Lint all files
npm run lint:fix             # Auto-fix linting issues
npm run lint:server         # Lint backend only
npm run lint:frontend       # Lint frontend only
npm run lint:check          # Full lint + format + typecheck
npm run format              # Format code with Prettier
npm run format:check        # Check formatting
npm run typecheck           # TypeScript type checking
```

### Testing

#### Basic Test Commands

```bash
npm run test                 # Run unit tests (Vitest)
npm run test:ui             # Run tests with UI
npm run test:run            # Run tests once
npm run test:coverage       # Run with coverage
npm run test:integration    # Run integration tests (Jest)
npm run test:e2e            # Run end-to-end tests (Playwright)
npm run test:e2e:ui         # E2E tests with UI
npm run test:a11y           # Accessibility tests
npm run test:visual         # Visual regression tests
npm run test:all:complete   # All tests with coverage
npm run validate-test-env   # Validate test environment
```

#### CI-Specific Test Commands

```bash
# CI-optimized configurations with timeouts and retries
npm run test:coverage:unit:ci        # Unit tests with CI config
npm run test:integration:ci          # Integration tests with CI config
npm run test:e2e:ci                 # E2E tests with CI config
npm run test:coverage:all:ci        # All tests with CI coverage
npm run test:a11y:ci                # Accessibility tests for CI
npm run test:visual:ci              # Visual regression for CI
```

#### Parallel Test Execution

```bash
# Parallel test execution (optimized performance)
npm run test:parallel               # Run parallel-safe tests
npm run test:parallel:categorize    # Categorize tests for parallel execution
npm run test:parallel:orchestrate   # Run orchestrated test suite
npm run test:parallel:ci           # CI parallel execution
npm run test:sequential:db         # Database tests (sequential only)
npm run test:sharded               # Distributed test sharding
```

#### Performance Monitoring

```bash
# Test performance tracking and analysis
npm run test:performance:track              # Track all test suites
npm run test:performance:track:unit         # Track unit tests only
npm run test:performance:track:integration  # Track integration tests only
npm run test:performance:track:e2e         # Track E2E tests only
npm run test:performance:report            # Generate performance report
npm run test:performance:trends            # Analyze performance trends
npm run test:performance:dashboard         # Generate HTML dashboard
npm run test:performance:dashboard:open    # Open dashboard in browser
```

#### Database Setup for Tests

```bash
# Database lifecycle management for CI/testing
npm run ci-db-setup         # Setup database for CI
npm run ci-db-cleanup       # Clean database state
npm run ci-db-teardown      # Complete database teardown
npm run verify-db-setup     # Verify database connectivity
```

#### Advanced Testing Options

```bash
# Test analysis and debugging
npm run analyze-test-performance    # Analyze slow tests
npm run verify-jest-workers        # Verify Jest worker configuration
npm run test:memory                # Memory usage testing
npm run test:infrastructure        # Infrastructure tests
```

### Database Management

```bash
npm run prisma:generate     # Generate Prisma client
npm run prisma:migrate      # Run database migrations
npm run prisma:studio       # Open Prisma Studio
```

### Build and Production

```bash
npm run build               # Build for production
npm run start               # Start production server
npm run preview             # Preview production build
```

## Development Rules and Best Practices

### Mandatory Pre-Commit Checks

- **Run before any task can be considered finished**: `npm run lint:fix`

## Test Strategies and Guidelines

### Test Strategy Overview

This project uses a comprehensive multi-layered testing strategy:

1. **Unit Tests** (Vitest) - Fast, isolated component testing
2. **Integration Tests** (Jest) - API and database interaction testing
3. **E2E Tests** (Playwright) - Full user workflow testing
4. **Performance Tests** - Test execution performance monitoring
5. **Accessibility Tests** - WCAG compliance verification
6. **Visual Regression Tests** - UI consistency validation

### When to Use Each Test Type

#### Unit Tests (Vitest)

- **Use for**: Individual functions, components, utilities
- **Configuration**: `vitest.config.ts` (local), `vitest.config.ci.ts` (CI)
- **Best practices**:
  - Test pure functions and isolated logic
  - Mock external dependencies
  - Focus on business logic validation
  - Keep tests fast (<100ms each)

```bash
# Run specific unit tests
npm run test -- src/utils/calculations.test.ts
npm run test -- --grep "validation"
```

#### Integration Tests (Jest)

- **Use for**: API endpoints, database operations, service integration
- **Configuration**: `jest.config.js` (local), `jest.config.ci.js` (CI)
- **Best practices**:
  - Test real database interactions
  - Use actual HTTP requests
  - Test error handling and edge cases
  - Clean database state between tests

```bash
# Run specific integration tests
npm run test:integration -- --testPathPattern=auth
npm run test:integration -- --verbose
```

#### E2E Tests (Playwright)

- **Use for**: Complete user workflows, critical user paths
- **Configuration**: `playwright.config.ts` (local), `playwright.config.ci.ts` (CI)
- **Best practices**:
  - Test from user perspective
  - Focus on critical business flows
  - Use data-testid attributes for stability
  - Keep tests independent and atomic

```bash
# Run specific E2E tests
npm run test:e2e -- tests/e2e/auth-flow.test.ts
npm run test:e2e -- --headed --debug
```

### CI/Local Testing Strategy

#### Local Development

```bash
# Quick feedback loop during development
npm run test:run                    # Fast unit tests
npm run test:integration           # API testing
npm run test:e2e -- --headed      # Visual E2E testing

# Before pushing changes
npm run test:all:complete          # Full test suite
npm run lint:check                # Code quality
```

#### CI Environment

```bash
# Optimized for CI performance and reliability
npm run test:coverage:unit:ci      # Unit tests with coverage
npm run test:integration:ci        # Integration with retries
npm run test:e2e:ci               # Headless E2E testing
npm run test:parallel:ci          # Parallel execution
```

### Performance Testing Strategy

#### Test Performance Monitoring

- **Automatic tracking**: CI runs performance monitoring after tests
- **Trend analysis**: Identifies performance regressions over time
- **Alerting**: Creates GitHub issues for significant degradations

```bash
# Manual performance analysis
npm run test:performance:track     # Track all test suites
npm run test:performance:report    # Generate detailed report
npm run test:performance:dashboard # Visual performance dashboard
```

#### Parallel vs Sequential Execution

- **Parallel**: Unit tests, browser tests (non-database)
- **Sequential**: Database tests, integration tests
- **Automatic categorization**: Tests are automatically categorized for optimal execution

```bash
npm run test:parallel:categorize   # Analyze tests for parallel safety
npm run test:parallel             # Run parallel-safe tests only
npm run test:sequential:db        # Run database tests sequentially
```

### Database Testing Strategy

#### Test Data Management

- **Clean state**: Each test starts with a clean database
- **Isolation**: Tests don't interfere with each other
- **Factories**: Use test factories for consistent data creation

```bash
# Database lifecycle for testing
npm run ci-db-setup               # Initialize test database
npm run verify-db-setup          # Verify connectivity
npm run ci-db-teardown           # Clean up after testing
```

#### Database Test Patterns

- Use transactions for test isolation
- Create minimal, focused test data
- Clean up after each test
- Test both success and failure scenarios

### Error Handling and Debugging

#### Test Debugging Commands

```bash
# Debug failing tests
npm run test -- --reporter=verbose
npm run test:integration -- --detectOpenHandles
npm run test:e2e -- --headed --debug

# Performance debugging
npm run analyze-test-performance
npm run test:memory
```

#### Common Issues and Solutions

- **Flaky tests**: Use retry logic and proper async/await
- **Slow tests**: Monitor with performance tracking
- **Memory leaks**: Use memory testing and cleanup
- **Database issues**: Verify setup and use proper isolation

### Best Practices for Test Maintenance

#### Code Quality

- Keep tests simple and focused
- Use descriptive test names
- Avoid test interdependencies
- Mock external services appropriately

#### CI/CD Integration

- Run tests in parallel where safe
- Use appropriate timeouts for CI
- Monitor test performance trends
- Set up alerts for failures

#### Documentation

- Document complex test scenarios
- Maintain test data factories
- Keep test configurations updated
- Document debugging procedures

## Architecture Overview

### Full-Stack Structure

This is a **monorepo** with frontend and backend in the same directory:

- **Frontend**: React 18 + TypeScript + Vite (port 3000)
- **Backend**: Express.js + TypeScript + Prisma ORM (port 3001)
- **Database**: SQLite with Prisma ORM
- **Authentication**: JWT with bcrypt password hashing

[... rest of the file remains unchanged ...]
