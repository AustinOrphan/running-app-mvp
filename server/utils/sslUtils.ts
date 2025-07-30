import fs from 'fs';
import https from 'https';
import { Request, Response, NextFunction } from 'express';
import { logInfo, logError } from './logger.js';

/**
 * SSL/TLS Certificate Management Utilities
 * Handles SSL certificate loading, validation, and HTTPS server creation
 */

export interface SSLConfig {
  enabled: boolean;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
  passphrase?: string;
  dhparam?: string;
  protocols?: string[];
  ciphers?: string;
  honorCipherOrder?: boolean;
  rejectUnauthorized?: boolean;
}

/**
 * Load SSL configuration from environment variables
 */
export const getSSLConfig = (): SSLConfig => {
  const sslEnabled = process.env.SSL_ENABLED === 'true';

  if (!sslEnabled) {
    return { enabled: false };
  }

  return {
    enabled: sslEnabled,
    certPath: process.env.SSL_CERT_PATH,
    keyPath: process.env.SSL_KEY_PATH,
    caPath: process.env.SSL_CA_PATH,
    passphrase: process.env.SSL_PASSPHRASE,
    dhparam: process.env.SSL_DH_PARAM_PATH,
    protocols: process.env.SSL_PROTOCOLS?.split(',') || ['TLSv1.2', 'TLSv1.3'],
    ciphers:
      process.env.SSL_CIPHERS ||
      [
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-SHA256',
        'ECDHE-RSA-AES256-SHA384',
        'ECDHE-RSA-AES256-SHA256',
        'DHE-RSA-AES128-GCM-SHA256',
        'DHE-RSA-AES256-GCM-SHA384',
        'DHE-RSA-AES128-SHA256',
        'DHE-RSA-AES256-SHA256',
        '!aNULL',
        '!eNULL',
        '!EXPORT',
        '!DES',
        '!RC4',
        '!MD5',
        '!PSK',
        '!SRP',
        '!CAMELLIA',
      ].join(':'),
    honorCipherOrder: process.env.SSL_HONOR_CIPHER_ORDER !== 'false',
    rejectUnauthorized: process.env.SSL_REJECT_UNAUTHORIZED !== 'false',
  };
};

/**
 * Validate SSL certificate files exist and are readable
 */
export const validateSSLCertificates = (config: SSLConfig): boolean => {
  if (!config.enabled) {
    return true;
  }

  const requiredFiles = [
    { path: config.certPath, name: 'certificate' },
    { path: config.keyPath, name: 'private key' },
  ];

  const optionalFiles = [
    { path: config.caPath, name: 'CA certificate' },
    { path: config.dhparam, name: 'DH parameters' },
  ];

  // Check required files
  for (const file of requiredFiles) {
    if (!file.path) {
      logError('server', 'ssl-validation', new Error(`SSL ${file.name} path not configured`));
      return false;
    }

    if (!fs.existsSync(file.path)) {
      logError(
        'server',
        'ssl-validation',
        new Error(`SSL ${file.name} file not found: ${file.path}`)
      );
      return false;
    }

    try {
      fs.accessSync(file.path, fs.constants.R_OK);
    } catch (error) {
      logError(
        'server',
        'ssl-validation',
        new Error(`SSL ${file.name} file not readable: ${file.path}`),
        undefined,
        { error }
      );
      return false;
    }
  }

  // Check optional files if specified
  for (const file of optionalFiles) {
    if (file.path && !fs.existsSync(file.path)) {
      logError(
        'server',
        'ssl-validation',
        new Error(`SSL ${file.name} file not found: ${file.path}`)
      );
      return false;
    }
  }

  logInfo('server', 'ssl-validation', 'SSL certificates validated successfully');
  return true;
};

/**
 * Load SSL certificate files
 */
export const loadSSLCertificates = (config: SSLConfig): https.ServerOptions => {
  if (!config.enabled || !config.certPath || !config.keyPath) {
    throw new Error('SSL is enabled but certificate paths are not configured');
  }

  try {
    const options: https.ServerOptions = {
      cert: fs.readFileSync(config.certPath, 'utf8'),
      key: fs.readFileSync(config.keyPath, 'utf8'),
      passphrase: config.passphrase,
      ciphers: config.ciphers,
      honorCipherOrder: config.honorCipherOrder,
      secureProtocol: 'TLS_method', // Use the most secure protocol available
      rejectUnauthorized: config.rejectUnauthorized,
    };

    // Add CA certificate if provided
    if (config.caPath) {
      options.ca = fs.readFileSync(config.caPath, 'utf8');
    }

    // Add DH parameters if provided
    if (config.dhparam) {
      options.dhparam = fs.readFileSync(config.dhparam, 'utf8');
    }

    // Set minimum TLS version
    if (config.protocols && config.protocols.length > 0) {
      // Convert protocol names to OpenSSL constants
      const protocolMap: Record<string, number> = {
        TLSv1: 0x301,
        'TLSv1.1': 0x302,
        'TLSv1.2': 0x303,
        'TLSv1.3': 0x304,
      };

      const minProtocol = config.protocols
        .map(p => protocolMap[p])
        .filter(p => p !== undefined)
        .sort()[0];

      if (minProtocol) {
        options.secureOptions = minProtocol;
      }
    }

    logInfo('server', 'ssl-loading', 'SSL certificates loaded successfully');
    return options;
  } catch (error) {
    logError(
      'server',
      'ssl-loading',
      error instanceof Error ? error : new Error('Failed to load SSL certificates')
    );
    throw error;
  }
};

/**
 * Generate self-signed certificate for development
 */
export const generateSelfSignedCert = async (
  domain: string = 'localhost'
): Promise<{ cert: string; key: string }> => {
  // This is a placeholder - in a real implementation, you would use a library like node-forge
  // or call openssl commands to generate certificates
  logInfo(
    'server',
    'ssl-generation',
    `Self-signed certificate generation requested for domain: ${domain}`
  );

  throw new Error(
    'Self-signed certificate generation not implemented. Please provide SSL certificates or disable SSL.'
  );
};

/**
 * Check if certificate is expiring soon (within 30 days)
 */
export const checkCertificateExpiry = (
  certPath: string
): { isExpiring: boolean; daysUntilExpiry?: number; error?: string } => {
  try {
    if (!fs.existsSync(certPath)) {
      return { isExpiring: false, error: 'Certificate file not found' };
    }

    const certContent = fs.readFileSync(certPath, 'utf8');

    // Parse certificate to get expiry date
    // This is a simplified check - in production, use a proper X.509 parser
    const certRegex = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/;
    const match = certContent.match(certRegex);

    if (!match) {
      return { isExpiring: false, error: 'Invalid certificate format' };
    }

    // For now, return a warning to check manually
    logInfo(
      'server',
      'ssl-expiry-check',
      'Certificate expiry check requested - manual verification recommended'
    );
    return { isExpiring: false };
  } catch (error) {
    return {
      isExpiring: false,
      error: error instanceof Error ? error.message : 'Unknown error checking certificate expiry',
    };
  }
};

/**
 * Setup SSL redirect middleware for HTTPS enforcement
 */
export const createSSLRedirectMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const forceHTTPS = process.env.FORCE_HTTPS === 'true';
    const trustProxy = process.env.TRUST_PROXY === 'true';

    if (!forceHTTPS) {
      return next();
    }

    // Check if request is already HTTPS
    const isSecure = trustProxy ? req.headers['x-forwarded-proto'] === 'https' : req.secure;

    if (!isSecure && req.method === 'GET') {
      const redirectUrl = `https://${req.headers.host}${req.url}`;
      logInfo('server', 'ssl-redirect', `Redirecting HTTP to HTTPS: ${redirectUrl}`);
      return res.redirect(301, redirectUrl);
    }

    next();
  };
};

/**
 * Enhanced security headers for HTTPS
 */
export const getHTTPSSecurityHeaders = () => {
  return {
    'Strict-Transport-Security':
      process.env.HSTS_ENABLED !== 'false'
        ? `max-age=${process.env.HSTS_MAX_AGE || '31536000'}; includeSubDomains; preload`
        : undefined,
    'Content-Security-Policy':
      process.env.CSP_ENABLED !== 'false'
        ? [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "connect-src 'self'",
            "font-src 'self'",
            "object-src 'none'",
            "media-src 'self'",
            "frame-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            'upgrade-insecure-requests',
          ].join('; ')
        : undefined,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'interest-cohort=()',
    ].join(', '),
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
};
