#!/usr/bin/env node

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Load performance thresholds
let thresholds;
try {
  const thresholdsPath = join(projectRoot, 'performance-thresholds.json');
  thresholds = JSON.parse(readFileSync(thresholdsPath, 'utf8'));
} catch (error) {
  console.error('Error loading performance thresholds:', error.message);
  process.exit(1);
}

// Check if dist directory exists
const distPath = join(projectRoot, 'dist');
if (!existsSync(distPath)) {
  console.error('dist directory not found. Please run "npm run build" first.');
  process.exit(1);
}

// Function to get file size in bytes
function getFileSize(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
}

// Function to find files by pattern
function findFiles(dir, pattern) {
  const files = [];
  try {
    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      const stats = statSync(fullPath);
      if (stats.isFile() && pattern.test(item)) {
        files.push({ name: item, path: fullPath, size: stats.size });
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }
  return files;
}

// Find JavaScript files in assets directory
const assetsPath = join(distPath, 'assets');
const jsFiles = findFiles(assetsPath, /\.js$/);
const cssFiles = findFiles(assetsPath, /\.css$/);

// Categorize files
let mainBundle = { size: 0, files: [] };
let vendorBundle = { size: 0, files: [] };
let otherBundles = { size: 0, files: [] };

jsFiles.forEach(file => {
  if (file.name.includes('vendor') || file.name.includes('chunk')) {
    vendorBundle.size += file.size;
    vendorBundle.files.push(file);
  } else {
    // Treat all other JS files as main bundle
    mainBundle.size += file.size;
    mainBundle.files.push(file);
  }
});

const totalJsSize = mainBundle.size + vendorBundle.size + otherBundles.size;
const totalCssSize = cssFiles.reduce((sum, file) => sum + file.size, 0);
const totalSize = totalJsSize + totalCssSize;

// Generate report
const report = {
  timestamp: new Date().toISOString(),
  bundleSizes: {
    main: mainBundle.size,
    vendor: vendorBundle.size,
    other: otherBundles.size,
    css: totalCssSize,
    totalJs: totalJsSize,
    total: totalSize,
  },
  files: {
    js: jsFiles.length,
    css: cssFiles.length,
    total: jsFiles.length + cssFiles.length,
  },
  thresholds: thresholds.bundleSize,
  violations: [],
};

// Check against thresholds
function checkThreshold(value, threshold, name) {
  if (value > threshold.max) {
    report.violations.push({
      type: 'error',
      bundle: name,
      actual: value,
      threshold: threshold.max,
      message: `${name} bundle size (${(value / 1024).toFixed(2)}KB) exceeds maximum threshold (${(threshold.max / 1024).toFixed(2)}KB)`,
    });
  } else if (value > threshold.warning) {
    report.violations.push({
      type: 'warning',
      bundle: name,
      actual: value,
      threshold: threshold.warning,
      message: `${name} bundle size (${(value / 1024).toFixed(2)}KB) exceeds warning threshold (${(threshold.warning / 1024).toFixed(2)}KB)`,
    });
  }
}

checkThreshold(mainBundle.size, thresholds.bundleSize.main, 'main');
checkThreshold(vendorBundle.size, thresholds.bundleSize.vendor, 'vendor');
checkThreshold(totalSize, thresholds.bundleSize.total, 'total');

// Output results
console.log('Bundle Size Analysis');
console.log('===================');
console.log(
  `Main bundle: ${(mainBundle.size / 1024).toFixed(2)}KB (${mainBundle.files.length} files)`
);
console.log(
  `Vendor bundle: ${(vendorBundle.size / 1024).toFixed(2)}KB (${vendorBundle.files.length} files)`
);
console.log(
  `Other bundles: ${(otherBundles.size / 1024).toFixed(2)}KB (${otherBundles.files.length} files)`
);
console.log(`CSS files: ${(totalCssSize / 1024).toFixed(2)}KB (${cssFiles.length} files)`);
console.log(`Total: ${(totalSize / 1024).toFixed(2)}KB`);
console.log('');

if (report.violations.length > 0) {
  console.log('Threshold Violations:');
  console.log('====================');
  report.violations.forEach(violation => {
    const emoji = violation.type === 'error' ? '❌' : '⚠️';
    console.log(`${emoji} ${violation.message}`);
  });
  console.log('');

  // Exit with error code if there are any errors (not warnings)
  const hasErrors = report.violations.some(v => v.type === 'error');
  if (hasErrors) {
    console.log('❌ Bundle size check failed due to threshold violations.');
    process.exit(1);
  } else {
    console.log('⚠️ Bundle size check passed with warnings.');
  }
} else {
  console.log('✅ All bundle sizes are within thresholds.');
}

// Save detailed report
try {
  const reportPath = join(projectRoot, 'bundle-size-report.json');
  const fs = await import('fs');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📊 Detailed report saved to: bundle-size-report.json`);
} catch (error) {
  console.error('Error saving report:', error.message);
}

process.exit(0);
