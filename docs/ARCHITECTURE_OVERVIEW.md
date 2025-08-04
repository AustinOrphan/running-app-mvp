# Architecture Overview

This document provides a comprehensive overview of the Running App MVP architecture, design decisions, and system components.

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    React SPA (Vite)                      │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │ Components  │  │    Hooks     │  │   Services   │  │   │
│  │  └─────────────┘  └──────────────┘  └──────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTP/REST
┌─────────────────────────────────┴───────────────────────────────┐
│                         Backend (Node.js)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Express.js Server                     │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │   Routes    │  │  Middleware  │  │  Services    │  │   │
│  │  └─────────────┘  └──────────────┘  └──────────────┘  │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                     │
│  ┌─────────────────────────┴───────────────────────────────┐   │
│  │                      Prisma ORM                          │   │
│  └─────────────────────────┬───────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                      SQLite Database                             │
└─────────────────────────────────────────────────────────────────┘
```

### Component Architecture

#### Frontend Architecture

```
src/
├── components/          # React components
│   ├── common/         # Shared components (Button, Modal, etc.)
│   ├── auth/           # Authentication components
│   ├── dashboard/      # Dashboard components
│   ├── runs/           # Run tracking components
│   ├── goals/          # Goal management components
│   └── races/          # Race planning components
├── hooks/              # Custom React hooks
│   ├── useAuth.ts      # Authentication hook
│   ├── useApi.ts       # API communication hook
│   └── useForm.ts      # Form handling hook
├── services/           # API service layer
│   ├── api.ts          # Base API configuration
│   ├── auth.ts         # Authentication services
│   ├── runs.ts         # Run-related API calls
│   ├── goals.ts        # Goal-related API calls
│   └── races.ts        # Race-related API calls
├── utils/              # Utility functions
│   ├── validation.ts   # Input validation
│   ├── formatting.ts   # Data formatting
│   └── calculations.ts # Pace/distance calculations
├── types/              # TypeScript definitions
│   ├── api.ts          # API response types
│   ├── models.ts       # Data model types
│   └── components.ts   # Component prop types
└── App.tsx             # Root component
```

#### Backend Architecture

```
server/
├── routes/             # Express route handlers
│   ├── auth.ts         # Authentication endpoints
│   ├── runs.ts         # Run CRUD operations
│   ├── goals.ts        # Goal CRUD operations
│   ├── races.ts        # Race CRUD operations
│   └── stats.ts        # Statistics endpoints
├── middleware/         # Express middleware
│   ├── auth.ts         # JWT authentication
│   ├── validation.ts   # Request validation
│   ├── errorHandler.ts # Error handling
│   └── rateLimiting.ts # Rate limiting
├── services/           # Business logic
│   ├── authService.ts  # Authentication logic
│   ├── runService.ts   # Run calculations
│   ├── goalService.ts  # Goal tracking logic
│   └── statsService.ts # Statistics generation
├── utils/              # Utility functions
│   ├── jwt.ts          # JWT helpers
│   ├── bcrypt.ts       # Password hashing
│   └── validators.ts   # Data validators
└── server.ts           # Express app initialization
```

## Data Flow

### Request Lifecycle

```
1. User Action (Frontend)
   ↓
2. React Component Event Handler
   ↓
3. API Service Call (axios)
   ↓
4. HTTP Request
   ↓
5. Express Middleware Pipeline
   - CORS
   - Body Parser
   - Rate Limiting
   - Authentication (if protected route)
   - Validation
   ↓
6. Route Handler
   ↓
7. Business Logic (Service Layer)
   ↓
8. Database Query (Prisma)
   ↓
9. Response Formatting
   ↓
10. HTTP Response
    ↓
11. Frontend State Update
    ↓
12. UI Re-render
```

### Authentication Flow

```
1. User Login
   - POST /api/auth/login
   - Validate credentials
   - Generate JWT token
   - Return token + user data

2. Authenticated Requests
   - Include JWT in Authorization header
   - Middleware validates token
   - Extract user ID from token
   - Process request with user context

3. Token Refresh
   - Check token expiration
   - Generate new token if needed
   - Update client storage
```

## Technology Decisions

### Frontend Technologies

#### React 18

- **Why**: Industry standard, large ecosystem, excellent DX
- **Key Features**: Hooks, Suspense, Concurrent rendering
- **Alternatives Considered**: Vue, Angular, Svelte

#### TypeScript

- **Why**: Type safety, better IDE support, fewer runtime errors
- **Configuration**: Strict mode enabled
- **Coverage**: 100% of frontend code

#### Vite

- **Why**: Fast HMR, minimal configuration, ES modules
- **Benefits**: Sub-200ms dev server start, instant updates
- **Alternatives Considered**: Create React App, Webpack

#### Tailwind CSS

- **Why**: Utility-first, consistent design, small bundle
- **Configuration**: Custom theme, PurgeCSS enabled
- **Alternatives Considered**: Styled Components, CSS Modules

### Backend Technologies

#### Express.js

- **Why**: Minimal, flexible, large middleware ecosystem
- **Configuration**: TypeScript, async error handling
- **Alternatives Considered**: Fastify, Koa, NestJS

#### Prisma ORM

- **Why**: Type-safe queries, excellent DX, migrations
- **Benefits**: Auto-generated types, visual studio
- **Alternatives Considered**: TypeORM, Sequelize, raw SQL

#### SQLite (Development)

- **Why**: Zero configuration, file-based, fast
- **Production**: Easy migration to PostgreSQL/MySQL
- **Alternatives Considered**: PostgreSQL, MySQL

#### JWT Authentication

- **Why**: Stateless, scalable, standard
- **Implementation**: RS256 algorithm, refresh tokens
- **Alternatives Considered**: Sessions, OAuth2

### Testing Strategy

#### Vitest (Unit Tests)

- **Why**: Fast, Vite-native, Jest-compatible
- **Coverage Target**: 80%+
- **Focus**: Business logic, utilities, components

#### Jest (Integration Tests)

- **Why**: Mature, extensive ecosystem
- **Focus**: API endpoints, database operations
- **Configuration**: In-memory database

#### Playwright (E2E Tests)

- **Why**: Modern, reliable, multi-browser
- **Coverage**: Critical user paths
- **Browsers**: Chrome, Firefox, Safari

## Design Patterns

### Frontend Patterns

#### Container/Presenter Pattern

```typescript
// Container (smart component)
const RunListContainer: React.FC = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const { loading, error } = useApi();

  useEffect(() => {
    fetchRuns().then(setRuns);
  }, []);

  return <RunList runs={runs} loading={loading} error={error} />;
};

// Presenter (dumb component)
const RunList: React.FC<RunListProps> = ({ runs, loading, error }) => {
  if (loading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  return <ul>{runs.map(run => <RunItem key={run.id} run={run} />)}</ul>;
};
```

#### Custom Hooks Pattern

```typescript
// Encapsulate logic in custom hooks
const useRuns = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    runService
      .getAll()
      .then(setRuns)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { runs, loading, error, refetch };
};
```

### Backend Patterns

#### Service Layer Pattern

```typescript
// Route handler delegates to service
router.post('/runs', authenticate, async (req, res, next) => {
  try {
    const run = await runService.create(req.user.id, req.body);
    res.status(201).json(run);
  } catch (error) {
    next(error);
  }
});

// Service contains business logic
class RunService {
  async create(userId: number, data: CreateRunDto) {
    // Validate business rules
    // Calculate derived fields
    // Save to database
    // Return formatted response
  }
}
```

#### Repository Pattern (via Prisma)

```typescript
// Data access abstracted through Prisma
const runRepository = {
  findAll: (userId: number) => prisma.run.findMany({ where: { userId } }),
  findById: (id: number) => prisma.run.findUnique({ where: { id } }),
  create: (data: RunData) => prisma.run.create({ data }),
  update: (id: number, data: Partial<RunData>) => prisma.run.update({ where: { id }, data }),
  delete: (id: number) => prisma.run.delete({ where: { id } }),
};
```

## Security Architecture

### Authentication & Authorization

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Server    │────▶│  Database   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │                    │
      │ 1. Login Request   │                    │
      │───────────────────▶│                    │
      │                    │ 2. Verify Password │
      │                    │───────────────────▶│
      │                    │◀───────────────────│
      │ 3. JWT Token       │                    │
      │◀───────────────────│                    │
      │                    │                    │
      │ 4. Auth Request    │                    │
      │───────────────────▶│                    │
      │                    │ 5. Validate Token  │
      │                    │ 6. Process Request │
      │                    │───────────────────▶│
      │ 7. Response        │◀───────────────────│
      │◀───────────────────│                    │
```

### Security Measures

1. **Password Security**
   - bcrypt with 10 rounds
   - Minimum 8 characters
   - Complexity requirements

2. **JWT Security**
   - Short expiration (7 days)
   - Secure httpOnly cookies (production)
   - Token refresh mechanism

3. **API Security**
   - Rate limiting (100 req/15min)
   - CORS configuration
   - Input validation
   - SQL injection prevention (Prisma)

4. **Data Protection**
   - HTTPS only (production)
   - Environment variables for secrets
   - No sensitive data in logs

## Performance Considerations

### Frontend Performance

1. **Code Splitting**
   - Route-based splitting
   - Lazy loading components
   - Dynamic imports

2. **Bundle Optimization**
   - Tree shaking
   - Minification
   - Compression (gzip/brotli)

3. **Caching Strategy**
   - Service worker (PWA)
   - Browser caching
   - API response caching

### Backend Performance

1. **Database Optimization**
   - Indexed queries
   - Connection pooling
   - Query optimization

2. **API Optimization**
   - Response compression
   - Pagination
   - Field selection

3. **Caching**
   - Redis (production)
   - In-memory cache (development)
   - CDN for static assets

## Scalability Considerations

### Horizontal Scaling

```
                    ┌─────────────┐
                    │ Load Balancer│
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐        ┌────▼────┐       ┌────▼────┐
   │Server 1 │        │Server 2 │       │Server 3 │
   └────┬────┘        └────┬────┘       └────┬────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Database   │
                    │  (Primary)  │
                    └──────┬──────┘
                           │
                ┌──────────┴──────────┐
                │                     │
          ┌─────▼─────┐         ┌─────▼─────┐
          │ Read Rep 1│         │ Read Rep 2│
          └───────────┘         └───────────┘
```

### Microservices Migration Path

Current monolith can be split into:

1. **Auth Service**: User management, authentication
2. **Run Service**: Run tracking, calculations
3. **Goal Service**: Goal management, progress tracking
4. **Race Service**: Race planning, results
5. **Stats Service**: Analytics, reporting
6. **Notification Service**: Email, push notifications

## Monitoring & Observability

### Logging Strategy

```typescript
// Structured logging with Winston
logger.info('Run created', {
  userId: user.id,
  runId: run.id,
  distance: run.distance,
  duration: run.duration,
  timestamp: new Date().toISOString(),
});
```

### Metrics Collection

1. **Application Metrics**
   - Request rate
   - Response time
   - Error rate
   - Active users

2. **Business Metrics**
   - Runs per user
   - Goal completion rate
   - User retention
   - Feature usage

3. **System Metrics**
   - CPU usage
   - Memory usage
   - Disk I/O
   - Network traffic

## Development Workflow

### Git Branching Strategy

```
main
  │
  ├── develop
  │     │
  │     ├── feature/user-story-123
  │     ├── feature/add-statistics
  │     └── feature/improve-performance
  │
  ├── release/v1.2.0
  │
  └── hotfix/critical-bug-fix
```

### CI/CD Pipeline

```
1. Developer pushes code
   ↓
2. GitHub Actions triggered
   ↓
3. Run tests in parallel
   - Unit tests
   - Integration tests
   - E2E tests
   ↓
4. Code quality checks
   - ESLint
   - TypeScript
   - Test coverage
   ↓
5. Build application
   ↓
6. Deploy to staging
   ↓
7. Run smoke tests
   ↓
8. Deploy to production (manual approval)
```

## Future Architecture Considerations

### Phase 1: Current MVP

- Monolithic architecture
- SQLite database
- Server-side sessions
- Basic monitoring

### Phase 2: Growth (10K users)

- PostgreSQL migration
- Redis caching
- CDN implementation
- Enhanced monitoring

### Phase 3: Scale (100K users)

- Microservices architecture
- Kubernetes deployment
- Event-driven architecture
- Global distribution

### Phase 4: Enterprise (1M+ users)

- Multi-region deployment
- GraphQL federation
- Real-time features
- Machine learning integration

## Decision Records

Key architectural decisions are documented in the [ADR directory](./adr/):

1. [Record Architecture Decisions](./adr/0001-record-architecture-decisions.md)
2. [Use SQLite for Development](./adr/0002-use-sqlite-for-development.md)
3. [Separate Test Frameworks](./adr/0003-separate-test-frameworks.md)
4. [JWT Authentication](./adr/0004-jwt-authentication.md)
5. [Monorepo Structure](./adr/0005-monorepo-structure.md)
6. [Prisma ORM](./adr/0006-prisma-orm.md)
7. [GitHub Actions CI](./adr/0007-github-actions-ci.md)
8. [Vite Bundler](./adr/0008-vite-bundler.md)

## Conclusion

This architecture provides a solid foundation for the Running App MVP with clear paths for scaling and evolution. The modular design, comprehensive testing, and modern tooling ensure maintainability and developer productivity.
