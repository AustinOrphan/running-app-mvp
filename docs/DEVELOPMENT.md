# Development Guide

> **Comprehensive guide for developing the Running App MVP**  
> **Updated**: 2025-01-09  
> **For**: Developers and Contributors

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Environment](#development-environment)
3. [Project Structure](#project-structure)
4. [Development Workflow](#development-workflow)
5. [Testing](#testing)
6. [Code Quality](#code-quality)
7. [Database Management](#database-management)
8. [API Development](#api-development)
9. [Frontend Development](#frontend-development)
10. [Deployment](#deployment)
11. [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites

- **Node.js**: v22.16.0 (use `nvm use` to switch automatically)
- **npm**: v10.x (comes with Node.js)
- **Git**: Latest version
- **VS Code**: Recommended IDE

### Quick Setup

```bash
# Clone the repository
git clone https://github.com/AustinOrphan/running-app-mvp.git
cd running-app-mvp

# Use correct Node.js version
nvm use

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Set up database
npx prisma migrate dev --name init
npx prisma generate

# Start development servers
npm run dev:full
```

### Manual Setup

If you prefer to run servers separately:

```bash
# Terminal 1: Backend server
npm run dev

# Terminal 2: Frontend server  
npm run dev:frontend
```

## Development Environment

### Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL="file:./dev.db"

# Authentication
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# Logging
LOG_SALT="set-a-strong-random-string-for-production"

# Server
PORT=3001
NODE_ENV=development

# Frontend (optional)
VITE_API_URL="http://localhost:3001"
```

### IDE Configuration

#### VS Code Extensions (Recommended)
- **ES7+ React/Redux/React-Native snippets**
- **Prettier - Code formatter**
- **ESLint**
- **TypeScript Importer**
- **Prisma**
- **Auto Rename Tag**
- **Bracket Pair Colorizer**

#### VS Code Settings
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.preferences.importModuleSpecifier": "relative",
  "emmet.includeLanguages": {
    "typescript": "html",
    "typescriptreact": "html"
  }
}
```

## Project Structure

```
running-app-mvp/
├── src/                      # Frontend React code
│   ├── components/           # React components
│   │   ├── Auth/            # Authentication components
│   │   ├── Goals/           # Goal-related components
│   │   ├── Navigation/      # Navigation components
│   │   ├── Pages/           # Page components
│   │   ├── Runs/            # Run-related components
│   │   └── Stats/           # Statistics components
│   ├── hooks/               # Custom React hooks
│   ├── pages/               # Page components
│   ├── types/               # TypeScript type definitions
│   ├── utils/               # Frontend utility functions
│   └── styles/              # CSS modules and styles
├── routes/                  # Backend API routes
│   ├── auth.ts             # Authentication endpoints
│   ├── goals.ts            # Goal management endpoints
│   ├── races.ts            # Race management endpoints
│   ├── runs.ts             # Run tracking endpoints
│   └── stats.ts            # Statistics endpoints
├── middleware/             # Express middleware
│   ├── errorHandler.ts     # Error handling middleware
│   ├── requireAuth.ts      # Authentication middleware
│   └── validateBody.ts     # Request validation middleware
├── utils/                  # Backend utility functions
│   ├── apiFetch.ts         # API client utilities
│   ├── logger.ts           # Logging utilities
│   └── databaseErrorHandler.ts
├── prisma/                 # Database schema and migrations
│   ├── schema.prisma       # Database schema
│   └── migrations/         # Database migrations
├── tests/                  # Test files
│   ├── unit/               # Unit tests
│   ├── integration/        # Integration tests
│   └── e2e/                # End-to-end tests
├── docs/                   # Documentation
└── scripts/                # Build and utility scripts
```

## Development Workflow

### Branch Strategy

- **`main`**: Production-ready code
- **`feature/feature-name`**: New features
- **`fix/bug-description`**: Bug fixes
- **`cleanup/task-name`**: Code cleanup and refactoring

### Development Process

1. **Create a branch** from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/new-feature
   ```

2. **Make your changes** following the coding standards

3. **Test your changes**:
   ```bash
   npm run test:all
   npm run lint
   npm run typecheck
   ```

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. **Push and create PR**:
   ```bash
   git push -u origin feature/new-feature
   gh pr create
   ```

### Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test additions or changes
- `chore:` - Maintenance tasks

## Testing

### Test Structure

```
tests/
├── unit/                    # Unit tests
│   ├── components/         # Component tests
│   ├── hooks/              # Hook tests
│   └── utils/              # Utility function tests
├── integration/            # Integration tests
│   └── api/                # API endpoint tests
├── e2e/                    # End-to-end tests
└── fixtures/               # Test data and mocks
```

### Running Tests

```bash
# All tests
npm run test:all

# Unit tests only
npm test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Writing Tests

#### Unit Test Example
```typescript
// tests/unit/utils/formatters.test.ts
import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../../src/utils/formatters';

describe('formatDuration', () => {
  it('should format seconds correctly', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});
```

#### Integration Test Example
```typescript
// tests/integration/api/auth.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../server';

describe('POST /api/auth/login', () => {
  it('should return token for valid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password' });
    
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });
});
```

## Code Quality

### ESLint Configuration

The project uses ESLint for code linting:

```bash
# Check for linting errors
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Lint specific areas
npm run lint:server
npm run lint:frontend
```

### Prettier Configuration

Code formatting is handled by Prettier:

```bash
# Format all code
npm run format

# Check formatting
npm run format:check
```

### TypeScript

```bash
# Type check all files
npm run typecheck

# Type check specific files
npx tsc --noEmit src/components/MyComponent.tsx
```

## Database Management

### Prisma Commands

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Open Prisma Studio
npm run prisma:studio

# Reset database
npx prisma migrate reset
```

### Database Schema

The database schema is defined in `prisma/schema.prisma`:

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String
  runs      Run[]
  goals     Goal[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Run {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  distance  Float
  duration  Int
  date      DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Migration Workflow

1. **Modify schema** in `prisma/schema.prisma`
2. **Create migration**:
   ```bash
   npx prisma migrate dev --name description-of-change
   ```
3. **Generate client**:
   ```bash
   npx prisma generate
   ```

## API Development

### Creating New Endpoints

1. **Add route handler** in appropriate file (`routes/`)
2. **Add middleware** if needed
3. **Update types** in `types/`
4. **Add tests** in `tests/integration/api/`

#### Example Route Handler

```typescript
// routes/example.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { validateBody } from '../middleware/validateBody';
import { createError } from '../utils/createError';
import { z } from 'zod';

const router = Router();

const createExampleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

router.post('/examples', requireAuth, validateBody(createExampleSchema), async (req, res, next) => {
  try {
    const example = await prisma.example.create({
      data: {
        ...req.body,
        userId: req.user.id,
      },
    });
    res.status(201).json(example);
  } catch (error) {
    return next(createError('Failed to create example', 500));
  }
});

export default router;
```

### API Documentation

API endpoints are documented inline. Key patterns:

- **Authentication**: Most endpoints require `requireAuth` middleware
- **Validation**: Use Zod schemas for request validation
- **Error Handling**: Always use `return next(error)` pattern
- **Response Format**: Consistent JSON responses

## Frontend Development

### Component Structure

```typescript
// src/components/Example/ExampleComponent.tsx
import React from 'react';
import styles from './ExampleComponent.module.css';

interface ExampleComponentProps {
  title: string;
  description?: string;
  onClick?: () => void;
}

export const ExampleComponent: React.FC<ExampleComponentProps> = ({
  title,
  description,
  onClick,
}) => {
  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{title}</h2>
      {description && <p className={styles.description}>{description}</p>}
      {onClick && (
        <button className={styles.button} onClick={onClick}>
          Click me
        </button>
      )}
    </div>
  );
};
```

### CSS Modules

Use CSS Modules for styling:

```css
/* src/components/Example/ExampleComponent.module.css */
.container {
  padding: 1rem;
  border: 1px solid #ccc;
  border-radius: 8px;
}

.title {
  font-size: 1.5rem;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.description {
  color: #666;
  margin-bottom: 1rem;
}

.button {
  background-color: #007bff;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
}

.button:hover {
  background-color: #0056b3;
}
```

### Custom Hooks

```typescript
// src/hooks/useExample.ts
import { useState, useEffect } from 'react';
import { apiGet } from '../utils/apiFetch';

export const useExample = (id: string) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchExample = async () => {
      try {
        const response = await apiGet(`/api/examples/${id}`);
        setData(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchExample();
  }, [id]);

  return { data, loading, error };
};
```

## Deployment

### Production Build

```bash
# Build the application
npm run build

# Start production server
npm start
```

### Environment Variables for Production

```env
DATABASE_URL="postgresql://username:password@localhost:5432/mydb"
JWT_SECRET="strong-production-secret"
LOG_SALT="strong-production-salt"
NODE_ENV=production
PORT=3001
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## Troubleshooting

### Common Issues

#### Backend Won't Start
```bash
# Check if port is in use
lsof -i :3001

# Kill process using port
kill -9 $(lsof -t -i:3001)

# Check database connection
npx prisma studio
```

#### Frontend Won't Connect to Backend
```bash
# Check if backend is running
curl http://localhost:3001/api/health

# Check proxy configuration in vite.config.ts
# Ensure both servers are running
```

#### Database Issues
```bash
# Reset database
npx prisma migrate reset

# Regenerate client
npx prisma generate

# Check database file exists
ls -la prisma/dev.db
```

#### Test Failures
```bash
# Clear test cache
npm run test:clean

# Run specific test
npm test -- --run specific-test

# Update test snapshots
npm test -- --update-snapshots
```

### Performance Issues

#### Slow API Responses
- Check database query performance
- Add database indexes if needed
- Use Prisma query profiling

#### Frontend Bundle Size
```bash
# Analyze bundle size
npm run build
npx vite-bundle-analyzer dist
```

### Development Tools

#### Database Inspection
```bash
# Open Prisma Studio
npm run prisma:studio

# Direct SQLite access
sqlite3 prisma/dev.db
```

#### API Testing
```bash
# Use curl for API testing
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'
```

## Additional Resources

- **Prisma Documentation**: https://www.prisma.io/docs
- **React Documentation**: https://react.dev
- **Express.js Documentation**: https://expressjs.com
- **Vitest Documentation**: https://vitest.dev
- **Playwright Documentation**: https://playwright.dev

## Getting Help

1. **Check existing issues**: Look for similar problems in GitHub issues
2. **Check documentation**: Review relevant sections of this guide
3. **Ask questions**: Create a GitHub issue with the question template
4. **Code review**: Request review from team members

---

**Last Updated**: 2025-01-09  
**Maintained By**: Development Team  
**Next Review**: 2025-02-09