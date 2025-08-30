import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '../../src/contexts/ThemeContext';

/**
 * Test wrapper that provides all necessary context providers for components
 */
export const TestProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>
    <ThemeProvider defaultTheme='light'>{children}</ThemeProvider>
  </BrowserRouter>
);

/**
 * Router-only wrapper for components that only need routing context
 */
export const RouterTestProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>{children}</BrowserRouter>
);

/**
 * Theme-only wrapper for components that only need theme context
 */
export const ThemeTestProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider defaultTheme='light'>{children}</ThemeProvider>
);
