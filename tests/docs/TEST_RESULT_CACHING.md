# Test Result Caching

## Overview

Test result caching dramatically reduces CI pipeline execution time by storing and reusing test results when the relevant code hasn't changed. This implementation provides intelligent caching for unit, integration, and E2E tests.

## How It Works

### Cache Key Generation

Cache keys are generated based on:

- **Content hashes** of relevant files for each test type
- **Configuration files** that affect test execution
- **Cache version** for controlled invalidation

```typescript
// Example cache key structure
unit-tests-v1-{file-hash}-{config-hash}
integration-tests-v1-{file-hash}-{config-hash}
e2e-tests-v1-{file-hash}-{config-hash}
```

### File Tracking by Test Type

| Test Type   | Tracked Directories                | Config Files                                      |
| ----------- | ---------------------------------- | ------------------------------------------------- |
| Unit        | `src/`, `tests/unit/`              | `package.json`, `vite.config.ts`, `tsconfig.json` |
| Integration | `server/`, `tests/integration/`    | `package.json`, `jest.config.js`, `tsconfig.json` |
| E2E         | `tests/e2e/`, UI changes in `src/` | `package.json`, `playwright.config.ts`            |

### Smart Test Skipping

The caching system includes intelligent test skipping:

- **Unit tests** are skipped if no changes are detected in `src/` or `tests/unit/`
- **Integration tests** are skipped if no changes in `server/` or `tests/integration/`
- **E2E tests** are skipped if no UI or E2E test changes

## Configuration

### GitHub Actions Integration

Add the test caching workflow to your repository:

```yaml
# .github/workflows/test-caching.yml
name: 🚀 Test Result Caching
on:
  pull_request:
    paths: ['src/**', 'tests/**', 'server/**', 'package*.json', '*.config.*']

jobs:
  cache-keys:
    name: 🔑 Generate Cache Keys
    # ... (generates cache keys based on file changes)

  unit-tests:
    name: 🧪 Unit Tests
    if: needs.cache-keys.outputs.should-skip-unit == 'false'
    # ... (runs only if cache miss or changes detected)
```

### Environment Variables

```bash
# Cache versioning
CACHE_VERSION=v1
TEST_RESULTS_CACHE_VERSION=v1

# Control cache behavior
FORCE_CACHE_MISS=true  # Skip cache lookup
CACHE_DEBUG=true       # Enable cache debugging
```

## Cache Management

### CLI Commands

```bash
# Check cache status
npm run cache:status

# Clear all caches
npm run cache:clear

# Clear specific cache
npm run cache:clear:unit
npm run cache:clear:integration
npm run cache:clear:e2e

# Monitor performance
npm run cache:monitor
```

### Cache Status Example

```
📊 Checking cache status...

### UNIT Tests
Cache Key: unit-tests-v1-a1b2c3d4-e5f6g7h8
- .test-results/unit: 2.5 MB
- coverage: 8.1 MB
Last cached: 12/26/2024, 2:30:45 PM
Total size: 10.6 MB

### INTEGRATION Tests
Cache Key: integration-tests-v1-i9j0k1l2-m3n4o5p6
- .test-results/integration: 1.8 MB
- coverage-integration: 3.2 MB
Last cached: 12/26/2024, 2:28:12 PM
Total size: 5.0 MB
```

## Performance Benefits

### Typical Time Savings

| Test Suite                | Normal Runtime | Cached Runtime | Time Saved |
| ------------------------- | -------------- | -------------- | ---------- |
| Unit Tests                | 2-3 minutes    | 10-15 seconds  | ~85%       |
| Integration Tests         | 3-4 minutes    | 15-20 seconds  | ~90%       |
| E2E Tests (deterministic) | 5-8 minutes    | 20-30 seconds  | ~85%       |

### Cache Hit Rate Monitoring

The system automatically tracks:

- Cache hit/miss rates per test suite
- Time savings per cached run
- Cache size and cleanup recommendations

## Cache Invalidation Rules

### Automatic Invalidation

Caches are invalidated when:

1. **Source files change** for the relevant test type
2. **Configuration files change** (package.json, config files)
3. **Dependencies change** (package-lock.json updates)
4. **Cache version is incremented** manually

### Manual Invalidation

```bash
# When major changes affect all tests
npm run cache:clear

# When specific test infrastructure changes
npm run cache:clear:integration

# After updating test frameworks or major refactoring
CACHE_VERSION=v2 # Update in workflow file
```

### Invalidation Triggers

| Change Type             | Affected Caches | Reason                                 |
| ----------------------- | --------------- | -------------------------------------- |
| `src/**` changes        | Unit, E2E       | Source code affects these test types   |
| `server/**` changes     | Integration     | Server code affects API tests          |
| `tests/unit/**` changes | Unit            | Test changes require re-execution      |
| `package.json` changes  | All             | Dependencies affect all test execution |
| Config file changes     | Relevant        | Test configuration changes             |

## Best Practices

### 1. Cache Key Strategy

- **Semantic versioning**: Increment `CACHE_VERSION` for major changes
- **Granular invalidation**: Different keys for different test types
- **Include config hashes**: Ensure configuration changes invalidate caches

### 2. Deterministic Tests Only

Cache only deterministic tests:

```typescript
// Mark deterministic tests for caching
test.describe('User Authentication @deterministic', () => {
  // Tests that don't depend on current time, external APIs, etc.
});

// Keep time-dependent tests uncached
test.describe('Real-time Features', () => {
  // Always run these tests
});
```

### 3. Cache Size Management

- **Monitor cache sizes**: Keep individual caches under 50MB
- **Regular cleanup**: Set up automated cache cleanup
- **Retention policies**: Delete caches older than 30 days

### 4. CI/CD Integration

```yaml
# Example cache cleanup job
cleanup-old-caches:
  if: github.event_name == 'schedule'
  run: |
    # Delete caches older than 30 days
    gh api repos/${{ github.repository }}/actions/caches \
      --jq '.actions_caches[] | select(.created_at < (now - 2592000)) | .id' \
      | xargs -I {} gh api -X DELETE repos/${{ github.repository }}/actions/caches/{}
```

## Monitoring and Metrics

### Performance Dashboard

The caching system provides metrics for:

```json
{
  "totalRuns": 150,
  "cacheHits": 105,
  "cacheMisses": 45,
  "hitRate": 0.7,
  "avgTimeSaved": 180,
  "totalTimeSaved": 18900
}
```

### PR Comments

Automatic PR comments show cache performance:

```
### 🚀 Test Caching Report

- 🧪 Unit Tests: **Cached** ✅
- 🔗 Integration Tests: **Skipped** (no changes detected)

⏱️ **Estimated time saved: ~5 minutes**
```

## Troubleshooting

### Common Issues

1. **Cache always misses**
   - Check if file paths in cache key generation are correct
   - Verify files exist and are readable
   - Check for permission issues

2. **Stale cache results**
   - Increment `TEST_RESULTS_CACHE_VERSION`
   - Check if all relevant files are included in hash generation

3. **Large cache sizes**
   - Review what's included in cached paths
   - Exclude unnecessary files (logs, temporary files)
   - Implement cache cleanup

### Debug Mode

Enable detailed caching logs:

```bash
CACHE_DEBUG=true npm run test:unit
```

### Cache Validation

Validate cache integrity:

```bash
npm run cache:status
npm run cache:monitor
```

## Migration Guide

### From No Caching

1. **Add workflow file**: Copy `.github/workflows/test-caching.yml`
2. **Update package.json**: Add cache management scripts
3. **Test locally**: Run `npm run cache:status` to verify setup
4. **Monitor performance**: Check cache hit rates in first few PRs

### Version Updates

When updating cache versions:

```bash
# 1. Update version in workflow
sed -i 's/TEST_RESULTS_CACHE_VERSION: v1/TEST_RESULTS_CACHE_VERSION: v2/' .github/workflows/test-caching.yml

# 2. Clear local caches
npm run cache:clear

# 3. Test new version
npm run cache:status
```

## Security Considerations

- **No sensitive data**: Caches should never contain secrets or API keys
- **Isolated environments**: Cached results from different branches/environments should not mix
- **Access control**: Ensure cache access follows repository permission model
- **Audit trail**: Track cache usage and invalidation events
