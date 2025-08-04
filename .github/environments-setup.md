# GitHub Environments Setup Guide

This guide explains how to configure GitHub Environments for the Running App CI/CD pipeline with manual approval workflows.

## Overview

The deployment pipeline uses GitHub Environments to:

- Enforce manual approvals for production deployments
- Manage environment-specific secrets
- Track deployment history
- Implement deployment protection rules

## Environment Configuration

### 1. Development Environment

```yaml
Name: development
URL: https://dev.running-app.example.com
```

**Protection Rules:**

- ✅ No approvals required
- ✅ Can deploy from: `develop` branch only
- ✅ Auto-deploy on push

**Secrets Required:**

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `LOG_SALT`

### 2. Staging Environment

```yaml
Name: staging
URL: https://staging.running-app.example.com
```

**Protection Rules:**

- ✅ No approvals required
- ✅ Can deploy from: `main` branch only
- ✅ Auto-deploy on push to main

**Secrets Required:**

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `LOG_SALT`
- `SENTRY_DSN`
- `NEW_RELIC_LICENSE_KEY`

### 3. Production Approval Environment

```yaml
Name: production-approval
URL: N/A
```

**Protection Rules:**

- ✅ Required reviewers: 2
- ✅ Dismiss stale reviews: Yes
- ✅ Require review from CODEOWNERS: Yes
- ✅ Can deploy from: `main` branch and tags `v*`
- ⏱️ Wait timer: 5 minutes (optional)

**Required Reviewers:**

- Engineering Lead
- Product Owner or DevOps Engineer

### 4. Production Environment

```yaml
Name: production
URL: https://running-app.example.com
```

**Protection Rules:**

- ✅ Required reviewers: 1 (automatically satisfied by production-approval)
- ✅ Can deploy from: tags `v*` only
- ✅ Restrict deployments to specific users/teams
- ✅ Required status checks:
  - `pre-deployment-tests`
  - `security-checks`
  - `build-and-package`
  - `deploy-staging`
  - `approval-production`

**Secrets Required:**
All staging secrets plus:

- `DATABASE_REPLICA_URL`
- `REDIS_CLUSTER_URLS`
- `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`
- `DATADOG_API_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`

### 5. Production Rollback Environment

```yaml
Name: production-rollback
URL: https://running-app.example.com
```

**Protection Rules:**

- ✅ Required reviewers: 1 (Emergency approval)
- ✅ Can deploy from: Any branch (emergency)
- ⚡ No wait timer

**Required Reviewers:**

- On-call Engineer
- SRE Team Member

## Setup Instructions

### Step 1: Navigate to Repository Settings

```bash
# Go to your repository on GitHub
https://github.com/yourusername/running-app/settings/environments
```

### Step 2: Create Each Environment

For each environment listed above:

1. Click "New environment"
2. Enter the environment name
3. Click "Configure environment"

### Step 3: Configure Protection Rules

For environments requiring approval:

1. Check "Required reviewers"
2. Search and add reviewers or teams
3. Set the number of required approvals
4. Configure additional options:
   - **Prevent self-review**: Checked
   - **Dismiss stale reviews**: Checked for production
   - **Require review from CODEOWNERS**: Checked for production

### Step 4: Configure Deployment Branches

1. Check "Deployment branches"
2. Select "Selected branches"
3. Add branch/tag rules:
   - Development: `develop`
   - Staging: `main`
   - Production: `main`, `v*`

### Step 5: Add Environment Secrets

For each environment:

1. Click "Add secret"
2. Enter the secret name and value
3. Click "Add secret"

### Step 6: Configure Wait Timer (Optional)

For production environments:

1. Check "Wait timer"
2. Set minutes to wait (e.g., 5 minutes)
3. This gives time for last-minute interventions

### Step 7: Configure Required Status Checks

For production:

1. Check "Required status checks"
2. Search and select checks:
   - `test (18.x)`
   - `security-checks`
   - `build-and-package`
   - `deploy-staging`

## Approval Workflow

### Standard Production Deployment

1. **Developer** creates PR and merges to main
2. **CI/CD** automatically deploys to staging
3. **CI/CD** runs all tests and validations
4. **Deployment** pauses at `approval-production` job
5. **GitHub** sends notification to required reviewers
6. **Reviewers** check deployment report and approve/reject
7. **CI/CD** proceeds with production deployment if approved

### Emergency Rollback

1. **On-call** triggers rollback workflow
2. **CI/CD** pauses at rollback approval
3. **SRE/On-call** approves rollback
4. **System** automatically rolls back to previous version

## Best Practices

### 1. Reviewer Guidelines

Create a checklist for reviewers:

```markdown
## Production Deployment Checklist

- [ ] All tests passed in staging
- [ ] Performance metrics are acceptable
- [ ] No security vulnerabilities detected
- [ ] Database migrations reviewed (if any)
- [ ] Rollback plan is clear
- [ ] Communication sent to stakeholders
- [ ] Monitoring alerts configured
- [ ] On-call engineer notified
```

### 2. Approval Notifications

Configure notifications for approval requests:

1. **Slack Integration**:

   ```yaml
   - name: Notify Slack for approval
     if: job.status == 'waiting'
     uses: slackapi/slack-github-action@v1
     with:
       webhook-url: ${{ secrets.SLACK_WEBHOOK }}
       payload: |
         {
           "text": "🚀 Production deployment awaiting approval",
           "blocks": [{
             "type": "section",
             "text": {
               "type": "mrkdwn",
               "text": "*Production Deployment Request*\n*Version:* ${{ github.ref }}\n*Triggered by:* ${{ github.actor }}\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Deployment>"
             }
           }]
         }
   ```

2. **Email Notifications**: Automatically sent by GitHub

3. **PagerDuty Integration**: For critical deployments

### 3. Bypass Emergency Deployments

For emergency fixes:

1. Create environment: `emergency-production`
2. Minimal approval requirements (1 reviewer)
3. Use sparingly and audit all uses

### 4. Audit and Compliance

- All approvals are logged in GitHub
- Export deployment history for compliance
- Regular review of approval patterns
- Automated reports on deployment metrics

## Troubleshooting

### Issue: Deployment stuck waiting for approval

**Solution:**

1. Check reviewer availability
2. Verify correct reviewers are assigned
3. Check for GitHub notification issues
4. Use Slack/email for manual notification

### Issue: Wrong person approved

**Solution:**

1. Cancel the workflow run
2. Update environment protection rules
3. Re-run the deployment

### Issue: Can't see approval button

**Solution:**

1. Verify you're listed as a required reviewer
2. Check you have repository access
3. Clear browser cache
4. Try incognito mode

## Environment Variables in Workflows

Access environment URL and name in workflows:

```yaml
- name: Display environment info
  run: |
    echo "Deploying to: ${{ github.event.deployment.environment }}"
    echo "Environment URL: ${{ github.event.deployment.payload.web_url }}"
```

## Monitoring Approvals

Track approval metrics:

```sql
-- Query GitHub API for approval stats
SELECT
  environment,
  COUNT(*) as total_deployments,
  AVG(approval_time) as avg_approval_time,
  COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejections
FROM deployment_approvals
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY environment;
```

## Security Considerations

1. **Least Privilege**: Only add necessary reviewers
2. **Rotation**: Regularly rotate approval responsibilities
3. **Audit Trail**: All approvals are logged
4. **Two-Person Rule**: Enforce for production
5. **Time Windows**: Consider deployment windows

This completes the environment setup for manual approval workflows in the CI/CD pipeline.
