@echo off
echo 🚀 Starting Running App - Full Setup
echo =====================================

cd /d "%~dp0"

echo 📋 Step 1: Checking environment...
if not exist .env (
    echo ❌ Error: .env file not found!
    echo 💡 Copying from .env.example...
    copy .env.example .env
)

echo 📋 Step 2: Installing dependencies...
npm install

echo 📋 Step 3: Setting up database...
npx prisma generate
npx prisma migrate dev --name init

echo 📋 Step 4: Creating test user...
npx tsx create-test-user.ts

echo 📋 Step 5: Starting servers...
echo 🔧 Backend will start on port 3002
echo 🎨 Frontend will start on port 3000
echo 🔗 Open http://localhost:3000 in your browser

echo Starting backend...
start "Backend Server" cmd /k "npx tsx server.ts"

timeout /t 3 /nobreak > nul

echo Starting frontend...
start "Frontend Server" cmd /k "npm run dev:frontend"

echo ✅ Setup complete!
echo 📧 Test login: test@example.com
echo 🔐 Test password: password123
pause
