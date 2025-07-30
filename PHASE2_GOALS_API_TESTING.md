# 🎯 Phase 2: Goals API Testing Agent

## 🎯 Mission Statement
<<<<<<< Updated upstream

**Objective**: Transform routes/goals.ts from 0% to 80%+ test coverage by implementing comprehensive goal management and progress tracking testing.

**Success Criteria**:

=======
**Objective**: Transform routes/goals.ts from 0% to 80%+ test coverage by implementing comprehensive goal management and progress tracking testing.

**Success Criteria**: 
>>>>>>> Stashed changes
- Goals routes coverage: 0% → 80%+
- All goal CRUD operations thoroughly tested
- Progress calculation logic verified
- Complex business rules validated
- Integration test suite passes without new failures

---

## 🚀 Agent Instructions

### **CRITICAL REQUIREMENTS**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **NO INDEPENDENT DECISIONS**: Follow these instructions exactly
- **USE SPECIFIC MCP TOOLS**: Only use tools specified in each step
- **DOCUMENT DEVIATIONS**: Any issues or changes → create markdown file
- **VALIDATE CONTINUOUSLY**: Use Serena validation at each checkpoint
- **COMPLETE TESTING REQUIRED**: Task unfinished until thoroughly tested

### **Step-by-Step Execution Plan**

---

## 📋 Step 1: Goals Route Analysis

### **1.1 Read Goals Route File**
<<<<<<< Updated upstream

```
Tool: mcp__filesystem__read_file
Parameters:
=======
```
Tool: mcp__filesystem__read_file
Parameters: 
>>>>>>> Stashed changes
  path: "routes/goals.ts"
Purpose: Analyze all goal management endpoints and complex business logic
```

### **1.2 Read Database Schema for Goals**
<<<<<<< Updated upstream

```
Tool: mcp__filesystem__read_file
=======
```
Tool: mcp__filesystem__read_file  
>>>>>>> Stashed changes
Parameters:
  path: "prisma/schema.prisma"
Purpose: Understand Goal model structure and Run relationships
```

### **1.3 Use Serena to Find Goals Symbols**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__find_symbol
Parameters:
  name_path: "/"
<<<<<<< Updated upstream
  relative_path: "routes/goals.ts"
=======
  relative_path: "routes/goals.ts" 
>>>>>>> Stashed changes
  include_body: true
Purpose: Identify all goals endpoints and progress calculation functions
```

### **🔍 Validation Checkpoint 1**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__think_about_collected_information
Purpose: Confirm all goals endpoints identified and business logic understood
```

---

## 📝 Step 2: Test File Creation

### **2.1 Create Comprehensive Goals Test File**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__filesystem__write_file
Parameters:
  path: "tests/integration/api/goals.comprehensive.test.ts"
  content: [Complete test file - see template below]
Purpose: Implement comprehensive goals management testing
```

### **Test File Template Structure:**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```typescript
import request from 'supertest';
import { app } from '../../../server';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { faker } from '@faker-js/faker';
import { addDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

// Test Database Setup
const prisma = new PrismaClient();

describe('Goals API Routes', () => {
  let testUser: any;
  let authToken: string;
  let otherUser: any;
  let otherAuthToken: string;
  let testRuns: any[];

  beforeAll(async () => {
    // Create test users, auth tokens, and sample runs
  });

  afterAll(async () => {
<<<<<<< Updated upstream
    // Database cleanup
=======
    // Database cleanup  
>>>>>>> Stashed changes
  });

  beforeEach(async () => {
    // Reset goal data for each test
  });

  describe('POST /api/goals', () => {
    describe('Success Cases', () => {
      // Valid goal creation tests
    });

    describe('Validation Errors', () => {
      // Input validation tests
    });

    describe('Business Rule Validation', () => {
      // Goal logic validation
    });
  });

  describe('GET /api/goals', () => {
    describe('Success Cases', () => {
      // Goal retrieval tests
    });

    describe('Filtering and Status', () => {
      // Goal status and filtering
    });

    describe('Progress Calculation', () => {
      // Progress calculation accuracy
    });
  });

  describe('GET /api/goals/:id', () => {
    describe('Success Cases', () => {
      // Individual goal retrieval
    });

    describe('Progress Details', () => {
      // Detailed progress information
    });
  });

  describe('PUT /api/goals/:id', () => {
    describe('Success Cases', () => {
      // Goal update tests
    });

    describe('Progress Recalculation', () => {
      // Progress updates after changes
    });
  });

  describe('DELETE /api/goals/:id', () => {
    describe('Success Cases', () => {
      // Goal deletion tests
    });
  });

  describe('Goal Progress Calculations', () => {
    // Complex progress calculation scenarios
  });

  describe('Goal Types and Periods', () => {
    // Different goal type behaviors
  });

  describe('Achievement Detection', () => {
    // Goal completion logic
  });
});
```

### **Required Test Cases (Minimum 70 tests):**

#### **Create Goal Tests (15+ tests)**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Create distance goal (weekly/monthly)
- Create duration goal (weekly/monthly)
- Create frequency goal (runs per period)
- Create pace goal (average pace target)
- Valid goal with all optional fields
- Valid goal with minimum required fields
- Invalid goal type
- Invalid target value (negative, zero, unrealistic)
- Invalid time period
- Missing required fields
- Duplicate goal validation
- Goal start date validation
- Goal end date validation
- User authentication required
- SQL injection in goal descriptions

<<<<<<< Updated upstream
#### **Get Goals Tests (12+ tests)**

=======
#### **Get Goals Tests (12+ tests)**  
>>>>>>> Stashed changes
- Get all goals for authenticated user
- Get active goals only
- Get completed goals only
- Get goals by type filter
- Get goals by time period filter
- Get goals with progress calculation
- Empty goals list handling
- User isolation (cannot see other users' goals)
- Unauthorized access rejection
- Goal sorting (by creation date, progress, status)
- Pagination for large goal lists
- Invalid filter parameters

#### **Get Single Goal Tests (8+ tests)**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Get existing goal by ID with full progress
- Get non-existent goal (404)
- Get goal belonging to other user (403)
- Goal progress calculation accuracy
- Goal with no associated runs
- Goal with partial progress
- Goal with completed status
- Unauthorized access

#### **Update Goal Tests (12+ tests)**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Update goal target value
- Update goal description
- Update goal time period
- Update goal type (if allowed)
- Validation on updated fields
- Progress recalculation after update
- Update goal belonging to other user (403)
- Update non-existent goal (404)
- Update completed goal restrictions
- Unauthorized access
- Business rule validation on updates
- Concurrent update handling

#### **Delete Goal Tests (6+ tests)**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Delete existing goal
- Delete non-existent goal (404)
- Delete goal belonging to other user (403)
- Delete goal with associated progress
- Unauthorized access
- Cascade effects on related data

#### **Progress Calculation Tests (20+ tests)**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Distance goal progress with matching runs
- Distance goal progress with partial runs
- Duration goal progress calculation
- Frequency goal progress (run count)
- Pace goal progress (average calculation)
- Weekly period progress calculation
- Monthly period progress calculation
- Progress with runs outside time period
- Progress with runs in multiple periods
- Progress calculation edge cases
- Zero progress scenarios
- Over-achievement scenarios (>100%)
- Progress with deleted runs
- Real-time progress updates
- Progress calculation performance
- Complex multi-criteria goals
- Progress rounding and precision
- Historical progress tracking
- Progress calculation with timezone issues
- Leap year and month boundary handling

#### **Goal Types and Business Logic Tests (12+ tests)**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Distance goal type behavior
- Duration goal type behavior
- Frequency goal type behavior
- Pace goal type behavior
- Weekly time period logic
- Monthly time period logic
- Goal achievement detection
- Goal status transitions
- Goal deadline handling
- Goal extension scenarios
- Goal modification restrictions
- Multi-goal interactions

#### **Achievement and Completion Tests (8+ tests)**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Goal achievement detection
- Achievement timestamp accuracy
- Over-achievement handling
- Achievement notification data
- Multiple goals completion
- Achievement reversal scenarios
- Completion status consistency
- Achievement calculation edge cases

#### **Data Integrity and Security Tests (10+ tests)**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- User isolation verification
- Goal ownership validation
- Progress data consistency
- Run-goal relationship integrity
- Concurrent goal modifications
- Data corruption prevention
- Goal deletion impact on statistics
- Historical data preservation
- Authorization boundary testing
- Token validation for goal access

### **🔍 Validation Checkpoint 2**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__think_about_collected_information
Purpose: Verify test file covers all goals functionality and complex business logic
```

---

## 🧪 Step 3: Test Execution and Validation

### **3.1 Run Integration Tests**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__execute_shell_command
Parameters:
  command: "npm run test:integration"
Purpose: Execute goals API tests and verify functionality
```

### **3.2 Run Coverage Analysis**
<<<<<<< Updated upstream

```
Tool: mcp__serena__execute_shell_command
=======
```
Tool: mcp__serena__execute_shell_command  
>>>>>>> Stashed changes
Parameters:
  command: "npm run test:coverage:integration"
Purpose: Measure goals route coverage improvement
```

### **3.3 Read Coverage Report**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__filesystem__read_file
Parameters:
  path: "coverage-integration/index.html"
Purpose: Verify routes/goals.ts coverage meets 80%+ requirement
```

### **🔍 Validation Checkpoint 3**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__think_about_collected_information
Purpose: Confirm tests pass and coverage targets achieved
```

---

## 🔧 Step 4: Quality Assurance

### **4.1 Run Full Test Suite**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__execute_shell_command
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
Tool: mcp__serena__execute_shell_command
Parameters:
  command: "npm run lint:check"
Purpose: Verify no ESLint violations introduced
```

### **4.3 Run Type Checking**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__execute_shell_command
Parameters:
  command: "npm run typecheck"
Purpose: Ensure TypeScript compliance
```

### **🔍 Validation Checkpoint 4**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__think_about_task_adherence
Purpose: Confirm all requirements met and no regressions
```

---

## 📊 Step 5: Final Validation and Completion

### **5.1 Final Coverage Verification**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__execute_shell_command
Parameters:
  command: "npm run test:coverage:integration"
Purpose: Final coverage measurement
```

### **5.2 Create Progress Report**
<<<<<<< Updated upstream

```
Tool: mcp__filesystem__write_file
Parameters:
  path: "PHASE2_GOALS_PROGRESS.md"
=======
```
Tool: mcp__filesystem__write_file
Parameters:
  path: "PHASE2_GOALS_PROGRESS.md" 
>>>>>>> Stashed changes
  content: [Detailed progress report with metrics]
Purpose: Document achievement of objectives
```

### **5.3 Final Completion Check**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__think_about_whether_you_are_done
Purpose: Confirm all success criteria met
```

### **5.4 Summarize Changes**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__serena__summarize_changes
Purpose: Create final summary of goals API testing implementation
```

### **5.5 Create Completion Report**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```
Tool: mcp__filesystem__write_file
Parameters:
  path: "PHASE2_GOALS_COMPLETION.md"
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
>>>>>>> Stashed changes
   ```
   Tool: mcp__filesystem__write_file
   Parameters:
     path: "PHASE2_GOALS_ISSUES.md"
     content: [Detailed error analysis and resolution steps]
   ```

2. Use Serena validation to analyze:
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
   ```
   Tool: mcp__serena__think_about_collected_information
   ```

3. **DO NOT** mark task complete until all tests pass

### **If Progress Calculations Incorrect**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
1. Identify calculation errors in business logic
2. Create additional tests for edge cases
3. Verify date/time handling accuracy
4. Test boundary conditions thoroughly

---

## 📈 Success Metrics

### **Primary Metrics**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Goals Route Coverage**: 0% → 80%+
- **Test Count**: 70+ comprehensive test cases
- **Business Logic Coverage**: 100% of progress calculations
- **Test Suite Status**: All passing
- **Integration**: No regressions introduced

### **Quality Metrics**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Progress Accuracy**: All calculation scenarios tested
- **Goal Types**: All goal variations covered
- **Time Periods**: Weekly and monthly logic verified
- **Achievement Logic**: Goal completion detection accurate

### **Business Logic Metrics**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Calculation Accuracy**: Mathematical precision verified
- **Date Handling**: Timezone and period boundaries correct
- **Status Transitions**: Goal lifecycle properly tested
- **Data Relationships**: Run-goal associations validated

---

## 🔗 Dependencies and Coordination

### **Phase Dependencies**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Requires**: Phase 1 (Test Infrastructure Setup) completed
- **Requires**: Phase 2 Authentication (for user context)
- **Benefits From**: Phase 2 Runs (for progress calculation data)
- **Enables**: Phase 3 Integration testing with statistics

### **File Dependencies**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Reads**: routes/goals.ts, prisma/schema.prisma
- **Creates**: tests/integration/api/goals.comprehensive.test.ts
- **Updates**: Coverage metrics, test suite status

---

## 🎯 Completion Checklist

### **Before Marking Complete - ALL Must Be ✅**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- [ ] routes/goals.ts coverage ≥ 80%
- [ ] 70+ goals API test cases implemented
- [ ] All goal CRUD operations tested
- [ ] Progress calculation accuracy verified
- [ ] All goal types and time periods tested
- [ ] Achievement detection logic tested
- [ ] User isolation security verified
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
>>>>>>> Stashed changes
1. **tests/integration/api/goals.comprehensive.test.ts** - Complete test suite
2. **PHASE2_GOALS_PROGRESS.md** - Progress tracking report
3. **PHASE2_GOALS_COMPLETION.md** - Final completion report
4. **PHASE2_GOALS_ISSUES.md** - Issue documentation (if required)

---

## 🚨 Critical Reminders

### **ABSOLUTE REQUIREMENTS**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **BUSINESS LOGIC ACCURACY**: Progress calculations must be mathematically correct
- **TIME HANDLING**: Date/timezone logic must be thoroughly tested
- **USER ISOLATION**: Verify users can only access own goals
- **NO INDEPENDENT DECISIONS**: Follow instructions exactly
- **COMPLETE TESTING**: Task incomplete until thoroughly tested

### **SUCCESS DEFINITION**
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
This agent is successful ONLY when routes/goals.ts achieves 80%+ test coverage through comprehensive testing of goal management and progress calculation logic, with all tests passing.

**Agent Status**: Ready for deployment after Phase 1 completion
**Estimated Duration**: 4-6 hours
<<<<<<< Updated upstream
**Priority Level**: HIGH (Complex Business Logic)
=======
**Priority Level**: HIGH (Complex Business Logic)
>>>>>>> Stashed changes
