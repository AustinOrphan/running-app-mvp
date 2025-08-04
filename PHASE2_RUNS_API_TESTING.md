# 🏃 Phase 2: Runs API Testing Agent

## 🎯 Mission Statement

<<<<<<< Updated upstream

**Objective**: Transform routes/runs.ts from 0% to 80%+ test coverage by implementing comprehensive CRUD operations testing for running data management.

**Success Criteria**:

=======
**Objective**: Transform routes/runs.ts from 0% to 80%+ test coverage by implementing comprehensive CRUD operations testing for running data management.

**Success Criteria**:

> > > > > > > Stashed changes

- Runs routes coverage: 0% → 80%+
- All CRUD operations thoroughly tested
- Data integrity and validation verified
- User isolation security confirmed
- Integration test suite passes without new failures

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

## 📋 Step 1: Runs Route Analysis

### **1.1 Read Runs Route File**

<<<<<<< Updated upstream

```
Tool: mcp__filesystem__read_file
Parameters:
=======
```

Tool: mcp**filesystem**read_file
Parameters:

> > > > > > > Stashed changes
> > > > > > > path: "routes/runs.ts"
> > > > > > > Purpose: Analyze all running data CRUD endpoints and business logic

```

### **1.2 Read Database Schema**
<<<<<<< Updated upstream

```

# Tool: mcp**filesystem**read_file

```
Tool: mcp__filesystem__read_file
>>>>>>> Stashed changes
Parameters:
  path: "prisma/schema.prisma"
Purpose: Understand Run model structure and relationships
```

### **1.3 Use Serena to Find Runs Symbols**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__find_symbol
Parameters:
  name_path: "/"
<<<<<<< Updated upstream
  relative_path: "routes/runs.ts"
=======
  relative_path: "routes/runs.ts"
>>>>>>> Stashed changes
  include_body: true
Purpose: Identify all runs endpoints and functions for testing
```

### **🔍 Validation Checkpoint 1**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__think_about_collected_information
Purpose: Confirm all runs endpoints identified and data model understood
```

---

## 📝 Step 2: Test File Creation

### **2.1 Create Comprehensive Runs Test File**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__filesystem__write_file
Parameters:
  path: "tests/integration/api/runs.comprehensive.test.ts"
  content: [Complete test file - see template below]
Purpose: Implement comprehensive runs CRUD testing
```

### **Test File Template Structure:**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```typescript
import request from 'supertest';
import { app } from '../../../server';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { faker } from '@faker-js/faker';

// Test Database Setup
const prisma = new PrismaClient();

describe('Runs API Routes', () => {
  let testUser: any;
  let authToken: string;
  let otherUser: any;
  let otherAuthToken: string;

  beforeAll(async () => {
    // Create test users and auth tokens
  });

  afterAll(async () => {
<<<<<<< Updated upstream
    // Database cleanup
=======
    // Database cleanup
>>>>>>> Stashed changes
  });

  beforeEach(async () => {
    // Reset run data for each test
  });

  describe('POST /api/runs', () => {
    describe('Success Cases', () => {
      // Valid run creation tests
    });

    describe('Validation Errors', () => {
      // Input validation tests
    });

    describe('Authorization Tests', () => {
      // Authentication required tests
    });
  });

  describe('GET /api/runs', () => {
    describe('Success Cases', () => {
      // Run retrieval tests
    });

    describe('Filtering and Pagination', () => {
      // Query parameter tests
    });

    describe('User Isolation', () => {
      // Security isolation tests
    });
  });

  describe('GET /api/runs/:id', () => {
    describe('Success Cases', () => {
      // Individual run retrieval
    });

    describe('Error Cases', () => {
      // Not found, unauthorized access
    });
  });

  describe('PUT /api/runs/:id', () => {
    describe('Success Cases', () => {
      // Run update tests
    });

    describe('Validation Tests', () => {
      // Update validation
    });

    describe('Authorization Tests', () => {
      // Update authorization
    });
  });

  describe('DELETE /api/runs/:id', () => {
    describe('Success Cases', () => {
      // Run deletion tests
    });

    describe('Error Cases', () => {
      // Deletion restrictions
    });
  });

  describe('Data Integrity Tests', () => {
    // Cross-operation data consistency
  });

  describe('Performance Tests', () => {
    // Bulk operations, large datasets
  });
});
```

### **Required Test Cases (Minimum 60 tests):**

#### **Create Run Tests (12+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Valid run creation with all fields
- Valid run creation with minimum fields
- Invalid distance (negative, zero, too large)
- Invalid duration (negative, zero, unrealistic)
- Invalid pace calculation
- Missing required fields
- Date validation (future dates, invalid formats)
- GPS coordinate validation
- Route validation
- User authentication required
- SQL injection in text fields
- XSS in description fields

<<<<<<< Updated upstream

#### **Get Runs Tests (15+ tests)**

=======

#### **Get Runs Tests (15+ tests)**

> > > > > > > Stashed changes

- Get all runs for authenticated user
- Get runs with pagination (limit, offset)
- Get runs with date filtering
- Get runs with distance filtering
- Get runs with sorting options
- Get runs with search by name
- Empty results handling
- Invalid pagination parameters
- Invalid filter parameters
- User isolation (cannot see other users' runs)
- Unauthorized access rejection
- Performance with large datasets
- Query injection attempts
- Special character handling
- Concurrent request handling

#### **Get Single Run Tests (8+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Get existing run by ID
- Get non-existent run (404)
- Get run belonging to other user (403)
- Invalid ID format
- ID injection attempts
- Unauthorized access
- Run with all optional fields populated
- Run with minimal fields

#### **Update Run Tests (12+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Update all editable fields
- Update single field
- Partial updates
- Invalid field updates
- Validation on updated fields
- Update run belonging to other user (403)
- Update non-existent run (404)
- Unauthorized access
- Data type validation
- Business logic validation
- Concurrent update handling
- Race condition testing

#### **Delete Run Tests (8+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Delete existing run
- Delete non-existent run (404)
- Delete run belonging to other user (403)
- Unauthorized access
- Cascade deletion effects
- Soft delete vs hard delete
- Recovery after deletion
- Bulk deletion

#### **Data Validation Tests (10+ tests)**

<<<<<<< Updated upstream

- Distance bounds validation
- # Duration bounds validation
- Distance bounds validation
- Duration bounds validation
  > > > > > > > Stashed changes
- Pace calculation accuracy
- Date range validation
- GPS coordinate bounds
- Route length validation
- Elevation data validation
- Heart rate data validation
- Calories calculation
- User data association

#### **User Isolation Security Tests (8+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- User can only see own runs
- User cannot modify others' runs
- User cannot delete others' runs
- Cross-user data leakage prevention
- JWT token user matching
- Session hijacking prevention
- Authorization header validation
- Token tampering detection

#### **Performance and Scalability Tests (7+ tests)**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- Large dataset retrieval
- Bulk run creation
- Complex filtering performance
- Sorting performance
- Pagination efficiency
- Database query optimization
- Memory usage with large results

### **🔍 Validation Checkpoint 2**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__serena__think_about_collected_information
Purpose: Verify test file covers all runs functionality comprehensively
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
Purpose: Execute runs API tests and verify functionality
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
> > > > > > > Purpose: Measure runs route coverage improvement

```

### **3.3 Read Coverage Report**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```

Tool: mcp**filesystem**read_file
Parameters:
path: "coverage-integration/index.html"
Purpose: Verify routes/runs.ts coverage meets 80%+ requirement

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
path: "PHASE2_RUNS_PROGRESS.md"
=======

```
Tool: mcp__filesystem__write_file
Parameters:
  path: "PHASE2_RUNS_PROGRESS.md"
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
Purpose: Create final summary of runs API testing implementation
```

### **5.5 Create Completion Report**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

```
Tool: mcp__filesystem__write_file
Parameters:
  path: "PHASE2_RUNS_COMPLETION.md"
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
     path: "PHASE2_RUNS_ISSUES.md"
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
2. # Add additional tests for uncovered code paths
3. Identify missing coverage areas
4. Add additional tests for uncovered code paths
   > > > > > > > Stashed changes
5. Repeat testing cycle until target achieved

---

## 📈 Success Metrics

### **Primary Metrics**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **Runs Route Coverage**: 0% → 80%+
- **Test Count**: 60+ comprehensive test cases
- **CRUD Coverage**: 100% of all operations
- **Test Suite Status**: All passing
- **Integration**: No regressions introduced

### **Quality Metrics**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **Data Integrity**: All validation rules tested
- **User Security**: Complete isolation verification
- **Performance**: Bulk operations tested
- **Error Handling**: All edge cases covered

### **Business Logic Metrics**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **Distance Validation**: All boundary conditions
- **Duration Validation**: Realistic constraints
- **Pace Calculations**: Mathematical accuracy
- **Date Handling**: Timezone and format validation

---

## 🔗 Dependencies and Coordination

### **Phase Dependencies**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **Requires**: Phase 1 (Test Infrastructure Setup) completed
- **Coordinates**: With Phase 2 Authentication (user auth testing)
- **Enables**: Phase 3 Integration testing with goals/stats

### **File Dependencies**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **Reads**: routes/runs.ts, prisma/schema.prisma
- **Creates**: tests/integration/api/runs.comprehensive.test.ts
- **Updates**: Coverage metrics, test suite status

---

## 🎯 Completion Checklist

### **Before Marking Complete - ALL Must Be ✅**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- [ ] routes/runs.ts coverage ≥ 80%
- [ ] 60+ runs API test cases implemented
- [ ] All CRUD operations tested (Create, Read, Update, Delete)
- [ ] User isolation security verified
- [ ] Data validation completely tested
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

1. **tests/integration/api/runs.comprehensive.test.ts** - Complete test suite
2. **PHASE2_RUNS_PROGRESS.md** - Progress tracking report
3. **PHASE2_RUNS_COMPLETION.md** - Final completion report
4. **PHASE2_RUNS_ISSUES.md** - Issue documentation (if required)

---

## 🚨 Critical Reminders

### **ABSOLUTE REQUIREMENTS**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes

- **USER ISOLATION**: Verify users can only access own data
- **DATA INTEGRITY**: Test all validation rules thoroughly
- **NO INDEPENDENT DECISIONS**: Follow instructions exactly
- **COMPLETE TESTING**: Task incomplete until thoroughly tested
- **DOCUMENT EVERYTHING**: All progress, issues, and completions

### **SUCCESS DEFINITION**

<<<<<<< Updated upstream

=======

> > > > > > > Stashed changes
> > > > > > > This agent is successful ONLY when routes/runs.ts achieves 80%+ test coverage through comprehensive CRUD testing, with complete user isolation verification and all tests passing.

**Agent Status**: Ready for deployment after Phase 1 completion
**Estimated Duration**: 3-5 hours
<<<<<<< Updated upstream
**Priority Level**: HIGH (Core Business Logic)
=======
**Priority Level**: HIGH (Core Business Logic)

> > > > > > > Stashed changes
