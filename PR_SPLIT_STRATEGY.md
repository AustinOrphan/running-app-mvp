# PR #401 Split Strategy

## Problem

PR #401 is too large to review effectively:

- 125,164 additions, 20,202 deletions
- 300+ files changed
- 123 commits
- Mixes multiple unrelated concerns

## Issues Created

- **Blocker** #402: Add test coverage for services
- **Blocker** #403: Document AI integration
- **Blocker** #404: Add input validation
- Follow-up #405: E2E tests
- Follow-up #406: API documentation
- Follow-up #407: Performance optimization
- Follow-up #408: Error monitoring

## Split Strategy

### PR 1: Code Quality Improvements (Low Risk - Can Merge First)

**Branch**: `feat/code-quality-improvements`
**Base**: `main`
**Commits**: Last 4 commits only

- `bd7bb72` - Bundle size tracking
- `b0f5f64` - TypeScript fixes
- `c112414` - CSS variables
- `949aa45` - Documentation

**Changes**:

- `.bundlesizerc.json`
- TypeScript unused parameter fixes (8 files)
- CSS custom properties in `src/App.css`
- Branch analysis documentation

**Risk**: LOW
**Dependencies**: None
**Estimated Review Time**: 30 minutes
**Can merge independently**: YES

---

### PR 2: Training Plans Feature (Core Feature - Needs Tests)

**Branch**: `feat/training-plans-system`
**Base**: `main` (or PR 1 if merged)
**Commits**: Cherry-pick from `04844aa`

**Changes**:

- Database models: `TrainingPlan`, `WorkoutTemplate`
- `services/advancedTrainingPlanService.ts`
- `routes/trainingPlans.ts`
- Prisma migration: `20260126200446_add_training_plans_and_analytics` (partial)

**Risk**: MEDIUM
**Dependencies**:

- **BLOCKS**: Issue #402 (test coverage)
- **BLOCKS**: Issue #404 (input validation)

**Estimated Review Time**: 2-3 hours
**Can merge independently**: After tests added

---

### PR 3: Analytics & Geospatial (Related Features - Needs Tests)

**Branch**: `feat/analytics-geospatial`
**Base**: `main` (or PR 1/2 if merged)
**Commits**: Cherry-pick from `04844aa`

**Changes**:

- Database models: `RunDetail`, `RunAnalytics`, `LocationHeatmap`, `RunTendency`
- `services/analyticsService.ts`
- `services/geospatialService.ts`
- `routes/analytics.ts`
- Dependencies: `@turf/turf`, `@types/geojson`
- Prisma migration: `20260126200446_add_training_plans_and_analytics` (partial)

**Risk**: MEDIUM
**Dependencies**:

- **BLOCKS**: Issue #402 (test coverage)
- **BLOCKS**: Issue #403 (AI documentation)
- **BLOCKS**: Issue #404 (input validation)

**Estimated Review Time**: 2-3 hours
**Can merge independently**: After tests added and AI documented

---

### PR 4: CI/CD Infrastructure (Already in this branch)

**Branch**: `feat/comprehensive-ci-cd-infrastructure` (keep existing)
**Base**: `main`
**Commits**: Everything before `04844aa`

**Changes**:

- 20+ new GitHub workflow files
- Security scanning, coverage tracking, flaky test detection
- Deployment pipelines, performance monitoring
- Test reliability improvements
- Linting cleanup (commits 3784a57, 2be1a2b, etc.)

**Risk**: HIGH (touches CI/CD)
**Dependencies**: None (infrastructure)
**Estimated Review Time**: 4-6 hours
**Can merge independently**: YES, but needs thorough testing

**Note**: This is the bulk of the 123 commits and should be reviewed separately from features.

---

## Migration Strategy

### Step 1: Create PR 1 (Code Quality)

```bash
git checkout main
git pull
git checkout -b feat/code-quality-improvements
git cherry-pick bd7bb72  # Bundle size config
git cherry-pick b0f5f64  # TypeScript fixes
git cherry-pick c112414  # CSS improvements
git cherry-pick 949aa45  # Documentation
git push -u origin feat/code-quality-improvements
```

Then create PR targeting `main`.

### Step 2: Create PR 2 (Training Plans)

This requires careful extraction of training-plan-specific changes from `04844aa`:

1. Database schema changes (TrainingPlan, WorkoutTemplate only)
2. Training plan service
3. Training plan routes
4. Migration file (partial - training plan tables only)

**Challenge**: The commit `04844aa` contains BOTH training plans AND analytics.
**Solution**: Create new commits with only training plan changes.

### Step 3: Create PR 3 (Analytics)

Similar to PR 2, extract analytics-specific changes:

1. Database schema changes (RunDetail, RunAnalytics, LocationHeatmap, RunTendency)
2. Analytics service
3. Geospatial service
4. Analytics routes
5. Migration file (partial - analytics tables only)

### Step 4: Keep PR 4 (CI/CD)

Clean up `feat/comprehensive-ci-cd-infrastructure`:

1. Remove last 5 commits (they're now in PR 1, 2, 3)
2. Keep only CI/CD infrastructure changes
3. Rebase if needed

---

## Execution Order

1. **Create PR 1** (code quality) - Can merge immediately after review
2. **Address blockers** for PR 2 & 3:
   - Add tests (Issue #402)
   - Document AI (Issue #403)
   - Add validation (Issue #404)
3. **Create PR 2** (training plans) - Merge after tests
4. **Create PR 3** (analytics) - Merge after tests + AI docs
5. **Update PR 4** (CI/CD) - Remove merged commits, review separately

---

## Benefits of Splitting

1. **Reviewability**: Each PR can be reviewed in 30min - 3hrs
2. **Risk Management**: Code quality changes can merge immediately
3. **Testing**: Each feature can be tested independently
4. **Rollback**: Easier to revert specific features if issues arise
5. **Parallel Work**: Different developers can address blockers in parallel

---

## Notes

- The migration file `20260126200446_add_training_plans_and_analytics` needs to be split into two:
  - `add_training_plans.prisma` (PR 2)
  - `add_analytics_and_geospatial.prisma` (PR 3)
- Consider feature flags for gradual rollout
- Update CLAUDE.md if new testing patterns emerge
