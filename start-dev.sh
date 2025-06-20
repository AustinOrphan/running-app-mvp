#!/bin/bash

# Start both frontend and backend in development mode
echo "🚀 Starting Running Tracker MVP in development mode..."
echo ""
echo "🎉 Starting both servers concurrently..."
echo "   📱 Frontend: http://localhost:3000"
echo "   🔧 Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers"

# Use the existing concurrently setup
npm run dev:full
