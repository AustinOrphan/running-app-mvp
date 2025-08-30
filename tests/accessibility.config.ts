// Accessibility testing configuration
export const accessibilityConfig = {
  // WCAG compliance levels to test
  wcagLevels: ['wcag2a', 'wcag2aa', 'wcag21aa'],

  // Rules to disable for MVP (can be enabled later)
  disabledRules: [
    'color-contrast', // Disabled until design system is finalized
    'region', // Some components might not need ARIA landmarks in MVP
    'landmark-one-main', // Multiple main elements acceptable in SPA context
    'bypass', // Skip links not required for MVP
    'scrollable-region-focusable', // Might be too strict for data visualizations
  ],

  // Critical rules that must always pass
  criticalRules: [
    'button-name',
    'form-field-multiple-labels',
    'html-has-lang',
    'html-lang-valid',
    'image-alt',
    'input-button-name',
    'input-image-alt',
    'label',
    'link-name',
    'page-has-heading-one',
    'valid-lang',
    'aria-allowed-attr',
    'aria-command-name',
    'aria-hidden-body',
    'aria-hidden-focus',
    'aria-input-field-name',
    'aria-required-attr',
    'aria-required-children',
    'aria-required-parent',
    'aria-roles',
    'aria-valid-attr',
    'aria-valid-attr-value',
    'heading-order',
    'tabindex',
    'duplicate-id-active',
    'duplicate-id-aria',
  ],

  // Environment-specific settings
  testEnvironments: {
    unit: {
      // Lighter rules for unit tests
      tags: ['wcag2a'],
      disableRules: [
        'color-contrast',
        'region',
        'landmark-one-main',
        'bypass',
        'page-has-heading-one', // Not applicable for component tests
      ],
    },
    integration: {
      // Standard rules for integration tests
      tags: ['wcag2a', 'wcag2aa'],
      disableRules: ['color-contrast', 'bypass'],
    },
    e2e: {
      // Full compliance for E2E tests
      tags: ['wcag2a', 'wcag2aa', 'wcag21aa'],
      disableRules: [
        'color-contrast', // Can be enabled when design is finalized
      ],
    },
  },

  // Accessibility patterns and best practices
  patterns: {
    // Minimum touch target size (pixels)
    minTouchTargetSize: 44,

    // Minimum font size for readability (pixels)
    minFontSize: 14,

    // Required ARIA patterns
    requiredAria: {
      buttons: ['aria-label', 'textContent', 'title'],
      links: ['aria-label', 'textContent', 'title'],
      images: ['alt'],
      inputs: ['aria-label', 'aria-labelledby', 'associated-label'],
      headings: ['textContent'],
    },

    // Keyboard navigation requirements
    keyboardNavigation: {
      focusableElements: [
        'button',
        'a[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
        '[role="button"]',
        '[role="link"]',
      ],
      skipKeySequences: ['Tab', 'Shift+Tab', 'Enter', 'Space', 'ArrowUp', 'ArrowDown'],
    },

    // Screen reader requirements
    screenReader: {
      landmarks: ['main', 'nav', 'header', 'footer', 'aside', 'section'],
      headingStructure: {
        mustHaveH1: true,
        maxSkipLevel: 1, // Don't skip more than one heading level
      },
      alternativeText: {
        decorativeImages: { alt: '' },
        meaningfulImages: { alt: 'required' },
        charts: { ariaLabel: 'required', textAlternative: 'recommended' },
      },
    },
  },

  // Test reporting configuration
  reporting: {
    formats: ['json', 'html', 'junit'],
    outputDir: 'test-results/accessibility',
    includeScreenshots: true,
    includeViolationHelp: true,
    severity: {
      critical: ['critical'],
      serious: ['serious'],
      moderate: ['moderate'],
      minor: ['minor'],
    },
  },

  // Performance thresholds for accessibility tests
  performance: {
    maxTestDuration: 30000, // 30 seconds per test
    maxPageLoadTime: 5000, // 5 seconds for page load
    maxAxeRunTime: 3000, // 3 seconds for axe analysis
  },

  // CI/CD integration settings
  ci: {
    failOnViolations: {
      critical: true,
      high: true, // Updated to match axeSetup severity levels
      medium: false, // Warning only
      low: false, // Warning only
      informational: false, // Warning only
    },
    severityMapping: {
      // Map axe-core impacts to our severity levels
      critical: 'critical',
      serious: 'high',
      moderate: 'medium',
      minor: 'low',
    },
    generateReports: true,
    uploadToAccessibilityDashboard: false, // Can be enabled later
  },
};

// Utility functions for accessibility testing
export const accessibilityUtils = {
  // Generate custom axe rules configuration
  generateAxeConfig: (environment: 'unit' | 'integration' | 'e2e') => {
    const envConfig = accessibilityConfig.testEnvironments[environment];
    return {
      rules: Object.fromEntries(
        accessibilityConfig.disabledRules
          .concat(envConfig.disableRules)
          .map(rule => [rule, { enabled: false }])
      ),
      tags: envConfig.tags,
      locale: 'en',
    };
  },

  // Check if violation should fail in CI based on configured severity
  shouldFailInCI: (violation: any) => {
    const severityMapping = accessibilityConfig.ci.severityMapping;
    const mappedSeverity = severityMapping[violation.impact] || 'informational';
    return accessibilityConfig.ci.failOnViolations[mappedSeverity] === true;
  },

  // Check if violation is critical (backward compatibility)
  isCriticalViolation: (violation: any) => {
    return (
      accessibilityConfig.patterns.requiredAria ||
      accessibilityConfig.criticalRules.includes(violation.id) ||
      violation.impact === 'critical'
    );
  },

  // Format violation for better reporting
  formatViolation: (violation: any) => {
    const nodes = violation.nodes.map((node: any) => ({
      target: node.target.join(', '),
      html: node.html,
      failureSummary: node.failureSummary,
      impact: node.impact,
    }));

    return {
      id: violation.id,
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      impact: violation.impact,
      nodes,
      nodeCount: nodes.length,
    };
  },

  // Generate accessibility report summary
  generateSummary: (results: any[]) => {
    const summary = {
      totalViolations: 0,
      byImpact: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      byRule: {} as Record<string, number>,
      passedRules: 0,
      testedRules: 0,
    };

    results.forEach(result => {
      summary.totalViolations += result.violations.length;
      summary.passedRules += result.passes.length;
      summary.testedRules += result.passes.length + result.violations.length;

      result.violations.forEach((violation: any) => {
        summary.byImpact[violation.impact as keyof typeof summary.byImpact]++;
        summary.byRule[violation.id] = (summary.byRule[violation.id] || 0) + 1;
      });
    });

    return summary;
  },
};

export default accessibilityConfig;
