# Contributing to Running Tracker MVP

Thank you for your interest in contributing to the Running Tracker MVP! This document provides guidelines and instructions for contributors.

## 🚀 Quick Start for Contributors

1. **Fork the repository**
2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/running-app-mvp.git
   cd running-app-mvp
   ```
3. **Set up the development environment**
   ```bash
   ./setup.sh
   ```
4. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 🛠️ Development Workflow

### Setting up the Development Environment

```bash
# Install dependencies and set up database
npm run setup

# Start both backend and frontend in development mode
npm run dev:full

# Or start them separately
npm run dev          # Backend (port 3001)
npm run dev:frontend # Frontend (port 3000)
```

### Code Style and Standards

- **TypeScript**: We use TypeScript for both frontend and backend
- **ESLint**: Follow the existing linting rules
- **Prettier**: Code formatting is handled by Prettier
- **Naming**: Use descriptive names for variables, functions, and components

### Database Changes

If you need to modify the database schema:

1. Update `prisma/schema.prisma`
2. Create a migration:
   ```bash
   npx prisma migrate dev --name your-migration-name
   ```
3. Generate the new Prisma client:
   ```bash
   npx prisma generate
   ```

## 📝 Submitting Changes

### Pull Request Process

1. **Ensure your code works**
   - Test the application thoroughly
   - Make sure both frontend and backend start without errors
   - Verify database migrations work correctly

2. **Create a descriptive commit message**

   ```bash
   git commit -m "feat: add goal progress tracking functionality

   - Add progress calculation to goals API
   - Create progress visualization component
   - Update goal card to show completion percentage"
   ```

3. **Push to your fork and create a pull request**

   ```bash
   git push origin feature/your-feature-name
   ```

4. **Fill out the pull request template**
   - Describe what your changes do
   - Include screenshots for UI changes
   - List any breaking changes
   - Reference related issues

### Commit Message Format

We follow the conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**

```bash
feat(auth): add password reset functionality
fix(runs): correct pace calculation for long runs
docs(readme): update installation instructions
style(components): format RunCard component
```

## 🧪 Testing

Currently, the project relies on manual testing. When contributing:

1. Test your changes thoroughly in both development and production builds
2. Test on different screen sizes (mobile, tablet, desktop)
3. Test authentication flows
4. Test database operations (create, read, update, delete)

Future contributors are welcome to add automated testing!

## 📦 Project Structure

```
running-app-mvp/
├── src/                    # Frontend React code
│   ├── components/         # React components
│   ├── hooks/             # Custom React hooks
│   ├── pages/             # Page components
│   └── utils/             # Frontend utilities
├── routes/                 # Backend API routes
├── middleware/            # Express middleware
├── prisma/               # Database schema and migrations
├── components/           # Backend components (legacy structure)
├── hooks/               # Backend hooks (legacy structure)
└── utils/               # Backend utilities (legacy structure)
```

## 🐛 Reporting Issues

When reporting issues, please include:

1. **Clear description** of the problem
2. **Steps to reproduce** the issue
3. **Expected behavior** vs actual behavior
4. **Environment details** (OS, Node.js version, browser)
5. **Screenshots** if applicable
6. **Console errors** if any

## 💡 Feature Requests

We welcome feature requests! Please:

1. Check if the feature already exists or is planned
2. Describe the use case and benefit
3. Provide mockups or examples if helpful
4. Consider the scope - smaller features are more likely to be implemented quickly

## 🎯 Areas Where We Need Help

- **Testing**: Set up automated testing framework
- **UI/UX**: Improve mobile responsiveness
- **Features**: GPX file upload and route visualization
- **Performance**: Optimize database queries and frontend rendering
- **Documentation**: API documentation, tutorials
- **Accessibility**: Improve keyboard navigation and screen reader support

## 🤝 Code Review Process

All contributions go through code review:

1. Maintainers will review your pull request
2. We may request changes or ask questions
3. Once approved, your changes will be merged
4. We'll update the changelog and release notes

## 📋 Development Guidelines

### Backend (Express + Prisma)

- Follow RESTful API conventions
- Use proper HTTP status codes
- Implement proper error handling
- Validate all inputs
- Use Prisma for database operations
- Include proper authentication checks

### Frontend (React + TypeScript)

- Use functional components with hooks
- Implement proper error boundaries
- Handle loading and error states
- Use TypeScript interfaces for type safety
- Follow React best practices
- Ensure responsive design

### Database

- Use descriptive model and field names
- Include proper indexes for performance
- Write clear migration names
- Consider data integrity constraints

## ❓ Questions?

If you have questions about contributing:

1. Check this document and the main README
2. Look at existing issues and pull requests
3. Create a new issue with the "question" label
4. Reach out to the maintainers

Thank you for contributing to Running Tracker MVP! 🏃‍♂️
