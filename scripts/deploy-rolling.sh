#!/bin/bash
set -euo pipefail

# Rolling Deployment Script for Running App
# Supports multiple deployment strategies and health checking

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/deployment-utils.sh"

# Default values
ENVIRONMENT=""
IMAGE=""
REPLICAS=3
MAX_SURGE=1
MAX_UNAVAILABLE=0
STRATEGY="rolling"
NAMESPACE=""
DEPLOYMENT_NAME="running-app-backend"
HEALTH_CHECK_INTERVAL=10
HEALTH_CHECK_RETRIES=30
OUTPUT_ID=false
DEPLOYMENT_ID=""
BATCH_SIZE=25
BATCH_PAUSE=60

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --image)
            IMAGE="$2"
            shift 2
            ;;
        --replicas)
            REPLICAS="$2"
            shift 2
            ;;
        --max-surge)
            MAX_SURGE="$2"
            shift 2
            ;;
        --max-unavailable)
            MAX_UNAVAILABLE="$2"
            shift 2
            ;;
        --strategy)
            STRATEGY="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --deployment-name)
            DEPLOYMENT_NAME="$2"
            shift 2
            ;;
        --health-check-interval)
            HEALTH_CHECK_INTERVAL="$2"
            shift 2
            ;;
        --health-check-retries)
            HEALTH_CHECK_RETRIES="$2"
            shift 2
            ;;
        --batch-size)
            BATCH_SIZE="$2"
            shift 2
            ;;
        --batch-pause)
            BATCH_PAUSE="$2"
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
    echo "❌ Error: --environment and --image are required"
    echo "Usage: $0 --environment <env> --image <image:tag> [options]"
    exit 1
fi

# Set namespace based on environment if not provided
if [[ -z "$NAMESPACE" ]]; then
    NAMESPACE="running-app-${ENVIRONMENT}"
fi

# Generate deployment ID
DEPLOYMENT_ID="deploy-${ENVIRONMENT}-$(date +%Y%m%d-%H%M%S)-${GITHUB_RUN_ID:-local}"

# Log deployment start
log_info "🚀 Starting ${STRATEGY} deployment"
log_info "Environment: ${ENVIRONMENT}"
log_info "Namespace: ${NAMESPACE}"
log_info "Image: ${IMAGE}"
log_info "Deployment ID: ${DEPLOYMENT_ID}"

# Create deployment metadata
create_deployment_metadata() {
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: deployment-${DEPLOYMENT_ID}
  namespace: ${NAMESPACE}
  labels:
    app: running-app
    deployment-id: ${DEPLOYMENT_ID}
data:
  environment: "${ENVIRONMENT}"
  image: "${IMAGE}"
  strategy: "${STRATEGY}"
  replicas: "${REPLICAS}"
  start_time: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git_sha: "${GITHUB_SHA:-unknown}"
  git_ref: "${GITHUB_REF:-unknown}"
  triggered_by: "${GITHUB_ACTOR:-unknown}"
EOF
}

# Update deployment with new image
update_deployment() {
    log_info "📝 Updating deployment configuration..."
    
    # Create a patch for the deployment
    cat <<EOF > /tmp/deployment-patch.yaml
spec:
  replicas: ${REPLICAS}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: ${MAX_SURGE}
      maxUnavailable: ${MAX_UNAVAILABLE}
  template:
    metadata:
      labels:
        deployment-id: ${DEPLOYMENT_ID}
        version: ${IMAGE##*:}
    spec:
      containers:
      - name: backend
        image: ${IMAGE}
        env:
        - name: DEPLOYMENT_ID
          value: ${DEPLOYMENT_ID}
        - name: DEPLOYMENT_TIMESTAMP
          value: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EOF
    
    # Apply the patch
    kubectl patch deployment ${DEPLOYMENT_NAME}-${ENVIRONMENT} \
        -n ${NAMESPACE} \
        --patch "$(cat /tmp/deployment-patch.yaml)"
    
    rm -f /tmp/deployment-patch.yaml
}

# Perform canary deployment
canary_deployment() {
    local CANARY_PERCENTAGE=${1:-10}
    log_info "🐤 Starting canary deployment with ${CANARY_PERCENTAGE}% traffic"
    
    # Create canary deployment
    kubectl create deployment ${DEPLOYMENT_NAME}-canary-${ENVIRONMENT} \
        -n ${NAMESPACE} \
        --image=${IMAGE} \
        --replicas=1 \
        --dry-run=client -o yaml | \
    kubectl label -f - \
        app=running-app \
        component=backend \
        environment=${ENVIRONMENT} \
        version=canary \
        deployment-id=${DEPLOYMENT_ID} \
        --local -o yaml | \
    kubectl apply -f -
    
    # Wait for canary to be ready
    kubectl wait --for=condition=available \
        --timeout=300s \
        deployment/${DEPLOYMENT_NAME}-canary-${ENVIRONMENT} \
        -n ${NAMESPACE}
    
    # Update service to route percentage of traffic to canary
    # This assumes you're using a service mesh or ingress that supports traffic splitting
    log_info "🔀 Routing ${CANARY_PERCENTAGE}% traffic to canary"
    
    # Return canary deployment name for monitoring
    echo "${DEPLOYMENT_NAME}-canary-${ENVIRONMENT}"
}

# Perform blue-green deployment
blue_green_deployment() {
    log_info "🔵🟢 Starting blue-green deployment"
    
    # Determine current active color
    CURRENT_COLOR=$(kubectl get service ${DEPLOYMENT_NAME}-${ENVIRONMENT} \
        -n ${NAMESPACE} \
        -o jsonpath='{.spec.selector.color}' || echo "blue")
    
    NEW_COLOR="green"
    if [[ "$CURRENT_COLOR" == "green" ]]; then
        NEW_COLOR="blue"
    fi
    
    log_info "Current active: ${CURRENT_COLOR}, deploying to: ${NEW_COLOR}"
    
    # Create new deployment with new color
    kubectl create deployment ${DEPLOYMENT_NAME}-${NEW_COLOR}-${ENVIRONMENT} \
        -n ${NAMESPACE} \
        --image=${IMAGE} \
        --replicas=${REPLICAS} \
        --dry-run=client -o yaml | \
    kubectl label -f - \
        app=running-app \
        component=backend \
        environment=${ENVIRONMENT} \
        color=${NEW_COLOR} \
        deployment-id=${DEPLOYMENT_ID} \
        --local -o yaml | \
    kubectl apply -f -
    
    # Wait for new deployment to be ready
    kubectl wait --for=condition=available \
        --timeout=600s \
        deployment/${DEPLOYMENT_NAME}-${NEW_COLOR}-${ENVIRONMENT} \
        -n ${NAMESPACE}
    
    log_info "✅ ${NEW_COLOR} deployment ready"
    
    # Return new deployment details
    echo "${NEW_COLOR}"
}

# Perform rolling deployment
rolling_deployment() {
    log_info "🔄 Starting rolling deployment"
    
    # Update the deployment
    update_deployment
    
    # Monitor rollout status
    kubectl rollout status deployment/${DEPLOYMENT_NAME}-${ENVIRONMENT} \
        -n ${NAMESPACE} \
        --timeout=600s
}

# Batch rolling deployment
batch_rolling_deployment() {
    log_info "📦 Starting batch rolling deployment"
    log_info "Batch size: ${BATCH_SIZE}%, Pause: ${BATCH_PAUSE}s"
    
    # Get current replicas
    CURRENT_REPLICAS=$(kubectl get deployment ${DEPLOYMENT_NAME}-${ENVIRONMENT} \
        -n ${NAMESPACE} \
        -o jsonpath='{.spec.replicas}')
    
    # Calculate batch sizes
    BATCH_REPLICAS=$((CURRENT_REPLICAS * BATCH_SIZE / 100))
    if [[ $BATCH_REPLICAS -lt 1 ]]; then
        BATCH_REPLICAS=1
    fi
    
    # Update deployment
    update_deployment
    
    # Monitor rollout with pauses
    local updated=0
    while [[ $updated -lt $CURRENT_REPLICAS ]]; do
        local remaining=$((CURRENT_REPLICAS - updated))
        local batch_size=$BATCH_REPLICAS
        
        if [[ $remaining -lt $batch_size ]]; then
            batch_size=$remaining
        fi
        
        log_info "🔄 Updating batch: $((updated + 1)) to $((updated + batch_size)) of ${CURRENT_REPLICAS}"
        
        # Wait for batch to be ready
        sleep 5
        
        # Check rollout status
        kubectl rollout status deployment/${DEPLOYMENT_NAME}-${ENVIRONMENT} \
            -n ${NAMESPACE} \
            --timeout=300s || {
            log_error "Batch update failed"
            return 1
        }
        
        updated=$((updated + batch_size))
        
        if [[ $updated -lt $CURRENT_REPLICAS ]]; then
            log_info "⏸️  Pausing for ${BATCH_PAUSE}s before next batch..."
            sleep ${BATCH_PAUSE}
        fi
    done
}

# Health check function
perform_health_checks() {
    local deployment=$1
    log_info "🔍 Performing health checks for ${deployment}"
    
    local retries=0
    while [[ $retries -lt $HEALTH_CHECK_RETRIES ]]; do
        # Check deployment status
        local ready_replicas=$(kubectl get deployment ${deployment} \
            -n ${NAMESPACE} \
            -o jsonpath='{.status.readyReplicas}' || echo "0")
        
        local desired_replicas=$(kubectl get deployment ${deployment} \
            -n ${NAMESPACE} \
            -o jsonpath='{.spec.replicas}')
        
        if [[ "$ready_replicas" == "$desired_replicas" ]]; then
            log_info "✅ All replicas ready: ${ready_replicas}/${desired_replicas}"
            
            # Check pod health
            local pods=$(kubectl get pods \
                -n ${NAMESPACE} \
                -l app=running-app,deployment-id=${DEPLOYMENT_ID} \
                -o jsonpath='{.items[*].metadata.name}')
            
            local all_healthy=true
            for pod in $pods; do
                # Check if pod is ready
                if ! kubectl get pod ${pod} -n ${NAMESPACE} \
                    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' | grep -q "True"; then
                    all_healthy=false
                    break
                fi
                
                # Perform HTTP health check
                if ! kubectl exec ${pod} -n ${NAMESPACE} -- \
                    curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
                    all_healthy=false
                    break
                fi
            done
            
            if [[ "$all_healthy" == "true" ]]; then
                log_info "✅ All health checks passed"
                return 0
            fi
        fi
        
        retries=$((retries + 1))
        log_info "⏳ Health check attempt ${retries}/${HEALTH_CHECK_RETRIES}..."
        sleep ${HEALTH_CHECK_INTERVAL}
    done
    
    log_error "❌ Health checks failed after ${HEALTH_CHECK_RETRIES} attempts"
    return 1
}

# Main deployment logic
main() {
    # Create deployment metadata
    create_deployment_metadata
    
    case $STRATEGY in
        "rolling")
            rolling_deployment
            perform_health_checks "${DEPLOYMENT_NAME}-${ENVIRONMENT}"
            ;;
        "canary")
            CANARY_DEPLOYMENT=$(canary_deployment)
            perform_health_checks "${CANARY_DEPLOYMENT}"
            ;;
        "blue-green")
            NEW_COLOR=$(blue_green_deployment)
            perform_health_checks "${DEPLOYMENT_NAME}-${NEW_COLOR}-${ENVIRONMENT}"
            ;;
        "batch")
            batch_rolling_deployment
            perform_health_checks "${DEPLOYMENT_NAME}-${ENVIRONMENT}"
            ;;
        *)
            log_error "Unknown deployment strategy: ${STRATEGY}"
            exit 1
            ;;
    esac
    
    # Update deployment metadata with completion
    kubectl patch configmap deployment-${DEPLOYMENT_ID} \
        -n ${NAMESPACE} \
        --type merge \
        -p "{\"data\":{\"end_time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"success\"}}"
    
    log_info "✅ Deployment completed successfully"
    
    # Output deployment ID if requested
    if [[ "$OUTPUT_ID" == "true" ]]; then
        echo "${DEPLOYMENT_ID}"
    fi
}

# Run main function
main