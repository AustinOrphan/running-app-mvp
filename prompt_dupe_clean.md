# Claude Code Prompt: Execute MCP Duplicate Cleanup Plan

**Context**: This project has a comprehensive duplicate file cleanup plan with MCP tool integration. Execute the systematic cleanup following the established workflows.

## Current Situation

The project has ~20 remaining duplicate files after initial cleanup of 206+ exact duplicates. A comprehensive analysis and implementation plan exists with:

- **Analysis Complete**: `FINAL_DUPLICATE_ANALYSIS.md` with verified recommendations
- **MCP Implementation Guide**: `MCP_DUPLICATE_CLEANUP_GUIDE.md` with tool workflows  
- **Executable Scripts**: Ready-to-use scripts in `scripts/` directory
- **Quick Reference**: `DUPLICATE_CLEANUP_QUICK_REFERENCE.md` for commands

## Task: Execute the Duplicate Cleanup Plan

### Phase 1: Pre-Cleanup Setup & Analysis

1. **Activate Serena Project** (if not already active)
   ```
   Use mcp__serena__activate_project for "/Users/austinorphan/srcOld/running-app-mvp"
   ```

2. **Read Project Context**
   - Read Serena memories: `mcp_cleanup_guide_completed`, `duplicate_cleanup_analysis`
   - Review existing analysis: `FINAL_DUPLICATE_ANALYSIS.md`

3. **Current State Scan**
   ```bash
   python3 scripts/scan-duplicates.py --show-files
   ```

4. **Configuration Analysis** 
   ```bash
   scripts/analyze-configs.sh
   ```

### Phase 2: Execute Safe Deletions

Based on the verified analysis, execute safe deletions of exact duplicates:

**Configuration Files (VERIFIED SAFE):**
```bash
rm -f "package 2.json" "package 3.json" "tsconfig 2.json" "tsconfig 3.json" "eslint.config 2.js" "eslint.config 3.js" "vitest.config 2.ts" "vitest.config 3.ts" "vitest.config 4.ts" "jest.config 2.js" "jest.config 3.js" "CLAUDE.local 2.md" "package-lock 2.json" "package-lock 3.json" "package-lock 4.json"
```

**After Each Deletion:**
- Verify system still works: `npm run build`
- Document progress in Serena memories

### Phase 3: Handle Orphaned Files

**Rename orphaned valuable files to standard locations:**
```bash
mv "PERFORMANCE_THRESHOLDS 2.md" "PERFORMANCE_THRESHOLDS.md"
mv "CI_STATUS_CHECK_REPORT 2.md" "CI_STATUS_CHECK_REPORT.md"
```

**Resolve merge conflicts in DEPLOYMENT_README 2.md:**
- Use Gemini CLI with changeMode to resolve 114+ conflict markers
- Then rename: `mv "DEPLOYMENT_README 2.md" "DEPLOYMENT_README.md"`

### Phase 4: Complex Decisions (Tasks Files)

The analysis identified conflicting recommendations for tasks files. Use MCP tools to make final decision:

1. **Sequential Thinking Analysis**
   ```
   Use mcp__sequential-thinking__sequentialthinking to analyze:
   - tasks.md (404 lines, recent CI focus)
   - tasks 2.md (709 lines, comprehensive historical)  
   - tasks 3.md (183 lines, different content)
   ```

2. **Gemini Content Comparison**
   ```
   Use mcp__gemini-cli__ask-gemini with changeMode to compare content and recommend which files to keep/merge
   ```

3. **Strategic Decision**
   ```
   Use mcp__serena__think_about_task_adherence to ensure alignment with project goals
   ```

### Phase 5: Comprehensive Quality Verification

**MANDATORY Quality Check (per project requirements):**
```bash
scripts/verify-cleanup-quality.sh
```

This runs the complete verification pipeline:
- `npm run quality` (MANDATORY)
- Build verification  
- Test suite validation
- Development server check
- File system integrity check
- Strategic assessment with Serena


## Critical Requirements

### Quality Gates (MANDATORY):
1. **`npm run quality`** MUST pass after any changes
2. **`npm run build`** MUST succeed  
3. **`npm run test:run`** MUST pass
4. **Development servers** must start successfully

### MCP Tool Usage:
- **Document all decisions** in Serena memories
- **Use Gemini CLI** for content analysis and conflict resolution
- **Sequential Thinking** for complex multi-step decisions  
- **Todos tracking** for systematic progress management

### Risk Mitigation:
- Work in git branch: `git checkout -b cleanup/execute-duplicate-plan`
- Document each phase completion in Serena memories
- Verify system integrity after each major step
- Keep todo list updated with progress

## Success Criteria

✅ **Zero exact duplicates remaining**  
✅ **All quality checks passing**  
✅ **Build and tests working**  
✅ **All decisions documented in Serena memories**  
✅ **System fully operational**

## Expected Outcomes

- **~15 files deleted** (verified safe exact duplicates)
- **3 files renamed** to standard locations  
- **1 file** with resolved merge conflicts
- **Tasks files** decision made with reasoning

## Notes for Claude Code

- **Use the existing scripts** instead of recreating MCP tool calls manually
- **Follow the established workflows** in MCP_DUPLICATE_CLEANUP_GUIDE.md
- **Store all analysis and decisions** in Serena memories for future reference
- **Maintain strict quality standards** per project requirements
- **Be systematic** - complete each phase before moving to next

The comprehensive analysis and tools are ready - execute the plan systematically using the MCP tool integration patterns already established.

---

**Quick Reference Commands:**
- Scan: `python3 scripts/scan-duplicates.py --show-files`
- Analyze: `scripts/analyze-configs.sh`  
- Verify: `scripts/verify-cleanup-quality.sh`
- Prevent: `python3 scripts/setup-duplicate-prevention.py`