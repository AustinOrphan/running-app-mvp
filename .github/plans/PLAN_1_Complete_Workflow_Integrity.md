# Plan 1: Complete Workflow Integrity

**Status**: 📋 Ready to Start  
**Priority**: 🔴 High (Immediate)  
**Complexity**: 🟢 Low  
**Estimated Time**: 2-3 hours  
**Created**: 2025-01-31

## 🎯 Objective

Achieve 100% GitHub workflow formatting compliance by resolving the 2 remaining syntax errors in workflow files through strategic refactoring of complex JavaScript template strings.

## 📊 Current State

- ✅ **Completed**: 42 out of 44 workflow files formatted successfully (95% compliance)
- ❌ **Remaining Issues**: 2 files with JavaScript template string syntax errors:
  - `coverage-trend-tracking.yml` (line 318)
  - `test-performance-monitoring.yml` (complex multiline JS)

## 🎯 Success Criteria

- [ ] Both problematic YAML files pass Prettier formatting
- [ ] Both files pass `actions/yaml-lint` validation
- [ ] Associated GitHub Actions run successfully in test branch
- [ ] Complex JavaScript logic moved to separate, testable files in `.github/scripts/`
- [ ] 100% workflow formatting compliance achieved
- [ ] Documentation updated to reflect completion

## 🛠️ MCP Tool Strategy

### Primary Tools

- **`mcp__serena__`**: Read and analyze problematic JavaScript template strings
- **`mcp__gemini-cli__`**: Design refactoring strategy for extracting inline scripts
- **`mcp__filesystem__`**: Create new external script files in `.github/scripts/`
- **`mcp__todos__`**: Track progress on each file fix

### Tool Usage Patterns

```bash
# Analysis
serena read-file .github/workflows/coverage-trend-tracking.yml
gemini-cli analyze-javascript-extraction --file coverage-trend-tracking.yml

# File Operations
filesystem create-directory .github/scripts
filesystem write-file .github/scripts/coverage-trend-calculator.js

# Progress Tracking
todos create-todo "Fix coverage-trend-tracking.yml syntax"
todos mark-complete <todo-id>
```

## 📋 Execution Plan

### Phase 1: Setup and Analysis (30 min)

- [ ] **Task 1.1**: Create project structure
  - [ ] Create `.github/scripts/` directory
  - [ ] Create progress tracking todos
- [ ] **Task 1.2**: Analyze problematic files
  - [ ] Use `serena` to read `coverage-trend-tracking.yml`
  - [ ] Use `serena` to read `test-performance-monitoring.yml`
  - [ ] Document exact syntax error locations

### Phase 2: coverage-trend-tracking.yml Refactor (60 min)

- [ ] **Task 2.1**: Extract JavaScript logic
  - [ ] Use `gemini-cli` to analyze embedded JavaScript at line 318
  - [ ] Design clean extraction strategy
- [ ] **Task 2.2**: Create external script
  - [ ] Create `coverage-trend-calculator.js` in `.github/scripts/`
  - [ ] Move template string logic to external file
  - [ ] Add proper error handling and logging
- [ ] **Task 2.3**: Refactor YAML file
  - [ ] Replace inline script with `node .github/scripts/coverage-trend-calculator.js`
  - [ ] Validate YAML syntax
  - [ ] Test Prettier formatting

### Phase 3: test-performance-monitoring.yml Refactor (60 min)

- [ ] **Task 3.1**: Extract JavaScript logic
  - [ ] Use `gemini-cli` to analyze complex multiline JS
  - [ ] Design modular extraction approach
- [ ] **Task 3.2**: Create external script
  - [ ] Create `performance-monitor.js` in `.github/scripts/`
  - [ ] Implement extracted logic with proper structure
  - [ ] Add configuration options and error handling
- [ ] **Task 3.3**: Refactor YAML file
  - [ ] Replace inline script with external script call
  - [ ] Validate YAML syntax
  - [ ] Test Prettier formatting

### Phase 4: Validation and Testing (30 min)

- [ ] **Task 4.1**: Comprehensive validation
  - [ ] Run Prettier check on both files
  - [ ] Run YAML lint validation
  - [ ] Verify no syntax errors remain
- [ ] **Task 4.2**: Integration testing
  - [ ] Create test branch
  - [ ] Push changes and trigger workflows
  - [ ] Verify workflows execute successfully
- [ ] **Task 4.3**: Documentation update
  - [ ] Update `.github/WORKFLOW_FORMATTING_STATUS.md`
  - [ ] Mark plan as completed
  - [ ] Document lessons learned

## 📁 File Structure Changes

```
.github/
├── scripts/                          # New directory
│   ├── coverage-trend-calculator.js  # Extracted from coverage-trend-tracking.yml
│   ├── performance-monitor.js         # Extracted from test-performance-monitoring.yml
│   └── README.md                      # Documentation for scripts
├── workflows/
│   ├── coverage-trend-tracking.yml   # Refactored (no inline JS)
│   └── test-performance-monitoring.yml # Refactored (no inline JS)
└── WORKFLOW_FORMATTING_STATUS.md     # Updated to reflect 100% completion
```

## 🔍 Quality Assurance

### Pre-Refactor Checklist

- [ ] Backup current workflow files
- [ ] Document current JavaScript logic functionality
- [ ] Identify all environment variables and inputs used
- [ ] Note any GitHub Actions context dependencies

### Post-Refactor Validation

- [ ] External scripts have proper error handling
- [ ] All environment variables properly passed
- [ ] Script outputs match original behavior
- [ ] No breaking changes to workflow functionality

## 🚨 Risk Assessment

### Low Risks

- **JavaScript Extraction**: Well-defined problem with clear solution
- **YAML Refactoring**: Simple replacement of inline scripts

### Mitigation Strategies

- **Backup Strategy**: Keep original files as `.backup` during development
- **Incremental Testing**: Test each file refactor independently
- **Rollback Plan**: Can quickly revert to original inline scripts if needed

## 📈 Success Metrics

### Quantitative

- [ ] Prettier check passes: `npx prettier --check .github/workflows/*.yml`
- [ ] YAML lint passes: `yamllint .github/workflows/`
- [ ] Workflow success rate: 100% execution success in test runs
- [ ] File count: 44 out of 44 workflows properly formatted

### Qualitative

- [ ] Code maintainability improved (JavaScript in testable files)
- [ ] Workflow readability enhanced (clean YAML structure)
- [ ] Future JavaScript changes easier to implement and test

## 🔗 Dependencies

### Prerequisites

- Completed workflow formatting project (✅ Done)
- Access to repository with write permissions
- Understanding of existing workflow functionality

### Blockers

- None identified (self-contained refactoring)

## 📚 Resources

### Documentation

- [GitHub Actions YAML Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [JavaScript Template Literals Best Practices](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals)

### Related Files

- `.github/WORKFLOW_FORMATTING_STATUS.md` - Current status documentation
- `.github/workflows/code-coverage.yml` - Successfully refactored example

## 📝 Progress Log

| Date       | Task         | Status      | Notes                                  |
| ---------- | ------------ | ----------- | -------------------------------------- |
| 2025-01-31 | Plan Created | ✅ Complete | Initial comprehensive plan established |
|            |              |             |                                        |

## 🔄 Next Steps After Completion

1. **Immediate**: Update overall formatting compliance metrics
2. **Short-term**: Consider adding linting for external scripts
3. **Long-term**: Evaluate other workflows for similar refactoring opportunities

---

**Plan Maintainer**: Claude Code with MCP Tools  
**Last Updated**: 2025-01-31  
**Review Schedule**: After completion or weekly if in progress
