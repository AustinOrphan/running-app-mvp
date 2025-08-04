# 🌳 Git Worktree Setup for CI Failure Resolution

This guide explains how to use git worktrees to efficiently resolve CI failures in PR 298 by working on multiple fixes in parallel.

## 📖 What are Git Worktrees?

Git worktrees allow you to have multiple working directories for the same repository, each checked out to different branches. This enables:

- **Parallel Development**: Work on multiple fixes simultaneously
- **Quick Context Switching**: Switch between different problem areas instantly
- **Isolated Testing**: Test fixes independently without affecting main workspace
- **Efficient CI Debugging**: Keep CI logs and local fixes separate

## 🚀 Quick Setup

### 1. Create Worktrees for Each Fix Category

```bash
# Navigate to your main repository
cd "/Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp"

# Create worktrees for different fix categories
git worktree add ../running-app-mvp-unit-tests -b fix/unit-tests-pr298 feat/comprehensive-ci-cd-infrastructure
git worktree add ../running-app-mvp-integration -b fix/integration-tests-pr298 feat/comprehensive-ci-cd-infrastructure
git worktree add ../running-app-mvp-e2e -b fix/e2e-tests-pr298 feat/comprehensive-ci-cd-infrastructure
git worktree add ../running-app-mvp-build -b fix/build-config-pr298 feat/comprehensive-ci-cd-infrastructure
git worktree add ../running-app-mvp-linting -b fix/linting-pr298 feat/comprehensive-ci-cd-infrastructure
```

### 2. Verify Worktree Setup

```bash
# List all worktrees
git worktree list

# Expected output:
# /Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp                    feat/comprehensive-ci-cd-infrastructure
# /Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp-unit-tests        fix/unit-tests-pr298
# /Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp-integration       fix/integration-tests-pr298
# /Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp-e2e              fix/e2e-tests-pr298
# /Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp-build            fix/build-config-pr298
# /Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp-linting          fix/linting-pr298
```

## 🛠️ Worktree-Based Development Workflow

### Phase 1: Critical Test Failures (Parallel Development)

#### Unit Tests Worktree

```bash
# Switch to unit tests worktree
cd ../running-app-mvp-unit-tests

# Install dependencies (if needed)
npm install

# Focus on unit test fixes
npm run test:run
# Fix issues found...

# Commit unit test fixes
git add .
git commit -m "fix: resolve unit test configuration issues

- Update vitest.config.ts path resolution
- Fix test setup file loading
- Resolve import/export conflicts"

# Push branch for CI testing
git push -u origin fix/unit-tests-pr298
```

#### Integration Tests Worktree

```bash
# Switch to integration tests worktree
cd ../running-app-mvp-integration

# Focus on integration test fixes
npm run test:integration
# Fix database setup issues...

# Commit integration fixes
git add .
git commit -m "fix: resolve integration test database issues

- Update jest.config.ci.js for CI environment
- Fix SQLite permissions and timeouts
- Improve transaction isolation"

# Push branch for CI testing
git push -u origin fix/integration-tests-pr298
```

#### E2E Tests Worktree

```bash
# Switch to E2E tests worktree
cd ../running-app-mvp-e2e

# Focus on E2E test fixes
npm run test:e2e:ci
# Fix Playwright configuration...

# Commit E2E fixes
git add .
git commit -m "fix: resolve E2E test sharding and browser issues

- Update playwright.config.ci.ts headless settings
- Fix browser installation in CI workflows
- Resolve test sharding distribution"

# Push branch for CI testing
git push -u origin fix/e2e-tests-pr298
```

### Phase 2: Build and Quality Fixes

#### Build Configuration Worktree

```bash
# Switch to build config worktree
cd ../running-app-mvp-build

# Focus on build fixes
npm run build
# Fix Vite/TypeScript issues...

# Commit build fixes
git add .
git commit -m "fix: resolve build configuration conflicts

- Fix vite.config.ts TypeScript integration
- Resolve build dependency conflicts
- Update build output configuration"

# Push branch for CI testing
git push -u origin fix/build-config-pr298
```

#### Linting Worktree

```bash
# Switch to linting worktree
cd ../running-app-mvp-linting

# Quick linting fixes
npm run lint:fix
npm run format

# Commit linting fixes
git add .
git commit -m "fix: resolve linting and formatting issues

- Apply automated ESLint fixes
- Resolve Prettier formatting conflicts
- Fix TypeScript strict mode issues"

# Push branch for CI testing
git push -u origin fix/linting-pr298
```

## 🔄 Integration Workflow

### 1. Merge Successful Fixes Back

```bash
# Return to main worktree
cd "/Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp"

# Merge successful fixes one by one
git merge fix/linting-pr298              # Start with quick wins
git merge fix/unit-tests-pr298           # Then foundational fixes
git merge fix/build-config-pr298         # Build configuration
git merge fix/integration-tests-pr298    # Database fixes
git merge fix/e2e-tests-pr298           # E2E configuration

# Push updated main branch
git push origin feat/comprehensive-ci-cd-infrastructure
```

### 2. Test Combined Changes

```bash
# Verify all fixes work together
npm run test:all:complete

# Push for final CI validation
git push origin feat/comprehensive-ci-cd-infrastructure
```

## 📊 Worktree Management Commands

### Essential Commands

```bash
# List all worktrees
git worktree list

# Remove a worktree (after merging)
git worktree remove ../running-app-mvp-unit-tests
# Or if files are modified:
git worktree remove --force ../running-app-mvp-unit-tests

# Prune removed worktrees
git worktree prune

# Move a worktree to different location
git worktree move ../running-app-mvp-unit-tests ../new-location
```

### Branch Management

```bash
# Delete merged fix branches
git branch -d fix/unit-tests-pr298
git branch -d fix/integration-tests-pr298
git branch -d fix/e2e-tests-pr298
git branch -d fix/build-config-pr298
git branch -d fix/linting-pr298

# Delete remote branches after merging
git push origin --delete fix/unit-tests-pr298
git push origin --delete fix/integration-tests-pr298
git push origin --delete fix/e2e-tests-pr298
git push origin --delete fix/build-config-pr298
git push origin --delete fix/linting-pr298
```

## 🎯 Worktree-Specific Testing Strategy

### Isolated Testing per Worktree

#### Unit Tests Worktree

```bash
cd ../running-app-mvp-unit-tests

# Focus only on unit test fixes
npm run test:run
npm run test:coverage

# Verify specific test categories
npm run test -- --testPathPattern="unit"
```

#### Integration Tests Worktree

```bash
cd ../running-app-mvp-integration

# Focus only on integration fixes
npm run test:integration
npm run test:integration:ci

# Test database setup specifically
npm run ci-db-setup
npm run verify-db-setup
```

#### E2E Tests Worktree

```bash
cd ../running-app-mvp-e2e

# Focus only on E2E fixes
npm run test:e2e:ci
npm run test:e2e -- --headed

# Test sharding configuration
npm run test:e2e -- --shard=1/3
npm run test:e2e -- --shard=2/3
npm run test:e2e -- --shard=3/3
```

### Cross-Worktree Validation

```bash
# Test script to validate all worktrees
#!/bin/bash

worktrees=("../running-app-mvp-unit-tests" "../running-app-mvp-integration" "../running-app-mvp-e2e" "../running-app-mvp-build" "../running-app-mvp-linting")

for worktree in "${worktrees[@]}"; do
    echo "Testing $worktree..."
    cd "$worktree"

    # Run appropriate tests for each worktree
    case "$worktree" in
        *unit-tests*)
            npm run test:run
            ;;
        *integration*)
            npm run test:integration
            ;;
        *e2e*)
            npm run test:e2e:ci
            ;;
        *build*)
            npm run build
            ;;
        *linting*)
            npm run lint
            ;;
    esac

    echo "✅ $worktree tests complete"
done
```

## 🚨 Best Practices and Considerations

### DO's ✅

1. **Keep Worktrees Focused**: Each worktree should focus on one specific problem area
2. **Regular Syncing**: Sync with main branch regularly to avoid conflicts
3. **Clean Commits**: Make focused, atomic commits in each worktree
4. **Test Locally First**: Always test fixes locally before pushing
5. **Document Changes**: Use clear commit messages describing the specific fix

### DON'Ts ❌

1. **Don't Cross-Contaminate**: Keep fixes isolated to their respective worktrees
2. **Don't Skip Testing**: Always run relevant tests in each worktree
3. **Don't Rush Merging**: Ensure each fix is complete before merging
4. **Don't Forget Cleanup**: Remove worktrees and branches after successful merges
5. **Don't Mix Concerns**: Keep different types of fixes in separate worktrees

### Troubleshooting Worktrees

```bash
# If worktree creation fails
git worktree add --force ../path-to-worktree -b branch-name base-branch

# If worktree is corrupted
git worktree remove --force ../path-to-worktree
git worktree add ../path-to-worktree -b new-branch-name base-branch

# If branches get out of sync
cd ../worktree-path
git fetch origin
git rebase origin/feat/comprehensive-ci-cd-infrastructure
```

## 📋 Worktree Checklist

### Setup Phase

- [ ] Create all required worktrees
- [ ] Verify worktree list is correct
- [ ] Install dependencies in each worktree (if needed)
- [ ] Verify each worktree can run its specific tests

### Development Phase

- [ ] Focus on one fix category per worktree
- [ ] Run targeted tests in each worktree
- [ ] Make atomic commits with clear messages
- [ ] Push branches for CI validation

### Integration Phase

- [ ] Merge successful fixes back to main branch
- [ ] Test combined changes
- [ ] Resolve any merge conflicts
- [ ] Verify full CI pipeline passes

### Cleanup Phase

- [ ] Remove worktrees after successful merges
- [ ] Delete fix branches (local and remote)
- [ ] Prune worktree references
- [ ] Update documentation

## 🎉 Benefits of Worktree Approach

1. **Parallel Development**: Work on multiple fixes simultaneously
2. **Isolated Testing**: Test each fix category independently
3. **Faster Iteration**: Quick context switching between problem areas
4. **Reduced Conflicts**: Smaller, focused changes reduce merge conflicts
5. **Better CI Feedback**: Individual branches provide targeted CI feedback
6. **Easier Debugging**: Isolate issues to specific problem areas
7. **Team Collaboration**: Multiple developers can work on different aspects

This worktree-based approach will significantly accelerate the resolution of CI failures in PR 298 by enabling parallel development and focused testing.
