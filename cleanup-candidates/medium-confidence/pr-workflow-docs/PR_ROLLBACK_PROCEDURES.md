# 🔄 PR Rollback Procedures

## 🚨 Emergency Rollback Guide

This document provides step-by-step rollback procedures for each PR in case issues arise post-merge.

---

## 🎯 Rollback Decision Framework

### When to Rollback vs Fix Forward

| Severity | Impact       | User Facing | Action       | Timeline      |
| -------- | ------------ | ----------- | ------------ | ------------- |
| Critical | >50% users   | Yes         | **Rollback** | Immediate     |
| High     | 10-50% users | Yes         | **Rollback** | Within 15 min |
| Medium   | <10% users   | Yes         | Assess       | Within 1 hour |
| Low      | Dev only     | No          | Fix Forward  | Next PR       |

### Rollback Authorization

- **Critical Issues**: Any team member can initiate
- **High Issues**: Tech Lead or Senior Dev approval
- **Medium/Low**: Team discussion required

---

## 📋 PR-Specific Rollback Procedures

### PR #293: Stats Page NaN Fix

**Risk Level**: HIGH (User-facing bug fix)

#### Rollback Indicators:

- New calculation errors appearing
- Performance degradation >20%
- Stats page crashes
- Data corruption in statistics

#### Rollback Commands:

```bash
# 1. Identify merge commit
git log --oneline --grep="Fix NaN" -n 1
MERGE_COMMIT=$(git log --oneline --grep="Fix NaN" -n 1 | cut -d' ' -f1)

# 2. Create rollback branch
git checkout -b rollback/pr-293-stats-fix
git revert $MERGE_COMMIT

# 3. Test rollback locally
npm run test:unit -- stats
npm run dev
# Manually verify stats page

# 4. Push rollback
git push origin rollback/pr-293-stats-fix

# 5. Create emergency PR
gh pr create --title "🚨 Rollback: PR #293 Stats Fix" \
  --body "Rolling back stats fix due to [ISSUE]" \
  --label "emergency,rollback" \
  --reviewer tech-lead
```

#### Post-Rollback Actions:

1. Document the specific issue that triggered rollback
2. Create bug report with reproduction steps
3. Add regression test for the issue
4. Plan fix with additional testing

---

### PR #289: Test Infrastructure

**Risk Level**: LOW (Development impact only)

#### Rollback Indicators:

- CI/CD pipeline failures
- Test execution hanging
- False positive test results
- Significant slowdown in test execution (>2x)

#### Rollback Commands:

```bash
# Remove new test configurations
git checkout main -- package.json jest.config.js vitest.config.ts
git checkout main -- .github/workflows/ci.yml

# Revert test files if needed
git checkout main -- tests/

# Clean and reinstall
rm -rf node_modules package-lock.json
npm install

# Verify old tests work
npm test
```

#### Selective Rollback Options:

```bash
# Keep some improvements while reverting problematic parts
# Example: Keep unit tests, revert E2E
git checkout main -- tests/e2e/
git commit -m "Partial rollback: Remove problematic E2E tests"
```

---

### PR #281: Development Login Bypass

**Risk Level**: CRITICAL (Security feature)

#### Rollback Indicators:

- Bypass accessible in production
- Authentication failures in development
- Security scan alerts
- Unintended access paths

#### IMMEDIATE Rollback Commands:

```bash
# URGENT: If bypass detected in production
# 1. Immediate revert
MERGE_COMMIT=$(git log --oneline --grep="login bypass" -n 1 | cut -d' ' -f1)
git revert $MERGE_COMMIT --no-edit
git push origin main

# 2. Force deploy to production
npm run deploy:emergency -- --skip-tests

# 3. Verify production secure
curl -X POST https://api.running-app.com/api/auth/dev-bypass \
  -H "Content-Type: application/json" \
  -d '{"bypass": true}'
# Should return 404 or 403

# 4. Audit logs for any usage
kubectl logs -n running-app-prod --since=24h | grep -i "bypass"
```

#### Security Incident Response:

1. Immediate rollback (no approval needed)
2. Trigger security incident protocol
3. Audit all access logs
4. Rotate all credentials
5. Security postmortem required

---

## 🔄 Batch Rollback Procedures

### Development Dependencies Batch

**PRs**: #282, #285, #286, #288

#### Rollback Commands:

```bash
# Revert to previous package-lock.json
git checkout main~1 -- package-lock.json package.json
npm ci

# If specific dependency is problematic
npm install <package>@<previous-version> --save-dev

# Verify development environment
npm run dev
npm run test
npm run build
```

### Production Dependencies Batch

**PRs**: #283, #287, #290, #291

#### Rollback Commands:

```bash
# Full dependency rollback
git checkout main~1 -- package-lock.json package.json
npm ci
npm run build

# Selective rollback for specific package
# Example: Rollback only Vite
npm install vite@4.5.2 --save

# Test production build
npm run build
npm run preview
```

---

## 🚀 Automated Rollback Scripts

### quick-rollback.sh

```bash
#!/bin/bash
# Emergency rollback script

PR_NUMBER=$1
REASON=$2

if [ -z "$PR_NUMBER" ] || [ -z "$REASON" ]; then
  echo "Usage: ./quick-rollback.sh <PR_NUMBER> '<REASON>'"
  exit 1
fi

echo "🚨 Initiating rollback for PR #$PR_NUMBER"
echo "Reason: $REASON"

# Find merge commit
MERGE_COMMIT=$(git log --oneline --grep="#$PR_NUMBER" -n 1 | cut -d' ' -f1)

if [ -z "$MERGE_COMMIT" ]; then
  echo "❌ Could not find merge commit for PR #$PR_NUMBER"
  exit 1
fi

# Create rollback
git checkout main
git pull origin main
git checkout -b "rollback/pr-$PR_NUMBER"
git revert $MERGE_COMMIT --no-edit

# Run tests
npm test || {
  echo "⚠️  Tests failing after rollback - proceed with caution"
}

# Push and create PR
git push origin "rollback/pr-$PR_NUMBER"

gh pr create \
  --title "🚨 Rollback PR #$PR_NUMBER" \
  --body "Reason: $REASON" \
  --label "emergency,rollback" \
  --base main

echo "✅ Rollback PR created - requires approval for merge"
```

---

## 📊 Rollback Metrics Tracking

### Track Rollback Events:

```javascript
// lib/metrics.js
export function trackRollback(prNumber, reason, severity) {
  // Send to monitoring service
  fetch('/api/metrics/rollback', {
    method: 'POST',
    body: JSON.stringify({
      pr_number: prNumber,
      reason: reason,
      severity: severity,
      timestamp: new Date().toISOString(),
      user: process.env.USER,
    }),
  });

  // Log for audit
  console.error(`ROLLBACK: PR #${prNumber} - ${reason}`);
}
```

---

## 📋 Rollback Verification Checklist

### Immediate Checks (5 minutes):

- [ ] Rollback commit merged successfully
- [ ] CI/CD pipeline green
- [ ] Application starts without errors
- [ ] Critical user paths functional
- [ ] Error rates returning to normal

### Extended Checks (30 minutes):

- [ ] All test suites passing
- [ ] No new errors in logs
- [ ] Performance metrics stable
- [ ] No user complaints
- [ ] Database integrity verified

### Follow-up Actions (24 hours):

- [ ] Root cause analysis documented
- [ ] Fix planned with additional tests
- [ ] Team retrospective scheduled
- [ ] Monitoring alerts adjusted
- [ ] Rollback playbook updated

---

## 🎯 Rollback Communication Template

### Slack/Team Message:

```
🚨 **Rollback Initiated**

**PR**: #[NUMBER] - [TITLE]
**Reason**: [Brief description of issue]
**Impact**: [User impact assessment]
**Status**: Rollback in progress

**Actions**:
- Rollback PR created: [Link]
- Monitoring: [Dashboard link]
- Incident: [Ticket link]

**ETA**: ~15 minutes for completion

@oncall @teamlead
```

### Incident Report Template:

```markdown
# Incident Report: PR #[NUMBER] Rollback

## Summary

- **Date/Time**: [ISO timestamp]
- **Duration**: [Time from merge to rollback]
- **Impact**: [User impact percentage and description]
- **Root Cause**: [Technical description]

## Timeline

- T+0: PR merged
- T+X: Issue detected via [monitoring/user report]
- T+Y: Rollback decision made
- T+Z: Rollback completed

## Lessons Learned

1. [What went wrong]
2. [What worked well]
3. [What to improve]

## Action Items

- [ ] Add test case for this scenario
- [ ] Update monitoring alerts
- [ ] Fix and re-submit PR
- [ ] Update documentation
```

---

## 🔗 Quick Reference

### Emergency Contacts:

- On-Call: [Phone/Slack]
- Tech Lead: [Contact]
- DevOps: [Contact]

### Key Commands:

```bash
# Quick rollback
git revert HEAD --no-edit && git push

# Check current deployed version
kubectl describe deployment -n running-app-prod

# Force deployment
npm run deploy:emergency

# View recent changes
git log --oneline -10
```

### Monitoring Links:

- [Error Dashboard](link)
- [Performance Metrics](link)
- [CI/CD Status](link)
- [Incident Tracking](link)

---

**Remember**: A clean rollback is better than a prolonged outage. When in doubt, roll back!
