#!/usr/bin/env node

/**
 * Validate CI Workflows
 * 
 * This script validates all GitHub Actions workflows in the repository to ensure they are:
 * 1. Valid YAML syntax
 * 2. Have required fields
 * 3. Reference valid actions
 * 4. Use consistent environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';

interface WorkflowValidationResult {
  workflow: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface WorkflowFile {
  name?: string;
  on?: any;
  jobs?: Record<string, any>;
  env?: Record<string, string>;
}

class CIWorkflowValidator {
  private workflowsDir: string;
  private results: WorkflowValidationResult[] = [];
  private requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV'];
  private requiredScripts = [
    'lint',
    'format:check',
    'typecheck',
    'test:coverage:unit:ci',
    'test:coverage:integration:ci',
    'test:e2e:ci',
    'test:a11y:ci',
    'build',
    'ci-db-setup',
    'ci-db-teardown'
  ];

  constructor() {
    this.workflowsDir = path.join(process.cwd(), '.github', 'workflows');
  }

  async validate(): Promise<void> {
    console.log('🚀 Validating CI Workflows...\n');

    // Check if workflows directory exists
    if (!fs.existsSync(this.workflowsDir)) {
      console.error('❌ No .github/workflows directory found!');
      process.exit(1);
    }

    // Get all workflow files
    const files = fs.readdirSync(this.workflowsDir)
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
      .filter(file => !file.endsWith('.disabled'));

    console.log(`Found ${files.length} workflow files to validate\n`);

    // Validate each workflow
    for (const file of files) {
      await this.validateWorkflow(file);
    }

    // Check for required scripts in package.json
    this.validatePackageScripts();

    // Check GitHub Actions configuration
    this.validateGitHubActionsConfig();

    // Generate report
    this.generateReport();
  }

  private async validateWorkflow(filename: string): Promise<void> {
    const filepath = path.join(this.workflowsDir, filename);
    const result: WorkflowValidationResult = {
      workflow: filename,
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      // Read and parse YAML
      const content = fs.readFileSync(filepath, 'utf8');
      const workflow = yaml.load(content) as WorkflowFile;

      // Validate YAML structure
      if (!workflow || typeof workflow !== 'object') {
        result.errors.push('Invalid YAML structure');
        result.valid = false;
      } else {
        // Check required fields
        if (!workflow.name) {
          result.warnings.push('Missing workflow name');
        }

        if (!workflow.on) {
          result.errors.push('Missing trigger events (on)');
          result.valid = false;
        }

        if (!workflow.jobs || Object.keys(workflow.jobs).length === 0) {
          result.errors.push('No jobs defined');
          result.valid = false;
        }

        // Validate jobs
        if (workflow.jobs) {
          this.validateJobs(workflow.jobs, result);
        }

        // Check environment variables
        this.validateEnvironmentVars(workflow, result);

        // Check for deprecated actions
        this.checkDeprecatedActions(content, result);
      }

    } catch (error) {
      result.errors.push(`Failed to parse YAML: ${error.message}`);
      result.valid = false;
    }

    this.results.push(result);
  }

  private validateJobs(jobs: Record<string, any>, result: WorkflowValidationResult): void {
    for (const [jobName, job] of Object.entries(jobs)) {
      // Check required job fields
      if (!job['runs-on']) {
        result.errors.push(`Job '${jobName}' missing 'runs-on'`);
        result.valid = false;
      }

      if (!job.steps || !Array.isArray(job.steps) || job.steps.length === 0) {
        result.errors.push(`Job '${jobName}' has no steps`);
        result.valid = false;
      }

      // Check for timeout
      if (!job['timeout-minutes']) {
        result.warnings.push(`Job '${jobName}' has no timeout-minutes set`);
      }

      // Validate steps
      if (job.steps && Array.isArray(job.steps)) {
        this.validateSteps(job.steps, jobName, result);
      }
    }
  }

  private validateSteps(steps: any[], jobName: string, result: WorkflowValidationResult): void {
    steps.forEach((step, index) => {
      if (!step.name) {
        result.warnings.push(`Step ${index + 1} in job '${jobName}' has no name`);
      }

      if (!step.uses && !step.run) {
        result.errors.push(`Step ${index + 1} in job '${jobName}' has neither 'uses' nor 'run'`);
        result.valid = false;
      }

      // Check for specific actions versions
      if (step.uses) {
        const action = step.uses;
        if (action.includes('@')) {
          const version = action.split('@')[1];
          if (version === 'master' || version === 'main') {
            result.warnings.push(`Step '${step.name || index + 1}' uses unpinned action version`);
          }
        }
      }
    });
  }

  private validateEnvironmentVars(workflow: WorkflowFile, result: WorkflowValidationResult): void {
    // Check for consistent environment variables in test jobs
    if (workflow.jobs) {
      const testJobs = Object.entries(workflow.jobs)
        .filter(([name]) => name.includes('test') || name.includes('e2e'))
        .map(([, job]) => job);

      testJobs.forEach(job => {
        const jobEnv = job.env || {};
        this.requiredEnvVars.forEach(envVar => {
          if (!jobEnv[envVar] && !workflow.env?.[envVar]) {
            result.warnings.push(`Test job might be missing required env var: ${envVar}`);
          }
        });
      });
    }
  }

  private checkDeprecatedActions(content: string, result: WorkflowValidationResult): void {
    const deprecatedActions = [
      { pattern: /actions\/checkout@v[12]/, replacement: 'actions/checkout@v4' },
      { pattern: /actions\/setup-node@v[12]/, replacement: 'actions/setup-node@v4' },
      { pattern: /actions\/upload-artifact@v[12]/, replacement: 'actions/upload-artifact@v4' },
      { pattern: /codecov\/codecov-action@v[12]/, replacement: 'codecov/codecov-action@v4' }
    ];

    deprecatedActions.forEach(({ pattern, replacement }) => {
      if (pattern.test(content)) {
        result.warnings.push(`Uses deprecated action, update to ${replacement}`);
      }
    });
  }

  private validatePackageScripts(): void {
    console.log('\n📦 Validating package.json scripts...\n');

    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const scripts = packageJson.scripts || {};

      const missingScripts = this.requiredScripts.filter(script => !scripts[script]);
      
      if (missingScripts.length > 0) {
        console.log('⚠️  Missing required scripts in package.json:');
        missingScripts.forEach(script => console.log(`   - ${script}`));
      } else {
        console.log('✅ All required scripts found in package.json');
      }

      // Check for CI-specific script configurations
      const ciScripts = Object.keys(scripts).filter(key => key.includes(':ci'));
      console.log(`\n📋 Found ${ciScripts.length} CI-specific scripts`);

    } catch (error) {
      console.error('❌ Failed to read package.json:', error.message);
    }
  }

  private validateGitHubActionsConfig(): void {
    console.log('\n🔧 Validating GitHub Actions configuration...\n');

    // Check for workflow permissions
    const mainWorkflow = path.join(this.workflowsDir, 'ci.yml');
    if (fs.existsSync(mainWorkflow)) {
      const content = fs.readFileSync(mainWorkflow, 'utf8');
      const workflow = yaml.load(content) as WorkflowFile;

      // Check concurrency settings
      if ((workflow as any).concurrency) {
        console.log('✅ Concurrency control configured');
      } else {
        console.log('⚠️  No concurrency control - parallel runs might conflict');
      }
    }

    // Check for secrets usage
    const secretsToCheck = ['CODECOV_TOKEN', 'GITHUB_TOKEN'];
    console.log('\n🔐 Checking for required secrets usage:');
    secretsToCheck.forEach(secret => {
      const found = this.results.some(result => {
        const filepath = path.join(this.workflowsDir, result.workflow);
        const content = fs.readFileSync(filepath, 'utf8');
        return content.includes(`secrets.${secret}`);
      });
      console.log(`   ${found ? '✅' : '⚠️ '} ${secret}`);
    });
  }

  private generateReport(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 CI WORKFLOW VALIDATION REPORT');
    console.log('='.repeat(60) + '\n');

    let totalErrors = 0;
    let totalWarnings = 0;

    this.results.forEach(result => {
      const status = result.valid ? '✅' : '❌';
      console.log(`${status} ${result.workflow}`);

      if (result.errors.length > 0) {
        console.log('   Errors:');
        result.errors.forEach(error => {
          console.log(`     ❌ ${error}`);
          totalErrors++;
        });
      }

      if (result.warnings.length > 0) {
        console.log('   Warnings:');
        result.warnings.forEach(warning => {
          console.log(`     ⚠️  ${warning}`);
          totalWarnings++;
        });
      }

      if (result.valid && result.errors.length === 0 && result.warnings.length === 0) {
        console.log('   ✨ No issues found');
      }

      console.log('');
    });

    console.log('='.repeat(60));
    console.log(`SUMMARY: ${this.results.length} workflows validated`);
    console.log(`  - Errors: ${totalErrors}`);
    console.log(`  - Warnings: ${totalWarnings}`);
    console.log(`  - Valid: ${this.results.filter(r => r.valid).length}/${this.results.length}`);
    console.log('='.repeat(60));

    // Check if we can run a workflow locally
    this.checkLocalExecution();

    // Exit with error if any workflows are invalid
    if (totalErrors > 0) {
      console.log('\n❌ CI workflow validation failed!');
      process.exit(1);
    } else {
      console.log('\n✅ All CI workflows are valid!');
    }
  }

  private checkLocalExecution(): void {
    console.log('\n🏃 Checking local execution capability...\n');

    try {
      // Check if act is installed (for local GitHub Actions execution)
      execSync('which act', { stdio: 'ignore' });
      console.log('✅ act is installed - you can run workflows locally');
      console.log('   Run: act -l to list available workflows');
      console.log('   Run: act -j <job-name> to run a specific job');
    } catch {
      console.log('ℹ️  act is not installed - install it to run workflows locally');
      console.log('   Install: brew install act (macOS)');
      console.log('   Or visit: https://github.com/nektos/act');
    }

    // Check for GitHub CLI
    try {
      execSync('which gh', { stdio: 'ignore' });
      console.log('\n✅ GitHub CLI is installed');
      console.log('   Run: gh workflow list to see workflow status');
      console.log('   Run: gh run list to see recent workflow runs');
    } catch {
      console.log('\nℹ️  GitHub CLI not installed');
      console.log('   Install: brew install gh (macOS)');
    }
  }
}

// Run the validator
const validator = new CIWorkflowValidator();
validator.validate().catch(error => {
  console.error('❌ Validation failed:', error);
  process.exit(1);
});