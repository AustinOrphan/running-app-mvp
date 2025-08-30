# Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the Running App MVP. The application uses a modern CI/CD pipeline with Docker containers, environment-specific configurations, and automated deployment strategies.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Local Deployment](#local-deployment)
5. [Production Deployment](#production-deployment)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Environment Variables](#environment-variables)
8. [Database Management](#database-management)
9. [Monitoring and Health Checks](#monitoring-and-health-checks)
10. [Rollback Procedures](#rollback-procedures)
11. [Troubleshooting](#troubleshooting)
12. [Best Practices](#best-practices)

## Architecture Overview

### Application Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Express.js + TypeScript
- **Database**: SQLite with Prisma ORM
- **Authentication**: JWT with bcrypt
- **Container**: Docker with multi-stage builds
- **Deployment**: Docker Compose / Kubernetes

### Environment Structure

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Development   │    │     Staging     │    │   Production    │
│                 │    │                 │    │                 │
│ • Local Docker  │    │ • CI/CD Deploy  │    │ • Manual Deploy │
│ • Hot Reload    │    │ • Integration   │    │ • Load Balanced │
│ • Debug Mode    │    │ • Testing       │    │ • Monitoring    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Prerequisites

### Required Software

```bash
# Node.js and npm
node --version  # v20.0.0+
npm --version   # v10.0.0+

# Docker (for containerized deployment)
docker --version        # v24.0.0+
docker-compose --version # v2.20.0+

# Git
git --version  # v2.30.0+
```

### Required Accounts/Access

- GitHub repository access
- Docker Hub account (for image registry)
- Production server access
- Database hosting (if external)

## Environment Setup

### Environment Files

Create environment files for each deployment target:

**.env.local** (Development):

```bash
NODE_ENV=development
PORT=3001
FRONTEND_PORT=3000
DATABASE_URL=file:./prisma/dev.db
JWT_SECRET=your-development-jwt-secret-key-minimum-32-characters
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug
```

**.env.staging** (Staging):

```bash
NODE_ENV=staging
PORT=3001
FRONTEND_PORT=3000
DATABASE_URL=file:./prisma/staging.db
JWT_SECRET=${STAGING_JWT_SECRET}
CORS_ORIGIN=https://staging.yourapp.com
LOG_LEVEL=info
```

**.env.production** (Production):

```bash
NODE_ENV=production
PORT=3001
DATABASE_URL=${PRODUCTION_DATABASE_URL}
JWT_SECRET=${PRODUCTION_JWT_SECRET}
CORS_ORIGIN=https://yourapp.com
LOG_LEVEL=warn
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=900000
```

## Local Deployment

### Development Setup

```bash
# Clone repository
git clone https://github.com/yourusername/running-app-mvp.git
cd running-app-mvp

# Install dependencies
npm install

# Setup database
npx prisma migrate dev --name init
npx prisma generate

# Start development servers
npm run dev:full  # Starts both frontend and backend
```

### Development with Docker

```bash
# Build and run with Docker Compose
docker-compose -f docker-compose.dev.yml up --build

# Or run individual services
docker-compose -f docker-compose.dev.yml up frontend
docker-compose -f docker-compose.dev.yml up backend
```

### Docker Compose Configuration

**docker-compose.dev.yml**:

```yaml
version: '3.8'
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    ports:
      - '3001:3001'
    environment:
      - NODE_ENV=development
    volumes:
      - .:/app
      - /app/node_modules
    command: npm run dev

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=development
    volumes:
      - .:/app
      - /app/node_modules
    command: npm run dev:frontend
```

## Production Deployment

### Build Process

```bash
# Build production Docker image
docker build -t running-app-mvp:latest .

# Test production build locally
docker run -p 3001:3001 --env-file .env.production running-app-mvp:latest
```

### Docker Production Configuration

**Dockerfile**:

```dockerfile
# Multi-stage build
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

# Run database migrations and start app
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
```

### Docker Compose Production

**docker-compose.prod.yml**:

```yaml
version: '3.8'
services:
  app:
    image: running-app-mvp:latest
    ports:
      - '3001:3001'
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - JWT_SECRET=${JWT_SECRET}
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3001/api/health']
      interval: 30s
      timeout: 10s
      retries: 3
    volumes:
      - ./data:/app/data # Persistent data directory

  nginx:
    image: nginx:alpine
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped
```

## CI/CD Pipeline

### GitHub Actions Workflow

**.github/workflows/deploy.yml**:

```yaml
name: Deploy Application

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:coverage
      - run: npm run test:e2e

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t running-app-mvp:${{ github.sha }} .
      - name: Push to registry
        run: |
          echo ${{ secrets.DOCKER_TOKEN }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
          docker push running-app-mvp:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy to production
        run: |
          # Deploy using your preferred method
          # Examples: kubectl, docker-compose, ssh deployment, etc.
```

### Deployment Scripts

**scripts/deploy.sh**:

```bash
#!/bin/bash
set -e

ENV=${1:-production}
echo "Deploying to $ENV environment..."

# Pull latest changes
git pull origin main

# Build new image
docker build -t running-app-mvp:latest .

# Stop existing containers
docker-compose -f docker-compose.prod.yml down

# Start with new image
docker-compose -f docker-compose.prod.yml up -d

# Verify deployment
sleep 30
curl -f http://localhost:3001/api/health || exit 1

echo "Deployment to $ENV completed successfully!"
```

## Environment Variables

### Core Application Variables

| Variable       | Description                | Development             | Production        |
| -------------- | -------------------------- | ----------------------- | ----------------- |
| `NODE_ENV`     | Runtime environment        | `development`           | `production`      |
| `PORT`         | Backend server port        | `3001`                  | `3001`            |
| `DATABASE_URL` | Database connection string | `file:./prisma/dev.db`  | External DB URL   |
| `JWT_SECRET`   | JWT signing secret         | Development key         | Secure random key |
| `CORS_ORIGIN`  | Allowed CORS origins       | `http://localhost:3000` | Production domain |

### Security Variables

| Variable            | Description             | Required | Default  |
| ------------------- | ----------------------- | -------- | -------- |
| `JWT_SECRET`        | JWT token signing key   | Yes      | None     |
| `RATE_LIMIT_MAX`    | Max requests per window | No       | `100`    |
| `RATE_LIMIT_WINDOW` | Rate limit window (ms)  | No       | `900000` |
| `BCRYPT_ROUNDS`     | Password hashing rounds | No       | `12`     |

### Database Variables

| Variable         | Description         | Development | Production           |
| ---------------- | ------------------- | ----------- | -------------------- |
| `DATABASE_URL`   | Primary database    | SQLite file | PostgreSQL/MySQL URL |
| `RUN_MIGRATIONS` | Auto-run migrations | `true`      | `false`              |

## Database Management

### Development Database

```bash
# Create and run migrations
npx prisma migrate dev --name your_migration_name

# Reset database (WARNING: Destroys data)
npx prisma migrate reset

# Generate Prisma client
npx prisma generate

# Open Prisma Studio
npx prisma studio
```

### Production Database

```bash
# Deploy migrations (no prompts)
npx prisma migrate deploy

# Generate client
npx prisma generate

# Check migration status
npx prisma migrate status
```

### Database Backup

```bash
# Backup SQLite database
cp prisma/production.db backup/production-$(date +%Y%m%d).db

# Restore from backup
cp backup/production-20240101.db prisma/production.db
```

## Monitoring and Health Checks

### Health Check Endpoint

The application includes a health check endpoint at `/api/health`:

```typescript
// Returns application status
GET /api/health
{
  "status": "healthy",
  "timestamp": "2024-12-28T12:00:00Z",
  "database": "connected",
  "uptime": 3600
}
```

### Monitoring Setup

**Basic Health Monitoring**:

```bash
# Check application health
curl -f http://localhost:3001/api/health

# Check with timeout
timeout 10 curl -f http://localhost:3001/api/health
```

**Docker Health Checks**:

```yaml
healthcheck:
  test: ['CMD', 'curl', '-f', 'http://localhost:3001/api/health']
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### Log Monitoring

```bash
# View application logs
docker-compose logs -f app

# View last 100 lines
docker-compose logs --tail 100 app

# Follow logs with timestamps
docker-compose logs -f -t app
```

## Rollback Procedures

### Quick Rollback

```bash
# Rollback to previous Docker image
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --force-recreate

# Rollback database migration (if needed)
npx prisma migrate resolve --rolled-back "20241228000000_migration_name"
```

### Systematic Rollback Process

1. **Identify Issues**: Monitor logs and health checks
2. **Stop Traffic**: Temporarily redirect traffic if needed
3. **Rollback Application**: Deploy previous working version
4. **Rollback Database**: Revert migrations if necessary
5. **Verify System**: Ensure all services are healthy
6. **Resume Traffic**: Restore normal traffic flow

### Rollback Scripts

**scripts/rollback.sh**:

```bash
#!/bin/bash
set -e

PREVIOUS_VERSION=${1:-previous}
echo "Rolling back to $PREVIOUS_VERSION..."

# Stop current deployment
docker-compose -f docker-compose.prod.yml down

# Deploy previous version
docker-compose -f docker-compose.prod.yml up -d

# Wait for startup
sleep 30

# Verify rollback
curl -f http://localhost:3001/api/health || {
  echo "Rollback verification failed!"
  exit 1
}

echo "Rollback completed successfully!"
```

## Troubleshooting

### Common Issues

#### Application Won't Start

```bash
# Check logs
docker-compose logs app

# Common fixes
1. Verify environment variables
2. Check database connectivity
3. Ensure ports are available
4. Verify file permissions
```

#### Database Connection Issues

```bash
# Verify database file exists
ls -la prisma/

# Check database permissions
chmod 644 prisma/production.db

# Test database connection
npx prisma migrate status
```

#### Performance Issues

```bash
# Monitor resource usage
docker stats

# Check for memory leaks
docker-compose exec app node --expose-gc --inspect=0.0.0.0:9229 dist/server/index.js

# Monitor database performance
npx prisma studio
```

### Debug Commands

```bash
# Access container shell
docker-compose exec app sh

# Check environment variables
docker-compose exec app printenv

# Test API endpoints
curl -i http://localhost:3001/api/health
curl -i http://localhost:3001/api/runs

# View system resources
docker system df
docker system prune
```

## Best Practices

### Security

1. **Environment Variables**: Never commit secrets to version control
2. **HTTPS**: Use SSL/TLS certificates in production
3. **Rate Limiting**: Implement API rate limiting
4. **Input Validation**: Validate all user inputs
5. **Database Security**: Use proper database permissions

### Performance

1. **Caching**: Implement appropriate caching strategies
2. **Compression**: Enable gzip compression
3. **CDN**: Use CDN for static assets
4. **Database Optimization**: Index frequently queried fields
5. **Resource Limits**: Set appropriate Docker resource limits

### Reliability

1. **Health Checks**: Implement comprehensive health checks
2. **Graceful Shutdown**: Handle SIGTERM signals properly
3. **Circuit Breakers**: Implement circuit breaker patterns
4. **Monitoring**: Set up comprehensive monitoring and alerting
5. **Backups**: Regular automated backups

### Deployment

1. **Blue-Green Deployments**: Minimize downtime with blue-green deployments
2. **Feature Flags**: Use feature flags for gradual rollouts
3. **Database Migrations**: Always test migrations in staging first
4. **Rollback Plan**: Have a tested rollback procedure
5. **Documentation**: Keep deployment documentation up to date

## Quick Reference

### Essential Commands

```bash
# Development
npm run dev:full              # Start both frontend and backend
npm run setup                 # Full project setup

# Testing
npm run test:all              # Run all tests
npm run test:coverage         # Coverage report

# Building
npm run build                 # Production build
docker build -t app:latest .  # Docker build

# Deployment
./scripts/deploy.sh           # Deploy script
./scripts/rollback.sh         # Rollback script

# Database
npx prisma migrate deploy     # Deploy migrations
npx prisma generate          # Generate client
npx prisma studio            # Database GUI
```

### Useful URLs

- Development Frontend: http://localhost:3000
- Development Backend: http://localhost:3001
- API Health Check: http://localhost:3001/api/health
- Prisma Studio: http://localhost:5555

---

**Last Updated**: December 28, 2024  
**Maintained By**: Development Team  
**Version**: 2.0 (Consolidated from multiple deployment documents)

This document replaces:

- DEPLOYMENT_GUIDE.md
- MASTER_DEPLOYMENT_PLAN.md
- NEXT_STEPS_DEPLOYMENT.md
- docs/DEPLOYMENT_PIPELINES.md
