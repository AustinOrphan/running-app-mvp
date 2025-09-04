#!/bin/bash
set -euo pipefail

# Deployment Snapshot Script
# Creates comprehensive snapshots before and after deployments

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/deployment-utils.sh"

# Default values
ENVIRONMENT=""
REGION=""
DEPLOYMENT_ID=""
SNAPSHOT_TYPE="deployment"
NAMESPACE=""
OUTPUT_DIR="/tmp/deployment-snapshots"

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
        --deployment-id)
            DEPLOYMENT_ID="$2"
            shift 2
            ;;
        --type)
            SNAPSHOT_TYPE="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required parameters
if [[ -z "$ENVIRONMENT" ]] || [[ -z "$DEPLOYMENT_ID" ]]; then
    log_error "❌ Error: --environment and --deployment-id are required"
    exit 1
fi

# Set namespace if not provided
if [[ -z "$NAMESPACE" ]]; then
    NAMESPACE="running-app-${ENVIRONMENT}"
fi

# Create snapshot directory
SNAPSHOT_DIR="${OUTPUT_DIR}/${DEPLOYMENT_ID}/${SNAPSHOT_TYPE}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SNAPSHOT_DIR"

log_info "📸 Creating ${SNAPSHOT_TYPE} snapshot for ${ENVIRONMENT}"
log_info "Snapshot directory: ${SNAPSHOT_DIR}"

# Capture Kubernetes resources
capture_k8s_resources() {
    log_info "📦 Capturing Kubernetes resources..."
    
    # Deployments
    kubectl get deployments -n "$NAMESPACE" -l app=running-app -o yaml \
        > "${SNAPSHOT_DIR}/deployments.yaml"
    
    # Services
    kubectl get services -n "$NAMESPACE" -l app=running-app -o yaml \
        > "${SNAPSHOT_DIR}/services.yaml"
    
    # ConfigMaps
    kubectl get configmaps -n "$NAMESPACE" -l app=running-app -o yaml \
        > "${SNAPSHOT_DIR}/configmaps.yaml"
    
    # Secrets (metadata only for security)
    kubectl get secrets -n "$NAMESPACE" -l app=running-app -o yaml \
        --export=true 2>/dev/null \
        | sed 's/\(data:\).*/\1 <REDACTED>/' \
        > "${SNAPSHOT_DIR}/secrets-metadata.yaml" || true
    
    # Ingress
    kubectl get ingress -n "$NAMESPACE" -l app=running-app -o yaml \
        > "${SNAPSHOT_DIR}/ingress.yaml" 2>/dev/null || true
    
    # HPA
    kubectl get hpa -n "$NAMESPACE" -l app=running-app -o yaml \
        > "${SNAPSHOT_DIR}/hpa.yaml" 2>/dev/null || true
    
    # PDB
    kubectl get pdb -n "$NAMESPACE" -l app=running-app -o yaml \
        > "${SNAPSHOT_DIR}/pdb.yaml" 2>/dev/null || true
    
    # Current pods
    kubectl get pods -n "$NAMESPACE" -l app=running-app -o yaml \
        > "${SNAPSHOT_DIR}/pods.yaml"
    
    # Events
    kubectl get events -n "$NAMESPACE" --sort-by='.lastTimestamp' \
        > "${SNAPSHOT_DIR}/events.txt"
}

# Capture application metrics
capture_metrics() {
    log_info "📊 Capturing application metrics..."
    
    # If Prometheus is available, export metrics
    if command -v promtool &> /dev/null; then
        # Export last hour of metrics
        local end_time=$(date +%s)
        local start_time=$((end_time - 3600))
        
        # Key metrics to capture
        local metrics=(
            "up{namespace=\"${NAMESPACE}\"}"
            "http_requests_total{namespace=\"${NAMESPACE}\"}"
            "http_request_duration_seconds{namespace=\"${NAMESPACE}\"}"
            "process_cpu_seconds_total{namespace=\"${NAMESPACE}\"}"
            "process_resident_memory_bytes{namespace=\"${NAMESPACE}\"}"
            "go_goroutines{namespace=\"${NAMESPACE}\"}"
        )
        
        for metric in "${metrics[@]}"; do
            # This is a placeholder - implement actual Prometheus query
            echo "Metric: $metric" >> "${SNAPSHOT_DIR}/metrics.txt"
        done
    fi
    
    # Capture current resource usage
    kubectl top pods -n "$NAMESPACE" -l app=running-app \
        > "${SNAPSHOT_DIR}/resource-usage.txt" 2>/dev/null || true
    
    kubectl top nodes > "${SNAPSHOT_DIR}/node-usage.txt" 2>/dev/null || true
}

# Capture logs
capture_logs() {
    log_info "📜 Capturing recent logs..."
    
    local pods=$(kubectl get pods -n "$NAMESPACE" -l app=running-app -o jsonpath='{.items[*].metadata.name}')
    
    mkdir -p "${SNAPSHOT_DIR}/logs"
    
    for pod in $pods; do
        log_info "Capturing logs from pod: $pod"
        
        # Get last 1000 lines of logs
        kubectl logs "$pod" -n "$NAMESPACE" --tail=1000 \
            > "${SNAPSHOT_DIR}/logs/${pod}.log" 2>/dev/null || true
        
        # Get previous container logs if available
        kubectl logs "$pod" -n "$NAMESPACE" --tail=1000 -p \
            > "${SNAPSHOT_DIR}/logs/${pod}-previous.log" 2>/dev/null || true
    done
}

# Capture database state
capture_database_state() {
    log_info "🗄️  Capturing database state..."
    
    # Get a running backend pod
    local pod=$(kubectl get pods -n "$NAMESPACE" \
        -l app=running-app,component=backend \
        -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -n "$pod" ]]; then
        # Get migration status
        kubectl exec "$pod" -n "$NAMESPACE" -- \
            npx prisma migrate status \
            > "${SNAPSHOT_DIR}/db-migration-status.txt" 2>/dev/null || true
        
        # Get database version
        kubectl exec "$pod" -n "$NAMESPACE" -- \
            sh -c 'echo "SELECT version();" | npx prisma db execute --stdin' \
            > "${SNAPSHOT_DIR}/db-version.txt" 2>/dev/null || true
    fi
}

# Create snapshot metadata
create_snapshot_metadata() {
    log_info "📝 Creating snapshot metadata..."
    
    cat > "${SNAPSHOT_DIR}/metadata.json" <<EOF
{
  "snapshot_id": "${DEPLOYMENT_ID}-${SNAPSHOT_TYPE}",
  "environment": "${ENVIRONMENT}",
  "region": "${REGION:-all}",
  "namespace": "${NAMESPACE}",
  "snapshot_type": "${SNAPSHOT_TYPE}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployment_id": "${DEPLOYMENT_ID}",
  "triggered_by": "${GITHUB_ACTOR:-system}",
  "git_sha": "${GITHUB_SHA:-unknown}",
  "git_ref": "${GITHUB_REF:-unknown}",
  "kubernetes_version": "$(kubectl version -o json | jq -r '.serverVersion.gitVersion' 2>/dev/null || echo 'unknown')"
}
EOF
}

# Compress snapshot
compress_snapshot() {
    log_info "🗜️  Compressing snapshot..."
    
    cd "${OUTPUT_DIR}/${DEPLOYMENT_ID}"
    tar -czf "${SNAPSHOT_TYPE}-$(date +%Y%m%d-%H%M%S).tar.gz" \
        "${SNAPSHOT_TYPE}-$(date +%Y%m%d-%H%M%S)"
    
    # Remove uncompressed directory
    rm -rf "${SNAPSHOT_TYPE}-$(date +%Y%m%d-%H%M%S)"
    
    log_success "✅ Snapshot compressed"
}

# Upload snapshot to storage
upload_snapshot() {
    log_info "☁️  Uploading snapshot to storage..."
    
    # Implement your storage upload logic here
    # Example for AWS S3:
    if [[ -n "${AWS_S3_BUCKET:-}" ]]; then
        aws s3 cp "${OUTPUT_DIR}/${DEPLOYMENT_ID}/${SNAPSHOT_TYPE}-*.tar.gz" \
            "s3://${AWS_S3_BUCKET}/snapshots/${ENVIRONMENT}/${DEPLOYMENT_ID}/" \
            --storage-class STANDARD_IA
        
        log_success "✅ Snapshot uploaded to S3"
    fi
    
    # Example for Google Cloud Storage:
    if [[ -n "${GCS_BUCKET:-}" ]]; then
        gsutil cp "${OUTPUT_DIR}/${DEPLOYMENT_ID}/${SNAPSHOT_TYPE}-*.tar.gz" \
            "gs://${GCS_BUCKET}/snapshots/${ENVIRONMENT}/${DEPLOYMENT_ID}/"
        
        log_success "✅ Snapshot uploaded to GCS"
    fi
}

# Main execution
main() {
    # Check prerequisites
    check_prerequisites || exit 1
    validate_k8s_connection || exit 1
    
    # Create snapshot
    capture_k8s_resources
    capture_metrics
    capture_logs
    capture_database_state
    create_snapshot_metadata
    
    # Compress and upload
    compress_snapshot
    upload_snapshot
    
    log_success "✅ Snapshot created successfully"
    log_info "Snapshot location: ${OUTPUT_DIR}/${DEPLOYMENT_ID}/"
    
    # Output snapshot path for GitHub Actions
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
        echo "::set-output name=snapshot-path::${OUTPUT_DIR}/${DEPLOYMENT_ID}/${SNAPSHOT_TYPE}-*.tar.gz"
    fi
}

# Run main function
main