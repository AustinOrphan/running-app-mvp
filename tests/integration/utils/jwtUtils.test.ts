import jwt from 'jsonwebtoken';
import {
  generateTokens,
  validateToken,
  extractTokenFromHeader,
  blacklistToken,
  isTokenBlacklisted
} from '../../../server/utils/jwtUtils.js';

// Set JWT secret for tests
process.env.JWT_SECRET = 'test-secret-key';

describe('JWT Utilities', () => {
  const mockUser = {
    id: 'user123',
    email: 'test@example.com'
  };
  
  beforeEach(() => {
    // Clear blacklist by waiting a bit (since we can't directly clear it)
    jest.clearAllMocks();
  });
  
  describe('generateTokens', () => {
    test('generates valid access and refresh tokens', () => {
      const { accessToken, refreshToken } = generateTokens(mockUser);
      
      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();
      expect(typeof accessToken).toBe('string');
      expect(typeof refreshToken).toBe('string');
      
      // Verify access token structure
      const decodedAccess = jwt.verify(accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
      expect(decodedAccess.id).toBe(mockUser.id);
      expect(decodedAccess.email).toBe(mockUser.email);
      expect(decodedAccess.type).toBe('access');
      expect(decodedAccess.jti).toBeDefined();
      expect(decodedAccess.iat).toBeDefined();
      expect(decodedAccess.exp).toBeDefined();
      expect(decodedAccess.iss).toBe('running-app');
      expect(decodedAccess.aud).toBe('running-app-users');
      
      // Verify refresh token structure
      const decodedRefresh = jwt.verify(refreshToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
      expect(decodedRefresh.id).toBe(mockUser.id);
      expect(decodedRefresh.type).toBe('refresh');
      expect(decodedRefresh.jti).toBeDefined();
      expect(decodedRefresh.email).toBeUndefined(); // Refresh token should not contain email
    });
    
    test('each token has unique jti', () => {
      const { accessToken: token1Access, refreshToken: token1Refresh } = generateTokens(mockUser);
      const { accessToken: token2Access, refreshToken: token2Refresh } = generateTokens(mockUser);
      
      const decoded1Access = jwt.verify(token1Access, process.env.JWT_SECRET!) as jwt.JwtPayload;
      const decoded2Access = jwt.verify(token2Access, process.env.JWT_SECRET!) as jwt.JwtPayload;
      const decoded1Refresh = jwt.verify(token1Refresh, process.env.JWT_SECRET!) as jwt.JwtPayload;
      const decoded2Refresh = jwt.verify(token2Refresh, process.env.JWT_SECRET!) as jwt.JwtPayload;
      
      expect(decoded1Access.jti).not.toBe(decoded2Access.jti);
      expect(decoded1Refresh.jti).not.toBe(decoded2Refresh.jti);
      expect(decoded1Access.jti).not.toBe(decoded1Refresh.jti);
    });
    
    test('throws error when JWT_SECRET is not set', () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      
      expect(() => {
        generateTokens(mockUser);
      }).toThrow('JWT secret not configured');
      
      process.env.JWT_SECRET = originalSecret;
    });
  });
  
  describe('validateToken', () => {
    test('validates a valid access token', () => {
      const { accessToken } = generateTokens(mockUser);
      const decoded = validateToken(accessToken, 'access');
      
      expect(decoded).toBeDefined();
      expect(decoded.id).toBe(mockUser.id);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.type).toBe('access');
    });
    
    test('validates a valid refresh token', () => {
      const { refreshToken } = generateTokens(mockUser);
      const decoded = validateToken(refreshToken, 'refresh');
      
      expect(decoded).toBeDefined();
      expect(decoded.id).toBe(mockUser.id);
      expect(decoded.type).toBe('refresh');
    });
    
    test('throws error for wrong token type', () => {
      const { accessToken, refreshToken } = generateTokens(mockUser);
      
      expect(() => {
        validateToken(accessToken, 'refresh');
      }).toThrow('Invalid token type');
      
      expect(() => {
        validateToken(refreshToken, 'access');
      }).toThrow('Invalid token type');
    });
    
    test('throws error for invalid token', () => {
      const invalidToken = 'invalid.token.here';
      
      expect(() => {
        validateToken(invalidToken);
      }).toThrow('Invalid token');
    });
    
    test('throws error for expired token', () => {
      // Create token with short expiry
      const expiredToken = jwt.sign(
        { id: mockUser.id, email: mockUser.email, type: 'access' },
        process.env.JWT_SECRET!,
        { expiresIn: '-1s', issuer: 'running-app', audience: 'running-app-users' }
      );
      
      expect(() => {
        validateToken(expiredToken);
      }).toThrow('Token has expired');
    });
    
    test('throws error when JWT_SECRET is not set', () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      
      const token = 'some.token.here';
      expect(() => {
        validateToken(token);
      }).toThrow('JWT secret not configured');
      
      process.env.JWT_SECRET = originalSecret;
    });
    
    test('throws error for blacklisted token', () => {
      const { accessToken } = generateTokens(mockUser);
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
      
      // Blacklist the token
      blacklistToken(decoded.jti!, decoded.exp!);
      
      expect(() => {
        validateToken(accessToken);
      }).toThrow('Token has been revoked');
    });
  });
  
  describe('extractTokenFromHeader', () => {
    test('extracts token from Bearer header', () => {
      const authHeader = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token';
      const token = extractTokenFromHeader(authHeader);
      
      expect(token).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token');
    });
    
    test('returns null for missing header', () => {
      const token = extractTokenFromHeader(undefined);
      expect(token).toBeNull();
    });
    
    test('returns null for empty header', () => {
      const token = extractTokenFromHeader('');
      expect(token).toBeNull();
    });
    
    test('returns null for non-Bearer header', () => {
      const token = extractTokenFromHeader('Basic dXNlcjpwYXNz');
      expect(token).toBeNull();
    });
    
    test('returns null for malformed Bearer header', () => {
      const token = extractTokenFromHeader('Bearer');
      expect(token).toBeNull();
    });
  });
  
  describe('Token Blacklist', () => {
    describe('blacklistToken', () => {
      test('adds token to blacklist', () => {
        const jti = 'test-jti-123';
        const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
        
        blacklistToken(jti, expiresAt);
        
        expect(isTokenBlacklisted(jti)).toBe(true);
      });
      
      test('blacklisted token is automatically removed after expiration', (done) => {
        jest.useRealTimers();
        const jti = 'test-jti-expire';
        const expiresAt = Math.floor(Date.now() / 1000) + 1; // 1 second from now
        
        blacklistToken(jti, expiresAt);
        expect(isTokenBlacklisted(jti)).toBe(true);
        
        // Wait for token to expire
        setTimeout(() => {
          expect(isTokenBlacklisted(jti)).toBe(false);
          done();
        }, 1500);
      }, 10000);
    });
    
    describe('isTokenBlacklisted', () => {
      test('returns false for non-blacklisted token', () => {
        const jti = 'non-blacklisted-jti';
        expect(isTokenBlacklisted(jti)).toBe(false);
      });
      
      test('returns true for blacklisted token', () => {
        const jti = 'blacklisted-jti';
        const expiry = Math.floor(Date.now() / 1000) + 3600;
        
        blacklistToken(jti, expiry);
        expect(isTokenBlacklisted(jti)).toBe(true);
      });
    });
  });
  
  describe('Edge cases', () => {
    test('validates token with wrong secret fails', () => {
      const customSecret = 'custom-secret';
      const token = jwt.sign(
        { id: mockUser.id, email: mockUser.email, type: 'access' },
        customSecret,
        { expiresIn: '15m', issuer: 'running-app', audience: 'running-app-users' }
      );
      
      // Should fail with wrong secret
      expect(() => {
        validateToken(token);
      }).toThrow('Invalid token');
    });
    
    test('validates token with wrong issuer fails', () => {
      const token = jwt.sign(
        { id: mockUser.id, email: mockUser.email, type: 'access' },
        process.env.JWT_SECRET!,
        { expiresIn: '15m', issuer: 'wrong-issuer', audience: 'running-app-users' }
      );
      
      expect(() => {
        validateToken(token);
      }).toThrow('Invalid token');
    });
    
    test('validates token with wrong audience fails', () => {
      const token = jwt.sign(
        { id: mockUser.id, email: mockUser.email, type: 'access' },
        process.env.JWT_SECRET!,
        { expiresIn: '15m', issuer: 'running-app', audience: 'wrong-audience' }
      );
      
      expect(() => {
        validateToken(token);
      }).toThrow('Invalid token');
    });
  });
});