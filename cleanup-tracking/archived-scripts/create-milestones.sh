#!/bin/bash

# Script to create GitHub milestones for the Running Tracker MVP roadmap

echo "Creating GitHub milestones for Running Tracker MVP..."

# Create v1.0 - MVP Stabilization
echo "Creating v1.0 - MVP Stabilization milestone..."
gh milestone create "v1.0 - MVP Stabilization" \
  --description "Stabilize core MVP features, fix test issues, and ensure production readiness" \
  --due-date "2025-02-15"

# Create v1.1 - Enhanced Analytics
echo "Creating v1.1 - Enhanced Analytics milestone..."
gh milestone create "v1.1 - Enhanced Analytics" \
  --description "Add advanced statistics, charts, and goal tracking features" \
  --due-date "2025-04-30"

# Create v1.2 - Route & GPS Features
echo "Creating v1.2 - Route & GPS Features milestone..."
gh milestone create "v1.2 - Route & GPS Features" \
  --description "GPS tracking, GPX file support, and map visualizations" \
  --due-date "2025-07-31"

# Create v1.3 - Social & Sharing
echo "Creating v1.3 - Social & Sharing milestone..."
gh milestone create "v1.3 - Social & Sharing" \
  --description "Social features, run sharing, and community engagement" \
  --due-date "2025-10-31"

# Create v1.4 - Mobile Excellence
echo "Creating v1.4 - Mobile Excellence milestone..."
gh milestone create "v1.4 - Mobile Excellence" \
  --description "PWA implementation, offline functionality, and mobile optimization" \
  --due-date "2026-01-31"

# Create v1.5 - Customization & Themes
echo "Creating v1.5 - Customization & Themes milestone..."
gh milestone create "v1.5 - Customization & Themes" \
  --description "Theme system, personalization, and advanced customization" \
  --due-date "2026-04-30"

echo "All milestones created successfully!"
echo ""
echo "Next steps:"
echo "1. Run: chmod +x create-milestones.sh"
echo "2. Run: ./create-milestones.sh"
echo "3. Assign existing issues to appropriate milestones"