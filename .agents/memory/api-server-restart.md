---
name: API server needs full restart for data/route changes
description: The Orbit api-server dev workflow bundles and does not hot-reload edits to route/mock-data files.
---

Editing `artifacts/api-server/src/routes/*.ts` (e.g. the Orbit mock data in `orbit.ts`)
does NOT take effect via HMR — the dev server serves a bundled build.

**Why:** Verified twice — after editing mock data, `curl localhost:80/api/...` kept
returning stale data until the workflow was restarted.

**How to apply:** After any api-server source edit, restart the
`artifacts/api-server: API Server` workflow before cur/UI verification.
