#!/usr/bin/env tsx

/**
 * CI Runtime Optimizer
 *
 * This script analyzes GitHub Actions workflows and provides optimization recommendations:
 * - Identifies redundant steps and duplicate work
 * - Analyzes caching opportunities
 * - Suggests parallelization improvements
 * - Estimates runtime improvements
 */

import fs from 'fs/promises';
import path from 'path';

interface WorkflowAnalysis {
  file: string;
  name: string;
  totalJobs: number;
  totalSteps: number;
  estimatedDuration: number;
  redundantSteps: string[];
  cachingOpportunities: string[];
  parallelizationIssues: string[];
  optimizationPotential: number;
}

interface OptimizationRecommendation {
  type: 'caching' | 'parallelization' | 'redundancy' | 'efficiency';
  description: string;
  impact: 'high' | 'medium' | 'low';
  estimatedSavings: number; // in seconds
  implementation: string;
}

class CIRuntimeOptimizer {
  private workflowsDir: string;
  private analyses: WorkflowAnalysis[] = [];

  constructor(workflowsDir = '.github/workflows') {
    this.workflowsDir = workflowsDir;
  }

  /**
   * Analyze all workflow files and generate optimization recommendations
   */
  async optimizeCI(): Promise<void> {
    console.log('🔍 Analyzing CI workflows for optimization opportunities...\n');

    // Find and analyze all workflow files
    const workflowFiles = await this.findWorkflowFiles();
    console.log(`Found ${workflowFiles.length} workflow files`);

    if (workflowFiles.length === 0) {
      console.log('No workflow files found. Checking directory...');
      console.log(`Looking in: ${this.workflowsDir}`);
      return;
    }

    for (const file of workflowFiles) {
      try {
        console.log(`Analyzing ${file}...`);
        const analysis = await this.analyzeWorkflow(file);
        this.analyses.push(analysis);
        console.log(
          `✅ Analyzed ${analysis.name} (${analysis.totalJobs} jobs, ${analysis.totalSteps} steps)`
        );
      } catch (error) {
        console.warn(`Failed to analyze ${file}:`, error);
      }
    }

    // Generate optimization recommendations
    const recommendations = this.generateRecommendations();
    console.log(`Generated ${recommendations.length} recommendations`);

    // Generate reports
    await this.generateReports(recommendations);
  }

  /**
   * Find all workflow YAML files
   */
  private async findWorkflowFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.workflowsDir);
      return entries
        .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map(file => path.join(this.workflowsDir, file));
    } catch (error) {
      console.error(`Failed to read workflows directory: ${this.workflowsDir}`);
      return [];
    }
  }

  /**
   * Analyze a single workflow file
   */
  private async analyzeWorkflow(filePath: string): Promise<WorkflowAnalysis> {
    const content = await fs.readFile(filePath, 'utf-8');

    // Simple text-based analysis
    const name = this.extractWorkflowName(content);
    const jobCount = this.countJobs(content);
    const stepCount = this.countSteps(content);
    const redundantSteps = this.findRedundantStepsInContent(content);
    const cachingOpportunities = this.findCachingOpportunitiesInContent(content);
    const parallelizationIssues = this.findParallelizationIssuesInContent(content);

    const analysis: WorkflowAnalysis = {
      file: path.basename(filePath),
      name: name || 'Unnamed Workflow',
      totalJobs: jobCount,
      totalSteps: stepCount,
      estimatedDuration: this.estimateWorkflowDurationFromContent(content),
      redundantSteps,
      cachingOpportunities,
      parallelizationIssues,
      optimizationPotential: 0,
    };

    // Calculate optimization potential
    analysis.optimizationPotential = this.calculateOptimizationPotential(analysis);

    return analysis;
  }

  /**
   * Extract workflow name from content
   */
  private extractWorkflowName(content: string): string {
    const nameMatch = content.match(/name:\s*['"]?([^'"]*?)['"]?\s*$/m);
    return nameMatch ? nameMatch[1].trim() : 'Unknown Workflow';
  }

  /**
   * Count jobs in workflow content
   */
  private countJobs(content: string): number {
    // Count job definitions (lines that start with job names under 'jobs:')
    const jobsSection = content.match(/jobs:\s*\n([\s\S]*?)(?=\n\w|\n$)/);
    if (!jobsSection) return 0;

    const jobLines = jobsSection[1].split('\n');
    let jobCount = 0;

    for (const line of jobLines) {
      // Job names are at the beginning of a line with a colon (not indented much)
      if (/^\s{2,4}\w+:\s*$/.test(line)) {
        jobCount++;
      }
    }

    return jobCount;
  }

  /**
   * Count steps in workflow content
   */
  private countSteps(content: string): number {
    // Count step definitions (lines with '- name:' or '- uses:' or '- run:')
    const stepPatterns = [/^\s*-\s*name:/gm, /^\s*-\s*uses:/gm, /^\s*-\s*run:/gm];

    let totalSteps = 0;
    for (const pattern of stepPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        totalSteps += matches.length;
      }
    }

    // Remove duplicates (a step might have both name and uses/run)
    return Math.max(1, Math.floor(totalSteps / 1.5)); // Rough estimate
  }

  /**
   * Estimate workflow duration from content
   */
  private estimateWorkflowDurationFromContent(content: string): number {
    // Look for timeout specifications
    const timeoutMatches = content.match(/timeout-minutes:\s*(\d+)/g);
    let totalTimeout = 0;

    if (timeoutMatches) {
      for (const match of timeoutMatches) {
        const minutes = parseInt(match.match(/(\d+)/)![1], 10);
        totalTimeout = Math.max(totalTimeout, minutes * 60); // Use max, not sum
      }
    }

    if (totalTimeout > 0) {
      return totalTimeout;
    }

    // Estimate based on content patterns
    let estimatedDuration = 0;

    // Base duration per job
    const jobCount = this.countJobs(content);
    estimatedDuration += jobCount * 120; // 2 minutes base per job

    // Add time for different types of operations
    if (content.includes('npm ci') || content.includes('npm install')) {
      estimatedDuration += 60; // 1 minute for install
    }

    if (content.includes('npm run build')) {
      estimatedDuration += 90; // 1.5 minutes for build
    }

    if (
      content.includes('npm run test') ||
      content.includes('vitest') ||
      content.includes('jest')
    ) {
      estimatedDuration += 180; // 3 minutes for tests
    }

    if (content.includes('playwright') || content.includes('e2e')) {
      estimatedDuration += 300; // 5 minutes for E2E tests
    }

    return estimatedDuration;
  }

  /**
   * Find redundant steps in content
   */
  private findRedundantStepsInContent(content: string): string[] {
    const redundant: string[] = [];

    // Look for common patterns that appear multiple times
    const patterns = [
      'actions/checkout',
      'actions/setup-node',
      'npm ci',
      'npm install',
      'npm run build',
    ];

    for (const pattern of patterns) {
      const matches = content.match(new RegExp(pattern, 'g'));
      if (matches && matches.length > 1) {
        redundant.push(`${pattern} appears ${matches.length} times`);
      }
    }

    return redundant;
  }

  /**
   * Find caching opportunities in content
   */
  private findCachingOpportunitiesInContent(content: string): string[] {
    const opportunities: string[] = [];

    // Check for npm install without caching
    if (
      (content.includes('npm ci') || content.includes('npm install')) &&
      !content.includes('actions/cache')
    ) {
      opportunities.push('Missing dependency caching for npm');
    }

    // Check for build without caching
    if (content.includes('npm run build') && !content.includes('actions/cache')) {
      opportunities.push('Missing build artifact caching');
    }

    // Check for repeated browser installations
    if (content.includes('playwright install') && !content.includes('PLAYWRIGHT_BROWSERS_PATH')) {
      opportunities.push('Missing Playwright browser caching');
    }

    return opportunities;
  }

  /**
   * Find parallelization issues in content
   */
  private findParallelizationIssuesInContent(content: string): string[] {
    const issues: string[] = [];

    // Check for sequential job dependencies that might not be necessary
    if (content.includes('needs:') && content.includes('test')) {
      issues.push('Test jobs may have unnecessary dependencies');
    }

    // Check for missing matrix strategies
    const testJobCount = (content.match(/name:.*test/gi) || []).length;
    if (testJobCount > 1 && !content.includes('matrix:')) {
      issues.push('Multiple test jobs could use matrix strategy');
    }

    // Check for database tests that could be optimized
    if (content.includes('DATABASE_URL') && content.includes('npm run test')) {
      issues.push('Database tests may benefit from better isolation');
    }

    return issues;
  }

  /**
   * Calculate optimization potential as a percentage
   */
  private calculateOptimizationPotential(analysis: WorkflowAnalysis): number {
    let potential = 0;

    // Points for redundant steps
    potential += analysis.redundantSteps.length * 10;

    // Points for caching opportunities
    potential += analysis.cachingOpportunities.length * 15;

    // Points for parallelization issues
    potential += analysis.parallelizationIssues.length * 20;

    // Cap at 100%
    return Math.min(100, potential);
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];

    // Global recommendations based on all analyses
    const totalRedundantSteps = this.analyses.reduce((sum, a) => sum + a.redundantSteps.length, 0);
    const totalCachingOpportunities = this.analyses.reduce(
      (sum, a) => sum + a.cachingOpportunities.length,
      0
    );
    const totalParallelizationIssues = this.analyses.reduce(
      (sum, a) => sum + a.parallelizationIssues.length,
      0
    );

    if (totalRedundantSteps > 0) {
      recommendations.push({
        type: 'redundancy',
        description: 'Eliminate redundant steps across workflows',
        impact: 'high',
        estimatedSavings: totalRedundantSteps * 30,
        implementation: 'Create shared workflow templates or composite actions for common steps',
      });
    }

    if (totalCachingOpportunities > 0) {
      recommendations.push({
        type: 'caching',
        description: 'Implement comprehensive caching strategy',
        impact: 'high',
        estimatedSavings: totalCachingOpportunities * 45,
        implementation: 'Add actions/cache for dependencies, build artifacts, and test results',
      });
    }

    if (totalParallelizationIssues > 0) {
      recommendations.push({
        type: 'parallelization',
        description: 'Optimize job dependencies and parallelization',
        impact: 'medium',
        estimatedSavings: totalParallelizationIssues * 60,
        implementation: 'Use matrix strategies and remove unnecessary job dependencies',
      });
    }

    // Specific recommendations
    recommendations.push({
      type: 'efficiency',
      description: 'Use shallow git clones for faster checkout',
      impact: 'low',
      estimatedSavings: 15,
      implementation: 'Add fetch-depth: 1 to checkout actions',
    });

    recommendations.push({
      type: 'efficiency',
      description: 'Enable npm CI optimizations',
      impact: 'medium',
      estimatedSavings: 20,
      implementation: 'Use npm ci --prefer-offline --no-audit --no-fund',
    });

    recommendations.push({
      type: 'caching',
      description: 'Implement cross-workflow cache sharing',
      impact: 'high',
      estimatedSavings: 90,
      implementation: 'Use consistent cache keys across workflows for better cache hits',
    });

    return recommendations;
  }

  /**
   * Generate optimization reports
   */
  private async generateReports(recommendations: OptimizationRecommendation[]): Promise<void> {
    const reportDir = 'reports';
    await fs.mkdir(reportDir, { recursive: true });

    // Generate JSON report
    const jsonReport = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalWorkflows: this.analyses.length,
        totalJobs: this.analyses.reduce((sum, a) => sum + a.totalJobs, 0),
        totalSteps: this.analyses.reduce((sum, a) => sum + a.totalSteps, 0),
        averageOptimizationPotential: Math.round(
          this.analyses.reduce((sum, a) => sum + a.optimizationPotential, 0) / this.analyses.length
        ),
        estimatedTotalSavings: recommendations.reduce((sum, r) => sum + r.estimatedSavings, 0),
      },
      workflows: this.analyses,
      recommendations,
    };

    await fs.writeFile(
      path.join(reportDir, 'ci-optimization-report.json'),
      JSON.stringify(jsonReport, null, 2)
    );

    // Generate markdown report
    const mdReport = this.generateMarkdownReport(jsonReport);
    await fs.writeFile(path.join(reportDir, 'ci-optimization-report.md'), mdReport);

    console.log('📊 CI Optimization Report Generated');
    console.log('=================================');
    console.log(`Total Workflows: ${jsonReport.summary.totalWorkflows}`);
    console.log(`Total Jobs: ${jsonReport.summary.totalJobs}`);
    console.log(`Total Steps: ${jsonReport.summary.totalSteps}`);
    console.log(
      `Average Optimization Potential: ${jsonReport.summary.averageOptimizationPotential}%`
    );
    console.log(
      `Estimated Total Time Savings: ${Math.round(jsonReport.summary.estimatedTotalSavings / 60)} minutes`
    );
    console.log(`\n📋 Top Recommendations:`);

    const topRecommendations = recommendations
      .sort((a, b) => b.estimatedSavings - a.estimatedSavings)
      .slice(0, 3);

    for (const rec of topRecommendations) {
      console.log(`  • ${rec.description} (${Math.round(rec.estimatedSavings / 60)}min savings)`);
    }

    console.log(`\n📁 Detailed reports saved to ${reportDir}/`);
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(report: any): string {
    let md = '# CI Runtime Optimization Report\n\n';
    md += `Generated: ${report.generatedAt}\n\n`;

    md += '## Summary\n\n';
    md += `- **Total Workflows**: ${report.summary.totalWorkflows}\n`;
    md += `- **Total Jobs**: ${report.summary.totalJobs}\n`;
    md += `- **Total Steps**: ${report.summary.totalSteps}\n`;
    md += `- **Average Optimization Potential**: ${report.summary.averageOptimizationPotential}%\n`;
    md += `- **Estimated Total Time Savings**: ${Math.round(report.summary.estimatedTotalSavings / 60)} minutes\n\n`;

    md += '## Workflow Analysis\n\n';
    for (const workflow of report.workflows) {
      md += `### ${workflow.name}\n\n`;
      md += `- **File**: ${workflow.file}\n`;
      md += `- **Jobs**: ${workflow.totalJobs}\n`;
      md += `- **Steps**: ${workflow.totalSteps}\n`;
      md += `- **Estimated Duration**: ${Math.round(workflow.estimatedDuration / 60)} minutes\n`;
      md += `- **Optimization Potential**: ${workflow.optimizationPotential}%\n\n`;

      if (workflow.redundantSteps.length > 0) {
        md += '**Redundant Steps:**\n';
        for (const step of workflow.redundantSteps) {
          md += `- ${step}\n`;
        }
        md += '\n';
      }

      if (workflow.cachingOpportunities.length > 0) {
        md += '**Caching Opportunities:**\n';
        for (const opportunity of workflow.cachingOpportunities) {
          md += `- ${opportunity}\n`;
        }
        md += '\n';
      }

      if (workflow.parallelizationIssues.length > 0) {
        md += '**Parallelization Issues:**\n';
        for (const issue of workflow.parallelizationIssues) {
          md += `- ${issue}\n`;
        }
        md += '\n';
      }
    }

    md += '## Optimization Recommendations\n\n';
    const sortedRecommendations = report.recommendations.sort(
      (a: any, b: any) => b.estimatedSavings - a.estimatedSavings
    );

    for (const rec of sortedRecommendations) {
      md += `### ${rec.description}\n\n`;
      md += `- **Type**: ${rec.type}\n`;
      md += `- **Impact**: ${rec.impact}\n`;
      md += `- **Estimated Savings**: ${Math.round(rec.estimatedSavings / 60)} minutes\n`;
      md += `- **Implementation**: ${rec.implementation}\n\n`;
    }

    return md;
  }
}

/**
 * CLI interface
 */
async function main() {
  const optimizer = new CIRuntimeOptimizer();

  try {
    await optimizer.optimizeCI();
  } catch (error) {
    console.error('CI optimization failed:', error);
    process.exit(1);
  }
}

// Run the main function
main();
