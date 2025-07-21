#!/usr/bin/env node

import { writeFileSync } from 'fs';

// Get initial memory usage
const initialMemory = process.memoryUsage();

// Memory leak detection function
function checkMemoryUsage(label) {
  global.gc && global.gc(); // Force garbage collection if available
  
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  const externalMB = usage.external / 1024 / 1024;
  const rssGB = usage.rss / 1024 / 1024 / 1024;
  
  return {
    label,
    timestamp: new Date().toISOString(),
    heapUsedMB: Math.round(heapUsedMB * 100) / 100,
    externalMB: Math.round(externalMB * 100) / 100,
    rssGB: Math.round(rssGB * 1000) / 1000,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  };
}

// Simulate memory allocations
const results = [];
results.push(checkMemoryUsage('Initial'));

// Test 1: Array allocation and cleanup
const arrays = [];
for (let i = 0; i < 100; i++) {
  arrays.push(new Array(10000).fill(Math.random()));
}
results.push(checkMemoryUsage('After array allocation'));

// Clear arrays
arrays.length = 0;
await new Promise(resolve => setTimeout(resolve, 100));
results.push(checkMemoryUsage('After array cleanup'));

// Test 2: Object allocation
const objects = new Map();
for (let i = 0; i < 10000; i++) {
  objects.set(i, {
    id: i,
    data: new Array(100).fill(i),
    timestamp: Date.now()
  });
}
results.push(checkMemoryUsage('After object allocation'));

// Clear objects
objects.clear();
await new Promise(resolve => setTimeout(resolve, 100));
results.push(checkMemoryUsage('After object cleanup'));

// Calculate memory leak indicators
const finalMemory = process.memoryUsage();
const heapGrowth = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
const isLeaking = heapGrowth > 10; // More than 10MB growth suggests potential leak

// Generate report
const report = {
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  measurements: results,
  analysis: {
    initialHeapMB: Math.round(initialMemory.heapUsed / 1024 / 1024 * 100) / 100,
    finalHeapMB: Math.round(finalMemory.heapUsed / 1024 / 1024 * 100) / 100,
    heapGrowthMB: Math.round(heapGrowth * 100) / 100,
    potentialLeak: isLeaking,
    status: isLeaking ? 'WARNING' : 'PASS'
  }
};

// Write results
writeFileSync('memory-results.json', JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 2));

// Exit with appropriate code
process.exit(isLeaking ? 1 : 0);