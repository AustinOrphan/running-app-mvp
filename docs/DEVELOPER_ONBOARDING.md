# Developer Onboarding Guide

Welcome to the Running App MVP! This comprehensive guide ensures you can get up and running in less than 30 minutes.

## 🎯 Onboarding Goal

**Target**: Complete setup and make your first commit in <30 minutes

## 📊 Onboarding Phases

### Phase 1: Environment Setup (10 minutes)

#### Prerequisites Check (2 minutes)

- Node.js 20+ installed
- npm 10+ installed
- Git configured
- VS Code or preferred IDE ready

#### Quick Setup (8 minutes)

```bash
# Use our automated setup
npm run setup:quick
```

This handles:

- ✅ System requirements validation
- ✅ Dependency installation
- ✅ Environment configuration
- ✅ Database setup
- ✅ Git hooks installation
- ✅ IDE configuration

### Phase 2: Understanding the Project (10 minutes)

#### Project Structure (3 minutes)

```
running-app-mvp/
├── src/              # React frontend
│   ├── components/   # UI components
│   ├── hooks/        # Custom React hooks
│   └── utils/        # Frontend utilities
├── server/           # Express backend
│   ├── routes/       # API endpoints
│   ├── middleware/   # Express middleware
│   └── utils/        # Backend utilities
├── prisma/           # Database schema
├── tests/            # All test files
│   ├── unit/         # Unit tests
│   ├── integration/  # Integration tests
│   └── e2e/          # End-to-end tests
└── docs/             # Documentation
```

#### Key Files to Review (5 minutes)

1. **CLAUDE.md** - Development guidelines
2. **tasks.md** - Current project tasks
3. **package.json** - Available scripts
4. **.env.example** - Environment variables

#### Architecture Overview (2 minutes)

- **Frontend**: React 18 with TypeScript
- **Backend**: Express.js with TypeScript
- **Database**: SQLite with Prisma ORM
- **Testing**: Vitest, Jest, Playwright
- **Auth**: JWT-based authentication

### Phase 3: First Contribution (10 minutes)

#### Make a Simple Change (5 minutes)

1. Create a new branch:

   ```bash
   git checkout -b feature/welcome-message
   ```

2. Add your name to the app:
   - Open `src/App.tsx`
   - Update the welcome message
   - Save the file

3. Test your change:
   ```bash
   npm test
   npm run lint:fix
   ```

#### Commit and Push (3 minutes)

```bash
git add .
git commit -m "feat: personalize welcome message"
git push origin feature/welcome-message
```

#### Verify Everything Works (2 minutes)

- Frontend loads at http://localhost:3000
- API responds at http://localhost:3001
- Tests pass
- Lint passes

## 🛠️ Essential Commands

### Daily Development

```bash
npm run dev:full        # Start everything
npm test                # Run tests
npm run lint:fix        # Fix code style
npm run typecheck       # Check types
```

### Before Committing

```bash
npm run lint:fix        # Fix style issues
npm run test:run        # Run tests once
npm run coverage:check  # Verify coverage
```

### Troubleshooting

```bash
npm run validate-test-env  # Check setup
npm run test:setup        # Fix test environment
npm run prisma:studio     # Inspect database
```

## 📈 Track Your Progress

### Start Onboarding Timer

```bash
npm run onboarding:start
```

### Check Progress

```bash
npm run onboarding:check
```

### Validate Setup

```bash
npm run onboarding:validate
```

## 🎓 Learning Resources

### Must Read

1. **QUICKSTART.md** - Fast setup guide
2. **CLAUDE.md** - Coding standards
3. **docs/ARCHITECTURE_OVERVIEW.md** - System design

### Helpful Guides

- **docs/COMMON_WORKFLOWS.md** - Daily tasks
- **docs/TROUBLESHOOTING.md** - Common issues
- **docs/API_DOCUMENTATION.md** - API reference

### Testing Guides

- **docs/TEST_PATTERNS.md** - Testing best practices
- **docs/TEST_RELIABILITY.md** - Flaky test handling

## 🚀 VS Code Setup

### Recommended Extensions

When you open the project, VS Code will prompt to install recommended extensions:

- ESLint
- Prettier
- TypeScript
- Prisma
- Playwright
- Vitest
- GitLens

### Keyboard Shortcuts

- `Cmd/Ctrl + Shift + P` - Command palette
- `Cmd/Ctrl + P` - Quick file open
- `F5` - Start debugging
- `Cmd/Ctrl + Shift + B` - Build project

## 🤝 Getting Help

### Self-Service

1. Check **docs/TROUBLESHOOTING.md**
2. Search existing issues
3. Check test output for hints

### Ask the Team

- Slack: #dev-help
- Create an issue
- Pair programming sessions

## ✅ Onboarding Checklist

Complete these to finish onboarding:

- [ ] Environment setup complete
- [ ] All tests passing locally
- [ ] Made first code change
- [ ] Created first commit
- [ ] Pushed to remote branch
- [ ] Read CLAUDE.md
- [ ] Joined team channels
- [ ] Total time <30 minutes

## 🎊 Welcome to the Team!

Congratulations on completing onboarding! You're now ready to:

- Pick up tasks from tasks.md
- Contribute to features
- Help improve the codebase

Remember:

- Ask questions early and often
- Follow the coding standards
- Write tests for your code
- Have fun building!

## 📊 Metrics and Feedback

After onboarding, please:

1. Report your actual onboarding time
2. Share any issues you encountered
3. Suggest improvements to this guide

Run this to generate a report:

```bash
npm run onboarding:report
```

---

**Need help?** Don't hesitate to reach out. We're here to help you succeed! 🚀
