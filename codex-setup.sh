#!/bin/bash

# Codex environment setup script
# Installs dependencies and prepares the database
set -euo pipefail

# Check prerequisites
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js first."
  exit 1
fi
if ! command -v npm &> /dev/null; then
  echo "❌ npm is not installed. Please install npm first."
  exit 1
fi

# Show versions
node --version
npm --version

# Create .env if missing
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "Creating .env from .env.example" 
    cp .env.example .env
  else
    echo "Creating .env with default values"
    cat > .env << 'EOF'
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"
PORT=3001
NODE_ENV=development
EOF
  fi
fi

# Install dependencies
npm ci || { echo "❌ Failed to install dependencies."; exit 1; }

# Prisma setup
# Apply existing migrations to new database
npx prisma migrate deploy || { echo "❌ Prisma migration failed."; exit 1; }
npx prisma generate || { echo "❌ Prisma client generation failed."; exit 1; }

# Install Playwright browsers
npx playwright install --with-deps || { echo "❌ Playwright browser installation failed."; exit 1; }

echo "Codex setup complete"
