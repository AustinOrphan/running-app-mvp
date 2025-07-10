# Card Component Accessibility Guide

This guide covers accessibility features, ARIA patterns, and best practices for the Card component system.

## Table of Contents

1. [Overview](#overview)
2. [ARIA Patterns](#aria-patterns)
3. [Keyboard Navigation](#keyboard-navigation)
4. [Screen Reader Support](#screen-reader-support)
5. [Focus Management](#focus-management)
6. [Color and Contrast](#color-and-contrast)
7. [Motion and Animation](#motion-and-animation)
8. [Testing](#testing)
9. [Best Practices](#best-practices)

## Overview

The Card component system is designed with accessibility as a core principle, providing:

- **WCAG 2.1 AA Compliance**: Meets Web Content Accessibility Guidelines
- **Keyboard Navigation**: Full keyboard support for all interactive elements
- **Screen Reader Support**: Proper semantic structure and ARIA attributes
- **Focus Management**: Clear focus indicators and logical tab order
- **High Contrast Support**: Customizable colors and contrast ratios
- **Reduced Motion**: Respects user preferences for animation

### Accessibility Features

| Feature | Implementation | WCAG Criteria |
|---------|---------------|---------------|
| Keyboard Navigation | Tab/Enter/Space support | 2.1.1 (A) |
| Focus Indicators | Visible focus states | 2.4.7 (AA) |
| Screen Reader Support | Semantic HTML + ARIA | 4.1.3 (AA) |
| Color Contrast | Customizable themes | 1.4.3 (AA) |
| Reduced Motion | Respects user preferences | 2.3.3 (AAA) |

## ARIA Patterns

### Interactive Cards

For cards that can be clicked or activated:

```tsx
<Card 
  interactive={true}
  role="button"
  tabIndex={0}
  aria-label="Goal card for weekly 5K challenge"
  onClick={handleCardClick}
  onKeyDown={handleKeyDown}
>
  <CardHeader>
    <CardTitle>
      <h4 id="goal-title-123">Weekly 5K Challenge</h4>
    </CardTitle>
  </CardHeader>
  <CardContent>
    <p aria-describedby="goal-title-123">
      Run 5 kilometers every weekday morning
    </p>
  </CardContent>
</Card>
```

### Cards with Progress

Progress information should be announced to screen readers:

```tsx
<Card variant="goal">
  <CardHeader>
    <CardTitle>
      <h4 id="goal-456">Distance Goal</h4>
    </CardTitle>
  </CardHeader>
  <CardContent>
    <ProgressBar 
      percentage={75}
      aria-labelledby="goal-456"
      aria-valuenow={75}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext="75% complete, 7.5 of 10 kilometers"
      role="progressbar"
    />
    <span className="sr-only">
      Progress: 75% complete. 7.5 of 10 kilometers achieved.
    </span>
  </CardContent>
</Card>
```

### Cards with Actions

Action buttons need descriptive labels:

```tsx
<Card variant="run">
  <CardHeader>
    <CardTitle>
      <h4 id="run-789">Morning Run - January 15</h4>
    </CardTitle>
    <CardActions>
      <IconButton
        onClick={() => onEdit(run.id)}
        aria-label="Edit run from January 15th"
        aria-describedby="run-789"
        title="Edit this run"
      >
        ✏️
      </IconButton>
      <IconButton
        onClick={() => onDelete(run.id)}
        aria-label="Delete run from January 15th"
        aria-describedby="run-789"
        title="Delete this run permanently"
      >
        🗑️
      </IconButton>
    </CardActions>
  </CardHeader>
</Card>
```

### Expandable Cards

Expandable content needs proper ARIA attributes:

```tsx
function ExpandableCard({ isExpanded, onToggle }) {
  const contentId = `expandable-content-${id}`;
  
  return (
    <Card variant="template">
      <CardContent>
        <ExpandControls
          isExpanded={isExpanded}
          onToggle={onToggle}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          aria-label={isExpanded ? "Collapse template details" : "Expand template details"}
        />
        
        {isExpanded && (
          <ExpandedContent
            id={contentId}
            role="region"
            aria-label="Template details"
          >
            {/* Expanded content */}
          </ExpandedContent>
        )}
      </CardContent>
    </Card>
  );
}
```

## Keyboard Navigation

### Supported Key Interactions

| Key | Action | Context |
|-----|--------|---------|
| **Tab** | Navigate to next focusable element | All interactive cards |
| **Shift+Tab** | Navigate to previous focusable element | All interactive cards |
| **Enter** | Activate card or button | Interactive cards, buttons |
| **Space** | Activate card or button | Interactive cards, buttons |
| **Escape** | Close expanded content | Expandable cards |
| **Arrow Keys** | Navigate within card grid | Card collections |

### Tab Order

Cards should have a logical tab order:

```tsx
// Example tab order for a goal card
<Card tabIndex={0}>                    {/* 1. Card container (if interactive) */}
  <CardHeader>
    <IconButton tabIndex={0}>          {/* 2. Edit button */}
      ✏️
    </IconButton>
    <IconButton tabIndex={0}>          {/* 3. Complete button */}
      ✓
    </IconButton>
    <IconButton tabIndex={0}>          {/* 4. Delete button */}
      🗑️
    </IconButton>
  </CardHeader>
  <CardContent>
    <ExpandControls tabIndex={0}>      {/* 5. Expand button */}
      View Details
    </ExpandControls>
  </CardContent>
</Card>
```

### Keyboard Event Handling

```tsx
const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
  switch (event.key) {
    case 'Enter':
    case ' ':
      event.preventDefault();
      if (interactive) {
        onClick?.(event);
      }
      break;
    case 'Escape':
      if (isExpanded) {
        setIsExpanded(false);
      }
      break;
    default:
      break;
  }
};

<Card 
  interactive={interactive}
  onKeyDown={handleKeyDown}
  tabIndex={interactive ? 0 : undefined}
>
  {/* Card content */}
</Card>
```

### Grid Navigation

For card grids, implement arrow key navigation:

```tsx
const useGridNavigation = (gridRef: RefObject<HTMLDivElement>) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!gridRef.current) return;
      
      const cards = Array.from(
        gridRef.current.querySelectorAll('[role="button"], [tabindex="0"]')
      ) as HTMLElement[];
      
      const currentIndex = cards.indexOf(document.activeElement as HTMLElement);
      let nextIndex = currentIndex;
      
      switch (event.key) {
        case 'ArrowRight':
          nextIndex = Math.min(currentIndex + 1, cards.length - 1);
          break;
        case 'ArrowLeft':
          nextIndex = Math.max(currentIndex - 1, 0);
          break;
        case 'ArrowDown':
          // Move to next row (assuming 3 columns)
          nextIndex = Math.min(currentIndex + 3, cards.length - 1);
          break;
        case 'ArrowUp':
          // Move to previous row
          nextIndex = Math.max(currentIndex - 3, 0);
          break;
        default:
          return;
      }
      
      event.preventDefault();
      cards[nextIndex]?.focus();
    };
    
    gridRef.current?.addEventListener('keydown', handleKeyDown);
    return () => gridRef.current?.removeEventListener('keydown', handleKeyDown);
  }, [gridRef]);
};
```

## Screen Reader Support

### Semantic HTML Structure

Use proper heading hierarchy and semantic elements:

```tsx
<Card variant="goal">
  <CardHeader>
    <CardTitle>
      {/* Use appropriate heading level based on page structure */}
      <h3>Weekly Running Goal</h3>           {/* Main goal title */}
      <span className="goal-type">Distance</span>  {/* Goal type */}
    </CardTitle>
  </CardHeader>
  
  <CardContent>
    <p>Run 25 kilometers this week</p>      {/* Goal description */}
    
    <div role="group" aria-labelledby="progress-label">
      <h4 id="progress-label">Progress</h4>  {/* Progress section */}
      <ProgressBar 
        percentage={60}
        aria-label="60% complete, 15 of 25 kilometers"
      />
    </div>
    
    <dl>                                     {/* Statistics */}
      <dt>Current</dt>
      <dd>15 km</dd>
      <dt>Target</dt>
      <dd>25 km</dd>
      <dt>Remaining</dt>
      <dd>10 km</dd>
    </dl>
  </CardContent>
</Card>
```

### Screen Reader Only Content

Provide additional context for screen readers:

```tsx
<Card variant="run">
  <CardHeader>
    <CardTitle>
      <h4>
        Morning Run
        <span className="sr-only">completed on</span>
        January 15, 2024
      </h4>
    </CardTitle>
  </CardHeader>
  
  <CardContent>
    <div className="run-stats">
      <div className="stat">
        <span className="stat-value">5.2</span>
        <span className="stat-label">
          kilometers
          <span className="sr-only">distance</span>
        </span>
      </div>
      <div className="stat">
        <span className="stat-value">28:45</span>
        <span className="stat-label">
          minutes
          <span className="sr-only">duration</span>
        </span>
      </div>
    </div>
    
    <span className="sr-only">
      Run summary: 5.2 kilometers completed in 28 minutes and 45 seconds
    </span>
  </CardContent>
</Card>
```

### Live Regions

Announce dynamic updates:

```tsx
function GoalCard({ goal, progress }) {
  const [announcement, setAnnouncement] = useState('');
  
  useEffect(() => {
    if (goal.isCompleted) {
      setAnnouncement(`Goal "${goal.title}" has been completed!`);
    }
  }, [goal.isCompleted, goal.title]);
  
  return (
    <>
      <Card variant="goal" completed={goal.isCompleted}>
        {/* Card content */}
      </Card>
      
      {/* Live region for announcements */}
      <div 
        aria-live="polite" 
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
    </>
  );
}
```

## Focus Management

### Focus Indicators

Provide clear visual focus indicators:

```css
/* Focus styles for cards */
.card:focus-visible {
  outline: 2px solid var(--focus-color, #0066cc);
  outline-offset: 2px;
  border-radius: var(--card-border-radius);
}

/* Focus styles for buttons */
.iconBtn:focus-visible {
  outline: 2px solid var(--focus-color, #0066cc);
  outline-offset: 1px;
  border-radius: 4px;
}

/* High contrast focus indicators */
@media (prefers-contrast: high) {
  .card:focus-visible,
  .iconBtn:focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 2px;
  }
}
```

### Focus Trap for Modals

When cards open modals, implement focus trapping:

```tsx
const useFocusTrap = (isActive: boolean) => {
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!isActive || !ref.current) return;
    
    const focusableElements = ref.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
    
    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };
    
    document.addEventListener('keydown', handleTabKey);
    firstElement?.focus();
    
    return () => document.removeEventListener('keydown', handleTabKey);
  }, [isActive]);
  
  return ref;
};
```

### Focus Restoration

Restore focus after modal interactions:

```tsx
function GoalCard({ goal, onEdit }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  
  const handleEdit = () => {
    setIsModalOpen(true);
  };
  
  const handleModalClose = () => {
    setIsModalOpen(false);
    // Restore focus to the edit button
    editButtonRef.current?.focus();
  };
  
  return (
    <Card variant="goal">
      <CardActions>
        <IconButton
          ref={editButtonRef}
          onClick={handleEdit}
          aria-label="Edit goal"
        >
          ✏️
        </IconButton>
      </CardActions>
      
      {isModalOpen && (
        <EditGoalModal 
          goal={goal}
          onClose={handleModalClose}
        />
      )}
    </Card>
  );
}
```

## Color and Contrast

### Contrast Requirements

Ensure sufficient color contrast ratios:

```css
/* WCAG AA compliant colors */
:root {
  --text-high-contrast: #ffffff;      /* 21:1 on dark backgrounds */
  --text-medium-contrast: #e2e8f0;    /* 12:1 on dark backgrounds */
  --text-low-contrast: #a0aec0;       /* 4.5:1 on dark backgrounds */
  
  --border-normal: #4a5568;           /* 3:1 minimum for borders */
  --border-focus: #0066cc;            /* High contrast for focus */
  
  --background-card: #2d3748;         /* Base card background */
  --background-card-hover: #4a5568;   /* Hover state */
}

/* Light theme overrides */
.theme-light {
  --text-high-contrast: #1a202c;      /* 21:1 on light backgrounds */
  --text-medium-contrast: #2d3748;    /* 12:1 on light backgrounds */
  --text-low-contrast: #4a5568;       /* 4.5:1 on light backgrounds */
  
  --border-normal: #e2e8f0;           /* 3:1 minimum for borders */
  --background-card: #ffffff;         /* Base card background */
  --background-card-hover: #f7fafc;   /* Hover state */
}
```

### High Contrast Mode

Support Windows High Contrast Mode:

```css
/* High contrast mode support */
@media (prefers-contrast: high) {
  .card {
    border: 2px solid ButtonText;
    background: ButtonFace;
    color: ButtonText;
  }
  
  .card:hover {
    border-color: Highlight;
    background: HighlightText;
    color: Highlight;
  }
  
  .iconBtn {
    border: 1px solid ButtonText;
    background: ButtonFace;
    color: ButtonText;
  }
  
  .iconBtn:focus {
    outline: 2px solid Highlight;
  }
}
```

### Color Independence

Ensure information isn't conveyed by color alone:

```tsx
// ✅ Good - uses icon + color + text
<CompletionBadge className="success">
  <span className="icon">✅</span>
  <span>Completed</span>
</CompletionBadge>

// ❌ Avoid - color only
<CompletionBadge className="green-badge">
  Completed
</CompletionBadge>

// ✅ Good - progress with multiple indicators
<ProgressBar 
  percentage={75}
  aria-valuetext="75% complete - 3 of 4 weeks"
>
  <span className="progress-text">Week 3 of 4</span>
  <span className="progress-icon">🏃</span>
</ProgressBar>
```

## Motion and Animation

### Respecting User Preferences

Honor `prefers-reduced-motion`:

```css
/* Default animations */
.card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none;
  }
  
  .card:hover {
    transform: none;
    /* Keep non-motion effects */
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
}
```

### Safe Animation Patterns

Use animations that don't trigger vestibular disorders:

```css
/* ✅ Safe - simple fade */
.card-fade-in {
  opacity: 0;
  animation: fadeIn 0.3s ease forwards;
}

@keyframes fadeIn {
  to { opacity: 1; }
}

/* ✅ Safe - small movement */
.card-slide-up {
  transform: translateY(10px);
  animation: slideUp 0.3s ease forwards;
}

@keyframes slideUp {
  to { transform: translateY(0); }
}

/* ❌ Avoid - rapid movement */
@keyframes bounce {
  0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-30px); }
  60% { transform: translateY(-15px); }
}
```

## Testing

### Automated Testing

Use accessibility testing tools:

```tsx
// Jest + @testing-library/react
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import userEvent from '@testing-library/user-event';

expect.extend(toHaveNoViolations);

describe('Card Accessibility', () => {
  test('has no accessibility violations', async () => {
    const { container } = render(
      <Card variant="goal">
        <CardHeader>
          <CardTitle><h4>Test Goal</h4></CardTitle>
        </CardHeader>
      </Card>
    );
    
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
  
  test('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    
    render(
      <Card variant="goal">
        <CardActions>
          <IconButton onClick={onEdit} aria-label="Edit goal">
            ✏️
          </IconButton>
        </CardActions>
      </Card>
    );
    
    const editButton = screen.getByLabelText('Edit goal');
    
    // Test Tab navigation
    await user.tab();
    expect(editButton).toHaveFocus();
    
    // Test Enter activation
    await user.keyboard('{Enter}');
    expect(onEdit).toHaveBeenCalled();
    
    // Test Space activation
    await user.keyboard(' ');
    expect(onEdit).toHaveBeenCalledTimes(2);
  });
  
  test('announces progress to screen readers', () => {
    render(
      <ProgressBar 
        percentage={75}
        aria-valuetext="75% complete, 7.5 of 10 kilometers"
      />
    );
    
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuetext', '75% complete, 7.5 of 10 kilometers');
    expect(progressBar).toHaveAttribute('aria-valuenow', '75');
  });
});
```

### Manual Testing

#### Screen Reader Testing

Test with multiple screen readers:

1. **NVDA (Windows)**: Free, widely used
2. **JAWS (Windows)**: Commercial, comprehensive
3. **VoiceOver (macOS/iOS)**: Built-in Apple screen reader
4. **TalkBack (Android)**: Built-in Android screen reader

#### Keyboard Testing

Test keyboard navigation:

1. **Tab Order**: Verify logical tab sequence
2. **Focus Indicators**: Check visible focus states
3. **Key Commands**: Test Enter, Space, Escape, Arrow keys
4. **Focus Trapping**: Test modal interactions

#### Browser Testing

Test accessibility features across browsers:

1. **Chrome**: DevTools Accessibility panel
2. **Firefox**: Accessibility Inspector
3. **Safari**: VoiceOver integration
4. **Edge**: Accessibility Insights extension

### Testing Checklist

- [ ] All interactive elements are keyboard accessible
- [ ] Focus indicators are visible and clear
- [ ] ARIA attributes are present and correct
- [ ] Color contrast meets WCAG AA standards
- [ ] Content is announced properly by screen readers
- [ ] Motion can be disabled via user preferences
- [ ] High contrast mode is supported
- [ ] Tab order is logical and predictable
- [ ] Error states are announced to assistive technologies
- [ ] Loading states provide appropriate feedback

## Best Practices

### 1. Progressive Enhancement

Build accessibility from the ground up:

```tsx
// ✅ Good - semantic HTML first, then enhance
<Card
  as="article"                    // Semantic element
  interactive={interactive}       // Progressive enhancement
  role={interactive ? "button" : undefined}
  tabIndex={interactive ? 0 : undefined}
  onClick={interactive ? onClick : undefined}
>
  <CardHeader>
    <CardTitle>
      <h4>{title}</h4>            {/* Proper heading hierarchy */}
    </CardTitle>
  </CardHeader>
</Card>
```

### 2. Clear and Descriptive Labels

Provide context for all interactive elements:

```tsx
// ✅ Good - descriptive labels
<IconButton
  onClick={() => onEdit(goal.id)}
  aria-label={`Edit goal: ${goal.title}`}
  title={`Edit ${goal.title}`}
>
  ✏️
</IconButton>

// ❌ Avoid - generic labels
<IconButton onClick={onEdit} title="Edit">
  ✏️
</IconButton>
```

### 3. Consistent Interaction Patterns

Use familiar patterns consistently:

```tsx
// ✅ Good - consistent interaction
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onClick?.();
  }
};

// Apply to all interactive cards
<Card onKeyDown={handleKeyDown} />
```

### 4. Error Prevention and Recovery

Provide clear error states and recovery options:

```tsx
<Card variant="goal" className={error ? 'card-error' : ''}>
  {error && (
    <div role="alert" className="error-message">
      <span className="sr-only">Error: </span>
      {error.message}
      <button onClick={onRetry} className="retry-button">
        Try Again
      </button>
    </div>
  )}
</Card>
```

### 5. Documentation and Testing

Document accessibility features and test regularly:

```tsx
/**
 * Card Component
 * 
 * @accessibility
 * - Supports keyboard navigation (Tab, Enter, Space, Escape)
 * - Provides ARIA attributes for screen readers
 * - Maintains focus management for modal interactions
 * - Supports high contrast and reduced motion preferences
 * 
 * @example
 * <Card 
 *   interactive={true}
 *   aria-label="Goal card for weekly running challenge"
 *   onClick={handleClick}
 * >
 *   {content}
 * </Card>
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(...);
```

---

For more information, see:
- [Card Component Documentation](../components/Card.md)
- [Migration Guide](../migration/card-system.md)
- [Styling Guide](../styling/card-theming.md)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)