# 6. Use Prisma as ORM

Date: 2025-07-28

## Status

Accepted

## Context

We needed a database abstraction layer that would:
- Provide type safety with TypeScript
- Support multiple database backends
- Handle migrations elegantly
- Offer good developer experience
- Generate efficient SQL queries
- Support our chosen databases (SQLite for dev, potentially PostgreSQL for production)

## Decision

We will use Prisma as our ORM (Object-Relational Mapping) tool.

Key features we'll utilize:
- Prisma Schema for model definition
- Prisma Client for type-safe database access
- Prisma Migrate for schema migrations
- Prisma Studio for database GUI

## Consequences

### Positive
- Excellent TypeScript support with generated types
- Intuitive schema definition language
- Automatic migration generation
- Built-in GUI for data exploration (Prisma Studio)
- Support for multiple databases with same schema
- Great developer experience
- Active community and regular updates
- Protects against SQL injection by default

### Negative
- Additional build step (generation)
- Learning curve for Prisma-specific syntax
- Less flexibility than raw SQL for complex queries
- Migration rollbacks are not straightforward
- Some operations require raw SQL fallback
- Potential vendor lock-in

## Implementation Details

### Schema Definition
```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String
  goals     Goal[]
  runs      Run[]
  races     Race[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Type-Safe Queries
```typescript
const userWithGoals = await prisma.user.findUnique({
  where: { email: 'user@example.com' },
  include: { 
    goals: {
      where: { isActive: true }
    }
  }
});
// TypeScript knows the exact shape of userWithGoals
```

### Migration Workflow
```bash
npx prisma migrate dev --name add_user_table
npx prisma generate
npx prisma migrate deploy  # For production
```

## Alternatives Considered

1. **TypeORM**:
   - Pros: Decorator-based, more "traditional" ORM
   - Cons: Less type safety, more verbose
   - Rejected due to inferior TypeScript support

2. **Sequelize**:
   - Pros: Mature, lots of features
   - Cons: Poor TypeScript support, verbose API
   - Rejected due to lack of type safety

3. **Raw SQL with pg/sqlite3**:
   - Pros: Full control, best performance
   - Cons: No type safety, manual everything
   - Rejected due to development velocity concerns

4. **Knex.js**:
   - Pros: Flexible query builder, good migration support
   - Cons: No built-in type generation
   - Rejected in favor of Prisma's superior DX

5. **Drizzle ORM**:
   - Pros: Type-safe, SQL-like syntax, lighter weight
   - Cons: Less mature, smaller community
   - Rejected due to maturity concerns (reconsidered in future)

## Performance Considerations

1. Use `select` to limit fields returned
2. Be mindful of N+1 queries with relations
3. Use raw SQL for complex aggregations
4. Enable query logging in development
5. Consider connection pooling for production

## Migration Strategy

1. Always review generated SQL before applying migrations
2. Test migrations on a copy of production data
3. Keep migrations small and focused
4. Document any manual migration steps
5. Use `prisma migrate reset` carefully (dev only)

## Future Considerations

- Evaluate Drizzle ORM as it matures
- Consider adding a caching layer (Redis)
- Implement read replicas if needed
- Add database query monitoring

## References

- [Prisma Documentation](https://www.prisma.io/docs)
- [Prisma vs TypeORM](https://www.prisma.io/docs/concepts/more/comparisons/prisma-and-typeorm)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)