# Multi-stage Dockerfile for Running App
# Stage 1: Dependencies
FROM node:18-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production
RUN npm install -g prisma

# Generate Prisma client
RUN npx prisma generate

# Stage 2: Builder
FROM node:18-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Build arguments
ARG NODE_ENV=production
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

# Set build-time environment variables
ENV NODE_ENV=${NODE_ENV}

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Stage 3: Runner
FROM node:18-alpine AS runner
RUN apk add --no-cache libc6-compat dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/prisma ./prisma

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/server.js ./server.js
COPY --from=builder --chown=nodejs:nodejs /app/.env.example ./.env.example

# Copy additional required files
COPY --chown=nodejs:nodejs scripts/docker-entrypoint.sh ./scripts/
COPY --chown=nodejs:nodejs scripts/health-check.js ./scripts/

# Make scripts executable
RUN chmod +x ./scripts/docker-entrypoint.sh

# Set runtime environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Add metadata labels
LABEL org.opencontainers.image.title="Running App" \
      org.opencontainers.image.description="Full-stack running tracker application" \
      org.opencontainers.image.url="https://github.com/${GITHUB_REPOSITORY}" \
      org.opencontainers.image.source="https://github.com/${GITHUB_REPOSITORY}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT"

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node ./scripts/health-check.js || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["./scripts/docker-entrypoint.sh"]