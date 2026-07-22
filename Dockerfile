# syntax=docker/dockerfile:1
#
# Backend image for the Running App.
#
# NOTE (unverified in-container): the install -> postinstall -> build -> boot
# sequence is verified locally (npm ci; npm run build; `NODE_ENV=production
# npx tsx server.ts` serves the SPA and /api/health). What is NOT verified
# here is Docker itself (no daemon in the authoring env) — the stage copying
# below is a reasoned draft, build it before relying on it.
#
# Key facts this image is built around:
#  * The backend is NOT compiled. tsconfig has `noEmit: true`, so `tsc` only
#    type-checks; the sole build output is the vite frontend in dist/, which
#    server.ts serves statically in production. The server therefore runs from
#    TypeScript source via tsx (a devDependency) — so this image ships devDeps.
#  * The app depends on the vendored @AustinOrphan/{config,errors,logger}
#    packages via `file:` links. node_modules/@AustinOrphan/* are symlinks to
#    ../../packages/*, so packages/ must be present at the same relative path
#    (with their built dist/) for both build and runtime.
#  * The entrypoint runs `npx prisma migrate deploy`, so the Prisma CLI
#    (a devDependency) must be present at runtime too.
#  * engines requires Node >=20 (the old images pinned 18).

# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Manifests for the app AND the vendored packages, so the root `postinstall`
# (which builds each package with `tsc`) and the `file:` links resolve.
COPY package*.json ./
COPY packages ./packages
COPY prisma ./prisma

# Full install (incl. devDeps): the vendored packages build with `tsc`, which
# resolves from the root node_modules; postinstall then builds them.
RUN npm ci

# Application source (node_modules/dist are excluded via .dockerignore, so this
# does not clobber the install above or ship a stale build).
COPY . .

ARG NODE_ENV=production
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION
ENV NODE_ENV=${NODE_ENV}

# Generate the Prisma client and build the frontend that server.ts serves.
RUN npx prisma generate \
 && npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat dumb-init
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
WORKDIR /app

# Carry the fully-built tree from the builder. Because the backend runs from
# source under tsx, the runtime needs node_modules (tsx + Prisma CLI + the
# @AustinOrphan symlinks), packages/ (the symlink targets, with built dist/),
# dist/ (frontend static assets), the TS source, prisma/, and scripts. Copying
# /app wholesale keeps those pieces consistent and avoids missing-file drift.
COPY --from=builder --chown=nodejs:nodejs /app /app

# Ensure the entrypoint is executable.
RUN chmod +x ./scripts/docker-entrypoint.sh

# Writable dir for the SQLite database file. Created (and chowned) in the image
# so the compose named volume mounted here inherits nodejs ownership on first
# use; otherwise the volume is root-owned and the non-root process can't write.
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data

ENV NODE_ENV=production
ENV PORT=3001

LABEL org.opencontainers.image.title="Running App" \
      org.opencontainers.image.description="Full-stack running tracker application" \
      org.opencontainers.image.url="https://github.com/${GITHUB_REPOSITORY}" \
      org.opencontainers.image.source="https://github.com/${GITHUB_REPOSITORY}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT"

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node ./scripts/health-check.js || exit 1

# dumb-init reaps zombies and forwards signals to the Node process.
ENTRYPOINT ["dumb-init", "--"]
CMD ["./scripts/docker-entrypoint.sh"]
