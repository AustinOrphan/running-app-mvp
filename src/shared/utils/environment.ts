/**
 * Environment detection utilities for development features
 */

/**
 * Check if the app is running in development mode
 */
export const isDevelopment = (): boolean => {
  return import.meta.env.DEV || import.meta.env.NODE_ENV === 'development';
};

/**
 * Check if the app is running in production mode
 */
export const isProduction = (): boolean => {
  return import.meta.env.PROD || import.meta.env.NODE_ENV === 'production';
};

/**
 * Development configuration flags
 */
export const devConfig = {
  // Enable login bypass in development
  enableLoginBypass: isDevelopment(),

  // Enable development tools and debug features
  enableDevTools: isDevelopment(),

  // Enable verbose logging
  enableVerboseLogging: isDevelopment(),

  // Development default user for bypass
  defaultDevUser: {
    email: 'dev@runner.local',
    password: 'dev123',
    name: 'Dev User',
  },
} as const;

/**
 * Get environment-specific configuration
 */
export const getEnvironmentConfig = () => ({
  isDev: isDevelopment(),
  isProd: isProduction(),
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  ...devConfig,
});
