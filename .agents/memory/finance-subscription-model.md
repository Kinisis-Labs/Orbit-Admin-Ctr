---
name: Finance/ledger subscription model
description: Where finance/ledger data actually comes from, and how it diverges from the architecture spec.
---

Finance/ledger data is sourced from **3 subscriptions**, NOT an isolated finance sub:
- `sub-sharedplatform-prod`
- `sub-grailbabe-prod`
- `sub-grailbabedev-dev`

**Why it matters:** `docs/architecture-spec.md` (§4 inventory + §5.2 subscription table)
still describes a "Finance-isolated" `sub-kinisis-finance-prod` holding `ledger-api`.
That model is **stale/incorrect** per the user — finance is per-workload across the
3 subs above. The user explicitly chose NOT to update the spec, so the doc and reality
diverge on purpose; trust this note over the spec for the finance topology.

**How to apply:** The finance boundary is logical (cost-center / data-class tags + RBAC),
not a physical subscription isolation. A real Ledger API must read and reconcile
settlement *across all 3 subs*. Note these names also differ from the placeholder
`subscriptionId` values in the mock data (`a1f4-shared-platform`, `b203-internal-tools`).
