# Task Completion Guidelines

## What to Do When a Task is Completed

### 1. Code Quality Checks
Run the following commands to ensure code quality:

**Linting and Formatting:**
```bash
npm run lint                        # Check for linting errors
npm run lint:fix                    # Auto-fix linting issues
npm run format                      # Format code with Prettier
npm run format:check               # Check formatting without changes
npm run typecheck                  # TypeScript compilation check
```

**Manual checks:**
- **Code consistency**: Follow established patterns and conventions
- **Import organization**: ESLint will enforce proper import ordering

### 2. Testing Requirements
Always run relevant tests after making changes:

**For Component Changes:**
```bash
npm run test:run                    # Unit tests
npm run test:a11y                   # Accessibility tests
```

**For API Changes:**
```bash
npm run test:integration            # Backend integration tests
```

**For UI/UX Changes:**
```bash
npm run test:e2e                    # End-to-end tests
npm run test:visual                 # Visual regression tests
```

**For Major Changes:**
```bash
npm run test:all:complete           # All test suites
```

### 3. Build Verification
```bash
npm run build                       # Ensure production build works
```

### 4. Manual Testing
- **Start both servers**: `npm run dev:full`
- **Test affected functionality** in browser
- **Check mobile responsiveness** if UI changes were made
- **Verify accessibility** with screen reader or axe DevTools

### 5. Coverage Verification
For significant changes, check coverage:
```bash
npm run test:coverage:all           # Run coverage analysis
npm run test:coverage:check         # Verify 70% threshold
```

### 6. Database Considerations
If schema changes were made:
```bash
npx prisma migrate dev --name descriptive-name
npx prisma generate
```

### 7. Documentation Updates
- Update README.md if new features were added
- Update API documentation if endpoints changed
- Add inline comments for complex logic

### 8. Code Review Checklist
- [ ] **Linting passes**: `npm run lint`
- [ ] **Formatting correct**: `npm run format:check`
- [ ] **TypeScript compiles**: `npm run typecheck`
- [ ] **Tests pass**: Run appropriate test suites
- [ ] **Build succeeds**: `npm run build`
- [ ] **Follows coding conventions**
- [ ] **Accessibility requirements met**
- [ ] **Performance considerations addressed**
- [ ] **Security best practices followed**
- [ ] **Error handling implemented**

### 9. Git Best Practices
- **Meaningful commit messages** following conventional commits
- **Atomic commits** (one logical change per commit)
- **Branch naming**: feature/, bugfix/, or hotfix/ prefixes

### 10. Performance Considerations
- **Bundle size**: Check if significant dependencies were added
- **Runtime performance**: Verify no unnecessary re-renders
- **Database queries**: Ensure efficient Prisma queries
- **Accessibility**: Screen reader compatibility

## Automated Code Quality
The project now includes:
- **ESLint**: TypeScript, React, and accessibility linting
- **Prettier**: Consistent code formatting
- **Type checking**: Strict TypeScript validation
- **Import ordering**: Automatic import organization