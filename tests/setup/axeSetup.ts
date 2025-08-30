import { configureAxe } from 'jest-axe';

// Configure axe for testing
export const axe = configureAxe({
  rules: {
    // Enable color contrast checking now that we're fixing design system
    'color-contrast': { enabled: true },
    region: { enabled: false }, // Some components might not need ARIA landmarks
    'landmark-one-main': { enabled: false }, // Multiple main elements might be acceptable in SPA
  },
  // Note: tags and locale may not be supported in configureAxe options
});

// Severity level definitions for accessibility rules
export const SEVERITY_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFORMATIONAL: 'informational',
} as const;

// Rule severity mapping with detailed configuration
export const RULE_SEVERITY_CONFIG = {
  // === CRITICAL SEVERITY ===
  // Rules that must always pass - core accessibility failures that completely break screen reader/keyboard access
  critical: {
    'aria-allowed-attr': { enabled: true, severity: 'critical' },
    'aria-hidden-body': { enabled: true, severity: 'critical' },
    'aria-hidden-focus': { enabled: true, severity: 'critical' },
    'aria-required-attr': { enabled: true, severity: 'critical' },
    'aria-required-children': { enabled: true, severity: 'critical' },
    'aria-required-parent': { enabled: true, severity: 'critical' },
    'aria-roles': { enabled: true, severity: 'critical' },
    'aria-valid-attr': { enabled: true, severity: 'critical' },
    'aria-valid-attr-value': { enabled: true, severity: 'critical' },
    'button-name': { enabled: true, severity: 'critical' },
    'input-button-name': { enabled: true, severity: 'critical' },
    label: { enabled: true, severity: 'critical' },
    'link-name': { enabled: true, severity: 'critical' },
    'duplicate-id': { enabled: true, severity: 'critical' },
    'duplicate-id-active': { enabled: true, severity: 'critical' },
    'duplicate-id-aria': { enabled: true, severity: 'critical' },
  },

  // === HIGH SEVERITY ===
  // Rules that significantly impact usability but may have contextual exceptions
  high: {
    'color-contrast': {
      enabled: false, // Disabled in jsdom due to canvas limitations
      severity: 'high',
      // In real browsers: { enabled: true, options: { noScroll: true } }
    },
    'form-field-multiple-labels': { enabled: true, severity: 'high' },
    'heading-order': {
      enabled: true,
      severity: 'high',
      options: {
        // Allow some flexibility in component tests
        allowSkippingLevels: true,
      },
    },
    'image-alt': { enabled: true, severity: 'high' },
    'input-image-alt': { enabled: true, severity: 'high' },
    tabindex: {
      enabled: true,
      severity: 'high',
      options: {
        // Allow positive tabindex in component tests but warn
        allowPositive: false,
      },
    },
  },

  // === MEDIUM SEVERITY ===
  // Rules that improve accessibility but aren't critical for basic functionality
  medium: {
    'aria-command-name': { enabled: true, severity: 'medium' },
    'aria-input-field-name': { enabled: true, severity: 'medium' },
    'focus-order-semantics': {
      enabled: true,
      severity: 'medium',
      options: {
        // Be more lenient with focus order in component tests
        checkFocusOrder: false,
      },
    },
    list: { enabled: true, severity: 'medium' },
    listitem: { enabled: true, severity: 'medium' },
    'valid-lang': { enabled: true, severity: 'medium' },
  },

  // === LOW SEVERITY ===
  // Best practices that enhance accessibility but aren't essential
  low: {
    'definition-list': { enabled: true, severity: 'low' },
    dlitem: { enabled: true, severity: 'low' },
    'fieldset-legend': {
      enabled: true,
      severity: 'low',
      options: {
        // Allow fieldsets without legends for styling purposes
        allowEmpty: true,
      },
    },
    'table-caption': { enabled: false, severity: 'low' }, // Not all tables need captions
    'td-headers-attr': { enabled: true, severity: 'low' },
    'th-has-data-cells': { enabled: true, severity: 'low' },
    'scope-attr-valid': { enabled: true, severity: 'low' },
    'audio-caption': { enabled: true, severity: 'low' },
    'video-caption': { enabled: true, severity: 'low' },
    'video-description': { enabled: true, severity: 'low' },
    'object-alt': { enabled: true, severity: 'low' },
  },

  // === INFORMATIONAL ===
  // Rules that provide guidance but may be too strict for MVP or context-dependent
  informational: {
    accesskeys: { enabled: false, severity: 'informational' }, // Rarely used in modern apps
    'color-contrast-enhanced': { enabled: false, severity: 'informational' }, // AAA level
    'scrollable-region-focusable': {
      enabled: false,
      severity: 'informational',
      // Could be enabled with options for custom scroll components
    },
    'html-has-lang': {
      enabled: false, // Not applicable to component tests
      severity: 'informational',
      // In E2E tests: { enabled: true }
    },
    'html-lang-valid': {
      enabled: false, // Not applicable to component tests
      severity: 'informational',
      // In E2E tests: { enabled: true }
    },
    'meta-refresh': { enabled: false, severity: 'informational' }, // Not applicable to components
    'meta-viewport': { enabled: false, severity: 'informational' }, // Not applicable to components
    'server-side-image-map': { enabled: true, severity: 'informational' },
  },

  // === PAGE-LEVEL RULES (CONTEXT-DEPENDENT) ===
  // Rules that are disabled for component tests but enabled for E2E tests
  pageLevel: {
    bypass: { enabled: false, severity: 'high' }, // Skip links not needed in components
    'landmark-one-main': { enabled: false, severity: 'medium' }, // Components don't need main landmarks
    'page-has-heading-one': { enabled: false, severity: 'medium' }, // Not applicable to components
    region: { enabled: false, severity: 'medium' }, // Components don't need to be in regions
    'landmark-banner-is-top-level': { enabled: false, severity: 'low' },
    'landmark-contentinfo-is-top-level': { enabled: false, severity: 'low' },
    'landmark-main-is-top-level': { enabled: false, severity: 'low' },
    'landmark-no-duplicate-banner': { enabled: false, severity: 'low' },
    'landmark-no-duplicate-contentinfo': { enabled: false, severity: 'low' },
    'landmark-no-duplicate-main': { enabled: false, severity: 'low' },
    'landmark-unique': { enabled: false, severity: 'low' },
  },
};

// Function to get rules by severity level
export const getRulesBySeverity = (severityLevel: keyof typeof RULE_SEVERITY_CONFIG) => {
  return RULE_SEVERITY_CONFIG[severityLevel];
};

// Function to get all enabled rules
export const getAllEnabledRules = () => {
  const allRules = {};
  Object.values(RULE_SEVERITY_CONFIG).forEach(severityGroup => {
    Object.entries(severityGroup).forEach(([ruleId, config]) => {
      allRules[ruleId] = {
        enabled: config.enabled,
        ...(config.options && { options: config.options }),
      };
    });
  });
  return allRules;
};

// Function to disable false-positive prone rules for specific test contexts
export const disableFalsePositiveRules = (
  baseConfig: any,
  context: 'component' | 'integration' | 'e2e' = 'component'
) => {
  const falsePositiveRules = RULE_SEVERITY_CONFIG.falsePositiveProne || {};
  const updatedRules = { ...baseConfig.rules };

  // Apply context-specific false positive handling
  Object.entries(falsePositiveRules).forEach(([ruleId, config]) => {
    if (context === 'component') {
      // In component tests, disable most false-positive prone rules
      updatedRules[ruleId] = {
        enabled: false,
        ...(config.options && { options: config.options }),
        _disabledReason:
          config.reason || 'Disabled to prevent false positives in component testing',
      };
    } else if (context === 'integration') {
      // In integration tests, be more selective
      const keepEnabledInIntegration = [
        'form-field-multiple-labels',
        'focus-order-semantics',
        'tabindex',
      ];
      if (!keepEnabledInIntegration.includes(ruleId)) {
        updatedRules[ruleId] = {
          enabled: false,
          ...(config.options && { options: config.options }),
          _disabledReason:
            config.reason || 'Disabled to prevent false positives in integration testing',
        };
      }
    }
    // For e2e tests, keep most rules enabled as they should work in real browsers
  });

  // Additional jsdom-specific rule handling
  if (typeof window !== 'undefined' && !window.HTMLCanvasElement) {
    // Disable canvas-dependent rules in jsdom environment
    updatedRules['color-contrast'] = {
      enabled: false,
      _disabledReason:
        'Canvas not available in jsdom - use real browser for color contrast testing',
    };
    updatedRules['color-contrast-enhanced'] = {
      enabled: false,
      _disabledReason:
        'Canvas not available in jsdom - use real browser for enhanced color contrast testing',
    };
  }

  return {
    ...baseConfig,
    rules: updatedRules,
  };
};

// Function to get rules that are commonly false positives for a given context
export const getFalsePositiveRules = (
  context: 'component' | 'integration' | 'e2e' = 'component'
) => {
  const falsePositiveRules = RULE_SEVERITY_CONFIG.falsePositiveProne || {};

  return Object.entries(falsePositiveRules)
    .filter(([ruleId, _config]) => {
      // Context-specific filtering logic
      if (context === 'e2e') {
        // In E2E tests, only disable rules that truly don't work in browsers
        return (
          ['color-contrast', 'color-contrast-enhanced'].includes(ruleId) &&
          typeof window !== 'undefined' &&
          !window.HTMLCanvasElement
        );
      } else if (context === 'integration') {
        // In integration tests, keep some rules enabled
        const keepEnabled = ['form-field-multiple-labels', 'focus-order-semantics', 'tabindex'];
        return !keepEnabled.includes(ruleId);
      } else {
        // In component tests, disable most false-positive prone rules
        return true;
      }
    })
    .reduce(
      (acc, [ruleId, config]) => {
        acc[ruleId] = config;
        return acc;
      },
      {} as Record<string, any>
    );
};

// Enhanced axe configuration with severity levels and custom rules
export const axeConfig = {
  rules: getAllEnabledRules(),
  tags: ['wcag2a', 'wcag2aa'],
  locale: 'en',
  // Performance optimizations
  options: {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'best-practice'],
    },
    reporter: 'v2',
  },
};

// Severity-specific configurations for different test contexts
export const severityConfigs = {
  // Only run critical rules (for quick smoke tests)
  critical: {
    rules: getRulesBySeverity('critical'),
    tags: ['wcag2a'],
    options: { reporter: 'v2' },
  },

  // Run critical + high severity (for CI/PR checks)
  essential: {
    rules: {
      ...getRulesBySeverity('critical'),
      ...getRulesBySeverity('high'),
    },
    tags: ['wcag2a', 'wcag2aa'],
    options: { reporter: 'v2' },
  },

  // Run all except informational (for thorough testing)
  comprehensive: {
    rules: {
      ...getRulesBySeverity('critical'),
      ...getRulesBySeverity('high'),
      ...getRulesBySeverity('medium'),
      ...getRulesBySeverity('low'),
    },
    tags: ['wcag2a', 'wcag2aa'],
    options: { reporter: 'v2' },
  },

  // Full audit including informational rules (for accessibility audits)
  fullAudit: {
    rules: getAllEnabledRules(),
    tags: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'best-practice'],
    options: { reporter: 'v2' },
  },

  // E2E specific configuration (enables page-level rules)
  e2e: {
    rules: {
      ...getAllEnabledRules(),
      // Enable page-level rules for E2E tests
      bypass: { enabled: true },
      'landmark-one-main': { enabled: true },
      'page-has-heading-one': { enabled: true },
      region: { enabled: true },
      'html-has-lang': { enabled: true },
      'html-lang-valid': { enabled: true },
      'color-contrast': { enabled: true }, // Enable in real browsers
    },
    tags: ['wcag2a', 'wcag2aa'],
    options: { reporter: 'v2' },
  },
};

/**
 * Custom rule configuration utilities
 * Allows for project-specific customization of accessibility rules
 */

export interface CustomRuleOverride {
  enabled?: boolean;
  severity?: keyof typeof SEVERITY_LEVELS;
  options?: Record<string, any>;
  reason?: string; // Documentation for why rule was overridden
}

export interface CustomAxeConfig {
  /** Override specific rules */
  ruleOverrides?: Record<string, CustomRuleOverride>;
  /** Set minimum severity level to test */
  minSeverity?: keyof typeof SEVERITY_LEVELS;
  /** Add custom tags */
  additionalTags?: string[];
  /** Test environment context */
  context?: 'component' | 'integration' | 'e2e' | 'audit';
  /** Skip rules that are known to be problematic in specific contexts */
  skipProblematicRules?: boolean;
}

/**
 * Create a custom axe configuration based on project needs
 */
export function createCustomAxeConfig(customConfig: CustomAxeConfig = {}): any {
  const {
    ruleOverrides = {},
    minSeverity = 'medium',
    additionalTags = [],
    context = 'component',
    skipProblematicRules = true,
  } = customConfig;

  // Start with base configuration based on context
  let baseConfig;
  switch (context) {
    case 'e2e':
      baseConfig = severityConfigs.e2e;
      break;
    case 'integration':
      baseConfig = severityConfigs.comprehensive;
      break;
    case 'audit':
      baseConfig = severityConfigs.fullAudit;
      break;
    case 'component':
    default:
      baseConfig = severityConfigs.essential;
      break;
  }

  // Apply severity filtering
  const severityOrder: (keyof typeof SEVERITY_LEVELS)[] = [
    'critical',
    'high',
    'medium',
    'low',
    'informational',
  ];
  const minSeverityIndex = severityOrder.indexOf(minSeverity);

  let filteredRules = { ...baseConfig.rules };

  // Filter by minimum severity level
  Object.entries(RULE_SEVERITY_CONFIG).forEach(([severityLevel, rules]) => {
    const severityIndex = severityOrder.indexOf(severityLevel as keyof typeof SEVERITY_LEVELS);
    if (severityIndex > minSeverityIndex) {
      // Disable rules below minimum severity
      Object.keys(rules).forEach(ruleId => {
        if (filteredRules[ruleId]) {
          filteredRules[ruleId] = { enabled: false };
        }
      });
    }
  });

  // Apply custom rule overrides
  Object.entries(ruleOverrides).forEach(([ruleId, override]) => {
    if (override.enabled !== undefined) {
      filteredRules[ruleId] = {
        enabled: override.enabled,
        ...(override.options && { options: override.options }),
      };
    }
  });

  // Context-specific rule adjustments
  if (skipProblematicRules) {
    if (context === 'component') {
      // Disable problematic rules for component testing
      filteredRules = {
        ...filteredRules,
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
        bypass: { enabled: false },
        'page-has-heading-one': { enabled: false },
        'html-has-lang': { enabled: false },
        'html-lang-valid': { enabled: false },
        'color-contrast': { enabled: false }, // jsdom limitation
      };
    }
  }

  return {
    rules: filteredRules,
    tags: [...baseConfig.tags, ...additionalTags],
    options: {
      ...baseConfig.options,
      // Add custom reporter options if needed
    },
  };
}

/**
 * Predefined custom configurations for common scenarios
 */
export const customConfigurations = {
  /**
   * Strict configuration - fail on any accessibility issue
   */
  strict: createCustomAxeConfig({
    minSeverity: 'critical',
    context: 'audit',
    skipProblematicRules: false,
    ruleOverrides: {
      'color-contrast': { enabled: false, reason: 'jsdom canvas limitation' },
      'color-contrast-enhanced': { enabled: false, reason: 'AAA level too strict for MVP' },
    },
  }),

  /**
   * Lenient configuration - focus only on critical issues
   */
  lenient: createCustomAxeConfig({
    minSeverity: 'high',
    context: 'component',
    skipProblematicRules: true,
    ruleOverrides: {
      'heading-order': {
        enabled: true,
        options: { allowSkippingLevels: true },
        reason: 'Allow flexible heading structure in components',
      },
    },
  }),

  /**
   * CI-optimized configuration - balance speed and coverage
   */
  ci: createCustomAxeConfig({
    minSeverity: 'medium',
    context: 'integration',
    skipProblematicRules: true,
    additionalTags: ['best-practice'],
    ruleOverrides: {
      'color-contrast': { enabled: false, reason: 'jsdom limitation' },
      'scrollable-region-focusable': { enabled: false, reason: 'too strict for custom components' },
    },
  }),

  /**
   * Development configuration - comprehensive but not blocking
   */
  development: createCustomAxeConfig({
    minSeverity: 'low',
    context: 'component',
    skipProblematicRules: true,
    ruleOverrides: {
      'landmark-unique': {
        enabled: false,
        reason: 'May have duplicate landmarks in component isolation',
      },
    },
  }),

  /**
   * Production audit configuration - full coverage
   */
  audit: createCustomAxeConfig({
    minSeverity: 'informational',
    context: 'audit',
    skipProblematicRules: false,
    additionalTags: ['wcag2aaa', 'best-practice', 'ACT'],
    ruleOverrides: {
      'color-contrast-enhanced': {
        enabled: true,
        reason: 'Full audit should check AAA compliance',
      },
    },
  }),
};

/**
 * Helper to validate custom rule configuration
 */
export function validateCustomConfig(config: CustomAxeConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate severity level
  if (config.minSeverity && !(config.minSeverity in SEVERITY_LEVELS)) {
    errors.push(`Invalid severity level: ${config.minSeverity}`);
  }

  // Validate context
  const validContexts = ['component', 'integration', 'e2e', 'audit'];
  if (config.context && !validContexts.includes(config.context)) {
    errors.push(`Invalid context: ${config.context}. Must be one of: ${validContexts.join(', ')}`);
  }

  // Validate rule overrides
  if (config.ruleOverrides) {
    Object.entries(config.ruleOverrides).forEach(([ruleId, override]) => {
      // Check if rule exists in our configuration
      const ruleExists = Object.values(RULE_SEVERITY_CONFIG).some(severityGroup =>
        Object.keys(severityGroup).includes(ruleId)
      );

      if (!ruleExists) {
        errors.push(`Unknown rule: ${ruleId}`);
      }

      // Validate severity if provided
      if (override.severity && !(override.severity in SEVERITY_LEVELS)) {
        errors.push(`Invalid severity for rule ${ruleId}: ${override.severity}`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Export commonly used configurations for easy access
 */
export const presetConfigs = {
  component: customConfigurations.development,
  integration: customConfigurations.ci,
  e2e: severityConfigs.e2e,
  audit: customConfigurations.audit,
  strict: customConfigurations.strict,
  lenient: customConfigurations.lenient,
};

// Accessibility testing helper for Playwright
export const checkAccessibility = async (page: any, options = {}) => {
  const { violations } = await page.locator('body').evaluate(
    async (body: HTMLElement, _config: any) => {
      const axe = (window as any).axe;
      if (!axe) {
        throw new Error('axe-core not loaded. Make sure to inject axe-core script.');
      }

      return await axe.run(body, config);
    },
    { ...axeConfig, ...options }
  );

  return violations;
};

// Helper to format axe violations for better test output
export const formatAxeViolations = (violations: any[]) => {
  if (violations.length === 0) {
    return 'No accessibility violations found';
  }

  return violations
    .map(violation => {
      const nodes = violation.nodes
        .map((node: any) => {
          return `    - ${node.target.join(', ')}: ${node.failureSummary}`;
        })
        .join('\n');

      return `
Rule: ${violation.id} (${violation.impact})
Description: ${violation.description}
Help: ${violation.help}
Nodes:
${nodes}
Help URL: ${violation.helpUrl}
`;
    })
    .join('\n---\n');
};

// Accessibility matcher for Jest/Vitest
export const expectNoAccessibilityViolations = (violations: any[]) => {
  if (violations.length > 0) {
    throw new Error(`Accessibility violations found:\n${formatAxeViolations(violations)}`);
  }
};

// Common accessibility test patterns
export const accessibilityTestPatterns = {
  // Test that all interactive elements are keyboard accessible
  keyboardNavigation: async (page: any) => {
    const interactiveElements = await page
      .locator('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')
      .all();

    for (const element of interactiveElements) {
      if (await element.isVisible()) {
        await element.focus();
        // Check if element is focused by evaluating document.activeElement
        const isFocused = await element.evaluate(
          (el: HTMLElement) => document.activeElement === el
        );
        expect(isFocused).toBe(true);
      }
    }
  },

  // Test that all images have alt text
  imageAltText: async (page: any) => {
    const images = await page.locator('img').all();

    for (const img of images) {
      if (await img.isVisible()) {
        const alt = await img.getAttribute('alt');
        expect(alt).toBeDefined();
      }
    }
  },

  // Test that form fields have labels
  formLabels: async (page: any) => {
    const formFields = await page
      .locator('input[type]:not([type="hidden"]), select, textarea')
      .all();

    for (const field of formFields) {
      if (await field.isVisible()) {
        const id = await field.getAttribute('id');
        const ariaLabel = await field.getAttribute('aria-label');
        const ariaLabelledBy = await field.getAttribute('aria-labelledby');

        if (id) {
          const label = page.locator(`label[for="${id}"]`);
          const hasLabel = (await label.count()) > 0;

          expect(hasLabel || ariaLabel || ariaLabelledBy).toBeTruthy();
        } else {
          expect(ariaLabel || ariaLabelledBy).toBeTruthy();
        }
      }
    }
  },

  // Test heading structure
  headingStructure: async (page: any) => {
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();

    expect(headings.length).toBeGreaterThan(0);

    // Check that there's at least one h1
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);

    // Check heading order (simplified check)
    let previousLevel = 0;
    for (const heading of headings) {
      const tagName = await heading.evaluate((el: HTMLElement) => el.tagName);
      const level = parseInt(tagName.charAt(1));

      if (previousLevel > 0) {
        // Heading levels shouldn't skip more than one level
        expect(level - previousLevel).toBeLessThanOrEqual(1);
      }

      previousLevel = level;
    }
  },

  // Test color contrast (basic check)
  colorContrast: async (page: any) => {
    const textElements = await page
      .locator('p, span, div, h1, h2, h3, h4, h5, h6, button, a')
      .all();

    for (const element of textElements.slice(0, 10)) {
      // Check first 10 elements
      if (await element.isVisible()) {
        const styles = await element.evaluate((el: HTMLElement) => {
          const computed = window.getComputedStyle(el);
          return {
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            fontSize: computed.fontSize,
          };
        });

        // Basic check that text has color (not transparent)
        expect(styles.color).not.toBe('rgba(0, 0, 0, 0)');
        expect(styles.color).not.toBe('transparent');
      }
    }
  },
};

/**
 * Create accessibility configuration based on test context
 */
export function createAccessibilityConfig(context: string = 'default') {
  // Map context to severity config
  const contextMap: Record<string, keyof typeof severityConfigs> = {
    form: 'essential',
    component: 'essential',
    page: 'comprehensive',
    e2e: 'e2e',
    unit: 'critical',
    integration: 'comprehensive',
    default: 'essential',
  };

  const configKey = contextMap[context] || 'essential';
  return severityConfigs[configKey];
}
