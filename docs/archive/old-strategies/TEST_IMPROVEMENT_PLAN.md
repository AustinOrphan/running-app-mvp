# Test Coverage Improvement Plan

## Current State (14.67% Coverage)

### Critical Gaps

1. **Backend Routes**: 0% coverage
2. **Authentication**: 0% coverage
3. **Middleware**: 10.77% coverage
4. **Integration Tests**: Minimal coverage

## Phase 1: Backend Route Testing (Week 1)

### Day 1-2: Authentication Routes

Create comprehensive tests for `server/routes/auth.ts`:

- User registration with validation
- Login with correct/incorrect credentials
- Token refresh mechanism
- Logout and token blacklisting
- Password reset flow

### Day 3-4: Core Data Routes

Test CRUD operations for:

- `runs.ts`: Create, read, update, delete running data
- `goals.ts`: Goal management and progress tracking
- `races.ts`: Race planning and results

### Day 5: Stats and Analytics

- Test calculation accuracy
- Verify data aggregation
- Test edge cases (no data, single data point)

## Phase 2: Middleware Testing (Week 2)

### Authentication Middleware

- Valid token acceptance
- Invalid token rejection
- Expired token handling
- Missing token scenarios

### Validation Middleware

- Input sanitization
- XSS prevention
- SQL injection prevention
- Schema validation

### Error Handling

- Different error types
- Error logging
- Client-safe error messages
- Stack trace hiding in production

## Phase 3: Integration Testing (Week 3)

### User Workflows

1. **Registration → First Run**
   - Create account
   - Login
   - Add first run
   - View stats

2. **Goal Management**
   - Create goal
   - Track progress
   - Complete goal
   - View history

3. **Race Planning**
   - Create race
   - Update training
   - Record results

### Database Testing

- Transaction rollbacks
- Constraint violations
- Concurrent operations
- Migration testing

## Phase 4: Frontend Enhancement (Week 4)

### Hook Testing

- Enable skipped auth tests
- Add loading state tests
- Test error scenarios
- Test race conditions

### Component Integration

- User interaction flows
- Form submissions
- Navigation patterns
- Error boundaries

## Implementation Strategy

### 1. Test Structure

```typescript
// Example test structure for routes
describe('POST /api/runs', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    app = createTestApp();
    token = await getAuthToken();
  });

  it('should create run with valid data', async () => {
    const response = await request(app)
      .post('/api/runs')
      .set('Authorization', `Bearer ${token}`)
      .send(validRunData)
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      distance: validRunData.distance,
      duration: validRunData.duration,
    });
  });
});
```

### 2. Test Data Management

```typescript
// Test data factory
export const createTestRun = (overrides = {}) => ({
  date: new Date().toISOString(),
  distance: 5.0,
  duration: 1800,
  notes: 'Test run',
  tag: 'easy',
  ...overrides,
});
```

### 3. Coverage Monitoring

```yaml
# jest.config.js
coverageThreshold: { global: { branches: 50, ? // Start conservative
          functions
        : 50, lines: 50, statements: 50 }, ? // Strict for critical paths
      './server/routes/auth.ts'
    : { branches: 80, functions: 80, lines: 80 } }
```

## Metrics & Goals

### 30-Day Target

- Overall: 50%+ (from 14.67%)
- Backend routes: 80%+
- Middleware: 70%+
- Critical paths: 90%+

### 60-Day Target

- Overall: 70%+
- All routes: 85%+
- Integration tests: Complete
- E2E critical paths: 95%+

### 90-Day Target

- Overall: 80%+
- Mutation testing: Implemented
- Performance benchmarks: Established
- Zero untested critical paths

## Quick Wins (Implement Today)

### 1. Enable Skipped Tests

```bash
# Find and enable skipped tests
grep -r "skip\|xit\|xdescribe" tests/
```

### 2. Add Basic Route Tests

Focus on happy paths first:

- GET endpoints return data
- POST endpoints create resources
- Auth is enforced

### 3. Fix Failing Tests

- CreateGoalModal form issues
- React act() warnings
- Database constraints

## Tools & Resources

### Testing Libraries

```json
{
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/user-event": "^14.5.2",
    "supertest": "^7.1.3",
    "msw": "^2.7.0",
    "@faker-js/faker": "^9.3.0"
  }
}
```

### CI Integration

- Coverage checks on PR
- Trend analysis
- Coverage badges
- Automated reports

## Success Criteria

1. **No Critical Path Untested**: Auth, data CRUD, payments
2. **Regression Prevention**: New bugs caught by tests
3. **Developer Confidence**: Refactoring without fear
4. **Fast Feedback**: Tests run in <2 minutes
5. **Clear Documentation**: Tests serve as API docs

## Next Actions

1. [ ] Review generated coverage report
2. [ ] Create first auth route test
3. [ ] Fix React act() warnings
4. [ ] Enable coverage CI check
5. [ ] Set team coverage goals

Remember: Quality over quantity. A few well-written tests that catch real bugs are worth more than many tests that just increase coverage numbers.
