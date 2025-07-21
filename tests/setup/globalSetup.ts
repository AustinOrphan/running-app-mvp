import { execSync } from 'child_process';
import { resolve } from 'path';

export default async function globalSetup(): Promise<() => void> {
  const rootDir = resolve(process.cwd());
  
  // Set test environment
  process.env.DATABASE_URL = 'file:./prisma/test.db';
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.NODE_ENV = 'test';
  
  try {
    // Generate Prisma client
    execSync('npx prisma generate', {
      stdio: 'inherit',
      cwd: rootDir,
      env: process.env
    });
    
    // Run migrations
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit', 
      cwd: rootDir,
      env: process.env
    });
    
    return () => {
      // Teardown if needed
    };
  } catch (error) {
    throw new Error(\`Failed to setup test database: \${error}\`);
  }
}
