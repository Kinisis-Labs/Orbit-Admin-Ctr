FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/golden-corpus-job run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/golden-corpus-job/dist ./dist
USER node
ENTRYPOINT ["node", "--enable-source-maps", "dist/index.mjs"]
