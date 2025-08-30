# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
npm run setup     # Complete setup (install + migrate + generate)
npm run dev       # Start both client and server (recommended)
```

## Architecture Overview

This is a **monorepo** with client and server in the same directory:

- **Client**: React 19 + TypeScript + Vite (port 3000)
- **Server**: Express.js + TypeScript + Prisma ORM (port 3001)
- **Database**: SQLite with Prisma ORM
- **Authentication**: JWT with bcrypt password hashing

## Development Commands

### Development Servers

```bash
npm run dev                    # Both servers concurrently (recommended)
npm run dev:client            # Client server with host binding (port 3000)
npm run dev:server            # Server with watch mode (port 3001)
npm run dev:debug             # Server in debug mode with inspector

# Legacy aliases (for backward compatibility)
npm run dev:frontend          # Alias for client server
npm run dev:backend           # Alias for server
```

### Code Quality

```bash
# Primary workflow - consolidated quality checks
npm run quality               # Run lint:fix + format + typecheck (recommended)

# Individual quality commands
npm run lint                  # Lint all files
npm run lint:fix             # Auto-fix linting issues
npm run lint:server          # Lint server code only
npm run lint:client          # Lint client code only
npm run lint:shared          # Lint shared code only
npm run lint:staged          # Lint staged files only
npm run lint:watch           # Lint in watch mode
npm run lint:quiet           # Suppress warnings, errors only
npm run format               # Format code with Prettier
npm run typecheck            # TypeScript type checking
```

### Testing

```bash
# Primary test workflows
npm run test:all            # Run coverage + e2e tests (comprehensive)
npm run test                # Unit tests in watch mode
npm run test:coverage       # Unit tests with coverage report
npm run test:e2e            # End-to-end tests (Playwright)

# Granular test options
npm run test:run            # Unit tests once (no watch)
npm run test:watch          # Unit tests in watch mode
npm run test:ui             # Unit tests with Vitest UI
npm run test:debug          # Unit tests in debug mode
npm run test:unit           # Unit tests only (src/ directory)
npm run test:integration    # Integration tests only
npm run test:server         # Server-side tests only
npm run test:client         # Client-side tests only
npm run test:e2e:ui         # E2E tests with Playwright UI
npm run test:e2e:headed     # E2E tests in headed mode
npm run test:e2e:debug      # E2E tests in debug mode
```

### Build and Production

```bash
npm run build               # Build for production
npm run build:watch         # Build in watch mode
npm run build:analyze       # Build with bundle analysis
npm run start               # Start production server
npm run preview             # Preview production build locally
```

### Performance Monitoring

```bash
npm run perf                # Run Lighthouse CI autorun
npm run perf:local          # Run Lighthouse locally with viewer
npm run perf:report         # Generate performance reports
```

### Database Management

```bash
npm run db:migrate          # Run database migrations
npm run db:generate         # Generate Prisma client
npm run db:studio           # Open Prisma Studio
npm run db:seed             # Seed database with test data
npm run db:reset            # Reset database (destructive)
```

### Debugging Tools

```bash
npm run debug               # Start server in debug mode
npm run debug:test          # Debug test execution
npm run debug:build         # Development build with sourcemaps
```

### Utility Scripts

```bash
# Clean utilities
npm run clean               # Complete cleanup (build + cache + test artifacts)
npm run clean:build         # Build artifacts only
npm run clean:cache         # Cache files only
npm run clean:test          # Test artifacts only
npm run clean:db            # Database files

# Fresh install and reset
npm run fresh               # Complete dependency reset (remove node_modules + reinstall)
npm run reset               # Application reset (clean + database reset + setup)
```

### Complete Workflows

```bash
npm run quality             # All quality checks (lint:fix + format + typecheck)
npm run test:all            # All tests (coverage + e2e)
npm run ci                  # Complete CI pipeline (quality + test:all)
```

## Development Rules and Best Practices

### Mandatory Pre-Commit Checks

- **Run before any task can be considered finished**: `npm run quality`
- Includes: lint:fix, format, typecheck

### Testing Strategy

This project uses a multi-layered testing approach:

1. **Unit Tests** (Vitest) - Fast, isolated component testing
2. **Integration Tests** (Jest) - API and database interaction testing
3. **E2E Tests** (Playwright) - Full user workflow testing
4. **Code Coverage** - Maintain >80% code coverage

### Test File Organization

```
tests/
├── e2e/                    # End-to-end tests (Playwright)
├── integration/            # API & database tests (Jest)
├── accessibility/          # WCAG compliance tests
└── src/                   # Unit tests (Vitest) - co-located
```

### Basic Troubleshooting

#### Common Issues

**Database Issues**

```bash
npm run db:reset            # Reset database if migrations fail
npm run db:generate         # Regenerate Prisma client
```

**Build Issues**

```bash
npm run clean               # Clean build artifacts
npm run fresh               # Complete dependency reset
```

**Test Issues**

```bash
npm run test:debug          # Debug failing unit tests
npm run test:e2e:debug      # Debug failing E2E tests
```

## Additional Documentation

For detailed troubleshooting, testing patterns, and historical information, see:

- `docs/CI_TROUBLESHOOTING.md` - Comprehensive CI debugging guide
- `docs/TEST_PATTERNS.md` - Detailed testing patterns and examples
- `docs/TEST_DEBUGGING_GUIDE.md` - Advanced debugging techniques
- `docs/README.md` - Documentation navigation guide
