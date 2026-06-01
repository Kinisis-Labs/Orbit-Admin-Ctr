---
name: Webhook ingestion idempotency
description: Rules for ingesting third-party webhooks (Clerk/Svix) into Postgres rollups without double-counting or data loss.
---

# Webhook ingestion idempotency

When ingesting verified webhooks into aggregate rollups (e.g. Clerk → `app_users` / `*_activity_daily`):

- **Commit the dedupe marker in the same transaction as the downstream mutations.** Insert the dedupe row (`onConflictDoNothing` on the provider's delivery id, e.g. Svix message id) *inside* a `db.transaction` together with the user upsert and snapshot refresh. If you insert the marker first and it commits before a later step fails, the retried delivery is silently skipped (`onConflictDoNothing` sees the marker) and counts drift permanently.
  **Why:** a mid-ingest failure after a committed marker = unrecoverable lost event.
  **How to apply:** dedupe-insert → `if (inserted.length === 0) return;` → mutations → snapshot, all within one `db.transaction(async (tx) => …)`, passing `tx` to every helper.

- **Use event-occurrence time, never ingest time, for activity windows.** Pull the timestamp from the verified payload (Clerk: `data.last_active_at`/`updated_at`/`created_at`, else the event envelope `timestamp`), not `new Date()`. Delayed deliveries, backfills, and replays otherwise all count as "active now" and inflate DAU/WAU/MAU.

- **Guard against out-of-order delivery** when bumping a timestamp on upsert: `set: { lastActiveAt: sql\`greatest(${col}, ${newTs})\` }`. Postgres `GREATEST` ignores NULLs, so first-seen rows take the new value and older events never move a timestamp backwards.

- A drizzle executor that works both standalone and inside a tx: `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]; type Exec = typeof db | Tx;` — type query helpers to accept `Exec`.
