#!/bin/bash

# Repository Cleanup Script
# This script helps automate the cleanup of duplicate files, caches, and unnecessary files

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
DRY_RUN=false
VERBOSE=false
BACKUP_BRANCH="backup/pre-cleanup-$(date +%Y%m%d-%H%M%S)"
CLEANUP_BRANCH="cleanup/repository-reorganization"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Repository Cleanup Script"
            echo ""
            echo "Usage: ./cleanup-script.sh [options]"
            echo ""
            echo "Options:"
            echo "  --dry-run    Show what would be deleted without actually deleting"
            echo "  --verbose    Show detailed output"
            echo "  --help       Show this help message"
            echo ""
            echo "This script will:"
            echo "  1. Create a backup branch"
            echo "  2. Remove duplicate files (with ' 2' or ' 3' suffixes)"
            echo "  3. Remove cache directories"
            echo "  4. Remove test output logs"
            echo "  5. Update .gitignore"
            echo "  6. Install dependencies"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Function to print colored messages
print_info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Function to execute or simulate commands
execute_command() {
    local cmd="$1"
    local description="$2"

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}→${NC} $description"
        echo "  Command: $cmd"
    fi

    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY RUN]${NC} Would execute: $cmd"
    else
        eval "$cmd"
        if [ $? -eq 0 ]; then
            print_success "$description"
        else
            print_error "Failed: $description"
            return 1
        fi
    fi
}

# Function to remove files/directories
remove_item() {
    local item="$1"
    local description="$2"

    if [ -e "$item" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo -e "${YELLOW}[DRY RUN]${NC} Would remove: $item"
        else
            rm -rf "$item"
            print_success "Removed: $item"
        fi
    elif [ "$VERBOSE" = true ]; then
        print_info "Not found (skipping): $item"
    fi
}

# Header
echo "======================================"
echo "Repository Cleanup Script"
echo "======================================"
echo ""

if [ "$DRY_RUN" = true ]; then
    print_warning "Running in DRY RUN mode - no files will be deleted"
    echo ""
fi

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the repository root."
    exit 1
fi

# Step 1: Git backup (optional, only if not in dry run)
if [ "$DRY_RUN" = false ]; then
    echo "Step 1: Creating Git Backup"
    echo "----------------------------"

    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        print_warning "You have uncommitted changes. Please commit or stash them first."
        read -p "Do you want to continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    # Create backup branch
    print_info "Creating backup branch: $BACKUP_BRANCH"
    git checkout -b "$BACKUP_BRANCH" 2>/dev/null || print_warning "Backup branch already exists"

    # Return to original branch or create cleanup branch
    git checkout - 2>/dev/null
    echo ""
fi

# Step 2: Remove duplicate files
echo "Step 2: Removing Duplicate Files"
echo "---------------------------------"

print_info "Finding files with ' 2' suffix..."
find . -type f -name "* 2.*" ! -path "./node_modules/*" ! -path "./.git/*" | while read -r file; do
    remove_item "$file" "Duplicate file"
done

print_info "Finding files with ' 3' suffix..."
find . -type f -name "* 3.*" ! -path "./node_modules/*" ! -path "./.git/*" | while read -r file; do
    remove_item "$file" "Duplicate file"
done

# Special case for duplicate directories
remove_item "node_modules 2" "Duplicate node_modules directory"
remove_item "--version" "Accidentally created directory"

echo ""

# Step 3: Remove cache directories
echo "Step 3: Removing Cache Directories"
echo "-----------------------------------"

cache_dirs=(
    ".jest-cache"
    ".playwright-cache"
    ".vitest-cache"
    ".test-results"
    "test-results"
    "playwright-report"
    "playwright-results"
    "coverage-integration"
    "tmp"
    ".nyc_output"
)

for dir in "${cache_dirs[@]}"; do
    remove_item "$dir" "Cache directory"
done

echo ""

# Step 4: Remove test output logs
echo "Step 4: Removing Test Output Files"
echo "-----------------------------------"

print_info "Finding test output logs..."
find . -type f -name "test-output-*.log" ! -path "./node_modules/*" ! -path "./.git/*" | while read -r file; do
    remove_item "$file" "Test output log"
done

# Remove other log files that shouldn't be committed
find . -type f -name "*.log" ! -path "./node_modules/*" ! -path "./.git/*" ! -name "package-lock.json" | while read -r file; do
    if [ "$VERBOSE" = true ]; then
        print_info "Found log file: $file"
    fi
    read -p "Remove $file? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        remove_item "$file" "Log file"
    fi
done

echo ""

# Step 5: Update .gitignore
echo "Step 5: Updating .gitignore"
echo "----------------------------"

if [ "$DRY_RUN" = false ]; then
    # Check if .gitignore exists
    if [ ! -f .gitignore ]; then
        print_warning ".gitignore not found, creating new one"
        touch .gitignore
    fi

    # Add entries if they don't exist
    gitignore_entries=(
        "# Dependencies"
        "node_modules/"
        "**/node_modules/"
        ""
        "# Cache directories"
        ".jest-cache/"
        ".vitest-cache/"
        ".playwright-cache/"
        ".test-results/"
        "test-results/"
        "playwright-report/"
        "playwright-results/"
        "coverage/"
        "coverage-*/"
        ".nyc_output/"
        ""
        "# Build artifacts"
        "dist/"
        "build/"
        ""
        "# Test outputs"
        "*.log"
        "test-output-*"
        "reports/"
        "tmp/"
        ""
        "# Environment files"
        ".env"
        ".env.local"
        ".env.*.local"
        ""
        "# OS files"
        ".DS_Store"
        "Thumbs.db"
        ""
        "# IDE files"
        ".idea/"
        "*.swp"
        "*.swo"
        "*~"
    )

    print_info "Adding entries to .gitignore..."
    for entry in "${gitignore_entries[@]}"; do
        if ! grep -Fxq "$entry" .gitignore 2>/dev/null; then
            echo "$entry" >> .gitignore
        fi
    done
    print_success "Updated .gitignore"
else
    print_warning "[DRY RUN] Would update .gitignore"
fi

echo ""

# Step 6: Summary
echo "======================================"
echo "Cleanup Summary"
echo "======================================"

if [ "$DRY_RUN" = true ]; then
    print_warning "This was a DRY RUN - no files were actually deleted"
    echo ""
    echo "To perform the actual cleanup, run:"
    echo "  ./cleanup-script.sh"
else
    print_success "Cleanup completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Run 'npm install' to install dependencies"
    echo "2. Run 'npx prisma generate' to generate Prisma client"
    echo "3. Run 'npm run db:migrate' to set up the database"
    echo "4. Commit the cleanup changes"
fi

echo ""
echo "For detailed cleanup plan, see:"
echo "  cleanup-tracking/REPOSITORY_CLEANUP_MASTER_PLAN.md"
echo "  cleanup-tracking/IMMEDIATE_ACTION_PLAN.md"
echo ""

# Optional: Show disk space saved
if command -v du >/dev/null 2>&1; then
    if [ "$DRY_RUN" = false ]; then
        echo "Disk space information:"
        du -sh . 2>/dev/null | awk '{print "  Current repository size: " $1}'
    fi
fi

exit 0
