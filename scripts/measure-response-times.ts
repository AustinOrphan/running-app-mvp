#!/usr/bin/env tsx

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosResponse } from 'axios';

interface ResponseTimeResult {
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  threshold: { max: number; warning: number };
  status: 'pass' | 'warning' | 'fail';
}

interface ResponseTimeReport {
  timestamp: Date;
  baseUrl: string;
  results: ResponseTimeResult[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failures: number;
    averageResponseTime: number;
  };
}

class ResponseTimeMeasurer {
  private baseUrl: string;
  private authToken: string | null = null;
  private thresholds: any;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
    this.loadThresholds();
  }

  private loadThresholds(): void {
    const thresholdPath = path.join(process.cwd(), 'performance-thresholds-detailed.json');
    if (fs.existsSync(thresholdPath)) {
      const content = fs.readFileSync(thresholdPath, 'utf-8');
      this.thresholds = JSON.parse(content);
    } else {
      console.error('Threshold file not found. Using defaults.');
      this.thresholds = { responseTime: { api: {} } };
    }
  }

  private async authenticate(): Promise<void> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/auth/register`, {
        email: `test${Date.now()}@example.com`,
        password: 'TestPassword123!',
        name: 'Test User',
      });
      this.authToken = response.data.accessToken;
    } catch (error) {
      // Try login if registration fails
      try {
        const response = await axios.post(`${this.baseUrl}/api/auth/login`, {
          email: 'test@example.com',
          password: 'TestPassword123!',
        });
        this.authToken = response.data.accessToken;
      } catch (loginError) {
        console.warn('Authentication failed. Running tests without auth.');
      }
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  private async measureEndpoint(
    method: string,
    endpoint: string,
    data?: any
  ): Promise<ResponseTimeResult> {
    const startTime = process.hrtime.bigint();
    let response: AxiosResponse;
    let statusCode = 0;

    try {
      const config = {
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: this.getHeaders(),
        data,
        validateStatus: () => true, // Don't throw on any status
      };

      response = await axios(config);
      statusCode = response.status;
    } catch (error) {
      statusCode = 0;
    }

    const endTime = process.hrtime.bigint();
    const responseTime = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds

    // Get threshold for this endpoint
    const pathParts = endpoint.split('/').filter(Boolean);
    const category = pathParts[1]; // e.g., 'auth', 'runs', 'goals'
    const action = pathParts[2] || 'list'; // e.g., 'login', 'create', or default to 'list'

    const threshold = this.thresholds.responseTime?.api?.[category]?.[action] || {
      max: 1000,
      warning: 500,
    };

    let status: 'pass' | 'warning' | 'fail' = 'pass';
    if (responseTime > threshold.max) {
      status = 'fail';
    } else if (responseTime > threshold.warning) {
      status = 'warning';
    }

    return {
      endpoint,
      method,
      responseTime: Math.round(responseTime),
      statusCode,
      threshold,
      status,
    };
  }

  async measureAllEndpoints(): Promise<ResponseTimeReport> {
    await this.authenticate();

    const endpoints = [
      // Auth endpoints
      {
        method: 'POST',
        endpoint: '/api/auth/login',
        data: { email: 'test@example.com', password: 'test' },
      },
      {
        method: 'POST',
        endpoint: '/api/auth/register',
        data: { email: `test${Date.now()}@example.com`, password: 'test', name: 'Test' },
      },
      { method: 'POST', endpoint: '/api/auth/refresh', data: {} },
      { method: 'POST', endpoint: '/api/auth/logout', data: {} },

      // Runs endpoints
      { method: 'GET', endpoint: '/api/runs' },
      {
        method: 'POST',
        endpoint: '/api/runs',
        data: { distance: 5, duration: 1800, date: new Date() },
      },
      { method: 'GET', endpoint: '/api/runs/1' },
      { method: 'PUT', endpoint: '/api/runs/1', data: { distance: 5.5 } },
      { method: 'DELETE', endpoint: '/api/runs/1' },

      // Goals endpoints
      { method: 'GET', endpoint: '/api/goals' },
      {
        method: 'POST',
        endpoint: '/api/goals',
        data: { title: 'Test Goal', type: 'DISTANCE', period: 'WEEKLY', targetValue: 50 },
      },
      { method: 'GET', endpoint: '/api/goals/progress' },

      // Stats endpoints
      { method: 'GET', endpoint: '/api/stats/overview' },
      { method: 'GET', endpoint: '/api/stats/detailed' },

      // Races endpoints
      { method: 'GET', endpoint: '/api/races' },
      {
        method: 'POST',
        endpoint: '/api/races',
        data: { name: 'Test Race', distance: 42.195, date: new Date() },
      },
    ];

    const results: ResponseTimeResult[] = [];

    console.log('\n📊 Measuring API Response Times...\n');

    for (const { method, endpoint, data } of endpoints) {
      process.stdout.write(`Testing ${method} ${endpoint}... `);
      const result = await this.measureEndpoint(method, endpoint, data);
      results.push(result);

      const statusEmoji =
        result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      console.log(`${statusEmoji} ${result.responseTime}ms (${result.statusCode})`);
    }

    const summary = {
      total: results.length,
      passed: results.filter(r => r.status === 'pass').length,
      warnings: results.filter(r => r.status === 'warning').length,
      failures: results.filter(r => r.status === 'fail').length,
      averageResponseTime: Math.round(
        results.reduce((sum, r) => sum + r.responseTime, 0) / results.length
      ),
    };

    return {
      timestamp: new Date(),
      baseUrl: this.baseUrl,
      results,
      summary,
    };
  }

  generateReport(report: ResponseTimeReport): void {
    console.log('\n📈 Response Time Report\n');
    console.log(`Base URL: ${report.baseUrl}`);
    console.log(`Timestamp: ${report.timestamp.toISOString()}`);
    console.log('\nSummary:');
    console.log(`  Total Endpoints: ${report.summary.total}`);
    console.log(`  ✅ Passed: ${report.summary.passed}`);
    console.log(`  ⚠️  Warnings: ${report.summary.warnings}`);
    console.log(`  ❌ Failed: ${report.summary.failures}`);
    console.log(`  Average Response Time: ${report.summary.averageResponseTime}ms`);

    if (report.summary.failures > 0) {
      console.log('\n❌ Failed Endpoints:');
      report.results
        .filter(r => r.status === 'fail')
        .forEach(r => {
          console.log(
            `  ${r.method} ${r.endpoint}: ${r.responseTime}ms (max: ${r.threshold.max}ms)`
          );
        });
    }

    if (report.summary.warnings > 0) {
      console.log('\n⚠️  Warning Endpoints:');
      report.results
        .filter(r => r.status === 'warning')
        .forEach(r => {
          console.log(
            `  ${r.method} ${r.endpoint}: ${r.responseTime}ms (warning: ${r.threshold.warning}ms)`
          );
        });
    }

    // Save report
    const reportPath = path.join(
      process.cwd(),
      'performance-reports',
      `response-times-${Date.now()}.json`
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Full report saved to: ${reportPath}`);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const baseUrl = args[0] || 'http://localhost:3001';

  const measurer = new ResponseTimeMeasurer(baseUrl);

  try {
    const report = await measurer.measureAllEndpoints();
    measurer.generateReport(report);

    // Exit with error if there are failures
    if (report.summary.failures > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error measuring response times:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { ResponseTimeMeasurer, ResponseTimeReport, ResponseTimeResult };
