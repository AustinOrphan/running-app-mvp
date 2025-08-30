# GitHub Setup - Next Steps Checklist

Complete these steps to fully activate your GitHub repository management setup.

## 🚀 Immediate Actions (High Impact)

### 1. Install the Top 3 GitHub Apps

These will have immediate impact on your workflow:

- [ ] **[Codecov](https://github.com/marketplace/codecov)** - Visual coverage reports on every PR
  - Sign up at codecov.io
  - Add `CODECOV_TOKEN` to repository secrets
  - Copy `.github/config-examples/codecov.yml` to repository root
- [ ] **[All Contributors](https://github.com/marketplace/all-contributors)** - Recognize contributors automatically
  - Install from GitHub Marketplace
  - Copy `.github/config-examples/.all-contributorsrc` to repository root
  - Test with: `@all-contributors please add @yourusername for code`
- [ ] **[Release Drafter](https://github.com/marketplace/release-drafter)** - Automated release notes
  - Install from GitHub Marketplace
  - Copy `.github/config-examples/release-drafter.yml` to `.github/`
  - Will auto-generate release notes on next release

### 2. Configure Branch Protection

Go to **Settings → Branches → Add rule** for `main`:

- [ ] **Require pull request reviews before merging**
  - [ ] Dismiss stale pull request approvals when new commits are pushed
  - [ ] Require review from CODEOWNERS
  - [ ] Required approving reviews: 1

- [ ] **Require status checks to pass before merging**
  - [ ] Require branches to be up to date before merging
  - [ ] Status checks:
    - [ ] `quality` (from CI workflow)
    - [ ] `test` (from CI workflow)
    - [ ] `build` (from CI workflow)
    - [ ] `CodeQL` (security scanning)

- [ ] **Require conversation resolution before merging**

- [ ] **Include administrators** (enforce rules for admins too)

- [ ] **Restrict who can push to matching branches** (optional)
  - [ ] Add yourself or specific team members

### 3. Test Your New Setup

Create a test PR to verify everything works:

- [ ] **Create a test branch**

  ```bash
  git checkout -b test/github-setup-verification
  echo "# Test" >> test-file.md
  git add test-file.md
  git commit -m "test: verify GitHub setup configuration"
  git push origin test/github-setup-verification
  ```

- [ ] **Open PR and verify**:
  - [ ] CODEOWNERS auto-assigns you as reviewer
  - [ ] PR template appears correctly with all sections
  - [ ] CI/CD workflows trigger properly
  - [ ] Status badges update in README
  - [ ] All status checks run
  - [ ] Branch protection rules are enforced

- [ ] **Clean up test**:
  ```bash
  # After verification, close PR without merging
  git checkout main
  git branch -D test/github-setup-verification
  git push origin --delete test/github-setup-verification
  ```

## 📋 Additional Setup Tasks

### 4. Set Up Repository Secrets (if needed)

Go to **Settings → Secrets and variables → Actions**:

- [ ] `CODECOV_TOKEN` - From codecov.io dashboard
- [ ] `SONAR_TOKEN` - If using SonarCloud
- [ ] `DEPLOY_TOKEN` - For production deployments
- [ ] `SLACK_WEBHOOK` - For notifications (optional)

### 5. Configure GitHub Apps

After installing the apps:

- [ ] **Codecov**:
  - [ ] Link repository in Codecov dashboard
  - [ ] Configure coverage thresholds
  - [ ] Add coverage badge to README

- [ ] **All Contributors**:
  - [ ] Make first contributor addition
  - [ ] Verify bot responds to comments
  - [ ] Check contributors section appears in README

- [ ] **Release Drafter**:
  - [ ] Verify `.github/release-drafter.yml` is detected
  - [ ] Check draft release is created after merging PRs
  - [ ] Configure version resolver rules if needed

### 6. Team Communication

- [ ] Announce the new GitHub setup to your team
- [ ] Share this checklist with team members
- [ ] Document any custom workflows in team wiki
- [ ] Schedule a team session to review new PR process

## ✅ Completion Verification

Once all steps are complete, you should have:

- [ ] All 3 GitHub Apps installed and configured
- [ ] Branch protection rules active on `main`
- [ ] Successful test PR demonstrating all features
- [ ] Team members aware of new processes
- [ ] All configuration files in place
- [ ] Status badges visible in README

## 📝 Notes

- Keep this checklist for future reference
- Update configurations as your project grows
- Review GitHub Apps monthly for new features
- Monitor workflow execution times and optimize as needed

---

**Need Help?**

- Check `.github/workflows/README.md` for workflow documentation
- Review `.github/config-examples/` for configuration examples
- See `GITHUB_APPS_RECOMMENDATIONS.md` for detailed app information
