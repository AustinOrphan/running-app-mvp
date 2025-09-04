# Performance Thresholds - Realistic Configuration

This document outlines the realistic performance thresholds set for the Running App MVP based on Web Vitals standards and CI environment considerations.

## Web Vitals Thresholds

### Core Web Vitals

#### First Contentful Paint (FCP)
- **Local Development**: 2000ms (Target: 1800ms)
- **CI Environment**: 2200ms (Account for slower CI runners)
- **Web Standard**: Good < 1.8s, Needs Improvement: 1.8s - 3.0s
- **Rationale**: React app with code splitting, realistic for SPA initial load

#### Largest Contentful Paint (LCP)  
- **Local Development**: 3000ms (Target: 2500ms)
- **CI Environment**: 3500ms (Account for resource constraints)
- **Web Standard**: Good < 2.5s, Needs Improvement: 2.5s - 4.0s
- **Rationale**: Dashboard with charts and data loading, reasonable for interactive content

#### Cumulative Layout Shift (CLS)
- **Local Development**: 0.1 (Target: Good threshold)
- **CI Environment**: 0.12 (Slight tolerance for CI variance)
- **Web Standard**: Good < 0.1, Needs Improvement: 0.1 - 0.25
- **Rationale**: Well-structured React components should maintain layout stability

### Additional Performance Metrics

#### Total Blocking Time (TBT)
- **Local Development**: 300ms
- **CI Environment**: 600ms
- **Target**: Keep main thread responsive during load

#### Speed Index
- **Local Development**: 3500ms
- **CI Environment**: 4500ms
- **Target**: Visual completeness progression

## Performance Categories

### Lighthouse Scores (0-100)

#### Performance
- **Local Development**: Minimum 75 (Target: Good performance)
- **CI Environment**: Minimum 65 (Account for CI limitations)

#### Accessibility
- **Local Development**: Minimum 90 (High standard)
- **CI Environment**: Minimum 85 (Maintain accessibility focus)

#### Best Practices
- **Local Development**: Minimum 80
- **CI Environment**: Minimum 75

#### SEO
- **Local Development**: Minimum 80
- **CI Environment**: Minimum 70

## Environment-Specific Considerations

### Local Development
- Optimized for development experience
- Tighter thresholds to catch performance regressions early
- Assumes local resources and faster execution

### CI Environment  
- Accounts for shared resources and potential slowdowns
- 10-30% relaxed thresholds compared to local
- Maintains quality standards while being practical for CI/CD

## Bundle Size Limits

Based on `performance-thresholds-detailed.json`:

### JavaScript
- **Main Bundle**: 400KB (warning), 500KB (max)
- **Vendor Bundle**: 600KB (warning), 800KB (max)
- **Code Splitting**: Chunks < 150KB recommended

### CSS
- **Main Stylesheet**: 80KB (warning), 100KB (max)
- **Critical CSS**: < 10KB inline

### Total Assets
- **Initial Bundle**: 1.2MB (warning), 1.5MB (max)
- **All Assets**: 4MB (warning), 5MB (max)

## API Response Time Targets

### Authentication
- **Login**: 300ms (warning), 500ms (max)
- **Register**: 500ms (warning), 800ms (max)
- **Token Refresh**: 100ms (warning), 200ms (max)

### Data Operations
- **Simple Queries**: 30ms (warning), 50ms (max)
- **Complex Queries**: 100ms (warning), 200ms (max)
- **List Operations**: 300ms (warning), 500ms (max)

## Monitoring and Alerts

### Automated Monitoring
- Lighthouse CI runs on every PR
- Performance regression alerts
- Bundle size tracking
- API response time monitoring

### Success Metrics
- **95% of page loads**: Meet FCP/LCP targets
- **Zero layout shifts**: CLS < 0.1 consistently
- **API reliability**: 99% of requests under threshold

## Implementation Status

✅ **COMPLETED**: Set realistic thresholds
- [x] Define FCP targets (1800ms local, 2200ms CI)
- [x] Set LCP thresholds (3000ms local, 3500ms CI)  
- [x] Configure CLS limits (0.1 local, 0.12 CI)
- [x] Update lighthouserc.json with local thresholds
- [x] Update lighthouserc.ci.json with CI thresholds
- [x] Document performance standards and rationale

## Next Steps

- [ ] Enable Lighthouse CI in GitHub Actions
- [ ] Set up performance monitoring dashboard
- [ ] Implement performance budgets in build process
- [ ] Add bundle size checking to CI pipeline

---

*Last updated: August 2025*
*These thresholds are based on Web Vitals standards and running app performance characteristics*