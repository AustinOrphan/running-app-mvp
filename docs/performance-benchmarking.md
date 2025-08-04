# Performance Benchmarking Guide

This document describes the performance benchmarking infrastructure for the Running App MVP.

## Overview

The performance benchmarking system measures and tracks key performance metrics:

- **Test Execution Times**: Unit, integration, and E2E test durations
- **Bundle Sizes**: Main and vendor bundle sizes
- **Build Times**: Frontend and backend build durations
- **Memory Usage**: Heap and RSS memory consumption

## Scripts

### `npm run test:performance:validate`

Validates the environment before running benchmarks:

- Checks Node.js version (requires v18+)
- Verifies available memory (2GB+ required)
- Checks CPU load
- Validates disk space (1GB+ required)
- Ensures dependencies are installed

### `npm run test:performance:ci`

Runs the full performance benchmark suite:

- Validates environment first
- Measures all key metrics
- Compares against baseline
- Checks against thresholds
- Saves results to `benchmark-results/`

### `npm run test:performance:report`

Generates a CI-friendly performance report:

- Markdown format by default
- GitHub Actions integration
- Historical trend analysis
- Automatic PR comments

### `npm run test:performance:dashboard`

Creates an interactive HTML dashboard:

- Visual charts for all metrics
- Historical trends
- Performance comparisons
- Saved to `performance-dashboard/`

## Configuration Files

### `performance-thresholds.json`

Defines maximum and warning thresholds for each metric:

```json
{
  "testExecutionTime": {
    "unit": { "max": 30000, "warning": 20000 }
  }
}
```

### `performance-baseline.json`

Stores baseline metrics for comparison. Updated automatically when benchmarks pass on the main branch.

## CI Integration

The performance workflow runs on:

- Push to main/develop branches
- Pull requests
- Weekly schedule (Mondays at 9 AM)

### GitHub Actions Features

- Automatic performance reports on PRs
- Threshold checking with fail-fast
- Artifact storage (30-day retention)
- Performance trend tracking

## Local Development

1. **Run a quick benchmark**:

   ```bash
   npm run test:performance
   ```

2. **Run full CI benchmark locally**:

   ```bash
   npm run test:performance:ci
   ```

3. **Generate visual dashboard**:
   ```bash
   npm run test:performance:dashboard
   open performance-dashboard/index.html
   ```

## Interpreting Results

### Test Execution Times

- **Unit tests**: Should complete in < 20s (warning) / 30s (max)
- **Integration tests**: Should complete in < 45s (warning) / 60s (max)
- **E2E tests**: Should complete in < 90s (warning) / 120s (max)

### Bundle Sizes

- **Main bundle**: Should be < 400KB (warning) / 512KB (max)
- **Total size**: Should be < 1.5MB (warning) / 2MB (max)

### Build Times

- **Frontend**: Should complete in < 45s (warning) / 60s (max)
- **Backend**: Should complete in < 20s (warning) / 30s (max)

### Memory Usage

- **Heap**: Should use < 384MB (warning) / 512MB (max)
- **RSS**: Should use < 768MB (warning) / 1GB (max)

## Troubleshooting

### High variance in results

- Close unnecessary applications
- Disable background processes
- Run benchmarks multiple times
- Use consistent hardware

### Benchmark failures

- Check validation output
- Ensure clean git working directory
- Verify all dependencies installed
- Check available system resources

### Threshold violations

- Review recent code changes
- Profile slow tests/builds
- Optimize bundle sizes
- Check for memory leaks

## Best Practices

1. **Consistent Environment**: Run benchmarks on similar hardware
2. **Multiple Runs**: Average results from multiple runs
3. **Clean State**: Start with clean build artifacts
4. **Baseline Updates**: Only update baseline from main branch
5. **Regular Monitoring**: Review dashboard weekly

## Adding New Metrics

To add a new performance metric:

1. Update `BenchmarkMetrics` interface in `performance-benchmark.ts`
2. Add measurement method to `PerformanceBenchmark` class
3. Update thresholds in `performance-thresholds.json`
4. Add visualization to dashboard
5. Update this documentation
