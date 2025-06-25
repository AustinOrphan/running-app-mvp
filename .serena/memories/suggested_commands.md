# Essential Development Commands

## Setup Commands

```bash
# Automated setup (recommended)
chmod +x setup.sh && ./setup.sh

# Manual setup
npm install
npx prisma migrate dev --name init
npx prisma generate
```

## Development Commands

```bash
# Start backend server (port 3001)
npm run dev

# Start frontend development server (port 3000)
npm run dev:frontend

# Start both frontend and backend
npm run dev:full

# Build project
npm run build

# Preview production build
npm run preview
```

## Database Commands

```bash
# Run database migrations
npm run prisma:migrate

# Generate Prisma client
npm run prisma:generate

# Open Prisma Studio (database GUI)
npm run prisma:studio
```

## Testing Commands

```bash
# Unit tests (Vitest)
npm run test              # Watch mode
npm run test:run          # Single run
npm run test:ui           # Test UI
npm run test:coverage     # With coverage

# Integration tests (Jest)
npm run test:integration
npm run test:integration:watch

# End-to-end tests (Playwright)
npm run test:e2e
npm run test:e2e:ui       # Interactive mode
npm run test:e2e:headed   # With browser UI

# Accessibility tests
npm run test:a11y
npm run test:a11y:e2e

# Visual regression tests
npm run test:visual
npm run test:visual:update  # Update baselines

# Run all tests
npm run test:all:complete
```

## Coverage Commands

```bash
# Coverage reports
npm run test:coverage
npm run test:coverage:integration
npm run test:coverage:all
npm run test:coverage:open    # Open HTML report
npm run test:coverage:check   # Verify thresholds
```

## System Utilities (macOS)

```bash
# File operations
ls -la                    # List files with details
find . -name "*.ts"       # Find TypeScript files
grep -r "pattern" .       # Search in files

# Process management
lsof -i :3000            # Check what's using port 3000
ps aux | grep node       # Find Node processes
kill -9 PID              # Force kill process

# Git operations
git status
git add .
git commit -m "message"
git push origin branch-name
```

## Quick Checks

```bash
# Check if servers are running
curl http://localhost:3001/api/health  # Backend health
curl http://localhost:3000             # Frontend

# View logs
npm run dev 2>&1 | tee backend.log    # Save backend logs
```

## Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Install Playwright browsers (for E2E tests)
npm run test:setup
```
