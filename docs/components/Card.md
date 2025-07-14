# Card Component System

A comprehensive, reusable Card component system for the Running App MVP. This system provides a unified approach to displaying goals, runs, templates, and other card-based content.

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Basic Usage](#basic-usage)
4. [Component API](#component-api)
5. [Examples](#examples)
6. [Variants](#variants)
7. [Accessibility](#accessibility)
8. [Best Practices](#best-practices)

## Overview

The Card component system replaces three separate card implementations (goal cards, run cards, template cards) with a unified, reusable system. It provides:

- **Consistent Styling**: Unified design language across all card types
- **TypeScript Support**: Full type safety with comprehensive interfaces
- **Accessibility**: Built-in ARIA attributes and keyboard navigation
- **Flexibility**: Multiple variants and customization options
- **Performance**: CSS module scoping and optimized rendering

## Installation

```tsx
import {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardContent,
  CardActions,
<<<<<<< HEAD
  CardFooter,
=======
  CardFooter
>>>>>>> origin/main
} from '../UI/Card';
```

## Basic Usage

### Simple Card

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '../UI/Card';

function BasicCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h4>My Card Title</h4>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p>This is the card content.</p>
      </CardContent>
    </Card>
  );
}
```

### Card with Actions

```tsx
import { Card, CardHeader, CardTitle, CardContent, CardActions, IconButton } from '../UI/Card';

function ActionCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h4>Goal Card</h4>
        </CardTitle>
        <CardActions>
          <IconButton onClick={() => console.log('Edit')}>✏️</IconButton>
          <IconButton onClick={() => console.log('Delete')}>🗑️</IconButton>
        </CardActions>
      </CardHeader>
      <CardContent>
        <p>Card with actions</p>
      </CardContent>
    </Card>
  );
}
```

## Component API

### Card

Base card component with support for different variants and states.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ------------- | -------------------------------------------- | ----------- | -------------------------------------------- |
| `variant` | `'default' \| 'goal' \| 'run' \| 'template'` | `'default'` | Card variant affecting styling |
| `completed` | `boolean` | `false` | Whether the card represents a completed item |
| `interactive` | `boolean` | `false` | Whether the card is clickable |
| `loading` | `boolean` | `false` | Whether the card is in loading state |
| `className` | `string` | `''` | Additional CSS class names |
| `children` | `ReactNode` | - | Card content |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'goal' \| 'run' \| 'template'` | `'default'` | Card variant affecting styling |
| `completed` | `boolean` | `false` | Whether the card represents a completed item |
| `interactive` | `boolean` | `false` | Whether the card is clickable |
| `loading` | `boolean` | `false` | Whether the card is in loading state |
| `className` | `string` | `''` | Additional CSS class names |
| `children` | `ReactNode` | - | Card content |

> > > > > > > origin/main

#### Example

```tsx
<<<<<<< HEAD
<Card variant='goal' completed={false} interactive={true}>
=======
<Card variant="goal" completed={false} interactive={true}>
>>>>>>> origin/main
  {/* Card content */}
</Card>
```

### CardHeader

Container for card title, icon, and actions.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ---------------------------------- | ----------- | ----------------------------------- |
| `variant` | `'default' \| 'template' \| 'run'` | `'default'` | Header variant for specific styling |
| `children` | `ReactNode` | - | Header content |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'template' \| 'run'` | `'default'` | Header variant for specific styling |
| `children` | `ReactNode` | - | Header content |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

#### Example

```tsx
<<<<<<< HEAD
<CardHeader variant='template'>
=======
<CardHeader variant="template">
>>>>>>> origin/main
  <CardIcon>🏃</CardIcon>
  <CardTitle>
    <h4>Running Goal</h4>
  </CardTitle>
</CardHeader>
```

### CardIcon

Displays an icon with optional color theming.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ------------------------- | ----------- | ------------------------------- |
| `variant` | `'default' \| 'template'` | `'default'` | Icon variant for sizing |
| `color` | `string` | - | Custom color for the icon |
| `children` | `ReactNode` | - | Icon content (emoji, SVG, etc.) |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'template'` | `'default'` | Icon variant for sizing |
| `color` | `string` | - | Custom color for the icon |
| `children` | `ReactNode` | - | Icon content (emoji, SVG, etc.) |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

#### Example

```tsx
<<<<<<< HEAD
<CardIcon variant='template' color='#3b82f6'>
=======
<CardIcon variant="template" color="#3b82f6">
>>>>>>> origin/main
  🎯
</CardIcon>
```

### CardTitle

Container for card title and subtitle.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ------------------------- | ----------- | -------------------------- |
| `variant` | `'default' \| 'template'` | `'default'` | Title variant for styling |
| `children` | `ReactNode` | - | Title content |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'template'` | `'default'` | Title variant for styling |
| `children` | `ReactNode` | - | Title content |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

#### Example

```tsx
<CardTitle>
  <h4>Goal Title</h4>
<<<<<<< HEAD
  <span className='goal-type'>Weekly Goal</span>
=======
  <span className="goal-type">Weekly Goal</span>
>>>>>>> origin/main
</CardTitle>
```

### CardDescription

Displays descriptive text content.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ------------------------- | ----------- | ------------------------------- |
| `variant` | `'default' \| 'template'` | `'default'` | Description variant for styling |
| `children` | `ReactNode` | - | Description content |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'template'` | `'default'` | Description variant for styling |
| `children` | `ReactNode` | - | Description content |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

#### Example

```tsx
<<<<<<< HEAD
<CardDescription>Run 5km every weekday morning to build endurance.</CardDescription>
=======
<CardDescription>
  Run 5km every weekday morning to build endurance.
</CardDescription>
>>>>>>> origin/main
```

### CardContent

Main content area of the card.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ----------- | ------- | -------------------------- |
| `children` | `ReactNode` | - | Content |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Content |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

### CardActions

Container for action buttons.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ---------------------------------- | ----------- | --------------------------- |
| `variant` | `'default' \| 'run' \| 'template'` | `'default'` | Actions variant for styling |
| `children` | `ReactNode` | - | Action buttons |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'run' \| 'template'` | `'default'` | Actions variant for styling |
| `children` | `ReactNode` | - | Action buttons |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

#### Example

```tsx
<<<<<<< HEAD
<CardActions variant='run'>
  <IconButton variant='edit' title='Edit run'>
    ✏️
  </IconButton>
  <IconButton variant='delete' title='Delete run'>
    🗑️
  </IconButton>
=======
<CardActions variant="run">
  <IconButton variant="edit" title="Edit run">✏️</IconButton>
  <IconButton variant="delete" title="Delete run">🗑️</IconButton>
>>>>>>> origin/main
</CardActions>
```

### CardFooter

Footer area for meta information.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ----------- | ------- | -------------------------- |
| `children` | `ReactNode` | - | Footer content |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Footer content |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

### IconButton

Clickable icon button for actions.

#### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ------------------------------------------ | ----------- | -------------------------- |
| `variant` | `'default' \| 'run' \| 'delete' \| 'edit'` | `'default'` | Button variant for styling |
| `title` | `string` | - | Tooltip text |
| `onClick` | `() => void` | - | Click handler |
| `children` | `ReactNode` | - | Button content |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'run' \| 'delete' \| 'edit'` | `'default'` | Button variant for styling |
| `title` | `string` | - | Tooltip text |
| `onClick` | `() => void` | - | Click handler |
| `children` | `ReactNode` | - | Button content |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

### Progress Components

#### ProgressBar

Animated progress bar with color theming.

##### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ------------ | --------- | ------- | ----------------------------- |
| `percentage` | `number` | - | Progress percentage (0-100) |
| `completed` | `boolean` | `false` | Whether progress is completed |
| `color` | `string` | - | Custom progress color |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `percentage` | `number` | - | Progress percentage (0-100) |
| `completed` | `boolean` | `false` | Whether progress is completed |
| `color` | `string` | - | Custom progress color |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

##### Example

```tsx
<<<<<<< HEAD
<ProgressBar percentage={75} color='#10b981' completed={false} />
=======
<ProgressBar
  percentage={75}
  color="#10b981"
  completed={false}
/>
>>>>>>> origin/main
```

#### ProgressHeader

Header for progress display with text and percentage.

##### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ----------- | ------- | -------------------------- |
| `children` | `ReactNode` | - | Header content |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Header content |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

### Utility Components

#### CompletionBadge

Badge for displaying completion status.

##### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ----------- | ----------- | ------- | -------------------------- |
| `children` | `ReactNode` | - | Badge content |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Badge content |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

#### DifficultyBadge

Color-coded badge for difficulty levels.

##### Props

<<<<<<< HEAD
| Prop | Type | Default | Description |
| ------------ | -------- | ------- | --------------------------------------------------------- |
| `difficulty` | `string` | - | Difficulty level ('beginner', 'intermediate', 'advanced') |
| `className` | `string` | `''` | Additional CSS class names |
=======
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `difficulty` | `string` | - | Difficulty level ('beginner', 'intermediate', 'advanced') |
| `className` | `string` | `''` | Additional CSS class names |

> > > > > > > origin/main

##### Example

```tsx
<<<<<<< HEAD
<DifficultyBadge difficulty='intermediate' />
=======
<DifficultyBadge difficulty="intermediate" />
>>>>>>> origin/main
```

## Examples

### Goal Card Example

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
  IconButton,
  ProgressBar,
  ProgressHeader,
<<<<<<< HEAD
  SimpleProgress,
=======
  SimpleProgress
>>>>>>> origin/main
} from '../UI/Card';

function GoalCard({ goal, progress, onEdit, onDelete }) {
  return (
<<<<<<< HEAD
    <Card variant='goal' completed={goal.isCompleted}>
      <CardHeader>
        <CardIcon color={goal.color}>{goal.icon}</CardIcon>
        <CardTitle>
          <h4>{goal.title}</h4>
          <span className='goal-type'>{goal.type}</span>
        </CardTitle>
        {!goal.isCompleted && (
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
        {!goal.isCompleted && (
          <CardActions>
            <IconButton onClick={() => onEdit(goal.id)} title="Edit goal">
              ✏️
            </IconButton>
            <IconButton onClick={() => onDelete(goal.id)} title="Delete goal">
>>>>>>> origin/main
              🗑️
            </IconButton>
          </CardActions>
        )}
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
        <SimpleProgress>
          <ProgressHeader>
<<<<<<< HEAD
            <span className='progress-text'>
              {progress.current} / {goal.target}
            </span>
            <span className='progress-percentage'>{Math.round(progress.percentage)}%</span>
=======
            <span className="progress-text">
              {progress.current} / {goal.target}
            </span>
            <span className="progress-percentage">
              {Math.round(progress.percentage)}%
            </span>
>>>>>>> origin/main
          </ProgressHeader>
          <ProgressBar
            percentage={progress.percentage}
            completed={goal.isCompleted}
            color={goal.color}
          />
        </SimpleProgress>
      </CardContent>

      <CardFooter>
        <div>📅 {goal.period}</div>
        <div>⏰ {progress.daysRemaining} days left</div>
      </CardFooter>
    </Card>
  );
}
```

### Run Card Example

```tsx
import { Card, CardHeader, CardContent, CardActions, IconButton } from '../UI/Card';

function RunCard({ run, onEdit, onDelete }) {
  return (
<<<<<<< HEAD
    <Card variant='run'>
      <CardHeader variant='run'>
        <div className='run-date'>{formatDate(run.date)}</div>
        <CardActions variant='run'>
          <IconButton variant='edit' onClick={() => onEdit(run)}>
            ✏️
          </IconButton>
          <IconButton variant='delete' onClick={() => onDelete(run.id)}>
=======
    <Card variant="run">
      <CardHeader variant="run">
        <div className="run-date">{formatDate(run.date)}</div>
        <CardActions variant="run">
          <IconButton variant="edit" onClick={() => onEdit(run)}>
            ✏️
          </IconButton>
          <IconButton variant="delete" onClick={() => onDelete(run.id)}>
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
          <div className='stat'>
            <span className='stat-value'>{run.duration}</span>
            <span className='stat-label'>Duration</span>
          </div>
        </div>

        {run.notes && <div className='run-notes'>{run.notes}</div>}
=======
        <div className="run-stats">
          <div className="stat">
            <span className="stat-value">{run.distance}km</span>
            <span className="stat-label">Distance</span>
          </div>
          <div className="stat">
            <span className="stat-value">{run.duration}</span>
            <span className="stat-label">Duration</span>
          </div>
        </div>

        {run.notes && (
          <div className="run-notes">{run.notes}</div>
        )}
>>>>>>> origin/main
      </CardContent>
    </Card>
  );
}
```

### Template Card Example

```tsx
import {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardContent,
  CardActions,
  DifficultyBadge,
<<<<<<< HEAD
  ExpandedContent,
=======
  ExpandedContent
>>>>>>> origin/main
} from '../UI/Card';
import { Button } from '../UI/Button';

function TemplateCard({ template, onSelect }) {
  const [expanded, setExpanded] = useState(false);

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

        {expanded && (
          <ExpandedContent>
<<<<<<< HEAD
            <div className='template-section'>
=======
            <div className="template-section">
>>>>>>> origin/main
              <h5>Training Tips:</h5>
              <ul>
                {template.tips.map((tip, index) => (
                  <li key={index}>{tip}</li>
                ))}
              </ul>
            </div>
          </ExpandedContent>
        )}
      </CardContent>

<<<<<<< HEAD
      <CardActions variant='template'>
        <Button variant='secondary' onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show Less' : 'Learn More'}
        </Button>
        <Button variant='primary' onClick={onSelect}>
=======
      <CardActions variant="template">
        <Button
          variant="secondary"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show Less' : 'Learn More'}
        </Button>
        <Button variant="primary" onClick={onSelect}>
>>>>>>> origin/main
          Use Template
        </Button>
      </CardActions>
    </Card>
  );
}
```

## Variants

### Default

<<<<<<< HEAD

Standard card styling suitable for general content.

### Goal

Enhanced styling for goal cards with:

=======
Standard card styling suitable for general content.

### Goal

Enhanced styling for goal cards with:

> > > > > > > origin/main

- Progress tracking support
- Completion states
- Action buttons
- Expand/collapse functionality

### Run

<<<<<<< HEAD

Optimized for displaying running activity data with:

=======
Optimized for displaying running activity data with:

> > > > > > > origin/main

- Stat display layouts
- Hover-revealed actions
- Animation delays in grids

### Template

<<<<<<< HEAD

Designed for goal template cards with:

=======
Designed for goal template cards with:

> > > > > > > origin/main

- Expanded content areas
- Difficulty badges
- Tag displays
- Action button layouts

## Accessibility

### ARIA Support

All Card components include proper ARIA attributes:

```tsx
<<<<<<< HEAD
<Card interactive={true} role='button' tabIndex={0} aria-label='Goal card for weekly running'>
=======
<Card
  interactive={true}
  role="button"
  tabIndex={0}
  aria-label="Goal card for weekly running"
>
>>>>>>> origin/main
  {/* Card content */}
</Card>
```

### Keyboard Navigation

- **Tab**: Navigate between interactive cards
- **Enter/Space**: Activate interactive cards
- **Escape**: Close expanded content

### Screen Reader Support

- Semantic HTML structure
- Descriptive ARIA labels
- Proper heading hierarchy
- Clear action descriptions

### Focus Management

```tsx
<<<<<<< HEAD
<IconButton title='Edit goal' aria-label='Edit goal: Weekly 5K Challenge' onClick={handleEdit}>
=======
<IconButton
  title="Edit goal"
  aria-label="Edit goal: Weekly 5K Challenge"
  onClick={handleEdit}
>
>>>>>>> origin/main
  ✏️
</IconButton>
```

## Best Practices

### 1. Use Semantic HTML

```tsx
// ✅ Good
<CardTitle>
  <h4>Goal Title</h4>
  <span className="goal-type">Weekly Goal</span>
</CardTitle>

// ❌ Avoid
<CardTitle>
  <div>Goal Title</div>
  <div>Weekly Goal</div>
</CardTitle>
```

### 2. Provide Descriptive Labels

```tsx
// ✅ Good
<<<<<<< HEAD
<IconButton
=======
<IconButton
>>>>>>> origin/main
  title="Delete this goal permanently"
  aria-label="Delete goal: Weekly 5K Challenge"
  onClick={onDelete}
>
  🗑️
</IconButton>

// ❌ Avoid
<IconButton onClick={onDelete}>
  🗑️
</IconButton>
```

### 3. Use Appropriate Variants

```tsx
// ✅ Good - Use specific variants for their intended purpose
<Card variant="goal">
  <ProgressBar percentage={75} />
</Card>

<Card variant="run">
  <div className="run-stats">...</div>
</Card>

// ❌ Avoid - Using wrong variant for content type
<Card variant="template">
  <ProgressBar percentage={75} />
</Card>
```

### 4. Handle Loading States

```tsx
// ✅ Good
<<<<<<< HEAD
{
  isLoading ? (
    <Card loading={true}>
      <div className='skeleton-content'>Loading...</div>
    </Card>
  ) : (
    <Card variant='goal'>
      <CardContent>{goalData}</CardContent>
    </Card>
  );
}
=======
{isLoading ? (
  <Card loading={true}>
    <div className="skeleton-content">Loading...</div>
  </Card>
) : (
  <Card variant="goal">
    <CardContent>{goalData}</CardContent>
  </Card>
)}
>>>>>>> origin/main
```

### 5. Maintain Consistent Color Theming

```tsx
// ✅ Good - Use consistent color theming
<CardIcon color={goal.color}>🎯</CardIcon>
<ProgressBar color={goal.color} percentage={75} />

// ❌ Avoid - Inconsistent colors
<CardIcon color="#red">🎯</CardIcon>
<ProgressBar color="#blue" percentage={75} />
```

### 6. Optimize for Performance

```tsx
// ✅ Good - Use React.memo for expensive cards
const OptimizedGoalCard = React.memo(GoalCard, (prevProps, nextProps) => {
<<<<<<< HEAD
  return prevProps.goal.id === nextProps.goal.id && prevProps.progress === nextProps.progress;
});

// ✅ Good - Use proper keys in lists
{
  goals.map(goal => <GoalCard key={goal.id} goal={goal} />);
}
=======
  return prevProps.goal.id === nextProps.goal.id &&
         prevProps.progress === nextProps.progress;
});

// ✅ Good - Use proper keys in lists
{goals.map(goal => (
  <GoalCard key={goal.id} goal={goal} />
))}
>>>>>>> origin/main
```

### 7. Error Handling

```tsx
// ✅ Good - Handle missing data gracefully
function SafeGoalCard({ goal, progress }) {
  if (!goal) {
    return (
      <Card>
        <CardContent>
          <p>Goal data unavailable</p>
        </CardContent>
      </Card>
    );
  }

<<<<<<< HEAD
  return <Card variant='goal'>{/* Normal card content */}</Card>;
=======
  return (
    <Card variant="goal">
      {/* Normal card content */}
    </Card>
  );
>>>>>>> origin/main
}
```

---

For more information, see:
<<<<<<< HEAD

- [Migration Guide](../migration/card-system.md)
- [Styling Guide](../styling/card-theming.md)
- # [Accessibility Guide](../accessibility/card-a11y.md)
- [Migration Guide](../migration/card-system.md)
- [Styling Guide](../styling/card-theming.md)
- [Accessibility Guide](../accessibility/card-a11y.md)
  > > > > > > > origin/main
