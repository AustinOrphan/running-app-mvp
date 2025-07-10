# Infrastructure Startup Tests

This directory contains tests that validate the app's infrastructure setup to prevent critical breakage due to missing configuration files or server setup issues.

## Purpose

These tests ensure that:
- All required files exist (server.ts, vite.config.ts, lib/prisma.ts)
- Configuration files are valid and properly configured
- Servers can start successfully
- API endpoints are accessible
- Database connections work

## Test Categories

### 1. Required Files Existence
Validates that critical files are present:
- `server.ts` entry point
- `vite.config.ts` frontend configuration
- `lib/prisma.ts` database client
- `package.json` with required scripts
- `tsconfig.json` TypeScript configuration
- `prisma/schema.prisma` database schema

### 2. Configuration File Validation
Ensures configuration files contain required settings:
- Vite config has API proxy setup
- Server config imports required middleware
- Prisma client is properly exported
- Package.json has all necessary scripts

### 3. Module Import Validation
Verifies all modules can be imported:
- Server route files exist
- Middleware files are present
- React components are importable

### 4. Environment Configuration
Checks environment setup:
- Environment example files exist
- Required variables are documented

### 5. Server Startup Integration Tests
Real startup tests that verify:
- Backend server starts on port 3001
- Frontend server starts on port 3000
- Health check endpoint responds
- Frontend serves HTML correctly

## Running Tests

```bash
# Run infrastructure tests only
npm run test:infrastructure

# Watch mode for development
npm run test:infrastructure:watch

# Run all tests including infrastructure
npm run test:all:complete
```

## CI Integration

Infrastructure tests run automatically in GitHub Actions:
- Runs early in the pipeline to catch issues fast
- Blocks merges if infrastructure is broken
- Provides clear error messages for fixes

## Test Configuration

Tests are configured with:
- 30-second timeout for server startup
- Proper cleanup of spawned processes
- Environment variable setup for testing
- Port configuration for local testing

## Adding New Tests

When adding new infrastructure tests:

1. Follow the existing test structure
2. Use descriptive test names
3. Add proper cleanup in `afterAll` hooks
4. Include meaningful error messages
5. Update this README if adding new categories

## Troubleshooting

### Common Issues

**Server startup timeout:**
- Check if ports 3000/3001 are already in use
- Verify all dependencies are installed
- Check for missing environment variables

**File existence failures:**
- Ensure files are committed to git
- Check file paths are correct
- Verify files have proper extensions

**Import validation failures:**
- Check TypeScript compilation
- Verify export/import syntax
- Ensure dependencies are installed

### Running Tests Locally

```bash
# Install dependencies first
npm install

# Generate Prisma client
npx prisma generate

# Run infrastructure tests
npm run test:infrastructure
```

## Relationship to Other Tests

Infrastructure tests complement other test suites:
- **Unit tests**: Test individual functions
- **Integration tests**: Test API endpoints
- **E2E tests**: Test user workflows
- **Infrastructure tests**: Test app can start

These tests run first to ensure the app is even runnable before other tests execute.