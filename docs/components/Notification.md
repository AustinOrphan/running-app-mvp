# Notification Components CSS Module

## Overview

The `Notification.module.css` module provides comprehensive styling for all notification-related components including toast notifications, notification center, achievement modals, and notification settings. This module has been optimized for accessibility and performance.

## Components Covered

### Toast Notifications

- **ToastContainer**: Fixed positioning container for toast notifications
- **Toast**: Individual toast notification with animation states
- **ToastContent**: Content layout within toast notifications

### Notification Center

- **NotificationCenter**: Slide-out panel for managing notifications
- **NotificationList**: Scrollable list of notifications
- **NotificationItem**: Individual notification with type variants

### Achievement Notifications

- **AchievementOverlay**: Full-screen overlay for achievement celebrations
- **AchievementNotification**: Modal dialog for achievement details

### Settings Interface

- **NotificationSettings**: Configuration panel for notification preferences
- **SettingItem**: Individual setting options with toggles

## Usage Examples

### Basic Toast Notification

```tsx
import styles from '../styles/components/Notification.module.css';

export const ToastContainer = ({ toasts, onRemoveToast }) => {
  return (
    <div className={styles.toastContainer}>
      {toasts.map(toast => (
        <div key={toast.id} className={`${styles.toast} ${styles[toast.type]} ${styles.show}`}>
          <div className={styles.toastContent}>
            <span className={styles.toastMessage}>{toast.message}</span>
            <button className={styles.toastClose} onClick={() => onRemoveToast(toast.id)}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
```

### Dynamic Notification Item

```tsx
export const NotificationItem = ({ notification, onDismiss, onMarkRead }) => {
  const getNotificationStyles = (type, priority) => {
    const classes = [styles.notificationItem];

    const typeMap = {
      achievement: styles.notificationAchievement,
      milestone: styles.notificationMilestone,
      deadline: styles.notificationDeadline,
      streak: styles.notificationStreak,
    };

    const priorityMap = {
      urgent: styles.notificationUrgent,
      high: styles.notificationHigh,
      medium: styles.notificationMedium,
      low: styles.notificationLow,
    };

    if (typeMap[type]) classes.push(typeMap[type]);
    if (priorityMap[priority]) classes.push(priorityMap[priority]);

    return classes.join(' ');
  };

  return (
    <div
      className={`${getNotificationStyles(notification.type, notification.priority)} ${!notification.read ? styles.unread : ''}`}
      onClick={() => !notification.read && onMarkRead(notification.id)}
    >
      <div className={styles.notificationHeader}>
        <div className={styles.notificationIcon}>{notification.icon}</div>
        <div className={styles.notificationMeta}>
          <span className={styles.notificationType}>{notification.type}</span>
          <span className={styles.notificationTime}>{notification.time}</span>
        </div>
        <button
          className={styles.notificationDismiss}
          onClick={e => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
        >
          ×
        </button>
      </div>
      <div className={styles.notificationContent}>
        <h4 className={styles.notificationTitle}>{notification.title}</h4>
        <p className={styles.notificationMessage}>{notification.message}</p>
      </div>
    </div>
  );
};
```

## Available Classes

### Container Classes

- `.toastContainer` - Fixed container for toast notifications
- `.notificationCenter` - Slide-out notification panel
- `.notificationCenterOverlay` - Background overlay for notification center
- `.notificationList` - Scrollable notification list
- `.notificationEmpty` - Empty state styling

### Notification Item Classes

- `.notificationItem` - Base notification item
- `.notificationHeader` - Header section with icon and meta
- `.notificationContent` - Main content area
- `.notificationTitle` - Notification title
- `.notificationMessage` - Notification message text
- `.notificationDetails` - Additional details section

### Type Variants

- `.notificationAchievement` - Achievement notification styling
- `.notificationMilestone` - Milestone notification styling
- `.notificationDeadline` - Deadline notification styling
- `.notificationStreak` - Streak notification styling
- `.notificationSummary` - Summary notification styling
- `.notificationReminder` - Reminder notification styling

### Priority Variants

- `.notificationUrgent` - Urgent priority styling (red accent)
- `.notificationHigh` - High priority styling (orange accent)
- `.notificationMedium` - Medium priority styling (blue accent)
- `.notificationLow` - Low priority styling (default)

### State Classes

- `.unread` - Unread notification styling
- `.active` - Active/selected state
- `.show` - Animation state for showing
- `.hide` - Animation state for hiding

### Interactive Elements

- `.notificationDismiss` - Dismiss button (44px touch target)
- `.btnIcon` - Icon button styling (44px touch target)
- `.btnPrimary` - Primary action button

### Settings Classes

- `.notificationSettings` - Settings panel container
- `.settingItem` - Individual setting item
- `.settingToggle` - Toggle switch styling
- `.settingDescription` - Setting description text

### Detail Components

- `.milestoneProgress` - Progress bar for milestones
- `.milestoneBar` - Progress bar container
- `.milestoneFill` - Progress fill element
- `.deadlineInfo` - Deadline information layout
- `.daysRemaining` - Days remaining text
- `.streakInfo` - Streak information display
- `.streakCount` - Streak count number
- `.streakType` - Streak type text

## Accessibility Features

### Touch Targets

All interactive elements meet WCAG 2.1 AA standards:

- Buttons: 44px minimum touch target
- Dismiss buttons: 44px minimum with proper padding
- Settings toggles: Accessible click area

### Focus Management

```css
.btnIcon:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.notificationDismiss:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

### Keyboard Navigation

- Tab order follows logical flow
- Escape key closes notification center
- Enter/Space activates buttons and toggles

### Screen Reader Support

- Semantic HTML structure
- ARIA labels and roles
- Live regions for dynamic notifications

## Performance Optimizations

### Hardware Acceleration

```css
.toast {
  transform: translateX(100%);
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
  will-change: transform, opacity;
}

.toast.show {
  transform: translateX(0);
  opacity: 1;
}
```

### Efficient Animations

- Uses `transform` instead of layout properties
- GPU acceleration with `will-change` hints
- Removes `will-change` when animations complete

### CSS Custom Properties

```css
:root {
  --notification-transition: 0.3s ease;
  --notification-border-radius: 8px;
  --notification-padding: 16px;
}
```

## Responsive Design

### Mobile Optimizations

```css
@media (max-width: 768px) {
  .toastContainer {
    top: 10px;
    right: 10px;
    left: 10px;
    max-width: none;
  }

  .notificationCenter {
    width: 100%;
  }
}
```

### Touch-Friendly Interactions

- Larger touch targets on mobile
- Swipe gestures supported
- Improved spacing for finger navigation

## Color Schemes and Theming

### Type-Based Colors

- **Achievement**: Success green (`var(--color-success)`)
- **Milestone**: Primary blue (`var(--color-primary)`)
- **Deadline**: Warning orange (`var(--color-warning)`)
- **Streak**: Info blue (`var(--color-info)`)

### Priority-Based Backgrounds

- **Urgent**: Red background with low opacity
- **High**: Orange background with low opacity
- **Medium**: Blue background with low opacity
- **Low**: Default background

## Testing

### CSS Module Tests

```tsx
// Tests are in css-module-migration.test.tsx
describe('Notification CSS Module Classes', () => {
  it('should have required notification classes', () => {
    expect(notificationStyles.notificationItem).toBeDefined();
    expect(notificationStyles.notificationHeader).toBeDefined();
    expect(notificationStyles.notificationContent).toBeDefined();
    expect(notificationStyles.notificationDismiss).toBeDefined();
  });

  it('should support complex class combinations', () => {
    const className = [
      notificationStyles.notificationItem,
      notificationStyles.notificationMilestone,
      notificationStyles.notificationHigh,
      notificationStyles.unread,
    ].join(' ');

    expect(className).toContain(notificationStyles.notificationItem);
    expect(className).toContain(notificationStyles.notificationMilestone);
  });
});
```

### Visual Testing Checklist

- [ ] Toast notifications appear with correct animations
- [ ] Notification center slides in/out smoothly
- [ ] Type variants display correct colors and styling
- [ ] Priority variants show appropriate visual hierarchy
- [ ] Settings toggles are clearly interactive
- [ ] Mobile responsive layout works correctly
- [ ] High contrast mode provides sufficient contrast
- [ ] Reduced motion mode disables animations

## Migration Notes

This module was migrated from global CSS to CSS modules as part of the CSS architecture improvement project. Key changes:

1. **Class Name Conversion**: `notification-item` → `notificationItem`
2. **Added Missing Classes**: 60+ CSS classes were added that were referenced but missing
3. **Accessibility Improvements**: Touch targets increased to 44px minimum
4. **Performance Optimizations**: Hardware-accelerated animations
5. **Settings Migration**: Settings section migrated from string classes to CSS modules

## Troubleshooting

### Common Issues

1. **Missing CSS Classes**

   ```tsx
   // Always verify class exists
   console.log(Object.keys(notificationStyles));
   ```

2. **Type/Priority Combinations**

   ```tsx
   // Use defensive programming
   const typeClass = typeMap[type] || '';
   const priorityClass = priorityMap[priority] || '';
   ```

3. **Animation Not Working**
   ```css
   /* Ensure proper state management */
   .toast.show {
     transform: translateX(0);
   }
   .toast.hide {
     transform: translateX(100%);
   }
   ```

This documentation should be updated when new notification features are added or styling patterns change.
