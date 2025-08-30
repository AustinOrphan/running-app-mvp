#!/bin/bash
set -euo pipefail

# Rollback Script for Running App
# Handles automated and manual rollback procedures

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/deployment-utils.sh"

# Default values
ENVIRONMENT=""
DEPLOYMENT_ID=""
STRATEGY="immediate"
NOTIFY_STAKEHOLDERS=false
NAMESPACE=""
TARGET_VERSION=""
ROLLBACK_ID=""
DRY_RUN=false

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
        --strategy)
            STRATEGY="$2"
            shift 2
            ;;
        --notify-stakeholders)
            NOTIFY_STAKEHOLDERS=true
            shift
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --target-version)
            TARGET_VERSION="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
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

# Generate rollback ID
ROLLBACK_ID="rollback-${ENVIRONMENT}-$(date +%Y%m%d-%H%M%S)"

log_info "🔄 Starting rollback procedure"
log_info "Environment: ${ENVIRONMENT}"
log_info "Strategy: ${STRATEGY}"
log_info "Rollback ID: ${ROLLBACK_ID}"

# Get current deployment information
get_current_deployment_info() {
    log_info "📊 Gathering current deployment information..."
    
    # Get current image
    CURRENT_IMAGE=$(kubectl get deployment running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o jsonpath='{.spec.template.spec.containers[0].image}')
    
    # Get deployment history
    log_info "Deployment history:"
    kubectl rollout history deployment/running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" || true
    
    # Get current replica count
    CURRENT_REPLICAS=$(kubectl get deployment running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o jsonpath='{.spec.replicas}')
    
    log_info "Current image: ${CURRENT_IMAGE}"
    log_info "Current replicas: ${CURRENT_REPLICAS}"
}

# Determine target version for rollback
determine_target_version() {
    if [[ -n "$TARGET_VERSION" ]]; then
        log_info "Using specified target version: ${TARGET_VERSION}"
        return
    fi
    
    # Get previous stable version from deployment history
    local previous_revision=$(kubectl rollout history deployment/running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        --revision=0 | tail -2 | head -1 | awk '{print $1}')
    
    if [[ -z "$previous_revision" ]]; then
        log_error "❌ Cannot determine previous version for rollback"
        exit 1
    fi
    
    # Get image from previous revision
    TARGET_VERSION=$(kubectl rollout history deployment/running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        --revision="$previous_revision" -o jsonpath='{.spec.template.spec.containers[0].image}')
    
    log_info "Target rollback version: ${TARGET_VERSION}"
}

# Create rollback snapshot
create_rollback_snapshot() {
    log_info "📸 Creating rollback snapshot..."
    
    # Backup current state
    local snapshot_dir="/tmp/rollback-snapshots/${ROLLBACK_ID}"
    mkdir -p "$snapshot_dir"
    
    # Export current deployment
    kubectl get deployment running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o yaml > "${snapshot_dir}/deployment-current.yaml"
    
    # Export current service
    kubectl get service running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o yaml > "${snapshot_dir}/service-current.yaml" 2>/dev/null || true
    
    # Export current configmaps
    kubectl get configmap -n "$NAMESPACE" \
        -l app=running-app,environment=${ENVIRONMENT} \
        -o yaml > "${snapshot_dir}/configmaps-current.yaml" 2>/dev/null || true
    
    # Create rollback metadata
    cat > "${snapshot_dir}/rollback-metadata.json" <<EOF
{
  "rollback_id": "${ROLLBACK_ID}",
  "environment": "${ENVIRONMENT}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "current_image": "${CURRENT_IMAGE}",
  "target_image": "${TARGET_VERSION}",
  "deployment_id": "${DEPLOYMENT_ID}",
  "triggered_by": "${GITHUB_ACTOR:-manual}",
  "reason": "Automated rollback due to deployment failure"
}
EOF
    
    log_success "✅ Snapshot created: ${snapshot_dir}"
}

# Perform immediate rollback
immediate_rollback() {
    log_info "⚡ Performing immediate rollback..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Would rollback to revision with image ${TARGET_VERSION}"
        return 0
    fi
    
    # Use kubectl rollout undo
    kubectl rollout undo deployment/running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE"
    
    # Wait for rollout to complete
    kubectl rollout status deployment/running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        --timeout=600s
}

# Perform gradual rollback
gradual_rollback() {
    log_info "📈 Performing gradual rollback..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Would perform gradual rollback to ${TARGET_VERSION}"
        return 0
    fi
    
    # Create a canary deployment with previous version
    kubectl create deployment running-app-backend-rollback-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        --image="${TARGET_VERSION}" \
        --replicas=1 \
        --dry-run=client -o yaml | \
    kubectl label -f - \
        app=running-app \
        component=backend \
        environment=${ENVIRONMENT} \
        version=rollback \
        rollback-id=${ROLLBACK_ID} \
        --local -o yaml | \
    kubectl apply -f -
    
    # Wait for rollback deployment to be ready
    wait_for_deployment "running-app-backend-rollback-${ENVIRONMENT}" "$NAMESPACE" 300
    
    # Gradually shift traffic
    local steps=(25 50 75 100)
    for percentage in "${steps[@]}"; do
        log_info "Shifting ${percentage}% traffic to rollback version..."
        
        # Scale deployments accordingly
        local rollback_replicas=$((CURRENT_REPLICAS * percentage / 100))
        local current_replicas=$((CURRENT_REPLICAS - rollback_replicas))
        
        scale_deployment "running-app-backend-rollback-${ENVIRONMENT}" "$NAMESPACE" "$rollback_replicas"
        scale_deployment "running-app-backend-${ENVIRONMENT}" "$NAMESPACE" "$current_replicas"
        
        # Monitor for 60 seconds
        sleep 60
        
        # Check health
        if ! check_service_health "running-app-backend-${ENVIRONMENT}" "$NAMESPACE"; then
            log_error "❌ Health check failed during gradual rollback at ${percentage}%"
            # Abort and do immediate rollback
            immediate_rollback
            return 1
        fi
    done
    
    # Complete rollback by updating main deployment
    kubectl set image deployment/running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        backend="${TARGET_VERSION}"
    
    # Delete temporary rollback deployment
    kubectl delete deployment running-app-backend-rollback-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        --grace-period=30
}

# Perform blue-green rollback
blue_green_rollback() {
    log_info "🔵🟢 Performing blue-green rollback..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Would switch traffic back to previous version"
        return 0
    fi
    
    # Determine current active color
    local current_color=$(kubectl get service running-app-backend-${ENVIRONMENT} \
        -n "$NAMESPACE" \
        -o jsonpath='{.spec.selector.color}' || echo "blue")
    
    local previous_color="green"
    if [[ "$current_color" == "green" ]]; then
        previous_color="blue"
    fi
    
    # Check if previous color deployment exists and is healthy
    if kubectl get deployment running-app-backend-${previous_color}-${ENVIRONMENT} \
        -n "$NAMESPACE" &> /dev/null; then
        
        # Switch service selector to previous color
        kubectl patch service running-app-backend-${ENVIRONMENT} \
            -n "$NAMESPACE" \
            -p '{"spec":{"selector":{"color":"'${previous_color}'"}}}'
        
        log_success "✅ Switched traffic to ${previous_color} deployment"
    else
        log_warning "Previous deployment not found, performing standard rollback"
        immediate_rollback
    fi
}

# Verify rollback success
verify_rollback() {
    log_info "🔍 Verifying rollback success..."
    
    local retries=0
    local max_retries=30
    
    while [[ $retries -lt $max_retries ]]; do
        # Check deployment status
        local ready=$(kubectl get deployment running-app-backend-${ENVIRONMENT} \
            -n "$NAMESPACE" \
            -o jsonpath='{.status.conditions[?(@.type=="Available")].status}')
        
        if [[ "$ready" == "True" ]]; then
            # Verify image was rolled back
            local current_image=$(kubectl get deployment running-app-backend-${ENVIRONMENT} \
                -n "$NAMESPACE" \
                -o jsonpath='{.spec.template.spec.containers[0].image}')
            
            if [[ "$current_image" != "$CURRENT_IMAGE" ]]; then
                log_success "✅ Rollback verified - now running: ${current_image}"
                
                # Perform health check
                if check_service_health "running-app-backend-${ENVIRONMENT}" "$NAMESPACE"; then
                    log_success "✅ Service health check passed"
                    return 0
                fi
            fi
        fi
        
        retries=$((retries + 1))
        log_info "Verification attempt ${retries}/${max_retries}..."
        sleep 10
    done
    
    log_error "❌ Rollback verification failed"
    return 1
}

# Create rollback report
create_rollback_report() {
    log_info "📝 Creating rollback report..."
    
    local report_file="/tmp/rollback-report-${ROLLBACK_ID}.md"
    
    cat > "$report_file" <<EOF
# Rollback Report

## Summary
- **Rollback ID**: ${ROLLBACK_ID}
- **Environment**: ${ENVIRONMENT}
- **Timestamp**: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- **Triggered By**: ${GITHUB_ACTOR:-manual}
- **Strategy**: ${STRATEGY}

## Version Information
- **Failed Version**: ${CURRENT_IMAGE}
- **Rolled Back To**: ${TARGET_VERSION}
- **Deployment ID**: ${DEPLOYMENT_ID:-N/A}

## Timeline
$(kubectl get events -n "$NAMESPACE" --sort-by='.lastTimestamp' | grep -E "(deployment|rollback)" | tail -20)

## Current Status
\`\`\`
$(kubectl get deployment,pod,service -n "$NAMESPACE" -l app=running-app,environment=${ENVIRONMENT})
\`\`\`

## Recommendations
1. Investigate the root cause of the deployment failure
2. Review deployment logs and metrics
3. Test fixes in staging environment before re-deploying
4. Consider implementing additional safety checks

## Related Links
- [Deployment Logs](https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})
- [Monitoring Dashboard](https://grafana.example.com/d/running-app-deployments)
- [Incident Runbook](https://wiki.example.com/runbooks/deployment-rollback)
EOF
    
    log_info "Report saved to: ${report_file}"
    
    # Upload report as artifact if in GitHub Actions
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
        echo "::set-output name=rollback-report::${report_file}"
    fi
}

# Send notifications
send_rollback_notifications() {
    if [[ "$NOTIFY_STAKEHOLDERS" != "true" ]]; then
        return
    fi
    
    log_info "📢 Sending rollback notifications..."
    
    local message="🔄 *Rollback Executed*
Environment: ${ENVIRONMENT}
Failed Version: ${CURRENT_IMAGE}
Rolled Back To: ${TARGET_VERSION}
Status: ${1}
Rollback ID: ${ROLLBACK_ID}"
    
    # Send Slack notification
    if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"${message}\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
    
    # Send email notification (if configured)
    if [[ -n "${EMAIL_NOTIFICATIONS:-}" ]]; then
        echo "$message" | mail -s "Rollback Notification - ${ENVIRONMENT}" "$EMAIL_NOTIFICATIONS" || true
    fi
    
    # Create GitHub issue for tracking
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        gh issue create \
            --title "Rollback Executed: ${ENVIRONMENT} - ${ROLLBACK_ID}" \
            --body "$(cat /tmp/rollback-report-${ROLLBACK_ID}.md)" \
            --label "incident,rollback,${ENVIRONMENT}" || true
    fi
}

# Main rollback execution
main() {
    # Get current deployment info
    get_current_deployment_info
    
    # Determine target version
    determine_target_version
    
    # Create snapshot before rollback
    create_rollback_snapshot
    
    # Execute rollback based on strategy
    case $STRATEGY in
        "immediate")
            immediate_rollback
            ;;
        "gradual")
            gradual_rollback
            ;;
        "blue-green")
            blue_green_rollback
            ;;
        *)
            log_error "Unknown rollback strategy: ${STRATEGY}"
            exit 1
            ;;
    esac
    
    # Verify rollback success
    if verify_rollback; then
        log_success "✅ Rollback completed successfully"
        create_rollback_report
        send_rollback_notifications "Success"
        
        # Record rollback in deployment history
        kubectl annotate deployment running-app-backend-${ENVIRONMENT} \
            -n "$NAMESPACE" \
            "rollback.${ROLLBACK_ID}.timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            "rollback.${ROLLBACK_ID}.from=${CURRENT_IMAGE}" \
            "rollback.${ROLLBACK_ID}.to=${TARGET_VERSION}" \
            --overwrite
        
        exit 0
    else
        log_error "❌ Rollback verification failed"
        send_rollback_notifications "Failed"
        exit 1
    fi
}

# Run main function
main