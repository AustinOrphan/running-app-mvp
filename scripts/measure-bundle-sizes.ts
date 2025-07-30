#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as zlib from 'zlib';

interface BundleSizeResult {
  file: string;
  size: number;
  gzipSize: number;
  brotliSize: number;
  type: 'javascript' | 'css' | 'image' | 'font' | 'other';
  category: string;
  threshold: { max: number; warning: number };
  status: 'pass' | 'warning' | 'fail';
}

interface BundleSizeReport {
  timestamp: Date;
  buildPath: string;
  results: BundleSizeResult[];
  summary: {
    totalSize: number;
    totalGzipSize: number;
    totalBrotliSize: number;
    byType: Record<string, { size: number; gzipSize: number; brotliSize: number; count: number }>;
    violations: {
      failures: number;
      warnings: number;
    };
  };
}

class BundleSizeMeasurer {
  private buildPath: string;
  private thresholds: any;

  constructor(buildPath: string = 'dist') {
    this.buildPath = buildPath;
    this.loadThresholds();
  }

  private loadThresholds(): void {
    const thresholdPath = path.join(process.cwd(), 'performance-thresholds-detailed.json');
    if (fs.existsSync(thresholdPath)) {
      const content = fs.readFileSync(thresholdPath, 'utf-8');
      this.thresholds = JSON.parse(content);
    } else {
      console.error('Threshold file not found. Using defaults.');
      this.thresholds = { bundleSize: {} };
    }
  }

  private getFileType(filePath: string): 'javascript' | 'css' | 'image' | 'font' | 'other' {
    const ext = path.extname(filePath).toLowerCase();
    if (['.js', '.mjs', '.cjs'].includes(ext)) return 'javascript';
    if (['.css', '.scss', '.sass'].includes(ext)) return 'css';
    if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif'].includes(ext)) return 'image';
    if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'font';
    return 'other';
  }

  private getFileCategory(filePath: string): string {
    const filename = path.basename(filePath);
    if (filename.includes('vendor') || filename.includes('chunk')) return 'vendor';
    if (filename.includes('main') || filename.includes('app')) return 'main';
    if (filename.includes('polyfill')) return 'polyfill';
    return 'other';
  }

  private compressFile(content: Buffer): { gzipSize: number; brotliSize: number } {
    const gzipSize = zlib.gzipSync(content, { level: 9 }).length;
    const brotliSize = zlib.brotliCompressSync(content, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
    return { gzipSize, brotliSize };
  }

  private getThreshold(
    type: string,
    category: string,
    metric: 'uncompressed' | 'gzipped' | 'brotli'
  ): { max: number; warning: number } {
    const defaultThreshold = { max: 1000000, warning: 800000 }; // 1MB max, 800KB warning

    try {
      const typeThresholds = this.thresholds.bundleSize[type];
      if (!typeThresholds) return defaultThreshold;

      const categoryThresholds = typeThresholds[category];
      if (!categoryThresholds) return defaultThreshold;

      const metricThresholds = categoryThresholds[metric] || categoryThresholds;
      if (!metricThresholds) return defaultThreshold;

      // Convert KB to bytes if unit is specified
      const multiplier = metricThresholds.unit === 'KB' ? 1024 : 1;
      return {
        max: metricThresholds.max * multiplier,
        warning: metricThresholds.warning * multiplier,
      };
    } catch {
      return defaultThreshold;
    }
  }

  private getAllFiles(dir: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dir)) return fileList;

    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        this.getAllFiles(filePath, fileList);
      } else {
        fileList.push(filePath);
      }
    });
    return fileList;
  }

  async measureBundles(): Promise<BundleSizeReport> {
    const allFiles = this.getAllFiles(this.buildPath);
    const results: BundleSizeResult[] = [];

    console.log('\n📦 Measuring Bundle Sizes...\n');

    for (const filePath of allFiles) {
      const relativePath = path.relative(this.buildPath, filePath);
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath);
      const { gzipSize, brotliSize } = this.compressFile(content);

      const type = this.getFileType(filePath);
      const category = this.getFileCategory(filePath);

      // Get appropriate threshold
      const threshold =
        type === 'javascript' || type === 'css'
          ? this.getThreshold(type, category, 'gzipped')
          : this.getThreshold(type, 'total', 'uncompressed');

      let status: 'pass' | 'warning' | 'fail' = 'pass';
      const sizeToCheck = type === 'javascript' || type === 'css' ? gzipSize : stats.size;

      if (sizeToCheck > threshold.max) {
        status = 'fail';
      } else if (sizeToCheck > threshold.warning) {
        status = 'warning';
      }

      results.push({
        file: relativePath,
        size: stats.size,
        gzipSize,
        brotliSize,
        type,
        category,
        threshold,
        status,
      });

      const statusEmoji = status === 'pass' ? '✅' : status === 'warning' ? '⚠️' : '❌';
      console.log(
        `${statusEmoji} ${relativePath}: ${(stats.size / 1024).toFixed(2)}KB (gzip: ${(gzipSize / 1024).toFixed(2)}KB)`
      );
    }

    // Calculate summary
    const summary = {
      totalSize: results.reduce((sum, r) => sum + r.size, 0),
      totalGzipSize: results.reduce((sum, r) => sum + r.gzipSize, 0),
      totalBrotliSize: results.reduce((sum, r) => sum + r.brotliSize, 0),
      byType: {} as Record<
        string,
        { size: number; gzipSize: number; brotliSize: number; count: number }
      >,
      violations: {
        failures: results.filter(r => r.status === 'fail').length,
        warnings: results.filter(r => r.status === 'warning').length,
      },
    };

    // Group by type
    results.forEach(result => {
      if (!summary.byType[result.type]) {
        summary.byType[result.type] = { size: 0, gzipSize: 0, brotliSize: 0, count: 0 };
      }
      summary.byType[result.type].size += result.size;
      summary.byType[result.type].gzipSize += result.gzipSize;
      summary.byType[result.type].brotliSize += result.brotliSize;
      summary.byType[result.type].count += 1;
    });

    return {
      timestamp: new Date(),
      buildPath: this.buildPath,
      results,
      summary,
    };
  }

  async analyzeBundleComposition(): Promise<void> {
    const jsFiles = this.getAllFiles(this.buildPath).filter(f => f.endsWith('.js'));

    console.log('\n🔍 Analyzing Bundle Composition...\n');

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const stats = {
        totalSize: content.length,
        comments: (content.match(/\/\*[\s\S]*?\*\/|\/\/.*/g) || []).join('').length,
        whitespace: (content.match(/\s+/g) || []).join('').length,
        imports: (content.match(/import\s+.*?from\s+['"].*?['"]/g) || []).length,
        functions: (content.match(/function\s+\w+|=>\s*{|=>\s*\(/g) || []).length,
      };

      console.log(`${path.basename(file)}:`);
      console.log(`  Total Size: ${(stats.totalSize / 1024).toFixed(2)}KB`);
      console.log(`  Comments: ${((stats.comments / stats.totalSize) * 100).toFixed(1)}%`);
      console.log(`  Whitespace: ${((stats.whitespace / stats.totalSize) * 100).toFixed(1)}%`);
      console.log(`  Imports: ${stats.imports}`);
      console.log(`  Functions: ${stats.functions}`);
    }
  }

  generateReport(report: BundleSizeReport): void {
    console.log('\n📊 Bundle Size Report\n');
    console.log(`Build Path: ${report.buildPath}`);
    console.log(`Timestamp: ${report.timestamp.toISOString()}`);

    console.log('\nTotal Sizes:');
    console.log(`  Uncompressed: ${(report.summary.totalSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Gzipped: ${(report.summary.totalGzipSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Brotli: ${(report.summary.totalBrotliSize / 1024 / 1024).toFixed(2)}MB`);

    console.log('\nBy Type:');
    Object.entries(report.summary.byType).forEach(([type, stats]) => {
      console.log(`  ${type}:`);
      console.log(`    Files: ${stats.count}`);
      console.log(`    Size: ${(stats.size / 1024).toFixed(2)}KB`);
      console.log(`    Gzip: ${(stats.gzipSize / 1024).toFixed(2)}KB`);
    });

    if (report.summary.violations.failures > 0) {
      console.log('\n❌ Size Limit Violations:');
      report.results
        .filter(r => r.status === 'fail')
        .forEach(r => {
          const size = r.type === 'javascript' || r.type === 'css' ? r.gzipSize : r.size;
          console.log(
            `  ${r.file}: ${(size / 1024).toFixed(2)}KB (max: ${(r.threshold.max / 1024).toFixed(2)}KB)`
          );
        });
    }

    if (report.summary.violations.warnings > 0) {
      console.log('\n⚠️  Size Warnings:');
      report.results
        .filter(r => r.status === 'warning')
        .forEach(r => {
          const size = r.type === 'javascript' || r.type === 'css' ? r.gzipSize : r.size;
          console.log(
            `  ${r.file}: ${(size / 1024).toFixed(2)}KB (warning: ${(r.threshold.warning / 1024).toFixed(2)}KB)`
          );
        });
    }

    // Save report
    const reportPath = path.join(
      process.cwd(),
      'performance-reports',
      `bundle-sizes-${Date.now()}.json`
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Full report saved to: ${reportPath}`);
  }

  async generateWebpackAnalysis(): Promise<void> {
    console.log('\n🔧 Generating Webpack Bundle Analysis...\n');

    try {
      // Check if webpack-bundle-analyzer is installed
      execSync('npm list webpack-bundle-analyzer', { stdio: 'ignore' });

      // Generate stats file
      console.log('Building with stats...');
      execSync('npm run build -- --stats', { stdio: 'inherit' });

      // Analyze bundle
      console.log('Analyzing bundle...');
      execSync('npx webpack-bundle-analyzer dist/stats.json', { stdio: 'inherit' });
    } catch (error) {
      console.log('webpack-bundle-analyzer not installed. Skipping visual analysis.');
      console.log('Install with: npm install --save-dev webpack-bundle-analyzer');
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const buildPath = args[0] || 'dist';
  const analyze = args.includes('--analyze');

  const measurer = new BundleSizeMeasurer(buildPath);

  try {
    // Measure bundle sizes
    const report = await measurer.measureBundles();
    measurer.generateReport(report);

    // Additional analysis
    if (analyze) {
      await measurer.analyzeBundleComposition();
      await measurer.generateWebpackAnalysis();
    }

    // Exit with error if there are failures
    if (report.summary.violations.failures > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error measuring bundle sizes:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { BundleSizeMeasurer, BundleSizeReport, BundleSizeResult };
