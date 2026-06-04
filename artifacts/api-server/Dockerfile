# syntax=docker/dockerfile:1
#
# Container image for the Orbit API (Express). Runs on Azure Container Apps
# (ca-orbit-api-prod). The esbuild build bundles the workspace libs
# (@workspace/db, @workspace/api-zod) and all runtime deps (pg, express, stripe,
# drizzle, pino) into dist/, so the runtime stage only needs Node + dist/.

# ---- Build stage ----------------------------------------------------------
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo

# Copy the whole monorepo (see .dockerignore for exclusions) so pnpm can
# resolve workspace dependencies, then install with the committed lockfile.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

# ---- Runtime stage --------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV PORT=80
WORKDIR /app
COPY --from=build /repo/artifacts/api-server/dist ./dist
EXPOSE 80
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
