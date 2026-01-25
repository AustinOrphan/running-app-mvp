#!/bin/bash

# Quick start script - install and run everything
echo "🚀 Quick Start - Running Tracker MVP"
echo "===================================="

# Run setup if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Running initial setup..."
    ./setup.sh
fi

# Start development servers
./start-dev.sh
