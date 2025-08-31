# GitHub Actions Scripts

This directory contains external JavaScript scripts extracted from GitHub Actions workflows to resolve YAML syntax issues and improve maintainability.

## Scripts

### coverage-trend-calculator.js

Extracted from `coverage-trend-tracking.yml` workflow. Handles complex coverage analysis and GitHub issue creation logic.

### performance-monitor.js

Extracted from `test-performance-monitoring.yml` workflow. Manages performance metrics collection and alert generation.

## Usage

These scripts are called by GitHub Actions workflows using:

```yaml
- name: Run Coverage Analysis
  run: node .github/scripts/coverage-trend-calculator.js
```

## Environment Variables

Scripts expect the same environment variables that were available in the original inline JavaScript:

- GitHub context variables (`${{ github.* }}`)
- Workflow inputs and outputs
- Repository secrets and environment variables

## Development

When modifying these scripts:

1. Test locally when possible
2. Ensure all environment variables are properly handled
3. Add appropriate error handling and logging
4. Update corresponding workflow files if interface changes
