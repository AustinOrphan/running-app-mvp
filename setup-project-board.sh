#!/bin/bash

# Script to set up GitHub Project board for roadmap management

echo "Setting up GitHub Project board for Running Tracker MVP..."

# Create the main project board
echo "Creating 'Running Tracker MVP Roadmap' project..."
gh project create --title "Running Tracker MVP Roadmap" \
  --body "Product roadmap and feature development tracking for Running Tracker MVP"

echo ""
echo "Project board created successfully!"
echo ""
echo "Manual setup required:"
echo "1. Visit your GitHub repository"
echo "2. Go to Projects tab"
echo "3. Open the 'Running Tracker MVP Roadmap' project"
echo "4. Configure the following views:"
echo "   - Roadmap (by milestone)"
echo "   - Current Sprint"
echo "   - Backlog"
echo "   - Testing & QA"
echo ""
echo "5. Add custom fields:"
echo "   - Milestone (single select)"
echo "   - Priority (P0-critical, P1-high, P2-medium, P3-low)"
echo "   - Status (Todo, In Progress, Review, Done)"
echo "   - Component (Frontend, Backend, Testing, Infrastructure)"
echo ""
echo "6. Link existing issues to the project"
echo "7. Organize issues by milestones and priorities"