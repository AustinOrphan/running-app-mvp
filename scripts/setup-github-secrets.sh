#!/bin/bash
set -euo pipefail

# Script to set up GitHub repository secrets for CI/CD pipeline
# This script should be run by an administrator with appropriate permissions

echo "🔐 Setting up GitHub Secrets for Running App CI/CD Pipeline"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Please install it first."
    echo "Visit: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub. Please run: gh auth login"
    exit 1
fi

# Get repository information
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "📦 Repository: $REPO"

# Function to set a secret
set_secret() {
    local name=$1
    local value=$2
    local env=${3:-}
    
    if [ -n "$env" ]; then
        echo "  Setting $name for environment: $env"
        echo "$value" | gh secret set "$name" --env "$env"
    else
        echo "  Setting $name at repository level"
        echo "$value" | gh secret set "$name"
    fi
}

# Function to prompt for secret value
prompt_secret() {
    local name=$1
    local description=$2
    local env=${3:-}
    
    echo ""
    echo "🔑 $description"
    read -s -p "Enter value for $name: " value
    echo ""
    
    set_secret "$name" "$value" "$env"
}

echo ""
echo "📋 This script will set up the following secrets:"
echo "  - Repository-level secrets (available to all workflows)"
echo "  - Environment-specific secrets (dev, staging, production)"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Aborted"
    exit 1
fi

# Repository-level secrets
echo ""
echo "🔧 Setting up repository-level secrets..."

prompt_secret "GITHUB_TOKEN" "GitHub Personal Access Token with packages:write permission"
prompt_secret "SONAR_TOKEN" "SonarCloud/SonarQube token for code quality scanning"
prompt_secret "SNYK_TOKEN" "Snyk token for vulnerability scanning"
prompt_secret "SLACK_WEBHOOK" "Slack webhook URL for notifications"
prompt_secret "DISCORD_WEBHOOK" "Discord webhook URL for notifications (optional, press enter to skip)"

# AWS Credentials (if using AWS)
echo ""
echo "☁️  AWS Configuration (press enter to skip if not using AWS)"
prompt_secret "AWS_ACCOUNT_ID" "AWS Account ID"
prompt_secret "AWS_ACCESS_KEY_ID" "AWS Access Key ID"
prompt_secret "AWS_SECRET_ACCESS_KEY" "AWS Secret Access Key"
prompt_secret "AWS_REGION" "AWS Region (e.g., us-east-1)"
prompt_secret "ECR_REGISTRY" "ECR Registry URL (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com)"

# Kubernetes Configuration
echo ""
echo "☸️  Kubernetes Configuration"
prompt_secret "KUBE_CONFIG_DATA" "Base64 encoded kubeconfig file content"
prompt_secret "KUBE_NAMESPACE_DEV" "Kubernetes namespace for development"
prompt_secret "KUBE_NAMESPACE_STAGING" "Kubernetes namespace for staging"
prompt_secret "KUBE_NAMESPACE_PROD" "Kubernetes namespace for production"

# Development Environment Secrets
echo ""
echo "🔧 Setting up DEVELOPMENT environment secrets..."

prompt_secret "DATABASE_URL" "PostgreSQL connection string" "development"
prompt_secret "REDIS_URL" "Redis connection string" "development"
prompt_secret "JWT_SECRET" "JWT signing secret" "development"
prompt_secret "LOG_SALT" "Salt for log anonymization" "development"

# Staging Environment Secrets
echo ""
echo "🎯 Setting up STAGING environment secrets..."

prompt_secret "DATABASE_URL" "PostgreSQL connection string" "staging"
prompt_secret "REDIS_URL" "Redis connection string" "staging"
prompt_secret "JWT_SECRET" "JWT signing secret" "staging"
prompt_secret "LOG_SALT" "Salt for log anonymization" "staging"
prompt_secret "SENTRY_DSN" "Sentry DSN for error tracking" "staging"
prompt_secret "NEW_RELIC_LICENSE_KEY" "New Relic license key" "staging"

# Production Environment Secrets
echo ""
echo "🚀 Setting up PRODUCTION environment secrets..."

prompt_secret "DATABASE_URL" "PostgreSQL primary connection string" "production"
prompt_secret "DATABASE_REPLICA_URL" "PostgreSQL replica connection string" "production"
prompt_secret "REDIS_URL" "Redis connection string" "production"
prompt_secret "REDIS_CLUSTER_URLS" "Redis cluster URLs (comma-separated)" "production"
prompt_secret "JWT_SECRET" "JWT signing secret" "production"
prompt_secret "JWT_REFRESH_SECRET" "JWT refresh token secret" "production"
prompt_secret "LOG_SALT" "Salt for log anonymization" "production"
prompt_secret "ENCRYPTION_KEY" "Data encryption key" "production"
prompt_secret "SENTRY_DSN" "Sentry DSN for error tracking" "production"
prompt_secret "NEW_RELIC_LICENSE_KEY" "New Relic license key" "production"
prompt_secret "DATADOG_API_KEY" "Datadog API key" "production"
prompt_secret "S3_BUCKET_NAME" "S3 bucket for uploads" "production"

# Production approval environment
echo ""
echo "🔐 Setting up PRODUCTION-APPROVAL environment..."
echo "  Note: This environment requires manual reviewers to be configured"

# Container Registry Secrets
echo ""
echo "🐳 Setting up Container Registry secrets..."

if [ -n "${AWS_ACCOUNT_ID:-}" ]; then
    echo "  Using AWS ECR, no additional secrets needed"
else
    prompt_secret "DOCKER_USERNAME" "Docker Hub / GHCR username"
    prompt_secret "DOCKER_PASSWORD" "Docker Hub / GHCR password/token"
fi

# Monitoring and Alerting
echo ""
echo "📊 Setting up Monitoring secrets..."

prompt_secret "GRAFANA_API_KEY" "Grafana API key for dashboard provisioning"
prompt_secret "PAGERDUTY_INTEGRATION_KEY" "PagerDuty integration key for incidents"

# Optional: Third-party integrations
echo ""
echo "🔌 Optional: Third-party integrations (press enter to skip)"

prompt_secret "GOOGLE_OAUTH_CLIENT_ID" "Google OAuth Client ID"
prompt_secret "GOOGLE_OAUTH_CLIENT_SECRET" "Google OAuth Client Secret"
prompt_secret "STRIPE_API_KEY" "Stripe API key (if using payments)"
prompt_secret "SENDGRID_API_KEY" "SendGrid API key (if using email)"

echo ""
echo "✅ GitHub secrets setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Configure environment protection rules in GitHub:"
echo "   - Go to Settings > Environments"
echo "   - Add required reviewers for staging and production"
echo "   - Configure deployment branches"
echo ""
echo "2. Verify secrets are set correctly:"
echo "   gh secret list"
echo "   gh secret list --env development"
echo "   gh secret list --env staging"
echo "   gh secret list --env production"
echo ""
echo "3. Test the CI/CD pipeline with a test commit"
echo ""
echo "🔒 Remember to:"
echo "   - Rotate secrets regularly"
echo "   - Use least privilege access"
echo "   - Monitor secret usage"
echo "   - Never commit secrets to code"