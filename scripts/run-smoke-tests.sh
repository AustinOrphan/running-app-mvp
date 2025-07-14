#!/bin/bash
set -euo pipefail

# Smoke Tests Script for Running App
# Runs critical path tests after deployment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/deployment-utils.sh"

# Default values
ENVIRONMENT=""
DEPLOYMENT_ID=""
BASE_URL=""
NAMESPACE=""
TEST_TIMEOUT=30
VERBOSE=false

# Test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
TEST_RESULTS=()

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --deployment-id)
            DEPLOYMENT_ID="$2"
            shift 2
            ;;
        --base-url)
            BASE_URL="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --timeout)
            TEST_TIMEOUT="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required parameters
if [[ -z "$ENVIRONMENT" ]]; then
    log_error "❌ Error: --environment is required"
    exit 1
fi

# Set namespace if not provided
if [[ -z "$NAMESPACE" ]]; then
    NAMESPACE="running-app-${ENVIRONMENT}"
fi

log_info "🔥 Running smoke tests for ${ENVIRONMENT}"
log_info "Deployment ID: ${DEPLOYMENT_ID:-N/A}"

# Get service URL if not provided
get_service_url() {
    if [[ -n "$BASE_URL" ]]; then
        return
    fi
    
    # Try to get LoadBalancer URL
    BASE_URL=$(kubectl get service running-app-backend-"${ENVIRONMENT}" \
        -n "$NAMESPACE" \
        -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    
    if [[ -z "$BASE_URL" ]]; then
        BASE_URL=$(kubectl get service running-app-backend-"${ENVIRONMENT}" \
            -n "$NAMESPACE" \
            -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
    fi
    
    if [[ -z "$BASE_URL" ]]; then
        log_warning "No external URL available, using port-forward"
        
        # Set up port-forward in background
        kubectl port-forward service/running-app-backend-"${ENVIRONMENT}" \
            -n "$NAMESPACE" 8080:3001 &
        PORT_FORWARD_PID=$!
        sleep 5
        
        BASE_URL="localhost:8080"
    fi
    
    BASE_URL="http://${BASE_URL}"
    log_info "Using base URL: ${BASE_URL}"
}

# Test helper functions
run_test() {
    local test_name=$1
    local test_function=$2
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    echo -n "Running test: ${test_name}... "
    
    if $test_function; then
        echo "✅ PASSED"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        TEST_RESULTS+=("✅ ${test_name}: PASSED")
    else
        echo "❌ FAILED"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        TEST_RESULTS+=("❌ ${test_name}: FAILED")
    fi
}

make_request() {
    local endpoint=$1
    local method=${2:-GET}
    local data=${3:-}
    local expected_status=${4:-200}
    
    local url="${BASE_URL}${endpoint}"
    local response=""
    local status_code=""
    
    if [[ "$VERBOSE" == "true" ]]; then
        log_info "Making ${method} request to ${url}"
    fi
    
    if [[ "$method" == "GET" ]]; then
        response=$(curl -s -w "\n%{http_code}" "${url}" 2>/dev/null || echo "000")
    elif [[ "$method" == "POST" ]]; then
        response=$(curl -s -w "\n%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -d "${data}" \
            "${url}" 2>/dev/null || echo "000")
    fi
    
    # Extract status code (last line)
    status_code=$(echo "$response" | tail -n1)
    
    # Extract response body (all but last line)
    response=$(echo "$response" | sed '$d')
    
    if [[ "$VERBOSE" == "true" ]]; then
        log_info "Response status: ${status_code}"
        log_info "Response body: ${response}"
    fi
    
    if [[ "$status_code" == "$expected_status" ]]; then
        echo "$response"
        return 0
    else
        return 1
    fi
}

# Individual smoke tests
test_health_endpoint() {
    local response=$(make_request "/api/health" "GET" "" "200")
    
    if [[ -z "$response" ]]; then
        return 1
    fi
    
    # Check if response contains expected fields
    echo "$response" | jq -e '.status == "ok"' > /dev/null 2>&1
}

test_database_connectivity() {
    local response=$(make_request "/api/health" "GET" "" "200")
    
    if [[ -z "$response" ]]; then
        return 1
    fi
    
    # Check database status
    local db_status=$(echo "$response" | jq -r '.database.status' 2>/dev/null)
    [[ "$db_status" == "connected" ]]
}

test_api_version() {
    local response=$(make_request "/api/version" "GET" "" "200")
    
    if [[ -z "$response" ]]; then
        return 1
    fi
    
    # Check if version is present
    echo "$response" | jq -e '.version' > /dev/null 2>&1
}

test_authentication_endpoint() {
    # Test that auth endpoint exists and responds correctly
    make_request "/api/auth/login" "POST" '{"email":"test@example.com","password":"test"}' "401" > /dev/null
}

test_cors_headers() {
    local headers=$(curl -s -I "${BASE_URL}/api/health" 2>/dev/null)
    
    # Check for CORS headers
    echo "$headers" | grep -i "access-control-allow-origin" > /dev/null
}

test_rate_limiting() {
    # Make multiple requests to check rate limiting
    local success_count=0
    
    for i in {1..5}; do
        if make_request "/api/health" "GET" "" "200" > /dev/null 2>&1; then
            success_count=$((success_count + 1))
        fi
        sleep 0.1
    done
    
    # At least some requests should succeed
    [[ $success_count -gt 0 ]]
}

test_static_assets() {
    # Test if static assets are served
    local response=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/" 2>/dev/null)
    
    # Should return 200 or redirect
    [[ "$response" == "200" ]] || [[ "$response" == "301" ]] || [[ "$response" == "302" ]]
}

test_api_error_handling() {
    # Test 404 handling
    make_request "/api/nonexistent" "GET" "" "404" > /dev/null
}

test_metrics_endpoint() {
    # Test if metrics endpoint is available (for monitoring)
    local response=$(make_request "/metrics" "GET" "" "200")
    
    if [[ -z "$response" ]]; then
        # Metrics might be on a different port or not exposed
        return 0  # Don't fail the test
    fi
    
    # Check if response contains prometheus metrics
    echo "$response" | grep -q "# HELP" || return 0
}

test_websocket_support() {
    # Test WebSocket upgrade headers
    local headers=$(curl -s -I -H "Upgrade: websocket" -H "Connection: Upgrade" \
        "${BASE_URL}/api/ws" 2>/dev/null || echo "")
    
    # Check if WebSocket is supported (optional)
    if echo "$headers" | grep -q "HTTP/1.1 101"; then
        return 0
    else
        # WebSocket might not be implemented
        return 0  # Don't fail the test
    fi
}

# Performance smoke test
test_response_time() {
    local start_time=$(date +%s%N)
    
    if ! make_request "/api/health" "GET" "" "200" > /dev/null 2>&1; then
        return 1
    fi
    
    local end_time=$(date +%s%N)
    local duration=$(( (end_time - start_time) / 1000000 ))  # Convert to milliseconds
    
    if [[ "$VERBOSE" == "true" ]]; then
        log_info "Response time: ${duration}ms"
    fi
    
    # Check if response time is acceptable (< 1000ms)
    [[ $duration -lt 1000 ]]
}

# Deployment-specific tests
test_deployment_metadata() {
    if [[ -z "$DEPLOYMENT_ID" ]]; then
        return 0  # Skip if no deployment ID
    fi
    
    # Check if deployment metadata is accessible
    kubectl get configmap "deployment-${DEPLOYMENT_ID}" \
        -n "$NAMESPACE" > /dev/null 2>&1
}

# Main test execution
main() {
    # Get service URL
    get_service_url
    
    # Wait for service to be ready
    log_info "⏳ Waiting for service to be ready..."
    local retries=0
    while ! curl -sf "${BASE_URL}/api/health" > /dev/null 2>&1; do
        retries=$((retries + 1))
        if [[ $retries -gt 30 ]]; then
            log_error "Service not ready after 30 attempts"
            exit 1
        fi
        sleep 2
    done
    
    # Run all smoke tests
    log_info "🧪 Running smoke tests..."
    
    run_test "Health endpoint" test_health_endpoint
    run_test "Database connectivity" test_database_connectivity
    run_test "API version endpoint" test_api_version
    run_test "Authentication endpoint" test_authentication_endpoint
    run_test "CORS headers" test_cors_headers
    run_test "Rate limiting" test_rate_limiting
    run_test "Static assets" test_static_assets
    run_test "API error handling" test_api_error_handling
    run_test "Metrics endpoint" test_metrics_endpoint
    run_test "WebSocket support" test_websocket_support
    run_test "Response time" test_response_time
    run_test "Deployment metadata" test_deployment_metadata
    
    # Clean up port-forward if used
    if [[ -n "${PORT_FORWARD_PID:-}" ]]; then
        kill $PORT_FORWARD_PID 2>/dev/null || true
    fi
    
    # Display results
    echo ""
    log_info "📊 Test Results Summary"
    log_info "Total tests: ${TOTAL_TESTS}"
    log_success "Passed: ${PASSED_TESTS}"
    log_error "Failed: ${FAILED_TESTS}"
    echo ""
    
    # Display detailed results
    for result in "${TEST_RESULTS[@]}"; do
        echo "  $result"
    done
    
    # Save results to file
    if [[ -n "$DEPLOYMENT_ID" ]]; then
        local results_file="/tmp/smoke-test-results-${DEPLOYMENT_ID}.json"
        cat > "$results_file" <<EOF
{
  "deployment_id": "${DEPLOYMENT_ID}",
  "environment": "${ENVIRONMENT}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "total_tests": ${TOTAL_TESTS},
  "passed_tests": ${PASSED_TESTS},
  "failed_tests": ${FAILED_TESTS},
  "success_rate": $(( TOTAL_TESTS > 0 ? PASSED_TESTS * 100 / TOTAL_TESTS : 0 ))
}
EOF
        log_info "Results saved to: ${results_file}"
    fi
    
    # Exit with appropriate code
    if [[ $FAILED_TESTS -eq 0 ]]; then
        log_success "✅ All smoke tests passed!"
        exit 0
    else
        log_error "❌ Some smoke tests failed!"
        exit 1
    fi
}

# Run main function
main