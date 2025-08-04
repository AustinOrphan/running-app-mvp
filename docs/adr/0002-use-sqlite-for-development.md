# 2. Use SQLite for Development and Testing

Date: 2025-07-28

## Status

Accepted

## Context

We needed to choose a database solution for development and testing that would:

- Be easy to set up for new developers
- Support fast test execution
- Allow for easy database reset between tests
- Be compatible with our ORM (Prisma)
- Support in-memory mode for testing

## Decision

We will use SQLite as our database for development and testing environments.

For production, we retain the flexibility to use PostgreSQL or another production-grade database, as Prisma supports multiple database providers.

## Consequences

### Positive

- Zero configuration required - no separate database server needed
- Supports in-memory mode for ultra-fast test execution
- Database is just a file, making it easy to reset or backup
- Excellent Prisma support
- Reduces onboarding friction for new developers
- Tests run faster (measured 40% improvement over PostgreSQL in CI)

### Negative

- Some SQL features differ between SQLite and production databases
- No true concurrent write support (though this rarely affects our use case)
- Must be careful about SQLite-specific syntax in migrations
- Need to test against production database type before deployment

## Implementation Details

```javascript
// Development configuration
DATABASE_URL = 'file:./prisma/dev.db';

// Test configuration with in-memory database
USE_IN_MEMORY_DB = true;
DATABASE_URL = 'file::memory:?cache=shared';

// Production would use
DATABASE_URL = 'postgresql://...';
```

## Alternatives Considered

1. **PostgreSQL for everything**:
   - Pros: Same database everywhere, no compatibility issues
   - Cons: Requires PostgreSQL installation, slower tests, complex CI setup
   - Rejected due to developer friction and test performance

2. **MySQL/MariaDB**:
   - Pros: More production-like than SQLite
   - Cons: Similar setup complexity to PostgreSQL
   - Rejected for same reasons as PostgreSQL

3. **MongoDB**:
   - Pros: Easy setup, good for document storage
   - Cons: Would require different ORM, significant code changes
   - Rejected due to relational data model requirements

4. **Docker-based databases**:
   - Pros: Consistent environment, production-like
   - Cons: Requires Docker, slower startup, resource intensive
   - Rejected due to complexity for simple development needs

## Mitigation Strategies

1. Use Prisma's database-agnostic query methods where possible
2. Run integration tests against production database type in CI
3. Document any SQLite-specific behaviors
4. Use transactions for test isolation to avoid file locking issues

## References

- [Prisma SQLite Documentation](https://www.prisma.io/docs/concepts/database-connectors/sqlite)
- [SQLite In-Memory Databases](https://www.sqlite.org/inmemorydb.html)
- Performance benchmarks in `/docs/benchmarks/database-performance.md`
