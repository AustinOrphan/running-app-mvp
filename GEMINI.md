# Gemini Project Analysis

## Project Overview

This is a full-stack web application for tracking running activities. It's built with a modern tech stack, including:

- **Frontend:** React 19 with TypeScript and Vite
- **Backend:** Express.js with TypeScript
- **Database:** Prisma ORM with SQLite
- **Testing:** Vitest for unit tests, Jest for integration tests, and Playwright for end-to-end tests.

The project is well-structured, with a clear separation between the frontend (`src/`) and backend (`server/`) code. It also includes a comprehensive suite of tests and a robust set of development and quality assurance tools.

## Building and Running

### Development

To start the development servers for both the frontend and backend, run:

```bash
npm run dev
```

This will start the frontend on `http://localhost:3000` and the backend on `http://localhost:3001`.

### Production

To build the project for production, run:

```bash
npm run build
```

This will create a `dist` directory with the production-ready assets.

To start the production server, run:

```bash
npm run start
```

## Testing

The project has a comprehensive test suite. Here are the main commands:

- `npm run test`: Run all unit tests.
- `npm run test:integration`: Run all integration tests.
- `npm run test:e2e`: Run all end-to-end tests.
- `npm run test:all`: Run all tests (unit, integration, and e2e).

## Development Conventions

- **Code Style:** The project uses ESLint and Prettier to enforce a consistent code style.
- **Type Checking:** TypeScript is used for static type checking.
- **Testing:** The project has a high test coverage requirement and uses a combination of unit, integration, and end-to-end tests.
- **Commits:** The project uses conventional commits, enforced by commitlint.
- **CI/CD:** The project has a CI/CD pipeline configured with GitHub Actions.
