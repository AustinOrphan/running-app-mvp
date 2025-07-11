/**
 * Infrastructure Startup Tests
 * 
 * These tests validate that critical infrastructure files exist
 * and can be loaded to prevent the app from breaking due to
 * missing configuration or server files.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BACKEND_PORT = 3001;
const FRONTEND_PORT = 3000;
const STARTUP_TIMEOUT = 30000; // 30 seconds

describe('Infrastructure Startup Tests', () => {
  describe('Required Files Existence', () => {
    it('should have server.ts entry point', () => {
      const serverPath = path.join(PROJECT_ROOT, 'server.ts');
      expect(existsSync(serverPath), 'server.ts entry point is missing').toBe(true);
    });

    it('should have vite.config.ts configuration', () => {
      const vitePath = path.join(PROJECT_ROOT, 'vite.config.ts');
      expect(existsSync(vitePath), 'vite.config.ts configuration is missing').toBe(true);
    });

    it('should have lib/prisma.ts database client', () => {
      const prismaPath = path.join(PROJECT_ROOT, 'lib/prisma.ts');
      expect(existsSync(prismaPath), 'lib/prisma.ts database client is missing').toBe(true);
    });

    it('should have package.json with required scripts', async () => {
      const packagePath = path.join(PROJECT_ROOT, 'package.json');
      expect(existsSync(packagePath), 'package.json is missing').toBe(true);

      const packageContent = await readFile(packagePath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      const requiredScripts = ['dev', 'dev:frontend', 'dev:full', 'build', 'start'];
      for (const script of requiredScripts) {
        expect(packageJson.scripts[script], `Required script '${script}' is missing`).toBeDefined();
      }
    });

    it('should have tsconfig.json configuration', () => {
      const tsconfigPath = path.join(PROJECT_ROOT, 'tsconfig.json');
      expect(existsSync(tsconfigPath), 'tsconfig.json configuration is missing').toBe(true);
    });

    it('should have prisma schema', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'prisma/schema.prisma');
      expect(existsSync(schemaPath), 'prisma/schema.prisma is missing').toBe(true);
    });
  });

  describe('Configuration File Validation', () => {
    it('should have valid vite.config.ts with API proxy', async () => {
      const vitePath = path.join(PROJECT_ROOT, 'vite.config.ts');
      const viteContent = await readFile(vitePath, 'utf-8');
      
      expect(viteContent, 'vite.config.ts should configure API proxy').toContain('/api');
      expect(viteContent, 'vite.config.ts should have correct backend port').toContain('3001');
    });

    it('should have valid server.ts with required imports', async () => {
      const serverPath = path.join(PROJECT_ROOT, 'server.ts');
      const serverContent = await readFile(serverPath, 'utf-8');
      
      expect(serverContent, 'server.ts should import express').toContain('express');
      expect(serverContent, 'server.ts should import cors').toContain('cors');
      expect(serverContent, 'server.ts should have health endpoint').toContain('/api/health');
      expect(serverContent, 'server.ts should configure port').toContain('PORT');
    });

    it('should have valid lib/prisma.ts with PrismaClient', async () => {
      const prismaPath = path.join(PROJECT_ROOT, 'lib/prisma.ts');
      const prismaContent = await readFile(prismaPath, 'utf-8');
      
      expect(prismaContent, 'lib/prisma.ts should export prisma client').toContain('export const prisma');
      expect(prismaContent, 'lib/prisma.ts should import PrismaClient').toContain('PrismaClient');
    });
  });

  describe('Module Import Validation', () => {
    it('should be able to import server routes', async () => {
      const routeFiles = ['auth.ts', 'runs.ts', 'goals.ts', 'stats.ts', 'races.ts'];
      
      for (const routeFile of routeFiles) {
        const routePath = path.join(PROJECT_ROOT, 'server/routes', routeFile);
        expect(existsSync(routePath), `Route file ${routeFile} is missing`).toBe(true);
      }
    });

    it('should be able to import middleware files', async () => {
      const middlewareFiles = [
        'errorHandler.ts',
        'rateLimiting.ts', 
        'validation.ts',
        'requireAuth.ts',
        'asyncHandler.ts'
      ];
      
      for (const middlewareFile of middlewareFiles) {
        const middlewarePath = path.join(PROJECT_ROOT, 'server/middleware', middlewareFile);
        expect(existsSync(middlewarePath), `Middleware file ${middlewareFile} is missing`).toBe(true);
      }
    });

    it('should be able to import React components', () => {
      const appPath = path.join(PROJECT_ROOT, 'src/App.tsx');
      const mainPath = path.join(PROJECT_ROOT, 'src/main.tsx');
      
      expect(existsSync(appPath), 'src/App.tsx is missing').toBe(true);
      expect(existsSync(mainPath), 'src/main.tsx is missing').toBe(true);
    });
  });

  describe('Environment Configuration', () => {
    it('should have example environment file', () => {
      // Check for any of the common env example files
      const envExampleFiles = ['.env.example', '.env.template', '.env.security.template'];
      const hasEnvExample = envExampleFiles.some(file => 
        existsSync(path.join(PROJECT_ROOT, file))
      );
      
      expect(hasEnvExample, 'No environment example file found').toBe(true);
    });

    it('should have required environment variables documented', async () => {
      const envFiles = ['.env.example', '.env.template', '.env.security.template'];
      let envContent = '';
      
      for (const envFile of envFiles) {
        const envPath = path.join(PROJECT_ROOT, envFile);
        if (existsSync(envPath)) {
          envContent = await readFile(envPath, 'utf-8');
          break;
        }
      }
      
      expect(envContent, 'Environment file should exist').toBeTruthy();
      
      const requiredVars = ['DATABASE_URL', 'JWT_SECRET'];
      for (const envVar of requiredVars) {
        expect(envContent, `Required environment variable ${envVar} should be documented`).toContain(envVar);
      }
    });
  });
});

describe('Server Startup Integration Tests', () => {
  let backendProcess: ChildProcess | null = null;
  let frontendProcess: ChildProcess | null = null;

  afterAll(async () => {
    // Clean up any running processes
    if (backendProcess) {
      backendProcess.kill('SIGTERM');
    }
    if (frontendProcess) {
      frontendProcess.kill('SIGTERM');
    }
  });

  it('should start backend server successfully', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (backendProcess) {
          backendProcess.kill('SIGTERM');
        }
        reject(new Error('Backend server failed to start within timeout'));
      }, STARTUP_TIMEOUT);

      backendProcess = spawn('npm', ['run', 'dev'], {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      let output = '';

      backendProcess.stdout?.on('data', (data) => {
        output += data.toString();
        if (output.includes('Server running on')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      backendProcess.stderr?.on('data', (data) => {
        const error = data.toString();
        if (error.includes('Error') || error.includes('EADDRINUSE')) {
          clearTimeout(timeout);
          reject(new Error(`Backend startup error: ${error}`));
        }
      });

      backendProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Backend process error: ${error.message}`));
      });
    });
  }, STARTUP_TIMEOUT + 5000);

  it('should respond to health check endpoint', async () => {
    // Give the server a moment to fully start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const response = await fetch(`http://localhost:${BACKEND_PORT}/api/health`);
      expect(response.ok, 'Health check endpoint should respond with 200').toBe(true);
      
      const data = await response.json();
      expect(data.status, 'Health check should return status ok').toBe('ok');
      expect(data.timestamp, 'Health check should return timestamp').toBeDefined();
    } catch (error) {
      throw new Error(`Health check failed: ${error}`);
    }
  });

  it('should start frontend server successfully', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (frontendProcess) {
          frontendProcess.kill('SIGTERM');
        }
        reject(new Error('Frontend server failed to start within timeout'));
      }, STARTUP_TIMEOUT);

      frontendProcess = spawn('npm', ['run', 'dev:frontend'], {
        cwd: PROJECT_ROOT,
        stdio: 'pipe'
      });

      let output = '';

      frontendProcess.stdout?.on('data', (data) => {
        output += data.toString();
        if (output.includes('Local:') && output.includes('3000')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      frontendProcess.stderr?.on('data', (data) => {
        const error = data.toString();
        if (error.includes('Error') || error.includes('EADDRINUSE')) {
          clearTimeout(timeout);
          reject(new Error(`Frontend startup error: ${error}`));
        }
      });

      frontendProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Frontend process error: ${error.message}`));
      });
    });
  }, STARTUP_TIMEOUT + 5000);

  it('should serve frontend application', async () => {
    // Give the frontend server a moment to fully start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const response = await fetch(`http://localhost:${FRONTEND_PORT}`);
      expect(response.ok, 'Frontend should respond with 200').toBe(true);
      
      const html = await response.text();
      expect(html, 'Frontend should serve HTML with root div').toContain('<div id="root">');
      expect(html, 'Frontend should have correct title').toContain('Running Tracker');
    } catch (error) {
      throw new Error(`Frontend server test failed: ${error}`);
    }
  });
});