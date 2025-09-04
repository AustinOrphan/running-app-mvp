# Project Cleanup Plan

This document outlines a systematic plan to declutter the repository, remove non-essential files, and improve the overall maintainability of the codebase.

### **Phase 1: Remove Safe, Non-Essential Files**

These files are backups, generated artifacts, or one-off analysis results that are safe to delete.

*   **Backup Files:**
    *   `package.json.backup`
    *   `package.json.pre-simplification`
    *   `CLAUDE.md.backup`
*   **Duplicate Analysis Reports:**
    *   `complete-duplicate-analysis.md`
    *   `COMPREHENSIVE_DUPLICATE_CLEANUP_PLAN.md`
    *   `duplicate_analysis_results.json`
    *   `duplicate-files-analysis.md`
    *   `duplicate-files-tracked.txt`
    *   `DUPLICATE_CLEANUP_QUICK_REFERENCE.md`
    *   `FINAL_DUPLICATE_ANALYSIS.md`
    *   `MCP_DUPLICATE_CLEANUP_GUIDE.md`
    *   `non-exact-duplicates.txt`
    *   `untracked-duplicates-analysis.txt`
*   **CI/Test Reports & Logs (often temporary):**
    *   `benchmark-results.md`
    *   `bundle-size-report.json`
    *   `CI_FAILURE_RESOLUTION_TRACKING.xml`
    *   `CI_STATUS_CHECK_REPORT.md`
    *   `COMPREHENSIVE_TEST_COVERAGE_REPORT.md`
    *   `coverage-analysis.md`
    *   `license-report.json`
    *   `licenses.json`
    *   `TEST_VALIDATION_REPORT.md`
    *   `TEST_VALIDATION_SUMMARY.md`

### **Phase 2: Archive Obsolete Documentation & Notes**

Many markdown files appear to be planning documents, architectural notes, or temporary thoughts rather than durable documentation. They will be moved into a `docs/archive/` directory to get them out of the root, making them available for historical reference without cluttering the project.

*   **Examples to Archive:** `AGENT_COORDINATION_SYSTEM.md`, `ARCHITECTURAL_REVIEW.md`, `CI_FAILURE_RESOLUTION_PLAN.md`, `CLAUDE.local.md`, `CSS_MIGRATION_PLAN.md`, `GEMINI.md`, `PHASE1_INFRASTRUCTURE_SETUP.md`, `REACT_19_MIGRATION_EXECUTION_PLAN.md`, `WINSTON_FIX_NEEDED.md`, and many others.

### **Phase 3: Prune Unused Scripts**

The root directory contains numerous shell and Node.js scripts. An analysis of `package.json` and `.github/workflows/` will be performed to identify which scripts are actually used. Unused scripts will be removed.

*   **Scripts to Analyze:** `analyze_duplicates.sh`, `check-backend.sh`, `create-milestones.sh`, `deploy-agents.sh`, `organize-issues.sh`, `quick-start.sh`, `setup.sh`, `test-goals-api.js`, etc.

### **Phase 4: Consolidate Configuration**

Multiple ESLint configuration files will be consolidated into the main `eslint.config.js`.

*   **Files to Consolidate:**
    *   `.eslintrc.performance.js`
    *   `eslint.config.quality.js`

### **Phase 5: Verify Project Integrity**

After cleaning up, the following steps will be taken to ensure the project remains in a working state:
1.  Ensure all deleted and generated paths are correctly listed in `.gitignore`.
2.  Run `npm install` to verify dependencies.
3.  Run `npm test` and `npm run lint` (or equivalent commands) to confirm that the project still works as expected.
