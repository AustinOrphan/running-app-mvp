# Codebase Structure

## Root Level

- `server.ts` - Express server entry point
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `vite.config.ts` - Frontend build configuration
- `vitest.config.ts` - Unit test configuration
- `playwright.config.ts` - E2E test configuration
- `jest.config.js` - Integration test configuration

## Frontend (`src/`)

```
src/
├── components/          # React components
│   ├── Auth/           # Authentication components
│   ├── Goals/          # Goal-related components
│   ├── Navigation/     # Navigation components
│   ├── Notifications/  # Notification components
│   ├── Pages/          # Page components
│   ├── Runs/           # Run-related components
│   ├── Stats/          # Statistics components
│   ├── Toast/          # Toast notification components
│   └── Common/         # Shared components
├── hooks/              # Custom React hooks
├── pages/              # Top-level page components
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
├── constants/          # Application constants
├── data/               # Static data and templates
└── App.tsx             # Main application component
```

## Backend

```
routes/                 # API route handlers
├── auth.ts            # Authentication endpoints
├── runs.ts            # Run CRUD operations
├── goals.ts           # Goal management
├── stats.ts           # Statistics and analytics
└── races.ts           # Race management

middleware/             # Express middleware
components/             # Backend components
hooks/                 # Backend hooks
utils/                 # Backend utilities
prisma/                # Database schema and migrations
```

## Testing (`tests/`)

```
tests/
├── setup/             # Test configuration and setup
├── unit/              # Component and utility tests
├── integration/       # API integration tests
├── e2e/               # End-to-end tests
├── accessibility/     # Accessibility tests
└── coverage/          # Coverage reporting utilities
```

## Key Architecture Patterns

- **Component Composition**: Reusable React components
- **Custom Hooks**: Logic separation and reusability
- **Type-Safe APIs**: TypeScript throughout the stack
- **Separation of Concerns**: Clear frontend/backend boundaries
- **Utility-First**: Shared utility functions for common operations
