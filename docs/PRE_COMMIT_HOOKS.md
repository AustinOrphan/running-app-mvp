# Pre-commit Hooks Guide

This guide explains how pre-commit hooks work in the Running App MVP project and how to use them effectively.

## Overview

Pre-commit hooks automatically run checks on your code before each commit to ensure code quality and consistency. This project uses:

- **Husky**: Git hooks made easy
- **lint-staged**: Run linters on staged files only

## What Runs on Pre-commit

When you run `git commit`, the following checks are automatically executed:

### 1. ESLint (Auto-fix enabled)

- Checks JavaScript/TypeScript code for errors and style issues
- Automatically fixes fixable issues
- Runs only on staged `.js`, `.jsx`, `.ts`, and `.tsx` files

### 2. Prettier (Auto-format enabled)

- Formats code to ensure consistent style
- Runs on all staged files (JS/TS, JSON, Markdown, YAML)
- Automatically applies formatting

### 3. Vitest (Related tests only)

- Runs tests related to changed files
- Helps catch regressions early
- Only runs tests affected by your changes

### 4. TypeScript Type Checking

- Checks the entire project for type errors
- Ensures type safety across the codebase
- Prevents type-related runtime errors

## Setup

### Initial Setup

The hooks are automatically set up when you run `npm install` thanks to the `prepare` script. However, if you need to set them up manually:

```bash
# Install dependencies
npm install

# Run the setup script
npm run setup:hooks
```

### Manual Hook Installation

If hooks aren't working, you can reinstall them:

```bash
# Remove existing hooks
rm -rf .husky

# Reinstall husky
npx husky init

# Copy hook files
npm run setup:hooks
```

## Usage

### Normal Commit

Just commit as usual:

```bash
git add .
git commit -m "feat: add new feature"
```

The hooks will run automatically and show progress:

```
🚀 Running pre-commit hooks...
📝 Running lint-staged (ESLint, Prettier, and tests for affected files)...
✔ Preparing lint-staged...
✔ Running tasks for staged files...
✔ Applying modifications from tasks...
✔ Cleaning up temporary files...
🔍 Running TypeScript type checking...
✅ All pre-commit checks passed!
```

### Skipping Hooks (Emergency Only)

If you need to commit without running hooks (not recommended):

```bash
git commit --no-verify -m "emergency: quick fix"
```

⚠️ **Warning**: Only skip hooks in emergencies. Always run checks manually afterward:

```bash
npm run lint:check
npm run test:run
```

## Configuration

### lint-staged Configuration

The `lint-staged` configuration in `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write", "vitest related --run"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  }
}
```

### Customizing Hooks

To modify what runs on pre-commit, edit `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Add your custom checks here
```

## Troubleshooting

### Hooks Not Running

1. Check if hooks are installed:

   ```bash
   ls -la .husky/
   ```

2. Make sure hooks are executable:

   ```bash
   chmod +x .husky/pre-commit
   ```

3. Reinstall hooks:
   ```bash
   npm run setup:hooks
   ```

### Tests Taking Too Long

The pre-commit hook only runs tests related to changed files. If it's still slow:

1. Check if you have too many changed files:

   ```bash
   git status
   ```

2. Consider committing in smaller chunks

3. Temporarily skip tests (but run them manually):
   ```bash
   git commit --no-verify
   npm run test:run
   ```

### ESLint/Prettier Conflicts

If you see formatting conflicts:

1. Run the full lint fix:

   ```bash
   npm run lint:fix
   ```

2. Check your editor settings - ensure they match project config

### Type Errors

If TypeScript fails:

1. Check the specific error in the output
2. Run type checking separately for details:

   ```bash
   npm run typecheck
   ```

3. Fix the type errors before committing

## Best Practices

1. **Commit Often**: Smaller commits mean faster hook execution
2. **Fix Issues Immediately**: Don't use `--no-verify` as a habit
3. **Keep Dependencies Updated**: Run `npm update` regularly
4. **Test Hooks Locally**: Run `npm run lint:check` before committing
5. **Configure Your Editor**: Set up ESLint and Prettier in your IDE

## Performance Tips

1. **Stage Selectively**: Only stage files you've actually changed

   ```bash
   git add specific-file.ts
   ```

2. **Use Patch Mode**: For partial file changes

   ```bash
   git add -p
   ```

3. **Run Checks Manually First**: Catch issues before commit
   ```bash
   npm run lint:fix
   npm run test:run
   ```

## Integration with CI/CD

The same checks that run in pre-commit hooks also run in CI/CD:

- Pre-commit: Quick checks on changed files
- CI/CD: Comprehensive checks on entire codebase

This ensures consistency between local development and CI/CD pipeline.

## Further Reading

- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged Documentation](https://github.com/okonet/lint-staged)
- [ESLint Rules](./.eslintrc.json)
- [Prettier Config](./.prettierrc)
