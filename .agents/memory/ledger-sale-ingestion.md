---
name: ledger sale ingestion idempotency
description: Rules for the fee-aware sale ingestion seam in the double-entry ledger (ingestSale / POST /ledger/sales)
---

# Platform-fee-aware sale ingestion

A platform sale is recorded as two journal legs in one DB transaction:
gross capture (D Cash / C Recognized Revenue) and, when fee > 0, a platform-fee
leg (D Processing Fees / C Cash). Net cash = gross - fee.

## Idempotency contract

- Idempotency key is `(workload, source, externalRef)`. The fee leg reuses the
  same key with a derived `"<externalRef>:fee"` so the two legs don't collide
  under the unique constraint.
- **Replays must return canonical values derived from the persisted rows**, not
  the incoming payload. A replay with a *different* grossAmount must still report
  the originally-stored gross/fee/net. Compute the summary from the rows
  (gross = cash<-revenue leg, fee = fees<-cash leg).
- **Concurrency:** use `onConflictDoNothing()` on the inserts; if the gross
  insert returns 0 rows, another request won the race — re-read the existing legs
  and return those. A plain SELECT-then-INSERT races into a unique-violation 500.

## Money handling

**Why:** sub-cent amounts (e.g. 0.001) round to 0 cents and hit the DB
`amount > 0` check constraint as an ugly 500.
**How to apply:** after `toCents(grossAmount)`, reject `< 1` cent with a 400
*before* any insert. Do all fee math in integer cents
(`Math.round(grossCents * bps / 10000)`).

## Fee schedule

Stored in basis points: app_store 3000 (30%), play_store 1500 (15%),
stripe 300 (3%), bank/manual 0. Live Stripe/Apple/Google API clients are a
future follow-up; the generic POST `/apps/{appId}/ledger/sales` is the seam.
