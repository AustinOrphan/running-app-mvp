import { vi } from 'vitest';
import { ensurePrismaClient } from './tests/setup/prismaSetup.js';

// Add polyfills for CI environment
if (typeof global !== 'undefined') {
  // Polyfill for TextEncoder/TextDecoder in older Node.js versions
  if (!global.TextEncoder) {
    const { TextEncoder, TextDecoder } = require('util');
    global.TextEncoder = TextEncoder;
    global.TextDecoder = TextDecoder;
  }

  // Polyfill for structuredClone in Node.js < 17
  if (!global.structuredClone) {
    global.structuredClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj)) as T;
  }

  // Polyfill for crypto.randomUUID in older environments
  if (!global.crypto) {
    global.crypto = {
      randomUUID: () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      },
    } as Crypto;
  }
}

// Mock CSS modules
vi.mock('*.module.css', () => {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === '__esModule' || key === 'default') {
          return new Proxy(
            {},
            {
              get: (_t, k) => String(k),
            }
          );
        }
        return String(key);
      },
    }
  );
});

// Ensure Prisma client is available for Vitest tests
// This runs before any test suites
(async () => {
  try {
    await ensurePrismaClient();
  } catch (error) {
    console.warn('Warning: Failed to ensure Prisma client in vitest setup:', error);
    // Don't fail setup - let individual tests handle Prisma availability
  }
})();
