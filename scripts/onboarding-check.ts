#!/usr/bin/env tsx

/**
 * Onboarding Time Checker
 *
 * Measures and validates that developer onboarding takes <30 minutes.
 * Tracks each step and provides feedback on optimization opportunities.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface OnboardingStep {
  id: string;
  name: string;
  description: string;
  requiredTime: number; // minutes
  actualTime?: number;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  notes?: string[];
}

interface OnboardingMetrics {
  totalTime: number;
  setupTime: number;
  learningTime: number;
  firstCommitTime: number;
  bottlenecks: string[];
  improvements: string[];
  targetMet: boolean;
}

export class OnboardingChecker {
  private readonly targetTime = 30; // minutes
  private readonly checkpointsFile = 'onboarding-checkpoints.json';
  private startTime?: Date;
  private checkpoints: Map<string, Date> = new Map();

  /**
   * Start tracking onboarding
   */
  startTracking(): void {
    this.startTime = new Date();
    this.saveCheckpoint('start', 'Onboarding started');

    console.log('🏁 Onboarding tracking started');
    console.log(`⏱️  Target: <${this.targetTime} minutes`);
    console.log('');
    console.log('Checkpoints will be saved automatically.');
    console.log('Run "npm run onboarding:check" to see progress.\n');
  }

  /**
   * Save a checkpoint
   */
  saveCheckpoint(id: string, description: string): void {
    this.checkpoints.set(id, new Date());

    const data = {
      startTime: this.startTime,
      checkpoints: Array.from(this.checkpoints.entries()).map(([key, value]) => ({
        id: key,
        timestamp: value,
        description,
      })),
    };

    fs.writeFileSync(this.checkpointsFile, JSON.stringify(data, null, 2));
  }

  /**
   * Check onboarding progress
   */
  checkProgress(): OnboardingMetrics {
    if (!fs.existsSync(this.checkpointsFile)) {
      console.log('⚠️  No onboarding tracking data found.');
      console.log('Run "npm run onboarding:start" to begin tracking.');
      process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(this.checkpointsFile, 'utf8'));
    const startTime = new Date(data.startTime);
    const currentTime = new Date();
    const elapsedMinutes = (currentTime.getTime() - startTime.getTime()) / 1000 / 60;

    // Define expected steps
    const steps = this.getOnboardingSteps();

    // Calculate metrics
    const metrics = this.calculateMetrics(steps, data.checkpoints, elapsedMinutes);

    // Print report
    this.printReport(steps, metrics, elapsedMinutes);

    return metrics;
  }

  /**
   * Validate onboarding completeness
   */
  validateOnboarding(): boolean {
    console.log('🔍 Validating onboarding completeness...\n');

    const checks = [
      {
        name: 'Dependencies installed',
        check: () => fs.existsSync('node_modules'),
        fix: 'Run: npm install',
      },
      {
        name: 'Environment configured',
        check: () => fs.existsSync('.env'),
        fix: 'Run: cp .env.example .env',
      },
      {
        name: 'Database ready',
        check: () => fs.existsSync('prisma/dev.db'),
        fix: 'Run: npm run prisma:migrate',
      },
      {
        name: 'Git hooks installed',
        check: () => fs.existsSync('.husky/_/husky.sh'),
        fix: 'Run: npm run prepare',
      },
      {
        name: 'Tests passing',
        check: () => {
          try {
            execSync('npm run test:run -- --run', { stdio: 'pipe' });
            return true;
          } catch {
            return false;
          }
        },
        fix: 'Fix failing tests',
      },
      {
        name: 'Build successful',
        check: () => {
          try {
            execSync('npm run build', { stdio: 'pipe' });
            return true;
          } catch {
            return false;
          }
        },
        fix: 'Fix build errors',
      },
      {
        name: 'Dev server runs',
        check: () => {
          // Check if ports are configured
          const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
          return env.includes('PORT=') && env.includes('FRONTEND_PORT=');
        },
        fix: 'Configure ports in .env',
      },
    ];

    let allPassed = true;

    for (const check of checks) {
      process.stdout.write(`📋 ${check.name}... `);

      if (check.check()) {
        console.log('✅');
      } else {
        console.log('❌');
        console.log(`   Fix: ${check.fix}`);
        allPassed = false;
      }
    }

    console.log('\n' + (allPassed ? '✅ All checks passed!' : '❌ Some checks failed'));
    return allPassed;
  }

  /**
   * Generate onboarding report
   */
  generateReport(): void {
    const reportPath = 'onboarding-report.md';

    const report = `# Developer Onboarding Report

Generated: ${new Date().toLocaleString()}

## Target
- **Goal**: Complete onboarding in <30 minutes
- **Includes**: Environment setup, first successful build, and running tests

## Onboarding Steps

${this.getOnboardingSteps()
  .map(
    step => `
### ${step.name}
- **Description**: ${step.description}
- **Expected Time**: ${step.requiredTime} minutes
- **Purpose**: Ensures ${step.id} is properly configured
`
  )
  .join('\n')}

## Metrics to Track

1. **Setup Time**: Time to install dependencies and configure environment
2. **Build Time**: Time to successfully build the project
3. **Test Time**: Time to run and pass all tests
4. **Learning Time**: Time to understand project structure
5. **First Commit**: Time to make first meaningful contribution

## Success Criteria

- [ ] All dependencies installed
- [ ] Environment properly configured
- [ ] Database migrations run
- [ ] All tests passing
- [ ] Development servers running
- [ ] First commit made
- [ ] Total time <30 minutes

## Tips for Fast Onboarding

1. **Use the quick setup script**: \`npm run setup:quick\`
2. **Read CLAUDE.md first**: Contains all development guidelines
3. **Check system requirements**: Node.js 20+, npm 10+
4. **Use recommended IDE**: VS Code with suggested extensions
5. **Follow the setup checklist**: In docs/SETUP_INSTRUCTIONS.md

## Common Issues

### Slow npm install
- Use \`npm ci\` instead of \`npm install\`
- Ensure good internet connection
- Consider using a npm registry mirror

### Database setup fails
- Check write permissions in project directory
- Ensure SQLite is supported on your system
- Try deleting prisma/*.db and running migrations again

### Tests fail on first run
- Run \`npm run test:setup\` first
- Check that all environment variables are set
- Ensure database migrations have run

### Port conflicts
- Change PORT and FRONTEND_PORT in .env
- Check for other services using ports 3000/3001
- Use \`lsof -i :3000\` to find conflicting processes
`;

    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report generated: ${reportPath}`);
  }

  private getOnboardingSteps(): OnboardingStep[] {
    return [
      {
        id: 'clone',
        name: 'Clone Repository',
        description: 'Clone the repository and navigate to project',
        requiredTime: 1,
      },
      {
        id: 'requirements',
        name: 'Check Requirements',
        description: 'Verify Node.js, npm, and git versions',
        requiredTime: 1,
      },
      {
        id: 'install',
        name: 'Install Dependencies',
        description: 'Run npm install to get all packages',
        requiredTime: 5,
      },
      {
        id: 'environment',
        name: 'Configure Environment',
        description: 'Set up .env file with required variables',
        requiredTime: 2,
      },
      {
        id: 'database',
        name: 'Setup Database',
        description: 'Run migrations and seed data',
        requiredTime: 3,
      },
      {
        id: 'build',
        name: 'Build Project',
        description: 'Run initial build to verify setup',
        requiredTime: 3,
      },
      {
        id: 'tests',
        name: 'Run Tests',
        description: 'Verify all tests pass',
        requiredTime: 5,
      },
      {
        id: 'dev-server',
        name: 'Start Dev Server',
        description: 'Launch development environment',
        requiredTime: 2,
      },
      {
        id: 'explore',
        name: 'Explore Codebase',
        description: 'Understand project structure',
        requiredTime: 5,
      },
      {
        id: 'first-change',
        name: 'Make First Change',
        description: 'Make and test a small change',
        requiredTime: 3,
      },
    ];
  }

  private calculateMetrics(
    steps: OnboardingStep[],
    checkpoints: any[],
    elapsedMinutes: number
  ): OnboardingMetrics {
    const bottlenecks: string[] = [];
    const improvements: string[] = [];

    // Analyze each step
    for (const step of steps) {
      const checkpoint = checkpoints.find(cp => cp.id === step.id);
      if (checkpoint) {
        const stepTime = this.getStepDuration(checkpoint, checkpoints);
        if (stepTime > step.requiredTime * 1.5) {
          bottlenecks.push(
            `${step.name} took ${stepTime.toFixed(1)}min (expected ${step.requiredTime}min)`
          );
        }
      }
    }

    // Generate improvements
    if (elapsedMinutes > this.targetTime) {
      improvements.push('Consider using the quick setup script: npm run setup:quick');
    }

    if (bottlenecks.length > 0) {
      improvements.push('Focus on optimizing the slowest steps');
    }

    const hasDatabase = checkpoints.some(cp => cp.id === 'database');
    if (!hasDatabase && elapsedMinutes > 10) {
      improvements.push('Database setup is a common bottleneck - ensure migrations run smoothly');
    }

    return {
      totalTime: elapsedMinutes,
      setupTime: this.getPhaseTime(checkpoints, ['install', 'environment', 'database']),
      learningTime: this.getPhaseTime(checkpoints, ['explore']),
      firstCommitTime: this.getPhaseTime(checkpoints, ['first-change']),
      bottlenecks,
      improvements,
      targetMet: elapsedMinutes <= this.targetTime,
    };
  }

  private getStepDuration(checkpoint: any, allCheckpoints: any[]): number {
    const index = allCheckpoints.findIndex(cp => cp.id === checkpoint.id);
    if (index === 0) {
      return 0;
    }

    const prevTime = new Date(allCheckpoints[index - 1].timestamp);
    const currTime = new Date(checkpoint.timestamp);
    return (currTime.getTime() - prevTime.getTime()) / 1000 / 60;
  }

  private getPhaseTime(checkpoints: any[], phaseSteps: string[]): number {
    let totalTime = 0;

    for (const stepId of phaseSteps) {
      const checkpoint = checkpoints.find(cp => cp.id === stepId);
      if (checkpoint) {
        totalTime += this.getStepDuration(checkpoint, checkpoints);
      }
    }

    return totalTime;
  }

  private printReport(steps: OnboardingStep[], metrics: OnboardingMetrics, elapsed: number): void {
    console.log('\n📊 Onboarding Progress Report');
    console.log('='.repeat(50));

    const targetEmoji = metrics.targetMet ? '✅' : '❌';
    console.log(`\n⏱️  Elapsed Time: ${elapsed.toFixed(1)} minutes`);
    console.log(`🎯 Target: ${this.targetTime} minutes`);
    console.log(`${targetEmoji} Status: ${metrics.targetMet ? 'ON TRACK' : 'BEHIND SCHEDULE'}\n`);

    // Progress bar
    const progress = Math.min(100, (elapsed / this.targetTime) * 100);
    const filledBars = Math.floor(progress / 5);
    const emptyBars = 20 - filledBars;

    console.log('Progress:');
    console.log(`[${'█'.repeat(filledBars)}${'░'.repeat(emptyBars)}] ${progress.toFixed(0)}%\n`);

    // Bottlenecks
    if (metrics.bottlenecks.length > 0) {
      console.log('🚧 Bottlenecks:');
      metrics.bottlenecks.forEach(b => console.log(`   • ${b}`));
      console.log('');
    }

    // Improvements
    if (metrics.improvements.length > 0) {
      console.log('💡 Suggestions:');
      metrics.improvements.forEach(i => console.log(`   • ${i}`));
      console.log('');
    }

    // Next steps
    console.log('📝 Next Steps:');
    const incompleteSteps = steps.filter(
      step => !metrics.bottlenecks.some(b => b.includes(step.name))
    );

    incompleteSteps.slice(0, 3).forEach(step => {
      console.log(`   • ${step.name}: ${step.description}`);
    });
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const checker = new OnboardingChecker();
  const command = process.argv[2];

  switch (command) {
    case 'start':
      checker.startTracking();
      break;

    case 'check':
      checker.checkProgress();
      break;

    case 'validate':
      const isValid = checker.validateOnboarding();
      process.exit(isValid ? 0 : 1);
      break;

    case 'report':
      checker.generateReport();
      break;

    default:
      console.log('Onboarding Time Checker');
      console.log('');
      console.log('Usage:');
      console.log('  npm run onboarding:start    - Start tracking onboarding time');
      console.log('  npm run onboarding:check    - Check current progress');
      console.log('  npm run onboarding:validate - Validate setup completeness');
      console.log('  npm run onboarding:report   - Generate onboarding report');
      break;
  }
}
