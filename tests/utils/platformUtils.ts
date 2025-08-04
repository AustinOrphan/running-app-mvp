/**
 * Platform-Specific Utilities for Cross-Platform Test Compatibility
 *
 * This module provides utilities to handle platform-specific differences
 * across Windows, macOS, and Linux environments in the test suite.
 */

import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

export interface PlatformInfo {
  platform: NodeJS.Platform;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  pathSeparator: string;
  lineEnding: string;
  tempDir: string;
  npmCommand: string;
  shellCommand: string;
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(): PlatformInfo {
  const platform = process.platform;
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';

  return {
    platform,
    isWindows,
    isMac,
    isLinux,
    pathSeparator: path.sep,
    lineEnding: isWindows ? '\r\n' : '\n',
    tempDir: getTempDirectory(),
    npmCommand: getNpmCommand(),
    shellCommand: getShellCommand(),
  };
}

/**
 * Get the appropriate npm command for the current platform
 */
export function getNpmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Get the appropriate npx command for the current platform
 */
export function getNpxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

/**
 * Get the appropriate shell command for the current platform
 */
export function getShellCommand(): string {
  return process.platform === 'win32' ? 'cmd' : 'sh';
}

/**
 * Get the temporary directory for the current platform
 */
export function getTempDirectory(): string {
  // Use platform-specific temp directory
  return os.tmpdir();
}

/**
 * Create a cross-platform temporary file path
 */
export function createTempFilePath(filename: string, extension?: string): string {
  const tempDir = getTempDirectory();
  const fullFilename = extension ? `${filename}.${extension}` : filename;
  return path.join(tempDir, fullFilename);
}

/**
 * Normalize path separators for the current platform
 */
export function normalizePath(filepath: string): string {
  return path.normalize(filepath);
}

/**
 * Convert Unix-style paths to platform-specific paths
 */
export function toPlatformPath(unixPath: string): string {
  return unixPath.split('/').join(path.sep);
}

/**
 * Convert platform-specific paths to Unix-style paths
 */
export function toUnixPath(platformPath: string): string {
  return platformPath.split(path.sep).join('/');
}

/**
 * Normalize line endings for the current platform
 */
export function normalizeLineEndings(text: string, targetPlatform?: NodeJS.Platform): string {
  const platform = targetPlatform || process.platform;
  const targetEnding = platform === 'win32' ? '\r\n' : '\n';

  // First normalize all line endings to \n, then convert to target
  return text.replace(/\r\n|\r|\n/g, '\n').replace(/\n/g, targetEnding);
}

/**
 * Normalize line endings to LF for cross-platform text comparison
 */
export function normalizeToLF(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

/**
 * Execute a command with platform-specific handling
 */
export function execCommand(command: string, options?: any): Buffer {
  const platform = getPlatformInfo();

  // Handle npm/npx commands
  const normalizedCommand = command
    .replace(/^npm\s/, `${platform.npmCommand} `)
    .replace(/^npx\s/, `${getNpxCommand()} `);

  return execSync(normalizedCommand, {
    ...options,
    shell: platform.isWindows ? true : options?.shell,
  });
}

/**
 * Create a directory with cross-platform command
 */
export function createDirectoryCommand(dirPath: string): string {
  const platform = getPlatformInfo();

  if (platform.isWindows) {
    return `if not exist "${dirPath}" mkdir "${dirPath}"`;
  } else {
    return `mkdir -p "${dirPath}"`;
  }
}

/**
 * Remove a file with cross-platform command
 */
export function removeFileCommand(filePath: string): string {
  const platform = getPlatformInfo();

  if (platform.isWindows) {
    return `del /F "${filePath}"`;
  } else {
    return `rm -f "${filePath}"`;
  }
}

/**
 * Remove a directory with cross-platform command
 */
export function removeDirectoryCommand(dirPath: string): string {
  const platform = getPlatformInfo();

  if (platform.isWindows) {
    return `rmdir /S /Q "${dirPath}"`;
  } else {
    return `rm -rf "${dirPath}"`;
  }
}

/**
 * Get environment variable with platform-specific handling
 */
export function getEnvVar(name: string, defaultValue?: string): string | undefined {
  const value = process.env[name];
  if (value !== undefined) {
    return value;
  }

  // Windows sometimes uses different casing
  if (process.platform === 'win32') {
    const upperName = name.toUpperCase();
    const lowerName = name.toLowerCase();
    return process.env[upperName] || process.env[lowerName] || defaultValue;
  }

  return defaultValue;
}

/**
 * Create a cross-platform database URL
 */
export function createDatabaseUrl(filename: string, baseDir?: string): string {
  const platform = getPlatformInfo();
  const dir = baseDir || process.cwd();
  const dbPath = path.join(dir, 'prisma', filename);

  // Normalize path separators for file URLs
  const normalizedPath = dbPath.replace(/\\/g, '/');
  return `file:${normalizedPath}`;
}

/**
 * Get file system stats with error handling
 */
export async function getFileStats(filepath: string): Promise<{
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
  mtime?: Date;
}> {
  try {
    const fs = await import('fs/promises');
    const stats = await fs.stat(filepath);
    return {
      exists: true,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      size: stats.size,
      mtime: stats.mtime,
    };
  } catch (error) {
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
    };
  }
}

/**
 * Wait for a file to exist (useful for test timing)
 */
export async function waitForFile(
  filepath: string,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const stats = await getFileStats(filepath);
    if (stats.exists && stats.isFile) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * Compare file contents with normalized line endings
 */
export async function compareFileContents(
  file1Path: string,
  file2Path: string,
  normalizeLineEndings: boolean = true
): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    let content1 = await fs.readFile(file1Path, 'utf-8');
    let content2 = await fs.readFile(file2Path, 'utf-8');

    if (normalizeLineEndings) {
      content1 = normalizeToLF(content1);
      content2 = normalizeToLF(content2);
    }

    return content1 === content2;
  } catch (error) {
    return false;
  }
}

/**
 * Platform-specific test timeout adjustments
 */
export function getAdjustedTimeout(baseTimeoutMs: number): number {
  const platform = getPlatformInfo();

  // Windows and CI environments often need longer timeouts
  let multiplier = 1;

  if (platform.isWindows) {
    multiplier *= 1.5; // 50% longer on Windows
  }

  if (process.env.CI) {
    multiplier *= 2; // 2x longer in CI
  }

  // Mac M1/M2 chips are fast, reduce timeout slightly
  if (platform.isMac && process.arch === 'arm64') {
    multiplier *= 0.8;
  }

  return Math.round(baseTimeoutMs * multiplier);
}

/**
 * Get platform-specific Jest/Vitest worker configuration
 */
export function getOptimalWorkerCount(): number {
  const platform = getPlatformInfo();
  const cpuCount = os.cpus().length;

  if (process.env.CI) {
    // CI environments are often resource-constrained
    return Math.max(1, Math.floor(cpuCount / 2));
  }

  if (platform.isWindows) {
    // Windows file operations are slower, use fewer workers
    return Math.max(1, Math.floor(cpuCount * 0.75));
  }

  // Default to CPU count - 1 to leave one core free
  return Math.max(1, cpuCount - 1);
}

/**
 * Create platform-specific environment variables for tests
 */
export function createTestEnvironment(
  baseEnv: Record<string, string> = {}
): Record<string, string> {
  const platform = getPlatformInfo();

  const testEnv = {
    NODE_ENV: 'test',
    CI: process.env.CI || 'false',
    PLATFORM: platform.platform,
    TEMP_DIR: platform.tempDir,
    ...baseEnv,
  };

  // Platform-specific adjustments
  if (platform.isWindows) {
    testEnv.FORCE_COLOR = '0'; // Disable colors on Windows by default
    testEnv.UV_THREADPOOL_SIZE = '4'; // Limit thread pool on Windows
  }

  return testEnv;
}

/**
 * Utility to run platform-specific test setup
 */
export async function runPlatformSpecificSetup(): Promise<void> {
  const platform = getPlatformInfo();

  console.log(`🔧 Setting up tests for ${platform.platform}`);

  // Platform-specific initialization
  if (platform.isWindows) {
    // Windows-specific setup
    process.env.FORCE_COLOR = '0';
    process.env.UV_THREADPOOL_SIZE = '4';
    console.log('   ✅ Windows-specific configuration applied');
  }

  if (platform.isMac) {
    // macOS-specific setup
    console.log('   ✅ macOS-specific configuration applied');
  }

  if (platform.isLinux) {
    // Linux-specific setup
    console.log('   ✅ Linux-specific configuration applied');
  }

  // CI-specific setup
  if (process.env.CI) {
    console.log('   ✅ CI-specific configuration applied');
  }
}

// Export platform info instance for easy access
export const platformInfo = getPlatformInfo();

// Export commonly used utilities
export const platformUtils = {
  getPlatformInfo,
  getNpmCommand,
  getNpxCommand,
  getShellCommand,
  getTempDirectory,
  createTempFilePath,
  normalizePath,
  toPlatformPath,
  toUnixPath,
  normalizeLineEndings,
  normalizeToLF,
  execCommand,
  createDirectoryCommand,
  removeFileCommand,
  removeDirectoryCommand,
  getEnvVar,
  createDatabaseUrl,
  getFileStats,
  waitForFile,
  compareFileContents,
  getAdjustedTimeout,
  getOptimalWorkerCount,
  createTestEnvironment,
  runPlatformSpecificSetup,
};

export default platformUtils;
