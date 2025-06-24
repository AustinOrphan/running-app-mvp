# 📸 Visual Regression Testing Guide

This guide explains how to use the visual regression testing system for the Running Tracker MVP.

## 🎯 Overview

Visual regression testing helps catch unintended visual changes to the UI by comparing screenshots of the application against known-good baseline images.

## 🚀 Quick Start

### Running Visual Tests

```bash
# Run all visual regression tests
npm run test:visual

# Run with visual output (see browser)
npm run test:visual:headed

# Run for CI environment
npm run test:visual:ci
```

### Updating Baselines

When you intentionally change the UI, update the baseline images:

```bash
# Update all baseline images
npm run test:visual:update

# Or set environment variable
UPDATE_VISUAL_BASELINES=true npm run test:visual
```

## 📁 Directory Structure

```
tests/
├── visual-baselines/          # Baseline screenshots (committed to git)
│   ├── login-page.png
│   ├── dashboard-page.png
│   └── ...
├── setup/
│   ├── visualTestingSetup.ts  # Visual testing utilities
│   ├── visual-global-setup.ts # Global setup
│   └── visual-global-teardown.ts
└── e2e/
    └── visual-regression.test.ts

test-results/
├── visual-actual/             # Current test screenshots
├── visual-diffs/              # Difference images
├── visual-regression-report/  # HTML report
└── visual-test-summary.json   # Test summary
```

## 🔧 Configuration

### Environment Variables

- `UPDATE_VISUAL_BASELINES=true` - Update baseline images instead of comparing
- `CI=true` - Use stricter thresholds for CI environment
- `VISUAL_TESTING=true` - Enable visual testing mode

### Thresholds

Different thresholds are used based on the type of content:

- **Static content**: 2% pixel difference tolerance
- **Charts/graphs**: 5% tolerance (due to rendering variations)
- **Mobile views**: 4% tolerance (due to device differences)
- **CI environment**: Stricter thresholds (1-3%)

## 📝 Writing Visual Tests

### Basic Test Structure

```typescript
import { test } from '@playwright/test';
import { visualTest } from '../setup/visualTestingSetup';

test('should match page visual baseline', async ({ page }) => {
  await page.goto('/your-page');
  await page.waitForLoadState('networkidle');

  await visualTest.expectVisualMatch(page, 'your-page-name', {
    fullPage: true,
    maxDiffPercent: 2,
  });
});
```

### Advanced Options

```typescript
await visualTest.expectVisualMatch(page, 'test-name', {
  fullPage: true, // Capture full page
  maxDiffPercent: 3, // Allow 3% pixel difference
  clip: { x: 0, y: 0, width: 800, height: 600 }, // Specific area
  mask: [
    // Hide dynamic elements
    '[data-testid="timestamp"]',
    '.loading-spinner',
  ],
  animations: 'disabled', // Disable animations
});
```

### Handling Dynamic Content

Dynamic content should be masked or replaced:

```typescript
// Hide timestamps and loading indicators
mask: ['[data-testid="current-date"]', '.relative-time', '.loading-spinner', '.chart-tooltip'];
```

## 🎨 Test Categories

### 1. Page-Level Tests

- Full page screenshots of main application pages
- Different user states (logged in/out, empty/populated)
- Error states and loading states

### 2. Component-Level Tests

- Individual UI components
- Different component states and props
- Interactive states (hover, focus, active)

### 3. Responsive Tests

- Mobile, tablet, and desktop viewports
- Different screen orientations
- Browser-specific rendering differences

### 4. Theme Tests

- Light and dark modes
- High contrast modes
- Accessibility themes

## 📊 Understanding Results

### Test Results

After running visual tests, check the results:

1. **Pass**: No visual differences detected
2. **Fail**: Visual differences exceed threshold
3. **New**: Baseline image created (first run)

### Diff Analysis

When tests fail:

1. Check the HTML report: `test-results/visual-regression-report/index.html`
2. Review diff images in `test-results/visual-diffs/`
3. Compare actual vs baseline images
4. Determine if differences are intentional

### Report Structure

The HTML report shows:

- Side-by-side comparison of baseline vs actual
- Highlighted differences in red
- Pixel difference statistics
- Test metadata and configuration

## 🛠️ Troubleshooting

### Common Issues

#### 1. Flaky Tests Due to Animations

```typescript
// Disable animations globally
await page.addStyleTag({
  content: `
    *, *::before, *::after {
      animation-duration: 0s !important;
      transition-duration: 0s !important;
    }
  `,
});
```

#### 2. Font Rendering Differences

```typescript
// Ensure fonts are loaded
await page.evaluate(() => document.fonts.ready);

// Use consistent font rendering
await page.addStyleTag({
  content: `
    * {
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
  `,
});
```

#### 3. Dynamic Timestamps

```typescript
// Mock or hide timestamps
await page.evaluate(() => {
  document.querySelectorAll('.timestamp').forEach(el => {
    el.textContent = '2024-01-01 12:00:00';
  });
});
```

#### 4. Chart Rendering Variations

```typescript
// Wait for charts to fully render
await page.waitForTimeout(2000);

// Use higher tolerance for charts
maxDiffPercent: 5;
```

### Best Practices

1. **Consistent Setup**
   - Use `visualTest.setupPageForVisualTesting()` for consistent page setup
   - Wait for network idle before capturing
   - Disable animations and transitions

2. **Stable Selectors**
   - Use stable test IDs for masking elements
   - Avoid relying on dynamic class names
   - Mask or mock dynamic content

3. **Appropriate Thresholds**
   - Use stricter thresholds for static content
   - Allow more tolerance for charts and dynamic content
   - Consider browser differences in CI

4. **Baseline Management**
   - Review all baseline updates before committing
   - Use descriptive test names
   - Organize baselines by feature/page

## 🔄 CI/CD Integration

### GitHub Actions

Visual tests are integrated into the CI pipeline:

```yaml
- name: Run visual regression tests
  run: npm run test:visual:ci

- name: Upload visual test results
  uses: actions/upload-artifact@v4
  with:
    name: visual-test-results
    path: test-results/
```

### Handling Failures

When visual tests fail in CI:

1. Download test artifacts from GitHub Actions
2. Review the visual regression report
3. If changes are intentional:
   - Run `npm run test:visual:update` locally
   - Commit the updated baselines
   - Re-run the CI pipeline

## 📈 Monitoring and Maintenance

### Regular Tasks

1. **Weekly**: Review visual test reports for trends
2. **Before releases**: Run full visual regression suite
3. **After UI changes**: Update relevant baselines
4. **Monthly**: Clean up old test artifacts

### Metrics to Track

- Visual test success rate
- Number of baseline updates per sprint
- Time to resolve visual regressions
- Coverage of UI components

### Performance Optimization

- Use specific clips instead of full page when possible
- Implement parallel test execution
- Cache browser installations
- Optimize image comparison algorithms

## 🎯 Advanced Usage

### Custom Visual Test Helpers

```typescript
// Create reusable test helpers
export const expectChartToMatch = async (page: Page, chartSelector: string, name: string) => {
  const chart = page.locator(chartSelector);
  const chartBox = await chart.boundingBox();

  if (chartBox) {
    await visualTest.expectVisualMatch(page, name, {
      clip: chartBox,
      maxDiffPercent: 5,
      mask: ['.chart-tooltip', '.chart-animation'],
    });
  }
};
```

### Multi-Browser Testing

```typescript
// Test across different browsers
['chromium', 'firefox', 'webkit'].forEach(browserName => {
  test(`should match in ${browserName}`, async ({ page }) => {
    await visualTest.expectVisualMatch(page, `test-${browserName}`, {
      maxDiffPercent: 5, // More lenient for cross-browser
    });
  });
});
```

### Conditional Baselines

```typescript
// Different baselines for different environments
const baselineName = process.env.CI ? 'test-ci' : 'test-local';
await visualTest.expectVisualMatch(page, baselineName, options);
```

## 📚 Resources

- [Playwright Visual Comparisons](https://playwright.dev/docs/test-screenshots)
- [Visual Testing Best Practices](https://applitools.com/blog/visual-testing-best-practices/)
- [Handling Flaky Visual Tests](https://blog.logrocket.com/guide-visual-regression-testing/)

---

_Happy visual testing! 📸✨_
