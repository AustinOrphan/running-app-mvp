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
