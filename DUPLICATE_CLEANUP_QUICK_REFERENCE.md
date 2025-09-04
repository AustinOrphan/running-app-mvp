# MCP Duplicate Cleanup - Quick Reference

**For**: Running Tracker MVP Project  
**Updated**: September 2, 2025

## 🚀 Quick Start

```bash
# 1. Scan for duplicates
python3 scripts/scan-duplicates.py --show-files

# 2. Analyze configurations
scripts/analyze-configs.sh

# 3. Review analysis (use MCP tools)
# Read Serena memories: duplicate_scan_results, *_config_analysis

# 4. Execute cleanup (based on analysis recommendations)
# Example: rm -f "package 2.json" "tsconfig 2.json" ...

# 5. Verify quality
scripts/verify-cleanup-quality.sh

# 6. Set up prevention
python3 scripts/setup-duplicate-prevention.py
```

## 📋 Available Scripts

| Script                          | Purpose                         | Usage                                           |
| ------------------------------- | ------------------------------- | ----------------------------------------------- |
| `scan-duplicates.py`            | Find & categorize duplicates    | `python3 scripts/scan-duplicates.py`            |
| `analyze-configs.sh`            | Analyze config file differences | `scripts/analyze-configs.sh`                    |
| `verify-cleanup-quality.sh`     | Quality verification            | `scripts/verify-cleanup-quality.sh`             |
| `setup-duplicate-prevention.py` | Setup prevention tools          | `python3 scripts/setup-duplicate-prevention.py` |

## 🔧 MCP Tools Used

- **Serena**: File analysis, memory storage, strategic thinking
- **Gemini CLI**: Content comparison, conflict resolution
- **Sequential Thinking**: Complex decision-making
- **Context7**: Library documentation lookup
- **Todos**: Progress tracking and maintenance scheduling

## ⚡ Common Commands

```bash
# Configuration analysis
scripts/analyze-configs.sh --package     # Just package.json
scripts/analyze-configs.sh --typescript  # Just TypeScript configs

# Quick quality check
scripts/verify-cleanup-quality.sh --quick

# View scan results
cat duplicate_analysis_results.json | jq '.summary'

# Check prevention status
ls .husky/pre-commit     # Pre-commit hook exists
ls scripts/monitor-*     # Monitoring tools
```

## 🧠 MCP Memory Locations

**Serena Memories Created:**

- `duplicate_scan_results` - Latest scan analysis
- `package_json_analysis` - Package.json comparison
- `typescript_config_analysis` - TypeScript config analysis
- `eslint_config_analysis` - ESLint config analysis
- `cleanup_completion_report` - Final cleanup results
- `prevention_setup_completed` - Prevention tools status

**Access**: Use `mcp__serena__read_memory` with memory names

## 🎯 Decision Framework

### Safe to Delete (Exact Duplicates):

- Identical file content (verified by hash)
- Numbered versions of config files
- Backup files with broken configurations

### Needs Analysis:

- Different file contents
- Configuration variations
- Files with potential value

### Needs Rename:

- Orphaned files (no base version)
- Valuable content in numbered files
- Documentation with unique information

## 🚨 Quality Gates

**MANDATORY** (per project requirements):

1. `npm run quality` MUST pass
2. `npm run build` MUST succeed
3. `npm run test:run` MUST pass

**Additional Verification:**

- Development server starts successfully
- All critical files present
- No remaining duplicates (unless documented)

## 🛡️ Prevention Tools

**Pre-commit Hook**: Blocks duplicate commits  
**Monitoring Script**: Weekly automated scan  
**Team Guidelines**: `DUPLICATE_PREVENTION_GUIDELINES.md`  
**Recurring Todos**: Maintenance reminders

## 📞 Getting Help

```bash
# Script help
python3 scripts/scan-duplicates.py --help
scripts/analyze-configs.sh --help
scripts/verify-cleanup-quality.sh --help

# Full documentation
cat MCP_DUPLICATE_CLEANUP_GUIDE.md

# Analysis results
cat FINAL_DUPLICATE_ANALYSIS.md
```

## 🎉 Success Criteria

- ✅ Zero exact duplicates remaining
- ✅ All quality checks passing
- ✅ Build and tests working
- ✅ Prevention tools installed
- ✅ Team guidelines documented
- ✅ Knowledge preserved in Serena memories

---

**Remember**: Use scripts consistently instead of manual MCP tool calls!
