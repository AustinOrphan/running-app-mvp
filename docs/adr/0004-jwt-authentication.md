# 4. Use JWT for Authentication

Date: 2025-07-28

## Status

Accepted

## Context

We needed an authentication mechanism that would:
- Work well with our SPA (Single Page Application) architecture
- Support stateless authentication
- Be secure and follow industry standards
- Allow for easy scaling
- Support refresh token rotation
- Work across different clients (web, potentially mobile in future)

## Decision

We will use JSON Web Tokens (JWT) for authentication with:
- Short-lived access tokens (15 minutes)
- Long-lived refresh tokens (7 days)
- Refresh token rotation on use
- Token blacklisting for logout
- Separate token types (access/refresh) with different signing

## Consequences

### Positive
- Stateless authentication reduces server load
- Works well with REST APIs
- Easy to implement across different clients
- Industry standard with good library support
- Can include user claims in the token
- Supports horizontal scaling without shared session state

### Negative
- Cannot revoke access tokens before expiry (mitigated by short lifetime)
- Token size larger than session ID
- Must handle token refresh logic on client
- Requires secure token storage on client
- Token blacklisting partially defeats stateless benefits

## Implementation Details

```typescript
// Token generation
const accessToken = jwt.sign(
  { id: user.id, email: user.email, type: 'access' },
  process.env.JWT_SECRET,
  { expiresIn: '15m' }
);

const refreshToken = jwt.sign(
  { id: user.id, type: 'refresh' },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: '7d' }
);

// Middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  // Verify and check blacklist
};
```

### Security Measures
1. Different secrets for access and refresh tokens
2. Token blacklisting for immediate revocation
3. Refresh token rotation prevents reuse
4. Short access token lifetime limits exposure
5. HTTPS required in production

## Alternatives Considered

1. **Session-based authentication**:
   - Pros: Can revoke immediately, smaller request size
   - Cons: Requires session storage, harder to scale
   - Rejected due to stateless architecture preference

2. **OAuth 2.0 with external provider**:
   - Pros: No password management, industry standard
   - Cons: Complex setup, dependency on external service
   - Rejected for MVP simplicity (can add later)

3. **API Keys**:
   - Pros: Simple, stateless
   - Cons: No expiration, less secure, harder to manage
   - Rejected due to security concerns

4. **Passport.js with sessions**:
   - Pros: Flexible, many strategies
   - Cons: Adds complexity, session management needed
   - Rejected in favor of simpler JWT approach

5. **AWS Cognito / Auth0**:
   - Pros: Managed service, many features
   - Cons: Vendor lock-in, cost, complexity
   - Rejected for MVP (consider for future)

## Security Considerations

1. Store tokens securely (httpOnly cookies or secure localStorage)
2. Implement proper CORS policies
3. Use HTTPS in production
4. Implement rate limiting on auth endpoints
5. Monitor for suspicious token usage patterns

## Future Considerations

- Implement JWT encryption (JWE) for sensitive claims
- Add multi-factor authentication
- Consider migrating to OAuth 2.0 for third-party integrations
- Implement device tracking and management

## References

- [JWT.io](https://jwt.io/)
- [OWASP JWT Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [RFC 7519 - JSON Web Token](https://tools.ietf.org/html/rfc7519)