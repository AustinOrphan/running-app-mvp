#!/bin/bash

# Start Server for Lighthouse CI with Readiness Check
# This script starts the preview server and waits for full readiness

set -e

echo "🚀 Starting preview server for Lighthouse CI..."

# Start the preview server in background
npm run preview -- --port 3000 --host &
SERVER_PID=$!

# Give the server a moment to start
sleep 2

# Wait for server readiness with our comprehensive checker
echo "⏳ Waiting for server readiness..."
if npm run wait-for-server:verbose; then
    echo "✅ Server readiness check completed successfully"
    echo "🔍 Lighthouse CI can now begin testing..."
    
    # Keep the server running and wait for Lighthouse to finish
    wait $SERVER_PID
else
    echo "❌ Server readiness check failed"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi