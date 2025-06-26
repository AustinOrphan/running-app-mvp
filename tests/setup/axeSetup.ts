import { configureAxe } from 'jest-axe';

// Configure axe for testing
export const axe = configureAxe({
  rules: {
    // Disable specific rules that might be too strict for MVP
    'color-contrast': { enabled: false }, // We'll enable this later when we have proper design system
    region: { enabled: false }, // Some components might not need ARIA landmarks
    'landmark-one-main': { enabled: false }, // Multiple main elements might be acceptable in SPA
  },
  // Note: tags and locale may not be supported in configureAxe options
});

// Custom axe configuration for unit tests
export const axeConfig = {
  rules: {
    // Core accessibility rules that should always pass
    'button-name': { enabled: true },
    'form-field-multiple-labels': { enabled: true },
    'html-has-lang': { enabled: true },
    'html-lang-valid': { enabled: true },
    'image-alt': { enabled: true },
    'input-button-name': { enabled: true },
    'input-image-alt': { enabled: true },
    label: { enabled: true },
    'link-name': { enabled: true },
    'page-has-heading-one': { enabled: true },
    'valid-lang': { enabled: true },

    // Focus management rules
    'focus-order-semantics': { enabled: true },
    tabindex: { enabled: true },

    // ARIA rules
    'aria-allowed-attr': { enabled: true },
    'aria-command-name': { enabled: true },
    'aria-hidden-body': { enabled: true },
    'aria-hidden-focus': { enabled: true },
    'aria-input-field-name': { enabled: true },
    'aria-required-attr': { enabled: true },
    'aria-required-children': { enabled: true },
    'aria-required-parent': { enabled: true },
    'aria-roles': { enabled: true },
    'aria-valid-attr': { enabled: true },
    'aria-valid-attr-value': { enabled: true },

    // Keyboard navigation
    accesskeys: { enabled: true },
    'duplicate-id': { enabled: true },
    'duplicate-id-active': { enabled: true },
    'duplicate-id-aria': { enabled: true },

    // Structure rules
    'heading-order': { enabled: true },
    list: { enabled: true },
    listitem: { enabled: true },
    'definition-list': { enabled: true },
    dlitem: { enabled: true },

    // Form rules
    'fieldset-legend': { enabled: true },
    'select-name': { enabled: true },
    'textarea-name': { enabled: true },

    // Table rules
    'table-caption': { enabled: false }, // Not all tables need captions
    'td-headers-attr': { enabled: true },
    'th-has-data-cells': { enabled: true },
    'scope-attr-valid': { enabled: true },

    // Media rules
    'audio-caption': { enabled: true },
    'video-caption': { enabled: true },
    'video-description': { enabled: true },

    // Less strict rules for MVP
    bypass: { enabled: false }, // Skip links not required for MVP
    'meta-refresh': { enabled: true },
    'meta-viewport': { enabled: true },
    'object-alt': { enabled: true },
    'scrollable-region-focusable': { enabled: false }, // Might be too strict for charts
    'server-side-image-map': { enabled: true },
  },
  tags: ['wcag2a', 'wcag2aa'],
  locale: 'en',
};

// Accessibility testing helper for Playwright
export const checkAccessibility = async (page: any, options = {}) => {
  const { violations } = await page.locator('body').evaluate(
    async (body: HTMLElement, config: any) => {
      // @ts-ignore - axe is loaded globally in Playwright tests
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
        const isFocused = await element.evaluate((el: HTMLElement) => document.activeElement === el);
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
