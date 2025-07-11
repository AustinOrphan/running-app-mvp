import https from 'https';
import http from 'http';
import { Express } from 'express';
import {
  getSSLConfig,
  validateSSLCertificates,
  loadSSLCertificates,
  checkCertificateExpiry,
} from './sslUtils.js';
import { logInfo, logError } from './logger.js';

/**
 * HTTPS Server Setup and Management
 * Handles secure server creation with SSL/TLS certificates
 */

export interface ServerConfig {
  port: number;
  httpsPort?: number;
  ssl: boolean;
  redirectHTTP?: boolean;
}

/**
 * Create HTTPS server with SSL certificates
 */
export const createHTTPSServer = (
  app: Express,
  config: ServerConfig
): https.Server | http.Server => {
  const sslConfig = getSSLConfig();

  if (!config.ssl || !sslConfig.enabled) {
    logInfo('server', 'startup', 'Starting HTTP server (SSL disabled)');
    return http.createServer(app);
  }

  // Validate SSL certificates
  if (!validateSSLCertificates(sslConfig)) {
    logError(
      'server',
      'ssl-validation',
      new Error('SSL certificate validation failed, falling back to HTTP')
    );
    return http.createServer(app);
  }

  try {
    // Load SSL certificates
    const httpsOptions = loadSSLCertificates(sslConfig);

    // Check certificate expiry
    if (sslConfig.certPath) {
      const expiryCheck = checkCertificateExpiry(sslConfig.certPath);
      if (expiryCheck.isExpiring && expiryCheck.daysUntilExpiry) {
        logInfo(
          'server',
          'ssl-expiry',
          `SSL certificate expires in ${expiryCheck.daysUntilExpiry} days`
        );
      }
      if (expiryCheck.error) {
        logError(
          'server',
          'ssl-expiry',
          new Error(`Certificate expiry check failed: ${expiryCheck.error}`)
        );
      }
    }

    // Create HTTPS server
    const httpsServer = https.createServer(httpsOptions, app);

    // Configure additional HTTPS options
    httpsServer.on('secureConnection', tlsSocket => {
      logInfo('server', 'ssl-connection', 'Secure connection established', undefined, {
        protocol: tlsSocket.getProtocol(),
        cipher: tlsSocket.getCipher(),
        serverName: (tlsSocket as any).servername,
      });
    });

    // Handle SSL errors
    httpsServer.on('tlsClientError', (err, tlsSocket) => {
      logError('server', 'ssl-error', err, undefined, {
        remoteAddress: tlsSocket.remoteAddress,
        remotePort: tlsSocket.remotePort,
      });
    });

    logInfo('server', 'startup', 'HTTPS server created successfully');
    return httpsServer;
  } catch (error) {
    logError(
      'server',
      'ssl-setup',
      error instanceof Error ? error : new Error('Failed to create HTTPS server')
    );
    logInfo('server', 'startup', 'Falling back to HTTP server');
    return http.createServer(app);
  }
};

/**
 * Start server with optional HTTP to HTTPS redirect
 */
export const startServer = (
  app: Express,
  config: ServerConfig
): Promise<{ server: https.Server | http.Server; redirectServer?: http.Server }> => {
  return new Promise((resolve, reject) => {
    try {
      const server = createHTTPSServer(app, config);
      const isHTTPS = server instanceof https.Server;
      const port = isHTTPS ? config.httpsPort || 443 : config.port;

      // Start main server
      server.listen(port, () => {
        logInfo(
          'server',
          'startup',
          `${isHTTPS ? 'HTTPS' : 'HTTP'} server listening on port ${port}`
        );

        // Start HTTP redirect server if HTTPS is enabled and redirect is requested
        if (isHTTPS && config.redirectHTTP && config.port !== port) {
          const redirectServer = createHTTPRedirectServer(config.httpsPort || 443);

          redirectServer.listen(config.port, () => {
            logInfo('server', 'startup', `HTTP redirect server listening on port ${config.port}`);
            resolve({ server, redirectServer });
          });

          redirectServer.on('error', error => {
            logError('server', 'redirect-server-error', error);
            // Don't fail the main server if redirect server fails
            resolve({ server });
          });
        } else {
          resolve({ server });
        }
      });

      server.on('error', error => {
        logError('server', 'server-error', error);
        reject(error);
      });
    } catch (error) {
      logError(
        'server',
        'server-startup',
        error instanceof Error ? error : new Error('Server startup failed')
      );
      reject(error);
    }
  });
};

/**
 * Create HTTP redirect server for HTTPS enforcement
 */
const createHTTPRedirectServer = (httpsPort: number): http.Server => {
  return http.createServer((req, res) => {
    const host = req.headers.host?.split(':')[0]; // Remove port if present
    const redirectUrl = `https://${host}${httpsPort !== 443 ? `:${httpsPort}` : ''}${req.url}`;

    logInfo('server', 'https-redirect', `Redirecting HTTP to HTTPS: ${req.url} -> ${redirectUrl}`);

    res.writeHead(301, {
      Location: redirectUrl,
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    });
    res.end();
  });
};

/**
 * Graceful server shutdown
 */
export const gracefulShutdown = (servers: {
  server: https.Server | http.Server;
  redirectServer?: http.Server;
}): Promise<void> => {
  return new Promise(resolve => {
    logInfo('server', 'shutdown', 'Initiating graceful shutdown');

    const shutdownPromises: Promise<void>[] = [];

    // Shutdown main server
    shutdownPromises.push(
      new Promise<void>(resolveMain => {
        servers.server.close(() => {
          logInfo('server', 'shutdown', 'Main server closed');
          resolveMain();
        });
      })
    );

    // Shutdown redirect server if it exists
    if (servers.redirectServer) {
      shutdownPromises.push(
        new Promise<void>(resolveRedirect => {
          servers.redirectServer!.close(() => {
            logInfo('server', 'shutdown', 'Redirect server closed');
            resolveRedirect();
          });
        })
      );
    }

    Promise.all(shutdownPromises).then(() => {
      logInfo('server', 'shutdown', 'Graceful shutdown completed');
      resolve();
    });

    // Force shutdown after timeout
    setTimeout(() => {
      logError('server', 'shutdown', new Error('Graceful shutdown timeout, forcing exit'));
      process.exit(1);
    }, 10000); // 10 second timeout
  });
};

/**
 * SSL certificate monitoring and auto-reload
 */
export const setupCertificateMonitoring = (
  server: https.Server | http.Server,
  sslConfig: ReturnType<typeof getSSLConfig>
): void => {
  if (!sslConfig.enabled || !sslConfig.certPath || !(server instanceof https.Server)) {
    return;
  }

  // Check certificate expiry every 24 hours
  const checkInterval = 24 * 60 * 60 * 1000; // 24 hours

  setInterval(() => {
    const expiryCheck = checkCertificateExpiry(sslConfig.certPath!);

    if (expiryCheck.isExpiring && expiryCheck.daysUntilExpiry) {
      if (expiryCheck.daysUntilExpiry <= 7) {
        logError(
          'server',
          'ssl-expiry-warning',
          new Error(
            `SSL certificate expires in ${expiryCheck.daysUntilExpiry} days - renewal required`
          )
        );
      } else if (expiryCheck.daysUntilExpiry <= 30) {
        logInfo(
          'server',
          'ssl-expiry-notice',
          `SSL certificate expires in ${expiryCheck.daysUntilExpiry} days`
        );
      }
    }

    if (expiryCheck.error) {
      logError(
        'server',
        'ssl-monitoring',
        new Error(`Certificate monitoring failed: ${expiryCheck.error}`)
      );
    }
  }, checkInterval);

  logInfo('server', 'ssl-monitoring', 'SSL certificate monitoring enabled');
};

/**
 * Get server configuration from environment
 */
export const getServerConfig = (): ServerConfig => {
  return {
    port: parseInt(process.env.PORT || '3001', 10),
    httpsPort: process.env.HTTPS_PORT ? parseInt(process.env.HTTPS_PORT, 10) : undefined,
    ssl: process.env.SSL_ENABLED === 'true',
    redirectHTTP: process.env.REDIRECT_HTTP_TO_HTTPS === 'true',
  };
};

/**
 * Development SSL setup helper
 */
export const setupDevelopmentSSL = (): void => {
  if (process.env.NODE_ENV === 'development' && process.env.SSL_ENABLED === 'true') {
    logInfo(
      'server',
      'dev-ssl',
      'Development SSL enabled - ensure certificates are properly configured'
    );

    // Check if development certificates exist
    const sslConfig = getSSLConfig();
    if (!validateSSLCertificates(sslConfig)) {
      logError('server', 'dev-ssl', new Error('Development SSL certificates not found or invalid'));
      logInfo(
        'server',
        'dev-ssl',
        'To generate development certificates, run: openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes'
      );
    }
  }
};
