# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Running App MVP project.

## What is an ADR?

An Architecture Decision Record captures an important architectural decision made along with its context and consequences. ADRs help future developers understand not just *what* decisions were made, but *why* they were made and what alternatives were considered.

## Index of ADRs

1. [Record Architecture Decisions](0001-record-architecture-decisions.md) - Why we're using ADRs
2. [Use SQLite for Development](0002-use-sqlite-for-development.md) - Database choice for development/testing
3. [Separate Test Frameworks](0003-separate-test-frameworks.md) - Testing strategy with Vitest, Jest, and Playwright
4. [JWT Authentication](0004-jwt-authentication.md) - Authentication approach using JSON Web Tokens
5. [Monorepo Structure](0005-monorepo-structure.md) - Single repository for frontend and backend
6. [Prisma ORM](0006-prisma-orm.md) - Database abstraction and type safety
7. [GitHub Actions CI](0007-github-actions-ci.md) - Continuous integration and deployment platform
8. [Vite Bundler](0008-vite-bundler.md) - Frontend build tool and development server

## ADR Template

When creating a new ADR, use this template:

```markdown
# [Number]. [Title]

Date: YYYY-MM-DD

## Status

[Accepted | Deprecated | Superseded by ADR-XXX]

## Context

[Describe the issue motivating this decision]

## Decision

[Describe the decision and rationale]

## Consequences

### Positive
- [Positive consequence 1]
- [Positive consequence 2]

### Negative
- [Negative consequence 1]
- [Negative consequence 2]

## Alternatives Considered

1. **[Alternative 1]**:
   - Pros: [...]
   - Cons: [...]
   - Rejected because: [...]

## References

- [Link to relevant documentation]
```

## Creating New ADRs

1. Copy the template above
2. Create a new file with the next number in sequence: `XXXX-descriptive-name.md`
3. Fill in all sections
4. Update this README with the new ADR in the index
5. Link to the new ADR from any related ADRs

## Best Practices

- **Be concise but complete**: Include enough context for someone unfamiliar with the project
- **Include alternatives**: Document what else was considered and why it was rejected
- **Link to evidence**: Include links to benchmarks, documentation, or discussions
- **Update status**: Mark ADRs as deprecated or superseded when decisions change
- **Reference related ADRs**: Link between related decisions

## Review Process

1. Create ADR as part of the implementation PR
2. Tag relevant team members for review
3. Discuss in PR comments
4. Merge along with the implementation

## When to Write an ADR

Write an ADR when:
- Choosing between significant architectural options
- Making decisions that will be hard to reverse
- Selecting key technologies or frameworks
- Establishing important patterns or practices
- Deprecating or changing previous decisions

## When NOT to Write an ADR

Don't write an ADR for:
- Minor implementation details
- Easily reversible decisions
- Standard practices that follow established patterns
- Bug fixes or small features