# 3. Use Separate Test Frameworks for Different Test Types

Date: 2025-07-28

## Status

Accepted

## Context

We needed to establish a testing strategy that would:
- Provide fast feedback during development
- Support different types of testing (unit, integration, E2E)
- Allow parallel test execution
- Integrate well with our CI/CD pipeline
- Support modern JavaScript/TypeScript features

## Decision

We will use different test frameworks optimized for different test types:

1. **Vitest** for unit tests
2. **Jest** for integration tests
3. **Playwright** for end-to-end tests

Each framework is configured separately with its own configuration file and npm scripts.

## Consequences

### Positive
- Each test type runs with an optimized framework
- Vitest provides 3x faster unit test execution than Jest
- Jest's mature ecosystem works well for API integration tests
- Playwright offers superior cross-browser testing capabilities
- Can run different test types in parallel in CI
- Clear separation of concerns

### Negative
- Multiple test frameworks to maintain
- Different assertion libraries and patterns
- Developers need to learn multiple tools
- Configuration complexity increased
- Some code duplication in test utilities

## Implementation Details

```json
{
  "scripts": {
    "test": "vitest",                    // Unit tests (fast)
    "test:integration": "jest",          // Integration tests
    "test:e2e": "playwright test",       // E2E tests
    "test:all": "npm run test:coverage && npm run test:integration && npm run test:e2e"
  }
}
```

### Performance Metrics
- Unit tests (Vitest): ~3 seconds for 200 tests
- Integration tests (Jest): ~15 seconds for 50 tests  
- E2E tests (Playwright): ~45 seconds for 20 scenarios

## Alternatives Considered

1. **Jest for everything**:
   - Pros: Single framework, unified configuration
   - Cons: Slower unit tests, limited browser testing
   - Rejected due to performance requirements

2. **Vitest for unit and integration tests**:
   - Pros: Fast, modern, unified API
   - Cons: Less mature for integration testing
   - Rejected due to Jest's superior integration test support

3. **Cypress for E2E tests**:
   - Pros: Popular, good developer experience
   - Cons: Slower, Chrome-focused, larger bundle
   - Rejected in favor of Playwright's speed and multi-browser support

4. **Single unified framework (like Deno test)**:
   - Pros: True unification
   - Cons: Would require migration from Node.js
   - Rejected due to ecosystem constraints

## Migration Path

To minimize disruption:
1. Keep existing Jest tests for integration
2. Write new unit tests in Vitest
3. Gradually migrate unit tests from Jest to Vitest
4. Maintain shared test utilities in a common location

## References

- [Vitest Documentation](https://vitest.dev/)
- [Jest Documentation](https://jestjs.io/)
- [Playwright Documentation](https://playwright.dev/)
- Performance comparison in `/tests/benchmarks/framework-comparison.md`