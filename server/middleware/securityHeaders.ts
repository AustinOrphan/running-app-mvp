import { Request, Response, NextFunction } from 'express';

/**
 * Enhanced Security Headers Middleware
 * Implements comprehensive security headers for web application protection
 */

export interface SecurityHeadersConfig {
  csp?: {
    enabled: boolean;
    directives?: Record<string, string[]>;
    reportOnly?: boolean;
    reportUri?: string;
  };
  hsts?: {
    enabled: boolean;
    maxAge?: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  frameOptions?: 'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM';
  contentTypeOptions?: boolean;
  xssProtection?: boolean;
  referrerPolicy?: string;
  permissionsPolicy?: Record<string, string[]>;
  crossOriginPolicies?: {
    embedderPolicy?: 'unsafe-none' | 'require-corp';
    openerPolicy?: 'unsafe-none' | 'same-origin-allow-popups' | 'same-origin';
    resourcePolicy?: 'same-site' | 'same-origin' | 'cross-origin';
  };
}

/**
 * Get security headers configuration from environment variables
 */
const getSecurityHeadersConfig = (): SecurityHeadersConfig => {
  return {
    csp: {
      enabled: process.env.CSP_ENABLED !== 'false',
      reportOnly: process.env.CSP_REPORT_ONLY === 'true',
      reportUri: process.env.CSP_REPORT_URI,
      directives: {
        'default-src': (process.env.CSP_DEFAULT_SRC || "'self'").split(','),
        'script-src': (process.env.CSP_SCRIPT_SRC || "'self' 'unsafe-inline'").split(','),
        'style-src': (process.env.CSP_STYLE_SRC || "'self' 'unsafe-inline'").split(','),
        'img-src': (process.env.CSP_IMG_SRC || "'self' data: https:").split(','),
        'connect-src': (process.env.CSP_CONNECT_SRC || "'self'").split(','),
        'font-src': (process.env.CSP_FONT_SRC || "'self'").split(','),
        'object-src': (process.env.CSP_OBJECT_SRC || "'none'").split(','),
        'media-src': (process.env.CSP_MEDIA_SRC || "'self'").split(','),
        'frame-src': (process.env.CSP_FRAME_SRC || "'none'").split(','),
        'frame-ancestors': (process.env.CSP_FRAME_ANCESTORS || "'none'").split(','),
        'base-uri': (process.env.CSP_BASE_URI || "'self'").split(','),
        'form-action': (process.env.CSP_FORM_ACTION || "'self'").split(','),
      },
    },
    hsts: {
      enabled: process.env.HSTS_ENABLED !== 'false',
      maxAge: parseInt(process.env.HSTS_MAX_AGE || '31536000', 10),
      includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false',
      preload: process.env.HSTS_PRELOAD !== 'false',
    },
    frameOptions: (process.env.X_FRAME_OPTIONS as 'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM') || 'DENY',
    contentTypeOptions: process.env.X_CONTENT_TYPE_OPTIONS !== 'false',
    xssProtection: process.env.X_XSS_PROTECTION !== 'false',
    referrerPolicy: process.env.REFERRER_POLICY || 'strict-origin-when-cross-origin',
    permissionsPolicy: {
      camera: (process.env.PERMISSIONS_POLICY_CAMERA || '()').split(','),
      microphone: (process.env.PERMISSIONS_POLICY_MICROPHONE || '()').split(','),
      geolocation: (process.env.PERMISSIONS_POLICY_GEOLOCATION || '()').split(','),
      'interest-cohort': (process.env.PERMISSIONS_POLICY_INTEREST_COHORT || '()').split(','),
    },
    crossOriginPolicies: {
      embedderPolicy:
        (process.env.CROSS_ORIGIN_EMBEDDER_POLICY as 'unsafe-none' | 'require-corp') ||
        'require-corp',
      openerPolicy:
        (process.env.CROSS_ORIGIN_OPENER_POLICY as
          | 'unsafe-none'
          | 'same-origin-allow-popups'
          | 'same-origin') || 'same-origin',
      resourcePolicy:
        (process.env.CROSS_ORIGIN_RESOURCE_POLICY as
          | 'same-site'
          | 'same-origin'
          | 'cross-origin') || 'same-origin',
    },
  };
};

/**
 * Build Content Security Policy header value
 */
const buildCSPHeader = (cspConfig: SecurityHeadersConfig['csp']): string => {
  if (!cspConfig?.enabled || !cspConfig.directives) {
    return '';
  }

  const directives = Object.entries(cspConfig.directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');

  // Add upgrade-insecure-requests if HTTPS is enabled
  const httpsEnabled = process.env.SSL_ENABLED === 'true' || process.env.FORCE_HTTPS === 'true';
  const upgradeDirective = httpsEnabled ? '; upgrade-insecure-requests' : '';

  // Add report-uri if configured
  const reportUri = cspConfig.reportUri ? `; report-uri ${cspConfig.reportUri}` : '';

  return directives + upgradeDirective + reportUri;
};

/**
 * Build HSTS header value
 */
const buildHSTSHeader = (hstsConfig: SecurityHeadersConfig['hsts']): string => {
  if (!hstsConfig?.enabled) {
    return '';
  }

  let header = `max-age=${hstsConfig.maxAge || 31536000}`;

  if (hstsConfig.includeSubDomains) {
    header += '; includeSubDomains';
  }

  if (hstsConfig.preload) {
    header += '; preload';
  }

  return header;
};

/**
 * Build Permissions Policy header value
 */
const buildPermissionsPolicyHeader = (
  permissionsConfig: SecurityHeadersConfig['permissionsPolicy']
): string => {
  if (!permissionsConfig) {
    return '';
  }

  return Object.entries(permissionsConfig)
    .map(([directive, values]) => `${directive}=(${values.join(' ')})`)
    .join(', ');
};

/**
 * Enhanced security headers middleware
 */
export const enhancedSecurityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  const config = getSecurityHeadersConfig();
  const isHTTPS = req.secure || req.headers['x-forwarded-proto'] === 'https';

  // Content Security Policy
  if (config.csp?.enabled) {
    const cspValue = buildCSPHeader(config.csp);
    const cspHeader = config.csp.reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy';

    if (cspValue) {
      res.setHeader(cspHeader, cspValue);
    }
  }

  // HTTP Strict Transport Security (only for HTTPS)
  if (isHTTPS && config.hsts?.enabled) {
    const hstsValue = buildHSTSHeader(config.hsts);
    if (hstsValue) {
      res.setHeader('Strict-Transport-Security', hstsValue);
    }
  }

  // X-Frame-Options
  if (config.frameOptions) {
    res.setHeader('X-Frame-Options', config.frameOptions);
  }

  // X-Content-Type-Options
  if (config.contentTypeOptions) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  // X-XSS-Protection (legacy but still useful for older browsers)
  if (config.xssProtection) {
    res.setHeader('X-XSS-Protection', '1; mode=block');
  }

  // Referrer Policy
  if (config.referrerPolicy) {
    res.setHeader('Referrer-Policy', config.referrerPolicy);
  }

  // Permissions Policy
  if (config.permissionsPolicy) {
    const permissionsPolicyValue = buildPermissionsPolicyHeader(config.permissionsPolicy);
    if (permissionsPolicyValue) {
      res.setHeader('Permissions-Policy', permissionsPolicyValue);
    }
  }

  // Cross-Origin Policies
  if (config.crossOriginPolicies?.embedderPolicy) {
    res.setHeader('Cross-Origin-Embedder-Policy', config.crossOriginPolicies.embedderPolicy);
  }

  if (config.crossOriginPolicies?.openerPolicy) {
    res.setHeader('Cross-Origin-Opener-Policy', config.crossOriginPolicies.openerPolicy);
  }

  if (config.crossOriginPolicies?.resourcePolicy) {
    res.setHeader('Cross-Origin-Resource-Policy', config.crossOriginPolicies.resourcePolicy);
  }

  // Additional security headers
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // Remove server information
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  // Cache control for security-sensitive resources
  if (req.path.includes('/api/auth') || req.path.includes('/admin')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }

  next();
};

/**
 * Security headers for specific endpoints
 */
export const apiSecurityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  // API-specific headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  // Ensure JSON responses have correct content type
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }

  next();
};

/**
 * Security headers for static assets
 */
export const staticAssetSecurityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Allow caching for static assets but with security considerations
  const isStaticAsset = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/i.test(req.path);

  if (isStaticAsset) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  next();
};

/**
 * Development security headers (less restrictive)
 */
export const developmentSecurityHeaders = (
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (process.env.NODE_ENV !== 'development') {
    return next();
  }

  // More permissive CSP for development
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data:; " +
      "connect-src 'self' ws: wss: http: https:; " +
      "img-src 'self' data: blob: https:;"
  );

  next();
};

/**
 * Security headers health check
 */
export const checkSecurityHeaders = (
  req: Request
): { score: number; missing: string[]; recommendations: string[] } => {
  const headers = req.headers;
  const score = { current: 0, total: 0 };
  const missing: string[] = [];
  const recommendations: string[] = [];

  const securityHeaders = [
    'content-security-policy',
    'strict-transport-security',
    'x-frame-options',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ];

  securityHeaders.forEach(header => {
    score.total += 1;
    if (headers[header]) {
      score.current += 1;
    } else {
      missing.push(header);
    }
  });

  // Recommendations based on missing headers
  if (missing.includes('content-security-policy')) {
    recommendations.push('Implement Content Security Policy to prevent XSS attacks');
  }

  if (missing.includes('strict-transport-security')) {
    recommendations.push('Enable HSTS to prevent protocol downgrade attacks');
  }

  if (missing.includes('x-frame-options')) {
    recommendations.push('Set X-Frame-Options to prevent clickjacking');
  }

  return {
    score: Math.round((score.current / score.total) * 100),
    missing,
    recommendations,
  };
};
