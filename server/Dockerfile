# =============================================================================
# URS-DMS — server Dockerfile (Sprint 1 contract + Sprint 2 implementation)
# Multi-stage build:
#   1. deps        — install all dependencies (cached)
#   2. build       — compile TypeScript → dist/
#   3. runtime     — Alpine + node + production deps + dist + prisma client
# =============================================================================

# ---- 1. deps ---------------------------------------------------------------
FROM node:20-alpine AS deps
RUN sed -i 's/https:/http:/g' /etc/apk/repositories \
    && apk add --no-cache openssl
WORKDIR /app
RUN npm config set strict-ssl false
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

# Copy manifests first to leverage Docker layer caching
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install ALL deps (including devDependencies) so the seed/build stage has them
RUN npm install --legacy-peer-deps

# Generate the Prisma client (needs the schema in this stage)
RUN npx prisma generate

# ---- 2. build --------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY tsconfig.json tsconfig.build.json ./
COPY eslint.config.mjs .prettierrc.json ./
COPY src ./src

# Compile TypeScript (uses tsconfig.build.json → emits to dist/) + rewrite @/ paths
RUN npx tsc -p tsconfig.build.json && npx tsc-alias -p tsconfig.build.json

# ---- 3. runtime ------------------------------------------------------------
FROM node:20-alpine AS runtime
RUN sed -i 's/https:/http:/g' /etc/apk/repositories \
    && apk add --no-cache openssl wget poppler-utils
WORKDIR /app
RUN npm config set strict-ssl false

ENV NODE_ENV=production
ENV PORT=4000

# Create a non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

# Production-only dependencies (no devDeps)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force

# Bring in the compiled output, the Prisma client, and the seed/migration tooling
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Logs directory (mounted as a volume in docker-compose.yml)
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/server.js"]
