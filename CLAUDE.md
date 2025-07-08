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

## Architecture Overview

### Full-Stack Structure
This is a **monorepo** with frontend and backend in the same directory:
- **Frontend**: React 18 + TypeScript + Vite (port 3000)
- **Backend**: Express.js + TypeScript + Prisma ORM (port 3001)
- **Database**: SQLite with Prisma ORM
- **Authentication**: JWT with bcrypt password hashing

### Key Directory Structure
```
src/                     # Frontend React application
├── components/          # React components (organized by feature)
├── pages/              # Page-level components
├── hooks/              # Custom React hooks
├── utils/              # Frontend utilities
├── types/              # TypeScript type definitions
└── constants/          # Frontend constants

routes/                 # Backend API routes
├── auth.ts            # Authentication endpoints
├── runs.ts            # Running data CRUD
├── goals.ts           # Goals management
├── races.ts           # Race tracking
└── stats.ts           # Statistics and analytics

middleware/            # Express middleware
├── auth.ts           # JWT authentication
├── errorHandler.ts   # Global error handling
├── rateLimiting.ts   # Rate limiting
└── validation.ts     # Input validation & security headers

prisma/               # Database schema and migrations
server.ts             # Express server entry point
```

### Frontend Architecture Patterns

#### Component Organization
- **Feature-based structure**: Components grouped by domain (Goals/, Auth/, Stats/, etc.)
- **Shared components**: Common/ directory for reusable UI elements
- **Page components**: Top-level route components in pages/

#### State Management
- **React hooks** for local state and side effects
- **Custom hooks** for business logic (useAuth, useRuns, useGoals, etc.)
- **Context providers** for global state (HealthCheckContext)

#### Key Custom Hooks
- `useAuth`: Authentication state and operations
- `useRuns`: Running data management
- `useGoals`: Goals CRUD and progress tracking
- `useStats`: Statistics and analytics
- `useToast`: Notification system
- `useHealthCheck`: Backend health monitoring

### Backend Architecture Patterns

#### Express Structure
- **Route-based organization**: Each domain has its own route file
- **Middleware chain**: Security → Rate limiting → Auth → Routes → Error handling
- **Prisma integration**: Database operations with type safety

#### Error Handling
- **Async wrapper pattern**: All async routes wrapped with error handlers
- **Global error middleware**: Centralized error processing
- **Secure logging**: PII sanitization in logs

#### Authentication Flow
- JWT tokens for stateless authentication
- Protected routes using auth middleware
- Password hashing with bcrypt
- User isolation by ID in all queries

### Database Design

#### Core Models
- **User**: Authentication and profile data
- **Run**: Individual running activities with metrics
- **Goal**: User-defined targets with progress tracking
- **Race**: Scheduled events and competitions

#### Key Relationships
- Users own Runs, Goals, and Races (1:many)
- Goals track progress against Runs
- All data is user-isolated

### Frontend-Backend Integration

#### API Communication
- **REST API** with `/api` prefix
- **Vite proxy** forwards frontend `/api` requests to backend
- **Error boundaries** and loading states for resilience
- **Health checks** for connectivity monitoring

#### Development Workflow
- Backend and frontend run independently
- Hot reload on both sides
- Shared TypeScript types between frontend and backend
- Unified linting and formatting rules

### Testing Strategy

#### Multi-Level Testing
- **Unit tests**: Vitest for React components and utilities
- **Integration tests**: Jest for API endpoints and database operations
- **E2E tests**: Playwright for full user workflows
- **Accessibility tests**: Axe-core integration
- **Visual regression**: Playwright screenshots

#### Test Environment
- Isolated test database for integration tests
- Mock API responses for frontend unit tests
- Test utilities for common patterns

### Security Considerations

#### Backend Security
- Rate limiting on all routes
- Security headers middleware
- Input validation with Zod schemas
- SQL injection protection via Prisma
- Password hashing with bcrypt
- JWT secret management via environment variables

#### Frontend Security
- XSS protection through React's built-in escaping
- CSRF protection through JWT token validation
- Secure cookie handling
- PII sanitization in client-side logging

### Development Guidelines

#### Code Quality Standards
- **TypeScript strict mode** enabled
- **ESLint + Prettier** with custom rules for async error handling
- **Import organization**: Absolute imports with `@/*` alias
- **Consistent naming**: camelCase for variables, PascalCase for components

#### Error Handling Patterns
- **Async/await** with proper try-catch blocks
- **Error boundaries** in React components
- **Global error handler** for unhandled Promise rejections
- **Secure logging** with PII sanitization

#### Performance Considerations
- **Lazy loading** for route components
- **Optimized builds** with Vite
- **Database indexing** on frequently queried fields
- **Rate limiting** to prevent abuse

### Environment Configuration

#### Required Environment Variables
- `DATABASE_URL`: SQLite database file path
- `JWT_SECRET`: Secret key for JWT token signing
- `LOG_SALT`: Salt for PII anonymization in logs
- `PORT`: Backend server port (default: 3001)
- `NODE_ENV`: Environment (development/production)

#### Port Configuration
- Frontend: 3000 (Vite dev server)
- Backend: 3001 (Express server)
- Prisma Studio: 5555 (when running)
