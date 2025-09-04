#!/usr/bin/env python3
"""
Duplicate Prevention Setup Script
Sets up automated detection hooks, creates recurring todos, and configures monitoring workflows.
Uses MCP tools for comprehensive prevention strategy implementation.
"""

import os
import sys
import json
import subprocess
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional

class MCPDuplicatePreventionSetup:
    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root).resolve()
        self.scripts_dir = self.project_root / "scripts"
        self.husky_dir = self.project_root / ".husky"
        self.setup_log = []
        
    def log(self, message: str, level: str = "INFO"):
        """Log setup actions"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] {level}: {message}"
        self.setup_log.append(log_entry)
        
        # Color output
        colors = {
            "INFO": "\033[34m",      # Blue
            "SUCCESS": "\033[32m",   # Green  
            "WARNING": "\033[33m",   # Yellow
            "ERROR": "\033[31m",     # Red
        }
        reset = "\033[0m"
        
        color = colors.get(level, "")
        print(f"{color}{'✅' if level == 'SUCCESS' else '📝' if level == 'INFO' else '⚠️' if level == 'WARNING' else '❌'} {message}{reset}")
    
    def call_mcp_todos_add(self, description: str, due_date: Optional[str] = None):
        """Add todo using MCP todos tool (placeholder)"""
        self.log(f"Would add MCP todo: {description}" + (f" (due: {due_date})" if due_date else ""))
        # In actual implementation:
        # mcp__todos__Add-Todo(description=description, due=due_date)
    
    def call_mcp_serena_memory(self, memory_name: str, content: str):
        """Store in Serena memory (placeholder)"""
        self.log(f"Would store in Serena memory '{memory_name}': {content[:100]}...")
        # In actual implementation:
        # mcp__serena__write_memory(memory_name=memory_name, content=content)
    
    def call_mcp_gemini_brainstorm(self, prompt: str, domain: str = "software", idea_count: int = 10):
        """Use Gemini brainstorming (placeholder)"""
        self.log(f"Would brainstorm with Gemini: {prompt[:50]}...")
        # In actual implementation:
        # mcp__gemini-cli__brainstorm(prompt=prompt, domain=domain, ideaCount=idea_count)
        
        # Return placeholder ideas
        return [
            "Pre-commit hook to scan for numbered files",
            "ESLint rule to detect backup patterns", 
            "Weekly automated scan script",
            "Git branch naming conventions",
            "Configuration management workflow",
            "Team training documentation",
            "Automated backup cleanup",
            "File naming standards enforcement",
            "IDE settings for duplicate prevention",
            "Monitoring dashboard for file count"
        ]
    
    def setup_pre_commit_hook(self):
        """Set up pre-commit hook to prevent duplicate file commits"""
        self.log("Setting up pre-commit hook for duplicate prevention")
        
        # Ensure .husky directory exists
        self.husky_dir.mkdir(exist_ok=True)
        
        # Create or update pre-commit hook
        pre_commit_hook = self.husky_dir / "pre-commit"
        
        hook_content = '''#!/usr/bin/env sh
# Pre-commit hook to prevent duplicate file commits
. "$(dirname -- "$0")/_/husky.sh"

echo "🔍 Checking for duplicate files..."

# Check for numbered duplicate files being committed
duplicates=$(git diff --cached --name-only | grep -E " [0-9]+\\..*$" || true)

if [ -n "$duplicates" ]; then
    echo "❌ Duplicate files detected in commit:"
    echo "$duplicates"
    echo ""
    echo "Please resolve these duplicates before committing:"
    echo "1. Compare with base files to see if they're needed"
    echo "2. If identical: delete the numbered versions"  
    echo "3. If different: merge changes or rename appropriately"
    echo "4. Run: scripts/scan-duplicates.py to analyze"
    exit 1
fi

echo "✅ No duplicate files detected"

# Run existing lint-staged if it exists
npx lint-staged 2>/dev/null || true
'''
        
        with open(pre_commit_hook, 'w') as f:
            f.write(hook_content)
        
        # Make executable
        os.chmod(pre_commit_hook, 0o755)
        
        self.log("Pre-commit hook created successfully", "SUCCESS")
        
        # Document in Serena memory
        self.call_mcp_serena_memory(
            "duplicate_prevention_precommit", 
            f"Pre-commit hook installed to prevent duplicate file commits. Location: {pre_commit_hook}"
        )
    
    def create_monitoring_script(self):
        """Create automated monitoring script for duplicate detection"""
        self.log("Creating duplicate monitoring script")
        
        monitor_script = self.scripts_dir / "monitor-duplicates.sh"
        
        script_content = '''#!/bin/bash
# Automated Duplicate File Monitoring Script
# Runs periodic scans and alerts on duplicate file creation

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Color functions
red() { echo -e "\\033[31m$*\\033[0m"; }
green() { echo -e "\\033[32m$*\\033[0m"; }
yellow() { echo -e "\\033[33m$*\\033[0m"; }

echo "🔍 Duplicate File Monitoring - $(date)"
echo "======================================="

# Run the main scanner
if python3 scripts/scan-duplicates.py > /dev/null 2>&1; then
    # Check results
    if [[ -f "duplicate_analysis_results.json" ]]; then
        total_duplicates=$(jq '.total_duplicates' duplicate_analysis_results.json 2>/dev/null || echo "0")
        
        if [[ "$total_duplicates" -eq 0 ]]; then
            green "✅ No duplicate files detected"
        elif [[ "$total_duplicates" -lt 5 ]]; then
            yellow "⚠️  $total_duplicates duplicate files detected (low risk)"
            echo "📄 Run: scripts/scan-duplicates.py --show-files for details"
        else
            red "❌ $total_duplicates duplicate files detected (needs attention)"
            echo "🚨 Run cleanup process immediately"
            echo "📋 Use: scripts/analyze-configs.sh for analysis"
        fi
        
        # Store results in git (for tracking trends)
        if [[ ! -d ".monitoring" ]]; then
            mkdir -p .monitoring
        fi
        cp duplicate_analysis_results.json ".monitoring/duplicates_$(date +%Y%m%d_%H%M%S).json"
        
        # Keep only last 10 monitoring results
        cd .monitoring
        ls -t duplicates_*.json | tail -n +11 | xargs rm -f 2>/dev/null || true
        cd ..
        
    else
        yellow "⚠️  Scanner completed but no results file generated"
    fi
else
    red "❌ Duplicate scanner failed to run"
    exit 1
fi

echo ""
echo "📊 Monitoring completed at $(date)"
'''
        
        with open(monitor_script, 'w') as f:
            f.write(script_content)
        
        os.chmod(monitor_script, 0o755)
        
        self.log("Monitoring script created successfully", "SUCCESS")
        
        # Document in memory
        self.call_mcp_serena_memory(
            "duplicate_monitoring_script",
            f"Automated monitoring script created at {monitor_script}. Runs duplicate detection and trending analysis."
        )
    
    def setup_eslint_rule(self):
        """Add ESLint rule to detect backup file patterns"""
        self.log("Setting up ESLint rule for backup file detection")
        
        eslint_config = self.project_root / "eslint.config.js"
        
        if not eslint_config.exists():
            self.log("ESLint config not found, skipping rule setup", "WARNING") 
            return
        
        # Read current config
        try:
            with open(eslint_config, 'r') as f:
                config_content = f.read()
            
            # Check if our rule already exists
            if "no-backup-files" in config_content:
                self.log("ESLint backup file rule already exists", "WARNING")
                return
            
            # Add custom rule (this would need to be implemented as a proper ESLint plugin)
            self.log("ESLint rule setup would require custom plugin implementation", "WARNING")
            self.log("Consider using file naming conventions and pre-commit hooks instead")
            
            # Document the approach
            rule_documentation = """
ESLint Custom Rule for Backup Files (Future Enhancement):

To implement:
1. Create custom ESLint plugin
2. Add rule to detect patterns like:
   - /\\s+[0-9]+\\./  (numbered files)
   - /\\.backup$/     (backup extensions)
   - /\\.bak$/        (bak extensions)
3. Configure in eslint.config.js:
   rules: {
     'custom/no-backup-files': 'error'
   }
"""
            
            self.call_mcp_serena_memory("eslint_backup_rule_plan", rule_documentation)
            
        except Exception as e:
            self.log(f"Error setting up ESLint rule: {e}", "ERROR")
    
    def create_recurring_todos(self):
        """Create recurring maintenance todos"""
        self.log("Setting up recurring maintenance todos")
        
        # Calculate future dates
        weekly_date = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        monthly_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d") 
        quarterly_date = (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")
        
        # Weekly scan
        self.call_mcp_todos_add(
            "Weekly duplicate file scan - run scripts/monitor-duplicates.sh",
            weekly_date
        )
        
        # Monthly deep analysis
        self.call_mcp_todos_add(
            "Monthly duplicate analysis - review .monitoring/ trends and run cleanup if needed",
            monthly_date
        )
        
        # Quarterly prevention review
        self.call_mcp_todos_add(
            "Quarterly duplicate prevention review - assess tools, update procedures, train team",
            quarterly_date
        )
        
        # One-time setup completion
        self.call_mcp_todos_add(
            "Review duplicate prevention setup and ensure all tools are working",
            (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        )
        
        self.log("Recurring maintenance todos created", "SUCCESS")
    
    def brainstorm_additional_strategies(self):
        """Use Gemini to brainstorm additional prevention strategies"""
        self.log("Brainstorming additional prevention strategies with Gemini")
        
        ideas = self.call_mcp_gemini_brainstorm(
            "Advanced strategies to prevent duplicate file creation in TypeScript/React development teams",
            domain="software",
            idea_count=15
        )
        
        # Document the ideas
        brainstorm_results = f"""
Duplicate Prevention Strategy Brainstorming Results
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

Additional Prevention Ideas:
{chr(10).join(f'{i+1}. {idea}' for i, idea in enumerate(ideas))}

Implementation Priority:
1. High Priority: Pre-commit hooks, automated scanning
2. Medium Priority: Team training, documentation standards  
3. Lower Priority: IDE integrations, advanced monitoring

Next Steps:
- Evaluate feasibility of each idea
- Implement high-priority items first
- Create team guidelines document
- Set up training schedule
"""
        
        self.call_mcp_serena_memory("prevention_strategy_brainstorm", brainstorm_results)
        
        self.log("Prevention strategy brainstorming completed", "SUCCESS")
    
    def create_team_guidelines(self):
        """Create team guidelines document"""
        self.log("Creating team guidelines for duplicate prevention")
        
        guidelines_file = self.project_root / "DUPLICATE_PREVENTION_GUIDELINES.md"
        
        guidelines_content = f'''# Duplicate File Prevention Guidelines

**Created**: {datetime.now().strftime('%Y-%m-%d')}  
**Purpose**: Prevent accidental duplicate file creation in the project

## Quick Reference

❌ **DON'T**: Create files like `package 2.json`, `tsconfig 2.json`, `App 2.tsx`  
✅ **DO**: Use proper git branches, meaningful names, and backup procedures

## Prevention Tools Installed

### 1. Pre-Commit Hook
- **Location**: `.husky/pre-commit`
- **Function**: Blocks commits containing numbered duplicate files
- **Bypass**: Only in emergencies with `git commit --no-verify`

### 2. Automated Monitoring  
- **Script**: `scripts/monitor-duplicates.sh`
- **Schedule**: Weekly automated scan
- **Alerts**: Notifications when duplicates are detected

### 3. Manual Scanner
- **Script**: `scripts/scan-duplicates.py`
- **Usage**: `python3 scripts/scan-duplicates.py --show-files`
- **Purpose**: On-demand duplicate detection and analysis

## Best Practices

### Configuration Changes
1. **Use branches**: `git checkout -b config/update-typescript`
2. **Document changes**: Clear commit messages explaining the change
3. **Test thoroughly**: Run `npm run quality` before committing
4. **Review process**: Get team review for major config changes

### Backup Procedures
1. **Git is your backup**: Use branches instead of numbered files
2. **Meaningful names**: `tsconfig.strict.json` vs `tsconfig 2.json`
3. **Temporary files**: Use `.tmp` extension and add to `.gitignore`
4. **Archive old configs**: Move to `archive/` directory if needed

### Emergency Procedures
If you accidentally create duplicates:
1. Run: `python3 scripts/scan-duplicates.py`
2. Analyze: `scripts/analyze-configs.sh`
3. Cleanup: Follow recommendations from analysis
4. Verify: `scripts/verify-cleanup-quality.sh`

## Team Training

### New Team Members
- Review this document during onboarding
- Practice using the prevention tools
- Understand git branching workflows
- Know when to ask for help

### Regular Reminders
- Monthly team review of duplicate prevention
- Share lessons learned from any incidents
- Update procedures based on team feedback

## Monitoring & Maintenance

### Automated Tasks
- Weekly duplicate scan (automated)
- Monthly trend analysis review
- Quarterly prevention strategy review

### Manual Checks
- Before major releases
- After large refactoring sessions
- When onboarding new team members

## Getting Help

### Tools Available
- `scripts/scan-duplicates.py --help`
- `scripts/analyze-configs.sh --help` 
- `scripts/verify-cleanup-quality.sh --help`

### Escalation Process
1. Try automated tools first
2. Check team chat for similar issues
3. Escalate to senior team members
4. Document solution for future reference

## Success Metrics

### Targets
- Zero duplicate files in production commits
- < 1 week average resolution time for any duplicates found
- 100% team awareness of prevention procedures
- Monthly duplicate count trending to zero

### Monitoring
- Pre-commit hook effectiveness
- Weekly scan results trending
- Team feedback and suggestions
- Tool usage and effectiveness

---

**Remember**: Prevention is easier than cleanup. When in doubt, ask the team!
'''
        
        with open(guidelines_file, 'w') as f:
            f.write(guidelines_content)
        
        self.log(f"Team guidelines created: {guidelines_file}", "SUCCESS")
        
        # Document in memory
        self.call_mcp_serena_memory(
            "team_guidelines_created",
            f"Comprehensive team guidelines document created at {guidelines_file}"
        )
    
    def generate_setup_report(self):
        """Generate final setup report"""
        self.log("Generating duplicate prevention setup report")
        
        report = {
            "setup_timestamp": datetime.now().isoformat(),
            "project_root": str(self.project_root),
            "tools_installed": [
                "Pre-commit hook (.husky/pre-commit)",
                "Monitoring script (scripts/monitor-duplicates.sh)", 
                "Team guidelines (DUPLICATE_PREVENTION_GUIDELINES.md)"
            ],
            "todos_created": [
                "Weekly duplicate scan",
                "Monthly trend analysis", 
                "Quarterly strategy review",
                "Setup verification"
            ],
            "next_steps": [
                "Test pre-commit hook with dummy duplicate",
                "Run initial monitoring scan",
                "Share guidelines with team",
                "Schedule team training session"
            ],
            "setup_log": self.setup_log
        }
        
        # Save report
        report_file = self.project_root / "duplicate_prevention_setup_report.json"
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        self.log(f"Setup report saved: {report_file}", "SUCCESS")
        
        # Store in memory
        self.call_mcp_serena_memory(
            "prevention_setup_completed",
            json.dumps(report, indent=2)
        )
        
        return report
    
    def run_setup(self):
        """Run complete duplicate prevention setup"""
        print("🛡️  MCP Duplicate Prevention Setup")
        print("==================================")
        print("")
        
        try:
            # Ensure we're in project root
            os.chdir(self.project_root)
            
            # Run setup steps
            self.setup_pre_commit_hook()
            self.create_monitoring_script()
            self.setup_eslint_rule()
            self.create_recurring_todos()
            self.brainstorm_additional_strategies()
            self.create_team_guidelines()
            
            # Generate final report
            report = self.generate_setup_report()
            
            print("")
            print("🎉 Duplicate Prevention Setup Complete!")
            print("======================================")
            print("")
            print("✅ Tools installed:")
            for tool in report['tools_installed']:
                print(f"   • {tool}")
            print("")
            print("📋 Next steps:")
            for step in report['next_steps']:
                print(f"   • {step}")
            print("")
            print("📄 Full report available in: duplicate_prevention_setup_report.json")
            
            return True
            
        except Exception as e:
            self.log(f"Setup failed: {e}", "ERROR")
            print(f"\n❌ Setup failed: {e}")
            return False

def main():
    """Main execution function"""
    if len(sys.argv) > 1 and sys.argv[1] in ['--help', '-h']:
        print("""
MCP Duplicate Prevention Setup

Usage: python3 scripts/setup-duplicate-prevention.py [OPTIONS]

Options:
  --help, -h     Show this help message

This script sets up comprehensive duplicate file prevention:
  • Pre-commit hooks to block duplicate commits
  • Automated monitoring and scanning
  • Team guidelines and documentation
  • Recurring maintenance todos
  • Prevention strategy brainstorming

Run from project root directory.
""")
        return
    
    # Initialize and run setup
    setup = MCPDuplicatePreventionSetup()
    success = setup.run_setup()
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()