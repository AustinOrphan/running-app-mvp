# 🏗️ Phase 1: Test Infrastructure Setup Agent Plan

## 🎯 Agent Role
**Test Infrastructure Setup Agent** - Foundation setup for all subsequent testing agents

## 📋 Mission Statement
Fix and validate the test environment to enable all other agents to work successfully. This is a **BLOCKING** phase - no other agents can start until this is complete.

## 🔍 Current Issues to Resolve

### **Critical Blockers**
1. **Empty Test Files**: `tests/integration/api/runs.comprehensive.test.ts` has 0 lines
2. **Jest Configuration**: Integration tests failing with module resolution errors
3. **Test Database**: Connection and setup issues
4. **Security Linting**: Already fixed, but need to validate it works

## 📦 Required MCP Tools

### **Primary Tools**
- `mcp__filesystem__read_file` - Examine configuration files
- `mcp__filesystem__write_file` - Fix configuration issues
- `mcp__filesystem__edit_file` - Make targeted fixes
- `mcp__serena__execute_shell_command` - Test validation commands
- `mcp__serena__think_about_collected_information` - Validate findings

### **Validation Tools**
- `mcp__serena__think_about_task_adherence` - Before major changes
- `mcp__serena__think_about_whether_you_are_done` - Before completion
- `mcp__serena__summarize_changes` - Document all changes

## 🛠 Detailed Task Sequence

### **Step 1: Environment Analysis**
**Duration**: 15 minutes

1. **Read current Jest configuration**
   ```
   Use: mcp__filesystem__read_file
   Files: jest.config.js, package.json (test scripts)
   Purpose: Understand current test setup
   ```

2. **Examine test database setup**
   ```
   Use: mcp__filesystem__read_file  
   Files: tests/fixtures/testDatabase.ts, tests/setup/globalSetup.ts
   Purpose: Verify database configuration
   ```

3. **Check test environment files**
   ```
   Use: mcp__filesystem__read_file
   Files: tests/setup/jestSetup.ts, tests/setup/validateTestEnvironment.ts
   Purpose: Validate test environment setup
   ```

4. **Serena Validation**
   ```
   Use: mcp__serena__think_about_collected_information
   Purpose: Analyze findings and plan fixes
   ```

### **Step 2: Fix Test Database Setup**
**Duration**: 30 minutes

1. **Validate database configuration**
   ```
   Use: mcp__serena__execute_shell_command
   Command: npm run validate-test-env
   Purpose: Check if test database is accessible
   ```

2. **Fix database issues if found**
   ```
   Use: mcp__filesystem__edit_file
   Files: tests/fixtures/testDatabase.ts (if needed)
   Purpose: Ensure createTestUser and database utilities work
   ```

3. **Test database connection**
   ```
   Use: mcp__serena__execute_shell_command  
   Command: npm run test:setup:db
   Purpose: Verify database setup works
   ```

### **Step 3: Fix Jest Configuration**
**Duration**: 20 minutes

1. **Fix module resolution errors**
   ```
   Use: mcp__filesystem__read_file
   File: jest.config.js
   Purpose: Check moduleNameMapper and resolver settings
   ```

2. **Update Jest config if needed**
   ```
   Use: mcp__filesystem__edit_file
   File: jest.config.js
   Purpose: Fix ES modules and file extension issues
   ```

3. **Validate Jest configuration**
   ```
   Use: mcp__serena__execute_shell_command
   Command: npx jest --showConfig
   Purpose: Verify configuration is valid
   ```

### **Step 4: Fix Empty Test Files**
**Duration**: 15 minutes

1. **Check empty test files**
   ```
   Use: mcp__filesystem__read_file
   Files: tests/integration/api/runs.comprehensive.test.ts
   Purpose: Confirm file is empty and needs placeholder
   ```

2. **Add minimal placeholder test**
   ```
   Use: mcp__filesystem__write_file
   File: tests/integration/api/runs.comprehensive.test.ts
   Content: Basic describe block with skip to prevent "no tests" error
   ```

### **Step 5: Validate Test Environment**
**Duration**: 30 minutes

1. **Run unit tests to verify baseline**
   ```
   Use: mcp__serena__execute_shell_command
   Command: npm run test
   Expected: 97% pass rate (886/914 tests)
   ```

2. **Test integration test framework**
   ```
   Use: mcp__serena__execute_shell_command
   Command: npm run test:integration
   Expected: No module resolution errors, tests can run
   ```

3. **Validate test database operations**
   ```
   Use: mcp__serena__execute_shell_command
   Command: npm run create-test-user
   Expected: Can create test user successfully
   ```

4. **Test coverage reporting**
   ```
   Use: mcp__serena__execute_shell_command
   Command: npm run test:coverage
   Expected: Coverage reports generate successfully
   ```

### **Step 6: Serena Validation & Completion**
**Duration**: 15 minutes

1. **Pre-completion validation**
   ```
   Use: mcp__serena__think_about_whether_you_are_done
   Purpose: Ensure all infrastructure issues are resolved
   ```

2. **Summarize changes made**
   ```
   Use: mcp__serena__summarize_changes
   Purpose: Document all fixes for other agents
   ```

3. **Final validation**
   ```
   Use: mcp__serena__execute_shell_command
   Command: npm run test:runner:ci
   Expected: Test runner executes without environment errors
   ```

## ✅ Success Criteria

### **Must Complete Successfully**
- [ ] Unit tests run with 97%+ pass rate
- [ ] Integration test framework loads without errors  
- [ ] Test database connection and setup works
- [ ] Jest configuration resolves modules correctly
- [ ] Coverage reporting generates successfully
- [ ] All test commands in package.json work

### **Deliverables**
1. **Fixed Jest Configuration** - Module resolution works
2. **Working Test Database** - Can create users and connect
3. **Validated Test Environment** - All setup scripts work
4. **Test Command Validation** - All npm test scripts execute
5. **Infrastructure Status Report** - Document what was fixed

## 📊 Validation Steps

### **Continuous Validation**
- After each fix, run relevant test command to verify
- Use `mcp__serena__execute_shell_command` for all test runs
- Document any remaining issues in `AGENT_ISSUES.md`

### **Final Validation Checklist**
```bash
# These commands must all work before completion:
npm run test                    # Unit tests pass
npm run test:integration       # No configuration errors
npm run validate-test-env      # Environment check passes
npm run test:setup:db          # Database setup works
npm run test:coverage          # Coverage reports generate
```

## 🚨 Issue Reporting

### **If Issues Encountered**
1. **Document immediately** in `AGENT_ISSUES.md`
2. **Include specific error messages** and commands that failed
3. **Note any deviations** from this plan
4. **Use Serena thinking tools** to analyze problems

### **Common Issues to Watch For**
- Module resolution errors in Jest
- Database connection failures
- Environment variable issues
- Permission problems with test files
- npm package dependency issues

## 🔄 Handoff to Phase 2

### **Before Declaring Complete**
1. All success criteria must be met
2. All validation commands must pass
3. Infrastructure status report must be created
4. Any issues must be documented

### **Signals Ready for Phase 2**
- Update `AGENT_PROGRESS.md` with completion status
- Confirm all 4 Phase 2 agents can proceed
- Provide any special instructions or notes

---

**Priority**: CRITICAL BLOCKING
**Estimated Duration**: 2 hours
**Dependencies**: None
**Blocks**: All other agents
**Success Rate**: Must be 100% to proceed