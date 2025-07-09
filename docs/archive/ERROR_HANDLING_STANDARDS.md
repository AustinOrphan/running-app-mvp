# Error Handling Standards for Running App MVP

## 🚨 Critical Patterns - MUST Follow

This document outlines the mandatory error handling patterns for all Express.js route handlers in this project. Following these patterns prevents server crashes and "Cannot set headers after they are sent" errors.

## ✅ REQUIRED Pattern: Always Use `return next(error)`

### ❌ DANGEROUS - Never do this:

```typescript
catch (error) {
  next(createError('Operation failed', 500));
  // Code execution continues here - DANGEROUS!
}
```

### ✅ SAFE - Always do this:

```typescript
catch (error) {
  return next(createError('Operation failed', 500));
  // Code execution stops immediately - SAFE!
}
```

## 🛡️ Why This Matters

1. **Prevents Double Headers**: Without `return`, code execution continues after error handling, potentially causing "Cannot set headers after they are sent" errors
2. **Server Stability**: Improper error handling can crash the entire Express server
3. **Consistent Behavior**: Ensures predictable error response patterns

## 📋 Implementation Checklist

### For All Route Handlers:

- [ ] Use `return next(error)` in ALL catch blocks
- [ ] Use `return next(createError(...))` for custom errors
- [ ] Ensure no code executes after error handling
- [ ] Verify async functions are properly wrapped or use try/catch

### Pattern Examples:

#### Basic Error Handling:

```typescript
router.get('/example', async (req, res, next) => {
  try {
    const data = await someAsyncOperation();
    res.json(data);
  } catch (error) {
    console.error('Operation failed:', error);
    return next(createError('Failed to fetch data', 500));
  }
});
```

#### Validation Errors:

```typescript
router.post('/example', async (req, res, next) => {
  try {
    if (!req.body.requiredField) {
      return next(createError('Required field missing', 400));
    }

    const result = await processData(req.body);
    res.json(result);
  } catch (error) {
    console.error('Processing failed:', error);
    return next(createError('Failed to process data', 500));
  }
});
```

#### Conditional Error Handling:

```typescript
router.get('/example/:id', async (req, res, next) => {
  try {
    const item = await findItem(req.params.id);

    if (!item) {
      return next(createError('Item not found', 404));
    }

    res.json(item);
  } catch (error) {
    console.error('Failed to fetch item:', error);
    if (error.statusCode === 404) {
      return next(error);
    }
    return next(createError('Failed to fetch item', 500));
  }
});
```

## 🔧 Alternative: AsyncHandler Wrapper

For cleaner code, you can use the `asyncHandler` wrapper:

```typescript
import { asyncHandler, asyncAuthHandler } from '../middleware/asyncHandler.js';

// For regular routes
router.get(
  '/example',
  asyncHandler(async (req, res, next) => {
    const data = await someAsyncOperation();
    res.json(data);
    // Errors automatically caught and passed to next()
  })
);

// For authenticated routes
router.get(
  '/example',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res, next) => {
    const data = await someAsyncOperation();
    res.json(data);
  })
);
```

## 🧪 Testing Requirements

All route handlers MUST have tests that verify:

1. **Error Response**: Proper error status codes and messages
2. **No Double Headers**: No "Cannot set headers after they are sent" errors
3. **Server Stability**: Server remains responsive after errors
4. **Return Pattern**: Code execution stops after error handling

### Example Test:

```typescript
it('should handle database errors without double headers', async () => {
  // Mock database failure
  jest.spyOn(prisma.user, 'findMany').mockRejectedValue(new Error('DB Error'));

  const response = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${validToken}`);

  expect(response.status).toBe(500);
  expect(response.body).toHaveProperty('message');
  // Verify no double header errors occurred
});
```

## 🚫 Common Anti-Patterns to Avoid

### 1. Missing Return Statement:

```typescript
// ❌ WRONG
catch (error) {
  next(createError('Failed', 500));
  console.log('This still executes!'); // DANGEROUS
}
```

### 2. Inconsistent Error Handling:

```typescript
// ❌ WRONG - Mixed patterns
catch (error) {
  if (error.code === 'AUTH_ERROR') {
    return next(error);
  }
  next(createError('Failed', 500)); // Missing return!
}
```

### 3. Unhandled Promise Rejections:

```typescript
// ❌ WRONG - No error handling
router.get('/example', async (req, res) => {
  const data = await riskyOperation(); // Can crash server!
  res.json(data);
});
```

## 🔍 Automated Enforcement

This project includes:

1. **ESLint Rules**: Automatically detect missing return patterns
2. **Integration Tests**: Verify error handling in CI/CD
3. **Pre-commit Hooks**: Prevent dangerous patterns from being committed

## 📊 Monitoring

Key metrics to track:

- Server crash frequency
- "Cannot set headers" error occurrences
- Error response times
- Route handler error rates

## 🆘 Emergency Response

If you encounter a "Cannot set headers after they are sent" error:

1. **Immediate**: Check for missing `return` statements in catch blocks
2. **Identify**: Find the route handler causing the issue
3. **Fix**: Add `return` before all `next(error)` calls
4. **Test**: Verify fix with error scenario tests
5. **Deploy**: Push fix immediately for server stability

## 📚 Related Resources

- [Express.js Error Handling Guide](https://expressjs.com/en/guide/error-handling.html)
- [Async Error Handling Best Practices](https://strongloop.com/strongblog/async-error-handling-expressjs-es7-promises-generators/)
- [Project Testing Guidelines](./tests/README.md)

---

**Remember**: Server stability is CRITICAL. Always prioritize proper error handling over feature development.

**Last Updated**: 2025-06-28  
**Issue Reference**: #34 - Critical async error handling pattern fixes
