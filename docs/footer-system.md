# Extensible Footer System

The Running Tracker app features a comprehensive, extensible footer system that provides connectivity status, app information, and customizable content sections.

## Overview

The footer appears as an interactive bar at the bottom of the screen that can be expanded to show detailed information. It's designed to be:

- **Accessible**: Large touch targets (12px bar, expands to 16px on hover)
- **Informative**: Shows real-time connectivity status and app details
- **Extensible**: Supports custom sections and links
- **Responsive**: Adapts to different screen sizes

## Basic Usage

```tsx
import { ConnectivityFooter } from './components/Connectivity/ConnectivityFooter';

// Basic footer with default content
<ConnectivityFooter />

// Footer without focus indicators (cleaner look)
<ConnectivityFooter disableFocusIndicator={true} />
```

## Advanced Usage

### Custom Sections

```tsx
<ConnectivityFooter
  disableFocusIndicator={true}
  additionalSections={[
    {
      id: 'user-stats',
      title: 'Your Progress',
      content: (
        <div className='footer-section-content'>
          <div className='footer-info-item'>
            <span className='footer-info-label'>Total Runs:</span>
            <span className='footer-info-value'>42</span>
          </div>
          <div className='footer-info-item'>
            <span className='footer-info-label'>Distance:</span>
            <span className='footer-info-value'>156.7 km</span>
          </div>
        </div>
      ),
    },
  ]}
/>
```

### Custom Links

```tsx
<ConnectivityFooter
  customLinks={[
    {
      label: 'Help Center',
      href: '/help',
      onClick: (e) => {
        e.preventDefault();
        openHelpModal();
      },
    },
    {
      label: 'Contact Support',
      href: 'mailto:support@runningtracker.com',
    },
  ]}
/>
```

## Utility Functions

The `footerUtils.tsx` file provides helper functions for creating common footer sections:

### Pre-built Sections

```tsx
import {
  createAppInfoSection,
  createUserStatsSection,
  createDebugSection,
  createSystemStatusSection,
} from '../utils/footerUtils';

const sections = [
  createAppInfoSection(),
  createUserStatsSection({
    totalRuns: 42,
    totalDistance: 156.7,
    totalTime: 720, // minutes
  }),
];

// Add debug info in development
if (process.env.NODE_ENV === 'development') {
  sections.push(createDebugSection());
}

<ConnectivityFooter additionalSections={sections} />
```

### Custom Info Sections

```tsx
import { createInfoSection } from '../utils/footerUtils';

const customSection = createInfoSection('my-section', 'My Data', [
  { label: 'Items', value: 10 },
  { label: 'Status', value: 'Active', variant: 'success' },
  { label: 'Error Count', value: 2, variant: 'error' },
]);
```

## Built-in Sections

### Connectivity Section
Always present, shows:
- Current connection status (visual indicator)
- Last checked timestamp
- Last successful connection
- Error messages (when applicable)
- Retry attempts and retry button
- Manual retry functionality

### App Information Section
Always present, shows:
- App version
- Build date
- Current environment (development/production)

## Styling Variants

Footer info items support different visual variants:

```tsx
const items = [
  { label: 'Normal', value: 'default' },
  { label: 'Success', value: 'connected', variant: 'success' },
  { label: 'Warning', value: 'degraded', variant: 'warning' },
  { label: 'Error', value: 'failed', variant: 'error' },
];
```

## CSS Classes

### Main Structure
- `.connectivity-footer` - Root container
- `.connectivity-line` - Interactive bar (click to expand)
- `.connectivity-details` - Expandable content area
- `.connectivity-content` - Inner content wrapper

### Sections
- `.footer-sections` - Grid container for sections
- `.footer-section` - Individual section wrapper
- `.footer-section h3` - Section headers
- `.footer-section-content` - Section content wrapper

### Info Items
- `.footer-info-item` - Individual info rows
- `.footer-info-label` - Left side labels
- `.footer-info-value` - Right side values
- `.footer-info-item.success` - Success variant (green)
- `.footer-info-item.warning` - Warning variant (yellow)
- `.footer-info-item.error` - Error variant (red)

### Links
- `.footer-links` - Links container
- `.footer-link` - Individual links

## Responsive Behavior

### Desktop (768px+)
- 12px bar height (16px on hover)
- Two-column grid for sections
- Full-size touch targets

### Tablet (480px - 768px)
- Single-column grid for sections
- Adjusted padding and spacing

### Mobile (< 480px)
- 10px bar height (14px on hover)
- Smaller touch indicators
- Condensed spacing
- Reduced font sizes

## Accessibility Features

- **Keyboard Navigation**: Tab to focus, Enter/Space to activate
- **ARIA Labels**: Descriptive labels for screen readers
- **Focus Management**: Customizable focus indicators
- **Semantic HTML**: Proper heading hierarchy and structure
- **Color Contrast**: High contrast text and indicators

### Focus Indicators

The footer bar has keyboard accessibility with customizable focus indicators:

**Default behavior** (recommended for accessibility):
```tsx
<ConnectivityFooter />  // Shows subtle box-shadow on focus
```

**Disabled focus indicators** (cleaner visual, but less accessible):
```tsx
<ConnectivityFooter disableFocusIndicator={true} />
```

**Custom focus styling** (via CSS):
```css
.connectivity-line:focus {
  outline: none;
  box-shadow: 0 0 0 3px #your-custom-color;
}
```

## Environment Variables

The footer uses these environment variables:

```bash
REACT_APP_VERSION=1.0.0          # App version display
REACT_APP_BUILD_DATE=2024-01-15  # Build date display
NODE_ENV=development             # Environment indicator
```

## Best Practices

### Section Design
- Keep section titles short and descriptive
- Use consistent info item patterns
- Limit sections to avoid overcrowding
- Consider mobile space constraints

### Link Behavior
- Always provide meaningful onClick handlers
- Use preventDefault() for SPA navigation
- Keep link text concise
- Group related links logically

### Performance
- Lazy load heavy content in sections
- Debounce expensive operations
- Cache static content where possible

### User Experience
- Show relevant information based on app state
- Use appropriate variants for status indicators
- Provide actionable items when applicable
- Keep content scannable and organized

## Example Configurations

### Minimal Footer
```tsx
<ConnectivityFooter />
```

### Clean Footer (no focus indicators)
```tsx
<ConnectivityFooter disableFocusIndicator={true} />
```

### Development Footer
```tsx
<ConnectivityFooter
  disableFocusIndicator={true}
  additionalSections={[
    createDebugSection(),
    createSystemStatusSection({
      serverVersion: '2.1.0',
      databaseStatus: 'connected',
      cacheStatus: 'enabled',
    }),
  ]}
/>
```

### User Dashboard Footer
```tsx
<ConnectivityFooter
  disableFocusIndicator={false}  // Keep accessibility for main app
  additionalSections={[
    createUserStatsSection(userStats),
    createInfoSection('session', 'Session', [
      { label: 'Login Time', value: formatTime(loginTime) },
      { label: 'Active Duration', value: activeDuration },
    ]),
  ]}
  customLinks={userDashboardLinks}
/>
```

## Future Enhancements

Planned improvements include:
- Drag-to-resize functionality
- Persistent expanded state preferences
- More pre-built section types
- Theme customization support
- Animation preferences
- Keyboard shortcuts for quick access