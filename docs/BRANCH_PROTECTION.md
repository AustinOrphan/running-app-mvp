# Branch Protection Rules

## Overview

This repository uses GitHub branch protection rules to ensure code quality and prevent accidental changes to the main branch. These rules are automatically configured and maintained through GitHub Actions.

## Protection Rules for `main` Branch

### Required Status Checks
The following CI checks must pass before any pull request can be merged:

- **Lint and Type Check** (`ci-lint-and-typecheck`)
  - ESLint validation
  - TypeScript type checking
  - Code formatting verification

- **Unit Tests** (`ci-unit-tests`)
  - Vitest unit tests
  - Component tests
  - Utility function tests

- **Integration Tests** (`ci-integration-tests`)
  - Jest integration tests
  - API endpoint tests
  - Database interaction tests

- **End-to-End Tests** (`ci-e2e-tests`)
  - Playwright E2E tests
  - Full user workflow tests
  - Cross-browser compatibility tests

All status checks must pass and branches must be up-to-date with main before merging is allowed.

### Pull Request Reviews
- **Minimum required approvals**: 1
- **Dismiss stale reviews**: Yes (when new commits are pushed)
- **Require review from code owners**: No (but recommended)
- **Require approval of most recent push**: No

### Additional Protections
- **Force pushes**: Disabled - protects against accidental history rewriting
- **Deletions**: Disabled - prevents accidental branch deletion
- **Conversation resolution**: Required - all PR conversations must be resolved
- **Up-to-date branches**: Required - branches must be current with main

## Workflow Integration

The branch protection rules are automatically configured by the `branch-protection.yml` workflow which runs:

- **On configuration changes**: When the workflow file or config is modified
- **Weekly maintenance**: Every Monday to ensure rules remain in place
- **Manual trigger**: Via workflow dispatch when needed

### Workflow Permissions

The workflow requires these permissions:
- `contents: read` - To access repository files
- `administration: write` - To modify branch protection settings

## Developer Workflow

### Standard Development Process

1. **Create feature branch** from `main`
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. **Make changes** and commit to feature branch
   ```bash
   git add .
   git commit -m "feat: implement new feature"
   git push origin feature/your-feature-name
   ```

3. **Create pull request** targeting `main`
   - Use the provided PR template
   - Include clear description of changes
   - Link any related issues

4. **Wait for CI checks** to pass
   - Monitor the Actions tab for progress
   - Address any failing tests or linting issues

5. **Request review** from team member
   - Use GitHub's review request feature
   - Code owners are automatically notified

6. **Address feedback** and resolve conversations
   - Make requested changes
   - Push additional commits as needed
   - Resolve all conversation threads

7. **Merge** once approved and all checks pass
   - Use "Squash and merge" for clean history
   - Delete feature branch after merge

### Emergency Procedures

For critical hotfixes that need immediate deployment:

1. **Administrator override**: Repository admins can temporarily bypass protections
2. **Hotfix branch**: Create from main, minimal changes only
3. **Expedited review**: Get immediate review from available team member
4. **Post-merge validation**: Ensure all tests pass after merge

## Troubleshooting

### CI Checks Failing

**Lint and Type Check Issues:**
```bash
# Run locally to debug
npm run lint:fix
npm run typecheck
```

**Unit Test Failures:**
```bash
# Run locally with watch mode
npm run test
npm run test:coverage
```

**Integration Test Issues:**
```bash
# Run integration tests locally
npm run test:integration
```

**E2E Test Problems:**
```bash
# Run E2E tests locally
npm run test:e2e
npm run test:e2e:ui  # With UI for debugging
```

### Cannot Merge PR

**Status checks not passing:**
- Check the Actions tab for detailed error messages
- Ensure all tests pass locally before pushing
- Verify linting and type checking passes

**Missing required approval:**
- Request review from team member
- Ensure reviewer has write access to repository

**Conversations not resolved:**
- Check all comment threads in PR
- Resolve or reply to all open conversations

**Branch not up-to-date:**
```bash
# Update your branch with latest main
git checkout main
git pull origin main
git checkout your-feature-branch
git merge main
# Or use rebase for cleaner history
git rebase main
```

### Force Push Blocked

This is intentional protection. Instead:

1. **Use regular pushes** for additional commits
2. **Create new PR** if you need to completely change approach
3. **Ask admin** to temporarily disable protection if absolutely necessary

### Permission Issues

If the branch protection workflow fails:

1. **Check token permissions**: Ensure GITHUB_TOKEN has admin rights
2. **Repository settings**: Verify Actions have write permissions
3. **Organization settings**: Check if organization policies override repository settings

## Configuration Management

### Modifying Protection Rules

Branch protection rules are managed via configuration files:

**Main configuration**: `.github/workflows/branch-protection.yml`
**Settings file**: `.github/branch-protection.json`

To modify the rules:

1. Update the protection configuration in the workflow file
2. Modify required status checks, review requirements, etc.
3. Commit and push to main
4. The workflow will automatically apply the new rules

### Required Status Checks

To add or remove required status checks, modify the `contexts` array in the workflow:

```yaml
contexts: [
  'ci-lint-and-typecheck',
  'ci-unit-tests',
  'ci-integration-tests',
  'ci-e2e-tests',
  'new-check-name'  # Add new required check
]
```

### Review Requirements

To change review requirements, modify the `required_pull_request_reviews` section:

```yaml
required_pull_request_reviews:
  required_approving_review_count: 2  # Increase required approvals
  dismiss_stale_reviews: true
  require_code_owner_reviews: true    # Require code owner approval
```

## Security Considerations

### Protection Benefits

- **Code quality**: All code must pass CI checks before merging
- **Peer review**: Human oversight prevents bugs and security issues
- **History protection**: Force push prevention maintains clean git history
- **Process enforcement**: Ensures consistent development workflow

### Best Practices

1. **Regular updates**: Keep protection rules current with project needs
2. **Monitor bypasses**: Track any admin overrides for audit purposes
3. **Education**: Ensure all team members understand the workflow
4. **Documentation**: Keep this guide updated with any changes

### Compliance

These protection rules help maintain:
- **Code quality standards**
- **Security review processes**
- **Audit trail for changes**
- **Team collaboration practices**

## Maintenance

### Weekly Checks

The automated workflow performs weekly maintenance:
- Verifies protection rules are still in place
- Reports any configuration drift
- Re-applies rules if they were modified outside the workflow

### Manual Verification

To manually check protection status:

1. Go to repository **Settings** → **Branches**
2. Check protection rules for `main` branch
3. Verify all required status checks are listed
4. Confirm review requirements are correct

### Troubleshooting Configuration

If protection rules are not working:

1. **Check workflow runs** in Actions tab
2. **Verify permissions** for GitHub token
3. **Review repository settings** for any conflicts
4. **Check organization policies** that might override settings

## Related Documentation

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)
- [CODEOWNERS File](../.github/CODEOWNERS)
- [Pull Request Template](../.github/PULL_REQUEST_TEMPLATE.md)
- [Contributing Guidelines](../CONTRIBUTING.md)

## Support

For questions about branch protection rules:

1. **Check this documentation** for common issues
2. **Review workflow logs** in the Actions tab
3. **Create issue** in the repository for configuration problems
4. **Contact repository admin** for urgent access needs