# Repository Cleanup Master Plan

## Executive Summary

This repository has accumulated significant technical debt and redundancy over time. The main issues include:

- **100+ npm scripts** (majority are test-related variations)
- **30+ documentation files** with overlapping content
- **Multiple test frameworks** (Jest, Vitest, Playwright) with duplicate configurations
- **69 TypeScript errors** indicating broken imports and configurations
- **Duplicate files** (files ending with "2", "3", multiple configs for same tools)
- **Test artifacts** committed to repository (logs, cache directories)
- **Inconsistent code organization** (multiple server entry points)

## Current State Analysis

### File System Issues

- **Duplicate Files**: 15+ files with "2" or "3" suffixes
- **Cache Directories**: 5 cache directories that shouldn't be in version control
- **Test Logs**: 4 test output logs committed to repo
- **Redundant Configs**: 3-4 config files per tool (Jest, Vitest, Playwright)

### Code Organization Issues

- **Server Code**: 3 different server directories/files (server.ts, server/, src/server/)
- **Middleware**: Separate middleware directory outside of server structure
- **Routes**: Routes directory separate from server implementation
- **Utils**: Utils directory at root level duplicating src/utils

### Testing Infrastructure Issues

- **Test Frameworks**: 3 different test runners for similar purposes
- **Test Scripts**: 100+ npm scripts, mostly test variations
- **Test Directories**: Multiple test directory structures (tests/, src/\*_/_.test.ts)
- **Coverage Reports**: Multiple coverage directories and configurations

### Documentation Chaos

- **CI Documentation**: CI.md, CI 2.md, multiple CI-related docs
- **Deployment Docs**: 5+ deployment-related documents
- **Testing Docs**: 8+ testing strategy documents
- **Setup Guides**: Multiple overlapping setup and quickstart guides

## Cleanup Phases

### Phase 1: Immediate Cleanup (Day 1)

**Priority: CRITICAL**
**Goal: Remove obvious redundancy and clean version control**

#### Tasks:

- [ ] Delete all cache directories (.jest-cache, .vitest-cache, .playwright-cache, etc.)
- [ ] Remove test output logs (test-output-\*.log)
- [ ] Delete duplicate files (all files with " 2" or " 3" suffixes)
- [ ] Remove "node_modules 2" directory
- [ ] Clean up temporary directories (tmp/, --version/)
- [ ] Update .gitignore to prevent re-addition of these files

#### Files to Delete:

```
.jest-cache/
.playwright-cache/
.vitest-cache/
.test-results/
test-results/
playwright-report/
playwright-results/
node_modules 2/
--version/
tmp/
test-output-*.log
*" 2".*
*" 3".*
```

### Phase 2: Documentation Consolidation (Day 1-2)

**Priority: HIGH**
**Goal: Single source of truth for all documentation**

#### Tasks:

- [ ] Merge all CI documentation into single CI.md
- [ ] Consolidate deployment guides into DEPLOYMENT.md
- [ ] Merge all testing documentation into TESTING.md
- [ ] Create single SETUP.md combining all setup guides
- [ ] Archive old planning documents into docs/archive/
- [ ] Update README.md with clear structure and links

#### New Documentation Structure:

```
/
├── README.md (main entry point)
├── SETUP.md (getting started)
├── DEVELOPMENT.md (dev guidelines)
├── TESTING.md (testing strategy)
├── DEPLOYMENT.md (deployment guide)
├── CONTRIBUTING.md (contribution guidelines)
├── docs/
│   ├── architecture/
│   ├── api/
│   └── archive/ (old planning docs)
```

### Phase 3: Test Infrastructure Simplification (Day 2-3)

**Priority: HIGH**
**Goal: Single test runner per test type**

#### Decisions:

- **Unit/Component Tests**: Vitest (remove Jest for unit tests)
- **Integration Tests**: Vitest (migrate from Jest)
- **E2E Tests**: Playwright (keep as is)
- **Performance Tests**: Lighthouse CI (consolidate configs)

#### Tasks:

- [ ] Migrate all Jest unit tests to Vitest
- [ ] Remove all Jest configurations except for special cases
- [ ] Consolidate to single vitest.config.ts
- [ ] Consolidate to single playwright.config.ts
- [ ] Reduce test scripts from 100+ to ~20 essential ones

#### New Test Scripts:

```json
{
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:performance": "lighthouse ci",
  "test:all": "npm run test:coverage && npm run test:e2e"
}
```

### Phase 4: Code Organization (Day 3-4)

**Priority: HIGH**
**Goal: Clear, consistent code structure**

#### Tasks:

- [ ] Consolidate all server code into src/server/
- [ ] Move middleware into src/server/middleware/
- [ ] Move routes into src/server/routes/
- [ ] Remove duplicate utils directories
- [ ] Fix all 69 TypeScript errors
- [ ] Establish clear import paths

#### New Structure:

```
src/
├── client/
│   ├── components/
│   ├── hooks/
│   ├── pages/
│   └── styles/
├── server/
│   ├── routes/
│   ├── middleware/
│   ├── services/
│   └── index.ts
├── shared/
│   ├── types/
│   ├── constants/
│   └── utils/
└── main.tsx (frontend entry)
```

### Phase 5: Configuration Cleanup (Day 4)

**Priority: MEDIUM**
**Goal: Single configuration file per tool**

#### Tasks:

- [ ] Single tsconfig.json (with extends for specific needs)
- [ ] Single eslint.config.js
- [ ] Single prettier.config.js
- [ ] Single vitest.config.ts
- [ ] Single playwright.config.ts
- [ ] Remove all duplicate config files

#### Configuration Files to Keep:

```
tsconfig.json
eslint.config.js
prettier.config.js
vitest.config.ts
playwright.config.ts
vite.config.ts
lighthouserc.json
docker-compose.yml
.gitignore
.env.example
```

### Phase 6: Dependency Optimization (Day 5)

**Priority: MEDIUM**
**Goal: Remove duplicate and unused dependencies**

#### Tasks:

- [ ] Audit all dependencies
- [ ] Remove unused packages
- [ ] Update outdated packages
- [ ] Consolidate duplicate functionality
- [ ] Document required dependencies

### Phase 7: Script Simplification (Day 5)

**Priority: MEDIUM**
**Goal: Reduce scripts to essential ones only**

#### Core Scripts to Keep:

```json
{
  "scripts": {
    "dev": "concurrently \"npm:dev:*\"",
    "dev:frontend": "vite",
    "dev:backend": "tsx watch src/server/index.ts",
    "build": "vite build",
    "start": "node dist/server/index.js",
    "test": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio",
    "setup": "npm install && npm run db:migrate && npm run db:generate"
  }
}
```

## Success Metrics

### Quantitative Metrics

- [ ] Reduce npm scripts from 100+ to ~20
- [ ] Reduce documentation files from 30+ to 8-10
- [ ] Fix all 69 TypeScript errors
- [ ] Remove all duplicate files
- [ ] Single config file per tool

### Qualitative Metrics

- [ ] Clear, understandable project structure
- [ ] Easy onboarding for new developers
- [ ] Consistent testing strategy
- [ ] Simplified CI/CD pipeline
- [ ] Improved build times

## Implementation Timeline

| Phase   | Duration | Dependencies | Risk Level |
| ------- | -------- | ------------ | ---------- |
| Phase 1 | 1 day    | None         | Low        |
| Phase 2 | 2 days   | Phase 1      | Medium     |
| Phase 3 | 2 days   | Phase 1      | High       |
| Phase 4 | 2 days   | Phase 3      | High       |
| Phase 5 | 1 day    | Phase 4      | Medium     |
| Phase 6 | 1 day    | Phase 5      | Low        |
| Phase 7 | 1 day    | Phase 6      | Low        |

**Total Duration**: 10 days (2 weeks with buffer)

## Risk Mitigation

### Before Starting

1. Create full backup of repository
2. Create new branch: `cleanup/repository-reorganization`
3. Test each phase in isolation
4. Document all changes

### During Cleanup

1. Commit after each completed phase
2. Run tests after each major change
3. Keep detailed log of changes
4. Be prepared to rollback if needed

### High-Risk Areas

1. **Test Migration**: May break CI/CD - test thoroughly
2. **TypeScript Fixes**: May reveal deeper issues
3. **Server Consolidation**: May affect deployment

## Tracking Progress

### Daily Checklist

- [ ] Complete planned phase tasks
- [ ] Run all tests
- [ ] Update this document with progress
- [ ] Commit changes with clear messages
- [ ] Note any blockers or issues

### Phase Completion Criteria

- All tasks checked off
- All tests passing
- No new errors introduced
- Documentation updated
- Code review completed

## Post-Cleanup Tasks

1. **Documentation Review**
   - Ensure all docs are current
   - Add examples where needed
   - Create video walkthrough

2. **Team Training**
   - Present new structure to team
   - Update development workflows
   - Create migration guide for existing PRs

3. **CI/CD Updates**
   - Update GitHub Actions workflows
   - Simplify build pipelines
   - Update deployment scripts

4. **Monitoring Setup**
   - Set up alerts for test failures
   - Monitor build times
   - Track code quality metrics

## Notes and Observations

### Patterns Identified

1. **Test Proliferation**: Tests were added without removing old ones
2. **Documentation Drift**: Docs were copied rather than updated
3. **Configuration Sprawl**: New configs added instead of modifying existing
4. **Script Accumulation**: New scripts added for edge cases instead of parameterizing

### Lessons Learned

1. Need clear ownership of different parts of codebase
2. Regular cleanup should be part of sprint work
3. Documentation should have single owner
4. Test strategy needs to be clearly defined upfront

### Prevention Strategies

1. **Code Review**: Check for duplication in PRs
2. **Documentation Owner**: Assign single person to maintain docs
3. **Regular Audits**: Monthly cleanup sessions
4. **Clear Guidelines**: Document when to add new configs/scripts

## Appendix

### Commands for Bulk Operations

```bash
# Find all duplicate files
find . -name "* 2.*" -o -name "* 3.*"

# Find all cache directories
find . -type d -name "*cache*" -o -name ".cache"

# Find all test output files
find . -name "*.log" -o -name "test-output*"

# Check for unused dependencies
npx depcheck

# Find TypeScript errors
npx tsc --noEmit --listFiles | grep error

# Count npm scripts
cat package.json | jq '.scripts | length'
```

### Useful Resources

- [Repository Cleanup Best Practices](https://docs.github.com/en/repositories)
- [Monorepo Organization](https://monorepo.tools/)
- [Testing Strategy Guidelines](https://martinfowler.com/testing/)

---

**Last Updated**: [Current Date]
**Author**: Repository Cleanup Team
**Status**: PLANNING
