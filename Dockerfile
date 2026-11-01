FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Drop what a SQLite-only install never loads at runtime: other databases' drivers and query
# compilers, pglite, the TypeScript compiler, type declarations, source maps and the SQLite
# amalgamation sources. The migrate smoke test in the final stage fails the build if this removes
# something `prisma migrate deploy` needs.
RUN rm -rf node_modules/@electric-sql node_modules/mysql2 node_modules/postgres \
      node_modules/elkjs node_modules/typescript node_modules/@types node_modules/effect/src \
      node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
 && find node_modules \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete \
 && find node_modules/@prisma/client/runtime node_modules/prisma/build \
      \( -name '*postgresql*' -o -name '*mysql*' -o -name '*sqlserver*' -o -name '*cockroachdb*' \
      -o -name 'query_compiler_small*' \) -delete \
 && rm -f node_modules/@prisma/client/runtime/query_compiler_fast_bg.sqlite.wasm-base64.js

FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL=file:/tmp/smoke.db npx prisma migrate deploy && rm -f /tmp/smoke.db*
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production \
    DATABASE_URL=file:/data/app.db \
    PORT=3001
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Every start copies the database to /data/backups before it migrates (a fresh volume has nothing to
# copy), and a copy that fails integrity_check stops the start. exec replaces the shell, so node is
# PID 1 and receives SIGTERM for its graceful shutdown.
CMD ["sh", "-c", "node dist/scripts/backup.js --before-migrate && npx prisma migrate deploy && exec node dist/server/index.js"]
