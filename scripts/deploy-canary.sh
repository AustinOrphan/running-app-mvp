#!/bin/bash
set -euo pipefail

# Canary Deployment Script for Running App
# Implements progressive rollout with automated monitoring and rollback

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/deployment-utils.sh"

# Default values
ENVIRONMENT=""
REGION=""
IMAGE=""
PERCENTAGE=10
NAMESPACE=""
OUTPUT_ID=false
CANARY_ID=""
STABLE_VERSION=""
MONITORING_DURATION=300
ERROR_THRESHOLD=5
LATENCY_THRESHOLD=1000
PROMOTION_STEPS=(10 25 50 75 100)

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        --image)
            IMAGE="$2"
            shift 2
            ;;
        --percentage)
            PERCENTAGE="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --monitoring-duration)
            MONITORING_DURATION="$2"
            shift 2
            ;;
        --error-threshold)
            ERROR_THRESHOLD="$2"
            shift 2
            ;;
        --latency-threshold)
            LATENCY_THRESHOLD="$2"
            shift 2
            ;;
        --output-id)
            OUTPUT_ID=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required parameters
if [[ -z "$ENVIRONMENT" ]] || [[ -z "$IMAGE" ]]; then
    log_error "❌ Error: --environment and --image are required"
    exit 1
fi

# Set namespace if not provided
if [[ -z "$NAMESPACE" ]]; then
    NAMESPACE="running-app-${ENVIRONMENT}"
fi

# Generate canary ID
CANARY_ID="canary-${ENVIRONMENT}-$(date +%Y%m%d-%H%M%S)"

log_info "🐤 Starting canary deployment"
log_info "Environment: ${ENVIRONMENT}"
log_info "Region: ${REGION:-all}"
log_info "Image: ${IMAGE}"
log_info "Initial percentage: ${PERCENTAGE}%"
log_info "Canary ID: ${CANARY_ID}"

# Get current stable version
get_stable_version() {
    STABLE_VERSION=$(kubectl get deployment running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o jsonpath='{.spec.template.spec.containers[0].image}')
    
    log_info "Current stable version: ${STABLE_VERSION}"
}

# Create canary deployment
create_canary_deployment() {
    log_info "📝 Creating canary deployment..."
    
    # Get current deployment configuration
    kubectl get deployment running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o yaml > /tmp/stable-deployment.yaml
    
    # Create canary deployment based on stable
    cat /tmp/stable-deployment.yaml | \
    yq eval '.metadata.name = "running-app-backend-canary-'${ENVIRONMENT}'"' | \
    yq eval '.metadata.labels.version = "canary"' | \
    yq eval '.metadata.labels.canary-id = "'${CANARY_ID}'"' | \
    yq eval '.spec.replicas = 1' | \
    yq eval '.spec.selector.matchLabels.version = "canary"' | \
    yq eval '.spec.template.metadata.labels.version = "canary"' | \
    yq eval '.spec.template.metadata.labels.canary-id = "'${CANARY_ID}'"' | \
    yq eval '.spec.template.spec.containers[0].image = "'${IMAGE}'"' | \
    yq eval '.spec.template.spec.containers[0].env += [{"name": "CANARY_DEPLOYMENT", "value": "true"}]' | \
    kubectl apply -f -
    
    # Wait for canary to be ready
    wait_for_deployment "running-app-backend-canary-${ENVIRONMENT}" "$NAMESPACE" 300
}

# Configure traffic splitting
configure_traffic_split() {
    local percentage=$1
    log_info "🔀 Configuring traffic split: ${percentage}% to canary"
    
    # Create or update VirtualService for Istio
    if kubectl get virtualservice running-app-${ENVIRONMENT} -n "$NAMESPACE" &> /dev/null; then
        # Update existing VirtualService
        cat <<EOF | kubectl apply -f -
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: running-app-${ENVIRONMENT}
  namespace: ${NAMESPACE}
spec:
  hosts:
  - running-app-backend-${ENVIRONMENT}
  http:
  - match:
    - headers:
        canary:
          exact: "true"
    route:
    - destination:
        host: running-app-backend-${ENVIRONMENT}
        subset: canary
      weight: 100
  - route:
    - destination:
        host: running-app-backend-${ENVIRONMENT}
        subset: stable
      weight: $((100 - percentage))
    - destination:
        host: running-app-backend-${ENVIRONMENT}
        subset: canary
      weight: ${percentage}
EOF
    else
        # For non-Istio environments, use service selector manipulation
        # This is a simplified approach - in production, use a proper service mesh
        
        # Calculate replica distribution
        local total_replicas=$(kubectl get deployment running-app-backend-${ENVIRONMENT} \
            -n "$NAMESPACE" \
            -o jsonpath='{.spec.replicas}')
        
        local canary_replicas=$((total_replicas * percentage / 100))
        if [[ $canary_replicas -lt 1 ]]; then
            canary_replicas=1
        fi
        
        local stable_replicas=$((total_replicas - canary_replicas))
        
        # Scale deployments
        scale_deployment "running-app-backend-${ENVIRONMENT}" "$NAMESPACE" "$stable_replicas"
        scale_deployment "running-app-backend-canary-${ENVIRONMENT}" "$NAMESPACE" "$canary_replicas"
        
        # Update service to include both versions
        kubectl patch service running-app-backend-${ENVIRONMENT} \
            -n "$NAMESPACE" \
            --type='json' \
            -p='[{"op": "remove", "path": "/spec/selector/version"}]' 2>/dev/null || true
    fi
}

# Monitor canary metrics
monitor_canary_metrics() {
    local duration=$1
    local start_time=$(date +%s)
    local end_time=$((start_time + duration))
    
    log_info "📊 Monitoring canary metrics for ${duration}s..."
    
    local error_count=0
    local total_requests=0
    local high_latency_count=0
    
    while [[ $(date +%s) -lt $end_time ]]; do
        # Get metrics from Prometheus or monitoring system
        # This is a simplified example - integrate with your actual monitoring
        
        # Check pod logs for errors
        local canary_pods=$(kubectl get pods -n "$NAMESPACE" \
            -l app=running-app,version=canary \
            -o jsonpath='{.items[*].metadata.name}')
        
        for pod in $canary_pods; do
            local recent_errors=$(kubectl logs "$pod" -n "$NAMESPACE" \
                --since=1m 2>/dev/null | grep -c "ERROR" || echo "0")
            error_count=$((error_count + recent_errors))
        done
        
        # Simulate request counting (replace with actual metrics)
        total_requests=$((total_requests + 100))
        
        # Check if we're exceeding thresholds
        if [[ $error_count -gt 0 ]] && [[ $total_requests -gt 0 ]]; then
            local error_rate=$((error_count * 100 / total_requests))
            if [[ $error_rate -gt $ERROR_THRESHOLD ]]; then
                log_error "❌ Error rate (${error_rate}%) exceeds threshold (${ERROR_THRESHOLD}%)"
                return 1
            fi
        fi
        
        # Display current metrics
        local elapsed=$(($(date +%s) - start_time))
        log_info "Metrics at ${elapsed}s: Errors: ${error_count}, Requests: ${total_requests}"
        
        sleep 10
    done
    
    log_success "✅ Monitoring completed successfully"
    return 0
}

# Automated canary analysis
analyze_canary() {
    log_info "🔍 Analyzing canary deployment..."
    
    # Get canary and stable metrics
    local canary_metrics=$(get_deployment_metrics "running-app-backend-canary-${ENVIRONMENT}" "$NAMESPACE")
    local stable_metrics=$(get_deployment_metrics "running-app-backend-${ENVIRONMENT}" "$NAMESPACE")
    
    # Compare key metrics
    # In a real implementation, this would query Prometheus/Datadog/etc
    
    # Check if canary pods are healthy
    local canary_ready=$(kubectl get deployment running-app-backend-canary-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o jsonpath='{.status.readyReplicas}')
    
    local canary_desired=$(kubectl get deployment running-app-backend-canary-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o jsonpath='{.spec.replicas}')
    
    if [[ "$canary_ready" != "$canary_desired" ]]; then
        log_error "❌ Canary pods not fully ready: ${canary_ready}/${canary_desired}"
        return 1
    fi
    
    log_success "✅ Canary analysis passed"
    return 0
}

# Promote canary
promote_canary() {
    local target_percentage=$1
    
    log_info "📈 Promoting canary to ${target_percentage}%"
    
    # Update traffic split
    configure_traffic_split "$target_percentage"
    
    # Monitor for issues
    if ! monitor_canary_metrics 60; then
        log_error "❌ Issues detected during promotion to ${target_percentage}%"
        return 1
    fi
    
    log_success "✅ Successfully promoted to ${target_percentage}%"
    return 0
}

# Rollback canary
rollback_canary() {
    log_error "🔄 Rolling back canary deployment"
    
    # Remove all canary traffic
    configure_traffic_split 0
    
    # Delete canary deployment
    kubectl delete deployment running-app-backend-canary-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        --grace-period=30
    
    # Scale stable back to original replicas
    local original_replicas=$(kubectl get deployment running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o jsonpath='{.metadata.annotations.original-replicas}')
    
    if [[ -n "$original_replicas" ]]; then
        scale_deployment "running-app-backend-${ENVIRONMENT}" "$NAMESPACE" "$original_replicas"
    fi
    
    # Send notification
    send_notification "failure" "Canary deployment rolled back for ${ENVIRONMENT}"
    
    log_info "✅ Rollback completed"
}

# Complete canary promotion
complete_canary() {
    log_info "🎉 Completing canary deployment"
    
    # Update stable deployment with canary image
    kubectl set image deployment/running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        backend="${IMAGE}"
    
    # Wait for stable update
    wait_for_deployment "running-app-backend-${ENVIRONMENT}" "$NAMESPACE" 600
    
    # Remove canary deployment
    kubectl delete deployment running-app-backend-canary-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        --grace-period=30
    
    # Remove traffic splitting rules
    kubectl delete virtualservice running-app-${ENVIRONMENT} \
        -n "$NAMESPACE" 2>/dev/null || true
    
    log_success "✅ Canary deployment completed successfully"
}

# Main canary deployment flow
main() {
    # Get current stable version
    get_stable_version
    
    # Store original replica count
    kubectl annotate deployment running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        original-replicas=$(kubectl get deployment running-app-backend-${ENVIRONMENT} \
            -n "$NAMESPACE" -o jsonpath='{.spec.replicas}') \
        --overwrite
    
    # Create canary deployment
    create_canary_deployment
    
    # Initial traffic configuration
    configure_traffic_split "$PERCENTAGE"
    
    # Initial monitoring
    if ! monitor_canary_metrics "$MONITORING_DURATION"; then
        rollback_canary
        exit 1
    fi
    
    # Analyze canary
    if ! analyze_canary; then
        rollback_canary
        exit 1
    fi
    
    # Progressive promotion
    for step in "${PROMOTION_STEPS[@]}"; do
        if [[ $step -le $PERCENTAGE ]]; then
            continue
        fi
        
        read -p "Promote canary to ${step}%? (y/n) " -n 1 -r
        echo
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if ! promote_canary "$step"; then
                rollback_canary
                exit 1
            fi
        else
            log_info "Skipping promotion to ${step}%"
            break
        fi
        
        if [[ $step -eq 100 ]]; then
            complete_canary
        fi
    done
    
    # Output canary ID if requested
    if [[ "$OUTPUT_ID" == "true" ]]; then
        echo "${CANARY_ID}"
    fi
}

# Run main function
main