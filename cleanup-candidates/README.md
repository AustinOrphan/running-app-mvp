# Codebase Cleanup Candidates

This directory contains files that may no longer be needed after the modularization of the training system into separate repositories. Files are organized by confidence level for safe manual review.

## Confidence Levels

### `high-confidence/` (95%+ sure can be removed)

Files that are very likely safe to remove:

- **training-docs/**: Training documentation moved to `training-science-docs` repository
- **services/**: Training services moved to `training-plan-generator` repository
- **duplicates/**: Clear duplicate files with confirmed replacements

### `medium-confidence/` (75-95% sure can be removed)

Files that probably can be removed but need verification:

- **tests/**: Tests for functionality that was moved to other repositories
- **configs/**: Configuration files that may be obsolete
- **utilities/**: Utility functions that might be unused

### `low-confidence/` (50-75% sure can be removed)

Files that might be removable but require careful review:

- **components/**: Components that might be superseded
- **documentation/**: Documentation that might still be relevant
- **scripts/**: Scripts that might still be needed

### `needs-review/` (unclear status)

Files with unclear status that definitely need manual review:

- **misc/**: Everything else that's questionable

## Safety Guidelines

- **NO files have been deleted** - only moved for review
- All files preserve their original directory structure within each confidence folder
- Git history is preserved for all moved files
- Always check for imports/references before permanently removing any file

## Next Steps

1. Review files in order: high-confidence → medium-confidence → low-confidence → needs-review
2. Test the application after removing files from each confidence level
3. Permanently delete only after thorough testing and verification
4. Consider creating git commits after each confidence level cleanup

Generated on: $(date)
