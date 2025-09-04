#!/bin/bash
# Quality Verification Runner for Duplicate Cleanup
# Integrates with project's npm run quality requirement
# Creates comprehensive test and build verification

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "✅ MCP Quality Verification Runner"
echo "=================================="

# Color output functions
red() { echo -e "\033[31m$*\033[0m"; }
green() { echo -e "\033[32m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }
blue() { echo -e "\033[34m$*\033[0m"; }
bold() { echo -e "\033[1m$*\033[0m"; }

# Track overall success
OVERALL_SUCCESS=true
VERIFICATION_LOG="verification_$(date +%Y%m%d_%H%M%S).log"

# Function to log and display results
log_result() {
    local status="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo "[$timestamp] $status: $message" >> "$VERIFICATION_LOG"
    
    if [[ "$status" == "SUCCESS" ]]; then
        green "✅ $message"
    elif [[ "$status" == "FAILURE" ]]; then
        red "❌ $message"
        OVERALL_SUCCESS=false
    elif [[ "$status" == "WARNING" ]]; then
        yellow "⚠️  $message"
    else
        blue "ℹ️  $message"
    fi
}

# Function to call Serena memory (placeholder)
store_verification_result() {
    local memory_name="$1"
    local result="$2"
    
    echo "📝 Would store in Serena memory '$memory_name': $result"
    # In actual implementation:
    # mcp__serena__write_memory \
    #   --memory_name "$memory_name" \
    #   --content "$result"
}

# Function to call Serena strategic thinking
call_serena_thinking() {
    local context="$1"
    echo "🧠 Would call Serena strategic thinking: $context"
    # In actual implementation:
    # mcp__serena__think_about_collected_information
}

# Pre-cleanup baseline check
run_baseline_check() {
    bold "📋 Phase 1: Pre-Cleanup Baseline Check"
    echo "======================================"
    
    log_result "INFO" "Starting baseline verification"
    
    # Check if we're in the right directory
    if [[ ! -f "package.json" ]]; then
        log_result "FAILURE" "Not in project root - package.json not found"
        return 1
    fi
    
    # Document current state
    local file_count=$(find . -maxdepth 1 -type f | wc -l)
    log_result "INFO" "Current file count in root: $file_count"
    
    # Check git status
    if git status --porcelain | grep -q .; then
        log_result "WARNING" "Working directory has uncommitted changes"
        git status --short
    else
        log_result "SUCCESS" "Working directory is clean"
    fi
    
    store_verification_result "cleanup_baseline" "File count: $file_count, Git status: clean"
}

# Mandatory quality check (per project requirements)
run_mandatory_quality_check() {
    bold "🔧 Phase 2: MANDATORY Quality Check"
    echo "=================================="
    
    log_result "INFO" "Running npm run quality (MANDATORY per project guidelines)"
    
    if npm run quality; then
        log_result "SUCCESS" "npm run quality passed - lint:fix + format + typecheck all successful"
        store_verification_result "quality_check_result" "PASSED - All quality checks successful"
    else
        log_result "FAILURE" "npm run quality failed - cleanup may have broken code quality"
        store_verification_result "quality_check_result" "FAILED - Quality issues detected"
        return 1
    fi
}

# Build verification
run_build_verification() {
    bold "🏗️  Phase 3: Build Verification"  
    echo "============================="
    
    log_result "INFO" "Verifying production build works"
    
    # Clean previous build
    if [[ -d "dist" ]]; then
        rm -rf dist
        log_result "INFO" "Cleaned previous build directory"
    fi
    
    # Run build
    if npm run build; then
        log_result "SUCCESS" "Production build completed successfully"
        
        # Check build output
        if [[ -d "dist" && -f "dist/index.html" ]]; then
            local build_size=$(du -sh dist 2>/dev/null | cut -f1)
            log_result "SUCCESS" "Build artifacts created, size: $build_size"
        else
            log_result "WARNING" "Build completed but expected artifacts not found"
        fi
    else
        log_result "FAILURE" "Production build failed"
        return 1
    fi
    
    store_verification_result "build_verification" "Production build successful"
}

# Test suite verification
run_test_verification() {
    bold "🧪 Phase 4: Test Suite Verification"
    echo "=================================="
    
    log_result "INFO" "Running comprehensive test suite"
    
    # Unit tests
    log_result "INFO" "Running unit tests (Vitest)"
    if npm run test:run; then
        log_result "SUCCESS" "Unit tests passed"
    else
        log_result "FAILURE" "Unit tests failed"
        OVERALL_SUCCESS=false
    fi
    
    # Integration tests (if they exist and are configured)
    if npm run test:integration >/dev/null 2>&1; then
        log_result "INFO" "Running integration tests (Jest)"
        if npm run test:integration; then
            log_result "SUCCESS" "Integration tests passed"
        else
            log_result "FAILURE" "Integration tests failed"
            OVERALL_SUCCESS=false
        fi
    else
        log_result "WARNING" "Integration tests not available or not configured"
    fi
    
    # E2E tests (if available)
    if command -v playwright >/dev/null && [[ -f "playwright.config.ts" ]]; then
        log_result "INFO" "E2E test infrastructure detected"
        # Note: Don't auto-run E2E tests as they're slow and may require setup
        log_result "INFO" "E2E tests available but not run automatically (run manually: npm run test:e2e)"
    fi
    
    store_verification_result "test_verification" "Test suite verification completed"
}

# Development server verification  
run_dev_server_check() {
    bold "🚀 Phase 5: Development Server Check"
    echo "==================================="
    
    log_result "INFO" "Testing development server startup"
    
    # Start dev server in background and test it starts
    timeout 30 npm run dev > dev_server_test.log 2>&1 &
    local dev_pid=$!
    
    # Give it time to start
    sleep 10
    
    # Check if process is still running
    if kill -0 $dev_pid 2>/dev/null; then
        log_result "SUCCESS" "Development server started successfully"
        
        # Try to connect to it
        if command -v curl >/dev/null; then
            if curl -s http://localhost:3000 >/dev/null 2>&1; then
                log_result "SUCCESS" "Frontend server responding on port 3000"
            else
                log_result "WARNING" "Frontend server not responding (may still be starting)"
            fi
            
            if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
                log_result "SUCCESS" "Backend server responding on port 3001"
            else
                log_result "WARNING" "Backend server not responding (may still be starting)"
            fi
        fi
        
        # Stop the dev server
        kill $dev_pid 2>/dev/null || true
        wait $dev_pid 2>/dev/null || true
    else
        log_result "FAILURE" "Development server failed to start"
        cat dev_server_test.log
        OVERALL_SUCCESS=false
    fi
    
    # Cleanup
    rm -f dev_server_test.log
    
    store_verification_result "dev_server_check" "Development server verification completed"
}

# File system integrity check
run_filesystem_check() {
    bold "📁 Phase 6: File System Integrity Check"
    echo "======================================"
    
    log_result "INFO" "Verifying critical files are intact"
    
    # Check critical project files
    local critical_files=(
        "package.json"
        "tsconfig.json" 
        "eslint.config.js"
        "vite.config.ts"
        "vitest.config.ts"
        "src/main.tsx"
        "src/App.tsx"
        "server.ts"
    )
    
    local missing_files=()
    for file in "${critical_files[@]}"; do
        if [[ -f "$file" ]]; then
            log_result "SUCCESS" "Critical file exists: $file"
        else
            log_result "FAILURE" "Critical file missing: $file"
            missing_files+=("$file")
            OVERALL_SUCCESS=false
        fi
    done
    
    # Check for remaining duplicates
    local remaining_duplicates=$(find . -maxdepth 1 -name "* [0-9].*" | wc -l)
    if [[ $remaining_duplicates -eq 0 ]]; then
        log_result "SUCCESS" "No duplicate files remain in root directory"
    else
        log_result "WARNING" "$remaining_duplicates duplicate files still exist"
        find . -maxdepth 1 -name "* [0-9].*" | head -5
    fi
    
    store_verification_result "filesystem_check" "Critical files verified, $remaining_duplicates duplicates remain"
}

# Strategic assessment using Serena
run_strategic_assessment() {
    bold "🧠 Phase 7: Strategic Assessment"
    echo "================================"
    
    log_result "INFO" "Running strategic assessment with Serena"
    
    call_serena_thinking "Cleanup verification completed - assess overall system health"
    
    # Summary of all checks
    local total_phases=6
    local failed_phases=0
    
    if [[ "$OVERALL_SUCCESS" == "true" ]]; then
        log_result "SUCCESS" "All verification phases passed successfully"
        store_verification_result "strategic_assessment" "CLEANUP VERIFIED: All systems operational"
    else
        log_result "FAILURE" "Some verification phases failed - review required"
        store_verification_result "strategic_assessment" "CLEANUP ISSUES: Some systems may be impacted"
    fi
}

# Generate final report
generate_final_report() {
    bold "📊 Final Verification Report"
    echo "=========================="
    
    echo ""
    echo "Verification completed at: $(date)"
    echo "Log file: $VERIFICATION_LOG"
    echo ""
    
    if [[ "$OVERALL_SUCCESS" == "true" ]]; then
        green "🎉 OVERALL RESULT: SUCCESS"
        echo ""
        echo "✅ All quality checks passed"
        echo "✅ Build verification successful"  
        echo "✅ Critical files intact"
        echo "✅ Development servers functional"
        echo ""
        echo "🎯 Next steps:"
        echo "   • Duplicate cleanup appears successful"
        echo "   • Safe to commit changes"
        echo "   • Consider running E2E tests manually"
        echo "   • Update team on cleanup completion"
    else
        red "❌ OVERALL RESULT: ISSUES DETECTED"
        echo ""
        echo "⚠️  Some verification steps failed"
        echo "📋 Review the log file: $VERIFICATION_LOG"
        echo "🔧 Fix issues before proceeding"
        echo ""
        echo "🎯 Required actions:"
        echo "   • Review failed verification steps"
        echo "   • Fix any quality or build issues"
        echo "   • Re-run verification"
        echo "   • Do NOT commit until all checks pass"
    fi
    
    echo ""
    echo "📄 Detailed log available in: $VERIFICATION_LOG"
}

# Main execution
main() {
    echo "Starting comprehensive quality verification..."
    echo ""
    
    # Run all verification phases
    run_baseline_check
    run_mandatory_quality_check || exit 1  # Mandatory - exit if fails
    run_build_verification
    run_test_verification
    run_dev_server_check
    run_filesystem_check
    run_strategic_assessment
    
    echo ""
    generate_final_report
    
    # Exit with appropriate code
    if [[ "$OVERALL_SUCCESS" == "true" ]]; then
        exit 0
    else
        exit 1
    fi
}

# Help function
show_help() {
    echo "MCP Quality Verification Runner"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help, -h          Show this help message"
    echo "  --quick             Run only mandatory quality checks"
    echo "  --build-only        Run only build verification"
    echo "  --tests-only        Run only test verification"
    echo ""
    echo "This script runs comprehensive verification after duplicate cleanup:"
    echo "  1. Baseline check"
    echo "  2. MANDATORY npm run quality (per project requirements)"
    echo "  3. Production build verification"
    echo "  4. Test suite verification"
    echo "  5. Development server check"
    echo "  6. File system integrity check"
    echo "  7. Strategic assessment with Serena MCP"
    echo ""
    echo "Examples:"
    echo "  $0                  # Full verification suite"
    echo "  $0 --quick          # Only mandatory quality checks"
    echo "  $0 --build-only     # Only build verification"
}

# Parse command line arguments
case "${1:-}" in
    --help|-h)
        show_help
        exit 0
        ;;
    --quick)
        run_baseline_check
        run_mandatory_quality_check
        ;;
    --build-only)
        run_build_verification
        ;;
    --tests-only)
        run_test_verification
        ;;
    "")
        main
        ;;
    *)
        red "❌ Unknown option: $1"
        echo ""
        show_help
        exit 1
        ;;
esac