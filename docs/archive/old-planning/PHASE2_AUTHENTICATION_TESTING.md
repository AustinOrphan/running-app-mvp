# 🔐 Phase 2: Authentication Testing Agent

## 🎯 Mission Statement

<<<<<<< Updated upstream

**Objective**: Transform routes/auth.ts from 0% to 80%+ test coverage by implementing comprehensive authentication security testing.

**Success Criteria**:

=======
**Objective**: Transform routes/auth.ts from 0% to 80%+ test coverage by implementing comprehensive authentication security testing.

**Success Criteria**:

> > > > > > > Stashed changes

- Authentication routes coverage: 0% → 80%+
- All security scenarios tested (JWT, bcrypt, validation, rate limiting)
- Integration test suite passes without new failures
- No ESLint security violations introduced

---

## 🚀 Agent Instructions

### **CRITICAL REQUIREMENTS**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **NO INDEPENDENT DECISIONS**: Follow these instructions exactly
- **USE SPECIFIC MCP TOOLS**: Only use tools specified in each step
- **DOCUMENT DEVIATIONS**: Any issues or changes → create markdown file
- **VALIDATE CONTINUOUSLY**: Use Serena validation at each checkpoint
- **COMPLETE TESTING REQUIRED**: Task unfinished until thoroughly tested

### **Step-by-Step Execution Plan**

---

## 📋 Step 1: Environment Analysis

### **1.1 Read Authentication Route File**

<<<<<<< Updated upstream

```
Tool: mcp__filesystem__read_file
Parameters:
=======
```

Tool: mcp**filesystem**read_file
Parameters:

> > > > > > > Stashed changes
> > > > > > > path: "routes/auth.ts"
> > > > > > > Purpose: Analyze all authentication endpoints and functions

```

### **1.2 Read Existing Test Patterns**
<<<<<<< Updated upstream

```

# Tool: mcp**filesystem**read_file

```
Tool: mcp__filesystem__read_file
>>>>>>> Stashed changes
Parameters:
  path: "tests/integration/api"
Purpose: Understand existing test structure and patterns
```

### **1.3 Use Serena to Find Auth Symbols**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__find_symbol
Parameters:
  name_path: "/"
<<<<<<< Updated upstream
  relative_path: "routes/auth.ts"
=======
  relative_path: "routes/auth.ts"
>>>>>>> Stashed changes
  include_body: true
Purpose: Identify all auth endpoints and functions for testing
```

### **🔍 Validation Checkpoint 1**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__think_about_collected_information
Purpose: Confirm all auth endpoints identified and test patterns understood
```

---

## 📝 Step 2: Test File Creation

### **2.1 Create Comprehensive Auth Test File**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__filesystem__write_file
Parameters:
  path: "tests/integration/api/auth.comprehensive.test.ts"
  content: [Complete test file - see template below]
Purpose: Implement comprehensive authentication testing
```

### **Test File Template Structure:**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```typescript
import request from 'supertest';
import { app } from '../../../server';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { faker } from '@faker-js/faker';

// Test Database Setup
const prisma = new PrismaClient();

describe('Authentication Routes', () => {
  beforeAll(async () => {
    // Database setup
  });

  afterAll(async () => {
<<<<<<< Updated upstream
    // Database cleanup
=======
    // Database cleanup
>>>>>>> Stashed changes
  });

  beforeEach(async () => {
    // Reset test data
  });

  describe('POST /api/auth/register', () => {
    describe('Success Cases', () => {
      // Valid registration tests
    });

    describe('Validation Errors', () => {
      // Input validation tests
    });

    describe('Security Tests', () => {
      // XSS, SQL injection tests
    });
  });

  describe('POST /api/auth/login', () => {
    describe('Success Cases', () => {
      // Valid login tests
    });

    describe('Authentication Failures', () => {
      // Invalid credentials tests
    });

    describe('Rate Limiting', () => {
      // Rate limiting tests
    });
  });

  describe('POST /api/auth/refresh', () => {
    // JWT refresh tests
  });

  describe('POST /api/auth/logout', () => {
    // Logout tests
  });

  describe('GET /api/auth/verify', () => {
    // Token verification tests
  });

  describe('POST /api/auth/forgot-password', () => {
    // Password reset initiation tests
  });

  describe('POST /api/auth/reset-password', () => {
    // Password reset completion tests
  });

  describe('Security Integration Tests', () => {
    // Cross-endpoint security tests
  });
});
```

### **Required Test Cases (Minimum 50 tests):**

#### **Registration Tests (8+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Valid user registration
- Duplicate email handling
- Password strength validation
- Email format validation
- SQL injection attempts
- XSS in user inputs
- Missing required fields
- Rate limiting

<<<<<<< Updated upstream

#### **Login Tests (10+ tests)**

=======

#### **Login Tests (10+ tests)**

> > > > > > > Stashed changes

- Valid login with correct credentials
- Invalid email format
- Invalid password
- Non-existent user
- Account lockout after failed attempts
- SQL injection in login
- XSS in login fields
- Rate limiting
- Concurrent login attempts
- Session management

#### **JWT Token Tests (8+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Valid token generation
- Token expiration handling
- Invalid token rejection
- Token refresh functionality
- Token blacklisting (logout)
- Malformed token handling
- Token secret security
- Authorization header validation

#### **Password Security Tests (6+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Bcrypt hash strength verification
- Password update security
- Password reset token security
- Password history validation
- Weak password rejection
- Password timing attack prevention

#### **Rate Limiting Tests (6+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Login rate limiting
- Registration rate limiting
- Password reset rate limiting
- Rate limit bypass attempts
- Rate limit recovery
- IP-based rate limiting

#### **Input Validation Tests (8+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Email validation edge cases
- Password validation edge cases
- Name field validation
- Special character handling
- Unicode input handling
- JSON parsing security
- Large payload handling
- Null/undefined handling

#### **Authorization Tests (4+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Protected route access
- Token validation middleware
- Role-based access (if applicable)
- Token tampering detection

### **🔍 Validation Checkpoint 2**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__think_about_collected_information
Purpose: Verify test file structure is comprehensive and follows patterns
```

---

## 🧪 Step 3: Test Execution and Validation

### **3.1 Run Integration Tests**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__execute_shell_command
Parameters:
  command: "npm run test:integration"
Purpose: Execute authentication tests and verify functionality
```

### **3.2 Run Coverage Analysis**

<<<<<<< Updated upstream

```
Tool: mcp__serena__execute_shell_command
=======
```

Tool: mcp**serena**execute_shell_command

> > > > > > > Stashed changes
> > > > > > > Parameters:
> > > > > > > command: "npm run test:coverage:integration"
> > > > > > > Purpose: Measure authentication route coverage improvement

```

### **3.3 Read Coverage Report**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```

Tool: mcp**filesystem**read_file
Parameters:
path: "coverage-integration/index.html"
Purpose: Verify routes/auth.ts coverage meets 80%+ requirement

```

### **🔍 Validation Checkpoint 3**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```

Tool: mcp**serena**think_about_collected_information
Purpose: Confirm tests pass and coverage targets achieved

```

---

## 🔧 Step 4: Quality Assurance

### **4.1 Run Full Test Suite**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```

Tool: mcp**serena**execute_shell_command
Parameters:
command: "npm run test:all"
Purpose: Ensure no regressions in existing functionality

```

<<<<<<< Updated upstream
### **4.2 Run Linting Check**

=======
### **4.2 Run Linting Check**
>>>>>>> Stashed changes
```

Tool: mcp**serena**execute_shell_command
Parameters:
command: "npm run lint:check"
Purpose: Verify no ESLint violations introduced

```

### **4.3 Run Type Checking**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```

Tool: mcp**serena**execute_shell_command
Parameters:
command: "npm run typecheck"
Purpose: Ensure TypeScript compliance

```

### **🔍 Validation Checkpoint 4**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```

Tool: mcp**serena**think_about_task_adherence
Purpose: Confirm all requirements met and no regressions

```

---

## 📊 Step 5: Final Validation and Completion

### **5.1 Final Coverage Verification**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```

Tool: mcp**serena**execute_shell_command
Parameters:
command: "npm run test:coverage:integration"
Purpose: Final coverage measurement

```

### **5.2 Create Progress Report**
<<<<<<< Updated upstream

```

Tool: mcp**filesystem**write_file
Parameters:
path: "PHASE2_AUTH_PROGRESS.md"
=======

```
Tool: mcp__filesystem__write_file
Parameters:
  path: "PHASE2_AUTH_PROGRESS.md"
>>>>>>> Stashed changes
  content: [Detailed progress report with metrics]
Purpose: Document achievement of objectives
```

### **5.3 Final Completion Check**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__think_about_whether_you_are_done
Purpose: Confirm all success criteria met
```

### **5.4 Summarize Changes**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__summarize_changes
Purpose: Create final summary of authentication testing implementation
```

### **5.5 Create Completion Report**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__filesystem__write_file
Parameters:
  path: "PHASE2_AUTH_COMPLETION.md"
  content: [Final completion report with all metrics and achievements]
Purpose: Document successful completion for coordination
```

---

## ⚠️ Error Handling Protocol

### **If Tests Fail**

<<<<<<< Updated upstream

1. Create issue documentation:

=======

1. Create issue documentation:

   > > > > > > > Stashed changes

   ```
   Tool: mcp__filesystem__write_file
   Parameters:
     path: "PHASE2_AUTH_ISSUES.md"
     content: [Detailed error analysis and resolution steps]
   ```

2. Use Serena validation to analyze:
   <<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__think_about_collected_information
```

3. **DO NOT** mark task complete until all tests pass

### **If Coverage Below 80%**

<<<<<<< Updated upstream

1. Identify missing coverage areas
2. Add additional tests for uncovered code paths
3. Repeat testing cycle until target achieved

### **If Linting Failures**

=======

1. Identify missing coverage areas
2. Add additional tests for uncovered code paths
3. Repeat testing cycle until target achieved

### **If Linting Failures**

> > > > > > > Stashed changes

1. Fix all ESLint violations
2. Ensure security rules not violated
3. Rerun full quality check

---

## 📈 Success Metrics

### **Primary Metrics**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **Authentication Route Coverage**: 0% → 80%+
- **Test Count**: 50+ comprehensive test cases
- **Security Test Coverage**: 100% of auth endpoints
- **Test Suite Status**: All passing
- **Integration**: No regressions introduced

### **Quality Metrics**

<<<<<<< Updated upstream

- **ESLint**: No violations
- # **TypeScript**: No type errors
- **ESLint**: No violations
- **TypeScript**: No type errors
  > > > > > > > Stashed changes
- **Performance**: Tests complete in <2 minutes
- **Maintainability**: Tests follow established patterns

### **Security Metrics**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **JWT Security**: All token scenarios tested
- **Password Security**: Bcrypt hashing verified
- **Input Validation**: All injection vectors tested
- **Rate Limiting**: All endpoints protected
- **Authorization**: All access controls verified

---

## 🔗 Dependencies and Coordination

### **Phase Dependencies**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **Requires**: Phase 1 (Test Infrastructure Setup) completed
- **Enables**: Phase 3 (Integration Testing) authentication scenarios
- **Coordinates**: With other Phase 2 agents via progress reports

### **File Dependencies**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **Reads**: routes/auth.ts, existing test patterns
- **Creates**: tests/integration/api/auth.comprehensive.test.ts
- **Updates**: Coverage metrics, test suite status

### **Tool Usage Summary**

<<<<<<< Updated upstream

- **mcp**filesystem\*\*\*\*: 6 operations (read auth routes, create tests, reports)
- # **mcp**serena\*\*\*\*: 7 operations (analysis, validation, execution, completion)
- **mcp**filesystem****: 6 operations (read auth routes, create tests, reports)
- **mcp**serena****: 7 operations (analysis, validation, execution, completion)
  > > > > > > > Stashed changes
- **Total Operations**: 13 precise tool executions

---

## 🎯 Completion Checklist

### **Before Marking Complete - ALL Must Be ✅**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- [ ] routes/auth.ts coverage ≥ 80%
- [ ] 50+ authentication test cases implemented
- [ ] All security scenarios tested (JWT, bcrypt, validation, rate limiting)
- [ ] Integration test suite passes completely
- [ ] No new ESLint violations
- [ ] No TypeScript errors
- [ ] Progress report created
- [ ] Completion report created
- [ ] All deviations documented (if any)
- [ ] Serena validation confirms completion

### **Deliverables**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

1. **tests/integration/api/auth.comprehensive.test.ts** - Complete test suite
2. **PHASE2_AUTH_PROGRESS.md** - Progress tracking report
3. **PHASE2_AUTH_COMPLETION.md** - Final completion report
4. **PHASE2_AUTH_ISSUES.md** - Issue documentation (if required)

---

## 🚨 Critical Reminders

### **ABSOLUTE REQUIREMENTS**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **NO HARDCODED SECRETS**: Use environment variables only
- **NO INDEPENDENT DECISIONS**: Follow instructions exactly
- **COMPLETE TESTING**: Task incomplete until thoroughly tested
- **DOCUMENT EVERYTHING**: All progress, issues, and completions
- **USE SPECIFIED TOOLS**: Only MCP tools listed in instructions

### **SUCCESS DEFINITION**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes
> > > > > > > This agent is successful ONLY when routes/auth.ts achieves 80%+ test coverage through comprehensive security testing, with all tests passing and no regressions introduced.

**Agent Status**: Ready for deployment after Phase 1 completion
**Estimated Duration**: 2-4 hours
<<<<<<< Updated upstream
**Priority Level**: CRITICAL (Security Foundation)
=======
**Priority Level**: CRITICAL (Security Foundation)

> > > > > > > Stashed changes
