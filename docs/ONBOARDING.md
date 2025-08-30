# Developer Onboarding Guide

Welcome to the Running App MVP! This guide will help you get up and running with the project in under 30 minutes.

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Architecture Overview](#architecture-overview)
- [Common Development Workflows](#common-development-workflows)
- [Testing Strategy](#testing-strategy)
- [Debugging Tips](#debugging-tips)
- [Troubleshooting](#troubleshooting)
- [Additional Resources](#additional-resources)

## Quick Start

If you want to get the app running immediately:

```bash
# Clone the repository
git clone <repository-url>
cd running-app-mvp

# Install dependencies and set up the database
npm run setup

# Start both frontend and backend
npm run dev:full

# Open http://localhost:3000 in your browser
```

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 20.0.0 (check with `node --version`)
- **npm** >= 10.0.0 (check with `npm --version`)
- **Git** (check with `git --version`)
- **VS Code** (recommended) or your preferred IDE

### Installing Prerequisites

#### macOS

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@20

# Verify installation
node --version
npm --version
```

#### Windows

1. Download and install Node.js from [nodejs.org](https://nodejs.org/)
2. Choose the LTS version (20.x)
3. The installer includes npm

#### Linux

```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Initial Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd running-app-mvp
```

### 2. Install Dependencies

```bash
# This installs all dependencies, sets up the database, and configures git hooks
npm run setup
```

This command will:

- Install npm dependencies
- Initialize the SQLite database
- Run initial migrations
- Generate Prisma client
- Set up git pre-commit hooks

### 3. Environment Configuration

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL="file:./prisma/dev.db"

# JWT Configuration
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000
```

### 4. Verify Setup

Run the following commands to verify everything is set up correctly:

```bash
# Check TypeScript compilation
npm run typecheck

# Run linting
npm run lint

# Run unit tests
npm run test:run

# Check database connection
npm run prisma:studio
```

## Architecture Overview

### Project Structure

```
running-app-mvp/
├── src/                    # Frontend source code (React)
│   ├── components/         # React components
│   ├── hooks/             # Custom React hooks
│   ├── services/          # API service layer
│   ├── types/             # TypeScript type definitions
│   └── utils/             # Utility functions
├── server/                # Backend source code (Express)
│   ├── routes/            # API route handlers
│   ├── middleware/        # Express middleware
│   ├── services/          # Business logic layer
│   └── utils/             # Server utilities
├── prisma/                # Database schema and migrations
│   ├── schema.prisma      # Database schema
│   └── migrations/        # Database migrations
├── tests/                 # Test files
│   ├── unit/             # Unit tests (Vitest)
│   ├── integration/      # Integration tests (Jest)
│   ├── e2e/              # End-to-end tests (Playwright)
│   └── setup/            # Test setup files
├── docs/                  # Documentation
├── scripts/              # Utility scripts
└── .github/workflows/    # CI/CD workflows
```

### Technology Stack

#### Frontend

- **React 18**: UI library
- **TypeScript**: Type safety
- **Vite**: Build tool and dev server
- **Tailwind CSS**: Styling
- **React Router**: Routing
- **Axios**: HTTP client

#### Backend

- **Express.js**: Web framework
- **TypeScript**: Type safety
- **Prisma ORM**: Database access
- **SQLite**: Database (development)
- **JWT**: Authentication
- **bcrypt**: Password hashing

#### Testing

- **Vitest**: Unit testing
- **Jest**: Integration testing
- **Playwright**: E2E testing
- **Testing Library**: React component testing

#### DevOps

- **GitHub Actions**: CI/CD
- **Husky**: Git hooks
- **ESLint**: Linting
- **Prettier**: Code formatting

### Database Schema

The main entities in the database:

```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  password  String
  name      String?
  runs      Run[]
  goals     Goal[]
  races     Race[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Run {
  id         Int      @id @default(autoincrement())
  userId     Int
  user       User     @relation(fields: [userId], references: [id])
  date       DateTime
  distance   Float
  duration   Int
  pace       Float?
  notes      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model Goal {
  id           Int      @id @default(autoincrement())
  userId       Int
  user         User     @relation(fields: [userId], references: [id])
  type         String
  targetValue  Float
  currentValue Float    @default(0)
  targetDate   DateTime
  achieved     Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Race {
  id         Int      @id @default(autoincrement())
  userId     Int
  user       User     @relation(fields: [userId], references: [id])
  name       String
  date       DateTime
  distance   Float
  targetTime Int?
  actualTime Int?
  notes      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

## Common Development Workflows

### Starting Development Servers

```bash
# Backend only (port 3001)
npm run dev

# Frontend only (port 3000)
npm run dev:frontend

# Both frontend and backend
npm run dev:full
```

### Making Code Changes

1. **Create a feature branch**:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**

3. **Run tests locally**:

   ```bash
   # Unit tests
   npm run test:run

   # Integration tests
   npm run test:integration

   # Specific test file
   npm run test -- path/to/test.spec.ts
   ```

4. **Check code quality**:

   ```bash
   # Run all checks
   npm run lint:check

   # Auto-fix issues
   npm run lint:fix
   ```

5. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   # Pre-commit hooks will run automatically
   ```

### Working with the Database

```bash
# Open Prisma Studio (visual database browser)
npm run prisma:studio

# Create a new migration
npx prisma migrate dev --name your_migration_name

# Apply migrations
npm run prisma:migrate

# Generate Prisma client after schema changes
npm run prisma:generate
```

### API Development

1. **Create a new route** in `server/routes/`
2. **Add middleware** if needed in `server/middleware/`
3. **Update types** in `src/types/`
4. **Add tests** in `tests/integration/api/`
5. **Document the endpoint** in API documentation

Example route structure:

```typescript
// server/routes/example.ts
import express from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// GET /api/example
router.get('/', authenticate, async (req, res) => {
  try {
    // Implementation
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

### Frontend Development

1. **Create components** in `src/components/`
2. **Add custom hooks** in `src/hooks/`
3. **Update API services** in `src/services/`
4. **Add component tests** in the same directory
5. **Use TypeScript** for all new code

Example component structure:

```typescript
// src/components/ExampleComponent.tsx
import React from 'react';

interface ExampleComponentProps {
  title: string;
  onAction: () => void;
}

export const ExampleComponent: React.FC<ExampleComponentProps> = ({
  title,
  onAction
}) => {
  return (
    <div className="p-4">
      <h2>{title}</h2>
      <button onClick={onAction}>Action</button>
    </div>
  );
};
```

## Testing Strategy

### Running Tests

```bash
# All tests with coverage
npm run test:coverage:all

# Unit tests only
npm run test:run

# Integration tests only
npm run test:integration

# E2E tests
npm run test:e2e

# Watch mode for development
npm run test:watch
```

### Writing Tests

#### Unit Tests (Vitest)

```typescript
// src/utils/calculations.test.ts
import { describe, it, expect } from 'vitest';
import { calculatePace } from './calculations';

describe('calculatePace', () => {
  it('should calculate pace correctly', () => {
    expect(calculatePace(5000, 1800)).toBe(6); // 6 min/km
  });
});
```

#### Integration Tests (Jest)

```typescript
// tests/integration/api/runs.test.ts
describe('Runs API', () => {
  it('should create a new run', async () => {
    const response = await request(app)
      .post('/api/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({ distance: 5, duration: 1800 });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
  });
});
```

#### E2E Tests (Playwright)

```typescript
// tests/e2e/auth-flow.test.ts
import { test, expect } from '@playwright/test';

test('user can log in', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL('/dashboard');
});
```

## Debugging Tips

### VS Code Debugging

1. **Install recommended extensions**:
   - ESLint
   - Prettier
   - Vitest Explorer
   - Jest Runner
   - Playwright Test for VS Code

2. **Use launch configurations** (F5 to start):
   - Debug Backend
   - Debug Frontend
   - Debug Tests
   - Debug Full Application

3. **Set breakpoints** by clicking left of line numbers

### Console Debugging

```typescript
// Use structured logging
console.log('API Request:', {
  method: req.method,
  path: req.path,
  body: req.body,
});

// Use debug namespaces
import debug from 'debug';
const log = debug('app:api:runs');
log('Processing run creation', { userId, distance });
```

### Browser DevTools

1. **React Developer Tools**: Inspect component state and props
2. **Network Tab**: Monitor API requests and responses
3. **Console**: Check for JavaScript errors
4. **Application Tab**: Inspect localStorage and cookies

## Troubleshooting

### Common Issues and Solutions

#### npm install fails

```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Database errors

```bash
# Reset database
rm prisma/dev.db
npm run prisma:migrate

# Check database file permissions
ls -la prisma/
```

#### Port already in use

```bash
# Find process using port 3001
lsof -i :3001

# Kill the process
kill -9 <PID>

# Or use different port
PORT=3002 npm run dev
```

#### TypeScript errors

```bash
# Regenerate types
npm run prisma:generate

# Check TypeScript version
npx tsc --version

# Clear TypeScript cache
rm -rf node_modules/.cache
```

#### Test failures

```bash
# Run tests in debug mode
npm run test -- --reporter=verbose

# Run specific test
npm run test -- path/to/test.spec.ts

# Update snapshots if needed
npm run test -- -u
```

### Getting Help

1. **Check existing documentation**:
   - [API Documentation](./API_DOCUMENTATION.md)
   - [Test Patterns](./TEST_PATTERNS.md)
   - [Troubleshooting Guide](./TROUBLESHOOTING.md)
   - [Architecture Decision Records](./adr/)

2. **Search for similar issues**:

   ```bash
   # Search codebase
   grep -r "search term" .

   # Search git history
   git log --grep="search term"
   ```

3. **Ask for help**:
   - Create an issue in the repository
   - Contact the team lead
   - Check team documentation

## Additional Resources

### Project Documentation

- [CLAUDE.md](../CLAUDE.md) - AI assistant instructions
- [API_ERRORS.md](../API_ERRORS.md) - Error handling conventions
- [PRE_COMMIT_HOOKS.md](./PRE_COMMIT_HOOKS.md) - Git hooks guide
- [TEST_DEBUGGING_GUIDE.md](./TEST_DEBUGGING_GUIDE.md) - Debugging tests

### External Resources

- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)
- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)

### Learning Path

1. **Week 1**:
   - Complete this onboarding
   - Run the application locally
   - Explore the codebase structure
   - Make a small bug fix or documentation update

2. **Week 2**:
   - Implement a small feature
   - Write tests for your feature
   - Submit your first PR
   - Review another developer's PR

3. **Week 3+**:
   - Take on larger features
   - Contribute to architecture decisions
   - Help onboard new developers
   - Improve documentation

## Next Steps

1. **Set up your development environment** following this guide
2. **Run the application** and explore its features
3. **Read the codebase** starting with `server.ts` and `src/App.tsx`
4. **Check the issue tracker** for beginner-friendly tasks
5. **Join the team chat** and introduce yourself

Welcome to the team! 🚀
