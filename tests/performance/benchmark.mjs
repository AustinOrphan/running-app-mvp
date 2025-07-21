#!/usr/bin/env node

import { performance } from 'perf_hooks';
import { writeFileSync } from 'fs';

// Simple benchmark runner
async function benchmark(name, fn, iterations = 1000) {
  const times = [];
  
  // Warmup
  for (let i = 0; i < 10; i++) {
    await fn();
  }
  
  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }
  
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p90 = times[Math.floor(times.length * 0.9)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const avg = times.reduce((sum, time) => sum + time, 0) / times.length;
  
  return { name, avg, p50, p90, p99, iterations };
}

// Run benchmarks
const results = await Promise.all([
  benchmark('Array operations', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    return arr.map(x => x * 2).filter(x => x % 3 === 0);
  }),
  
  benchmark('Object manipulation', () => {
    const objs = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      value: Math.random()
    }));
    return objs.reduce((acc, obj) => acc + obj.value, 0);
  }),
  
  benchmark('String operations', () => {
    const parts = Array.from({ length: 100 }, (_, i) => `Part ${i}`);
    return parts.join(' | ');
  })
]);

// Write results
const report = {
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  benchmarks: results,
  summary: {
    totalBenchmarks: results.length,
    averageTime: results.reduce((sum, r) => sum + r.avg, 0) / results.length
  }
};

writeFileSync('performance-results.json', JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 2));
process.exit(0);