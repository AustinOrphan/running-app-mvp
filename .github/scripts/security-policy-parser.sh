#!/bin/bash

# Security Policy Parser
# This script reads the security-policy.yml file and provides configuration values
# for use in GitHub Actions workflows.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="${SCRIPT_DIR}/../security-policy.yml"

# Check if yq is available, install if needed
if ! command -v yq &> /dev/null; then
    echo "Installing yq..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        wget -qO /tmp/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64
        chmod +x /tmp/yq
        sudo mv /tmp/yq /usr/local/bin/yq
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install yq
        else
            wget -qO /tmp/yq https://github.com/mikefarah/yq/releases/latest/download/yq_darwin_amd64
            chmod +x /tmp/yq
            sudo mv /tmp/yq /usr/local/bin/yq
        fi
    else
        echo "Unsupported OS for automatic yq installation"
        exit 1
    fi
fi

# Function to get a configuration value from the policy file
get_config() {
    local key="$1"
    local default_value="${2:-}"
    
    if [[ ! -f "$POLICY_FILE" ]]; then
        echo "Security policy file not found: $POLICY_FILE" >&2
        if [[ -n "$default_value" ]]; then
            echo "$default_value"
            return 0
        else
            exit 1
        fi
    fi
    
    local value
    value=$(yq eval "$key" "$POLICY_FILE" 2>/dev/null || echo "null")
    
    if [[ "$value" == "null" ]] || [[ -z "$value" ]]; then
        if [[ -n "$default_value" ]]; then
            echo "$default_value"
        else
            echo "null"
        fi
    else
        echo "$value"
    fi
}

# Function to check if a vulnerability is allowed
is_vulnerability_allowed() {
    local vuln_id="$1"
    local tool="${2:-}"
    
    if [[ ! -f "$POLICY_FILE" ]]; then
        echo "false"
        return 0
    fi
    
    # Check if vulnerability is in allowed list
    local allowed_vulns
    allowed_vulns=$(yq eval '.allowed_vulnerabilities[]' "$POLICY_FILE" 2>/dev/null || echo "")
    
    if [[ -z "$allowed_vulns" ]]; then
        echo "false"
        return 0
    fi
    
    while IFS= read -r line; do
        if [[ -n "$line" ]] && [[ "$line" != "null" ]]; then
            local vuln_data="$line"
            local id
            local vuln_tool
            local expires
            
            id=$(echo "$vuln_data" | yq eval '.id' - 2>/dev/null || echo "")
            vuln_tool=$(echo "$vuln_data" | yq eval '.tool' - 2>/dev/null || echo "")
            expires=$(echo "$vuln_data" | yq eval '.expires' - 2>/dev/null || echo "")
            
            # Check if this is the vulnerability we're looking for
            if [[ "$id" == "$vuln_id" ]]; then
                # Check tool match if specified
                if [[ -n "$tool" ]] && [[ -n "$vuln_tool" ]] && [[ "$vuln_tool" != "$tool" ]]; then
                    continue
                fi
                
                # Check expiry date if specified
                if [[ -n "$expires" ]] && [[ "$expires" != "null" ]]; then
                    local current_date
                    current_date=$(date +%Y-%m-%d)
                    if [[ "$expires" < "$current_date" ]]; then
                        echo "false"  # Expired exception
                        return 0
                    fi
                fi
                
                echo "true"
                return 0
            fi
        fi
    done <<< "$allowed_vulns"
    
    echo "false"
}

# Function to get severity threshold for a tool
get_severity_threshold() {
    local tool="${1:-}"
    local default_threshold="${2:-high}"
    
    if [[ -n "$tool" ]]; then
        # Check tool-specific threshold first
        local tool_threshold
        tool_threshold=$(get_config ".tools.${tool}.fail_on_severity" "")
        if [[ -n "$tool_threshold" ]] && [[ "$tool_threshold" != "null" ]]; then
            echo "$tool_threshold"
            return 0
        fi
    fi
    
    # Fall back to global threshold
    local global_threshold
    global_threshold=$(get_config ".severity_thresholds.fail_on_severity" "$default_threshold")
    echo "$global_threshold"
}

# Function to convert severity to numeric value for comparison
severity_to_number() {
    local severity="$1"
    case "$severity" in
        "critical") echo 4 ;;
        "high") echo 3 ;;
        "medium") echo 2 ;;
        "low") echo 1 ;;
        *) echo 0 ;;
    esac
}

# Function to check if severity meets threshold
should_fail_on_severity() {
    local found_severity="$1"
    local threshold="${2:-high}"
    
    local found_num
    local threshold_num
    
    found_num=$(severity_to_number "$found_severity")
    threshold_num=$(severity_to_number "$threshold")
    
    if [[ $found_num -ge $threshold_num ]]; then
        echo "true"
    else
        echo "false"
    fi
}

# Function to generate security summary based on policy
generate_security_summary() {
    local critical_count="${1:-0}"
    local high_count="${2:-0}"
    local medium_count="${3:-0}"
    local low_count="${4:-0}"
    local tool="${5:-}"
    
    local threshold
    threshold=$(get_severity_threshold "$tool" "high")
    
    echo "## Security Scan Results Summary"
    echo ""
    echo "**Vulnerability Counts:**"
    echo "- Critical: $critical_count"
    echo "- High: $high_count"
    echo "- Medium: $medium_count"
    echo "- Low: $low_count"
    echo ""
    echo "**Policy Configuration:**"
    echo "- Fail threshold: $threshold"
    echo "- Tool: ${tool:-global}"
    
    # Determine if we should fail
    local should_fail=false
    
    case "$threshold" in
        "critical")
            if [[ $critical_count -gt 0 ]]; then should_fail=true; fi
            ;;
        "high")
            if [[ $critical_count -gt 0 ]] || [[ $high_count -gt 0 ]]; then should_fail=true; fi
            ;;
        "medium")
            if [[ $critical_count -gt 0 ]] || [[ $high_count -gt 0 ]] || [[ $medium_count -gt 0 ]]; then should_fail=true; fi
            ;;
        "low")
            if [[ $critical_count -gt 0 ]] || [[ $high_count -gt 0 ]] || [[ $medium_count -gt 0 ]] || [[ $low_count -gt 0 ]]; then should_fail=true; fi
            ;;
    esac
    
    echo ""
    if [[ "$should_fail" == "true" ]]; then
        echo "**Status: ❌ FAIL** - Vulnerabilities found above threshold"
        echo "SECURITY_CHECK_RESULT=fail" >> $GITHUB_ENV
    else
        echo "**Status: ✅ PASS** - No vulnerabilities above threshold"
        echo "SECURITY_CHECK_RESULT=pass" >> $GITHUB_ENV
    fi
}

# Main command handling
case "${1:-help}" in
    "get")
        get_config "$2" "${3:-}"
        ;;
    "get-threshold")
        get_severity_threshold "$2" "${3:-high}"
        ;;
    "check-allowed")
        is_vulnerability_allowed "$2" "${3:-}"
        ;;
    "should-fail")
        should_fail_on_severity "$2" "$3"
        ;;
    "summary")
        generate_security_summary "$2" "$3" "$4" "$5" "$6"
        ;;
    "help"|*)
        echo "Security Policy Parser"
        echo ""
        echo "Usage: $0 <command> [arguments]"
        echo ""
        echo "Commands:"
        echo "  get <key> [default]              Get a configuration value"
        echo "  get-threshold <tool> [default]   Get severity threshold for tool"
        echo "  check-allowed <vuln-id> [tool]   Check if vulnerability is allowed"
        echo "  should-fail <severity> <threshold> Check if severity should fail"
        echo "  summary <critical> <high> <medium> <low> [tool] Generate summary"
        echo "  help                             Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 get .severity_thresholds.fail_on_severity"
        echo "  $0 get-threshold npm_audit"
        echo "  $0 check-allowed SNYK-JS-LODASH-567746 snyk"
        echo "  $0 should-fail high medium"
        echo "  $0 summary 0 2 5 10 npm_audit"
        ;;
esac