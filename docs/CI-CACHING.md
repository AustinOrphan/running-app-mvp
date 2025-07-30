# CI Test Caching Documentation

## Overview

The CI pipeline implements intelligent test result caching to reduce build times and resource usage. Tests are only re-run when relevant code changes are detected.

## How It Works

### Cache Key Generation

Cache keys are generated based on:

- Operating system
- Node.js version
- Dependencies (package-lock.json hash)
- Test files hash
- Source files hash

Example cache key:

```
v1-test-cache-unit-Linux-node22.16.0-a1b2c3d4-e5f6g7h8-i9j0k1l2
```

### Cache Hit Conditions

A cache hit occurs when:

1. No test files have changed
2. No source files have changed
3. Dependencies haven't changed
4. Node.js version matches
5. Previous test run passed completely
6. Cache is less than 24 hours old

### Cache Storage

Test results are cached in:

- `.test-cache/` - Local cache directory
- GitHub Actions Cache - CI environment
- Artifacts - Coverage reports

## Implementation

### 1. Reusable Workflow

`.github/workflows/cache-test-results.yml` provides:

- Automatic cache key generation
- Change detection
- Cache validation
- Result restoration

### 2. Test Cache Manager

`scripts/test-cache-manager.ts` handles:

- Cache metadata management
- Result validation
- Cache cleanup
- Statistics reporting

### 3. Optimized CI Pipeline

`.github/workflows/ci-optimized.yml` features:

- Parallel test execution
- Smart caching strategy
- Minimal redundancy
- Performance monitoring

## Usage

### Local Development

Check cache status:

```bash
npm run cache:check unit "*.test.ts"
```

View cache statistics:

```bash
npm run cache:stats
```

Clean old caches:

```bash
npm run cache:clean 7  # Clean caches older than 7 days
```

### CI Environment

The CI pipeline automatically:

1. Checks for cached results before running tests
2. Saves successful test results to cache
3. Skips tests when only documentation changes
4. Provides cache hit/miss reporting

## Cache Efficiency Metrics

### Cache Hit Rate

- **Excellent (>66%)**: Most tests use cached results
- **Good (33-66%)**: Some tests use cached results
- **Low (<33%)**: Investigate cache misses

### Time Savings

Typical time savings with cache hits:

- Unit tests: 5-10 minutes
- Integration tests: 10-15 minutes
- E2E tests: 15-20 minutes

## Best Practices

### 1. Granular Changes

Make focused commits to maximize cache hits:

- Separate test changes from source changes
- Group related changes together
- Avoid unnecessary file modifications

### 2. Cache Invalidation

Force cache refresh when needed:

- Delete `.test-cache/` directory locally
- Use `[skip cache]` in commit message
- Manually trigger workflow with cache disabled

### 3. Monitor Cache Performance

Regular monitoring helps identify:

- Frequently changing files causing cache misses
- Optimal cache retention period
- Storage usage trends

## Troubleshooting

### Cache Always Misses

Possible causes:

- Frequently changing timestamps in files
- Generated files included in cache key
- Environment differences

Solutions:

- Exclude generated files from cache key
- Use stable file hashes
- Normalize environments

### Stale Cache Issues

Symptoms:

- Tests pass in CI but fail locally
- Outdated results being used

Solutions:

- Reduce cache TTL (currently 24 hours)
- Clear caches after major changes
- Implement cache versioning

### Storage Limits

GitHub Actions cache limits:

- 10GB total cache storage
- 7 day retention
- 5GB per cache entry

Mitigation:

- Regular cleanup of old caches
- Compress large artifacts
- Use selective caching

## Configuration

### Environment Variables

- `CI_CACHE_ENABLED`: Enable/disable caching (default: true)
- `CI_CACHE_TTL`: Cache time-to-live in hours (default: 24)
- `CI_CACHE_VERSION`: Cache version for invalidation

### Workflow Inputs

```yaml
uses: ./.github/workflows/cache-test-results.yml
with:
  test-type: unit
  test-command: npm run test:unit
  cache-key-prefix: v1-test-cache
  coverage-enabled: true
```

## Performance Impact

### Before Caching

- Average CI time: 25-30 minutes
- Resource usage: High
- Redundant test execution

### After Caching

- Average CI time: 10-15 minutes (50% reduction)
- Resource usage: Optimized
- Tests run only when needed

## Future Improvements

1. **Distributed Caching**
   - Share cache across branches
   - Cross-repository cache sharing

2. **Intelligent Invalidation**
   - Dependency graph analysis
   - Impact-based test selection

3. **Cache Warming**
   - Pre-generate caches for common scenarios
   - Background cache updates

4. **Analytics Dashboard**
   - Cache hit rate trends
   - Performance metrics
   - Cost savings analysis
