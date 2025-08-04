#!/usr/bin/env tsx

/**
 * Server Readiness Utility for Performance Tests
 * Ensures both frontend and backend servers are ready before running Lighthouse CI
 */

import { execSync } from 'child_process';

interface ServerReadinessOptions {
  frontendUrl?: string;
  backendUrl?: string;
  maxAttempts?: number;
  delayMs?: number;
  healthcheckPath?: string;
  verbose?: boolean;
}

export class ServerReadinessChecker {
  private frontendUrl: string;
  private backendUrl: string;
  private maxAttempts: number;
  private delayMs: number;
  private healthcheckPath: string;
  private verbose: boolean;

  constructor(options: ServerReadinessOptions = {}) {
    this.frontendUrl = options.frontendUrl || 'http://localhost:3000';
    this.backendUrl = options.backendUrl || 'http://localhost:3001';
    this.maxAttempts = options.maxAttempts || 30;
    this.delayMs = options.delayMs || 2000;
    this.healthcheckPath = options.healthcheckPath || '/api/health';
    this.verbose = options.verbose || false;
  }

  /**
   * Wait for both frontend and backend servers to be ready
   */
  async waitForServersReady(): Promise<boolean> {
    if (this.verbose) {
      console.log('🔍 Checking server readiness for performance tests...');
    }

    const frontendReady = await this.waitForFrontendServer();
    const backendReady = await this.waitForBackendServer();

    if (frontendReady && backendReady) {
      // Additional stabilization wait
      if (this.verbose) {
        console.log('⏳ Allowing servers to stabilize...');
      }
      await this.delay(3000);
      
      // Verify page load completion
      const pageReady = await this.verifyPageLoadComplete();
      
      if (pageReady) {
        if (this.verbose) {
          console.log('✅ All servers ready and page load verified');
        }
        return true;
      }
    }

    console.error('❌ Server readiness check failed');
    return false;
  }

  /**
   * Wait for frontend server to be ready
   */
  private async waitForFrontendServer(): Promise<boolean> {
    if (this.verbose) {
      console.log(`🌐 Waiting for frontend server at ${this.frontendUrl}...`);
    }

    for (let i = 1; i <= this.maxAttempts; i++) {
      try {
        const response = await fetch(this.frontendUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          if (this.verbose) {
            console.log(`✅ Frontend server is ready (attempt ${i})`);
          }
          return true;
        }
      } catch (error) {
        if (i === this.maxAttempts) {
          console.error(`❌ Frontend server not available after ${this.maxAttempts} attempts`);
          return false;
        }
        
        if (this.verbose) {
          console.log(`⏳ Waiting for frontend server... (attempt ${i}/${this.maxAttempts})`);
        }
        await this.delay(this.delayMs);
      }
    }

    return false;
  }

  /**
   * Wait for backend server to be ready
   */
  private async waitForBackendServer(): Promise<boolean> {
    if (this.verbose) {
      console.log(`🔧 Waiting for backend server at ${this.backendUrl}${this.healthcheckPath}...`);
    }

    for (let i = 1; i <= this.maxAttempts; i++) {
      try {
        const response = await fetch(`${this.backendUrl}${this.healthcheckPath}`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          const healthData = await response.json();
          
          // Verify health check response indicates ready state
          if (healthData.status === 'ok' || healthData.healthy === true) {
            if (this.verbose) {
              console.log(`✅ Backend server is ready (attempt ${i})`);
            }
            return true;
          }
        }
      } catch (error) {
        if (i === this.maxAttempts) {
          console.error(`❌ Backend server not available after ${this.maxAttempts} attempts`);
          return false;
        }
        
        if (this.verbose) {
          console.log(`⏳ Waiting for backend server... (attempt ${i}/${this.maxAttempts})`);
        }
        await this.delay(this.delayMs);
      }
    }

    return false;
  }

  /**
   * Verify that the page loads completely with all critical resources
   */
  private async verifyPageLoadComplete(): Promise<boolean> {
    if (this.verbose) {
      console.log('🔍 Verifying page load completion...');
    }

    try {
      // Use a more sophisticated check with resource timing
      const response = await fetch(this.frontendUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        console.error('❌ Page failed to load with valid response');
        return false;
      }

      const html = await response.text();
      
      // Check for critical page elements
      const hasCriticalElements = [
        '<html',
        '<head>',
        '<body',
        '</html>',
      ].every(element => html.includes(element));

      if (!hasCriticalElements) {
        console.error('❌ Page HTML is missing critical elements');
        return false;
      }

      // Check for common error indicators
      const hasErrors = [
        'Cannot GET',
        'Internal Server Error',
        '404 Not Found',
        'Application Error',
      ].some(error => html.includes(error));

      if (hasErrors) {
        console.error('❌ Page contains error indicators');
        return false;
      }

      if (this.verbose) {
        console.log('✅ Page load completion verified');
      }
      return true;

    } catch (error) {
      console.error('❌ Failed to verify page load completion:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Check if the process is already listening on the given port
   */
  private isPortInUse(port: number): boolean {
    try {
      const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: 'pipe' });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get port from URL
   */
  private getPortFromUrl(url: string): number {
    try {
      const urlObj = new URL(url);
      return parseInt(urlObj.port) || (urlObj.protocol === 'https:' ? 443 : 80);
    } catch {
      return 3000; // fallback
    }
  }

  /**
   * Check if servers are already running
   */
  async checkExistingServers(): Promise<{ frontend: boolean; backend: boolean }> {
    const frontendPort = this.getPortFromUrl(this.frontendUrl);
    const backendPort = this.getPortFromUrl(this.backendUrl);

    return {
      frontend: this.isPortInUse(frontendPort),
      backend: this.isPortInUse(backendPort),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * CLI interface for the server readiness checker
 */
async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
  
  const checker = new ServerReadinessChecker({
    frontendUrl,
    backendUrl,
    verbose,
  });

  console.log('🚀 Starting server readiness check...');
  
  // Check if servers are already running
  const existing = await checker.checkExistingServers();
  if (verbose) {
    console.log(`📊 Current server status - Frontend: ${existing.frontend ? '✅' : '❌'}, Backend: ${existing.backend ? '✅' : '❌'}`);
  }

  const ready = await checker.waitForServersReady();
  
  if (ready) {
    console.log('✅ Server readiness check completed successfully');
    process.exit(0);
  } else {
    console.error('❌ Server readiness check failed');
    process.exit(1);
  }
}

// Only run main if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Server readiness check failed:', error);
    process.exit(1);
  });
}

