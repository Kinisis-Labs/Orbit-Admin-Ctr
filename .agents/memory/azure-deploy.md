---
name: Azure deploy (Orbit) build gotchas
description: Non-obvious build/packaging facts for the Orbit Azure deploy (Container Apps + SWA). Topology itself lives in replit.md.
---

# Azure deploy build gotchas

- **The API Docker image builds with context = repo ROOT** (`docker build -f artifacts/api-server/Dockerfile .`) because pnpm must resolve workspace libs (`@workspace/db`, `@workspace/api-zod`). Therefore the effective `.dockerignore` MUST live at the repo root — a `.dockerignore` inside `artifacts/api-server/` is silently ignored.
  **Why:** Docker only honors `.dockerignore` at the build-context root. A per-artifact one looks right but does nothing, bloating the context.

- **The runtime Docker stage copies only `dist/` — no `node_modules`.** esbuild (`artifacts/api-server/build.mjs`) bundles all runtime deps (pg, express, stripe, drizzle) plus the pino transport worker chunks into `dist/`. So `node dist/index.mjs` runs standalone.
  **How to apply:** If anyone marks a dep as *external* in build.mjs (or adds a native addon esbuild can't bundle), the slim runtime image will crash with a missing-module error — they must then copy node_modules or keep it bundled.

- **pnpm strict isolation in Docker: esbuild silently skips unresolvable transitive deps instead of failing.** When a package (`@opentelemetry/otlp-transformer`) requires a transitive dep (`protobufjs/minimal`) that pnpm hasn't made accessible in its resolution path, esbuild emits a warning and leaves the `require()` as a runtime call (does NOT fail the build). The image builds, is pushed, but crashes at Container App startup with `MODULE_NOT_FOUND`. Locally pnpm may hoist the package differently so the crash doesn't reproduce.
  **Why:** Docker pnpm strict isolation doesn't hoist transitive packages the same way as Replit's pnpm; esbuild's "missing module" is a non-fatal warning, not an error.
  **Fix:** Add the transitive package as a **direct dependency** of `@workspace/api-server` so pnpm guarantees it's in esbuild's resolution path during Docker build. Example: added `"protobufjs": "^7.0.0"` to fix the applicationinsights → @opentelemetry/otlp-transformer → protobufjs chain.

- **`vite.config.ts` requires `PORT` + `BASE_PATH` env at build time**, even in CI where the SWA build only needs BASE_PATH. The GitHub Actions frontend workflow sets `PORT=3000 BASE_PATH=/` so `vite build` doesn't throw.
