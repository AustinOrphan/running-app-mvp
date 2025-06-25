# 🏃‍♂️ Running App - Windows Setup & Startup Guide

## 📋 Table of Contents
- [Quick Start](#quick-start)
- [Manual Setup](#manual-setup)
- [Troubleshooting](#troubleshooting)
- [Available Scripts](#available-scripts)
- [Port Configuration](#port-configuration)
- [Test Credentials](#test-credentials)

---

## 🚀 Quick Start

### Option A: Automated Setup (Recommended)
```batch
# Run the complete setup script
start-full-app.bat
```

This script will:
- ✅ Check and create `.env` file
- ✅ Install dependencies
- ✅ Setup database and run migrations
- ✅ Create test user account
- ✅ Start both backend and frontend servers
- ✅ Open appropriate terminals

### Option B: Individual Commands
```batch
# 1. Setup (run once)
npm install
npx prisma generate
npx prisma migrate dev --name init
npx tsx create-test-user.ts

# 2. Start servers (in separate terminals)
# Terminal 1 - Backend
npm run dev

# Terminal 2 - Frontend  
npm run dev:frontend
```

---

## 🔧 Manual Setup

### Prerequisites
- Node.js v18+ installed
- Windows 10/11
- Git (for cloning repository)

### Step-by-Step Setup

1. **Clone and Navigate**
   ```batch
   git clone <repository-url>
   cd running-app-mvp
   ```

2. **Environment Configuration**
   ```batch
   # Copy environment template
   copy .env.example .env
   
   # Edit .env file with your settings
   notepad .env
   ```

3. **Install Dependencies**
   ```batch
   npm install
   ```

4. **Database Setup**
   ```batch
   # Generate Prisma client
   npx prisma generate
   
   # Run database migrations
   npx prisma migrate dev --name init
   
   # Create test user
   npx tsx create-test-user.ts
   ```

5. **Start Application**
   ```batch
   # Option 1: Both servers together
   npm run dev:full
   
   # Option 2: Separate terminals
   # Terminal 1:
   npm run dev
   
   # Terminal 2:
   npm run dev:frontend
   ```

---

## 🔧 Troubleshooting

### Port Already in Use Error
If you see `Error: listen EADDRINUSE: address already in use :::3001`:

**Solution 1: Kill Stuck Processes**
```batch
# PowerShell (Recommended)
powershell -ExecutionPolicy Bypass -File kill-server.ps1

# OR Command Prompt
kill-server.bat
```

**Solution 2: Use Different Port**
The server will automatically find an available port and display:
```
⚠️  Port 3001 is busy, using port 3002 instead
📝 Update your frontend proxy to target: http://localhost:3002
```

**Solution 3: Manual Process Kill**
```batch
# Find processes using port 3001
netstat -ano | findstr :3001

# Kill specific process (replace PID with actual number)
taskkill /PID [PID_NUMBER] /F

# Kill all Node.js processes
taskkill /IM node.exe /F
taskkill /IM tsx.exe /F
```

### Database Connection Issues
```batch
# Reset database
npx prisma migrate reset

# Regenerate client
npx prisma generate

# Check database status
npx prisma studio
```

### Authentication Errors
```batch
# Recreate test user
npx tsx create-test-user.ts

# Check users in database
# Visit: http://localhost:3002/api/debug/users
```

### Frontend Proxy Errors
1. Ensure backend is running first
2. Check port configuration in `vite.config.ts`
3. Verify `.env` PORT setting matches Vite proxy target

---

## 📜 Available Scripts

### Development Scripts
```json
{
  "dev": "tsx watch server.ts",                    // Start backend server
  "dev:frontend": "vite",                          // Start frontend dev server  
  "dev:full": "concurrently \"npm run dev\" \"npm run dev:frontend\"", // Both servers
  "setup": "npm install && npx prisma migrate dev --name init && npx prisma generate"
}
```

### Database Scripts
```json
{
  "prisma:generate": "prisma generate",            // Generate Prisma client
  "prisma:migrate": "prisma migrate dev",          // Run migrations
  "prisma:studio": "prisma studio"                 // Open database GUI
}
```

### Utility Scripts
```batch
# Custom helper scripts
start-full-app.bat          # Complete automated setup
start-server.bat            # Start backend only
kill-server.bat             # Kill stuck processes (CMD)
kill-server.ps1             # Kill stuck processes (PowerShell)
create-test-user.ts         # Create test user account
```

---

## 🌐 Port Configuration

### Default Ports
- **Frontend (Vite)**: `3000`
- **Backend (Express)**: `3002` (changed from 3001 to avoid conflicts)
- **Database**: SQLite file (`./dev.db`)

### Customizing Ports

**Backend Port** (`.env` file):
```env
PORT=3002
```

**Frontend Port** (`vite.config.ts`):
```typescript
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3002', // Backend port
        changeOrigin: true,
      },
    },
  },
})
```

### Port Conflict Resolution
The server includes automatic port detection:
- If configured port is busy, it finds next available port
- Displays clear message about port change
- Provides updated URLs for health checks

---

## 🔐 Test Credentials

### Default Test Account
```
Email: test@example.com
Password: password123
```

### Creating Additional Users
```batch
# Method 1: Use registration endpoint
# POST http://localhost:3002/api/auth/register
# Body: { "email": "user@example.com", "password": "yourpassword" }

# Method 2: Modify create-test-user.ts script
npx tsx create-test-user.ts
```

---

## 🔗 Application URLs

### Development URLs
- **Application**: `http://localhost:3000`
- **Backend API**: `http://localhost:3002/api`
- **Health Check**: `http://localhost:3002/api/health`
- **Debug Users**: `http://localhost:3002/api/debug/users`
- **Database Studio**: `npx prisma studio` (opens in browser)

### API Endpoints
```
POST /api/auth/register    # User registration
POST /api/auth/login       # User login
GET  /api/runs            # Get user runs
POST /api/runs            # Create new run
GET  /api/goals           # Get user goals
GET  /api/stats           # Get user statistics
```

---

## 🐛 Common Issues & Solutions

### Issue: "Prisma Client Not Generated"
**Solution:**
```batch
npx prisma generate
```

### Issue: "Module Not Found" Errors
**Solution:**
```batch
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Issue: Database Schema Out of Sync
**Solution:**
```batch
npx prisma migrate reset
npx prisma migrate dev --name init
```

### Issue: Server Won't Start
**Check:**
1. ✅ `.env` file exists and has correct values
2. ✅ Database is accessible (`dev.db` file exists)
3. ✅ No other processes using the port
4. ✅ All dependencies installed

---

## 🏗️ Project Structure
```
running-app-mvp/
├── .env                    # Environment variables
├── server.ts              # Express backend server
├── vite.config.ts         # Frontend development config
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── migrations/        # Database migrations
├── src/                   # Frontend React application
├── routes/                # Backend API routes
├── middleware/            # Express middleware
└── utils/                 # Utility functions
```

---

## 🔄 Development Workflow

1. **Start Development**
   ```batch
   start-full-app.bat
   ```

2. **Make Changes**
   - Frontend changes auto-reload (Vite HMR)
   - Backend changes auto-restart (tsx watch)

3. **Database Changes**
   ```batch
   # After modifying schema.prisma
   npx prisma migrate dev --name describe_changes
   ```

4. **Stop Development**
   - `Ctrl+C` in each terminal
   - Or close terminal windows

---

## 📞 Support

If you encounter issues not covered in this guide:

1. Check the terminal output for specific error messages
2. Ensure all prerequisites are installed
3. Try the automated setup script: `start-full-app.bat`
4. Review the troubleshooting section above

---

*Last updated: June 25, 2025*
