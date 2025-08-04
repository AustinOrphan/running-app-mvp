# 8. Use Vite as Frontend Build Tool

Date: 2025-07-28

## Status

Accepted

## Context

We needed a frontend build tool that would:

- Provide fast development experience with hot module replacement (HMR)
- Support modern JavaScript/TypeScript
- Handle CSS preprocessing and bundling
- Optimize production builds
- Work well with React
- Have good developer experience

## Decision

We will use Vite as our frontend build tool and development server.

Key configurations:

- React plugin for JSX transformation
- TypeScript support out of the box
- Proxy configuration for API requests
- Environment variable handling
- Production optimizations

## Consequences

### Positive

- Extremely fast cold starts (< 200ms)
- Instant HMR (Hot Module Replacement)
- No bundling in development (native ESM)
- Excellent TypeScript support
- Modern defaults (ES modules, dynamic imports)
- Built-in optimizations for production
- Great plugin ecosystem
- Minimal configuration needed

### Negative

- Relatively newer tool (less battle-tested than webpack)
- Different dev/prod behavior could mask issues
- Some older libraries may have compatibility issues
- Less extensive ecosystem than webpack
- Learning curve for webpack users

## Implementation Details

### Configuration

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### Performance Metrics

- Development server start: ~150ms
- HMR update: <50ms
- Production build: ~10 seconds
- Bundle size: 200KB gzipped (vs 350KB with Create React App)

## Alternatives Considered

1. **Create React App (webpack)**:
   - Pros: Battle-tested, huge ecosystem, no config
   - Cons: Slow builds, no customization without ejecting
   - Rejected due to performance and flexibility concerns

2. **Next.js**:
   - Pros: Full-stack framework, SSR/SSG, great DX
   - Cons: Opinionated, overkill for SPA
   - Rejected as we need separate backend

3. **Parcel**:
   - Pros: Zero config, good performance
   - Cons: Less control, smaller ecosystem
   - Rejected in favor of Vite's superior DX

4. **Webpack 5 (custom)**:
   - Pros: Ultimate flexibility, mature
   - Cons: Complex configuration, slower builds
   - Rejected due to configuration complexity

5. **esbuild**:
   - Pros: Extremely fast, written in Go
   - Cons: Limited features, less mature
   - Rejected as too low-level for direct use

6. **Rollup**:
   - Pros: Great for libraries, clean output
   - Cons: More complex for applications
   - Rejected (but Vite uses it for production builds)

## Migration Considerations

From Create React App:

1. Move public assets to correct location
2. Update environment variable prefix (VITE* instead of REACT_APP*)
3. Configure proxy for API calls
4. Update import aliases
5. Adjust any webpack-specific code

## Development Workflow

1. Start dev server: `npm run dev:frontend`
2. Automatic HMR on file changes
3. TypeScript errors shown in browser
4. API calls proxied to backend
5. Build for production: `npm run build`

## Production Optimizations

1. Automatic code splitting
2. CSS code splitting
3. Asset optimization and hashing
4. Tree shaking
5. Minification
6. Legacy browser support via @vitejs/plugin-legacy

## Future Considerations

- Evaluate Turbopack when stable
- Consider Module Federation for micro-frontends
- Add PWA support if needed
- Implement build-time analytics

## References

- [Vite Documentation](https://vitejs.dev/)
- [Why Vite](https://vitejs.dev/guide/why.html)
- [Migrating from Create React App](https://vitejs.dev/guide/migration.html)
