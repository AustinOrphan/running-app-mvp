# 🔍 Code Quality Guide

This document outlines the code quality standards, tools, and processes for the Running Tracker MVP project.

## 📋 Table of Contents

- [Overview](#overview)
- [TypeScript Configuration](#typescript-configuration)
- [ESLint Configuration](#eslint-configuration)
- [SonarQube Integration](#sonarqube-integration)
- [Code Metrics](#code-metrics)
- [Quality Gates](#quality-gates)
- [Development Workflow](#development-workflow)

## 🎯 Overview

Our code quality framework includes:

- **TypeScript Strict Mode**: Enhanced type safety with strict compiler options
- **ESLint Rules**: Comprehensive linting with security, complexity, and best practices
- **SonarQube Analysis**: Static code analysis for bugs, vulnerabilities, and code smells
- **Code Metrics**: Complexity analysis and duplicate code detection
- **Automated Workflows**: CI/CD integration for continuous quality monitoring

## 🔧 TypeScript Configuration

### Strict Mode Settings

The project uses enhanced TypeScript strict mode with the following key options:

```json
{
  "strict": true,
  "strictNullChecks": true,
  "noImplicitAny": true,
  "noImplicitReturns": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "exactOptionalPropertyTypes": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true
}
```

### Benefits

- **Type Safety**: Catch type-related errors at compile time
- **Code Clarity**: Explicit typing improves code readability
- **Refactoring Safety**: Type checking prevents breaking changes
- **Developer Experience**: Better IntelliSense and error reporting

## 📝 ESLint Configuration

### Quality Configuration

Enhanced ESLint rules are defined in `.eslintrc.quality.js` with:

- **SonarJS Rules**: Detect bugs and code smells
- **Security Rules**: Identify security vulnerabilities
- **Unicorn Rules**: Modern JavaScript/TypeScript best practices
- **TypeScript Rules**: Strict TypeScript-specific rules

### Key Rule Categories

#### 🔒 Security Rules
- Buffer security checks
- Eval expression detection
- Regular expression security
- Object injection prevention

#### 🧠 Complexity Rules
- Cognitive complexity limits (max 15)
- Switch case limits (max 30)
- Duplicate code detection
- Nested structure limits

#### 🚀 Best Practices
- Modern syntax preferences
- Error handling standards
- Function naming conventions
- Import/export patterns

### Running Quality Checks

```bash
# Run enhanced linting
npm run quality:lint

# Fix auto-fixable issues
npm run quality:lint:fix

# Run all quality checks
npm run quality:check
```

## 🔍 SonarQube Integration

### Configuration

SonarQube analysis is configured in `sonar-project.properties`:

```properties
sonar.projectKey=running-app-mvp
sonar.sources=src,server,lib
sonar.tests=tests
sonar.javascript.lcov.reportPaths=coverage/lcov.info
```

### Quality Gates

The project enforces the following quality gates:

- **Coverage**: Minimum 80% code coverage
- **Duplicated Lines**: Maximum 3% duplication
- **Maintainability Rating**: A rating required
- **Reliability Rating**: A rating required
- **Security Rating**: A rating required

### Running SonarQube Analysis

```bash
# Run SonarQube scan (requires SonarQube server)
npm run quality:sonar

# View results in SonarQube dashboard
# http://localhost:9000 (default local setup)
```

## 📊 Code Metrics

### Complexity Analysis

Track code complexity using `complexity-report`:

```bash
# Generate complexity report
npm run quality:complexity

# View results in reports/complexity.json
```

**Metrics tracked:**
- Cyclomatic complexity
- Halstead metrics
- Lines of code
- Function count
- Parameter count

### Duplicate Code Detection

Identify code duplication using `jscpd`:

```bash
# Run duplicate detection
npm run quality:duplicates

# View HTML report in reports/jscpd/
```

**Configuration (`.jscpd.json`):**
- Minimum 5 lines for duplication
- Minimum 50 tokens
- HTML and JSON reporting
- Exclusion of test files

### Combined Metrics

```bash
# Run all metrics analysis
npm run quality:metrics

# Run complete quality suite
npm run quality:all
```

## 🚦 Quality Gates

### Pre-commit Hooks

Automated quality checks run before each commit:

1. **ESLint**: Code linting and auto-fixing
2. **Prettier**: Code formatting
3. **TypeScript**: Type checking

### CI/CD Integration

GitHub Actions workflows enforce quality:

- **Pull Request Checks**: Quality gates for all PRs
- **SonarQube Analysis**: Automated code analysis
- **Quality Metrics**: Complexity and duplication reporting
- **Coverage Requirements**: Minimum coverage thresholds

### Quality Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| Test Coverage | ≥ 80% | Block merge |
| Cognitive Complexity | ≤ 15 | ESLint error |
| Duplicate Lines | ≤ 3% | SonarQube warning |
| Security Hotspots | 0 | Block merge |
| Code Smells | ≤ 5 | SonarQube warning |

## 🔄 Development Workflow

### Before Committing

1. **Run Quality Checks**:
   ```bash
   npm run quality:check
   ```

2. **Fix Issues**:
   ```bash
   npm run quality:lint:fix
   npm run format
   ```

3. **Verify Tests**:
   ```bash
   npm run test:coverage
   ```

### Code Review Process

1. **Automated Checks**: All CI checks must pass
2. **SonarQube Review**: Check quality gate status
3. **Manual Review**: Focus on logic and architecture
4. **Testing**: Verify test coverage and quality

### Continuous Improvement

- **Weekly Reviews**: Analyze SonarQube technical debt
- **Metric Tracking**: Monitor complexity trends
- **Rule Updates**: Adjust ESLint rules based on findings
- **Team Training**: Share quality best practices

## 🛠️ Tools and Integrations

### IDE Integration

**VS Code Extensions**:
- ESLint
- Prettier
- SonarLint
- TypeScript Hero

**Settings** (configured in `.vscode/settings.json`):
- Format on save
- Auto-fix on save
- TypeScript strict mode
- Import organization

### CLI Tools

```bash
# Install global tools for local development
npm install -g sonarqube-scanner
npm install -g complexity-report
npm install -g jscpd
```

### GitHub Integration

- **SonarQube App**: PR analysis and quality gates
- **Codecov**: Coverage reporting and PR comments
- **Dependabot**: Automated dependency updates
- **CodeQL**: Security vulnerability scanning

## 📈 Monitoring and Reporting

### Quality Dashboards

1. **SonarQube Dashboard**: Overall project health
2. **GitHub Actions**: CI/CD pipeline status
3. **Codecov Dashboard**: Coverage trends
4. **Dependabot**: Dependency security status

### Regular Reports

- **Weekly**: SonarQube quality report
- **Monthly**: Technical debt assessment
- **Quarterly**: Code quality metrics review
- **Release**: Quality gate compliance report

## 🎯 Quality Goals

### Short-term (1-3 months)
- [ ] Achieve 90% test coverage
- [ ] Eliminate all security hotspots
- [ ] Reduce cognitive complexity to avg < 10
- [ ] Achieve SonarQube A rating

### Long-term (6-12 months)
- [ ] Implement mutation testing
- [ ] Add performance benchmarking
- [ ] Set up architectural decision records
- [ ] Implement design pattern enforcement

## 📚 References

- [TypeScript Strict Mode Guide](https://www.typescriptlang.org/tsconfig#strict)
- [ESLint Rules Reference](https://eslint.org/docs/rules/)
- [SonarQube Quality Gates](https://docs.sonarqube.org/latest/user-guide/quality-gates/)
- [Code Complexity Metrics](https://en.wikipedia.org/wiki/Cyclomatic_complexity)

---

🤖 *This document is automatically updated as part of our code quality CI/CD pipeline.*