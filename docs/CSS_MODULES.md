# CSS Modules Documentation

## Overview

This project uses CSS Modules for component-scoped styling, providing better maintainability, performance, and avoiding global style conflicts. All CSS modules are located in `src/styles/components/` and follow strict naming conventions.

## Architecture

### Directory Structure

```
src/styles/
├── globals.css              # Global CSS variables and reset styles
└── components/              # CSS Modules directory
    ├── App.module.css       # Main app container styles
    ├── AuthForm.module.css  # Authentication form styles
    ├── Button.module.css    # Button component variants
    ├── Card.module.css      # Card component layouts
    ├── Connectivity.module.css  # Connection status components
    ├── Feature.module.css   # Feature showcase components
    ├── Form.module.css      # Form field and validation styles
    ├── Goals.module.css     # Goals management components
    ├── Layout.module.css    # Layout and dashboard structure
    ├── Loading.module.css   # Loading states and skeletons
    ├── Modal.module.css     # Modal dialog components
    ├── Navigation.module.css # Navigation and tab components
    ├── Notification.module.css # Notifications and toasts
    ├── Progress.module.css  # Progress bars and charts
    ├── Runs.module.css      # Running data components
    ├── Stats.module.css     # Statistics and analytics
    ├── TemplateCustomization.module.css # Template customization
    └── Utils.module.css     # Utility classes and animations
```

## Usage Patterns

### Basic Import and Usage

```tsx
import styles from '../styles/components/Button.module.css';

export const MyButton = ({ children, variant = 'primary' }) => {
  return <button className={styles.btn}>{children}</button>;
};
```

### Conditional Classes

```tsx
import styles from '../styles/components/Notification.module.css';

export const NotificationItem = ({ notification, isUnread }) => {
  return (
    <div className={`${styles.notificationItem} ${isUnread ? styles.unread : ''}`}>
      {/* content */}
    </div>
  );
};
```

### Complex Class Combinations

```tsx
import styles from '../styles/components/Button.module.css';

export const DynamicButton = ({ size, variant, isLoading, isIcon }) => {
  const className = [
    isIcon ? styles.btnIcon : styles.btn,
    styles[`btn${variant.charAt(0).toUpperCase() + variant.slice(1)}`], // btnPrimary, btnSecondary
    size === 'small' ? styles.btnSmall : '',
    size === 'large' ? styles.btnLarge : '',
    isLoading ? styles.btnLoading : '',
  ]
    .filter(Boolean)
    .join(' ');

  return <button className={className}>{/* content */}</button>;
};
```

### Type-Safe CSS Modules (Recommended)

```tsx
// types/css-modules.d.ts
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

// Component with better IntelliSense
import styles from '../styles/components/Form.module.css';

export const FormField = () => {
  return (
    <div className={styles.formGroup}>
      {' '}
      {/* IntelliSense will suggest available classes */}
      <label className={styles.label}>Email</label>
      <input className={styles.input} type='email' />
      <span className={styles.errorMessage}>Invalid email</span>
    </div>
  );
};
```

## Naming Conventions

### CSS Class Names

- Use **camelCase** for class names: `.notificationItem`, `.btnPrimary`
- Use descriptive, semantic names: `.progressBar` not `.blueBar`
- Use BEM-inspired patterns for variants: `.notificationItem`, `.notificationAchievement`
- Prefix state classes: `.unread`, `.active`, `.loading`

### CSS Variables

All CSS modules should use global CSS variables defined in `globals.css`:

```css
/* globals.css */
:root {
  --color-primary: #3b82f6;
  --color-primary-dark: #1e40af;
  --surface-color: #1a1a1a;
  --surface-color-hover: #2a2a2a;
  --text-primary: rgba(255, 255, 255, 0.87);
  --border-color: #404040;
  --progress-transition: 0.3s ease;
  --progress-border-radius: 8px;
}
```

### File Organization

Each CSS module should be organized with clear sections:

```css
/**
 * Component Name - CSS Module
 * 
 * Brief description of the component's purpose
 * Performance optimizations and special notes
 */

/* Custom properties for this component */
:root {
  --component-specific-var: value;
}

/* Base component styles */
.baseComponent {
  /* styles */
}

/* Component variants */
.variantOne {
  /* styles */
}

/* Component states */
.active,
.loading,
.disabled {
  /* styles */
}

/* Responsive design */
@media (max-width: 768px) {
  /* tablet styles */
}

@media (max-width: 480px) {
  /* mobile styles */
}

/* Accessibility support */
@media (prefers-contrast: high) {
  /* high contrast styles */
}

@media (prefers-reduced-motion: reduce) {
  /* reduced motion styles */
}
```

## Performance Optimizations

### Hardware Acceleration

Use `transform` and `opacity` for animations instead of layout properties:

```css
/* ✅ Good - Hardware accelerated */
.button:hover {
  transform: translateY(-1px);
  transition: transform 0.2s ease;
}

/* ❌ Avoid - Causes layout recalculation */
.button:hover {
  margin-top: -1px;
  transition: margin-top 0.2s ease;
}
```

### CSS Custom Properties

Use CSS custom properties for shared values to reduce duplication:

```css
:root {
  --button-height: 44px;
  --button-padding: 12px 16px;
  --button-transition: 0.2s ease;
}

.btn {
  height: var(--button-height);
  padding: var(--button-padding);
  transition: all var(--button-transition);
}
```

### Will-Change Property

Use `will-change` sparingly for frequently animated elements:

```css
.progressFill {
  will-change: width;
  transition: width 0.3s ease;
}

/* Remove will-change when animation completes */
.progressFill.complete {
  will-change: auto;
}
```

## Accessibility Guidelines

### Touch Targets

All interactive elements must meet WCAG 2.1 touch target requirements:

```css
.btn {
  min-height: 44px;
  min-width: 44px;
  padding: 12px 16px;
}

.btnIcon {
  min-width: 44px;
  min-height: 44px;
  padding: 12px;
}
```

### Focus Indicators

All interactive elements must have visible focus indicators:

```css
.btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

### Color Contrast

Ensure sufficient color contrast for text elements:

```css
.text {
  color: var(--text-primary); /* rgba(255, 255, 255, 0.87) - meets WCAG AA */
}

.textSecondary {
  color: var(--text-secondary); /* rgba(255, 255, 255, 0.6) - use carefully */
}
```

### High Contrast Support

Provide high contrast mode support:

```css
@media (prefers-contrast: high) {
  .card {
    border: 2px solid var(--text-primary);
  }
}
```

### Reduced Motion Support

Respect user motion preferences:

```css
@media (prefers-reduced-motion: reduce) {
  .animated {
    transition: none;
    animation: none;
  }
}
```

## Migration Guidelines

### From String Classes to CSS Modules

1. **Create CSS Module File**

   ```bash
   # Create new CSS module
   touch src/styles/components/MyComponent.module.css
   ```

2. **Move CSS Rules**

   ```css
   /* Before: In App.css */
   .my-component {
     /* styles */
   }

   /* After: In MyComponent.module.css */
   .myComponent {
     /* styles */
   }
   ```

3. **Update Component**

   ```tsx
   // Before
   <div className="my-component">

   // After
   import styles from '../styles/components/MyComponent.module.css';
   <div className={styles.myComponent}>
   ```

4. **Test Migration**
   ```tsx
   // Add test to css-module-migration.test.tsx
   it('should import MyComponent.module.css', () => {
     expect(myComponentStyles.myComponent).toBeDefined();
   });
   ```

### Common Migration Issues

1. **Kebab-case to camelCase**

   ```css
   /* CSS: kebab-case */
   .notification-item { }

   /* JS: camelCase */
   styles.notificationItem
   ```

2. **Global to Scoped**

   ```css
   /* Before: Global */
   .active {
     color: blue;
   }

   /* After: Scoped */
   .notificationItem.active {
     color: var(--color-primary);
   }
   ```

3. **Missing CSS Classes**
   ```tsx
   // Always ensure CSS class exists before using
   {showSettings && (
     <div className={styles.settings}> // Make sure .settings exists in CSS
   )}
   ```

## Testing

### CSS Module Tests

Tests are located in `tests/unit/css-modules/css-module-migration.test.tsx`:

```tsx
import styles from '../../../src/styles/components/MyComponent.module.css';

describe('MyComponent CSS Module', () => {
  it('should import successfully', () => {
    expect(styles).toBeDefined();
    expect(typeof styles).toBe('object');
  });

  it('should have required classes', () => {
    expect(styles.myComponent).toBeDefined();
    expect(styles.myComponentVariant).toBeDefined();
  });

  it('should handle class combinations', () => {
    const className = `${styles.myComponent} ${styles.active}`;
    expect(className).toContain(styles.myComponent);
    expect(className).toContain(styles.active);
  });
});
```

### Visual Testing

Use browser dev tools to verify:

- CSS modules generate unique class names
- No style conflicts between components
- Responsive breakpoints work correctly
- Accessibility features function properly

## Troubleshooting

### Common Issues

1. **"Cannot find module" Error**

   ```bash
   # Ensure file exists and has correct extension
   ls src/styles/components/MyComponent.module.css
   ```

2. **Class Name Not Found**

   ```tsx
   // Check CSS file for exact class name (camelCase)
   console.log(Object.keys(styles)); // List all available classes
   ```

3. **Styles Not Applied**

   ```tsx
   // Verify class name is correctly applied
   console.log(styles.myClass); // Should output a generated class name
   ```

4. **CSS Variables Not Working**
   ```css
   /* Ensure variables are defined in globals.css */
   /* Use fallback values */
   color: var(--text-primary, #ffffff);
   ```

### Build Issues

If CSS modules aren't working in build:

1. Check Vite configuration includes CSS modules support
2. Verify file naming follows `*.module.css` pattern
3. Ensure TypeScript declarations are correct

## Best Practices

### Do's ✅

- Use semantic, descriptive class names
- Leverage CSS custom properties for consistency
- Include accessibility features (focus, contrast, motion)
- Test CSS modules with comprehensive test coverage
- Use hardware-accelerated animations
- Follow responsive-first design patterns

### Don'ts ❌

- Don't use global styles for component-specific styling
- Don't hardcode values that could use CSS variables
- Don't create overly specific selectors
- Don't ignore accessibility requirements
- Don't use layout-affecting properties for animations
- Don't forget to test class name generation

### Performance Tips

- Use `will-change` sparingly and remove when done
- Prefer `transform` and `opacity` for animations
- Consolidate responsive breakpoints
- Use CSS custom properties to reduce duplication
- Optimize for mobile-first responsive design

This documentation should be updated as new CSS modules are added or existing patterns evolve.
