import fs from 'fs/promises';
import path from 'path';

import { Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface VisualTestConfig {
  threshold: number; // Pixel difference threshold (0-1)
  includeAA: boolean; // Include anti-aliasing in comparison
  diffDir: string; // Directory for diff images
  baselineDir: string; // Directory for baseline images
  actualDir: string; // Directory for actual screenshots
  updateBaselines: boolean; // Whether to update baselines
}

export const defaultVisualConfig: VisualTestConfig = {
  threshold: 0.2, // 20% pixel difference threshold
  includeAA: true,
  diffDir: 'test-results/visual-diffs',
  baselineDir: 'tests/visual-baselines',
  actualDir: 'test-results/visual-actual',
  updateBaselines: false,
};

export class VisualTestHelper {
  constructor(private config: VisualTestConfig = defaultVisualConfig) {}

  async ensureDirectories() {
    await fs.mkdir(this.config.diffDir, { recursive: true });
    await fs.mkdir(this.config.baselineDir, { recursive: true });
    await fs.mkdir(this.config.actualDir, { recursive: true });
  }

  async takeScreenshot(
    page: Page,
    name: string,
    options: {
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      mask?: string[];
      animations?: 'disabled' | 'allow';
    } = {}
  ): Promise<Buffer> {
    // Ensure consistent screenshots
    if (options.animations !== 'allow') {
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
          }
        `,
      });
    }

    // Hide dynamic elements that change between runs
    const defaultMasks = [
      '[data-testid="timestamp"]',
      '.timestamp',
      '.current-time',
      '.last-updated',
      '[data-dynamic="true"]',
    ];

    const allMasks = [...defaultMasks, ...(options.mask || [])];

    for (const mask of allMasks) {
      await page
        .locator(mask)
        .evaluateAll(elements => {
          elements.forEach(el => ((el as HTMLElement).style.visibility = 'hidden'));
        })
        .catch(() => {}); // Ignore if selector doesn't exist
    }

    const screenshot = await page.screenshot({
      fullPage: options.fullPage ?? true,
      clip: options.clip,
      type: 'png',
    });

    // Save actual screenshot
    const actualPath = path.join(this.config.actualDir, `${name}.png`);
    await fs.writeFile(actualPath, screenshot);

    return screenshot;
  }

  async compareScreenshots(
    name: string,
    actualScreenshot: Buffer
  ): Promise<{
    matches: boolean;
    diffPixels: number;
    totalPixels: number;
    diffPercentage: number;
    diffImagePath?: string;
  }> {
    await this.ensureDirectories();

    const baselinePath = path.join(this.config.baselineDir, `${name}.png`);
    const diffPath = path.join(this.config.diffDir, `${name}-diff.png`);

    // Check if baseline exists
    let baselineExists = false;
    try {
      await fs.access(baselinePath);
      baselineExists = true;
    } catch {
      baselineExists = false;
    }

    if (!baselineExists) {
      if (this.config.updateBaselines) {
        // Create baseline
        await fs.writeFile(baselinePath, actualScreenshot);
        return {
          matches: true,
          diffPixels: 0,
          totalPixels: 0,
          diffPercentage: 0,
        };
      } else {
        throw new Error(
          `Baseline image not found: ${baselinePath}. Run with updateBaselines=true to create it.`
        );
      }
    }

    // Load baseline and actual images
    const baselineBuffer = await fs.readFile(baselinePath);
    const baseline = PNG.sync.read(baselineBuffer);
    const actual = PNG.sync.read(actualScreenshot);

    // Ensure images are the same size
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      throw new Error(
        `Image dimensions don't match. Baseline: ${baseline.width}x${baseline.height}, Actual: ${actual.width}x${actual.height}`
      );
    }

    // Create diff image
    const diff = new PNG({ width: baseline.width, height: baseline.height });
    const diffPixels = pixelmatch(
      baseline.data,
      actual.data,
      diff.data,
      baseline.width,
      baseline.height,
      {
        threshold: this.config.threshold,
        includeAA: this.config.includeAA,
        diffColor: [255, 0, 0], // Red for differences
        diffColorAlt: [0, 255, 0], // Green for anti-aliasing differences
      }
    );

    const totalPixels = baseline.width * baseline.height;
    const diffPercentage = (diffPixels / totalPixels) * 100;

    // Save diff image if there are differences
    if (diffPixels > 0) {
      await fs.writeFile(diffPath, PNG.sync.write(diff));
    }

    return {
      matches: diffPixels === 0,
      diffPixels,
      totalPixels,
      diffPercentage,
      diffImagePath: diffPixels > 0 ? diffPath : undefined,
    };
  }

  async expectVisualMatch(
    page: Page,
    name: string,
    options: {
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      mask?: string[];
      animations?: 'disabled' | 'allow';
      maxDiffPercent?: number;
    } = {}
  ): Promise<void> {
    const maxDiffPercent = options.maxDiffPercent ?? 1; // 1% default tolerance

    const screenshot = await this.takeScreenshot(page, name, options);
    const comparison = await this.compareScreenshots(name, screenshot);

    if (!comparison.matches && comparison.diffPercentage > maxDiffPercent) {
      const message = `Visual regression detected for "${name}":
        - Diff pixels: ${comparison.diffPixels}
        - Total pixels: ${comparison.totalPixels}
        - Diff percentage: ${comparison.diffPercentage.toFixed(2)}%
        - Max allowed: ${maxDiffPercent}%
        ${comparison.diffImagePath ? `- Diff image: ${comparison.diffImagePath}` : ''}
        
        To update the baseline, run tests with updateBaselines=true`;

      throw new Error(message);
    }
  }

  async updateBaseline(name: string, screenshot: Buffer): Promise<void> {
    await this.ensureDirectories();
    const baselinePath = path.join(this.config.baselineDir, `${name}.png`);
    await fs.writeFile(baselinePath, screenshot);
  }

  // Utility method for consistent page setup
  async setupPageForVisualTesting(page: Page): Promise<void> {
    // Disable animations
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
        
        /* Hide scrollbars for consistent screenshots */
        ::-webkit-scrollbar {
          display: none;
        }
        
        /* Ensure consistent font rendering */
        * {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
      `,
    });

    // Set consistent viewport
    await page.setViewportSize({ width: 1280, height: 720 });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);
  }

  // Generate visual test report
  async generateReport(): Promise<void> {
    const reportPath = path.join(this.config.diffDir, 'visual-regression-report.html');

    const diffFiles = await fs.readdir(this.config.diffDir);
    const diffImages = diffFiles.filter(file => file.endsWith('-diff.png'));

    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Visual Regression Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .test-result { margin: 20px 0; padding: 20px; border: 1px solid #ddd; }
        .test-result.pass { border-color: #4caf50; background: #f1f8e9; }
        .test-result.fail { border-color: #f44336; background: #ffebee; }
        .diff-images { display: flex; gap: 20px; flex-wrap: wrap; }
        .diff-image { text-align: center; }
        .diff-image img { max-width: 300px; border: 1px solid #ccc; }
        h1 { color: #333; }
        h2 { color: #666; }
    </style>
</head>
<body>
    <h1>Visual Regression Test Report</h1>
    <p>Generated: ${new Date().toISOString()}</p>
    
    ${
      diffImages.length === 0
        ? '<div class="test-result pass"><h2>✅ All Visual Tests Passed</h2><p>No visual regressions detected.</p></div>'
        : diffImages
            .map(diffFile => {
              const testName = diffFile.replace('-diff.png', '');
              const actualFile = `../visual-actual/${testName}.png`;
              const baselineFile = `../visual-baselines/${testName}.png`;

              return `
          <div class="test-result fail">
            <h2>❌ Visual Regression: ${testName}</h2>
            <div class="diff-images">
              <div class="diff-image">
                <h3>Baseline</h3>
                <img src="${baselineFile}" alt="Baseline" onerror="this.style.display='none'">
              </div>
              <div class="diff-image">
                <h3>Actual</h3>
                <img src="${actualFile}" alt="Actual" onerror="this.style.display='none'">
              </div>
              <div class="diff-image">
                <h3>Difference</h3>
                <img src="${diffFile}" alt="Difference">
              </div>
            </div>
          </div>
        `;
            })
            .join('')
    }
</body>
</html>
    `;

    await fs.writeFile(reportPath, html);
    console.log(`Visual regression report generated: ${reportPath}`);
  }
}

// Global helper functions
export const visualTest = new VisualTestHelper();

export const expectToMatchVisualBaseline = async (
  page: Page,
  name: string,
  options?: Parameters<VisualTestHelper['expectVisualMatch']>[2]
) => {
  await visualTest.expectVisualMatch(page, name, options);
};

// Environment-specific configurations
export const visualConfigs = {
  ci: {
    ...defaultVisualConfig,
    threshold: 0.1, // Stricter in CI
    updateBaselines: false,
  },

  local: {
    ...defaultVisualConfig,
    threshold: 0.3, // More lenient locally
    updateBaselines: process.env.UPDATE_VISUAL_BASELINES === 'true',
  },

  mobile: {
    ...defaultVisualConfig,
    threshold: 0.25, // Slightly more lenient for mobile due to rendering differences
  },

  strict: {
    ...defaultVisualConfig,
    threshold: 0.05, // Very strict for critical UI elements
    includeAA: false,
  },
};

export default VisualTestHelper;
