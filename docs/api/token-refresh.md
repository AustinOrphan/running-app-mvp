# Token Refresh Mechanism

This document describes the token refresh mechanism implemented in the Running App MVP, which provides automatic session management and enhanced security.

## Overview

The application uses a dual-token authentication system:

- **Access Token**: Short-lived token (15 minutes) used for API authentication
- **Refresh Token**: Long-lived token (7 days) used to obtain new access tokens

This approach balances security with user experience, minimizing the risk of token compromise while avoiding frequent login prompts.

## Token Structure

### Access Token

```json
{
  "userId": "string",
  "email": "string",
  "iat": "number (issued at)",
  "exp": "number (expiration)",
  "iss": "running-app",
  "aud": "running-app-users"
}
```

### Refresh Token

```json
{
  "userId": "string",
  "tokenVersion": "number",
  "iat": "number (issued at)",
  "exp": "number (expiration)",
  "iss": "running-app",
  "aud": "running-app-refresh"
}
```

## API Endpoints

### Login

`POST /api/auth/login`

Returns both access and refresh tokens:

```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "string",
    "email": "string"
  }
}
```

### Register

`POST /api/auth/register`

Returns the same token structure as login.

### Token Refresh

`POST /api/auth/refresh`

Request:

```json
{
  "refreshToken": "eyJhbGc..."
}
```

Response:

```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "string",
    "email": "string"
  }
}
```

## Frontend Implementation

### Automatic Token Refresh

The `apiFetch` utility automatically handles token refresh on 401 errors:

```typescript
// src/utils/apiFetch.ts
if (response.status === 401 && !url.includes('/api/auth/') && attempt === 0) {
  const refreshSuccess = await refreshAccessToken();
  if (refreshSuccess) {
    // Retry the request with new token
    continue;
  }
  // If refresh failed, clear tokens and emit auth failure
}
```

### Token Storage

Tokens are stored in localStorage:

- `accessToken`: Current access token
- `refreshToken`: Current refresh token

### Authentication Events

The system uses an event-driven architecture for auth state management:

- `authenticationFailed`: Emitted when authentication fails
- `tokenRefreshed`: Emitted when tokens are successfully refreshed

### useAuth Hook Integration

```typescript
// Listen for authentication events
useEffect(() => {
  const handleAuthFailure = (event: Event) => {
    setIsLoggedIn(false);
  };

  const handleTokenRefresh = () => {
    setIsLoggedIn(true);
  };

  authEvents.addEventListener('authenticationFailed', handleAuthFailure);
  authEvents.addEventListener('tokenRefreshed', handleTokenRefresh);

  return () => {
    // Cleanup listeners
  };
}, []);
```

## Security Features

### Token Rotation

- New refresh token issued with each refresh
- Old refresh token invalidated immediately
- Prevents token replay attacks

### Race Condition Prevention

- Single refresh promise shared across concurrent requests
- Prevents multiple refresh attempts for the same expired token

### Automatic Cleanup

- Tokens cleared on logout
- Tokens cleared on refresh failure
- Legacy token migration for backward compatibility

## Error Handling

### Token Expiration

- Access token expiration: Automatic refresh attempt
- Refresh token expiration: Redirect to login
- Enhanced error messages for better UX

### Network Failures

- Refresh failures gracefully handled
- User redirected to login with appropriate message
- Original request context preserved when possible

## Integration Guide

### For API Consumers

1. **Initial Authentication**

   ```javascript
   const response = await fetch('/api/auth/login', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ email, password }),
   });

   const { accessToken, refreshToken } = await response.json();
   localStorage.setItem('accessToken', accessToken);
   localStorage.setItem('refreshToken', refreshToken);
   ```

2. **Making Authenticated Requests**

   ```javascript
   const response = await fetch('/api/runs', {
     headers: {
       Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
     },
   });
   ```

3. **Handling 401 Errors**
   ```javascript
   if (response.status === 401) {
     // Attempt refresh
     const refreshResponse = await fetch('/api/auth/refresh', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         refreshToken: localStorage.getItem('refreshToken'),
       }),
     });

     if (refreshResponse.ok) {
       // Update tokens and retry original request
       const { accessToken, refreshToken } = await refreshResponse.json();
       localStorage.setItem('accessToken', accessToken);
       localStorage.setItem('refreshToken', refreshToken);
     } else {
       // Redirect to login
       window.location.href = '/login';
     }
   }
   ```

### Using the Built-in apiFetch Utility

For the best experience, use the provided `apiFetch` utility:

```javascript
import { apiGet, apiPost } from '@/utils/apiFetch';

// Automatic token refresh handled internally
const response = await apiGet('/api/runs');
const data = await apiPost('/api/runs', { distance: 5, duration: 30 });
```

## Testing

### Integration Tests

See `tests/integration/api/auth.test.ts` for comprehensive token refresh tests.

### E2E Tests

See `tests/e2e/auth.test.ts` for user flow tests including token refresh scenarios.

## Migration from Single Token System

The system automatically migrates from the old single-token system:

- Old `authToken` detected and converted to `accessToken`
- Refresh token generated on first login after migration
- Backward compatibility maintained

## Best Practices

1. **Token Expiration Times**
   - Access Token: 15 minutes (configurable via `JWT_ACCESS_EXPIRY`)
   - Refresh Token: 7 days (configurable via `JWT_REFRESH_EXPIRY`)

2. **Error Handling**
   - Always handle refresh failures gracefully
   - Provide clear user feedback on session expiration
   - Log authentication errors for debugging

3. **Security**
   - Never expose refresh tokens in URLs or logs
   - Implement token rotation on every refresh
   - Clear all tokens on logout

4. **Performance**
   - Share refresh promises to prevent concurrent refreshes
   - Cache successful refresh results briefly
   - Minimize unnecessary refresh attempts
