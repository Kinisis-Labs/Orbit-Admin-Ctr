# syntax=docker/dockerfile:1
#
# Container image for apps/api (Orbit API — Express 5, Phase A+).
# esbuild bundles all workspace libs and runtime deps into dist/index.mjs;
# the runtime stage only needs Node + dist/.

# ---- Build stage ----------------------------------------------------------
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/orbit-api run build

# ---- Runtime stage --------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV PORT=80
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
EXPOSE 80
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
