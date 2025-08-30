# Playwright Sharding Configuration

## Overview

Playwright sharding allows distributing E2E tests across multiple parallel processes, reducing overall test execution time.

## Configuration

### Environment Variables

- `PLAYWRIGHT_SHARD`: Shard specification in format "current/total" (e.g., "1/2", "2/3")
- `CI`: Set to "true" to enable CI-optimized settings

### Usage Examples

#### Local Testing with Shards

```bash
# Run shard 1 of 2
PLAYWRIGHT_SHARD=1/2 npm run test:e2e

# Run shard 2 of 2
PLAYWRIGHT_SHARD=2/2 npm run test:e2e
```

#### CI/CD Integration

```yaml
# GitHub Actions example
strategy:
  matrix:
    shard: [1/3, 2/3, 3/3]
env:
  PLAYWRIGHT_SHARD: ${{ matrix.shard }}
run: npm run test:e2e
```

#### Browser-Specific Sharding

```bash
# Shard chromium tests only
PLAYWRIGHT_SHARD=1/2 npm run test:e2e -- --project chromium
```

## Configuration Details

### Workers per Shard

- CI with sharding: 2 workers per shard
- CI without sharding: 1 worker
- Local: Default worker count (usually CPU cores / 2)

### Test Distribution

Tests are automatically distributed across shards based on:

- File-level distribution
- Estimated execution time
- Test dependencies

## Performance Benefits

Typical improvements with sharding:

- 2 shards: 40-60% faster execution
- 3 shards: 50-70% faster execution
- 4+ shards: Diminishing returns due to overhead

## Best Practices

1. **Optimal Shard Count**: Start with 2-3 shards, measure performance
2. **CI Resource Limits**: Consider available CPU/memory in CI environment
3. **Test Isolation**: Ensure tests don't have cross-dependencies
4. **Flaky Test Handling**: Use retries for unreliable tests

## Troubleshooting

### Common Issues

- **Uneven distribution**: Some shards finish much faster than others
- **Resource contention**: Too many workers causing instability
- **Test dependencies**: Tests failing when run in isolation

### Solutions

- Adjust shard count based on test suite size
- Monitor CI resource usage
- Ensure proper test isolation
- Use test annotations for ordering when necessary

## Monitoring

Track these metrics:

- Total execution time per shard
- Test distribution across shards
- Failure rates by shard
- Resource utilization
