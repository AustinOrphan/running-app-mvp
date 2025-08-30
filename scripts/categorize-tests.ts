#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface TestCategory {
  path: string;
  category: 'parallel-safe' | 'database' | 'integration' | 'e2e' | 'browser';
  reason: string;
  dependencies: string[];
}

class TestCategorizer {
  private categories: TestCategory[] = [];

  // Patterns that indicate database dependency
  private databasePatterns = [
    /import.*prisma/i,
    /from.*@prisma\/client/,
    /PrismaClient/,
    /db\./,
    /database/i,
    /migrate/i,
    /\.db/,
    /createTestUser/,
    /cleanupDatabase/,
    /createMany/,
    /findUnique/,
    /findMany/,
    /create\(/,
    /update\(/,
    /delete\(/,
    /upsert\(/,
  ];

  // Patterns that indicate browser/DOM dependency
  private browserPatterns = [
    /import.*@testing-library\/react/,
    /render\(/,
    /screen\./,
    /userEvent\./,
    /fireEvent\./,
    /waitFor\(/,
    /getBy/,
    /queryBy/,
    /findBy/,
    /document\./,
    /window\./,
  ];

  // Files that should always run sequentially
  private sequentialPatterns = [/setup\.test/, /teardown\.test/, /migration\.test/, /seed\.test/];

  async categorizeAllTests(): Promise<void> {
    console.log('🔍 Categorizing test files...\n');

    // Find all test files
    const testPatterns = [
      'src/**/*.test.{ts,tsx,js,jsx}',
      'src/**/*.spec.{ts,tsx,js,jsx}',
      'tests/**/*.test.{ts,tsx,js,jsx}',
      'tests/**/*.spec.{ts,tsx,js,jsx}',
    ];

    for (const pattern of testPatterns) {
      const files = await glob(pattern, { ignore: ['node_modules/**', 'dist/**'] });

      for (const file of files) {
        await this.categorizeTestFile(file);
      }
    }

    this.generateReport();
  }

  private async categorizeTestFile(filePath: string): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const dependencies = this.extractDependencies(content);

    let category: TestCategory['category'] = 'parallel-safe';
    let reason = 'No blocking dependencies detected';

    // Check for E2E tests
    if (filePath.includes('tests/e2e/') || filePath.includes('e2e.test')) {
      category = 'e2e';
      reason = 'End-to-end test file';
    }
    // Check for integration tests
    else if (filePath.includes('tests/integration/') || filePath.includes('integration.test')) {
      category = 'integration';
      reason = 'Integration test file';
    }
    // Check for database dependencies
    else if (this.hasDatabaseDependency(content, filePath)) {
      category = 'database';
      reason = 'Contains database operations';
    }
    // Check for browser/DOM dependencies
    else if (this.hasBrowserDependency(content)) {
      category = 'browser';
      reason = 'Contains browser/DOM operations';
    }
    // Check if should run sequentially
    else if (this.shouldRunSequentially(filePath)) {
      category = 'database'; // Group with database tests for sequential execution
      reason = 'Requires sequential execution';
    }

    this.categories.push({
      path: filePath,
      category,
      reason,
      dependencies,
    });
  }

  private extractDependencies(content: string): string[] {
    const dependencies: string[] = [];

    // Extract import statements
    const importRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    // Extract require statements
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    return [...new Set(dependencies)];
  }

  private hasDatabaseDependency(content: string, filePath: string): boolean {
    // Check file name
    if (filePath.match(/\.(db|database|prisma)\.test/)) {
      return true;
    }

    // Check content patterns
    return this.databasePatterns.some(pattern => pattern.test(content));
  }

  private hasBrowserDependency(content: string): boolean {
    return this.browserPatterns.some(pattern => pattern.test(content));
  }

  private shouldRunSequentially(filePath: string): boolean {
    return this.sequentialPatterns.some(pattern => pattern.test(filePath));
  }

  generateReport(): void {
    const summary = {
      total: this.categories.length,
      'parallel-safe': this.categories.filter(c => c.category === 'parallel-safe').length,
      database: this.categories.filter(c => c.category === 'database').length,
      browser: this.categories.filter(c => c.category === 'browser').length,
      integration: this.categories.filter(c => c.category === 'integration').length,
      e2e: this.categories.filter(c => c.category === 'e2e').length,
    };

    console.log('📊 Test Categorization Summary\n');
    console.log(`Total test files: ${summary.total}`);
    console.log(
      `Parallel-safe: ${summary['parallel-safe']} (${((summary['parallel-safe'] / summary.total) * 100).toFixed(1)}%)`
    );
    console.log(
      `Database-dependent: ${summary.database} (${((summary.database / summary.total) * 100).toFixed(1)}%)`
    );
    console.log(
      `Browser tests: ${summary.browser} (${((summary.browser / summary.total) * 100).toFixed(1)}%)`
    );
    console.log(`Integration tests: ${summary.integration}`);
    console.log(`E2E tests: ${summary.e2e}`);

    // Generate detailed categorization file
    const categorization = {
      summary,
      categories: this.categories,
      parallelGroups: this.createParallelGroups(),
    };

    const outputPath = path.join(process.cwd(), 'test-categorization.json');
    fs.writeFileSync(outputPath, JSON.stringify(categorization, null, 2));
    console.log(`\n📄 Detailed categorization saved to: ${outputPath}`);

    // Generate Vitest groups configuration
    this.generateVitestGroups();
  }

  private createParallelGroups(): Record<string, string[]> {
    const groups: Record<string, string[]> = {
      'parallel-unit': [],
      'parallel-browser': [],
      'sequential-database': [],
      'sequential-integration': [],
      'sequential-e2e': [],
    };

    this.categories.forEach(cat => {
      switch (cat.category) {
        case 'parallel-safe':
          groups['parallel-unit'].push(cat.path);
          break;
        case 'browser':
          groups['parallel-browser'].push(cat.path);
          break;
        case 'database':
          groups['sequential-database'].push(cat.path);
          break;
        case 'integration':
          groups['sequential-integration'].push(cat.path);
          break;
        case 'e2e':
          groups['sequential-e2e'].push(cat.path);
          break;
      }
    });

    return groups;
  }

  private generateVitestGroups(): void {
    const groups = this.createParallelGroups();

    // Generate workspace configuration for Vitest
    const workspaceConfig = {
      test: {
        projects: [
          {
            name: 'parallel-unit',
            include: groups['parallel-unit'],
            config: {
              pool: 'threads',
              poolOptions: {
                threads: {
                  maxThreads: 4,
                  minThreads: 1,
                },
              },
            },
          },
          {
            name: 'parallel-browser',
            include: groups['parallel-browser'],
            config: {
              pool: 'threads',
              poolOptions: {
                threads: {
                  maxThreads: 2,
                  minThreads: 1,
                },
              },
            },
          },
          {
            name: 'sequential-database',
            include: groups['sequential-database'],
            config: {
              pool: 'forks',
              poolOptions: {
                forks: {
                  singleFork: true,
                },
              },
            },
          },
        ],
      },
    };

    const configPath = path.join(process.cwd(), 'vitest.workspace.js');
    fs.writeFileSync(configPath, `export default ${JSON.stringify(workspaceConfig, null, 2)}`);
    console.log(`\n📄 Vitest workspace configuration saved to: ${configPath}`);
  }

  async generateGithubMatrix(): Promise<void> {
    const groups = this.createParallelGroups();

    // Create matrix for GitHub Actions
    const matrix = {
      include: [],
    };

    // Add parallel groups with sharding
    if (groups['parallel-unit'].length > 10) {
      for (let i = 1; i <= 4; i++) {
        matrix.include.push({
          name: `parallel-unit-shard-${i}`,
          group: 'parallel-unit',
          shard: `${i}/4`,
        });
      }
    } else if (groups['parallel-unit'].length > 0) {
      matrix.include.push({
        name: 'parallel-unit',
        group: 'parallel-unit',
        shard: '1/1',
      });
    }

    // Add sequential groups
    if (groups['sequential-database'].length > 0) {
      matrix.include.push({
        name: 'sequential-database',
        group: 'sequential-database',
        shard: '1/1',
      });
    }

    console.log('\n📋 GitHub Actions Matrix:');
    console.log(JSON.stringify(matrix, null, 2));
  }
}

// Export for use in other scripts
export { TestCategorizer, TestCategory };

// CLI usage
if (require.main === module) {
  const categorizer = new TestCategorizer();

  categorizer
    .categorizeAllTests()
    .then(() => {
      if (process.argv.includes('--github-matrix')) {
        return categorizer.generateGithubMatrix();
      }
    })
    .catch(error => {
      console.error('Categorization failed:', error);
      process.exit(1);
    });
}
