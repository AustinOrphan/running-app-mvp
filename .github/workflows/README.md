# 🚀 CI/CD Workflows

This directory contains comprehensive GitHub Actions workflows for automated testing, deployment, and maintenance of the Running Tracker MVP.

## 📋 Workflow Overview

### 🧪 Test Suite (`test.yml`)

**Triggers:** Push to main/develop, Pull Requests, Manual dispatch

**Jobs:**

- **Lint & Type Check** - Code quality validation
- **Unit Tests** - Frontend component and hook testing with coverage
- **Integration Tests** - Backend API testing with real database
- **E2E Tests** - Full application testing with Playwright
- **Coverage Analysis** - Comprehensive coverage reporting and badge generation
- **Security Audit** - Dependency vulnerability scanning
- **Build Verification** - Production build validation
- **Test Matrix** - Multi-platform and Node version testing
- **Performance Tests** - Lighthouse performance auditing
- **Dependency Review** - License and security compliance
- **Test Summary** - Consolidated results reporting

### 🚀 Deploy (`deploy.yml`)

**Triggers:** Push to main, Version tags, Manual dispatch

**Jobs:**

- **Pre-deployment Tests** - Full test suite validation
- **Security Checks** - Enhanced security scanning
- **Build & Package** - Production artifact creation
- **Staging Deployment** - Automated staging environment deployment
- **Production Deployment** - Production environment deployment (tags only)
- **Post-deployment Tests** - Live environment validation
- **Rollback** - Automated rollback on failure
- **Notifications** - Success/failure notifications
- **Release Creation** - Automated GitHub releases

### 🔧 Maintenance (`maintenance.yml`)

**Triggers:** Daily schedule (2 AM UTC), Manual dispatch

**Jobs:**

- **Dependency Updates** - Automated dependency monitoring
- **Security Audit** - Daily vulnerability scanning with issue creation
- **Test Health Check** - Continuous test suite validation
- **Performance Monitoring** - Bundle size and performance tracking
- **Cleanup Artifacts** - Automated artifact cleanup
- **Maintenance Summary** - Daily maintenance reporting

### 🔍 PR Validation (`pr-validation.yml`)

**Triggers:** Pull Request events

**Jobs:**

- **PR Information** - Change analysis and metadata collection
- **Quick Checks** - Fast validation (lint, type, build)
- **Security Validation** - PR-specific security checks
- **Test Validation** - Comprehensive test execution
- **E2E Validation** - Critical E2E test execution
- **Performance Check** - Bundle impact analysis
- **Code Quality** - Code change analysis
- **PR Feedback** - Automated PR comments with results
- **Auto-assign** - Intelligent reviewer assignment

## 🛠️ Configuration Files

### `lighthouserc.json`

Performance testing configuration for Lighthouse CI:

- Performance threshold: 80%
- Accessibility threshold: 90%
- Best practices threshold: 85%
- SEO threshold: 80%

## 🔧 Environment Variables

### Required Secrets

```bash
GITHUB_TOKEN          # GitHub access token (auto-provided)
DATABASE_URL          # PostgreSQL connection string
JWT_SECRET            # JWT signing secret
```

### Optional Secrets

```bash
CODECOV_TOKEN         # Codecov integration token
SLACK_WEBHOOK         # Slack notification webhook
LIGHTHOUSE_TOKEN      # Lighthouse CI token
```

## 📊 Workflow Features

### 🎯 Quality Gates

- **Coverage Thresholds**: 70% minimum across all metrics
- **Security Audit**: Automated vulnerability detection
- **Performance Budgets**: Bundle size and performance monitoring
- **Code Quality**: Automated code analysis and feedback

### 🔄 Automation Features

- **Auto-assign Reviewers**: Based on changed files
- **Dependency Updates**: Daily monitoring and issue creation
- **Artifact Cleanup**: Automated old artifact removal
- **Issue Creation**: Automated issue creation for failures

### 📈 Reporting

- **Coverage Badges**: Automated SVG badge generation
- **Test Reports**: Comprehensive HTML and JSON reports
- **Performance Reports**: Bundle size and Lighthouse metrics
- **Security Reports**: Vulnerability scanning results

## 🚀 Deployment Strategies

### Staging Environment

- **Auto-deploy**: Every push to main branch
- **Smoke Tests**: Automated health checks
- **Environment**: `staging`

### Production Environment

- **Tag-based**: Only version tags (v\*) trigger production
- **Manual Approval**: Environment protection rules
- **Rollback**: Automated on failure
- **Environment**: `production`

## 📱 Platform Support

### Test Matrix

- **Operating Systems**: Ubuntu, Windows, macOS
- **Node Versions**: 18.x, 20.x
- **Browsers**: Chromium, Firefox, Safari (E2E)
- **Databases**: PostgreSQL 15

## 🔒 Security Features

### Automated Security

- **Dependency Scanning**: Daily vulnerability audits
- **Secret Scanning**: TruffleHog integration
- **License Compliance**: Automated license checking
- **Security Issues**: Auto-creation of critical vulnerability issues

### Access Control

- **Environment Protection**: Production deployment requires approval
- **Branch Protection**: Main branch requires PR and status checks
- **Secret Management**: GitHub Secrets for sensitive data

## 📊 Monitoring & Alerting

### Performance Monitoring

- **Bundle Size Tracking**: Automated bundle size analysis
- **Performance Budgets**: Lighthouse performance thresholds
- **Trend Analysis**: Performance degradation detection

### Health Monitoring

- **Daily Test Health**: Automated test suite validation
- **Dependency Health**: Outdated package monitoring
- **Security Health**: Vulnerability trend tracking

## 🛠️ Local Development

### Running Workflows Locally

```bash
# Install act (GitHub Actions local runner)
brew install act

# Run test workflow locally
act -j unit-tests

# Run with secrets
act -j unit-tests --secret-file .secrets
```

### Testing Workflow Changes

```bash
# Validate workflow syntax
yamllint .github/workflows/

# Test specific job
act -j quick-checks --dry-run
```

## 📋 Workflow Commands

### Manual Triggers

```bash
# Trigger test suite manually
gh workflow run test.yml

# Trigger deployment to staging
gh workflow run deploy.yml -f environment=staging

# Trigger maintenance checks
gh workflow run maintenance.yml
```

### Workflow Status

```bash
# Check workflow status
gh run list

# View specific run
gh run view <run-id>

# View workflow logs
gh run view <run-id> --log
```

## 🎯 Best Practices

### Workflow Design

- **Fail Fast**: Quick checks run first
- **Parallel Execution**: Independent jobs run concurrently
- **Resource Efficiency**: Caching and artifact reuse
- **Clear Naming**: Descriptive job and step names

### Security

- **Least Privilege**: Minimal required permissions
- **Secret Management**: Proper secret handling
- **Dependency Scanning**: Regular security audits
- **Branch Protection**: Enforce quality gates

### Performance

- **Caching**: NPM and build artifact caching
- **Matrix Strategy**: Efficient multi-platform testing
- **Conditional Execution**: Skip unnecessary jobs
- **Artifact Management**: Automatic cleanup

## 🔧 Troubleshooting

### Common Issues

**Tests failing in CI but passing locally**

- Check environment variables
- Verify database setup
- Review dependency versions

**Slow workflow execution**

- Review caching strategy
- Optimize test execution
- Consider parallelization

**Coverage thresholds not met**

- Run coverage analysis locally
- Review coverage reports
- Add missing tests

**Deployment failures**

- Check environment configuration
- Verify database migrations
- Review deployment logs

### Debug Commands

```bash
# View workflow run details
gh run view --log

# Download workflow artifacts
gh run download <run-id>

# Check workflow configuration
gh workflow list

# View workflow file
gh workflow view test.yml
```

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Playwright Testing](https://playwright.dev/)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [Jest Testing Framework](https://jestjs.io/)
- [Vitest Testing Framework](https://vitest.dev/)

---

_CI/CD system designed for the Running Tracker MVP - Automate your builds, just like your runs! 🏃‍♂️🚀_
