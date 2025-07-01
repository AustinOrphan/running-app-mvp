#!/bin/bash

# Codex environment setup script
# Installs dependencies and prepares the database
set -euo pipefail

# Show versions
node --version
npm --version

# Create .env if missing
if [ ! -f .env ]; then
  echo "Creating .env from .env.example" 
  cp .env.example .env
fi

# Install dependencies
npm ci

# Prisma setup
# Apply existing migrations to new database
npx prisma migrate deploy
npx prisma generate

# Install Playwright browsers
npx playwright install --with-deps

echo "Codex setup complete"
