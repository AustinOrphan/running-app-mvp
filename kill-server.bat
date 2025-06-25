@echo off
echo Stopping Running App processes...

echo Checking for Node.js processes on port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
    echo Killing process %%a
    taskkill /PID %%a /F
)

echo Checking for any tsx/node processes...
taskkill /IM node.exe /F 2>nul
taskkill /IM tsx.exe /F 2>nul

echo Done! You can now start the server.
pause
