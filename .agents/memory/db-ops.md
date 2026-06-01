---
name: DB ops in this repo
description: Drizzle schema push behavior and how to apply constraints to populated tables.
---

# DB ops (lib/db, Drizzle + Postgres)

## `drizzle-kit push` is interactive and fails in the agent shell
`pnpm --filter @workspace/db run push` works for plain table/column adds, but
when it would add a **unique/constraint to a table that already has rows** it
prompts ("Do you want to truncate …?") and then dies with
`Interactive prompts require a TTY terminal` because the agent shell has no TTY.

**How to apply:** for constraints on already-populated tables, keep the
declaration in the Drizzle schema (so fresh setups get it) AND apply it to the
live DB directly with SQL (`ALTER TABLE … ADD CONSTRAINT …`). This works when
existing data already satisfies the constraint. `ALTER TABLE ADD CONSTRAINT`
has no `IF NOT EXISTS`, so only run it once.

## Financial amounts
Amounts are `NUMERIC(14,2)`. Drizzle returns them as **strings**; aggregate in
integer cents (`Math.round(Number(x)*100)`) and divide by 100 only at the
response boundary to avoid binary float drift in sums. Single-value display can
use `Number(x)` directly.
