#!/bin/bash

# Script to organize existing issues into appropriate milestones

echo "Organizing existing issues into milestones..."

# Assign test-related issues to v1.0 - MVP Stabilization
echo "Assigning test stability issues to v1.0 milestone..."

# Issue #112: Fix useGoals test mock utility imports
gh issue edit 112 --milestone "v1.0 - MVP Stabilization"

# Issue #113: Fix API fetch utility mocking inconsistencies  
gh issue edit 113 --milestone "v1.0 - MVP Stabilization"

# Issue #114: Review and improve E2E test reliability
gh issue edit 114 --milestone "v1.0 - MVP Stabilization"

# Issue #115: Add test environment configuration validation
gh issue edit 115 --milestone "v1.0 - MVP Stabilization"

echo "Issues organized successfully!"
echo ""
echo "Summary:"
echo "- Issues #112-115 assigned to v1.0 - MVP Stabilization"
echo ""
echo "Next steps:"
echo "1. Review all open issues"
echo "2. Assign appropriate milestones based on roadmap"
echo "3. Update issue descriptions with roadmap context"
echo "4. Add milestone progress tracking"