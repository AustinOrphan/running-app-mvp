# Card Component Styling & Theming Guide

This guide covers customization, theming, and styling options for the Card component system.

## Table of Contents

1. [CSS Custom Properties](#css-custom-properties)
2. [Theming System](#theming-system)
3. [Color Customization](#color-customization)
4. [Animation Customization](#animation-customization)
5. [Responsive Design](#responsive-design)
6. [Custom Variants](#custom-variants)
7. [CSS Module Patterns](#css-module-patterns)
8. [Performance Optimization](#performance-optimization)

## CSS Custom Properties

The Card system uses CSS custom properties (CSS variables) for flexible theming and customization.

### Base Variables

```css
/* Core Card Variables */
:root {
  /* Background Colors */
  --card-background: #1a1a1a;
  --card-background-goal: #1a1a1a;
  --card-background-run: #1a1a1a;
  --card-background-template: #2a2a2a;

  /* Border Colors */
  --border-color: #404040;
  --border-color-completed: #10b981;
  --border-color-hover: #505050;

  /* Border Radius */
  --card-border-radius: 12px;
  --card-border-radius-small: 8px;

  /* Spacing */
  --card-padding: 20px;
  --card-padding-mobile: 16px;
  --card-gap: 8px;
  --card-gap-large: 16px;

  /* Typography */
  --card-title-color: rgba(255, 255, 255, 0.87);
  --card-text-color: rgba(255, 255, 255, 0.7);
  --card-subtitle-color: rgba(255, 255, 255, 0.6);

  /* Effects */
  --card-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  --card-shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.4);
  --card-transition: all 0.2s ease;

  /* Progress Colors */
  --progress-background: #2a2a2a;
  --progress-fill: #3b82f6;
  --progress-fill-completed: #10b981;

  /* Button Colors */
  --button-background: #2a2a2a;
  --button-background-hover: #3a3a3a;
  --button-text: rgba(255, 255, 255, 0.7);
  --button-text-hover: rgba(255, 255, 255, 0.9);
}
```

### Usage in Components

```css
/* Example usage in Card component */
.card {
  background: var(--card-background);
  border: 1px solid var(--border-color);
  border-radius: var(--card-border-radius);
  padding: var(--card-padding);
  transition: var(--card-transition);
}

.card:hover {
  box-shadow: var(--card-shadow-hover);
}
```

## Theming System

### Light Theme

```css
/* Light theme overrides */
.theme-light {
  --card-background: #ffffff;
  --card-background-goal: #ffffff;
  --card-background-run: #ffffff;
  --card-background-template: #f8f9fa;

  --border-color: #e5e7eb;
  --border-color-hover: #d1d5db;

  --card-title-color: rgba(0, 0, 0, 0.87);
  --card-text-color: rgba(0, 0, 0, 0.7);
  --card-subtitle-color: rgba(0, 0, 0, 0.6);

  --card-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  --card-shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.15);

  --progress-background: #f3f4f6;
  --button-background: #f3f4f6;
  --button-background-hover: #e5e7eb;
  --button-text: rgba(0, 0, 0, 0.7);
  --button-text-hover: rgba(0, 0, 0, 0.9);
}
```

### High Contrast Theme

```css
/* High contrast theme */
.theme-high-contrast {
  --card-background: #000000;
  --border-color: #ffffff;
  --card-title-color: #ffffff;
  --card-text-color: #ffffff;
  --card-subtitle-color: #cccccc;
<<<<<<< HEAD

=======
  
>>>>>>> origin/main
  --card-shadow: 0 2px 8px rgba(255, 255, 255, 0.2);
  --card-shadow-hover: 0 4px 12px rgba(255, 255, 255, 0.3);
}
```

### Applying Themes

```tsx
// Apply theme at component level
<div className="theme-light">
  <Card variant="goal">
    {/* Card content */}
  </Card>
</div>

// Apply theme globally
<body className="theme-light">
  <App />
</body>
```

## Color Customization

### Brand Colors

```css
/* Brand color system */
:root {
  /* Primary Colors */
  --primary-blue: #3b82f6;
  --primary-green: #10b981;
  --primary-orange: #f59e0b;
  --primary-red: #ef4444;

  /* Semantic Colors */
  --success-color: var(--primary-green);
  --warning-color: var(--primary-orange);
  --error-color: var(--primary-red);
  --info-color: var(--primary-blue);

  /* Goal Type Colors */
  --goal-distance-color: var(--primary-blue);
  --goal-time-color: var(--primary-green);
  --goal-frequency-color: var(--primary-orange);
  --goal-speed-color: var(--primary-red);
}
```

### Dynamic Color Usage

```tsx
// Using dynamic colors in components
<CardIcon color="var(--goal-distance-color)">
  🏃
</CardIcon>

<<<<<<< HEAD
<ProgressBar
=======
<ProgressBar 
>>>>>>> origin/main
  percentage={75}
  color="var(--success-color)"
  completed={false}
/>
```

### Color Variants

```css
/* Color variants for different states */
.card-variant-success {
  --card-background: rgba(16, 185, 129, 0.1);
  --border-color: var(--success-color);
}

.card-variant-warning {
  --card-background: rgba(245, 158, 11, 0.1);
  --border-color: var(--warning-color);
}

.card-variant-error {
  --card-background: rgba(239, 68, 68, 0.1);
  --border-color: var(--error-color);
}
```

## Animation Customization

### Transition Variables

```css
/* Animation timing variables */
:root {
  --transition-fast: 0.15s ease;
  --transition-normal: 0.2s ease;
  --transition-slow: 0.3s ease;

  /* Easing curves */
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-in-out-back: cubic-bezier(0.68, -0.55, 0.265, 1.55);
  --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
```

### Custom Animations

```css
/* Custom hover animation */
.card-hover-lift {
<<<<<<< HEAD
  transition:
=======
  transition: 
>>>>>>> origin/main
    transform var(--transition-normal),
    box-shadow var(--transition-normal);
}

.card-hover-lift:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

/* Custom slide-in animation */
@keyframes slideInUp {
  from {
    transform: translateY(30px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.card-slide-in {
  animation: slideInUp var(--transition-slow) var(--ease-out-quart);
}
```

### Staggered Animations

```css
/* Staggered animation for card grids */
<<<<<<< HEAD
.cards-grid .card:nth-child(1) {
  animation-delay: 0.05s;
}
.cards-grid .card:nth-child(2) {
  animation-delay: 0.1s;
}
.cards-grid .card:nth-child(3) {
  animation-delay: 0.15s;
}
.cards-grid .card:nth-child(4) {
  animation-delay: 0.2s;
}
.cards-grid .card:nth-child(5) {
  animation-delay: 0.25s;
}
.cards-grid .card:nth-child(6) {
  animation-delay: 0.3s;
}
=======
.cards-grid .card:nth-child(1) { animation-delay: 0.05s; }
.cards-grid .card:nth-child(2) { animation-delay: 0.1s; }
.cards-grid .card:nth-child(3) { animation-delay: 0.15s; }
.cards-grid .card:nth-child(4) { animation-delay: 0.2s; }
.cards-grid .card:nth-child(5) { animation-delay: 0.25s; }
.cards-grid .card:nth-child(6) { animation-delay: 0.3s; }
>>>>>>> origin/main

/* Automatic staggering with CSS counter */
.cards-grid {
  counter-reset: card-counter;
}

.cards-grid .card {
  counter-increment: card-counter;
  animation-delay: calc(counter(card-counter) * 0.05s);
}
```

## Responsive Design

### Breakpoint Variables

```css
/* Responsive breakpoints */
:root {
  --breakpoint-mobile: 480px;
  --breakpoint-tablet: 768px;
  --breakpoint-desktop: 1024px;
  --breakpoint-wide: 1280px;
}
```

### Responsive Card Styling

```css
/* Mobile-first responsive design */
.card {
  padding: var(--card-padding-mobile);
  border-radius: var(--card-border-radius-small);
}

@media (min-width: 768px) {
  .card {
    padding: var(--card-padding);
    border-radius: var(--card-border-radius);
  }
}

/* Responsive grid layouts */
.cards-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
}

@media (min-width: 640px) {
  .cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .cards-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 1280px) {
  .cards-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
```

### Mobile Optimizations

```css
/* Mobile-specific card optimizations */
@media (max-width: 767px) {
  .card {
    /* Reduce padding on mobile */
    --card-padding: 16px;
<<<<<<< HEAD

=======
    
>>>>>>> origin/main
    /* Larger touch targets */
    --button-min-height: 44px;
    --button-min-width: 44px;
  }
<<<<<<< HEAD

=======
  
>>>>>>> origin/main
  .card-header-template {
    /* Stack header elements on mobile */
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
<<<<<<< HEAD

=======
  
>>>>>>> origin/main
  .card-actions-template {
    /* Stack action buttons on mobile */
    flex-direction: column;
    width: 100%;
  }
<<<<<<< HEAD

=======
  
>>>>>>> origin/main
  .card-actions-template .button {
    width: 100%;
  }
}
```

## Custom Variants

### Creating Custom Card Variants

```css
/* Custom premium card variant */
.card-premium {
  --card-background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --border-color: transparent;
  --card-title-color: #ffffff;
  --card-text-color: rgba(255, 255, 255, 0.9);
<<<<<<< HEAD

=======
  
>>>>>>> origin/main
  position: relative;
  overflow: hidden;
}

.card-premium::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #ffd700, #ffed4e, #ffd700);
  animation: shimmer 2s ease-in-out infinite;
}

@keyframes shimmer {
<<<<<<< HEAD
  0%,
  100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
=======
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
>>>>>>> origin/main
}

/* Custom compact card variant */
.card-compact {
  --card-padding: 12px;
  --card-border-radius: 8px;
<<<<<<< HEAD

=======
  
>>>>>>> origin/main
  min-height: auto;
}

.card-compact .card-header {
  margin-bottom: 8px;
}

.card-compact .card-title h4 {
  font-size: 0.9rem;
  margin-bottom: 2px;
}
```

### Using Custom Variants

```tsx
// Apply custom variants with className
<Card variant="goal" className="card-premium">
  <CardHeader>
    <CardTitle>
      <h4>Premium Goal</h4>
    </CardTitle>
  </CardHeader>
</Card>

<Card variant="run" className="card-compact">
  {/* Compact card content */}
</Card>
```

## CSS Module Patterns

### Component-Specific Styling

```css
/* Card.module.css - Scoped styles */
.card {
  /* Base card styles */
}

.cardGoal {
  composes: card;
  /* Goal-specific overrides */
}

.cardRun {
  composes: card;
  /* Run-specific overrides */
}

.cardTemplate {
  composes: card;
  /* Template-specific overrides */
}
```

### Conditional Class Application

```tsx
// Dynamic class application
const getCardClasses = () => {
  const classes = [styles.card];
<<<<<<< HEAD

  if (variant === 'goal') classes.push(styles.cardGoal);
  if (variant === 'run') classes.push(styles.cardRun);
  if (variant === 'template') classes.push(styles.cardTemplate);

  if (completed) classes.push(styles.cardCompleted);
  if (interactive) classes.push(styles.cardInteractive);
  if (loading) classes.push(styles.cardLoading);

  if (className) classes.push(className);

=======
  
  if (variant === 'goal') classes.push(styles.cardGoal);
  if (variant === 'run') classes.push(styles.cardRun);
  if (variant === 'template') classes.push(styles.cardTemplate);
  
  if (completed) classes.push(styles.cardCompleted);
  if (interactive) classes.push(styles.cardInteractive);
  if (loading) classes.push(styles.cardLoading);
  
  if (className) classes.push(className);
  
>>>>>>> origin/main
  return classes.join(' ');
};
```

### Global Style Integration

```css
/* Global overrides when needed */
:global(.card-custom-theme) .card {
  --card-background: #2d3748;
  --border-color: #4a5568;
}

:global(.dark-mode) {
  --card-background: #1a202c;
  --card-title-color: #f7fafc;
  --card-text-color: #e2e8f0;
}
```

## Performance Optimization

### CSS Loading Optimization

```css
/* Critical styles - inline in HTML */
.card {
  background: var(--card-background, #1a1a1a);
  border: 1px solid var(--border-color, #404040);
  border-radius: var(--card-border-radius, 12px);
}

/* Non-critical styles - load asynchronously */
.card-animations {
  transition: var(--card-transition, all 0.2s ease);
  animation: slideUp 0.3s ease-out both;
}
```

### Efficient Selectors

```css
/* ✅ Efficient - low specificity */
<<<<<<< HEAD
.card {
}
.cardGoal {
}
.cardCompleted {
}

/* ❌ Inefficient - high specificity */
.card.goal-card.completed {
}
div.card > div.header > h4.title {
}
=======
.card { }
.cardGoal { }
.cardCompleted { }

/* ❌ Inefficient - high specificity */
.card.goal-card.completed { }
div.card > div.header > h4.title { }
>>>>>>> origin/main
```

### GPU Acceleration

```css
/* Enable hardware acceleration for animations */
.card {
  will-change: transform;
  transform: translateZ(0);
}

.card:hover {
  transform: translateY(-2px) translateZ(0);
}
```

### Reduced Motion Support

```css
/* Respect user preferences for reduced motion */
@media (prefers-reduced-motion: reduce) {
  .card {
    --card-transition: none;
    animation: none;
  }
<<<<<<< HEAD

=======
  
>>>>>>> origin/main
  .card:hover {
    transform: none;
  }
}
```

## Dark Mode Integration

### Automatic Dark Mode

```css
/* System preference-based dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --card-background: #1a1a1a;
    --border-color: #404040;
    --card-title-color: rgba(255, 255, 255, 0.87);
    --card-text-color: rgba(255, 255, 255, 0.7);
  }
}

@media (prefers-color-scheme: light) {
  :root {
    --card-background: #ffffff;
    --border-color: #e5e7eb;
    --card-title-color: rgba(0, 0, 0, 0.87);
    --card-text-color: rgba(0, 0, 0, 0.7);
  }
}
```

### Manual Dark Mode Toggle

```css
/* Class-based dark mode */
.dark {
  --card-background: #1a1a1a;
  --border-color: #404040;
  --card-title-color: rgba(255, 255, 255, 0.87);
  --card-text-color: rgba(255, 255, 255, 0.7);
}

.light {
  --card-background: #ffffff;
  --border-color: #e5e7eb;
  --card-title-color: rgba(0, 0, 0, 0.87);
  --card-text-color: rgba(0, 0, 0, 0.7);
}
```

## Best Practices

### 1. Use CSS Custom Properties

```css
/* ✅ Good - flexible and themeable */
.card {
  background: var(--card-background);
  padding: var(--card-padding);
}

/* ❌ Avoid - hardcoded values */
.card {
  background: #1a1a1a;
  padding: 20px;
}
```

### 2. Maintain Consistent Spacing

```css
/* ✅ Good - consistent spacing system */
:root {
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
}

.card {
  padding: var(--space-lg);
  gap: var(--space-md);
}
```

### 3. Optimize for Performance

```css
/* ✅ Good - efficient animations */
.card {
  transition: transform 0.2s ease;
}

.card:hover {
  transform: translateY(-2px);
}

/* ❌ Avoid - expensive properties */
.card:hover {
  box-shadow: 0 50px 100px rgba(0, 0, 0, 0.5);
  filter: blur(0.5px) saturate(1.2);
}
```

### 4. Support Accessibility

```css
/* ✅ Good - accessibility support */
@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none;
    animation: none;
  }
}

.card:focus-visible {
  outline: 2px solid var(--focus-color);
  outline-offset: 2px;
}
```

---

For more information, see:
<<<<<<< HEAD

- [Card Component Documentation](../components/Card.md)
- [Migration Guide](../migration/card-system.md)
- [Accessibility Guide](../accessibility/card-a11y.md)
=======
- [Card Component Documentation](../components/Card.md)
- [Migration Guide](../migration/card-system.md)
- [Accessibility Guide](../accessibility/card-a11y.md)
>>>>>>> origin/main
