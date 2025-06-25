# Coding Conventions and Style

## TypeScript Configuration

- **Strict mode enabled**: All strict TypeScript checks active
- **Target**: ES2022 with modern JavaScript features
- **Module system**: ESNext with bundler resolution
- **Path aliases**: `@/*` maps to project root
- **JSX**: React JSX transform

## Naming Conventions

- **Files**: kebab-case for files (`goal-card.tsx`, `use-auth.ts`)
- **Components**: PascalCase (`GoalCard`, `RunForm`)
- **Functions**: camelCase (`formatDuration`, `calculatePace`)
- **Constants**: UPPER_SNAKE_CASE (`GOAL_TYPES`, `API_ENDPOINTS`)
- **Types/Interfaces**: PascalCase (`Goal`, `RunFormData`)

## Component Patterns

- **Function components** with hooks (no class components)
- **TypeScript interfaces** for props (`ComponentNameProps`)
- **Default exports** for components
- **Named exports** for utilities and types
- **Props destructuring** in component parameters

## Code Organization

- **One component per file**
- **Co-located types** with components when component-specific
- **Shared types** in `src/types/` directory
- **Custom hooks** in `src/hooks/` directory
- **Utility functions** in `src/utils/` directory

## Import/Export Style

```typescript
// React imports first
import React from 'react';

// Third-party imports
import { format } from 'date-fns';

// Local imports (components, hooks, utils)
import { GoalCard } from '../components/GoalCard';
import { useAuth } from '../hooks/useAuth';
import { formatDuration } from '../utils/formatters';

// Types last
import type { Goal, RunFormData } from '../types';
```

## Error Handling

- **Try-catch blocks** for async operations
- **Error boundaries** for React component errors
- **Validation** with Zod schemas
- **User-friendly error messages**

## State Management

- **React hooks** (useState, useEffect, useReducer)
- **Custom hooks** for complex state logic
- **No external state management** (Redux, Zustand) - keeping it simple for MVP

## API Conventions

- **RESTful endpoints** (`GET /api/runs`, `POST /api/goals`)
- **Consistent error responses** with status codes
- **JWT authentication** for protected routes
- **Zod validation** for request bodies

## Testing Patterns

- **Unit tests** for components and utilities
- **Integration tests** for API endpoints
- **E2E tests** for user workflows
- **Accessibility tests** with axe-core
- **Test naming**: descriptive sentences with `should` or `it`
