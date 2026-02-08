import { createConfig } from '@austinorphan/e2e-core';

export default createConfig('running-app-mvp', {
  baseURL: 'http://localhost:3000',
  testDir: './tests',
  webServerCommand: 'npm run dev',
  webServerPort: 3000,
  timeout: 30000,
});
