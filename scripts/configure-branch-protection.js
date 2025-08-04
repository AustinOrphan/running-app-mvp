#!/usr/bin/env node

/**
 * Configure Branch Protection Rules
 *
 * This script configures GitHub branch protection rules for the repository.
 * It can be run manually for setup or testing purposes.
 *
 * Usage:
 *   node scripts/configure-branch-protection.js
 *
 * Environment Variables:
 *   GITHUB_TOKEN - Personal access token with repo permissions
 *   GITHUB_REPOSITORY - Repository in format "owner/repo" (optional)
 */

const https = require('https');

// Configuration
const BRANCH = 'main';
const REQUIRED_STATUS_CHECKS = [
  'ci-lint-and-typecheck',
  'ci-unit-tests',
  'ci-integration-tests',
  'ci-e2e-tests',
];

const PROTECTION_CONFIG = {
  required_status_checks: {
    strict: true,
    contexts: REQUIRED_STATUS_CHECKS,
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    require_last_push_approval: false,
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: true,
  lock_branch: false,
  allow_fork_syncing: true,
};

/**
 * Make a GitHub API request
 */
function githubRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      reject(new Error('GITHUB_TOKEN environment variable is required'));
      return;
    }

    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'branch-protection-script',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = https.request(options, res => {
      let responseData = '';

      res.on('data', chunk => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const result = responseData ? JSON.parse(responseData) : null;

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${result?.message || responseData}`));
          }
        } catch (error) {
          reject(new Error(`Parse error: ${error.message}`));
        }
      });
    });

    req.on('error', error => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Get repository information from environment or git
 */
function getRepository() {
  const envRepo = process.env.GITHUB_REPOSITORY;
  if (envRepo) {
    return envRepo;
  }

  // Try to get from git remote (simplified)
  try {
    const { execSync } = require('child_process');
    const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();

    // Parse GitHub URL
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (match) {
      return match[1].replace(/\.git$/, '');
    }
  } catch (error) {
    // Ignore git errors
  }

  throw new Error('Could not determine repository. Set GITHUB_REPOSITORY environment variable.');
}

/**
 * Configure branch protection
 */
async function configureBranchProtection() {
  try {
    console.log('🛡️  Configuring GitHub Branch Protection Rules\n');

    const repository = getRepository();
    const [owner, repo] = repository.split('/');

    console.log(`📁 Repository: ${repository}`);
    console.log(`🌿 Branch: ${BRANCH}\n`);

    // Check if branch exists
    console.log('🔍 Checking if branch exists...');
    try {
      await githubRequest(`/repos/${repository}/branches/${BRANCH}`);
      console.log('✅ Branch found\n');
    } catch (error) {
      console.error(`❌ Branch '${BRANCH}' not found:`, error.message);
      process.exit(1);
    }

    // Configure protection
    console.log('🔧 Applying branch protection rules...');
    try {
      await githubRequest(
        `/repos/${repository}/branches/${BRANCH}/protection`,
        'PUT',
        PROTECTION_CONFIG
      );
      console.log('✅ Branch protection configured successfully\n');
    } catch (error) {
      console.error('❌ Failed to configure branch protection:', error.message);

      if (error.message.includes('403')) {
        console.log(
          '💡 Note: This requires admin permissions or a personal access token with repo scope'
        );
      }

      process.exit(1);
    }

    // Verify configuration
    console.log('🔍 Verifying protection rules...');
    try {
      const protection = await githubRequest(`/repos/${repository}/branches/${BRANCH}/protection`);

      console.log('✅ Protection rules verified:\n');
      console.log('📋 Current configuration:');
      console.log(
        `   - Required status checks: ${protection.required_status_checks?.contexts?.length || 0}`
      );
      console.log(
        `   - Required reviews: ${protection.required_pull_request_reviews?.required_approving_review_count || 0}`
      );
      console.log(
        `   - Dismiss stale reviews: ${protection.required_pull_request_reviews?.dismiss_stale_reviews || false}`
      );
      console.log(`   - Force pushes allowed: ${protection.allow_force_pushes?.enabled || false}`);
      console.log(`   - Deletions allowed: ${protection.allow_deletions?.enabled || false}`);
      console.log(
        `   - Conversation resolution required: ${protection.required_conversation_resolution?.enabled || false}`
      );

      if (protection.required_status_checks?.contexts?.length > 0) {
        console.log('\n📊 Required status checks:');
        protection.required_status_checks.contexts.forEach(check => {
          console.log(`   - ${check}`);
        });
      }
    } catch (error) {
      console.log('⚠️  Could not verify protection rules:', error.message);
    }

    console.log('\n🎉 Branch protection setup complete!');
    console.log('\n📖 Next steps:');
    console.log('   1. Ensure your CI workflows use the correct job names');
    console.log('   2. Test the protection by creating a pull request');
    console.log('   3. Review the documentation in docs/BRANCH_PROTECTION.md');
  } catch (error) {
    console.error('💥 Unexpected error:', error.message);
    process.exit(1);
  }
}

/**
 * Main execution
 */
if (require.main === module) {
  configureBranchProtection();
}

module.exports = { configureBranchProtection, PROTECTION_CONFIG };
