/**
 * Platform Compatibility Test Examples
 *
 * This file demonstrates how to use the platform utilities
 * to write cross-platform compatible tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { platformUtils } from '../utils/platformUtils';
import {
  createTestDatabaseConfig,
  normalizeTestOutput,
  waitForPlatformOperation,
} from '../setup/platformSetup';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('Platform Compatibility Examples', () => {
  let testDbConfig: ReturnType<typeof createTestDatabaseConfig>;

  beforeAll(async () => {
    // Setup platform-specific test environment
    testDbConfig = createTestDatabaseConfig();
    console.log(`Running tests on ${platformUtils.getPlatformInfo().platform}`);
  });

  afterAll(async () => {
    // Platform-aware cleanup
    await testDbConfig.cleanup();
  });

  describe('File System Operations', () => {
    it('should handle cross-platform paths correctly', () => {
      const unixPath = 'tests/utils/file.ts';
      const platformPath = platformUtils.toPlatformPath(unixPath);
      const normalizedPath = platformUtils.normalizePath(platformPath);

      expect(normalizedPath).toBeDefined();
      expect(normalizedPath).toContain('file.ts');

      // Convert back to Unix style for comparison
      const backToUnix = platformUtils.toUnixPath(normalizedPath);
      expect(backToUnix).toBe(unixPath);
    });

    it('should create platform-appropriate temporary files', async () => {
      const tempFile = platformUtils.createTempFilePath('test-file', 'txt');

      expect(tempFile).toBeDefined();
      expect(tempFile).toContain('test-file.txt');

      // Write and read file to verify path works
      await fs.writeFile(tempFile, 'test content');
      const content = await fs.readFile(tempFile, 'utf-8');
      expect(content).toBe('test content');

      // Cleanup
      await fs.unlink(tempFile);
    });

    it('should wait for files with platform-appropriate timing', async () => {
      const tempFile = platformUtils.createTempFilePath('delayed-file', 'txt');

      // Create file after a delay
      setTimeout(async () => {
        await fs.writeFile(tempFile, 'delayed content');
      }, 100);

      // Wait for file with platform-adjusted timeout
      const fileExists = await platformUtils.waitForFile(tempFile, 2000);
      expect(fileExists).toBe(true);

      // Cleanup
      await fs.unlink(tempFile);
    });
  });

  describe('Command Execution', () => {
    it('should execute npm commands cross-platform', () => {
      // This would work on both Windows and Unix-like systems
      const command = 'npm --version';

      expect(() => {
        platformUtils.execCommand(command);
      }).not.toThrow();
    });

    it('should create directories cross-platform', async () => {
      const testDir = platformUtils.createTempFilePath('test-directory');

      // Use platform-specific directory creation
      const createCmd = platformUtils.createDirectoryCommand(testDir);
      execSync(createCmd);

      // Verify directory exists
      const stats = await platformUtils.getFileStats(testDir);
      expect(stats.exists).toBe(true);
      expect(stats.isDirectory).toBe(true);

      // Cleanup
      const removeCmd = platformUtils.removeDirectoryCommand(testDir);
      execSync(removeCmd);
    });
  });

  describe('Line Ending Handling', () => {
    it('should normalize line endings for comparison', () => {
      const windowsText = 'line1\r\nline2\r\nline3';
      const unixText = 'line1\nline2\nline3';
      const macText = 'line1\rline2\rline3';

      const normalizedWindows = platformUtils.normalizeToLF(windowsText);
      const normalizedUnix = platformUtils.normalizeToLF(unixText);
      const normalizedMac = platformUtils.normalizeToLF(macText);

      // All should be normalized to the same format
      expect(normalizedWindows).toBe(normalizedUnix);
      expect(normalizedUnix).toBe(normalizedMac);
      expect(normalizedWindows).toBe('line1\nline2\nline3');
    });

    it('should handle platform-specific line endings in files', async () => {
      const tempFile = platformUtils.createTempFilePath('line-ending-test', 'txt');
      const testContent = 'line1\nline2\nline3';

      // Write with platform-specific line endings
      const platformContent = platformUtils.normalizeLineEndings(testContent);
      await fs.writeFile(tempFile, platformContent);

      // Read and normalize for comparison
      const readContent = await fs.readFile(tempFile, 'utf-8');
      const normalizedRead = platformUtils.normalizeToLF(readContent);

      expect(normalizedRead).toBe(testContent);

      // Cleanup
      await fs.unlink(tempFile);
    });
  });

  describe('Database Configuration', () => {
    it('should create cross-platform database URLs', () => {
      const dbUrl = platformUtils.createDatabaseUrl('test.db');

      expect(dbUrl).toStartWith('file:');
      expect(dbUrl).toContain('test.db');

      // Should use forward slashes in file URLs regardless of platform
      const urlPath = dbUrl.replace('file:', '');
      expect(urlPath).not.toMatch(/\\/); // No backslashes in file URLs
    });

    it('should handle database operations with proper timeouts', async () => {
      const operation = async () => {
        // Simulate database operation
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true };
      };

      const result = await waitForPlatformOperation(operation, 'Database operation', 1000);

      expect(result.success).toBe(true);
    });
  });

  describe('Environment Variables', () => {
    it('should handle platform-specific environment variable access', () => {
      // Set a test environment variable
      process.env.TEST_PLATFORM_VAR = 'test-value';

      const value = platformUtils.getEnvVar('TEST_PLATFORM_VAR');
      expect(value).toBe('test-value');

      // Test case-insensitive access on Windows
      const platform = platformUtils.getPlatformInfo();
      if (platform.isWindows) {
        const upperValue = platformUtils.getEnvVar('test_platform_var');
        const lowerValue = platformUtils.getEnvVar('TEST_platform_VAR');
        // Should still work due to Windows case-insensitivity handling
        expect(upperValue || lowerValue).toBeTruthy();
      }

      // Test default value
      const defaultValue = platformUtils.getEnvVar('NONEXISTENT_VAR', 'default');
      expect(defaultValue).toBe('default');

      // Cleanup
      delete process.env.TEST_PLATFORM_VAR;
    });

    it('should create comprehensive test environment', () => {
      const testEnv = platformUtils.createTestEnvironment({
        CUSTOM_VAR: 'custom-value',
      });

      expect(testEnv.NODE_ENV).toBe('test');
      expect(testEnv.PLATFORM).toBeDefined();
      expect(testEnv.TEMP_DIR).toBeDefined();
      expect(testEnv.CUSTOM_VAR).toBe('custom-value');

      const platform = platformUtils.getPlatformInfo();
      if (platform.isWindows) {
        expect(testEnv.FORCE_COLOR).toBe('0');
        expect(testEnv.UV_THREADPOOL_SIZE).toBe('4');
      }
    });
  });

  describe('Timeout Adjustments', () => {
    it('should adjust timeouts based on platform and CI', () => {
      const baseTimeout = 1000;
      const adjustedTimeout = platformUtils.getAdjustedTimeout(baseTimeout);

      expect(adjustedTimeout).toBeGreaterThanOrEqual(baseTimeout);

      const platform = platformUtils.getPlatformInfo();

      if (platform.isWindows) {
        expect(adjustedTimeout).toBeGreaterThan(baseTimeout);
      }

      if (process.env.CI) {
        expect(adjustedTimeout).toBeGreaterThan(baseTimeout);
      }
    });

    it('should calculate optimal worker counts', () => {
      const workerCount = platformUtils.getOptimalWorkerCount();

      expect(workerCount).toBeGreaterThan(0);
      expect(typeof workerCount).toBe('number');

      // Should not exceed CPU count
      const os = require('os');
      const cpuCount = os.cpus().length;
      expect(workerCount).toBeLessThanOrEqual(cpuCount);
    });
  });

  describe('Test Output Normalization', () => {
    it('should normalize test output for cross-platform comparison', () => {
      const output = 'Test completed in 250ms\nPath: C:\\Users\\test\\file.txt\nResult: success';
      const normalized = normalizeTestOutput(output);

      expect(normalized).toContain('XXXms'); // Time normalized
      expect(normalized).toContain('/'); // Paths normalized to Unix style
      expect(normalized).not.toContain('\r'); // Line endings normalized
    });
  });

  describe('Platform Detection', () => {
    it('should correctly identify platform characteristics', () => {
      const platform = platformUtils.getPlatformInfo();

      expect(platform.platform).toBeDefined();
      expect(typeof platform.isWindows).toBe('boolean');
      expect(typeof platform.isMac).toBe('boolean');
      expect(typeof platform.isLinux).toBe('boolean');

      // Exactly one should be true
      const platformCount = [platform.isWindows, platform.isMac, platform.isLinux].filter(
        Boolean
      ).length;
      expect(platformCount).toBe(1);

      expect(platform.pathSeparator).toBeDefined();
      expect(platform.lineEnding).toBeDefined();
      expect(platform.tempDir).toBeDefined();
      expect(platform.npmCommand).toBeDefined();
    });

    it('should provide appropriate commands for the platform', () => {
      const platform = platformUtils.getPlatformInfo();

      if (platform.isWindows) {
        expect(platform.npmCommand).toBe('npm.cmd');
        expect(platformUtils.getNpxCommand()).toBe('npx.cmd');
        expect(platform.shellCommand).toBe('cmd');
      } else {
        expect(platform.npmCommand).toBe('npm');
        expect(platformUtils.getNpxCommand()).toBe('npx');
        expect(platform.shellCommand).toBe('sh');
      }
    });
  });
});

// Integration test with actual file operations
describe('Platform Integration Tests', () => {
  it('should perform end-to-end file operations across platforms', async () => {
    const testDir = platformUtils.createTempFilePath('integration-test');
    const testFile = path.join(testDir, 'test.txt');
    const testContent = 'Line 1\nLine 2\nLine 3';

    try {
      // Create directory
      execSync(platformUtils.createDirectoryCommand(testDir));

      // Write file with platform-specific line endings
      const platformContent = platformUtils.normalizeLineEndings(testContent);
      await fs.writeFile(testFile, platformContent);

      // Verify file exists and has correct content
      const stats = await platformUtils.getFileStats(testFile);
      expect(stats.exists).toBe(true);
      expect(stats.isFile).toBe(true);

      const readContent = await fs.readFile(testFile, 'utf-8');
      const normalizedRead = platformUtils.normalizeToLF(readContent);
      expect(normalizedRead).toBe(testContent);
    } finally {
      // Cleanup - remove directory and all contents
      try {
        execSync(platformUtils.removeDirectoryCommand(testDir));
      } catch (error) {
        // Best effort cleanup
        console.warn('Cleanup warning:', error.message);
      }
    }
  });
});
