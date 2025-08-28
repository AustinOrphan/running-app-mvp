# 🛠️ Developer Setup Guide

This guide helps you set up your development environment for optimal productivity when working on the Running Tracker MVP.

## 📋 Prerequisites

- **Node.js** (version specified in `.nvmrc`)
- **Git** with proper configuration
- **VS Code** (recommended editor)

## 🚀 Quick Setup

### 1. Clone and Setup

```bash
git clone <repository-url>
cd running-app-mvp
npm run setup
```

### 2. Install Recommended Extensions

VS Code will automatically prompt you to install recommended extensions when you open the project. Accept the installation for optimal development experience.

**Key Extensions:**

- **Prettier** - Code formatting
- **ESLint** - Code linting
- **Playwright** - E2E test management
- **GitLens** - Enhanced Git integration
- **TODO Tree** - Track TODO comments

### 3. Configure Git (if needed)

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

## 🔧 Development Tools

### Pre-commit Hooks

The project includes automated pre-commit hooks that:

- **Lint and fix** staged JavaScript/TypeScript files
- **Format** staged files with Prettier
- **Run type checking** to catch errors early

**How it works:**

- Hooks run automatically when you commit
- Failed checks prevent the commit
- Files are automatically fixed when possible

**Manual execution:**

```bash
npx lint-staged  # Run on staged files
npm run lint:check  # Full project check
```

### Code Quality

The project enforces consistent code quality through:

**ESLint Configuration:**

- TypeScript rules
- React best practices
- Accessibility guidelines
- Import organization

**Prettier Configuration:**

- 2-space indentation
- Single quotes for strings
- Trailing commas
- Line width: 80 characters

**EditorConfig:**

- Consistent coding styles across editors
- UTF-8 encoding
- LF line endings
- Trim trailing whitespace

### Commit Message Standards

Commit messages must follow the **Conventional Commits** specification:

```
type(scope): description

[optional body]

[optional footer]
```

**Allowed types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting)
- `refactor` - Code refactoring
- `test` - Adding/updating tests
- `chore` - Maintenance tasks
- `perf` - Performance improvements
- `ci` - CI/CD changes
- `build` - Build system changes
- `revert` - Revert previous commit

**Examples:**

```bash
feat: add goal progress tracking
fix: resolve authentication timeout issue
docs: update API documentation
test: add unit tests for goal analytics
```

## 🎯 VS Code Configuration

### Workspace Settings

The project includes VS Code settings that:

- **Format on Save** - Automatic code formatting
- **Fix on Save** - Auto-fix ESLint issues
- **Organize Imports** - Sort and clean imports
- **Type Checking** - Real-time TypeScript validation

### Debug Configuration

Pre-configured debug setups:

- **Debug Backend** - Debug Express server
- **Debug Frontend** - Debug Vite development server
- **Debug Tests** - Debug Vitest unit tests

### Tasks

Quick access tasks (Ctrl/Cmd + Shift + P → "Tasks: Run Task"):

- Start Backend
- Start Frontend
- Start Full Stack
- Run Unit Tests
- Run Integration Tests
- Run E2E Tests
- Quality Check
- Open Prisma Studio

## 🧪 Testing Setup

### Test Environment Validation

```bash
npm run validate-test-env
```

This command validates:

- Node.js version compatibility
- Required dependencies
- Testing framework configuration
- Environment variables

### Test Execution

```bash
# Unit tests (Vitest)
npm run test
npm run test:watch
npm run test:ui

# Integration tests (Jest)
npm run test:integration
npm run test:integration:watch

# E2E tests (Playwright)
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:headed

# All tests
npm run test:all:complete
```

### Coverage

```bash
npm run test:coverage        # Unit test coverage
npm run test:coverage:all    # All test coverage
npm run test:coverage:open   # Open coverage report
```

## 🔍 Debugging

### Backend Debugging

1. Set breakpoints in VS Code
2. Run "Debug Backend" configuration
3. Access at http://localhost:3001

### Frontend Debugging

1. Set breakpoints in browser dev tools
2. Run "Debug Frontend" configuration
3. Access at http://localhost:3000

### Database Debugging

```bash
npm run prisma:studio  # Open Prisma Studio
npm run prisma:migrate # Run migrations
```

## 📊 Performance Monitoring

### Development Metrics

- **Hot Reload** - Instant code changes
- **Type Checking** - Real-time error detection
- **Build Times** - Optimized development builds

### Testing Performance

- **Parallel Execution** - Tests run in parallel
- **Watch Mode** - Only re-run affected tests
- **Coverage Tracking** - Performance impact monitoring

## 🚨 Troubleshooting

### Common Issues

**Pre-commit hooks failing:**

```bash
npm run lint:fix  # Fix linting issues
npm run format    # Fix formatting
npm run typecheck # Check TypeScript errors
```

**VS Code not recognizing TypeScript:**

1. Reload VS Code window (Ctrl/Cmd + Shift + P → "Developer: Reload Window")
2. Check TypeScript version (bottom-right status bar)
3. Ensure TypeScript extension is enabled

**Tests failing:**

```bash
npm run validate-test-env  # Validate test environment
npm run test:setup         # Reinstall test dependencies
```

### Getting Help

1. Check documentation in `/docs` folder
2. Review GitHub issues for known problems
3. Run diagnostic commands:
   ```bash
   npm run lint:check      # Code quality check
   npm run validate-test-env # Test environment check
   ./check-backend.sh      # Backend diagnostics
   ```

## 🎯 Best Practices

### Development Workflow

1. **Branch Management**

   ```bash
   git checkout -b feature/your-feature-name
   git checkout -b fix/issue-description
   ```

2. **Regular Commits**
   - Small, focused commits
   - Clear commit messages
   - Test before committing

3. **Code Review**
   - Run `npm run lint:check` before PR
   - Include tests for new features
   - Update documentation as needed

### Code Organization

- **Components** - Keep small and focused
- **Hooks** - Extract reusable logic
- **Types** - Define clear interfaces
- **Tests** - Co-locate with source code
- **Documentation** - Keep up-to-date

### Performance

- **Lazy Loading** - Load components as needed
- **Memoization** - Prevent unnecessary re-renders
- **Bundle Analysis** - Monitor build sizes
- **Test Coverage** - Maintain high quality

## 📚 Additional Resources

- [Contributing Guidelines](../CONTRIBUTING.md)
- [Architecture Documentation](../docs/DEVELOPMENT.md)
- [Testing Strategy](../docs/TEST_ENVIRONMENT_SETUP.md)
- [Security Guidelines](../SECURITY.md)
- [API Documentation](../README.md#api-endpoints)

---

**Happy coding! 🚀**

_This setup ensures a consistent, productive development experience for all team members._
