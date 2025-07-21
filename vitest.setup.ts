import { vi } from 'vitest';

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
