# Repository Cleanup Plan

## Overview

This repository contains multiple duplicate files that should be consolidated or removed to improve maintainability and reduce confusion.

## Duplicate Files Identified

### Security Files

**Current files:**

- `SECURITY.md` (keep - main security policy)
- `SECURITY 4.md` (remove)
- `SECURITY 5.md` (remove)
- `SECURITY 6.md` (remove)
- `SECURITY_CHECKLIST.md` (keep - useful checklist)
- `SECURITY_CHECKLIST 3.md` (remove)
- `SECURITY_CHECKLIST 4.md` (remove)
- `SECURITY_CHECKLIST 5.md` (remove)
- `SECURITY_CHECKLIST 6.md` (remove)
- `SECURITY_IMPLEMENTATION.md` (keep - implementation details)

**Action:** Remove numbered duplicates, keep main versions.

### Environment Templates

**Current files:**

- `.env.example` (keep - main example)
- `.env.security.template` (keep - security template)
- `.env.security 3.template` (remove)
- `.env.security 4.template` (remove)
- `.env.security 5.template` (remove)
- `.env.security 6.template` (remove)

**Action:** Remove numbered duplicates, keep main versions.

### Node Version Files

**Current files:**

- `.nvmrc` (keep - main version file)
- `.nvmrc 2` (remove)
- `.nvmrc 3` (remove)

**Action:** Remove numbered duplicates, keep main version.

### ESLint Configuration

**Current files:**

- `eslint.config.js` (keep - main config)
- `eslint.config.quality.js` (evaluate - may be specialized)
- `eslint.config.quality 2.js` (remove)

**Action:** Remove duplicate, evaluate if quality config is needed.

### Other Duplicates

**Current files:**

- `.jscpd.json` (keep)
- `.jscpd 2.json` (remove)
- `.npmrc` (keep)
- `.npmrc 2` (remove)
- `.lighthouserc.json` (keep)
- `.lighthouserc 2.json` (remove)
- `sonar-project.properties` (keep)
- `sonar-project 2.properties` (remove)
- `quick-start.sh` (keep)
- `quick-start 2.sh` (remove)

## Cleanup Commands

### Phase 1: Remove Security Duplicates

```bash
rm "SECURITY 4.md" "SECURITY 5.md" "SECURITY 6.md"
rm "SECURITY_CHECKLIST 3.md" "SECURITY_CHECKLIST 4.md" "SECURITY_CHECKLIST 5.md" "SECURITY_CHECKLIST 6.md"
```

### Phase 2: Remove Environment Template Duplicates

```bash
rm ".env.security 3.template" ".env.security 4.template" ".env.security 5.template" ".env.security 6.template"
```

### Phase 3: Remove Node Version Duplicates

```bash
rm ".nvmrc 2" ".nvmrc 3"
```

### Phase 4: Remove Configuration Duplicates

```bash
rm "eslint.config.quality 2.js"
rm ".jscpd 2.json"
rm ".npmrc 2"
rm ".lighthouserc 2.json"
rm "sonar-project 2.properties"
rm "quick-start 2.sh"
```

## Verification Steps

After cleanup:

1. Verify main configuration files still work
2. Test build process: `npm run build`
3. Test linting: `npm run lint`
4. Test development setup: `npm run dev`
5. Verify environment templates are complete

## Files to Keep (Core Repository)

### Essential Configuration

- `package.json` / `package-lock.json`
- `tsconfig.json` / `tsconfig.eslint.json`
- `eslint.config.js`
- `eslint.config.quality.js` (if specialized rules needed)
- `.prettierrc` / `.prettierignore`
- `commitlint.config.js`
- `.nvmrc`
- `.npmrc`

### Environment & Security

- `.env.example`
- `.env.security.template`
- `SECURITY.md`
- `SECURITY_CHECKLIST.md`
- `SECURITY_IMPLEMENTATION.md`

### Documentation

- `README.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `LICENSE`
- `CLAUDE.md`

### Development Tools

- `.gitignore`
- `.editorconfig`
- `jest.config.js`
- `vite.config.ts`
- `lighthouserc.json`
- `sonar-project.properties`
- `.jscpd.json`

### Scripts

- `setup.sh`
- `quick-start.sh`
- `start-dev.sh`
- Scripts in `/scripts/` directory

### Infrastructure

- `Dockerfile` / `Dockerfile.frontend`
- `docker-compose.yml`
- `/deployment/` directory
- `/monitoring/` directory

## Post-Cleanup Benefits

1. **Reduced Confusion**: Clear which files are authoritative
2. **Easier Maintenance**: Single source of truth for configurations
3. **Faster Repository Clones**: Fewer files to download
4. **Cleaner Repository**: Professional appearance
5. **Better Documentation**: Clear file purposes

## Implementation Timeline

- **Immediate**: Remove obvious duplicates (numbered files)
- **Review Phase**: Evaluate specialized configs before removal
- **Testing Phase**: Verify all functionality after cleanup
- **Documentation Update**: Update any references to removed files
