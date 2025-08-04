# Detailed Setup Instructions

This document provides step-by-step instructions for setting up the Running App MVP development environment.

## System Requirements

### Minimum Requirements

- **CPU**: 2 cores
- **RAM**: 4GB
- **Storage**: 2GB free space
- **OS**: macOS 10.15+, Windows 10+, or Ubuntu 18.04+

### Recommended Requirements

- **CPU**: 4+ cores
- **RAM**: 8GB+
- **Storage**: 10GB free space
- **OS**: Latest stable version

## Step-by-Step Setup

### Step 1: Install Node.js

#### Option A: Using Node Version Manager (Recommended)

**macOS/Linux:**

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell configuration
source ~/.bashrc  # or ~/.zshrc for zsh

# Install Node.js 20
nvm install 20
nvm use 20
nvm alias default 20

# Verify installation
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

**Windows:**

1. Download nvm-windows from [github.com/coreybutler/nvm-windows](https://github.com/coreybutler/nvm-windows)
2. Run the installer
3. Open Command Prompt as Administrator
4. Run:
   ```cmd
   nvm install 20.11.0
   nvm use 20.11.0
   ```

#### Option B: Direct Installation

1. Visit [nodejs.org](https://nodejs.org/)
2. Download the LTS version (20.x)
3. Run the installer
4. Verify installation:
   ```bash
   node --version
   npm --version
   ```

### Step 2: Install Git

**macOS:**

```bash
# Git comes with Xcode Command Line Tools
xcode-select --install

# Or install via Homebrew
brew install git
```

**Windows:**

1. Download from [git-scm.com](https://git-scm.com/download/win)
2. Run the installer
3. Use recommended settings

**Linux:**

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install git

# Fedora
sudo dnf install git

# Arch
sudo pacman -S git
```

### Step 3: Install VS Code (Optional but Recommended)

1. Download from [code.visualstudio.com](https://code.visualstudio.com/)
2. Install the following extensions:
   - ESLint (dbaeumer.vscode-eslint)
   - Prettier (esbenp.prettier-vscode)
   - Prisma (Prisma.prisma)
   - Vitest (vitest.explorer)
   - Playwright Test (ms-playwright.playwright)

### Step 4: Clone the Repository

```bash
# Create a projects directory (optional)
mkdir -p ~/projects
cd ~/projects

# Clone the repository
git clone <repository-url>
cd running-app-mvp

# Verify you're on the correct branch
git branch
```

### Step 5: Install Dependencies

```bash
# Install all npm packages
npm install

# If you encounter errors, try:
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Step 6: Set Up Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file
# macOS/Linux: nano .env or vim .env
# Windows: notepad .env
```

Required environment variables:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL="file:./prisma/dev.db"

# JWT Configuration
JWT_SECRET=your-secret-key-here-change-this-in-production
JWT_EXPIRES_IN=7d

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Optional: Logging
LOG_LEVEL=debug
```

### Step 7: Initialize the Database

```bash
# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# (Optional) Seed the database with sample data
npm run seed
```

### Step 8: Set Up Git Hooks

```bash
# This should run automatically after npm install
# If not, run manually:
npm run setup:hooks

# Verify hooks are installed
ls -la .husky/
```

### Step 9: Verify the Setup

Run these commands to ensure everything is working:

```bash
# 1. Check TypeScript compilation
npm run typecheck
# Expected: No errors

# 2. Run linting
npm run lint
# Expected: No errors (or only minor warnings)

# 3. Run unit tests
npm run test:run
# Expected: All tests pass

# 4. Check database connection
npm run prisma:studio
# Expected: Prisma Studio opens in browser
```

### Step 10: Start the Application

```bash
# Start both frontend and backend
npm run dev:full

# Or start them separately:
# Terminal 1: npm run dev (backend)
# Terminal 2: npm run dev:frontend (frontend)
```

Visit:

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001/api/health

## Platform-Specific Instructions

### macOS

#### Install Xcode Command Line Tools

```bash
xcode-select --install
```

#### Install Homebrew (if needed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### Common Issues

- If you get "xcrun: error", reinstall Xcode Command Line Tools
- For M1/M2 Macs, ensure you're using native Node.js builds

### Windows

#### Enable Developer Mode

1. Settings → Update & Security → For Developers
2. Enable "Developer Mode"

#### Install Windows Build Tools

```bash
# Run as Administrator
npm install -g windows-build-tools
```

#### Use PowerShell or Git Bash

- Command Prompt may have issues with some scripts
- PowerShell or Git Bash recommended

#### Common Issues

- Long path issues: Enable long paths in Windows
- Permission errors: Run terminal as Administrator
- Line ending issues: Configure Git to use LF endings

### Linux

#### Install Build Dependencies

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install build-essential

# Fedora
sudo dnf groupinstall "Development Tools"

# Arch
sudo pacman -S base-devel
```

#### Common Issues

- Permission errors: Don't use sudo with npm
- Missing libraries: Install python3 and make

## Docker Setup (Alternative)

If you prefer using Docker:

```bash
# Build and start containers
docker-compose up -d

# Run migrations
docker-compose exec app npm run prisma:migrate

# View logs
docker-compose logs -f
```

## IDE Configuration

### VS Code Settings

Create `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "eslint.validate": ["javascript", "javascriptreact", "typescript", "typescriptreact"]
}
```

### WebStorm/IntelliJ

1. Enable ESLint: Settings → Languages → JavaScript → Code Quality Tools → ESLint
2. Enable Prettier: Settings → Languages → JavaScript → Prettier
3. Set TypeScript version: Settings → Languages → TypeScript → TypeScript Language Service

## Verification Checklist

- [ ] Node.js 20+ installed
- [ ] npm 10+ installed
- [ ] Git installed and configured
- [ ] Repository cloned successfully
- [ ] npm install completed without errors
- [ ] .env file created and configured
- [ ] Database initialized (migrations run)
- [ ] Git hooks installed
- [ ] All verification tests pass
- [ ] Application starts without errors
- [ ] Can access frontend at localhost:3000
- [ ] Can access backend at localhost:3001

## Troubleshooting Setup Issues

### npm install fails

```bash
# Clear npm cache
npm cache clean --force

# Use legacy peer deps (if needed)
npm install --legacy-peer-deps

# Try with different registry
npm install --registry https://registry.npmjs.org/
```

### Database initialization fails

```bash
# Remove existing database
rm -rf prisma/dev.db
rm -rf prisma/migrations

# Reinitialize
npx prisma migrate dev --name init
```

### Port already in use

```bash
# Find what's using the port
# macOS/Linux
lsof -i :3001
lsof -i :3000

# Windows
netstat -ano | findstr :3001
netstat -ano | findstr :3000

# Kill the process or use different ports
PORT=3002 npm run dev
```

### Permission errors

```bash
# Fix npm permissions (macOS/Linux)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

## Getting Help

If you encounter issues:

1. Check the [Troubleshooting Guide](./TROUBLESHOOTING.md)
2. Search existing issues in the repository
3. Ask in the team chat with:
   - Your OS and version
   - Node.js and npm versions
   - The exact error message
   - Steps you've already tried

## Next Steps

Once setup is complete:

1. Read the [Architecture Overview](./ARCHITECTURE_OVERVIEW.md)
2. Review [Common Workflows](./COMMON_WORKFLOWS.md)
3. Check out a starter issue from the issue tracker
4. Join the daily standup to introduce yourself

Welcome aboard! 🎉
