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

## Architecture Overview

### Full-Stack Structure

This is a **monorepo** with frontend and backend in the same directory:

- **Frontend**: React 18 + TypeScript + Vite (port 3000)
- **Backend**: Express.js + TypeScript + Prisma ORM (port 3001)
- **Database**: SQLite with Prisma ORM
- **Authentication**: JWT with bcrypt password hashing

[... rest of the file remains unchanged ...]