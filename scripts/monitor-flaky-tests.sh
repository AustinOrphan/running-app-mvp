#!/bin/bash

# Local Flaky Test Monitoring Script
# This script runs tests multiple times locally to detect flaky tests
# Usage: ./scripts/monitor-flaky-tests.sh [test-type] [runs]

set -euo pipefail

# Configuration
TEST_TYPE="${1:-all}"
NUM_RUNS="${2:-5}"
RESULTS_DIR="./test-flakiness-results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Starting Flaky Test Monitoring${NC}"
echo "Test Type: $TEST_TYPE"
echo "Number of Runs: $NUM_RUNS"
echo "Results Directory: $RESULTS_DIR"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Function to run a specific test type
run_test_type() {
    local test_type="$1"
    local run_number="$2"
    local run_dir="$RESULTS_DIR/run-$run_number"
    
    mkdir -p "$run_dir"
    
    echo -e "${YELLOW}📊 Run $run_number: Running $test_type tests...${NC}"
    
    case "$test_type" in
        "unit")
            npm run test:run 2>&1 | tee "$run_dir/unit-output.log"
            echo $? > "$run_dir/unit-exit-code.txt"
            ;;
        "integration")
            npm run test:integration 2>&1 | tee "$run_dir/integration-output.log"
            echo $? > "$run_dir/integration-exit-code.txt"
            ;;
        "e2e")
            npm run test:e2e 2>&1 | tee "$run_dir/e2e-output.log"
            echo $? > "$run_dir/e2e-exit-code.txt"
            ;;
        "accessibility")
            npm run test:a11y 2>&1 | tee "$run_dir/a11y-output.log"
            echo $? > "$run_dir/a11y-exit-code.txt"
            ;;
        "all")
            echo "  Running unit tests..."
            npm run test:run 2>&1 | tee "$run_dir/unit-output.log" || true
            echo $? > "$run_dir/unit-exit-code.txt"
            
            echo "  Running integration tests..."
            npm run test:integration 2>&1 | tee "$run_dir/integration-output.log" || true
            echo $? > "$run_dir/integration-exit-code.txt"
            
            echo "  Running E2E tests..."
            npm run test:e2e 2>&1 | tee "$run_dir/e2e-output.log" || true
            echo $? > "$run_dir/e2e-exit-code.txt"
            
            echo "  Running accessibility tests..."
            npm run test:a11y 2>&1 | tee "$run_dir/a11y-output.log" || true
            echo $? > "$run_dir/a11y-exit-code.txt"
            ;;
        *)
            echo -e "${RED}❌ Unknown test type: $test_type${NC}"
            exit 1
            ;;
    esac
}

# Function to analyze results
analyze_results() {
    echo -e "${BLUE}📊 Analyzing test results for flakiness...${NC}"
    
    local flaky_tests=()
    local analysis_file="$RESULTS_DIR/flakiness-analysis-$TIMESTAMP.md"
    
    echo "# Flaky Test Analysis Report" > "$analysis_file"
    echo "Generated: $(date)" >> "$analysis_file"
    echo "Test Type: $TEST_TYPE" >> "$analysis_file"
    echo "Number of Runs: $NUM_RUNS" >> "$analysis_file"
    echo "" >> "$analysis_file"
    
    # Analyze exit codes for each test type
    for test_suite in unit integration e2e a11y; do
        local results=()
        local has_results=false
        
        echo "## $test_suite Tests" >> "$analysis_file"
        
        for ((i=1; i<=NUM_RUNS; i++)); do
            local exit_code_file="$RESULTS_DIR/run-$i/${test_suite}-exit-code.txt"
            if [[ -f "$exit_code_file" ]]; then
                local exit_code=$(cat "$exit_code_file")
                results+=("$exit_code")
                has_results=true
            fi
        done
        
        if [[ "$has_results" == true ]]; then
            local pass_count=0
            local fail_count=0
            
            for result in "${results[@]}"; do
                if [[ "$result" == "0" ]]; then
                    ((pass_count++))
                else
                    ((fail_count++))
                fi
            done
            
            local total_runs=${#results[@]}
            local pass_rate=$(( (pass_count * 100) / total_runs ))
            
            echo "- Total runs: $total_runs" >> "$analysis_file"
            echo "- Passes: $pass_count" >> "$analysis_file"
            echo "- Failures: $fail_count" >> "$analysis_file"
            echo "- Pass rate: $pass_rate%" >> "$analysis_file"
            
            # Check for flakiness (not all pass, not all fail)
            if [[ $pass_count -gt 0 && $fail_count -gt 0 ]]; then
                echo -e "${RED}⚠️  FLAKY: $test_suite tests${NC}"
                echo "- **STATUS: FLAKY** ⚠️" >> "$analysis_file"
                flaky_tests+=("$test_suite")
            elif [[ $pass_count -eq $total_runs ]]; then
                echo -e "${GREEN}✅ STABLE: $test_suite tests (all passed)${NC}"
                echo "- **STATUS: STABLE** ✅" >> "$analysis_file"
            elif [[ $fail_count -eq $total_runs ]]; then
                echo -e "${RED}❌ CONSISTENTLY FAILING: $test_suite tests${NC}"
                echo "- **STATUS: CONSISTENTLY FAILING** ❌" >> "$analysis_file"
            fi
        else
            echo "- No results found" >> "$analysis_file"
        fi
        
        echo "" >> "$analysis_file"
    done
    
    # Summary
    echo "## Summary" >> "$analysis_file"
    if [[ ${#flaky_tests[@]} -gt 0 ]]; then
        echo -e "${RED}❌ FLAKY TESTS DETECTED!${NC}"
        echo "Flaky test suites found:" >> "$analysis_file"
        for flaky in "${flaky_tests[@]}"; do
            echo "- $flaky" >> "$analysis_file"
            echo -e "  ${RED}  - $flaky${NC}"
        done
        echo "" >> "$analysis_file"
        echo "## Recommended Actions" >> "$analysis_file"
        echo "1. Investigate the flaky test suites listed above" >> "$analysis_file"
        echo "2. Look for timing issues, race conditions, or environmental dependencies" >> "$analysis_file"
        echo "3. Add proper wait conditions and assertions" >> "$analysis_file"
        echo "4. Consider marking very flaky tests as skip until fixed" >> "$analysis_file"
    else
        echo -e "${GREEN}✅ No flaky tests detected!${NC}"
        echo "No flaky tests detected across $NUM_RUNS runs." >> "$analysis_file"
        echo "All test suites showed consistent results." >> "$analysis_file"
    fi
    
    echo ""
    echo -e "${BLUE}📄 Full analysis saved to: $analysis_file${NC}"
    
    # Display quick summary
    echo ""
    echo -e "${BLUE}📊 Quick Summary:${NC}"
    cat "$analysis_file" | grep -E "^## |^- \*\*STATUS:" | sed 's/^## /  /' | sed 's/^- \*\*STATUS: /    /'
}

# Function to show detailed failure information
show_failure_details() {
    if [[ ${#flaky_tests[@]} -gt 0 ]]; then
        echo -e "${YELLOW}🔍 Detailed failure analysis:${NC}"
        
        for test_suite in "${flaky_tests[@]}"; do
            echo ""
            echo -e "${YELLOW}--- $test_suite Test Failures ---${NC}"
            
            for ((i=1; i<=NUM_RUNS; i++)); do
                local output_file="$RESULTS_DIR/run-$i/${test_suite}-output.log"
                local exit_code_file="$RESULTS_DIR/run-$i/${test_suite}-exit-code.txt"
                
                if [[ -f "$exit_code_file" ]]; then
                    local exit_code=$(cat "$exit_code_file")
                    if [[ "$exit_code" != "0" ]]; then
                        echo -e "${RED}Run $i (failed):${NC}"
                        if [[ -f "$output_file" ]]; then
                            # Show last 10 lines of failure
                            tail -n 10 "$output_file" | sed 's/^/  /'
                        fi
                        echo ""
                    fi
                fi
            done
        done
    fi
}

# Main execution
echo -e "${BLUE}🚀 Starting $NUM_RUNS test runs...${NC}"

# Run tests multiple times
for ((i=1; i<=NUM_RUNS; i++)); do
    echo ""
    echo -e "${BLUE}======== Run $i of $NUM_RUNS ========${NC}"
    run_test_type "$TEST_TYPE" "$i"
    
    # Brief pause between runs to avoid resource conflicts
    if [[ $i -lt $NUM_RUNS ]]; then
        echo -e "${YELLOW}⏸️  Pausing for 5 seconds before next run...${NC}"
        sleep 5
    fi
done

echo ""
echo -e "${BLUE}✅ All test runs completed!${NC}"

# Analyze results
analyze_results

# Clean up old results (keep last 5 analysis files)
find "$RESULTS_DIR" -name "flakiness-analysis-*.md" -type f | sort | head -n -5 | xargs rm -f 2>/dev/null || true

echo ""
echo -e "${GREEN}🎉 Flaky test monitoring complete!${NC}"
echo -e "Results stored in: ${BLUE}$RESULTS_DIR${NC}"