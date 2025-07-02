# 🏃‍♂️ Running Tracker MVP

A full-stack web application for tracking running activities, built with React, Express, Prisma, and SQLite.

## 🚀 Quick Start

### Automated Setup (Recommended)

```bash
# Make setup script executable and run it
chmod +x setup.sh
./setup.sh
```

### Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up database
npx prisma migrate dev --name init
npx prisma generate

# 3. Start development servers (run in separate terminals)
npm run dev          # Backend server (port 3001)
npm run dev:frontend # Frontend server (port 3000)
```

## 📱 Usage

1. Open your browser to `http://localhost:3000`
2. Register a new account with any email/password
3. Click "Add Sample Run" to create test data
4. View and manage your runs in the dashboard

## 🏗️ Project Structure

```
running-app-mvp/
├── src/                    # Frontend React code
│   ├── components/         # React components
│   ├── hooks/             # Custom React hooks
│   ├── pages/             # Page components
│   └── utils/             # Utility functions
├── routes/                 # Backend API routes
├── middleware/            # Express middleware
├── prisma/               # Database schema
├── components/           # Backend components
├── hooks/               # Backend hooks
└── utils/               # Backend utilities
```

## 🛠️ Technology Stack

**Frontend:**

- React 18 with TypeScript
- Vite for development
- CSS for styling

**Backend:**

- Express.js with TypeScript
- Prisma ORM
- SQLite database
- JWT authentication
- bcrypt for password hashing

## 📡 API Endpoints

### Authentication

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login

### Runs

- `GET /api/runs` - Get all runs
- `POST /api/runs` - Create new run
- `GET /api/runs/:id` - Get specific run
- `PUT /api/runs/:id` - Update run
- `DELETE /api/runs/:id` - Delete run
- `GET /api/runs/simple-list` - Get simplified run list

### Statistics

- `GET /api/stats/insights-summary` - Weekly insights
- `GET /api/stats/type-breakdown` - Run type breakdown

### Goals & Races

- `GET /api/goals` - Get user goals
- `POST /api/goals` - Create new goal
- `DELETE /api/goals/:id` - Delete goal
- `GET /api/races` - Get user races
- `POST /api/races` - Create new race

## 🔧 Development Commands

```bash
# Backend development
npm run dev                 # Start backend with hot reload
npm run build              # Build backend
npm run start              # Start production backend

# Frontend development
npm run dev:frontend       # Start frontend with hot reload
npm run build              # Build both backend and frontend
npm run preview            # Preview production build

# Database
npm run prisma:migrate     # Run database migrations
npm run prisma:generate    # Generate Prisma client
npm run prisma:studio      # Open Prisma Studio
```

## ⚙️ Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"
LOG_SALT="set-a-strong-random-string-for-production"
PORT=3001
NODE_ENV=development
```

`LOG_SALT` is used to anonymize user identifiers in log files. For
production deployments, generate a cryptographically strong random string
and set it here.

## 🔐 Security Notes

- JWT secret is set in `.env` - change this for production
- `LOG_SALT` must be defined in production so logs can be correlated without
  exposing raw user IDs
- Passwords are hashed with bcrypt
- All API routes except auth are protected with JWT middleware
- User data is isolated by user ID

## 🐛 Troubleshooting

### Common Issues

**"Backend Offline" message:**

- Ensure backend server is running on port 3001
- Check that no other process is using port 3001

**Database errors:**

- Run `npx prisma migrate dev --name init` to set up database
- Run `npx prisma generate` to generate client

**Frontend can't reach backend:**

- Vite proxy is configured to forward `/api` requests to port 3001
- Ensure both servers are running

### Logs

- Backend logs appear in the terminal running `npm run dev`
- Frontend logs appear in browser console

## 📈 Future Enhancements

- [ ] GPX file upload and route visualization
- [ ] Advanced statistics and charts
- [ ] Goal progress tracking
- [ ] Race time predictions
- [ ] Social features and run sharing
- [ ] Mobile responsive improvements
- [ ] Dark mode theme
- [ ] Export data functionality

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details
