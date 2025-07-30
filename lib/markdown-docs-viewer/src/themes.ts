import { Theme } from './types';

export const defaultTheme: Theme = {
  name: 'default',
  colors: {
    primary: '#3b82f6',
    secondary: '#10b981',
    background: '#ffffff',
    surface: '#f3f4f6',
    textPrimary: '#111827',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    codeBackground: '#f3f4f6',
    link: '#3b82f6',
    linkHover: '#2563eb',
    error: '#ef4444',
    warning: '#f59e0b',
    success: '#10b981',
  },
  fonts: {
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    heading:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    code: '"Fira Code", "Consolas", "Monaco", "Andale Mono", "Ubuntu Mono", monospace',
  },
  spacing: {
    unit: 8,
    containerMaxWidth: '1200px',
    sidebarWidth: '320px',
  },
  borderRadius: '0.5rem',
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    primary: '#3b82f6',
    secondary: '#10b981',
    background: '#0f172a',
    surface: '#1e293b',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    border: '#334155',
    codeBackground: '#1a202c',
    link: '#3b82f6',
    linkHover: '#60a5fa',
    error: '#ef4444',
    warning: '#f59e0b',
    success: '#10b981',
  },
  fonts: defaultTheme.fonts,
  spacing: defaultTheme.spacing,
  borderRadius: defaultTheme.borderRadius,
};

export function createCustomTheme(overrides: Partial<Theme>): Theme {
  const baseTheme = overrides.name === 'dark' ? darkTheme : defaultTheme;
  return {
    ...baseTheme,
    ...overrides,
    colors: {
      ...baseTheme.colors,
      ...(overrides.colors || {}),
    },
    fonts: {
      ...baseTheme.fonts,
      ...(overrides.fonts || {}),
    },
    spacing: {
      ...baseTheme.spacing,
      ...(overrides.spacing || {}),
    },
  };
}
