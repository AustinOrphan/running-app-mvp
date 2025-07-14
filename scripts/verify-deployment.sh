#!/bin/bash
set -euo pipefail

# Deployment Verification Script
# Performs comprehensive checks to ensure deployment success

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/deployment-utils.sh"

# Default values
ENVIRONMENT=""
NAMESPACE=""
TIMEOUT=300
HEALTH_CHECK_RETRIES=30
COMPREHENSIVE_CHECK=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --health-check-retries)
            HEALTH_CHECK_RETRIES="$2"
            shift 2
            ;;
        --comprehensive-check)
            COMPREHENSIVE_CHECK=true
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

log_info "🔍 Starting deployment verification for ${ENVIRONMENT}"

# Check prerequisites
check_prerequisites || exit 1
validate_k8s_connection || exit 1

# Verification functions
verify_deployments() {
    log_info "📊 Verifying deployments..."
    
    local deployments=$(kubectl get deployments -n "$NAMESPACE" -l app=running-app -o name)
    local all_ready=true
    
    for deployment in $deployments; do
        local name=$(basename "$deployment")
        log_info "Checking deployment: $name"
        
        # Check if deployment is ready
        local ready=$(kubectl get "$deployment" -n "$NAMESPACE" \
            -o jsonpath='{.status.conditions[?(@.type=="Available")].status}')
        
        if [[ "$ready" != "True" ]]; then
            log_error "Deployment $name is not ready"
            all_ready=false
        else
            log_success "Deployment $name is ready"
        fi
        
        # Get deployment metrics
        get_deployment_metrics "$name" "$NAMESPACE"
    done
    
    return $([ "$all_ready" = true ] && echo 0 || echo 1)
}

verify_pods() {
    log_info "🔍 Verifying pods..."
    
    local pods=$(kubectl get pods -n "$NAMESPACE" -l app=running-app -o json)
    local total_pods=$(echo "$pods" | jq '.items | length')
    local ready_pods=0
    local failing_pods=()
    
    for i in $(seq 0 $((total_pods - 1))); do
        local pod_name=$(echo "$pods" | jq -r ".items[$i].metadata.name")
        local pod_ready=$(echo "$pods" | jq -r ".items[$i].status.conditions[] | select(.type==\"Ready\") | .status")
        local pod_phase=$(echo "$pods" | jq -r ".items[$i].status.phase")
        
        if [[ "$pod_ready" == "True" ]] && [[ "$pod_phase" == "Running" ]]; then
            ready_pods=$((ready_pods + 1))
            log_success "Pod $pod_name is ready"
        else
            failing_pods+=("$pod_name")
            log_error "Pod $pod_name is not ready (phase: $pod_phase)"
            
            # Get pod events for troubleshooting
            kubectl describe pod "$pod_name" -n "$NAMESPACE" | tail -20
        fi
    done
    
    log_info "Ready pods: $ready_pods/$total_pods"
    
    if [[ $ready_pods -eq $total_pods ]]; then
        return 0
    else
        log_error "Failing pods: ${failing_pods[*]}"
        return 1
    fi
}

verify_services() {
    log_info "🌐 Verifying services..."
    
    local services=$(kubectl get services -n "$NAMESPACE" -l app=running-app -o name)
    local all_healthy=true
    
    for service in $services; do
        local name=$(basename "$service")
        log_info "Checking service: $name"
        
        # Check if service has endpoints
        local endpoints=$(kubectl get endpoints "$name" -n "$NAMESPACE" -o jsonpath='{.subsets[*].addresses[*].ip}')
        
        if [[ -z "$endpoints" ]]; then
            log_error "Service $name has no endpoints"
            all_healthy=false
        else
            log_success "Service $name has endpoints: $(echo "$endpoints" | wc -w)"
            
            # Perform health check if it's the main backend service
            if [[ "$name" =~ "backend" ]]; then
                if check_service_health "$name" "$NAMESPACE"; then
                    log_success "Service $name health check passed"
                else
                    log_error "Service $name health check failed"
                    all_healthy=false
                fi
            fi
        fi
    done
    
    return $([ "$all_healthy" = true ] && echo 0 || echo 1)
}

verify_ingress() {
    log_info "🔗 Verifying ingress..."
    
    local ingresses=$(kubectl get ingress -n "$NAMESPACE" -l app=running-app -o name)
    
    if [[ -z "$ingresses" ]]; then
        log_warning "No ingress resources found"
        return 0
    fi
    
    for ingress in $ingresses; do
        local name=$(basename "$ingress")
        local hosts=$(kubectl get "$ingress" -n "$NAMESPACE" -o jsonpath='{.spec.rules[*].host}')
        local address=$(kubectl get "$ingress" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
        
        if [[ -z "$address" ]]; then
            address=$(kubectl get "$ingress" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
        fi
        
        log_info "Ingress $name:"
        log_info "  Hosts: $hosts"
        log_info "  Address: ${address:-pending}"
        
        if [[ -n "$address" ]]; then
            log_success "Ingress $name is configured"
        else
            log_warning "Ingress $name address is still pending"
        fi
    done
    
    return 0
}

verify_database() {
    log_info "🗄️  Verifying database connectivity..."
    
    # Get a running backend pod
    local pod=$(kubectl get pods -n "$NAMESPACE" \
        -l app=running-app,component=backend \
        -o jsonpath='{.items[0].metadata.name}')
    
    if [[ -z "$pod" ]]; then
        log_error "No backend pods found"
        return 1
    fi
    
    # Check database connection
    if kubectl exec "$pod" -n "$NAMESPACE" -- \
        npx prisma db push --skip-generate &> /dev/null; then
        log_success "Database connection verified"
        return 0
    else
        log_error "Database connection failed"
        return 1
    fi
}

perform_smoke_tests() {
    log_info "🔥 Running smoke tests..."
    
    # Get service URL
    local service_url=""
    
    # Try to get LoadBalancer URL
    service_url=$(kubectl get service running-app-backend-"${ENVIRONMENT}" \
        -n "$NAMESPACE" \
        -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    
    if [[ -z "$service_url" ]]; then
        service_url=$(kubectl get service running-app-backend-"${ENVIRONMENT}" \
            -n "$NAMESPACE" \
            -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
    fi
    
    if [[ -z "$service_url" ]]; then
        log_warning "No external URL available, using port-forward"
        
        # Set up port-forward in background
        kubectl port-forward service/running-app-backend-"${ENVIRONMENT}" \
            -n "$NAMESPACE" 8080:3001 &
        local pf_pid=$!
        sleep 5
        
        service_url="localhost:8080"
    fi
    
    # Perform smoke tests
    local tests_passed=true
    
    # Test 1: Health endpoint
    log_info "Test 1: Health endpoint"
    if curl -sf "http://${service_url}/api/health" > /dev/null; then
        log_success "Health endpoint test passed"
    else
        log_error "Health endpoint test failed"
        tests_passed=false
    fi
    
    # Test 2: API version
    log_info "Test 2: API version"
    local version=$(curl -sf "http://${service_url}/api/version" | jq -r '.version' 2>/dev/null)
    if [[ -n "$version" ]]; then
        log_success "API version test passed (version: $version)"
    else
        log_error "API version test failed"
        tests_passed=false
    fi
    
    # Test 3: Database connectivity
    log_info "Test 3: Database connectivity"
    local db_status=$(curl -sf "http://${service_url}/api/health" | jq -r '.database.status' 2>/dev/null)
    if [[ "$db_status" == "connected" ]]; then
        log_success "Database connectivity test passed"
    else
        log_error "Database connectivity test failed"
        tests_passed=false
    fi
    
    # Clean up port-forward if used
    if [[ -n "${pf_pid:-}" ]]; then
        kill $pf_pid 2>/dev/null || true
    fi
    
    return $([ "$tests_passed" = true ] && echo 0 || echo 1)
}

# Main verification flow
main() {
    local verification_passed=true
    
    # Basic verifications
    if ! verify_deployments; then
        verification_passed=false
    fi
    
    if ! verify_pods; then
        verification_passed=false
    fi
    
    if ! verify_services; then
        verification_passed=false
    fi
    
    if ! verify_ingress; then
        verification_passed=false
    fi
    
    # Comprehensive checks if requested
    if [[ "$COMPREHENSIVE_CHECK" == "true" ]]; then
        log_info "🔬 Performing comprehensive checks..."
        
        if ! verify_database; then
            verification_passed=false
        fi
        
        if ! perform_smoke_tests; then
            verification_passed=false
        fi
    fi
    
    # Final result
    if [[ "$verification_passed" == "true" ]]; then
        log_success "✅ All deployment verifications passed!"
        send_notification "success" "Deployment verification successful for ${ENVIRONMENT}"
        exit 0
    else
        log_error "❌ Deployment verification failed!"
        send_notification "failure" "Deployment verification failed for ${ENVIRONMENT}"
        exit 1
    fi
}

# Run main function
main