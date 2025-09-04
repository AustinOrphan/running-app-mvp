# MCP-Enhanced Duplicate File Cleanup Guide

**Project**: Running Tracker MVP  
**Created**: September 2, 2025  
**MCP Tools**: Serena, Gemini CLI, Sequential Thinking, Context7, Todos

## Overview

This guide provides comprehensive workflows using **all available MCP tools** to complete the duplicate file cleanup for the Running Tracker MVP project. Based on project analysis, we have systematic approaches for each cleanup phase.

## Available MCP Tool Suite

### 🔧 **Serena Tools** (Project: running-app-mvp)

- **File Operations**: `list_dir`, `find_file`, `search_for_pattern`
- **Code Analysis**: `get_symbols_overview`, `find_symbol`, `find_referencing_symbols`
- **Memory Management**: `write_memory`, `read_memory`, `list_memories`
- **Strategic Analysis**: `think_about_collected_information`, `think_about_task_adherence`, `think_about_whether_you_are_done`
- **Code Editing**: `replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol`

### 🤖 **Gemini CLI Tools**

- **Content Analysis**: `ask-gemini` (with changeMode for structured responses)
- **Creative Problem Solving**: `brainstorm`
- **Response Management**: `fetch-chunk` (for large responses)
- **Utility**: `ping`, `Help`

### 🧠 **Sequential Thinking**

- **Complex Decisions**: `sequentialthinking` (for multi-step analysis)

### 📚 **Context7**

- **Library Documentation**: `resolve-library-id`, `get-library-docs`

### ✅ **Todos Management**

- **Task Tracking**: Complete suite of todo management tools

## Current Situation Analysis

Based on project memories and file analysis:

- **Project Type**: Running Tracker MVP (React + Express + TypeScript)
- **Quality Requirements**: MANDATORY `npm run quality` before task completion
- **Architecture**: Monorepo with strict coding conventions
- **Remaining Duplicates**: ~20 files requiring analysis

## Phase 1: Enhanced Duplicate Discovery

### Tool Combination: Serena + Sequential Thinking

**Step 1.1: Systematic File Discovery**

```bash
# Use Serena instead of shell commands (avoids timeouts)
mcp__serena__search_for_pattern:
  substring_pattern: " [0-9]\\."
  relative_path: "."
  paths_exclude_glob: "node_modules/**,lib/**,coverage/**"
  max_answer_chars: 10000
```

**Step 1.2: Strategic Analysis**

```bash
# Use Sequential Thinking for complex categorization
mcp__sequential-thinking__sequentialthinking:
  thought: "Analyze duplicate file patterns to create cleanup strategy"
  total_thoughts: 5
  next_thought_needed: true
```

**Step 1.3: Memory Documentation**

```bash
# Store findings in Serena memory
mcp__serena__write_memory:
  memory_name: "duplicate_cleanup_analysis"
  content: "Detailed findings from duplicate file discovery"
```

## Phase 2: Content Analysis & Decision Making

### Tool Combination: Gemini CLI + Context7 + Todos

**Step 2.1: Configuration File Analysis**

```bash
# Use Gemini with changeMode for structured comparison
mcp__gemini-cli__ask-gemini:
  prompt: "Compare package.json vs package 2.json vs package 3.json. Provide structured analysis."
  changeMode: true
  model: "gemini-2.5-pro"
```

**Step 2.2: Library Dependency Context**

```bash
# Use Context7 for understanding removed dependencies
mcp__Context7__resolve-library-id:
  libraryName: "@mdi/svg"

mcp__Context7__get-library-docs:
  context7CompatibleLibraryID: "/mdi/svg"
  topic: "usage patterns"
```

**Step 2.3: Task Tracking**

```bash
# Use Todos for systematic progress tracking
mcp__todos__Add-Todo:
  description: "Analyze package.json variants with Gemini"

mcp__todos__Add-Todo:
  description: "Verify TypeScript config conflicts"

mcp__todos__Add-Todo:
  description: "Document decisions in Serena memory"
```

## Phase 3: Complex Decision Resolution

### Tool Combination: All MCP Tools

**Step 3.1: Tasks Files Decision (Most Complex)**

```bash
# Sequential Thinking for multi-step analysis
mcp__sequential-thinking__sequentialthinking:
  thought: "Analyze tasks.md (404 lines), tasks 2.md (709 lines), tasks 3.md (183 lines) to determine which contain unique value"
  total_thoughts: 8
  next_thought_needed: true

# Gemini for detailed content comparison
mcp__gemini-cli__ask-gemini:
  prompt: "Compare content and purpose of three tasks files"
  changeMode: true

# Serena strategic thinking
mcp__serena__think_about_task_adherence:
# Confirms alignment with project goals

# Document decision in memory
mcp__serena__write_memory:
  memory_name: "tasks_files_decision"
  content: "Analysis and decision rationale"

# Update todos with decision
mcp__todos__Mark-Todo-Done:
  id: [task_id]
```

**Step 3.2: Merge Conflict Resolution**

```bash
# Gemini with structured conflict resolution
mcp__gemini-cli__ask-gemini:
  prompt: "Resolve Git merge conflicts in DEPLOYMENT_README 2.md"
  changeMode: true
  sandbox: true

# Use chunked responses if needed
mcp__gemini-cli__fetch-chunk:
  cacheKey: [returned_key]
  chunkIndex: 1
```

## Phase 4: Implementation Workflows

### Workflow A: Safe Configuration Deletions

**Tools**: Serena + Gemini CLI + Todos

```bash
# 1. Verify with Serena that files aren't referenced
mcp__serena__find_referencing_symbols:
  name_path: "package 2.json"
  relative_path: "."

# 2. Final verification with Gemini
mcp__gemini-cli__ask-gemini:
  prompt: "Confirm these config files are safe to delete: [file list]"
  model: "gemini-2.5-flash"  # Faster for verification

# 3. Document decision
mcp__serena__write_memory:
  memory_name: "safe_deletions_verified"
  content: "Verification results and file list"

# 4. Track progress
mcp__todos__Add-Todo:
  description: "Delete verified safe configuration duplicates"

# 5. Execute deletion (using standard tools)
# rm -f [verified files]

# 6. Mark complete
mcp__todos__Mark-Todo-Done:
  id: [task_id]
```

### Workflow B: Orphaned File Renames

**Tools**: Serena + Gemini CLI

```bash
# 1. Analyze content value
mcp__gemini-cli__ask-gemini:
  prompt: "Analyze value of PERFORMANCE_THRESHOLDS 2.md content"

# 2. Check for references in codebase
mcp__serena__search_for_pattern:
  substring_pattern: "PERFORMANCE_THRESHOLDS"
  relative_path: "."

# 3. Strategic decision
mcp__serena__think_about_collected_information:

# 4. Document and execute rename
# mv "PERFORMANCE_THRESHOLDS 2.md" "PERFORMANCE_THRESHOLDS.md"
```

## Phase 5: Quality Assurance & Prevention

### Tool Combination: All MCP Tools + Project Standards

**Step 5.1: Comprehensive Verification**

```bash
# 1. Project-specific quality check (MANDATORY per project guidelines)
npm run quality  # lint:fix + format + typecheck

# 2. Build verification
npm run build

# 3. Test verification
npm run test:all

# 4. Serena verification
mcp__serena__think_about_whether_you_are_done:

# 5. Document completion
mcp__serena__write_memory:
  memory_name: "cleanup_completion_report"
  content: "Final status and verification results"
```

**Step 5.2: Prevention Strategy**

```bash
# 1. Brainstorm prevention approaches
mcp__gemini-cli__brainstorm:
  prompt: "Strategies to prevent duplicate file creation in future"
  domain: "software"
  ideaCount: 10

# 2. Create monitoring workflow
mcp__serena__write_memory:
  memory_name: "duplicate_prevention_strategy"
  content: "Automated detection and prevention procedures"

# 3. Set up recurring todos
mcp__todos__Add-Todo:
  description: "Monthly duplicate file scan"
  due: "2025-10-02"
```

## Advanced MCP Workflows

### Parallel Processing Pattern

```bash
# Use multiple Gemini models simultaneously for speed
mcp__gemini-cli__ask-gemini (instance 1):
  model: "gemini-2.5-pro"
  prompt: "Analyze configuration files package.json variants"

mcp__gemini-cli__ask-gemini (instance 2):
  model: "gemini-2.5-flash"
  prompt: "Verify TypeScript config deletion safety"

# Combine with Serena analysis
mcp__serena__think_about_collected_information:
```

### Concrete Implementation Examples

#### Example 1: TypeScript Config Analysis

```bash
# Step 1: Use Gemini to analyze the specific conflict
mcp__gemini-cli__ask-gemini:
  prompt: |
    Analyze these TypeScript configurations:

    tsconfig.json:
    include: ["src/**/*.ts", "tests/**/*.ts"]
    exclude: ["node_modules", "dist"]

    tsconfig 2.json:
    include: ["src/**/*.ts", "tests/**/*.ts"]
    exclude: ["node_modules", "dist", "tests/**/*", "**/*.test.ts"]

    Which configuration would break test compilation?
  model: "gemini-2.5-pro"

# Step 2: Verify with Sequential Thinking
mcp__sequential-thinking__sequentialthinking:
  thought: "The exclude patterns in tsconfig 2.json contradict the include patterns for test files"
  total_thoughts: 3
  next_thought_needed: true

# Step 3: Document decision
mcp__serena__write_memory:
  memory_name: "typescript_config_analysis"
  content: "tsconfig 2.json and 3.json contain broken exclude patterns that would prevent test compilation. Safe to delete."

# Result: VERIFIED SAFE DELETION
```

#### Example 2: Package.json Dependency Analysis

```bash
# Step 1: Context research on removed dependencies
mcp__Context7__resolve-library-id:
  libraryName: "@mdi/svg"

mcp__Context7__get-library-docs:
  context7CompatibleLibraryID: "/mdi/svg"
  topic: "usage in React projects"

# Step 2: Search codebase for usage
mcp__serena__search_for_pattern:
  substring_pattern: "@mdi/svg|mdi-.*"
  relative_path: "src"

# Step 3: Gemini analysis of dependency impact
mcp__gemini-cli__ask-gemini:
  prompt: |
    The main package.json removed @mdi/svg and helmet dependencies.
    Backup versions still include them.

    Context: This is a React running tracker app.

    Should these dependencies be restored or were they correctly removed?
  changeMode: true

# Step 4: Strategic decision
mcp__serena__think_about_task_adherence:

# Result: DECISION WITH REASONING
```

### Context-Aware Decision Making

```bash
# Read project context
mcp__serena__read_memory:
  memory_file_name: "coding_conventions"

# Apply context to decisions
mcp__sequential-thinking__sequentialthinking:
  thought: "Apply project coding conventions to duplicate file decisions"

# Cross-reference with external docs
mcp__Context7__get-library-docs:
  context7CompatibleLibraryID: "/typescript/handbook"
  topic: "project configuration"
```

## Tool Selection Guidelines

### When to Use Each Tool:

**Serena**:

- File system operations (avoids shell timeouts)
- Code structure analysis
- Memory management for complex decisions
- Strategic thinking about project impact

**Gemini CLI**:

- Content comparison and analysis
- Conflict resolution with structured output
- Independent verification
- Creative problem solving

**Sequential Thinking**:

- Multi-step complex decisions
- Ambiguous situations requiring careful analysis
- Cross-referencing multiple data sources

**Context7**:

- Understanding external library implications
- Documentation lookup for unfamiliar dependencies
- Best practices research

**Todos**:

- Progress tracking across multiple phases
- Deadline management
- Systematic workflow execution

## Risk Mitigation & Quality Assurance

### High-Risk Operations

1. **Configuration File Changes**: Always use Serena + Gemini verification
2. **Large Content Decisions**: Use Sequential Thinking for thoroughness
3. **Project Impact Assessment**: Consult project memories via Serena

### Rollback Procedures

1. **Git Safety**: Work in feature branch
2. **Memory Documentation**: Record all decisions in Serena
3. **Todo Tracking**: Maintain detailed progress logs
4. **Quality Gates**: MANDATORY `npm run quality` validation

### Comprehensive Quality Assurance Framework

#### Pre-Cleanup Validation

```bash
# 1. Create backup branch
git checkout -b cleanup/duplicate-files-removal

# 2. Document initial state
mcp__serena__write_memory:
  memory_name: "cleanup_initial_state"
  content: "File count and system status before cleanup"

# 3. Baseline quality check
npm run quality  # Must pass before starting

# 4. Create comprehensive todo list
mcp__todos__Add-Todo:
  description: "Phase 1: Safe configuration deletions"

mcp__todos__Add-Todo:
  description: "Phase 2: Orphaned file renames"

mcp__todos__Add-Todo:
  description: "Phase 3: Complex decisions (tasks files)"

mcp__todos__Add-Todo:
  description: "Phase 4: Quality verification"
```

#### During-Cleanup Validation

```bash
# After each major phase
mcp__serena__think_about_collected_information:
# Assess progress and any issues

npm run build  # Verify system still builds
npm run test:run  # Verify tests still pass

# Document phase completion
mcp__serena__write_memory:
  memory_name: "cleanup_phase_N_completion"
  content: "Results and any issues from phase N"

# Update todos
mcp__todos__Mark-Todo-Done:
  id: [phase_id]
```

#### Post-Cleanup Validation

```bash
# 1. MANDATORY quality check (per project guidelines)
npm run quality  # MUST PASS

# 2. Comprehensive testing
npm run test:all
npm run test:e2e

# 3. Production build verification
npm run build

# 4. Performance check (if applicable)
npm run perf:local

# 5. Strategic completion assessment
mcp__serena__think_about_whether_you_are_done:

# 6. Final documentation
mcp__serena__write_memory:
  memory_name: "cleanup_completion_report"
  content: |
    Final cleanup results:
    - Files deleted: [count]
    - Files renamed: [count]
    - Issues encountered: [list]
    - Quality checks: All passed
    - System status: Fully functional

# 7. Mark all todos complete
mcp__todos__List-Pending-Todos:
# Review and complete remaining items
```

### Prevention Strategy Implementation

#### Automated Detection System

```bash
# 1. Brainstorm prevention approaches
mcp__gemini-cli__brainstorm:
  prompt: "Create automated duplicate file detection for TypeScript/React project"
  domain: "software"
  methodology: "design-thinking"
  ideaCount: 15

# 2. Create monitoring script concept
mcp__serena__write_memory:
  memory_name: "duplicate_detection_automation"
  content: |
    Automated duplicate detection strategy:
    1. Weekly shell script to find numbered files
    2. Git pre-commit hook to prevent accidental duplicates
    3. ESLint rule to detect backup file patterns
    4. Documentation about proper backup procedures

# 3. Set up recurring maintenance
mcp__todos__Add-Todo:
  description: "Implement automated duplicate detection script"
  due: "2025-09-15"

mcp__todos__Add-Todo:
  description: "Add pre-commit hook for duplicate prevention"
  due: "2025-09-20"

mcp__todos__Add-Todo:
  description: "Monthly duplicate file audit"
  due: "2025-10-02"
```

#### Team Education & Documentation

```bash
# 1. Create prevention guidelines
mcp__gemini-cli__ask-gemini:
  prompt: |
    Create team guidelines for preventing duplicate file creation.
    Context: TypeScript/React monorepo with strict quality standards.
    Include: proper backup procedures, branching strategies, configuration management.
  changeMode: true

# 2. Document in project memory
mcp__serena__write_memory:
  memory_name: "duplicate_prevention_guidelines"
  content: "Team guidelines and best practices for preventing duplicate files"

# 3. Integration with existing standards
mcp__serena__read_memory:
  memory_file_name: "coding_conventions"

# Cross-reference with existing conventions and enhance them
```

#### Configuration Management Best Practices

```bash
# 1. Research industry best practices
mcp__Context7__resolve-library-id:
  libraryName: "typescript"

mcp__Context7__get-library-docs:
  context7CompatibleLibraryID: "/typescript/handbook"
  topic: "project configuration"

# 2. Apply to project context
mcp__sequential-thinking__sequentialthinking:
  thought: "How can we prevent configuration file duplication using TypeScript/Node.js best practices?"
  total_thoughts: 6
  next_thought_needed: true

# 3. Create configuration management strategy
mcp__serena__write_memory:
  memory_name: "config_management_strategy"
  content: "Systematic approach to configuration changes and version management"
```

## Success Metrics

### Quantitative

- Duplicate files eliminated: Target 95%+
- Zero broken builds after cleanup
- All quality checks passing
- Complete todo task completion

### Qualitative

- Strategic decisions documented in Serena memories
- Prevention strategies implemented
- Team workflow improved
- Knowledge preserved for future maintenance

## Reusable Implementation Scripts

### Core Principle: Write Once, Use Many Times

Instead of repeating commands manually, create reusable scripts that encapsulate MCP workflows:

#### Script 1: Duplicate File Scanner

**File**: `scripts/scan-duplicates.py`

- Uses Python with subprocess to call MCP tools
- Systematic duplicate detection with Serena
- Output structured for further processing

#### Script 2: MCP Configuration Analyzer

**File**: `scripts/analyze-configs.sh`

- Orchestrates Gemini CLI calls for config comparison
- Handles changeMode responses and chunking
- Documents results in Serena memories

#### Script 3: Quality Verification Runner

**File**: `scripts/verify-cleanup-quality.sh`

- Runs complete quality validation pipeline
- Integrates with project's `npm run quality` requirement
- Creates comprehensive test and build verification

#### Script 4: Prevention Setup

**File**: `scripts/setup-duplicate-prevention.py`

- Sets up automated detection hooks
- Creates recurring todos for maintenance
- Configures monitoring workflows

### Implementation Pattern

**Step 1**: Create script files with MCP tool integration ✅  
**Step 2**: Make scripts executable and add to project ✅  
**Step 3**: Document usage in this guide ✅  
**Step 4**: Use scripts consistently instead of manual commands

### Script Usage Documentation

#### Running the Scripts

**1. Duplicate Detection & Analysis**

```bash
# Basic scan
python3 scripts/scan-duplicates.py

# Show file list
python3 scripts/scan-duplicates.py --show-files

# Configuration analysis
scripts/analyze-configs.sh

# Specific config analysis
scripts/analyze-configs.sh --package      # Only package.json files
scripts/analyze-configs.sh --typescript   # Only tsconfig files
scripts/analyze-configs.sh --eslint       # Only ESLint configs
```

**2. Quality Verification**

```bash
# Full verification suite (recommended)
scripts/verify-cleanup-quality.sh

# Quick mandatory checks only
scripts/verify-cleanup-quality.sh --quick

# Specific verification
scripts/verify-cleanup-quality.sh --build-only
scripts/verify-cleanup-quality.sh --tests-only
```

**3. Prevention Setup**

```bash
# Complete prevention setup
python3 scripts/setup-duplicate-prevention.py

# Help and options
python3 scripts/setup-duplicate-prevention.py --help
```

**4. Ongoing Monitoring**

```bash
# Weekly monitoring (after prevention setup)
scripts/monitor-duplicates.sh

# Check monitoring history
ls .monitoring/duplicates_*.json
```

#### Script Integration with MCP Tools

**MCP Tool Calls Within Scripts:**

1. **Serena Memory Storage**
   - All scripts store results in project memories
   - Accessible via `mcp__serena__read_memory`
   - Creates searchable knowledge base

2. **Gemini Analysis Integration**
   - `analyze-configs.sh` uses structured Gemini prompts
   - Handles `changeMode` for consistent responses
   - Manages chunked responses for large analyses

3. **Sequential Thinking for Complex Decisions**
   - Built into verification workflows
   - Used for ambiguous file situations
   - Strategic assessment integration

4. **Todos for Progress Tracking**
   - Prevention setup creates maintenance schedules
   - Integration with MCP todos system
   - Recurring task management

#### Workflow Integration Examples

**Complete Cleanup Workflow:**

```bash
# 1. Initial scan and analysis
python3 scripts/scan-duplicates.py --show-files
scripts/analyze-configs.sh

# 2. Review Serena memories for decisions
# (Use MCP tools to read stored analysis)

# 3. Execute safe deletions based on analysis
# (Manual step - execute rm commands from analysis)

# 4. Comprehensive verification
scripts/verify-cleanup-quality.sh

# 5. Set up prevention for future
python3 scripts/setup-duplicate-prevention.py
```

**Daily Development Workflow:**

```bash
# Pre-commit check (automated via husky)
# Manual check if needed:
python3 scripts/scan-duplicates.py

# Weekly monitoring (automated)
scripts/monitor-duplicates.sh

# After major config changes:
scripts/analyze-configs.sh --typescript
scripts/verify-cleanup-quality.sh --quick
```

This ensures:

- **Consistency**: Same commands every time
- **Efficiency**: No need to rewrite MCP tool calls
- **Maintainability**: Update once, benefit everywhere
- **Documentation**: Scripts serve as runnable documentation

## Conclusion

This MCP-enhanced approach provides:

1. **Systematic Analysis**: Using all available MCP tools strategically
2. **Risk Mitigation**: Multiple verification layers
3. **Knowledge Preservation**: Serena memories for future reference
4. **Quality Assurance**: Integration with project standards
5. **Scalable Workflows**: Reusable patterns for future cleanup needs
6. **Script-Based Automation**: Consistent, reusable implementation patterns

The combination of Serena's project-aware capabilities, Gemini's analytical power, Sequential Thinking's structured approach, Context7's knowledge base, Todos' progress tracking, and automated scripts creates a comprehensive solution for complex file management challenges.
