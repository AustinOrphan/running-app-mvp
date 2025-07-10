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
  CardFooter
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

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'goal' \| 'run' \| 'template'` | `'default'` | Card variant affecting styling |
| `completed` | `boolean` | `false` | Whether the card represents a completed item |
| `interactive` | `boolean` | `false` | Whether the card is clickable |
| `loading` | `boolean` | `false` | Whether the card is in loading state |
| `className` | `string` | `''` | Additional CSS class names |
| `children` | `ReactNode` | - | Card content |

#### Example

```tsx
<Card variant="goal" completed={false} interactive={true}>
  {/* Card content */}
</Card>
```

### CardHeader

Container for card title, icon, and actions.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'template' \| 'run'` | `'default'` | Header variant for specific styling |
| `children` | `ReactNode` | - | Header content |
| `className` | `string` | `''` | Additional CSS class names |

#### Example

```tsx
<CardHeader variant="template">
  <CardIcon>🏃</CardIcon>
  <CardTitle>
    <h4>Running Goal</h4>
  </CardTitle>
</CardHeader>
```

### CardIcon

Displays an icon with optional color theming.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'template'` | `'default'` | Icon variant for sizing |
| `color` | `string` | - | Custom color for the icon |
| `children` | `ReactNode` | - | Icon content (emoji, SVG, etc.) |
| `className` | `string` | `''` | Additional CSS class names |

#### Example

```tsx
<CardIcon variant="template" color="#3b82f6">
  🎯
</CardIcon>
```

### CardTitle

Container for card title and subtitle.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'template'` | `'default'` | Title variant for styling |
| `children` | `ReactNode` | - | Title content |
| `className` | `string` | `''` | Additional CSS class names |

#### Example

```tsx
<CardTitle>
  <h4>Goal Title</h4>
  <span className="goal-type">Weekly Goal</span>
</CardTitle>
```

### CardDescription

Displays descriptive text content.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'template'` | `'default'` | Description variant for styling |
| `children` | `ReactNode` | - | Description content |
| `className` | `string` | `''` | Additional CSS class names |

#### Example

```tsx
<CardDescription>
  Run 5km every weekday morning to build endurance.
</CardDescription>
```

### CardContent

Main content area of the card.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Content |
| `className` | `string` | `''` | Additional CSS class names |

### CardActions

Container for action buttons.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'run' \| 'template'` | `'default'` | Actions variant for styling |
| `children` | `ReactNode` | - | Action buttons |
| `className` | `string` | `''` | Additional CSS class names |

#### Example

```tsx
<CardActions variant="run">
  <IconButton variant="edit" title="Edit run">✏️</IconButton>
  <IconButton variant="delete" title="Delete run">🗑️</IconButton>
</CardActions>
```

### CardFooter

Footer area for meta information.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Footer content |
| `className` | `string` | `''` | Additional CSS class names |

### IconButton

Clickable icon button for actions.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'run' \| 'delete' \| 'edit'` | `'default'` | Button variant for styling |
| `title` | `string` | - | Tooltip text |
| `onClick` | `() => void` | - | Click handler |
| `children` | `ReactNode` | - | Button content |
| `className` | `string` | `''` | Additional CSS class names |

### Progress Components

#### ProgressBar

Animated progress bar with color theming.

##### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `percentage` | `number` | - | Progress percentage (0-100) |
| `completed` | `boolean` | `false` | Whether progress is completed |
| `color` | `string` | - | Custom progress color |
| `className` | `string` | `''` | Additional CSS class names |

##### Example

```tsx
<ProgressBar 
  percentage={75} 
  color="#10b981" 
  completed={false}
/>
```

#### ProgressHeader

Header for progress display with text and percentage.

##### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Header content |
| `className` | `string` | `''` | Additional CSS class names |

### Utility Components

#### CompletionBadge

Badge for displaying completion status.

##### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Badge content |
| `className` | `string` | `''` | Additional CSS class names |

#### DifficultyBadge

Color-coded badge for difficulty levels.

##### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `difficulty` | `string` | - | Difficulty level ('beginner', 'intermediate', 'advanced') |
| `className` | `string` | `''` | Additional CSS class names |

##### Example

```tsx
<DifficultyBadge difficulty="intermediate" />
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
  SimpleProgress
} from '../UI/Card';

function GoalCard({ goal, progress, onEdit, onDelete }) {
  return (
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
              🗑️
            </IconButton>
          </CardActions>
        )}
      </CardHeader>

      {goal.description && (
        <CardDescription>
          {goal.description}
        </CardDescription>
      )}

      <CardContent>
        <SimpleProgress>
          <ProgressHeader>
            <span className="progress-text">
              {progress.current} / {goal.target}
            </span>
            <span className="progress-percentage">
              {Math.round(progress.percentage)}%
            </span>
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
    <Card variant="run">
      <CardHeader variant="run">
        <div className="run-date">{formatDate(run.date)}</div>
        <CardActions variant="run">
          <IconButton variant="edit" onClick={() => onEdit(run)}>
            ✏️
          </IconButton>
          <IconButton variant="delete" onClick={() => onDelete(run.id)}>
            🗑️
          </IconButton>
        </CardActions>
      </CardHeader>

      <CardContent>
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
  ExpandedContent
} from '../UI/Card';
import { Button } from '../UI/Button';

function TemplateCard({ template, onSelect }) {
  const [expanded, setExpanded] = useState(false);

  return (
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
        </CardTitle>
        <DifficultyBadge difficulty={template.difficulty} />
      </CardHeader>

      <CardContent>
        <div className="template-details">
          <div className="template-target">
            <span className="target-label">Target:</span>
            <span className="target-value">{template.target}</span>
          </div>
        </div>

        {expanded && (
          <ExpandedContent>
            <div className="template-section">
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

      <CardActions variant="template">
        <Button 
          variant="secondary" 
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show Less' : 'Learn More'}
        </Button>
        <Button variant="primary" onClick={onSelect}>
          Use Template
        </Button>
      </CardActions>
    </Card>
  );
}
```

## Variants

### Default
Standard card styling suitable for general content.

### Goal
Enhanced styling for goal cards with:
- Progress tracking support
- Completion states
- Action buttons
- Expand/collapse functionality

### Run
Optimized for displaying running activity data with:
- Stat display layouts
- Hover-revealed actions
- Animation delays in grids

### Template
Designed for goal template cards with:
- Expanded content areas
- Difficulty badges
- Tag displays
- Action button layouts

## Accessibility

### ARIA Support

All Card components include proper ARIA attributes:

```tsx
<Card 
  interactive={true}
  role="button"
  tabIndex={0}
  aria-label="Goal card for weekly running"
>
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
<IconButton
  title="Edit goal"
  aria-label="Edit goal: Weekly 5K Challenge"
  onClick={handleEdit}
>
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
<IconButton 
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
{isLoading ? (
  <Card loading={true}>
    <div className="skeleton-content">Loading...</div>
  </Card>
) : (
  <Card variant="goal">
    <CardContent>{goalData}</CardContent>
  </Card>
)}
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
  return prevProps.goal.id === nextProps.goal.id && 
         prevProps.progress === nextProps.progress;
});

// ✅ Good - Use proper keys in lists
{goals.map(goal => (
  <GoalCard key={goal.id} goal={goal} />
))}
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

  return (
    <Card variant="goal">
      {/* Normal card content */}
    </Card>
  );
}
```

---

For more information, see:
- [Migration Guide](../migration/card-system.md)
- [Styling Guide](../styling/card-theming.md)
- [Accessibility Guide](../accessibility/card-a11y.md)