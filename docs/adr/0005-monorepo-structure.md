# 5. Monorepo Structure for Frontend and Backend

Date: 2025-07-28

## Status

Accepted

## Context

We needed to decide how to structure our codebase for a full-stack application with:
- React frontend (Vite)
- Express.js backend
- Shared TypeScript types
- Common utilities
- Unified deployment process

## Decision

We will use a monorepo structure with frontend and backend code in the same repository:

```
running-app-mvp/
├── src/                    # Frontend React code
├── server/                 # Backend Express code
├── prisma/                 # Database schema and migrations
├── tests/                  # All test files
├── docs/                   # Documentation
├── package.json            # Single package.json for all dependencies
└── tsconfig.json          # Shared TypeScript configuration
```

## Consequences

### Positive
- Simplified dependency management with single package.json
- Atomic commits across frontend and backend
- Easier code sharing (types, utilities)
- Simplified CI/CD pipeline
- Single source of truth for configuration
- Easier local development setup
- Better for small to medium projects

### Negative
- Frontend and backend dependencies mixed
- Can't deploy frontend and backend independently
- Larger repository size
- Less clear separation of concerns
- Potential for accidental coupling
- Single version number for everything

## Implementation Details

### Development Scripts
```json
{
  "scripts": {
    "dev": "tsx watch server.ts",           // Backend
    "dev:frontend": "vite",                 // Frontend
    "dev:full": "concurrently npm:dev npm:dev:frontend"
  }
}
```

### Build Process
- Frontend builds to `dist/`
- Backend TypeScript compiles to `dist/`
- Static files served by Express in production

### Shared Code
- TypeScript types in `/types`
- Utilities in both `/src/utils` and `/server/utils`
- Validation schemas shared via Zod

## Alternatives Considered

1. **Separate repositories**:
   - Pros: Clear separation, independent deployment, smaller repos
   - Cons: Complex dependency management, harder code sharing
   - Rejected due to added complexity for small team

2. **Nx or Lerna monorepo**:
   - Pros: Better monorepo tooling, independent versioning
   - Cons: Additional complexity, learning curve
   - Rejected as overkill for our current needs

3. **Yarn workspaces**:
   - Pros: Better dependency management, some code isolation
   - Cons: More complex setup, potential hoisting issues
   - Rejected in favor of simplicity

4. **Docker-based separation**:
   - Pros: Clear boundaries, production-like development
   - Cons: Complex local setup, resource intensive
   - Rejected for development (still used for deployment)

## Migration Path

If we need to split later:
1. Move `/server` to separate repository
2. Extract shared types to npm package
3. Set up separate CI/CD pipelines
4. Configure cross-repository workflows

## Best Practices

1. Keep frontend and backend code clearly separated in folders
2. Avoid importing backend code in frontend
3. Use TypeScript project references if needed
4. Regular dependency audits to avoid bloat
5. Consider splitting when team grows beyond 5-6 developers

## References

- [Monorepo vs Polyrepo](https://monorepo.tools/)
- [Vite Backend Integration](https://vitejs.dev/guide/backend-integration.html)
- Team size and complexity guidelines from ThoughtWorks Technology Radar