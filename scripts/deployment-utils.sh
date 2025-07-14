#!/bin/bash
# Deployment utility functions for Running App CI/CD

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

# Check if required tools are installed
check_prerequisites() {
    local required_tools=("kubectl" "jq" "curl")
    local missing_tools=()
    
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_error "Please install missing tools before proceeding"
        return 1
    fi
    
    log_info "All required tools are installed"
    return 0
}

# Validate Kubernetes connectivity
validate_k8s_connection() {
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        log_error "Please check your kubeconfig and cluster connectivity"
        return 1
    fi
    
    log_info "Successfully connected to Kubernetes cluster"
    return 0
}

# Check if namespace exists
check_namespace() {
    local namespace=$1
    
    if ! kubectl get namespace "$namespace" &> /dev/null; then
        log_warning "Namespace '$namespace' does not exist"
        log_info "Creating namespace '$namespace'"
        kubectl create namespace "$namespace"
    else
        log_info "Namespace '$namespace' exists"
    fi
}

# Get deployment status
get_deployment_status() {
    local deployment=$1
    local namespace=$2
    
    kubectl get deployment "$deployment" -n "$namespace" \
        -o jsonpath='{.status.conditions[?(@.type=="Progressing")].status}'
}

# Wait for deployment to be ready
wait_for_deployment() {
    local deployment=$1
    local namespace=$2
    local timeout=${3:-600}
    
    log_info "Waiting for deployment '$deployment' to be ready..."
    
    if kubectl wait --for=condition=available \
        --timeout="${timeout}s" \
        deployment/"$deployment" \
        -n "$namespace"; then
        log_success "Deployment '$deployment' is ready"
        return 0
    else
        log_error "Deployment '$deployment' failed to become ready within ${timeout}s"
        return 1
    fi
}

# Scale deployment
scale_deployment() {
    local deployment=$1
    local namespace=$2
    local replicas=$3
    
    log_info "Scaling deployment '$deployment' to $replicas replicas"
    
    kubectl scale deployment "$deployment" \
        -n "$namespace" \
        --replicas="$replicas"
}

# Get pod logs
get_pod_logs() {
    local namespace=$1
    local label_selector=$2
    local tail_lines=${3:-100}
    
    local pods=$(kubectl get pods -n "$namespace" -l "$label_selector" -o jsonpath='{.items[*].metadata.name}')
    
    for pod in $pods; do
        log_info "Logs from pod: $pod"
        kubectl logs "$pod" -n "$namespace" --tail="$tail_lines"
    done
}

# Create or update ConfigMap
create_or_update_configmap() {
    local name=$1
    local namespace=$2
    local data_file=$3
    
    if kubectl get configmap "$name" -n "$namespace" &> /dev/null; then
        log_info "Updating ConfigMap '$name'"
        kubectl create configmap "$name" \
            -n "$namespace" \
            --from-file="$data_file" \
            --dry-run=client -o yaml | \
        kubectl apply -f -
    else
        log_info "Creating ConfigMap '$name'"
        kubectl create configmap "$name" \
            -n "$namespace" \
            --from-file="$data_file"
    fi
}

# Check service health
check_service_health() {
    local service=$1
    local namespace=$2
    local path=${3:-/api/health}
    local expected_status=${4:-200}
    
    # Get service endpoint
    local service_ip=$(kubectl get service "$service" -n "$namespace" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    
    if [ -z "$service_ip" ]; then
        service_ip=$(kubectl get service "$service" -n "$namespace" -o jsonpath='{.spec.clusterIP}')
    fi
    
    if [ -z "$service_ip" ]; then
        log_error "Cannot determine service IP for '$service'"
        return 1
    fi
    
    # Perform health check
    local status_code=$(curl -s -o /dev/null -w "%{http_code}" "http://${service_ip}${path}")
    
    if [ "$status_code" -eq "$expected_status" ]; then
        log_success "Service health check passed (HTTP $status_code)"
        return 0
    else
        log_error "Service health check failed (HTTP $status_code, expected $expected_status)"
        return 1
    fi
}

# Backup current deployment
backup_deployment() {
    local deployment=$1
    local namespace=$2
    local backup_dir=${3:-./backups}
    
    mkdir -p "$backup_dir"
    
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local backup_file="${backup_dir}/${deployment}-${namespace}-${timestamp}.yaml"
    
    log_info "Backing up deployment '$deployment' to $backup_file"
    
    kubectl get deployment "$deployment" -n "$namespace" -o yaml > "$backup_file"
    
    # Also backup associated resources
    kubectl get service,configmap,secret \
        -n "$namespace" \
        -l "app=${deployment%%-*}" \
        -o yaml >> "$backup_file"
    
    log_success "Backup completed: $backup_file"
    echo "$backup_file"
}

# Rollback deployment
rollback_deployment() {
    local deployment=$1
    local namespace=$2
    local revision=${3:-0}
    
    log_info "Rolling back deployment '$deployment'"
    
    if [ "$revision" -eq 0 ]; then
        kubectl rollout undo deployment/"$deployment" -n "$namespace"
    else
        kubectl rollout undo deployment/"$deployment" -n "$namespace" --to-revision="$revision"
    fi
    
    # Wait for rollback to complete
    kubectl rollout status deployment/"$deployment" -n "$namespace"
}

# Get deployment metrics
get_deployment_metrics() {
    local deployment=$1
    local namespace=$2
    
    log_info "Deployment metrics for '$deployment':"
    
    # Get replica status
    kubectl get deployment "$deployment" -n "$namespace" \
        -o jsonpath='{
            "Desired replicas: "}{.spec.replicas}{"\n"}{
            "Current replicas: "}{.status.replicas}{"\n"}{
            "Ready replicas: "}{.status.readyReplicas}{"\n"}{
            "Available replicas: "}{.status.availableReplicas}{"\n"}'
    
    # Get resource usage
    kubectl top pods -n "$namespace" -l "app=${deployment%%-*}"
}

# Validate image exists
validate_image() {
    local image=$1
    
    # Extract registry, repository, and tag
    local registry=$(echo "$image" | cut -d'/' -f1)
    local repository=$(echo "$image" | cut -d'/' -f2- | cut -d':' -f1)
    local tag=$(echo "$image" | cut -d':' -f2)
    
    log_info "Validating image: $image"
    
    # For Docker Hub
    if [[ "$registry" != *"."* ]]; then
        # Docker Hub API check
        local status=$(curl -s -o /dev/null -w "%{http_code}" \
            "https://hub.docker.com/v2/repositories/${repository}/tags/${tag}/")
        
        if [ "$status" -eq 200 ]; then
            log_success "Image exists in Docker Hub"
            return 0
        fi
    fi
    
    # For other registries, assume it exists if we can't check
    log_warning "Cannot validate image existence, proceeding anyway"
    return 0
}

# Send deployment notification
send_notification() {
    local status=$1
    local message=$2
    local webhook_url=${SLACK_WEBHOOK_URL:-}
    
    if [ -z "$webhook_url" ]; then
        log_warning "No webhook URL configured, skipping notification"
        return
    fi
    
    local color="good"
    local emoji=":white_check_mark:"
    
    if [ "$status" == "failure" ]; then
        color="danger"
        emoji=":x:"
    elif [ "$status" == "warning" ]; then
        color="warning"
        emoji=":warning:"
    fi
    
    local payload=$(cat <<EOF
{
    "attachments": [{
        "color": "${color}",
        "title": "${emoji} Deployment Notification",
        "text": "${message}",
        "fields": [
            {
                "title": "Environment",
                "value": "${ENVIRONMENT:-unknown}",
                "short": true
            },
            {
                "title": "Triggered By",
                "value": "${GITHUB_ACTOR:-system}",
                "short": true
            },
            {
                "title": "Deployment ID",
                "value": "${DEPLOYMENT_ID:-unknown}",
                "short": true
            },
            {
                "title": "Timestamp",
                "value": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
                "short": true
            }
        ],
        "footer": "Running App CI/CD",
        "ts": $(date +%s)
    }]
}
EOF
)
    
    curl -X POST -H 'Content-type: application/json' \
        --data "$payload" \
        "$webhook_url" &> /dev/null || log_warning "Failed to send notification"
}

# Export functions
export -f log_info log_success log_warning log_error
export -f check_prerequisites validate_k8s_connection check_namespace
export -f get_deployment_status wait_for_deployment scale_deployment
export -f get_pod_logs create_or_update_configmap check_service_health
export -f backup_deployment rollback_deployment get_deployment_metrics
export -f validate_image send_notification