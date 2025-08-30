# Dependency Management

## Overview

This project uses automated dependency management through GitHub's Dependabot service combined with custom workflows to ensure dependencies stay up-to-date and secure while maintaining stability.

## Automated Dependency Updates

### Dependabot Configuration

Dependabot is configured via `.github/dependabot.yml` with multiple update schedules:

#### Regular Updates (Weekly - Mondays 9:00 AM ET)

- **NPM packages**: Grouped by type (security-critical, production, testing, etc.)
- **Update types**: Minor and patch versions only
- **Pull request limit**: 15 concurrent PRs
- **Auto-assignment**: PRs automatically assigned to maintainers

#### Security Updates (Daily - 6:00 AM ET)

- **Focus**: Security vulnerabilities only
- **Priority**: High priority labels applied
- **Pull request limit**: 5 concurrent PRs
- **Fast-track**: Auto-approved and merged when possible

#### GitHub Actions (Weekly - Tuesdays 10:00 AM ET)

- **Actions updates**: Grouped by functionality
- **Pull request limit**: 5 concurrent PRs
- **Validation**: Full CI pipeline runs before merge

#### Docker Images (Weekly - Wednesdays 11:00 AM ET)

- **Base images**: Security and version updates
- **Pull request limit**: 3 concurrent PRs
- **Infrastructure focus**: Container security

### Dependency Groups

Dependencies are organized into logical groups for easier management:

#### Security-Critical Dependencies

- `express`, `helmet`, `cors`, `bcrypt`, `jsonwebtoken`
- **Auto-merge**: Yes (after validation)
- **Priority**: Critical security fixes

#### Production Dependencies

- `@prisma/client`, `prisma`, `zod`, `uuid`, `date-fns`
- **Auto-merge**: Patch versions only
- **Review**: Minor versions require manual review

#### React Ecosystem

- `react`, `react-dom`, `react-router-dom`, `@vitejs/plugin-react`
- **Auto-merge**: Patch versions only
- **Testing**: Full E2E test suite required

#### Testing Tools

- `vitest`, `jest`, `playwright`, `@testing-library/*`
- **Auto-merge**: Minor and patch versions
- **Validation**: All test suites must pass

#### Code Quality Tools

- `eslint`, `prettier`, `@typescript-eslint/*`
- **Auto-merge**: Yes (low risk)
- **Validation**: Lint checks must pass

#### Type Definitions

- `@types/*` packages
- **Auto-merge**: Yes (very low risk)
- **Validation**: Type checking must pass

## Automated Workflows

### Dependency Update Validation

The `.github/workflows/dependency-updates.yml` workflow provides:

#### Detection and Classification

- Automatically detects Dependabot PRs
- Classifies update type (security, regular, CI)
- Identifies package ecosystem (npm, actions, docker)

#### Validation Pipeline

- **Build verification**: Ensures project builds successfully
- **Test execution**: Runs full test suite (unit, integration, E2E)
- **Code quality**: Linting and type checking
- **Security audit**: Vulnerability scanning

#### Auto-merge Logic

Low-risk updates are automatically merged when:

- All validation checks pass
- Update is a security fix, patch version, or type definition
- No manual review flags are set

#### Manual Review Triggers

Updates require manual review when:

- Major version changes detected
- Test validation fails
- Build or compilation errors occur
- Security audit reveals new issues

### Workflow Outcomes

#### ✅ Auto-merged Updates

- Security patches
- Type definition updates
- Linting tool updates
- Patch version bumps for stable packages

#### 👀 Manual Review Required

- Minor version updates for core dependencies
- Major version updates
- React ecosystem changes
- Database-related updates

#### ❌ Failed Validation

- Breaking changes detected
- Test failures
- Build errors
- New security vulnerabilities

## Manual Dependency Management

### Checking Dependency Health

Use the custom dependency checker script:

```bash
# Full dependency health check
node scripts/check-dependencies.js

# Security vulnerabilities only
node scripts/check-dependencies.js --security-only

# Outdated packages only
node scripts/check-dependencies.js --outdated-only

# Auto-fix security issues
node scripts/check-dependencies.js --fix

# JSON output for CI/automation
node scripts/check-dependencies.js --json
```

### NPM Scripts

#### Package Management

```bash
# Check for outdated packages
npm outdated

# Update all packages to wanted versions
npm update

# Update specific package
npm install package@latest

# Security audit
npm audit
npm audit fix
```

#### Automated Commands

```bash
# Check dependency health
npm run deps:check

# Fix security vulnerabilities
npm run deps:fix

# Update all dependencies
npm run deps:update
```

### Manual Update Process

For major version updates or complex changes:

1. **Create feature branch**

   ```bash
   git checkout -b deps/update-package-name
   ```

2. **Update specific package**

   ```bash
   npm install package@latest
   ```

3. **Run full validation**

   ```bash
   npm run lint:check
   npm run test:all:complete
   npm run build
   ```

4. **Check for breaking changes**
   - Review package changelog
   - Check migration guides
   - Test critical functionality

5. **Update code if needed**
   - Fix breaking changes
   - Update API usage
   - Modify tests

6. **Create pull request**
   - Include testing notes
   - Document any breaking changes
   - Link to relevant documentation

## Security Management

### Vulnerability Monitoring

#### Automated Security Scanning

- **Daily**: Dependabot security updates
- **On PR**: Security audit in CI pipeline
- **Weekly**: Comprehensive dependency review

#### Security Response Process

**Critical/High Severity:**

1. Immediate notification via Dependabot PR
2. Auto-merge if tests pass
3. Hotfix deployment if necessary
4. Security advisory review

**Moderate/Low Severity:**

1. Scheduled update in weekly cycle
2. Manual review for impact assessment
3. Regular deployment cycle

### Security Best Practices

#### Dependency Selection

- Choose packages with active maintenance
- Prefer packages with security disclosure policies
- Avoid packages with known security issues
- Regularly review package permissions

#### Update Strategy

- Security updates: Immediate
- Major versions: Careful review and testing
- Minor/patch versions: Automated with validation
- Dev dependencies: More permissive updates

## Troubleshooting

### Common Issues

#### Dependabot PRs Not Created

**Possible causes:**

- Configuration syntax errors in `dependabot.yml`
- Rate limits reached
- Repository permissions issues

**Solutions:**

- Validate YAML syntax
- Check Dependabot logs in repository insights
- Verify repository settings allow Dependabot

#### Auto-merge Not Working

**Possible causes:**

- Branch protection rules require reviews
- CI checks failing
- Manual review labels present

**Solutions:**

- Check branch protection settings
- Review CI workflow logs
- Remove blocking labels if appropriate

#### Large Number of Outdated Dependencies

**Strategies:**

- Prioritize security updates first
- Group related updates together
- Update in phases (dev tools → testing → production)
- Consider major version migration planning

### Dependency Conflicts

#### Peer Dependency Issues

```bash
# Check peer dependency warnings
npm install --legacy-peer-deps

# Resolve conflicts manually
npm install package@compatible-version
```

#### Version Conflicts

```bash
# Check dependency tree
npm ls

# Find duplicate packages
npm ls --depth=0

# Force resolution
npm install package@exact-version --save-exact
```

## Configuration Management

### Dependabot Settings

#### Schedule Customization

Modify `.github/dependabot.yml` to adjust:

- Update frequency (daily, weekly, monthly)
- Time zones and specific times
- Maximum number of open PRs
- Target branches

#### Group Configuration

Add new dependency groups:

```yaml
groups:
  new-group-name:
    applies-to: version-updates
    patterns:
      - 'package-pattern'
      - 'another-pattern'
    update-types:
      - 'minor'
      - 'patch'
```

#### Ignore Patterns

Exclude specific packages or update types:

```yaml
ignore:
  - dependency-name: 'package-name'
    update-types: ['version-update:semver-major']
```

### Workflow Customization

#### Auto-merge Criteria

Modify auto-merge logic in `.github/workflows/dependency-updates.yml`:

- Add/remove package patterns
- Adjust risk assessment rules
- Change validation requirements

#### Notification Settings

Configure Slack/email notifications:

- Security vulnerability alerts
- Failed update notifications
- Weekly dependency reports

## Best Practices

### Update Strategy

#### Production Dependencies

- **Conservative approach**: Patch and minor updates only
- **Extensive testing**: Full test suite including E2E tests
- **Staged rollout**: Deploy to staging first
- **Monitoring**: Watch for issues post-deployment

#### Development Dependencies

- **Aggressive updates**: Keep development tools current
- **Quick validation**: Ensure development workflow works
- **Team coordination**: Communicate breaking changes

#### Testing Dependencies

- **Balanced approach**: Keep current but validate thoroughly
- **Test isolation**: Ensure tests remain reliable
- **Compatibility**: Verify with CI/CD pipeline

### Security Practices

#### Regular Reviews

- **Monthly audit**: Review all dependencies
- **Quarterly assessment**: Evaluate dependency necessity
- **Annual cleanup**: Remove unused dependencies

#### Risk Assessment

- **Package popularity**: Prefer widely-used packages
- **Maintenance status**: Avoid abandoned packages
- **Security history**: Research past vulnerabilities
- **License compatibility**: Ensure license compliance

### Team Coordination

#### Communication

- **Update notifications**: Inform team of major updates
- **Breaking changes**: Document impact and migration steps
- **Security updates**: Immediate notification for critical fixes

#### Documentation

- **Changelog maintenance**: Keep dependency changes documented
- **Migration guides**: Create guides for major updates
- **Decision records**: Document why certain versions are pinned

## Monitoring and Metrics

### Key Metrics

#### Update Velocity

- Time from release to deployment
- Number of automated vs manual updates
- Update success rate

#### Security Posture

- Time to patch security vulnerabilities
- Number of known vulnerabilities
- Security audit frequency

#### Stability Impact

- Build failure rate after updates
- Test failure rate after updates
- Production incident correlation

### Reporting

#### Weekly Reports

- Dependency updates applied
- Security vulnerabilities addressed
- Manual updates pending

#### Monthly Analysis

- Dependency health overview
- Update pattern analysis
- Security posture assessment

#### Quarterly Review

- Dependency strategy effectiveness
- Process improvement opportunities
- Tool and configuration updates

## Related Documentation

- [Branch Protection Rules](BRANCH_PROTECTION.md)
- [CI/CD Pipeline Documentation](CI_CD.md)
- [Security Guidelines](SECURITY.md)
- [Contributing Guidelines](../CONTRIBUTING.md)

## External Resources

- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot)
- [NPM Audit Documentation](https://docs.npmjs.com/cli/v8/commands/npm-audit)
- [Semantic Versioning](https://semver.org/)
- [GitHub Security Advisories](https://github.com/advisories)
