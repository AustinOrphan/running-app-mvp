# CSS Modules Migration Guide

This guide provides patterns and best practices for migrating components from global CSS to CSS modules in the Running App MVP.

## Overview

CSS Modules provide component-scoped styling, preventing style conflicts and improving maintainability. This guide covers the migration process, naming conventions, and common patterns.

## Benefits of CSS Modules

- **Scoped Styles**: Styles are locally scoped by default
- **No Naming Conflicts**: Class names are automatically namespaced
- **Explicit Dependencies**: Clear relationship between components and styles
- **Dead Code Elimination**: Unused styles can be identified and removed
- **Type Safety**: TypeScript support for style imports

## Migration Process

### Step 1: Create CSS Module File

Rename the CSS file with `.module.css` extension:

```bash
# Before
Navigation.css

# After
Navigation.module.css
```

### Step 2: Update Style Imports

```typescript
// Before
import './Navigation.css';

// After
import styles from './Navigation.module.css';
```

### Step 3: Update Class Names

```typescript
// Before
<nav className="navigation">
  <div className="nav-brand">Logo</div>
  <ul className="nav-menu">
    <li className="nav-item active">Home</li>
  </ul>
</nav>

// After
<nav className={styles.navigation}>
  <div className={styles.navBrand}>Logo</div>
  <ul className={styles.navMenu}>
    <li className={`${styles.navItem} ${styles.active}`}>Home</li>
  </ul>
</nav>
```

### Step 4: Handle Dynamic Classes

```typescript
// Using conditional classes
<button
  className={`${styles.button} ${isActive ? styles.active : ''}`}
>
  Click me
</button>

// Using classnames utility (if available)
import cn from 'classnames';

<button
  className={cn(styles.button, {
    [styles.active]: isActive,
    [styles.disabled]: isDisabled
  })}
>
  Click me
</button>
```

## Naming Conventions

### CSS Classes

Transform kebab-case to camelCase:

```css
/* Before (global CSS) */
.nav-menu {
}
.nav-menu-item {
}
.nav-menu-item--active {
}

/* After (CSS module) */
.navMenu {
}
.navMenuItem {
}
.navMenuItemActive {
}
```

### File Organization

```
components/
  Navigation/
    Navigation.tsx
    Navigation.module.css
    Navigation.test.tsx
    index.ts
```

## Common Patterns

### 1. Component Wrapper Pattern

```css
/* Component.module.css */
.wrapper {
  /* Component container styles */
}

.content {
  /* Inner content styles */
}
```

```typescript
// Component.tsx
import styles from './Component.module.css';

export const Component = () => (
  <div className={styles.wrapper}>
    <div className={styles.content}>
      {/* Component content */}
    </div>
  </div>
);
```

### 2. State Variants

```css
/* Button.module.css */
.button {
  /* Base button styles */
}

.primary {
  /* Primary variant */
}

.secondary {
  /* Secondary variant */
}

.large {
  /* Size variant */
}
```

```typescript
// Button.tsx
interface ButtonProps {
  variant?: 'primary' | 'secondary';
  size?: 'small' | 'medium' | 'large';
}

export const Button = ({ variant = 'primary', size = 'medium' }) => (
  <button
    className={`${styles.button} ${styles[variant]} ${styles[size]}`}
  >
    Click me
  </button>
);
```

### 3. Responsive Design

```css
/* Card.module.css */
.card {
  padding: 16px;
}

@media (min-width: 768px) {
  .card {
    padding: 24px;
  }
}

@media (min-width: 1024px) {
  .card {
    padding: 32px;
  }
}
```

### 4. Animation Classes

```css
/* Notification.module.css */
.notification {
  /* Base styles */
}

.show {
  animation: slideIn 0.3s ease-out;
}

.hide {
  animation: slideOut 0.3s ease-in;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
```

### 5. Composition

```css
/* styles/shared.module.css */
.flexCenter {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Component.module.css */
.container {
  composes: flexCenter from '../styles/shared.module.css';
  /* Additional styles */
}
```

## Real Examples from the Codebase

### Navigation Component Migration

**Before:**

```css
/* Navigation.css */
.navigation {
  display: flex;
  justify-content: space-between;
  padding: 16px;
}

.nav-menu {
  display: flex;
  list-style: none;
}

.nav-item.active {
  font-weight: bold;
}
```

**After:**

```css
/* Navigation.module.css */
.navigation {
  display: flex;
  justify-content: space-between;
  padding: 16px;
}

.navMenu {
  display: flex;
  list-style: none;
}

.navItem {
  /* Base nav item styles */
}

.active {
  font-weight: bold;
}
```

**Component Update:**

```typescript
// Navigation.tsx
import styles from './Navigation.module.css';

export const Navigation = () => {
  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className={styles.navigation}>
      <ul className={styles.navMenu}>
        <li className={`${styles.navItem} ${isActive('/') ? styles.active : ''}`}>
          Home
        </li>
      </ul>
    </nav>
  );
};
```

### Notification Component Migration

**Complex State Management:**

```typescript
// NotificationCenter.tsx
import styles from './Notification.module.css';

export const NotificationCenter = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  return (
    <div className={`${styles.overlay} ${isVisible ? styles.show : ''}`}>
      <div className={`${styles.notification} ${isAnimating ? styles.animate : ''}`}>
        {/* Notification content */}
      </div>
    </div>
  );
};
```

## TypeScript Support

### Type Definitions

Create type definitions for CSS modules:

```typescript
// css-modules.d.ts
declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}
```

### Typed Style Hooks

```typescript
// useStyles.ts
import { useMemo } from 'react';
import styles from './Component.module.css';

export const useStyles = (isActive: boolean) => {
  return useMemo(
    () => ({
      container: `${styles.container} ${isActive ? styles.active : ''}`,
      content: styles.content,
    }),
    [isActive]
  );
};
```

## Migration Checklist

- [ ] Rename CSS file to `.module.css`
- [ ] Update import statement in component
- [ ] Convert kebab-case to camelCase
- [ ] Update all className references
- [ ] Handle dynamic classes properly
- [ ] Test responsive styles
- [ ] Verify animations work correctly
- [ ] Update tests if needed
- [ ] Remove unused global styles
- [ ] Update documentation

## Common Pitfalls

### 1. Global Style Dependencies

**Problem**: Component relies on global styles
**Solution**: Import all required styles into the module

### 2. Cascading Styles

**Problem**: Styles depend on parent selectors
**Solution**: Use explicit class names or CSS variables

### 3. Third-Party Integration

**Problem**: Third-party components expect global classes
**Solution**: Use `:global()` selector when necessary

```css
:global(.third-party-class) {
  /* Styles for third-party components */
}
```

### 4. Dynamic Class Names

**Problem**: Class names built with string concatenation
**Solution**: Use object notation or utility functions

## Testing CSS Modules

### Visual Regression Tests

```typescript
test('Component renders with correct styles', async () => {
  const { container } = render(<Component />);

  // Check class names are applied
  expect(container.firstChild).toHaveClass(styles.wrapper);

  // Visual regression snapshot
  expect(container).toMatchSnapshot();
});
```

### Style Assertions

```typescript
test('Active state applies correct class', () => {
  const { container } = render(<Component isActive />);

  expect(container.firstChild).toHaveClass(styles.active);
});
```

## Performance Considerations

1. **Bundle Size**: CSS modules can reduce overall CSS bundle size
2. **Tree Shaking**: Unused styles can be eliminated
3. **Code Splitting**: Styles load with their components
4. **Runtime Performance**: No runtime style computation

## Tools and Resources

### VSCode Extensions

- CSS Modules IntelliSense
- CSS Modules Syntax Highlighter

### Build Tools

- Vite handles CSS modules out of the box
- PostCSS plugins for advanced features

### Utilities

```typescript
// classnames helper
export const cx = (...classes: (string | undefined | false)[]) =>
  classes.filter(Boolean).join(' ');

// Usage
<div className={cx(styles.container, isActive && styles.active)} />
```

## Future Enhancements

1. **CSS Variables**: Use CSS custom properties for theming
2. **PostCSS Plugins**: Add autoprefixer, nesting support
3. **Style Dictionary**: Centralized design tokens
4. **Component Library**: Shared styled components

## Conclusion

CSS Modules provide a robust solution for component styling. Following these patterns ensures consistent, maintainable, and conflict-free styles across the application.
