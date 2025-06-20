#!/bin/bash

# Quick Start Script for Running Tracker App
# This script sets up and starts the application in one command

set -e

echo "🏃 Starting Running Tracker App..."
echo

# Check if setup has been run
if [ ! -f ".env" ] || [ ! -d "node_modules" ] || [ ! -f "prisma/dev.db" ]; then
    echo "⚠️  First time setup detected. Running full setup..."
    ./setup.sh
    echo
fi

# Start the application
echo "🚀 Starting application servers..."
./start-dev.sh