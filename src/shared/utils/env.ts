/**
 * Safe environment variable access utilities for browser environment
 */

/**
 * Safely get an environment variable with a fallback value
 */
export const getEnvVar = (key: keyof ImportMetaEnv, fallback: string = ''): string => {
  try {
    return import.meta.env?.[key] ?? fallback;
  } catch {
    return fallback;
  }
};

/**
 * Get app version from environment or fallback
 */
export const getAppVersion = (): string => {
  return getEnvVar('VITE_APP_VERSION', '1.0.0');
};

/**
 * Get build date from environment or current date
 */
export const getBuildDate = (): string => {
  return getEnvVar('VITE_APP_BUILD_DATE', new Date().toISOString().split('T')[0]);
};

/**
 * Get current environment mode
 */
export const getEnvironment = (): string => {
  return getEnvVar('MODE', 'development');
};

/**
 * Check if running in development mode
 */
export const isDevelopment = (): boolean => {
  return getEnvironment() === 'development';
};

/**
 * Check if running in production mode
 */
export const isProduction = (): boolean => {
  return getEnvironment() === 'production';
};

/**
 * Get all app info as an object
 */
export const getAppInfo = () => ({
  version: getAppVersion(),
  buildDate: getBuildDate(),
  environment: getEnvironment(),
  isDev: isDevelopment(),
  isProd: isProduction(),
});
