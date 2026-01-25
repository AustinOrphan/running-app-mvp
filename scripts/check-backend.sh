#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Running Tracker Backend Diagnostics${NC}"
echo "=================================================="

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -i :$port > /dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is not in use
    fi
}

# Function to test backend health
test_backend() {
    echo -e "\n${BLUE}Testing backend health...${NC}"

    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health | grep -q "200"; then
        echo -e "${GREEN}✅ Backend is responding correctly${NC}"
        return 0
    else
        echo -e "${RED}❌ Backend is not responding or returning errors${NC}"
        return 1
    fi
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "server.ts" ]; then
    echo -e "${RED}❌ Error: This script must be run from the running-app-mvp root directory${NC}"
    echo "Please cd to the project root and try again."
    exit 1
fi

echo -e "${BLUE}📂 Current directory:${NC} $(pwd)"

# Check Node.js version
echo -e "\n${BLUE}Checking Node.js version...${NC}"
if command -v node > /dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js found: ${NODE_VERSION}${NC}"
else
    echo -e "${RED}❌ Node.js not found. Please install Node.js first.${NC}"
    exit 1
fi

# Check npm dependencies
echo -e "\n${BLUE}Checking dependencies...${NC}"
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ node_modules directory exists${NC}"
else
    echo -e "${YELLOW}⚠️ node_modules not found. Running npm install...${NC}"
    npm install
fi

# Check if ports are available
echo -e "\n${BLUE}Checking port availability...${NC}"

if check_port 3000; then
    FRONTEND_PID=$(lsof -ti :3000)
    echo -e "${GREEN}✅ Port 3000 (frontend) is in use by PID: ${FRONTEND_PID}${NC}"
else
    echo -e "${YELLOW}⚠️ Port 3000 (frontend) is not in use${NC}"
fi

if check_port 3001; then
    BACKEND_PID=$(lsof -ti :3001)
    echo -e "${GREEN}✅ Port 3001 (backend) is in use by PID: ${BACKEND_PID}${NC}"

    # Test if backend is actually working
    if test_backend; then
        echo -e "\n${GREEN}🎉 Everything looks good! Backend is running and healthy.${NC}"
        echo "You can access the app at: http://localhost:3000"
        exit 0
    else
        echo -e "${RED}❌ Backend process exists but not responding properly${NC}"
        echo "This might be a startup issue or error in the backend code."
    fi
else
    echo -e "${RED}❌ Port 3001 (backend) is not in use${NC}"
    echo "Backend server is not running."
fi

# Check for any existing node processes that might be related
echo -e "\n${BLUE}Checking for existing processes...${NC}"
if pgrep -f "tsx.*server.ts" > /dev/null; then
    echo -e "${YELLOW}⚠️ Found tsx server process(es):${NC}"
    pgrep -f "tsx.*server.ts" | while read pid; do
        echo "  PID: $pid"
    done

    echo -e "\n${YELLOW}These processes might be hanging. Kill them? (y/n)${NC}"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        pkill -f "tsx.*server.ts"
        echo -e "${GREEN}✅ Killed existing tsx server processes${NC}"
        sleep 2
    fi
fi

# Offer to start the backend
echo -e "\n${BLUE}Backend Startup Options:${NC}"
echo "1. Start backend only (npm run dev)"
echo "2. Start both frontend and backend (npm run dev:full)"
echo "3. Use the start-dev.sh script"
echo "4. Manual troubleshooting info"
echo "5. Exit"

echo -e "\n${BLUE}What would you like to do? (1-5):${NC}"
read -r choice

case $choice in
    1)
        echo -e "${BLUE}Starting backend server...${NC}"
        echo "Note: Keep this terminal open. The backend will run here."
        echo "Open another terminal to run the frontend if needed."
        echo ""
        npm run dev
        ;;
    2)
        echo -e "${BLUE}Starting both servers...${NC}"
        echo "This will start both frontend (port 3000) and backend (port 3001)"
        echo ""
        npm run dev:full
        ;;
    3)
        echo -e "${BLUE}Using start-dev.sh script...${NC}"
        if [ -f "start-dev.sh" ]; then
            chmod +x start-dev.sh
            ./start-dev.sh
        else
            echo -e "${RED}❌ start-dev.sh not found${NC}"
        fi
        ;;
    4)
        echo -e "\n${BLUE}Manual Troubleshooting:${NC}"
        echo ""
        echo -e "${YELLOW}Common Issues:${NC}"
        echo "• Backend server not starting: Check for TypeScript errors"
        echo "• Port 3001 in use: Kill existing process or use different port"
        echo "• Database connection: Make sure Prisma is set up correctly"
        echo "• Environment variables: Check if .env file is needed"
        echo ""
        echo -e "${YELLOW}Manual Commands:${NC}"
        echo "• Start backend: npm run dev"
        echo "• Start frontend: npm run dev:frontend"
        echo "• Check backend logs: npm run dev (watch for errors)"
        echo "• Test health endpoint: curl http://localhost:3001/api/health"
        echo "• Kill processes: pkill -f 'tsx.*server.ts'"
        echo ""
        echo -e "${YELLOW}Database Setup (if needed):${NC}"
        echo "• Generate Prisma client: npx prisma generate"
        echo "• Run migrations: npx prisma migrate dev"
        echo "• Setup everything: npm run setup"
        ;;
    5)
        echo -e "${BLUE}Exiting...${NC}"
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice. Exiting...${NC}"
        exit 1
        ;;
esac
