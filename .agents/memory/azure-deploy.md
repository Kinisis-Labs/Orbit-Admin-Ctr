---
name: Azure deploy (Orbit) build gotchas
description: Non-obvious build/packaging facts for the Orbit Azure deploy (Container Apps + SWA). Topology itself lives in replit.md.
---

# Azure deploy build gotchas

- **The API Docker image builds with context = repo ROOT** (`docker build -f artifacts/api-server/Dockerfile .`) because pnpm must resolve workspace libs (`@workspace/db`, `@workspace/api-zod`). Therefore the effective `.dockerignore` MUST live at the repo root — a `.dockerignore` inside `artifacts/api-server/` is silently ignored.
  **Why:** Docker only honors `.dockerignore` at the build-context root. A per-artifact one looks right but does nothing, bloating the context.

- **The runtime Docker stage copies only `dist/` — no `node_modules`.** esbuild (`artifacts/api-server/build.mjs`) bundles all runtime deps (pg, express, stripe, drizzle) plus the pino transport worker chunks into `dist/`. So `node dist/index.mjs` runs standalone.
  **How to apply:** If anyone marks a dep as *external* in build.mjs (or adds a native addon esbuild can't bundle), the slim runtime image will crash with a missing-module error — they must then copy node_modules or keep it bundled.

- **`vite.config.ts` requires `PORT` + `BASE_PATH` env at build time**, even in CI where the SWA build only needs BASE_PATH. The GitHub Actions frontend workflow sets `PORT=3000 BASE_PATH=/` so `vite build` doesn't throw.
