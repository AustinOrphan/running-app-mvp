# 🏃‍♂️ Running Tracker MVP

[![CI Pipeline](https://github.com/AustinOrphan/running-app-mvp/workflows/🚀%20CI%20Pipeline/badge.svg)](https://github.com/AustinOrphan/running-app-mvp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/AustinOrphan/running-app-mvp/workflows/CodeQL/badge.svg)](https://github.com/AustinOrphan/running-app-mvp/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.0+-blue.svg)](https://reactjs.org/)
[![Express](https://img.shields.io/badge/Express-4.0+-green.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.0+-2D3748.svg)](https://prisma.io/)
[![Code Style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

A full-stack web application for tracking running activities, built with React, Express, Prisma, and SQLite.

## 🚀 Quick Start - Ready in <30 Minutes!

### Automated Setup (Recommended) - 5 minutes

```bash
# Clone and setup everything automatically
git clone <repository-url>
cd running-app-mvp
npm run setup:quick
```

That's it! The setup script handles everything and launches your development environment.

### Manual Setup - 10 minutes

```bash
# 1. Install dependencies
npm ci  # Faster than npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your values

# 3. Set up database
npx prisma migrate dev --name init
npx prisma generate

# 4. Start development servers
npm run dev:full  # Starts both frontend and backend
```

**Need help?** See [QUICKSTART.md](QUICKSTART.md) for detailed instructions.

## 📊 Project Status

- ✅ **Test Reliability**: 100% pass rate, <1% flaky tests
- ✅ **CI Performance**: <5 min runtime for PRs
- ✅ **Code Coverage**: >80% maintained automatically
- ✅ **Developer Experience**: <30 min onboarding

## 📱 Usage

1. Open your browser to `http://localhost:3000`
2. Register a new account with any email/password
3. Click "Add Sample Run" to create test data
4. View and manage your runs in the dashboard

## 🎯 Developer Onboarding

**Target**: Get productive in <30 minutes!

```bash
# Track your onboarding time
npm run onboarding:start

# Check progress
npm run onboarding:check

# Validate setup
npm run onboarding:validate
```

See [DEVELOPER_ONBOARDING.md](docs/DEVELOPER_ONBOARDING.md) for complete guide.

## 🏗️ Project Structure

```
running-app-mvp/
├── src/                    # Frontend React code
│   ├── components/         # React components
│   ├── hooks/             # Custom React hooks
│   ├── pages/             # Page components
│   └── utils/             # Utility functions
├── routes/                 # Backend API routes
├── middleware/            # Express middleware
├── prisma/               # Database schema
├── components/           # Backend components
├── hooks/               # Backend hooks
└── utils/               # Backend utilities
```

## 🛠️ Technology Stack

**Frontend:**

- React 18 with TypeScript
- Vite for development and building
- CSS Modules for styling
- React Router DOM for navigation
- Recharts for data visualization
- Custom hooks for state management

**Backend:**

- Express.js with TypeScript
- Prisma ORM with SQLite database
- JWT authentication with bcrypt password hashing
- Express Rate Limiting for API protection
- Helmet.js for security headers
- CORS configuration
- Structured logging with correlation IDs
- Zod for input validation

**Testing & Quality:**

- Vitest for unit testing (React components, hooks, utilities)
- Jest for integration testing (API endpoints, middleware)
- Playwright for end-to-end testing (cross-browser, mobile)
- ESLint + Prettier for code quality
- TypeScript strict mode
- Test coverage tracking and quality gates

## 📡 API Endpoints

### Authentication

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login

### Runs

- `GET /api/runs` - Get all runs
- `POST /api/runs` - Create new run
- `GET /api/runs/:id` - Get specific run
- `PUT /api/runs/:id` - Update run
- `DELETE /api/runs/:id` - Delete run
- `GET /api/runs/simple-list` - Get simplified run list

### Statistics

- `GET /api/stats/insights-summary` - Weekly insights
- `GET /api/stats/type-breakdown` - Run type breakdown

### Goals & Races

- `GET /api/goals` - Get user goals
- `POST /api/goals` - Create new goal
- `DELETE /api/goals/:id` - Delete goal
- `GET /api/races` - Get user races
- `POST /api/races` - Create new race
- `PUT /api/races/:id` - Update race
- `DELETE /api/races/:id` - Delete race

## 🧪 Testing

This project includes a comprehensive testing suite covering unit, integration, and end-to-end testing with high coverage requirements and quality gates.

### Test Types

**Unit Tests (Vitest)**

- **Frontend**: React components, custom hooks, utility functions
- **Coverage**: React Testing Library for component testing
- **Location**: `tests/unit/`
- **Run**: `npm run test` or `npm run test:watch`

**Integration Tests (Jest)**

- **Backend**: API endpoints, middleware, error handling
- **Database**: Real database operations with test data isolation
- **Location**: `tests/integration/`
- **Run**: `npm run test:integration`

**End-to-End Tests (Playwright)**

- **Cross-browser**: Chrome, Firefox, Safari (Desktop & Mobile)
- **User workflows**: Authentication, run management, goal tracking
- **Visual regression**: Screenshot comparison testing
- **Accessibility**: Automated a11y testing with axe-core
- **Location**: `tests/e2e/`
- **Run**: `npm run test:e2e`

### Test Commands

```bash
# Unit Tests
npm run test                    # Run all unit tests
npm run test:watch              # Watch mode for development
npm run test:ui                 # Visual test runner interface

# Integration Tests
npm run test:integration        # API and backend integration tests
npm run test:integration:watch  # Watch mode for development

# End-to-End Tests
npm run test:e2e               # Full browser testing
npm run test:e2e:ui            # Interactive test runner
npm run test:e2e:headed        # Run with visible browser

# Coverage Reports
npm run test:coverage          # Unit test coverage
npm run test:coverage:integration # Integration test coverage
npm run test:coverage:all      # Combined coverage report
npm run test:coverage:open     # Open coverage report in browser (macOS only)

# Specialized Testing
npm run test:a11y              # Accessibility testing
npm run test:a11y:e2e          # E2E accessibility tests
npm run test:visual            # Visual regression testing
npm run test:visual:update     # Update visual baselines

# Complete Test Suite
npm run test:all               # Unit + Integration + E2E
npm run test:all:complete      # All tests including a11y and visual
```

### Coverage & Quality Gates

- **Coverage Thresholds**: 70% minimum for branches, functions, lines, statements
- **Quality Checks**: Automated via `npm run lint:check` (lint + format + typecheck)
- **Pre-commit Validation**: Test environment validation and fast test subset
- **CI Integration**: Full test suite with coverage reporting and badge generation

### Test Environment

Tests run against isolated environments:

- **Unit Tests**: Mock services and APIs
- **Integration Tests**: Test database with automated cleanup
- **E2E Tests**: Local development server with test data

**Setup Requirements:**

```bash
npm run test:setup             # Install Playwright browsers
npm run validate-test-env      # Validate test environment
```

### Testing Best Practices

- Tests are organized by type in the top-level `tests/` directory
- Mock external dependencies and APIs
- Test utilities and fixtures available in `tests/fixtures/`
- Accessibility testing integrated into all test levels
- Visual regression testing for UI consistency
- Cross-browser and mobile device testing

## 🔧 Development Commands

### Development Servers

```bash
# Start development servers
npm run dev                 # Backend server (port 3001)
npm run dev:frontend       # Frontend server (port 3000)
npm run dev:full           # Both servers concurrently

# Production builds
npm run build              # Build both backend and frontend
npm run start              # Start production backend
npm run preview            # Preview production frontend build
```

### Code Quality & Validation

```bash
# Linting & Formatting
npm run lint               # Lint all code
npm run lint:fix           # Auto-fix linting issues
npm run lint:server        # Lint backend code only
npm run lint:frontend      # Lint frontend code only
npm run format             # Format code with Prettier
npm run format:check       # Check formatting

# Type Checking & Validation
npm run typecheck          # TypeScript type checking
npm run lint:check         # Full validation (lint + format + typecheck)
```

### Database Management

```bash
# Database Operations
npm run prisma:migrate     # Run database migrations
npm run prisma:generate    # Generate Prisma client
npm run prisma:studio      # Open Prisma Studio (database GUI)

# Project Setup
npm run setup              # Full project setup (install + migrate + generate)
```

## ⚙️ Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```env
# Database
DATABASE_URL="file:./dev.db"

# JWT Authentication - CRITICAL: Generate secure secrets before production!
# Generate with: openssl rand -base64 32
JWT_SECRET="CHANGE-THIS-TO-SECURE-256-BIT-SECRET-BEFORE-PRODUCTION"

# Salt for deterministic user ID hashing in logs
LOG_SALT="set-a-strong-random-string-for-production"

# Server Configuration
PORT=3001
NODE_ENV=development

# Rate Limiting
# Set to 'false' to disable rate limiting (useful for testing)
RATE_LIMITING_ENABLED=true
```

**Security Notes:**

- `JWT_SECRET`: Must be a strong, unique secret for production (minimum 256-bit)
- `LOG_SALT`: Used to anonymize user identifiers in log files for GDPR compliance
- Never commit actual secrets to version control

## 🔐 Security Implementation

This application implements comprehensive security measures:

**Authentication & Authorization:**

- JWT tokens with 1-hour expiration (reduced from 7 days for security)
- bcrypt password hashing with enhanced requirements:
  - Minimum 12 characters
  - Must include uppercase, lowercase, numbers, special characters
- Protected API routes with JWT middleware
- User data isolation by user ID

**Security Headers & Protection:**

- Helmet.js for security headers (CSP, HSTS, XSS protection)
- CORS configuration with environment-based restrictions
- Rate limiting on all API endpoints (configurable)
- Content Security Policy with strict directives

**Data Protection:**

- Structured logging with correlation IDs
- User ID anonymization in logs via `LOG_SALT`
- Input validation using Zod schemas
- SQL injection protection via Prisma ORM

**Security Documentation:**

- Complete security policy in `SECURITY.md`
- Security configuration guide in `docs/SECURITY_CONFIGURATION.md`
- Incident response procedures included

For detailed security configuration, see the [Security Documentation](./SECURITY.md).

## 🐛 Troubleshooting

### Common Issues

**"Backend Offline" message:**

- Ensure backend server is running on port 3001
- Check that no other process is using port 3001

**Database errors:**

- Run `npx prisma migrate dev --name init` to set up database
- Run `npx prisma generate` to generate client

**Frontend can't reach backend:**

- Vite proxy is configured to forward `/api` requests to port 3001
- Ensure both servers are running

### Logs

- Backend logs appear in the terminal running `npm run dev`
- Frontend logs appear in browser console

## 📈 Future Enhancements

- [ ] GPX file upload and route visualization
- [ ] Advanced statistics and charts
- [ ] Goal progress tracking
- [ ] Race time predictions
- [ ] Social features and run sharing
- [ ] Mobile responsive improvements
- [ ] Dark mode theme
- [ ] Export data functionality

## 🤝 Contributing

1. Check our [QUICKSTART.md](QUICKSTART.md) guide (<30 min setup)
2. Read [CLAUDE.md](CLAUDE.md) for development standards
3. Pick a task from [tasks.md](tasks.md)
4. Create a feature branch
5. Make your changes with tests
6. Submit a pull request

### Branch Protection

This repository uses branch protection rules to ensure code quality:

- **Required CI checks**: All tests must pass before merging
- **Pull request reviews**: At least 1 approval required
- **Force pushes**: Blocked to protect git history
- **Conversation resolution**: Required before merging

See [docs/BRANCH_PROTECTION.md](docs/BRANCH_PROTECTION.md) for detailed information.

### Development Workflow

```bash
# Configure branch protection (if needed)
npm run branch-protection:configure

# Standard development flow
git checkout main
git pull origin main
git checkout -b feature/your-feature
# Make changes, commit, push
# Create pull request via GitHub UI
```

## 📄 License

MIT License - see LICENSE file for details
