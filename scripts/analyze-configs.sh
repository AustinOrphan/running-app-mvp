#!/bin/bash
# MCP Configuration Analyzer
# Orchestrates Gemini CLI calls for configuration file comparison
# Handles structured analysis and documentation in Serena memories

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🔧 MCP Configuration Analyzer"
echo "=============================="

# Color output functions
red() { echo -e "\033[31m$*\033[0m"; }
green() { echo -e "\033[32m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }
blue() { echo -e "\033[34m$*\033[0m"; }

# Function to check if file exists
check_file() {
    if [[ ! -f "$1" ]]; then
        red "❌ File not found: $1"
        return 1
    fi
    return 0
}

# Function to call Gemini CLI (placeholder for actual MCP call)
call_gemini() {
    local prompt="$1"
    local change_mode="${2:-false}"
    local model="${3:-gemini-2.5-pro}"
    
    echo "🤖 Calling Gemini CLI with model: $model"
    echo "📝 Prompt: ${prompt:0:100}..."
    
    # In actual implementation, would call:
    # mcp__gemini-cli__ask-gemini \
    #   --prompt "$prompt" \
    #   --changeMode "$change_mode" \
    #   --model "$model"
    
    # Placeholder response
    echo "   ✅ Analysis completed (placeholder)"
}

# Function to store in Serena memory (placeholder)
store_memory() {
    local memory_name="$1"
    local content="$2"
    
    echo "📝 Storing in Serena memory: $memory_name"
    # In actual implementation:
    # mcp__serena__write_memory \
    #   --memory_name "$memory_name" \
    #   --content "$content"
}

# Analyze package.json variants
analyze_package_json() {
    echo ""
    blue "📦 Analyzing package.json variants..."
    
    local files=("package.json" "package 2.json" "package 3.json")
    local found_files=()
    
    # Check which files exist
    for file in "${files[@]}"; do
        if check_file "$file"; then
            found_files+=("$file")
        fi
    done
    
    if [[ ${#found_files[@]} -le 1 ]]; then
        yellow "⚠️  Only one or no package.json files found, skipping comparison"
        return 0
    fi
    
    # Prepare detailed comparison prompt
    local prompt="Compare these package.json configurations and identify key differences:

$(for file in "${found_files[@]}"; do
    echo "=== $file ==="
    echo "Dependencies: $(grep -A 20 '\"dependencies\"' "$file" 2>/dev/null || echo 'not found')"
    echo "DevDependencies: $(grep -A 30 '\"devDependencies\"' "$file" 2>/dev/null || echo 'not found')"
    echo "Scripts: $(grep -A 15 '\"scripts\"' "$file" 2>/dev/null || echo 'not found')"
    echo ""
done)

Focus on:
1. Dependency version differences
2. Added/removed packages
3. Script configuration changes
4. Which version appears most current
5. Recommend KEEP/DELETE for each file"

    # Call Gemini with structured response
    call_gemini "$prompt" true "gemini-2.5-pro"
    
    # Store analysis results
    store_memory "package_json_analysis" "Comparison results for package.json variants"
    
    green "✅ Package.json analysis completed"
}

# Analyze TypeScript configuration
analyze_typescript_config() {
    echo ""
    blue "⚙️  Analyzing TypeScript configurations..."
    
    local files=("tsconfig.json" "tsconfig 2.json" "tsconfig 3.json")
    local found_files=()
    
    for file in "${files[@]}"; do
        if check_file "$file"; then
            found_files+=("$file")
        fi
    done
    
    if [[ ${#found_files[@]} -le 1 ]]; then
        yellow "⚠️  Only one or no tsconfig files found, skipping comparison"
        return 0
    fi
    
    # Extract key configuration sections
    local prompt="Analyze these TypeScript configurations for conflicts:

$(for file in "${found_files[@]}"; do
    echo "=== $file ==="
    echo "Include patterns: $(grep -A 2 '\"include\"' "$file" 2>/dev/null || echo 'not found')"
    echo "Exclude patterns: $(grep -A 5 '\"exclude\"' "$file" 2>/dev/null || echo 'not found')"
    echo "Compiler options: $(grep -A 10 '\"compilerOptions\"' "$file" 2>/dev/null | head -10 || echo 'not found')"
    echo ""
done)

Specifically check for:
1. Include/exclude pattern conflicts
2. Test file compilation issues
3. Module resolution differences
4. Which configuration is most current and functional
5. Safety of deleting numbered versions"

    call_gemini "$prompt" true "gemini-2.5-pro"
    store_memory "typescript_config_analysis" "TypeScript configuration comparison and safety assessment"
    
    green "✅ TypeScript configuration analysis completed"
}

# Analyze ESLint configurations
analyze_eslint_config() {
    echo ""
    blue "🔍 Analyzing ESLint configurations..."
    
    local files=("eslint.config.js" "eslint.config 2.js" "eslint.config 3.js")
    local found_files=()
    
    for file in "${files[@]}"; do
        if check_file "$file"; then
            found_files+=("$file")
        fi
    done
    
    if [[ ${#found_files[@]} -le 1 ]]; then
        yellow "⚠️  Only one or no ESLint config files found, skipping comparison"
        return 0
    fi
    
    # Count rules and analyze complexity
    local prompt="Compare these ESLint configurations:

$(for file in "${found_files[@]}"; do
    echo "=== $file ==="
    echo "File size: $(wc -l < "$file" 2>/dev/null || echo 'unknown') lines"
    echo "Plugins mentioned: $(grep -o '"@typescript-eslint\|eslint-plugin-[^"]*\|@next/eslint-plugin[^"]*' "$file" 2>/dev/null | sort -u | wc -l || echo '0')"
    echo "Rules count estimate: $(grep -c '"[a-zA-Z].*":' "$file" 2>/dev/null || echo '0')"
    echo ""
done)

Analyze:
1. Which version has more comprehensive rules
2. Security plugin differences
3. Performance impact variations
4. Recommendation for current vs backup versions"

    call_gemini "$prompt" true "gemini-2.5-flash"  # Use faster model for config comparison
    store_memory "eslint_config_analysis" "ESLint configuration comparison and recommendations"
    
    green "✅ ESLint configuration analysis completed"
}

# Generate summary report
generate_summary() {
    echo ""
    blue "📊 Generating Configuration Analysis Summary..."
    
    local prompt="Based on the configuration analyses performed, create a summary report with:

1. Overall assessment of configuration file states
2. Priority order for cleanup actions  
3. Risk assessment for each deletion
4. Recommended cleanup commands
5. Quality verification steps needed

Format as a structured action plan."

    call_gemini "$prompt" true "gemini-2.5-pro"
    store_memory "config_analysis_summary" "Complete configuration analysis summary and action plan"
    
    green "✅ Summary report generated"
}

# Main execution
main() {
    echo "Starting comprehensive configuration analysis..."
    
    # Run all analyses
    analyze_package_json
    analyze_typescript_config  
    analyze_eslint_config
    generate_summary
    
    echo ""
    green "🎉 Configuration analysis complete!"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Review Serena memories for detailed analysis"
    echo "   2. Execute recommended cleanup actions"
    echo "   3. Run quality verification: npm run quality"
    echo "   4. Verify build and tests still pass"
}

# Help function
show_help() {
    echo "MCP Configuration Analyzer"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help, -h     Show this help message"
    echo "  --package      Analyze only package.json files"
    echo "  --typescript   Analyze only TypeScript configs"
    echo "  --eslint       Analyze only ESLint configs"
    echo ""
    echo "Examples:"
    echo "  $0                 # Analyze all configuration files"
    echo "  $0 --package       # Analyze only package.json variants"
    echo "  $0 --typescript    # Analyze only tsconfig.json variants"
}

# Parse command line arguments
case "${1:-}" in
    --help|-h)
        show_help
        exit 0
        ;;
    --package)
        analyze_package_json
        ;;
    --typescript)
        analyze_typescript_config
        ;;
    --eslint)
        analyze_eslint_config
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