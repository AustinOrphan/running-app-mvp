# Integration Test Scenarios

This directory contains comprehensive integration test scenarios that test complete user workflows end-to-end. These tests go beyond individual API endpoint testing to validate real-world usage patterns and system behavior.

## Test Scenarios

### 1. User Registration & First Run Flow (`userRegistrationFlow.test.ts`)

Tests the complete onboarding experience for new users:
- User registration with validation
- Login authentication flow
- Creating first run
- Viewing initial statistics
- Setting first goal
- Checking goal progress
- Token refresh handling
- Logout and session invalidation

### 2. Goal Achievement Workflow (`goalAchievementWorkflow.test.ts`)

Tests goal management and progress tracking:
- Creating distance, runs, and duration goals
- Tracking progress through multiple runs
- Automatic goal completion
- Managing multiple concurrent goals
- Creating successive goals after completion
- Goal updates and modifications
- Goal deletion and archiving

### 3. Data Management Scenarios (`dataManagementScenarios.test.ts`)

Tests comprehensive data operations:
- Creating runs with complete metadata (notes, routes, tags)
- Bulk data creation and updates
- Data validation and error handling
- Filtering and searching capabilities
- Pagination for large datasets
- Data deletion with proper cleanup

### 4. Multi-User Scenarios (`multiUserScenarios.test.ts`)

Tests user isolation and concurrent operations:
- Complete data isolation between users
- Concurrent operations from multiple users
- Race participation across users
- Goal privacy and user-specific progress
- User account lifecycle and data cleanup
- Security boundaries verification

### 5. Error Handling Workflows (`errorHandlingWorkflows.test.ts`)

Tests system resilience and error recovery:
- Invalid authentication handling
- Network timeout scenarios
- Database error recovery
- Comprehensive validation testing
- Rate limiting enforcement
- Malformed request handling
- XSS and SQL injection protection
- Cascading failure recovery
- Concurrent modification conflicts

### 6. Performance & Load Scenarios (`performanceLoadScenarios.test.ts`)

Tests system performance under load:
- Large dataset operations (100+ records)
- Concurrent user load testing
- Memory usage monitoring
- Query optimization verification
- Bulk operation efficiency
- Pagination performance
- Complex filtering performance

## Running the Tests

Run all integration scenarios:

```bash
npm run test:integration -- tests/integration/scenarios/
```

Run a specific scenario:

```bash
npm run test:integration -- tests/integration/scenarios/userRegistrationFlow.test.ts
```

## Test Infrastructure

These tests use:

- `supertest` for HTTP request simulation
- `testDb` fixture for database operations and cleanup
- JWT token generation for authentication
- Express app creation with all middleware
- Prisma client for direct database verification

## Best Practices

1. **Isolation**: Each test scenario starts with a clean database
2. **Real Workflows**: Tests simulate actual user journeys
3. **Error Conditions**: Include both success and failure paths
4. **Performance**: Monitor response times for operations
5. **Security**: Test authentication and authorization boundaries
6. **Cleanup**: Ensure proper cleanup after each test

## Adding New Scenarios

When adding new integration scenarios:

1. Create a new test file in this directory
2. Import necessary routes and middleware
3. Set up test app with all required routes
4. Include database cleanup in beforeEach/afterAll
5. Test complete workflows, not just individual operations
6. Verify data consistency across operations
7. Include error scenarios and edge cases
8. Add performance benchmarks where appropriate
