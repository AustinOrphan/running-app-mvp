# 🚀 Quick Start Guide - Get Running in <30 Minutes!

Welcome to the Running App MVP! This guide will get you from zero to a fully running development environment in less than 30 minutes.

## 📋 Prerequisites (2 minutes)

Before starting, ensure you have:

- **Node.js 20+** ([Download](https://nodejs.org/))
- **Git** ([Download](https://git-scm.com/))
- **VS Code** (recommended) ([Download](https://code.visualstudio.com/))

Quick check:
```bash
node --version  # Should be v20.0.0 or higher
npm --version   # Should be 10.0.0 or higher
git --version   # Should be 2.0.0 or higher
```

## 🏃 Fastest Setup (5 minutes)

We've created an automated setup script that handles everything:

```bash
# Clone the repository
git clone <repository-url>
cd running-app-mvp

# Run the quick setup
npm run setup:quick
```

The script will:
- ✅ Check system requirements
- ✅ Install all dependencies
- ✅ Set up your environment
- ✅ Create and migrate the database
- ✅ Configure Git hooks
- ✅ Set up your IDE
- ✅ Build the project
- ✅ Launch the development environment

## 🛠️ Manual Setup (10 minutes)

If you prefer manual setup or the automated script has issues:

### 1. Clone and Install (3 minutes)
```bash
git clone <repository-url>
cd running-app-mvp
npm ci  # Faster than npm install
```

### 2. Environment Setup (1 minute)
```bash
cp .env.example .env
# Edit .env and set JWT_SECRET to a secure value
```

### 3. Database Setup (2 minutes)
```bash
npm run prisma:migrate
npm run prisma:generate
```

### 4. Verify Setup (2 minutes)
```bash
npm run validate-test-env
npm run build
```

### 5. Start Development (2 minutes)
```bash
npm run dev:full
```

Visit:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## 🎯 Your First Task (10 minutes)

Let's make your first contribution to ensure everything works:

### 1. Understand the Structure (3 minutes)

```
running-app-mvp/
├── src/              # React frontend
├── server/           # Express backend
├── prisma/           # Database schema
├── tests/            # Test files
└── docs/             # Documentation
```

### 2. Make a Simple Change (5 minutes)

Let's add a welcome message:

1. Open `src/App.tsx`
2. Find the main heading
3. Change it to include your name:
   ```tsx
   <h1>Welcome to Running Tracker, [Your Name]!</h1>
   ```

### 3. Test Your Change (2 minutes)

```bash
# Run tests
npm test

# Check in browser
# http://localhost:3000
```

## 🔍 Quick Command Reference

### Development
```bash
npm run dev              # Backend only (port 3001)
npm run dev:frontend     # Frontend only (port 3000)
npm run dev:full         # Both frontend and backend
```

### Testing
```bash
npm test                 # Run unit tests
npm run test:integration # Run integration tests
npm run test:e2e        # Run end-to-end tests
npm run test:coverage   # Check code coverage
```

### Code Quality
```bash
npm run lint            # Check code style
npm run lint:fix        # Auto-fix issues
npm run typecheck       # TypeScript checks
```

### Database
```bash
npm run prisma:studio   # Visual database editor
npm run prisma:migrate  # Run migrations
```

## 🆘 Troubleshooting

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000
# Kill it
kill -9 <PID>

# Or change ports in .env
PORT=3002
FRONTEND_PORT=3003
```

### Dependencies Won't Install
```bash
# Clear npm cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Database Issues
```bash
# Reset database
rm prisma/*.db
npm run prisma:migrate
```

### Tests Failing
```bash
# Setup test environment
npm run test:setup
npm run validate-test-env
```

## 📚 Next Steps (5 minutes)

Now that you're up and running:

1. **Read CLAUDE.md** - Development guidelines and standards
2. **Explore the docs/** folder - Architecture and patterns
3. **Check tasks.md** - See what needs to be done
4. **Join the team** - Introduce yourself!

## 🎉 Success Checklist

You're ready when:

- [ ] Development servers are running
- [ ] You can see the app at http://localhost:3000
- [ ] Tests are passing (`npm test`)
- [ ] You've made your first change
- [ ] Total time: <30 minutes ⏱️

## 💡 Pro Tips

1. **Use VS Code** - We have great extensions configured
2. **Install recommended extensions** - When VS Code prompts you
3. **Use the terminal in VS Code** - Everything in one place
4. **Enable auto-save** - Never lose work
5. **Ask questions** - We're here to help!

## 📊 Track Your Onboarding

We have a tool to measure onboarding time:

```bash
# Start tracking
npm run onboarding:start

# Check progress
npm run onboarding:check

# Validate setup
npm run onboarding:validate
```

---

**Welcome aboard! 🎊** You're now part of the Running App team. Happy coding!

Need help? Check our [troubleshooting guide](docs/TROUBLESHOOTING.md) or ask the team.