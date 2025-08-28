# Setup Guide

## Overview

This guide will help you set up the Running App MVP development environment from scratch. Whether you're a new contributor or setting up on a new machine, this guide provides everything you need to get started.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Setup](#quick-setup)
3. [Manual Setup](#manual-setup)
4. [Development Environment](#development-environment)
5. [IDE Configuration](#ide-configuration)
6. [Testing Setup](#testing-setup)
7. [Troubleshooting](#troubleshooting)
8. [Next Steps](#next-steps)

## Prerequisites

### System Requirements

- **Node.js**: v20.0.0 or higher
- **npm**: v10.0.0 or higher  
- **Git**: v2.30.0 or higher
- **Operating System**: Windows, macOS, or Linux

### Recommended Software

- **VS Code**: For development with extensions
- **Docker**: For containerized development (optional)
- **Postman/Insomnia**: For API testing

### Quick Check

```bash
# Verify your system meets requirements
node --version    # Should be v20.0.0+
npm --version     # Should be v10.0.0+
git --version     # Should be v2.30.0+
```

If any command fails or shows an older version, please install/update the required software.

## Quick Setup

### Automated Setup (Recommended)

The fastest way to get started is using our automated setup script:

```bash
# 1. Clone the repository
git clone <repository-url>
cd running-app-mvp

# 2. Run automated setup
npm run setup

# 3. Start development servers
npm run dev:full
```

This script will:
- ✅ Install all dependencies
- ✅ Setup environment variables
- ✅ Initialize database with migrations
- ✅ Generate Prisma client
- ✅ Verify setup is working
- ✅ Open your browser to the application

**Setup complete!** Your app should be running at:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## Manual Setup

If you prefer manual setup or need more control:

### Step 1: Clone Repository

```bash
# Clone the repository
git clone <repository-url>
cd running-app-mvp

# Verify you're in the right directory
ls -la  # Should see package.json, README.md, etc.
```

### Step 2: Install Dependencies

```bash
# Install all dependencies
npm install

# This will install:
# - Frontend dependencies (React, Vite, etc.)
# - Backend dependencies (Express, Prisma, etc.) 
# - Development tools (ESLint, Prettier, etc.)
# - Testing frameworks (Vitest, Playwright, etc.)
```

### Step 3: Environment Configuration

Create your local environment file:

```bash
# Copy example environment file
cp .env.example .env.local

# Edit with your preferred editor
nano .env.local
# or
code .env.local
```

**Required environment variables:**

```bash
# .env.local
NODE_ENV=development
DATABASE_URL=file:./prisma/dev.db
JWT_SECRET=your-development-jwt-secret-minimum-32-characters-long
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug
```

### Step 4: Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# (Optional) Seed database with sample data
npx prisma db seed
```

### Step 5: Verify Setup

```bash
# Build the project
npm run build

# Run tests to verify everything works
npm run test:run

# Type check
npm run typecheck
```

### Step 6: Start Development

```bash
# Start both frontend and backend
npm run dev:full

# Or start them separately:
npm run dev:frontend  # Starts React dev server (port 3000)
npm run dev:backend   # Starts Express server (port 3001)
```

## Development Environment

### Project Structure

```
running-app-mvp/
├── src/
│   ├── client/          # Frontend React code
│   ├── server/          # Backend Express code
│   └── shared/          # Shared utilities and types
├── tests/               # All test files
├── prisma/             # Database schema and migrations
├── docs/               # Documentation
└── scripts/            # Build and utility scripts
```

### Development Workflow

```bash
# Daily development workflow
git pull origin main           # Get latest changes
npm run dev:full              # Start development servers
npm run test                  # Run tests while developing
npm run lint:fix              # Fix linting issues before commit
```

### Key Development Commands

```bash
# Development
npm run dev:full              # Start frontend + backend
npm run dev:frontend          # React dev server only
npm run dev:backend           # Express server only

# Building
npm run build                 # Build for production
npm run preview               # Preview production build

# Code Quality
npm run lint                  # Check code quality
npm run lint:fix              # Auto-fix issues
npm run format                # Format code with Prettier
npm run typecheck             # Check TypeScript types

# Testing
npm run test                  # Run unit tests
npm run test:coverage         # Run tests with coverage
npm run test:e2e              # Run end-to-end tests
npm run test:all              # Run all tests

# Database
npm run db:migrate            # Run database migrations
npm run db:generate           # Generate Prisma client
npm run db:studio             # Open database GUI
npm run db:seed               # Seed database with data
```

## IDE Configuration

### VS Code Setup

Install recommended extensions:

```json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next",
    "prisma.prisma",
    "ms-playwright.playwright"
  ]
}
```

**VS Code Settings** (`.vscode/settings.json`):

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.preferences.includePackageJsonAutoImports": "off",
  "files.associations": {
    "*.css": "tailwindcss"
  }
}
```

### Git Configuration

Setup Git hooks:

```bash
# Git hooks are automatically installed with npm install
# They will run linting and tests on commits

# To manually setup hooks:
npm run setup:hooks
```

## Testing Setup

### Test Environment

The project uses multiple testing frameworks:

- **Unit Tests**: Vitest for component and utility testing
- **Integration Tests**: Jest for API and database testing  
- **E2E Tests**: Playwright for full application testing

### Initial Test Run

```bash
# Verify all tests pass after setup
npm run test:all

# If any tests fail, try:
npm run validate-test-env    # Check test environment
npm run ci-db-setup         # Reset test database
```

### Playwright Setup

```bash
# Install Playwright browsers (required for E2E tests)
npx playwright install

# Verify Playwright works
npm run test:e2e -- --headed
```

## Troubleshooting

### Common Issues

#### Dependencies Won't Install

```bash
# Clear npm cache and reinstall
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

#### Database Issues

```bash
# Reset database
npx prisma migrate reset
npx prisma generate

# Or start fresh
rm -f prisma/dev.db
npx prisma migrate dev --name init
```

#### Port Already in Use

```bash
# Find and kill processes on ports 3000 and 3001
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9

# Or use different ports
PORT=3002 npm run dev:backend
```

#### TypeScript Errors

```bash
# Regenerate types
npm run db:generate
npm run typecheck

# Clear TypeScript cache
rm -rf node_modules/.cache
```

### Getting Help

If you're still having issues:

1. **Check the logs**: Look for error messages in the terminal
2. **Verify environment**: Run `npm run validate-test-env`
3. **Check dependencies**: Run `npm doctor`
4. **Reset everything**: Delete `node_modules` and reinstall
5. **Ask for help**: Create an issue with your error details

## Next Steps

### After Setup

Once your development environment is running:

1. **Explore the App**: Visit http://localhost:3000 and try the features
2. **Run Tests**: Make sure `npm run test:all` passes
3. **Read Documentation**: Check out other docs in the `/docs` folder
4. **Make Changes**: Try making a small change and see it live reload

### Development Resources

- **API Documentation**: `/docs/API_DOCUMENTATION.md`
- **Testing Guide**: `TESTING.md`  
- **Deployment Guide**: `DEPLOYMENT.md`
- **Contributing Guidelines**: `CONTRIBUTING.md`
- **Architecture Overview**: `/docs/ARCHITECTURE_OVERVIEW.md`

### Development Workflow

```bash
# Typical development session
git checkout -b feature/my-new-feature
npm run dev:full              # Start development
# ... make changes ...
npm run lint:fix              # Fix any linting issues
npm run test                  # Run tests
git add .
git commit -m "Add new feature"
git push origin feature/my-new-feature
# Create pull request
```

### Performance Tips

- **Use npm scripts**: All common tasks have npm scripts
- **Enable hot reload**: Both frontend and backend support hot reloading
- **Run specific tests**: Use `npm run test -- --grep "pattern"` for faster feedback
- **Use VS Code**: Configured with optimal settings for this project

## Validation Checklist

After setup, verify everything works:

- [ ] Repository cloned successfully
- [ ] Dependencies installed without errors
- [ ] Environment variables configured
- [ ] Database created and migrated
- [ ] Frontend loads at http://localhost:3000
- [ ] Backend responds at http://localhost:3001/api/health
- [ ] All tests pass: `npm run test:all`
- [ ] Code lints without errors: `npm run lint`
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

## Quick Reference

### Essential Commands

```bash
# Setup
npm run setup                 # Full automated setup
npm install                   # Install dependencies
npx prisma generate          # Generate database client

# Development  
npm run dev:full             # Start both servers
npm run dev:frontend         # Frontend only (port 3000)
npm run dev:backend          # Backend only (port 3001)

# Testing
npm run test                 # Unit tests
npm run test:e2e             # E2E tests  
npm run test:all             # All tests

# Code Quality
npm run lint:fix             # Fix linting issues
npm run format               # Format code
npm run typecheck            # Check types

# Database
npm run db:studio            # Database GUI
npm run db:migrate           # Run migrations
```

### Important URLs

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Health Check**: http://localhost:3001/api/health
- **Database Studio**: http://localhost:5555 (when running)

---

**Welcome to the Running App MVP!** 🏃‍♂️

You're all set to start developing. If you run into any issues, check the troubleshooting section above or ask for help.

---

*Last Updated: December 28, 2024*
*This document replaces: QUICKSTART.md, GIT_WORKTREE_SETUP.md, and various developer setup guides*