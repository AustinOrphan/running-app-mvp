@echo off
echo Starting Running App Backend Server...
cd /d "%~dp0"
echo Loading environment variables...
if not exist .env (
    echo Error: .env file not found!
    pause
    exit /b 1
)
echo Starting server on port 3001...
npx tsx server.ts
