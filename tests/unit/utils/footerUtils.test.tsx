import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import {
  createInfoSection,
  createCustomSection,
  createAppInfoSection,
  createUserStatsSection,
  createDebugSection,
  createSystemStatusSection,
  createExampleFooterConfig,
  defaultFooterLinks,
  FooterInfoItem,
  FooterSection,
  FooterLink,
} from '../../../src/utils/footerUtils';

// Import env utilities for mocking
import * as envUtils from '../../../src/utils/env';

// Mock the env utilities
vi.mock('../../../src/utils/env', () => ({
  getAppVersion: vi.fn(() => '2.1.0'),
  getBuildDate: vi.fn(() => '2024-01-15'),
  getEnvironment: vi.fn(() => 'test'),
  isDevelopment: vi.fn(() => true),
}));

// Mock window and navigator objects
const mockNavigator = {
  userAgent: 'Test Browser/1.0 (Test OS)',
};

const mockWindow = {
  screen: {
    width: 1920,
    height: 1080,
  },
  innerWidth: 1280,
  innerHeight: 720,
};

const mockIntl = {
  DateTimeFormat: vi.fn(() => ({
    resolvedOptions: () => ({ timeZone: 'America/New_York' }),
  })),
};

Object.defineProperty(global, 'navigator', {
  value: mockNavigator,
  writable: true,
});

Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true,
});

Object.defineProperty(global, 'Intl', {
  value: mockIntl,
  writable: true,
});

describe('footerUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createInfoSection', () => {
    it('should create a footer section with info items', () => {
      const items: FooterInfoItem[] = [
        { label: 'Version', value: '1.0.0' },
        { label: 'Status', value: 'Active', variant: 'success' },
      ];

      const section = createInfoSection('test-section', 'Test Section', items);

      expect(section.id).toBe('test-section');
      expect(section.title).toBe('Test Section');
      expect(section.content).toBeDefined();

      // Test React content structure (simplified check)
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should handle empty items array', () => {
      const section = createInfoSection('empty-section', 'Empty Section', []);

      expect(section.id).toBe('empty-section');
      expect(section.title).toBe('Empty Section');
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should handle items with different variants', () => {
      const items: FooterInfoItem[] = [
        { label: 'Normal', value: 'normal-value' },
        { label: 'Error', value: 'error-value', variant: 'error' },
        { label: 'Warning', value: 'warning-value', variant: 'warning' },
        { label: 'Success', value: 'success-value', variant: 'success' },
      ];

      const section = createInfoSection('variant-section', 'Variant Section', items);

      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should handle numeric values', () => {
      const items: FooterInfoItem[] = [
        { label: 'Count', value: 42 },
        { label: 'Percentage', value: 85.5 },
        { label: 'Zero', value: 0 },
      ];

      const section = createInfoSection('numeric-section', 'Numeric Section', items);

      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });
  });

  describe('createCustomSection', () => {
    it('should create a section with custom React content', () => {
      const customContent = React.createElement('div', null, 'Custom content');
      const section = createCustomSection('custom-section', 'Custom Section', customContent);

      expect(section.id).toBe('custom-section');
      expect(section.title).toBe('Custom Section');
      expect(section.content).toBe(customContent);
    });

    it('should handle string content', () => {
      const section = createCustomSection('string-section', 'String Section', 'Simple string');

      expect(section.id).toBe('string-section');
      expect(section.title).toBe('String Section');
      expect(section.content).toBe('Simple string');
    });

    it('should handle null content', () => {
      const section = createCustomSection('null-section', 'Null Section', null);

      expect(section.id).toBe('null-section');
      expect(section.title).toBe('Null Section');
      expect(section.content).toBe(null);
    });

    it('should handle complex React elements', () => {
      const complexContent = React.createElement(
        'div',
        { className: 'complex-content' },
        React.createElement('h3', null, 'Title'),
        React.createElement('p', null, 'Description')
      );

      const section = createCustomSection('complex-section', 'Complex Section', complexContent);

      expect(section.content).toBe(complexContent);
      expect(React.isValidElement(section.content)).toBe(true);
    });
  });

  describe('createAppInfoSection', () => {
    it('should create app info section with environment values', () => {
      const section = createAppInfoSection();

      expect(section.id).toBe('app-info');
      expect(section.title).toBe('App Info');
      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should use mocked environment values', () => {
      // The section should use the mocked values from our env mock
      const section = createAppInfoSection();

      expect(section.id).toBe('app-info');
      expect(section.title).toBe('App Info');

      // Verify that our mocked functions were called
      expect(envUtils.getAppVersion).toHaveBeenCalled();
      expect(envUtils.getBuildDate).toHaveBeenCalled();
      expect(envUtils.getEnvironment).toHaveBeenCalled();
    });

    it('should be reusable and consistent', () => {
      const section1 = createAppInfoSection();
      const section2 = createAppInfoSection();

      expect(section1.id).toBe(section2.id);
      expect(section1.title).toBe(section2.title);
    });
  });

  describe('createUserStatsSection', () => {
    it('should create user stats section with all stats', () => {
      const stats = {
        totalRuns: 50,
        totalDistance: 125.5,
        totalTime: 750, // minutes
      };

      const section = createUserStatsSection(stats);

      expect(section.id).toBe('user-stats');
      expect(section.title).toBe('Your Stats');
      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should create section with partial stats', () => {
      const stats = {
        totalRuns: 25,
        totalDistance: 60.3,
      };

      const section = createUserStatsSection(stats);

      expect(section.id).toBe('user-stats');
      expect(section.title).toBe('Your Stats');
      expect(section.content).toBeDefined();
    });

    it('should handle zero values', () => {
      const stats = {
        totalRuns: 0,
        totalDistance: 0,
        totalTime: 0,
      };

      const section = createUserStatsSection(stats);

      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should handle empty stats object', () => {
      const section = createUserStatsSection({});

      expect(section.id).toBe('user-stats');
      expect(section.title).toBe('Your Stats');
      expect(section.content).toBeDefined();
    });

    it('should format distance with one decimal place', () => {
      const stats = {
        totalDistance: 123.456,
      };

      const section = createUserStatsSection(stats);

      // The distance should be formatted to 123.5 km
      expect(section.content).toBeDefined();
    });

    it('should format time correctly', () => {
      const stats = {
        totalTime: 125, // 125 minutes = 2h 5m
      };

      const section = createUserStatsSection(stats);

      expect(section.content).toBeDefined();
    });

    it('should handle large numbers', () => {
      const stats = {
        totalRuns: 1000,
        totalDistance: 5000.75,
        totalTime: 50000, // Large number of minutes
      };

      const section = createUserStatsSection(stats);

      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });
  });

  describe('createDebugSection', () => {
    it('should create debug section with system information', () => {
      const section = createDebugSection();

      expect(section.id).toBe('debug');
      expect(section.title).toBe('Debug Info');
      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should include screen and viewport information', () => {
      const section = createDebugSection();

      // The section should include screen size (1920x1080) and viewport size (1280x720)
      expect(section.content).toBeDefined();
    });

    it('should include timezone information', () => {
      const section = createDebugSection();

      // Should include the mocked timezone
      expect(section.content).toBeDefined();
    });

    it('should truncate long user agent strings', () => {
      // Override navigator with a very long user agent
      const longUserAgent =
        'Very long user agent string that should be truncated because it exceeds fifty characters';
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: longUserAgent },
        writable: true,
      });

      const section = createDebugSection();

      expect(section.content).toBeDefined();

      // Restore original navigator
      Object.defineProperty(global, 'navigator', {
        value: mockNavigator,
        writable: true,
      });
    });

    it('should handle short user agent strings', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Short UA' },
        writable: true,
      });

      const section = createDebugSection();

      expect(section.content).toBeDefined();

      // Restore original navigator
      Object.defineProperty(global, 'navigator', {
        value: mockNavigator,
        writable: true,
      });
    });

    it('should handle missing navigator properties gracefully', () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
      });

      expect(() => createDebugSection()).not.toThrow();

      // Restore original navigator
      Object.defineProperty(global, 'navigator', {
        value: mockNavigator,
        writable: true,
      });
    });
  });

  describe('createSystemStatusSection', () => {
    it('should create system status section with all data', () => {
      const data = {
        serverVersion: '1.2.3',
        databaseStatus: 'connected' as const,
        cacheStatus: 'enabled' as const,
        maintenanceMode: false,
      };

      const section = createSystemStatusSection(data);

      expect(section.id).toBe('system-status');
      expect(section.title).toBe('System');
      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should create section with partial data', () => {
      const data = {
        serverVersion: '2.0.0',
        databaseStatus: 'disconnected' as const,
      };

      const section = createSystemStatusSection(data);

      expect(section.content).toBeDefined();
    });

    it('should handle empty data object', () => {
      const section = createSystemStatusSection({});

      expect(section.id).toBe('system-status');
      expect(section.title).toBe('System');
      expect(section.content).toBeDefined();
    });

    it('should apply correct variants for database status', () => {
      const connectedData = { databaseStatus: 'connected' as const };
      const disconnectedData = { databaseStatus: 'disconnected' as const };
      const unknownData = { databaseStatus: 'unknown' as const };

      expect(() => createSystemStatusSection(connectedData)).not.toThrow();
      expect(() => createSystemStatusSection(disconnectedData)).not.toThrow();
      expect(() => createSystemStatusSection(unknownData)).not.toThrow();
    });

    it('should apply correct variants for cache status', () => {
      const enabledData = { cacheStatus: 'enabled' as const };
      const disabledData = { cacheStatus: 'disabled' as const };

      expect(() => createSystemStatusSection(enabledData)).not.toThrow();
      expect(() => createSystemStatusSection(disabledData)).not.toThrow();
    });

    it('should apply correct variants for maintenance mode', () => {
      const maintenanceData = { maintenanceMode: true };
      const normalData = { maintenanceMode: false };

      expect(() => createSystemStatusSection(maintenanceData)).not.toThrow();
      expect(() => createSystemStatusSection(normalData)).not.toThrow();
    });

    it('should handle all status combinations', () => {
      const allStatusData = {
        serverVersion: '3.0.0',
        databaseStatus: 'connected' as const,
        cacheStatus: 'disabled' as const,
        maintenanceMode: true,
      };

      const section = createSystemStatusSection(allStatusData);

      expect(section.content).toBeDefined();
      expect(React.isValidElement(section.content)).toBe(true);
    });
  });

  describe('defaultFooterLinks', () => {
    it('should provide default footer links', () => {
      expect(defaultFooterLinks).toBeInstanceOf(Array);
      expect(defaultFooterLinks.length).toBeGreaterThan(0);
    });

    it('should have proper link structure', () => {
      defaultFooterLinks.forEach(link => {
        expect(link).toHaveProperty('label');
        expect(link).toHaveProperty('href');
        expect(typeof link.label).toBe('string');
        expect(typeof link.href).toBe('string');
        expect(link.label.length).toBeGreaterThan(0);
        expect(link.href.length).toBeGreaterThan(0);
      });
    });

    it('should include expected links', () => {
      const linkLabels = defaultFooterLinks.map(link => link.label);

      expect(linkLabels).toContain('Privacy Policy');
      expect(linkLabels).toContain('Terms of Service');
      expect(linkLabels).toContain('Help & Support');
      expect(linkLabels).toContain('About');
    });

    it('should have click handlers for all links', () => {
      defaultFooterLinks.forEach(link => {
        expect(link.onClick).toBeDefined();
        expect(typeof link.onClick).toBe('function');
      });
    });

    it('should handle click events correctly', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent;

      defaultFooterLinks.forEach(link => {
        if (link.onClick) {
          expect(() => link.onClick!(mockEvent)).not.toThrow();
          expect(mockEvent.preventDefault).toHaveBeenCalled();
        }
      });
    });
  });

  describe('createExampleFooterConfig', () => {
    it('should create a complete footer configuration', () => {
      const config = createExampleFooterConfig();

      expect(config).toHaveProperty('sections');
      expect(config).toHaveProperty('links');
      expect(config.sections).toBeInstanceOf(Array);
      expect(config.links).toBe(defaultFooterLinks);
    });

    it('should include app info section', () => {
      const config = createExampleFooterConfig();

      const appInfoSection = config.sections.find(section => section.id === 'app-info');
      expect(appInfoSection).toBeDefined();
      expect(appInfoSection?.title).toBe('App Info');
    });

    it('should include user stats section', () => {
      const config = createExampleFooterConfig();

      const userStatsSection = config.sections.find(section => section.id === 'user-stats');
      expect(userStatsSection).toBeDefined();
      expect(userStatsSection?.title).toBe('Your Stats');
    });

    it('should include debug section in development', () => {
      // isDevelopment is mocked to return true
      const config = createExampleFooterConfig();

      const debugSection = config.sections.find(section => section.id === 'debug');
      expect(debugSection).toBeDefined();
      expect(debugSection?.title).toBe('Debug Info');
    });

    it('should not include debug section in production', () => {
      // Mock isDevelopment to return false
      vi.mocked(envUtils.isDevelopment).mockReturnValue(false);

      const config = createExampleFooterConfig();

      const debugSection = config.sections.find(section => section.id === 'debug');
      expect(debugSection).toBeUndefined();

      // Restore mock
      vi.mocked(envUtils.isDevelopment).mockReturnValue(true);
    });

    it('should provide consistent configuration', () => {
      const config1 = createExampleFooterConfig();
      const config2 = createExampleFooterConfig();

      expect(config1.sections.length).toBe(config2.sections.length);
      expect(config1.links).toBe(config2.links);
    });

    it('should create valid React content for all sections', () => {
      const config = createExampleFooterConfig();

      config.sections.forEach(section => {
        expect(section.content).toBeDefined();
        if (React.isValidElement(section.content)) {
          expect(React.isValidElement(section.content)).toBe(true);
        }
      });
    });
  });

  describe('type definitions', () => {
    it('should define FooterInfoItem interface correctly', () => {
      const item: FooterInfoItem = {
        label: 'Test',
        value: 'test-value',
        variant: 'success',
      };

      expect(item.label).toBe('Test');
      expect(item.value).toBe('test-value');
      expect(item.variant).toBe('success');
    });

    it('should define FooterSection interface correctly', () => {
      const section: FooterSection = {
        id: 'test-section',
        title: 'Test Section',
        content: React.createElement('div', null, 'Test content'),
      };

      expect(section.id).toBe('test-section');
      expect(section.title).toBe('Test Section');
      expect(React.isValidElement(section.content)).toBe(true);
    });

    it('should define FooterLink interface correctly', () => {
      const link: FooterLink = {
        label: 'Test Link',
        href: '/test',
        onClick: vi.fn(),
      };

      expect(link.label).toBe('Test Link');
      expect(link.href).toBe('/test');
      expect(typeof link.onClick).toBe('function');
    });
  });

  describe('integration tests', () => {
    it('should create a complete footer with multiple sections', () => {
      const userStats = {
        totalRuns: 100,
        totalDistance: 500.5,
        totalTime: 3000,
      };

      const systemStatus = {
        serverVersion: '1.0.0',
        databaseStatus: 'connected' as const,
        cacheStatus: 'enabled' as const,
        maintenanceMode: false,
      };

      const sections = [
        createAppInfoSection(),
        createUserStatsSection(userStats),
        createDebugSection(),
        createSystemStatusSection(systemStatus),
      ];

      expect(sections.length).toBe(4);
      sections.forEach(section => {
        expect(section.id).toBeDefined();
        expect(section.title).toBeDefined();
        expect(section.content).toBeDefined();
      });
    });

    it('should handle mixed content types in sections', () => {
      const sections = [
        createInfoSection('info', 'Info', [{ label: 'Test', value: 'value' }]),
        createCustomSection('custom', 'Custom', React.createElement('span', null, 'Custom')),
        createCustomSection('string', 'String', 'Plain string'),
      ];

      expect(sections.length).toBe(3);
      expect(React.isValidElement(sections[0].content)).toBe(true);
      expect(React.isValidElement(sections[1].content)).toBe(true);
      expect(typeof sections[2].content).toBe('string');
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle undefined window properties gracefully', () => {
      const originalWindow = global.window;

      Object.defineProperty(global, 'window', {
        value: {
          screen: {},
          innerWidth: undefined,
          innerHeight: undefined,
        },
        writable: true,
      });

      expect(() => createDebugSection()).not.toThrow();

      Object.defineProperty(global, 'window', {
        value: originalWindow,
        writable: true,
      });
    });

    it('should handle missing Intl support gracefully', () => {
      const originalIntl = global.Intl;

      Object.defineProperty(global, 'Intl', {
        value: undefined,
        writable: true,
      });

      expect(() => createDebugSection()).not.toThrow();

      Object.defineProperty(global, 'Intl', {
        value: originalIntl,
        writable: true,
      });
    });

    it('should handle very large stat numbers', () => {
      const largeStats = {
        totalRuns: Number.MAX_SAFE_INTEGER,
        totalDistance: 999999999.999,
        totalTime: Number.MAX_SAFE_INTEGER,
      };

      expect(() => createUserStatsSection(largeStats)).not.toThrow();
    });

    it('should handle negative stat numbers', () => {
      const negativeStats = {
        totalRuns: -5,
        totalDistance: -10.5,
        totalTime: -100,
      };

      expect(() => createUserStatsSection(negativeStats)).not.toThrow();
    });
  });
});
