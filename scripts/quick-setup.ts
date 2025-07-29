#!/usr/bin/env tsx

/**
 * Quick Setup Script
 * 
 * Automated setup script that gets developers from zero to running in <30 minutes.
 * Handles all dependencies, database setup, and initial configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import * as readline from 'readline';

interface SetupStep {
  name: string;
  description: string;
  command?: string;
  action?: () => Promise<void>;
  skipIf?: () => boolean;
  estimated: number; // minutes
}

interface SetupResult {
  step: string;
  success: boolean;
  duration: number;
  error?: string;
}

class QuickSetup {
  private startTime: number = Date.now();
  private results: SetupResult[] = [];
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Main setup flow
   */
  async run(): Promise<void> {
    console.clear();
    this.printWelcome();

    const totalTime = this.calculateTotalTime();
    console.log(`⏱️  Estimated setup time: ${totalTime} minutes\n`);

    const proceed = await this.confirm('Ready to start the setup?');
    if (!proceed) {
      console.log('Setup cancelled.');
      process.exit(0);
    }

    console.log('\n🚀 Starting setup...\n');

    // Run all setup steps
    for (const step of this.getSetupSteps()) {
      await this.runStep(step);
    }

    // Print summary
    this.printSummary();

    // Launch dev environment if successful
    const allSuccess = this.results.every(r => r.success);
    if (allSuccess) {
      const launch = await this.confirm('\n🎉 Setup complete! Launch development environment?');
      if (launch) {
        await this.launchDevEnvironment();
      }
    }

    this.rl.close();
  }

  private getSetupSteps(): SetupStep[] {
    return [
      {
        name: 'System Check',
        description: 'Checking system requirements',
        action: async () => this.checkSystemRequirements(),
        estimated: 0.5
      },
      {
        name: 'Node.js Setup',
        description: 'Verifying Node.js version',
        action: async () => this.checkNodeVersion(),
        estimated: 0.5
      },
      {
        name: 'Dependencies',
        description: 'Installing npm dependencies',
        command: 'npm ci',
        skipIf: () => fs.existsSync('node_modules'),
        estimated: 3
      },
      {
        name: 'Environment Setup',
        description: 'Creating environment configuration',
        action: async () => this.setupEnvironment(),
        skipIf: () => fs.existsSync('.env'),
        estimated: 1
      },
      {
        name: 'Database Setup',
        description: 'Setting up SQLite database',
        action: async () => this.setupDatabase(),
        estimated: 2
      },
      {
        name: 'Prisma Client',
        description: 'Generating Prisma client',
        command: 'npm run prisma:generate',
        estimated: 1
      },
      {
        name: 'Git Hooks',
        description: 'Setting up Git hooks',
        command: 'npm run setup:hooks',
        skipIf: () => fs.existsSync('.husky/_/husky.sh'),
        estimated: 0.5
      },
      {
        name: 'Test Environment',
        description: 'Verifying test setup',
        command: 'npm run validate-test-env',
        estimated: 1
      },
      {
        name: 'IDE Setup',
        description: 'Configuring VS Code',
        action: async () => this.setupIDE(),
        estimated: 0.5
      },
      {
        name: 'Initial Build',
        description: 'Building the application',
        command: 'npm run build',
        estimated: 2
      }
    ];
  }

  private async runStep(step: SetupStep): Promise<void> {
    const startTime = Date.now();

    // Check if should skip
    if (step.skipIf && step.skipIf()) {
      console.log(`⏭️  Skipping ${step.name} (already configured)`);
      this.results.push({
        step: step.name,
        success: true,
        duration: 0
      });
      return;
    }

    process.stdout.write(`⏳ ${step.name}: ${step.description}... `);

    try {
      if (step.command) {
        execSync(step.command, { stdio: 'pipe', encoding: 'utf8' });
      } else if (step.action) {
        await step.action();
      }

      const duration = (Date.now() - startTime) / 1000;
      console.log(`✅ (${duration.toFixed(1)}s)`);

      this.results.push({
        step: step.name,
        success: true,
        duration
      });
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      console.log(`❌ (${duration.toFixed(1)}s)`);

      this.results.push({
        step: step.name,
        success: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      });

      // Ask if should continue
      console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
      const cont = await this.confirm('Continue with setup?');
      if (!cont) {
        this.printSummary();
        process.exit(1);
      }
    }
  }

  private async checkSystemRequirements(): Promise<void> {
    const requirements = {
      node: { min: '20.0.0', current: process.version },
      npm: { min: '10.0.0', current: '' },
      git: { min: '2.0.0', current: '' }
    };

    // Check npm
    try {
      requirements.npm.current = execSync('npm --version', { encoding: 'utf8' }).trim();
    } catch {
      throw new Error('npm not found. Please install Node.js with npm.');
    }

    // Check git
    try {
      requirements.git.current = execSync('git --version', { encoding: 'utf8' })
        .trim()
        .replace('git version ', '');
    } catch {
      throw new Error('git not found. Please install git.');
    }

    // Validate versions
    for (const [tool, req] of Object.entries(requirements)) {
      if (!this.isVersionValid(req.current, req.min)) {
        throw new Error(`${tool} version ${req.min} or higher required (found ${req.current})`);
      }
    }
  }

  private async checkNodeVersion(): Promise<void> {
    const required = '20.0.0';
    const current = process.version.substring(1);

    if (!this.isVersionValid(current, required)) {
      throw new Error(`Node.js ${required} or higher required (found ${current})`);
    }

    // Check if using correct npm
    const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
    if (!this.isVersionValid(npmVersion, '10.0.0')) {
      console.warn(`\n⚠️  npm ${npmVersion} is older than recommended 10.0.0`);
    }
  }

  private async setupEnvironment(): Promise<void> {
    const envExample = '.env.example';
    const envFile = '.env';

    // Create .env from example
    if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envFile);
    } else {
      // Create default .env
      const defaultEnv = `# Environment Configuration
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET="${this.generateSecret()}"
NODE_ENV="development"
PORT="3001"
FRONTEND_PORT="3000"

# Test Database
TEST_DATABASE_URL="file:./prisma/test.db"

# Optional: External Services
# SENTRY_DSN=""
# ANALYTICS_KEY=""
`;
      fs.writeFileSync(envFile, defaultEnv);
    }

    // Generate secure JWT secret
    const envContent = fs.readFileSync(envFile, 'utf8');
    if (envContent.includes('JWT_SECRET=""') || envContent.includes('JWT_SECRET="your-secret-key"')) {
      const newContent = envContent.replace(
        /JWT_SECRET=".*"/,
        `JWT_SECRET="${this.generateSecret()}"`
      );
      fs.writeFileSync(envFile, newContent);
    }
  }

  private async setupDatabase(): Promise<void> {
    // Create prisma directory if needed
    const prismaDir = 'prisma';
    if (!fs.existsSync(prismaDir)) {
      fs.mkdirSync(prismaDir);
    }

    // Run migrations
    try {
      execSync('npm run prisma:migrate', { stdio: 'pipe' });
    } catch (error) {
      // If migrations fail, try to create from scratch
      console.log('\n📦 Creating fresh database...');
      execSync('npx prisma migrate dev --name init', { stdio: 'pipe' });
    }

    // Create test database
    const testDb = 'prisma/test.db';
    if (!fs.existsSync(testDb)) {
      fs.writeFileSync(testDb, '');
    }
  }

  private async setupIDE(): Promise<void> {
    const vscodeDir = '.vscode';
    
    // Ensure .vscode directory exists
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir);
    }

    // Create recommended extensions file
    const extensionsFile = path.join(vscodeDir, 'extensions.json');
    if (!fs.existsSync(extensionsFile)) {
      const extensions = {
        recommendations: [
          "dbaeumer.vscode-eslint",
          "esbenp.prettier-vscode",
          "ms-vscode.vscode-typescript-next",
          "prisma.prisma",
          "ms-playwright.playwright",
          "vitest.explorer",
          "orta.vscode-jest",
          "github.copilot",
          "eamodio.gitlens",
          "usernamehw.errorlens"
        ]
      };
      fs.writeFileSync(extensionsFile, JSON.stringify(extensions, null, 2));
    }

    // Create settings file
    const settingsFile = path.join(vscodeDir, 'settings.json');
    if (!fs.existsSync(settingsFile)) {
      const settings = {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.codeActionsOnSave": {
          "source.fixAll.eslint": true
        },
        "typescript.tsdk": "node_modules/typescript/lib",
        "typescript.enablePromptUseWorkspaceTsdk": true,
        "jest.autoRun": {
          "watch": false,
          "onSave": "test-file"
        },
        "vitest.enable": true,
        "vitest.commandLine": "npm run test --"
      };
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    }
  }

  private async launchDevEnvironment(): Promise<void> {
    console.log('\n🚀 Launching development environment...\n');

    // Open VS Code if available
    try {
      execSync('code .', { stdio: 'ignore' });
      console.log('✅ VS Code opened');
    } catch {
      console.log('ℹ️  Please open the project in your preferred editor');
    }

    // Start dev servers
    console.log('\n📡 Starting development servers...');
    console.log('   Backend: http://localhost:3001');
    console.log('   Frontend: http://localhost:3000\n');

    // Use spawn to run dev servers
    const devProcess = spawn('npm', ['run', 'dev:full'], {
      stdio: 'inherit',
      shell: true
    });

    devProcess.on('error', (error) => {
      console.error('Failed to start dev servers:', error);
    });

    // Open browser after a delay
    setTimeout(() => {
      try {
        const platform = process.platform;
        const url = 'http://localhost:3000';
        
        if (platform === 'darwin') {
          execSync(`open ${url}`);
        } else if (platform === 'win32') {
          execSync(`start ${url}`);
        } else {
          execSync(`xdg-open ${url}`);
        }
      } catch {
        console.log('ℹ️  Please open http://localhost:3000 in your browser');
      }
    }, 3000);
  }

  private printWelcome(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║            🏃 Running App MVP - Quick Setup 🏃            ║
║                                                           ║
║  This script will set up your development environment     ║
║  and get you running in less than 30 minutes!            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
  }

  private printSummary(): void {
    const totalDuration = (Date.now() - this.startTime) / 1000 / 60;
    const successCount = this.results.filter(r => r.success).length;
    const failCount = this.results.filter(r => !r.success).length;

    console.log('\n' + '='.repeat(60));
    console.log('📊 Setup Summary');
    console.log('='.repeat(60));
    
    console.log(`\n⏱️  Total time: ${totalDuration.toFixed(1)} minutes`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);

    if (failCount > 0) {
      console.log('\n❌ Failed steps:');
      this.results
        .filter(r => !r.success)
        .forEach(r => {
          console.log(`   • ${r.step}: ${r.error}`);
        });
    }

    if (successCount === this.results.length) {
      console.log('\n✅ All steps completed successfully!');
      console.log('\n📚 Next steps:');
      console.log('   1. Review the documentation in docs/');
      console.log('   2. Check CLAUDE.md for development guidelines');
      console.log('   3. Run tests with: npm test');
      console.log('   4. Start developing! 🚀');
    } else {
      console.log('\n⚠️  Some steps failed. Please resolve the issues and run:');
      console.log('   npm run setup');
    }
  }

  private async confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl.question(`\n❓ ${message} (y/n) `, (answer) => {
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  private isVersionValid(current: string, required: string): boolean {
    const currentParts = current.split('.').map(Number);
    const requiredParts = required.split('.').map(Number);

    for (let i = 0; i < requiredParts.length; i++) {
      if (currentParts[i] > requiredParts[i]) return true;
      if (currentParts[i] < requiredParts[i]) return false;
    }
    return true;
  }

  private calculateTotalTime(): number {
    return this.getSetupSteps().reduce((total, step) => total + step.estimated, 0);
  }

  private generateSecret(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let secret = '';
    for (let i = 0; i < 32; i++) {
      secret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return secret;
  }
}

// Run setup
if (import.meta.url === `file://${process.argv[1]}`) {
  const setup = new QuickSetup();
  setup.run().catch(console.error);
}