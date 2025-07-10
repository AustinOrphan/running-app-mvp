#!/bin/bash

# Better error handling
set -eo pipefail

# Setup additional GitHub labels for the repository
# Run this script to add the missing labels that the auto-label workflow expects

# Check for gh CLI dependency
if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI (gh) is not installed"
    echo "Please install it from: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Error: GitHub CLI is not authenticated"
    echo "Please run: gh auth login"
    exit 1
fi

echo "🏷️  Setting up additional GitHub labels..."

# Size labels
echo "Creating size labels..."
gh label create "size-small" --description "Small PR: <100 lines changed, <10 files" --color "28a745" --force
gh label create "size-medium" --description "Medium PR: 100-500 lines changed, 10-20 files" --color "ffc107" --force
gh label create "size-large" --description "Large PR: >500 lines changed, >20 files" --color "dc3545" --force

# Status labels
echo "Creating status labels..."
gh label create "work-in-progress" --description "Work in progress, not ready for review" --color "fbca04" --force
gh label create "needs-review" --description "Ready for review, awaiting feedback" --color "0e8a16" --force
gh label create "needs-reproduction" --description "Bug report needs reproduction steps or example" --color "d4c5f9" --force

# Special labels
echo "Creating special labels..."
gh label create "hotfix" --description "Urgent fix for production issue" --color "ff0000" --force
gh label create "breaking-change" --description "Contains breaking changes that affect API or behavior" --color "b60205" --force
gh label create "api-change" --description "Changes to API endpoints or contracts" --color "0075ca" --force
gh label create "migration" --description "Database migration or schema changes" --color "0052cc" --force
gh label create "config" --description "Configuration changes (env, settings, etc.)" --color "f9d0c4" --force

# Automation labels
echo "Creating automation labels..."
gh label create "stale" --description "Automatically marked as stale due to inactivity" --color "fef2c0" --force
gh label create "community" --description "Community contribution or external contribution" --color "0e8a16" --force

echo "✅ All labels created successfully!"
echo ""
echo "📋 Summary of created labels:"
echo "- size-small, size-medium, size-large (PR sizing)"
echo "- work-in-progress, needs-review, needs-reproduction (status)"
echo "- hotfix, breaking-change, api-change, migration, config (special)"
echo "- stale, community (automation)"
echo ""
echo "🚀 Your auto-label workflow is now fully configured!"