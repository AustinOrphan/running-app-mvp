#!/bin/bash

# 🏃‍♂️ Running Tracker MVP - Automated Setup Script
# This script will set up your development environment automatically

set -e  # Exit on any error

echo "🏃‍♂️ Running Tracker MVP - Automated Setup"
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm found: $(npm --version)"
echo ""

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""

# Step 2: Set up database
echo "🗄️  Setting up database..."

echo "   Running Prisma migration..."
npx prisma migrate dev --name init

if [ $? -eq 0 ]; then
    echo "✅ Database migration completed"
else
    echo "❌ Database migration failed"
    exit 1
fi

echo "   Generating Prisma client..."
npx prisma generate

if [ $? -eq 0 ]; then
    echo "✅ Prisma client generated"
else
    echo "❌ Prisma client generation failed"
    exit 1
fi

echo ""

# Step 3: Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. It should already exist, but just in case..."
    echo "DATABASE_URL=\"file:./dev.db\"" > .env
    echo "JWT_SECRET=\"your-super-secret-jwt-key-change-this-in-production\"" >> .env
    echo "PORT=3001" >> .env
    echo "NODE_ENV=development" >> .env
    echo "✅ Created .env file"
else
    echo "✅ .env file already exists"
fi

echo ""

# Create start script for convenience
echo "📝 Creating convenience scripts..."

cat > start-dev.sh << 'EOF'
#!/bin/bash

# Start both frontend and backend in development mode
echo "🚀 Starting Running Tracker MVP in development mode..."
echo ""

# Function to kill background processes on script exit
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}

# Set up trap to cleanup on script exit
trap cleanup SIGINT SIGTERM EXIT

# Start backend server in background
echo "🔧 Starting backend server on port 3001..."
npm run dev &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start frontend server in background
echo "🎨 Starting frontend server on port 3000..."
npm run dev:frontend &
FRONTEND_PID=$!

echo ""
echo "🎉 Servers started successfully!"
echo "   📱 Frontend: http://localhost:3000"
echo "   🔧 Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for background processes
wait
EOF

chmod +x start-dev.sh

cat > quick-start.sh << 'EOF'
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
EOF

chmod +x quick-start.sh

echo "✅ Created convenience scripts:"
echo "   - start-dev.sh (start both servers)"
echo "   - quick-start.sh (setup + start)"

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "🚀 Next steps:"
echo "   1. Run: ./start-dev.sh"
echo "   2. Open your browser to: http://localhost:3000"
echo "   3. Register a new account and start tracking runs!"
echo ""
echo "📚 For more information, see README.md"