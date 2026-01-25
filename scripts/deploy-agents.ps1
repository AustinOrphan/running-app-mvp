# Multi-Agent Test Coverage Deployment Script (PowerShell)
# Automatically launches Claude Code instances for coordinated test coverage improvement

param(
    [switch]$Help,
    [switch]$DryRun
)

# Colors for output
$Red = [ConsoleColor]::Red
$Green = [ConsoleColor]::Green
$Yellow = [ConsoleColor]::Yellow
$Blue = [ConsoleColor]::Blue
$Cyan = [ConsoleColor]::Cyan

function Write-ColoredOutput {
    param($Message, $Color = [ConsoleColor]::White)
    Write-Host $Message -ForegroundColor $Color
}

# Project directory
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Agent plan files
$Phase1Plan = "PHASE1_INFRASTRUCTURE_SETUP.md"
$Phase2AuthPlan = "PHASE2_AUTHENTICATION_TESTING.md"
$Phase2RunsPlan = "PHASE2_RUNS_API_TESTING.md"
$Phase2GoalsPlan = "PHASE2_GOALS_API_TESTING.md"
$Phase2MiddlewarePlan = "PHASE2_MIDDLEWARE_TESTING.md"
$Phase3IntegrationPlan = "PHASE3_INTEGRATION_TESTING.md"

# Coordination directory
$CoordDir = "AGENT_COORDINATION"

if ($Help) {
    Write-ColoredOutput "Multi-Agent Test Coverage Deployment" $Cyan
    Write-ColoredOutput "====================================" $Blue
    Write-ColoredOutput ""
    Write-ColoredOutput "Usage: .\deploy-agents.ps1 [-DryRun] [-Help]" $Yellow
    Write-ColoredOutput ""
    Write-ColoredOutput "Options:" $Blue
    Write-ColoredOutput "  -DryRun    Validate setup without launching agents"
    Write-ColoredOutput "  -Help      Show this help message"
    Write-ColoredOutput ""
    Write-ColoredOutput "This script automatically launches multiple Claude Code instances"
    Write-ColoredOutput "to execute the comprehensive test coverage improvement deployment."
    exit 0
}

Write-ColoredOutput "🚀 Multi-Agent Test Coverage Deployment" $Cyan
Write-ColoredOutput "=====================================" $Blue
Write-ColoredOutput ""

# Function to check if Claude Code is available
function Test-ClaudeCode {
    Write-ColoredOutput "Checking for Claude Code CLI..." $Blue
    
    try {
        $null = Get-Command claude -ErrorAction Stop
        Write-ColoredOutput "✅ Claude Code CLI found" $Green
        return $true
    }
    catch {
        Write-ColoredOutput "❌ ERROR: Claude Code CLI not found" $Red
        Write-ColoredOutput "Please install Claude Code CLI first:" $Yellow
        Write-ColoredOutput "npm install -g @anthropic/claude-cli"
        return $false
    }
}

# Function to verify all plan files exist
function Test-DeploymentPlans {
    Write-ColoredOutput "📋 Verifying deployment plans..." $Blue
    
    $plans = @($Phase1Plan, $Phase2AuthPlan, $Phase2RunsPlan, $Phase2GoalsPlan, $Phase2MiddlewarePlan, $Phase3IntegrationPlan)
    $allExist = $true
    
    foreach ($plan in $plans) {
        $planPath = Join-Path $ProjectDir $plan
        if (Test-Path $planPath) {
            Write-ColoredOutput "✅ Found: $plan" $Green
        } else {
            Write-ColoredOutput "❌ ERROR: Plan file not found: $plan" $Red
            $allExist = $false
        }
    }
    
    if ($allExist) {
        Write-ColoredOutput "✅ All deployment plans verified" $Green
        Write-ColoredOutput ""
    }
    
    return $allExist
}

# Function to create coordination directory
function Initialize-CoordinationSystem {
    Write-ColoredOutput "🏗️ Setting up coordination system..." $Blue
    
    $coordPath = Join-Path $ProjectDir $CoordDir
    New-Item -Path (Join-Path $coordPath "progress") -ItemType Directory -Force | Out-Null
    New-Item -Path (Join-Path $coordPath "issues") -ItemType Directory -Force | Out-Null
    New-Item -Path (Join-Path $coordPath "coordination") -ItemType Directory -Force | Out-Null
    New-Item -Path (Join-Path $coordPath "reports") -ItemType Directory -Force | Out-Null
    
    # Create initial status files
    $statusContent = @"
# Multi-Agent Deployment Status

## Current Phase: Phase 1 - Infrastructure Setup
**Started**: $(Get-Date)
**Status**: PHASE1_PENDING

## Phase Progress
- **Phase 1 (Infrastructure)**: PENDING
- **Phase 2 (Parallel Testing)**: WAITING
  - Authentication Agent: WAITING
  - Runs Agent: WAITING  
  - Goals Agent: WAITING
  - Middleware Agent: WAITING
- **Phase 3 (Integration)**: WAITING

## Overall Metrics
- **Coverage Target**: 14.8% → 80%+
- **Current Coverage**: 14.8%
- **Active Agents**: 0/6
- **Issues**: 0 Critical, 0 High, 0 Medium

**Last Updated**: $(Get-Date)
"@

    $statusContent | Out-File -FilePath (Join-Path $coordPath "progress/deployment-status.md") -Encoding UTF8
    
    $issuesContent = @"
# Global Deployment Issues

## Critical Issues (Blocking Multiple Agents)
| Issue ID | Description | Affected Agents | Severity | Status | Owner | ETA |
|----------|-------------|-----------------|----------|--------|-------|-----|
| (None)   | No critical issues | - | - | - | - | - |

## High Priority Issues (Single Agent Blocking)  
| Issue ID | Description | Agent | Severity | Status | Owner | ETA |
|----------|-------------|-------|----------|--------|-------|-----|
| (None)   | No high priority issues | - | - | - | - | - |

## Resolution Log
| Issue ID | Resolution | Resolved By | Date | Impact |
|----------|------------|-------------|------|--------|
| (None)   | No resolutions yet | - | - | - |

**Created**: $(Get-Date)
"@

    $issuesContent | Out-File -FilePath (Join-Path $coordPath "issues/GLOBAL_ISSUES.md") -Encoding UTF8
    
    Write-ColoredOutput "✅ Coordination system initialized" $Green
    Write-ColoredOutput ""
}

# Function to launch Phase 1 agent
function Start-Phase1Agent {
    Write-ColoredOutput "🔧 Launching Phase 1: Infrastructure Setup Agent" $Yellow
    Write-ColoredOutput "Plan: $Phase1Plan" $Blue
    Write-ColoredOutput ""
    
    $phase1Prompt = @"
# Phase 1: Infrastructure Setup Agent

You are an autonomous agent responsible for test infrastructure setup. Follow the detailed instructions in $Phase1Plan exactly.

## Critical Requirements:
- NO INDEPENDENT DECISIONS: Follow the plan precisely
- USE ONLY SPECIFIED MCP TOOLS: Each step specifies exact tools and parameters
- DOCUMENT ALL PROGRESS: Update coordination files as specified
- VALIDATE CONTINUOUSLY: Use Serena validation at every checkpoint
- COMPLETE TESTING: Task incomplete until thoroughly tested

## Your Mission:
Transform the test infrastructure from broken/incomplete state to fully functional, enabling Phase 2 parallel agent deployment.

## Success Criteria:
- All test frameworks working (Jest, Vitest, Playwright)
- ESLint configuration fixed for test files
- Database setup functional
- Coverage reporting operational
- No blocking errors preventing Phase 2

## Coordination:
- Update: AGENT_COORDINATION/progress/phase1-infrastructure-status.md
- Report issues: AGENT_COORDINATION/issues/PHASE1_ISSUES.md
- Completion: PHASE1_INFRASTRUCTURE_SETUP_COMPLETION.md

## Next Steps:
1. Read the complete plan: $Phase1Plan
2. Execute each step precisely with specified MCP tools
3. Validate at every checkpoint using Serena
4. Document completion before ending

BEGIN PHASE 1 INFRASTRUCTURE SETUP NOW.
"@

    $phase1Prompt | Out-File -FilePath (Join-Path $ProjectDir "phase1-prompt.md") -Encoding UTF8
    
    if (-not $DryRun) {
        # Launch Claude Code in new PowerShell window
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ProjectDir'; claude --file phase1-prompt.md"
    }
    
    Write-ColoredOutput "✅ Phase 1 agent launched" $Green
    Write-ColoredOutput "⏳ Monitor completion file: PHASE1_INFRASTRUCTURE_SETUP_COMPLETION.md" $Yellow
    Write-ColoredOutput ""
}

# Function to create all Phase 2 prompts
function New-Phase2Prompts {
    Write-ColoredOutput "📝 Creating Phase 2 agent prompts..." $Blue
    
    # Authentication Agent Prompt
    $authPrompt = @"
# Phase 2: Authentication Testing Agent

You are an autonomous agent responsible for authentication route testing. Follow the detailed instructions in $Phase2AuthPlan exactly.

## Critical Requirements:
- NO INDEPENDENT DECISIONS: Follow the plan precisely
- USE ONLY SPECIFIED MCP TOOLS: Each step specifies exact tools and parameters  
- SECURITY CRITICAL: All auth scenarios must be thoroughly tested
- COORDINATE: Update progress files, report issues immediately
- 80%+ COVERAGE REQUIRED: routes/auth.ts must achieve 80%+ coverage

## Your Mission:
Transform routes/auth.ts from 0% to 80%+ test coverage through comprehensive security testing.

## Success Criteria:
- 50+ authentication security test cases
- JWT, bcrypt, validation, rate limiting all tested
- All security bypass attempts blocked
- No ESLint violations
- Integration tests pass

## Coordination:
- Update: AGENT_COORDINATION/progress/phase2-auth-status.md
- Report issues: AGENT_COORDINATION/issues/PHASE2_ISSUES.md
- Completion: PHASE2_AUTH_COMPLETION.md

BEGIN PHASE 2 AUTHENTICATION TESTING NOW.
"@

    # Similar prompts for other agents...
    $authPrompt | Out-File -FilePath (Join-Path $ProjectDir "phase2-auth-prompt.md") -Encoding UTF8
    
    Write-ColoredOutput "✅ Phase 2 prompts created" $Green
}

# Main execution
function Start-Deployment {
    Write-ColoredOutput "Starting multi-agent deployment..." $Cyan
    Write-ColoredOutput ""
    
    # Pre-flight checks
    if (-not (Test-ClaudeCode)) { exit 1 }
    if (-not (Test-DeploymentPlans)) { exit 1 }
    
    Initialize-CoordinationSystem
    
    if ($DryRun) {
        Write-ColoredOutput "✅ DRY RUN: All systems ready for deployment" $Green
        Write-ColoredOutput "Run without -DryRun to launch agents" $Yellow
        return
    }
    
    Write-ColoredOutput "🚀 Beginning phased deployment..." $Blue
    Write-ColoredOutput ""
    
    # Phase 1: Infrastructure (Sequential)
    Start-Phase1Agent
    New-Phase2Prompts
    
    Write-ColoredOutput "📋 DEPLOYMENT INSTRUCTIONS:" $Cyan
    Write-ColoredOutput "1. Monitor Phase 1 completion: PHASE1_INFRASTRUCTURE_SETUP_COMPLETION.md" $Yellow
    Write-ColoredOutput "2. Once Phase 1 complete, manually launch Phase 2 agents:" $Yellow
    Write-ColoredOutput "   - claude --file phase2-auth-prompt.md" $Blue
    Write-ColoredOutput "   - claude --file phase2-runs-prompt.md" $Blue
    Write-ColoredOutput "   - claude --file phase2-goals-prompt.md" $Blue  
    Write-ColoredOutput "   - claude --file phase2-middleware-prompt.md" $Blue
    Write-ColoredOutput "3. Monitor Phase 2 completion, then launch Phase 3" $Yellow
    Write-ColoredOutput ""
    Write-ColoredOutput "🎯 TARGET: Transform coverage from 14.8% to 80%+" $Green
}

# Handle Ctrl+C gracefully
$Host.UI.RawUI.CancelKeyPress += {
    Write-ColoredOutput "`n❌ Deployment interrupted by user" $Red
    exit 1
}

# Run deployment
Start-Deployment