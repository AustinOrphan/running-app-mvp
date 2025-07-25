# Card System Migration Guide

This guide helps you migrate from the old card implementations to the new unified Card component system.

## Table of Contents

1. [Overview](#overview)
2. [Migration Strategy](#migration-strategy)
3. [Goal Card Migration](#goal-card-migration)
4. [Run Card Migration](#run-card-migration)
5. [Template Card Migration](#template-card-migration)
6. [CSS Class Migration](#css-class-migration)
7. [Common Patterns](#common-patterns)
8. [Troubleshooting](#troubleshooting)

## Overview

### What Changed

**Before**: Three separate card implementations with scattered CSS
<<<<<<< HEAD

- Goal cards using `.goal-card` CSS classes
- # Run cards using `.run-card` CSS classes
- Goal cards using `.goal-card` CSS classes
- Run cards using `.run-card` CSS classes
  > > > > > > > origin/main
- Template cards using `.template-card` CSS classes
- Styles scattered throughout `App.css`

**After**: Unified Card component system
<<<<<<< HEAD

=======

> > > > > > > origin/main

- Single `Card` component with variants
- Modular CSS with `Card.module.css`
- TypeScript interfaces for all props
- Enhanced accessibility and consistency

### Benefits of Migration

- **Consistency**: Unified styling and behavior across all cards
- **Maintainability**: Single source of truth for card components
- **Type Safety**: Full TypeScript support with interfaces
- **Accessibility**: Built-in ARIA attributes and keyboard navigation
- **Performance**: CSS module scoping and optimized rendering

## Migration Strategy

### 1. Incremental Migration

<<<<<<< HEAD

=======

> > > > > > > origin/main
> > > > > > > Migrate one card type at a time to minimize disruption:

1. **Goal Cards** (most complex) - Start here
2. **Run Cards** (medium complexity)
3. **Template Cards** (least complex)

### 2. Import New Components

<<<<<<< HEAD

=======

> > > > > > > origin/main
> > > > > > > Add the new Card imports to your files:

```tsx
import {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardContent,
  CardActions,
  CardFooter,
<<<<<<< HEAD
  IconButton,
=======
  IconButton
>>>>>>> origin/main
} from '../UI/Card';
```

### 3. Replace Gradually

<<<<<<< HEAD

=======

> > > > > > > origin/main
> > > > > > > Replace old patterns with new components section by section.

## Goal Card Migration

### Before (Old Pattern)

```tsx
// Old GoalCard implementation
export const GoalCard: React.FC<GoalCardProps> = ({ goal, progress, onEdit, onDelete }) => {
  return (
    <div className={`goal-card ${goal.isCompleted ? 'completed' : ''}`}>
      <div className='goal-header'>
        <div className='goal-icon' style={{ color: goal.color }}>
          {goal.icon}
        </div>
        <div className='goal-title'>
          <h4>{goal.title}</h4>
          <span className='goal-type'>{goal.type}</span>
        </div>
        <div className='goal-actions'>
          <button className='btn-icon' onClick={() => onEdit(goal.id)}>
            ✏️
          </button>
          <button className='btn-icon' onClick={() => onDelete(goal.id)}>
            🗑️
          </button>
        </div>
      </div>
<<<<<<< HEAD

      {goal.description && <p className='goal-description'>{goal.description}</p>}

      <div className='goal-progress'>
        <div className='progress-header'>
          <span className='progress-text'>
            {progress.current} / {goal.target}
          </span>
          <span className='progress-percentage'>{progress.percentage}%</span>
        </div>
        <div className='progress-bar'>
          <div className='progress-fill' style={{ width: `${progress.percentage}%` }} />
=======

      {goal.description && (
        <p className='goal-description'>{goal.description}</p>
      )}

      <div className='goal-progress'>
        <div className='progress-header'>
          <span className='progress-text'>{progress.current} / {goal.target}</span>
          <span className='progress-percentage'>{progress.percentage}%</span>
        </div>
        <div className='progress-bar'>
          <div
            className='progress-fill'
            style={{ width: `${progress.percentage}%` }}
          />
>>>>>>> origin/main
        </div>
      </div>
    </div>
  );
};
```

### After (New Pattern)

```tsx
// New GoalCard implementation
import {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardContent,
  CardProgress,
  IconButton,
  ProgressHeader,
  ProgressBar,
<<<<<<< HEAD
  SimpleProgress,
=======
  SimpleProgress
>>>>>>> origin/main
} from '../UI/Card';

export const GoalCard: React.FC<GoalCardProps> = ({ goal, progress, onEdit, onDelete }) => {
  return (
<<<<<<< HEAD
    <Card variant='goal' completed={goal.isCompleted}>
      <CardHeader>
        <CardIcon color={goal.color}>{goal.icon}</CardIcon>
        <CardTitle>
          <h4>{goal.title}</h4>
          <span className='goal-type'>{goal.type}</span>
        </CardTitle>
        <CardActions>
          <IconButton onClick={() => onEdit(goal.id)} title='Edit goal'>
            ✏️
          </IconButton>
          <IconButton onClick={() => onDelete(goal.id)} title='Delete goal'>
=======
    <Card variant="goal" completed={goal.isCompleted}>
      <CardHeader>
        <CardIcon color={goal.color}>
          {goal.icon}
        </CardIcon>
        <CardTitle>
          <h4>{goal.title}</h4>
          <span className="goal-type">{goal.type}</span>
        </CardTitle>
        <CardActions>
          <IconButton onClick={() => onEdit(goal.id)} title="Edit goal">
            ✏️
          </IconButton>
          <IconButton onClick={() => onDelete(goal.id)} title="Delete goal">
>>>>>>> origin/main
            🗑️
          </IconButton>
        </CardActions>
      </CardHeader>

<<<<<<< HEAD
      {goal.description && <CardDescription>{goal.description}</CardDescription>}
=======
      {goal.description && (
        <CardDescription>
          {goal.description}
        </CardDescription>
      )}
>>>>>>> origin/main

      <CardContent>
        <CardProgress>
          <SimpleProgress>
            <ProgressHeader>
<<<<<<< HEAD
              <span className='progress-text'>
                {progress.current} / {goal.target}
              </span>
              <span className='progress-percentage'>{progress.percentage}%</span>
=======
              <span className="progress-text">
                {progress.current} / {goal.target}
              </span>
              <span className="progress-percentage">
                {progress.percentage}%
              </span>
>>>>>>> origin/main
            </ProgressHeader>
            <ProgressBar
              percentage={progress.percentage}
              completed={goal.isCompleted}
              color={goal.color}
            />
          </SimpleProgress>
        </CardProgress>
      </CardContent>
    </Card>
  );
};
```

### Key Changes for Goal Cards

1. **Root Element**: `div.goal-card` → `<Card variant="goal">`
2. **Header Structure**: `div.goal-header` → `<CardHeader>`
3. **Icon**: `div.goal-icon` → `<CardIcon>`
4. **Title**: `div.goal-title` → `<CardTitle>`
5. **Actions**: `div.goal-actions` → `<CardActions>`
6. **Buttons**: `button.btn-icon` → `<IconButton>`
7. **Progress**: Manual progress elements → `<ProgressBar>` component

## Run Card Migration

### Before (Old Pattern)

```tsx
// Old RunCard implementation
export const RunCard: React.FC<RunCardProps> = ({ run, onEdit, onDelete }) => {
  return (
    <div className='run-card'>
      <div className='run-header'>
        <div className='run-date'>{formatDate(run.date)}</div>
        <div className='run-actions'>
          <button className='icon-btn edit-btn' onClick={() => onEdit(run)}>
            ✏️
          </button>
          <button className='icon-btn delete-btn' onClick={() => onDelete(run.id)}>
            🗑️
          </button>
        </div>
      </div>
      <div className='run-stats'>
        <div className='stat'>
          <span className='stat-value'>{run.distance}km</span>
          <span className='stat-label'>Distance</span>
        </div>
      </div>
      {run.notes && <div className='run-notes'>{run.notes}</div>}
    </div>
  );
};
```

### After (New Pattern)

```tsx
// New RunCard implementation
import { Card, CardHeader, CardContent, CardActions, IconButton } from '../UI/Card';

export const RunCard: React.FC<RunCardProps> = ({ run, onEdit, onDelete }) => {
  return (
<<<<<<< HEAD
    <Card variant='run'>
      <CardHeader variant='run'>
        <div className='run-date'>{formatDate(run.date)}</div>
        <CardActions variant='run'>
          <IconButton variant='edit' onClick={() => onEdit(run)} title='Edit run'>
            ✏️
          </IconButton>
          <IconButton variant='delete' onClick={() => onDelete(run.id)} title='Delete run'>
=======
    <Card variant="run">
      <CardHeader variant="run">
        <div className="run-date">{formatDate(run.date)}</div>
        <CardActions variant="run">
          <IconButton variant="edit" onClick={() => onEdit(run)} title="Edit run">
            ✏️
          </IconButton>
          <IconButton variant="delete" onClick={() => onDelete(run.id)} title="Delete run">
>>>>>>> origin/main
            🗑️
          </IconButton>
        </CardActions>
      </CardHeader>

      <CardContent>
<<<<<<< HEAD
        <div className='run-stats'>
          <div className='stat'>
            <span className='stat-value'>{run.distance}km</span>
            <span className='stat-label'>Distance</span>
          </div>
        </div>
        {run.notes && <div className='run-notes'>{run.notes}</div>}
=======
        <div className="run-stats">
          <div className="stat">
            <span className="stat-value">{run.distance}km</span>
            <span className="stat-label">Distance</span>
          </div>
        </div>
        {run.notes && <div className="run-notes">{run.notes}</div>}
>>>>>>> origin/main
      </CardContent>
    </Card>
  );
};
```

### Key Changes for Run Cards

1. **Root Element**: `div.run-card` → `<Card variant="run">`
2. **Header**: `div.run-header` → `<CardHeader variant="run">`
3. **Actions**: `div.run-actions` → `<CardActions variant="run">`
4. **Buttons**: `button.icon-btn` → `<IconButton variant="edit|delete">`
5. **Content**: Wrap stats in `<CardContent>`

## Template Card Migration

### Before (Old Pattern)

```tsx
// Old TemplateCard implementation
const TemplateCard: React.FC<TemplateCardProps> = ({ template, onSelect }) => {
  return (
    <div className='template-card'>
      <div className='template-header'>
        <div className='template-icon' style={{ color: template.color }}>
          {template.icon}
        </div>
        <div className='template-title'>
          <h4>{template.name}</h4>
          <p className='template-description'>{template.description}</p>
        </div>
        <DifficultyBadge difficulty={template.difficulty} />
      </div>
<<<<<<< HEAD

=======

>>>>>>> origin/main
      <div className='template-details'>
        <div className='template-target'>
          <span className='target-label'>Target:</span>
          <span className='target-value'>{template.target}</span>
        </div>
      </div>
<<<<<<< HEAD

=======

>>>>>>> origin/main
      <div className='template-actions'>
        <button className='btn-secondary'>Learn More</button>
        <button className='btn-primary' onClick={onSelect}>
          Use Template
        </button>
      </div>
    </div>
  );
};
```

### After (New Pattern)

```tsx
// New TemplateCard implementation
import {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardContent,
  CardActions,
<<<<<<< HEAD
  DifficultyBadge,
=======
  DifficultyBadge
>>>>>>> origin/main
} from '../UI/Card';
import { Button } from '../UI/Button';

const TemplateCard: React.FC<TemplateCardProps> = ({ template, onSelect }) => {
  return (
<<<<<<< HEAD
    <Card variant='template'>
      <CardHeader variant='template'>
        <CardIcon variant='template' color={template.color}>
          {template.icon}
        </CardIcon>
        <CardTitle variant='template'>
          <h4>{template.name}</h4>
          <CardDescription variant='template'>{template.description}</CardDescription>
=======
    <Card variant="template">
      <CardHeader variant="template">
        <CardIcon variant="template" color={template.color}>
          {template.icon}
        </CardIcon>
        <CardTitle variant="template">
          <h4>{template.name}</h4>
          <CardDescription variant="template">
            {template.description}
          </CardDescription>
>>>>>>> origin/main
        </CardTitle>
        <DifficultyBadge difficulty={template.difficulty} />
      </CardHeader>

      <CardContent>
<<<<<<< HEAD
        <div className='template-details'>
          <div className='template-target'>
            <span className='target-label'>Target:</span>
            <span className='target-value'>{template.target}</span>
=======
        <div className="template-details">
          <div className="template-target">
            <span className="target-label">Target:</span>
            <span className="target-value">{template.target}</span>
>>>>>>> origin/main
          </div>
        </div>
      </CardContent>

<<<<<<< HEAD
      <CardActions variant='template'>
        <Button variant='secondary'>Learn More</Button>
        <Button variant='primary' onClick={onSelect}>
=======
      <CardActions variant="template">
        <Button variant="secondary">Learn More</Button>
        <Button variant="primary" onClick={onSelect}>
>>>>>>> origin/main
          Use Template
        </Button>
      </CardActions>
    </Card>
  );
};
```

### Key Changes for Template Cards

1. **Root Element**: `div.template-card` → `<Card variant="template">`
2. **Header**: `div.template-header` → `<CardHeader variant="template">`
3. **Icon**: `div.template-icon` → `<CardIcon variant="template">`
4. **Title**: `div.template-title` → `<CardTitle variant="template">`
5. **Description**: `p.template-description` → `<CardDescription variant="template">`
6. **Actions**: `div.template-actions` → `<CardActions variant="template">`
7. **Buttons**: Replace with `<Button>` components

## CSS Class Migration

### Removing Old CSS Classes

After migration, you can remove these CSS classes from `App.css`:

```css
/* Remove these classes after migration */
<<<<<<< HEAD
.goal-card {
  /* ... */
}
.goal-header {
  /* ... */
}
.goal-icon {
  /* ... */
}
.goal-title {
  /* ... */
}
.goal-actions {
  /* ... */
}
.btn-icon {
  /* ... */
}
.goal-description {
  /* ... */
}
.goal-progress {
  /* ... */
}
.progress-header {
  /* ... */
}
.progress-bar {
  /* ... */
}
.progress-fill {
  /* ... */
}

.run-card {
  /* ... */
}
.run-header {
  /* ... */
}
.run-actions {
  /* ... */
}
.icon-btn {
  /* ... */
}
.run-stats {
  /* ... */
}

.template-card {
  /* ... */
}
.template-header {
  /* ... */
}
.template-icon {
  /* ... */
}
.template-title {
  /* ... */
}
.template-description {
  /* ... */
}
.template-actions {
  /* ... */
}
=======
.goal-card { /* ... */ }
.goal-header { /* ... */ }
.goal-icon { /* ... */ }
.goal-title { /* ... */ }
.goal-actions { /* ... */ }
.btn-icon { /* ... */ }
.goal-description { /* ... */ }
.goal-progress { /* ... */ }
.progress-header { /* ... */ }
.progress-bar { /* ... */ }
.progress-fill { /* ... */ }

.run-card { /* ... */ }
.run-header { /* ... */ }
.run-actions { /* ... */ }
.icon-btn { /* ... */ }
.run-stats { /* ... */ }

.template-card { /* ... */ }
.template-header { /* ... */ }
.template-icon { /* ... */ }
.template-title { /* ... */ }
.template-description { /* ... */ }
.template-actions { /* ... */ }
>>>>>>> origin/main
```

### CSS Class Mapping

<<<<<<< HEAD
| Old Class | New Approach |
| ---------------- | --------------------------- |
| `.goal-card` | `<Card variant="goal">` |
| `.goal-header` | `<CardHeader>` |
| `.goal-icon` | `<CardIcon>` |
| `.goal-title` | `<CardTitle>` |
| `.goal-actions` | `<CardActions>` |
| `.btn-icon` | `<IconButton>` |
| `.progress-bar` | `<ProgressBar>` |
| `.run-card` | `<Card variant="run">` |
=======
| Old Class | New Approach |
|-----------|--------------|
| `.goal-card` | `<Card variant="goal">` |
| `.goal-header` | `<CardHeader>` |
| `.goal-icon` | `<CardIcon>` |
| `.goal-title` | `<CardTitle>` |
| `.goal-actions` | `<CardActions>` |
| `.btn-icon` | `<IconButton>` |
| `.progress-bar` | `<ProgressBar>` |
| `.run-card` | `<Card variant="run">` |

> > > > > > > origin/main
> > > > > > > | `.template-card` | `<Card variant="template">` |

## Common Patterns

### 1. Conditional Content

**Before:**
<<<<<<< HEAD

```tsx
{
  goal.description && <p className='goal-description'>{goal.description}</p>;
}
```

**After:**

````tsx
{
  goal.description && <CardDescription>{goal.description}</CardDescription>;
}
=======
```tsx
{goal.description && <p className='goal-description'>{goal.description}</p>}
````

**After:**

```tsx
{goal.description && (
  <CardDescription>
    {goal.description}
  </CardDescription>
)}
>>>>>>> origin/main
```

### 2. Action Buttons

**Before:**
<<<<<<< HEAD

````tsx
<div className='goal-actions'>
  <button className='btn-icon' onClick={handleEdit}>
    ✏️
  </button>
  <button className='btn-icon' onClick={handleDelete}>
    🗑️
  </button>
=======
```tsx
<div className='goal-actions'>
  <button className='btn-icon' onClick={handleEdit}>✏️</button>
  <button className='btn-icon' onClick={handleDelete}>🗑️</button>
>>>>>>> origin/main
</div>
````

**After:**
<<<<<<< HEAD

````tsx
<CardActions>
  <IconButton onClick={handleEdit} title='Edit'>
    ✏️
  </IconButton>
  <IconButton onClick={handleDelete} title='Delete'>
    🗑️
  </IconButton>
=======
```tsx
<CardActions>
  <IconButton onClick={handleEdit} title="Edit">✏️</IconButton>
  <IconButton onClick={handleDelete} title="Delete">🗑️</IconButton>
>>>>>>> origin/main
</CardActions>
````

### 3. Progress Bars

**Before:**
<<<<<<< HEAD

````tsx
<div className='progress-bar'>
  <div className='progress-fill' style={{ width: `${percentage}%`, backgroundColor: color }} />
=======
```tsx
<div className='progress-bar'>
  <div
    className='progress-fill'
    style={{ width: `${percentage}%`, backgroundColor: color }}
  />
>>>>>>> origin/main
</div>
````

**After:**
<<<<<<< HEAD

````tsx
<ProgressBar percentage={percentage} color={color} completed={isCompleted} />
=======
```tsx
<ProgressBar
  percentage={percentage}
  color={color}
  completed={isCompleted}
/>
>>>>>>> origin/main
````

### 4. Loading States

**Before:**
<<<<<<< HEAD

```tsx
{
  isLoading ? (
    <div className='run-card skeleton'>
      <div className='skeleton-line'></div>
    </div>
  ) : (
    <div className='run-card'>{/* content */}</div>
  );
}
```

**After:**

````tsx
{
  isLoading ? (
    <Card variant='run' loading={true}>
      <div className='skeleton-line'></div>
    </Card>
  ) : (
    <Card variant='run'>{/* content */}</Card>
  );
}
=======
```tsx
{isLoading ? (
  <div className='run-card skeleton'>
    <div className='skeleton-line'></div>
  </div>
) : (
  <div className='run-card'>
    {/* content */}
  </div>
)}
````

**After:**

```tsx
{isLoading ? (
  <Card variant="run" loading={true}>
    <div className='skeleton-line'></div>
  </Card>
) : (
  <Card variant="run">
    {/* content */}
  </Card>
)}
>>>>>>> origin/main
```

## Troubleshooting

### 1. Missing Styles

**Problem**: Card doesn't look right after migration.

**Solution**: Ensure you're importing the Card components correctly:
<<<<<<< HEAD

=======

> > > > > > > origin/main

```tsx
import { Card, CardHeader, CardContent } from '../UI/Card';
```

**Check**: Verify the CSS module is being loaded:
<<<<<<< HEAD

=======

> > > > > > > origin/main

```tsx
// Card.tsx should import:
import styles from '../../styles/components/Card.module.css';
```

### 2. TypeScript Errors

**Problem**: TypeScript complaining about missing props.

**Solution**: Check the component interfaces in the [API documentation](../components/Card.md).

**Common fixes**:
<<<<<<< HEAD

=======

> > > > > > > origin/main

```tsx
// ✅ Correct
<Card variant="goal" completed={false}>

// ❌ Wrong - missing required props
<Card>
```

### 3. Click Handlers Not Working

**Problem**: Button clicks not responding.

**Solution**: Ensure you're using the correct event handler pattern:
<<<<<<< HEAD

=======

> > > > > > > origin/main

```tsx
// ✅ Correct
<IconButton onClick={() => onEdit(item.id)}>✏️</IconButton>

// ❌ Wrong - calling immediately
<IconButton onClick={onEdit(item.id)}>✏️</IconButton>
```

### 4. Styling Issues

**Problem**: Custom styles not applying.

**Solution**: Use the `className` prop for additional styling:
<<<<<<< HEAD

````tsx
<Card variant='goal' className='custom-goal-card'>
=======
```tsx
<Card variant="goal" className="custom-goal-card">
>>>>>>> origin/main
  {/* content */}
</Card>
````

**CSS:**
<<<<<<< HEAD

=======

> > > > > > > origin/main

```css
.custom-goal-card {
  border: 2px solid var(--primary-color);
}
```

### 5. Animation Issues

**Problem**: Hover effects or animations not working.

**Solution**: Check that you're using the correct variant:
<<<<<<< HEAD

=======

> > > > > > > origin/main

```tsx
// ✅ Correct - run cards have special hover animations
<Card variant="run">

// ❌ Wrong - default cards have different animations
<Card>
```

### 6. Progress Bar Issues

**Problem**: Progress bar not showing correctly.

**Solution**: Ensure percentage is between 0-100:
<<<<<<< HEAD

=======

> > > > > > > origin/main

```tsx
// ✅ Correct
<ProgressBar percentage={Math.min(Math.max(percentage, 0), 100)} />

// ❌ Wrong - values outside 0-100 range
<ProgressBar percentage={percentage} />
```

### 7. Accessibility Warnings

**Problem**: Screen reader or accessibility tool warnings.

**Solution**: Add proper ARIA attributes:
<<<<<<< HEAD

````tsx
<IconButton
  onClick={onDelete}
  title='Delete goal permanently'
  aria-label='Delete goal: Weekly 5K Challenge'
=======
```tsx
<IconButton
  onClick={onDelete}
  title="Delete goal permanently"
  aria-label="Delete goal: Weekly 5K Challenge"
>>>>>>> origin/main
>
  🗑️
</IconButton>
````

## Testing After Migration

### 1. Visual Testing

<<<<<<< HEAD

=======

> > > > > > > origin/main

- Compare before/after screenshots
- Check all card variants (goal, run, template)
- Test hover states and animations
- Verify responsive behavior

### 2. Functional Testing

<<<<<<< HEAD

=======

> > > > > > > origin/main

- Test all click handlers
- Verify progress bars update correctly
- Check expand/collapse functionality
- Test keyboard navigation

### 3. Accessibility Testing

<<<<<<< HEAD

=======

> > > > > > > origin/main

- Run automated accessibility tests
- Test with screen readers
- Verify keyboard navigation
- Check color contrast

### 4. Performance Testing

<<<<<<< HEAD

=======

> > > > > > > origin/main

- Monitor bundle size changes
- Check rendering performance
- Verify CSS loading efficiency

## Rollback Plan

If issues arise during migration:

### 1. Component-Level Rollback

<<<<<<< HEAD

Keep old components alongside new ones:

=======
Keep old components alongside new ones:

> > > > > > > origin/main

```tsx
// Keep both during transition
import { OldGoalCard } from './components/OldGoalCard';
import { GoalCard } from './components/GoalCard';

// Use feature flag or conditional rendering
const CardComponent = useNewCards ? GoalCard : OldGoalCard;
```

### 2. CSS Fallback

<<<<<<< HEAD

Keep old CSS classes temporarily:

=======
Keep old CSS classes temporarily:

> > > > > > > origin/main

```css
/* Keep old styles during migration */
.goal-card.legacy {
  /* old styles */
}
```

### 3. Gradual Rollback

<<<<<<< HEAD

=======

> > > > > > > origin/main
> > > > > > > Roll back one card type at a time if needed.

## Need Help?

- Check the [Card Component Documentation](../components/Card.md)
- Review [Best Practices](../components/Card.md#best-practices)
- See [Accessibility Guide](../accessibility/card-a11y.md)
  <<<<<<< HEAD
- # Look at [Styling Guide](../styling/card-theming.md)
- Look at [Styling Guide](../styling/card-theming.md)
  > > > > > > > origin/main
