---
name: FinOps backend gating
description: Financial/FinOps endpoints must enforce Orbit-Cost-Readers server-side, not rely on UI route gating.
---

Any financial/FinOps API endpoint (revenue, MRR, subscription financials, cost) must
enforce `requireCostReader` (Orbit-Cost-Readers) at the API layer, not only via the
frontend `<Gated>` route. UI gating is bypassable by calling the endpoint directly.

**Why:** A code review failed the Play subscriptions surface because the endpoint was
mounted with `requireAuth` only while the page was UI-gated to cost readers — any
authenticated staffer could fetch financial data directly.

**How to apply:** Mount such routes as `requireAuth, requireCostReader, <router>` in
`artifacts/api-server/src/routes/index.ts`. Both middlewares are no-ops in mock mode
(no Entra config), so the Replit dev preview keeps working.

**Caveat / inconsistency to watch:** as of this writing the existing financial routes
(`ledgerRouter`, and cost data inside `orbitRouter`) are still only `requireAuth` —
their cost gating is frontend-only. If you touch those, consider closing the same gap.
