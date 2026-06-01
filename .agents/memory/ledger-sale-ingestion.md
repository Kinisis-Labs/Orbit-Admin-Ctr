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

## Fee schedule vs. actual fee

Stored in basis points: app_store 3000 (30%), play_store 1500 (15%),
stripe 300 (3%), bank/manual 0. The bps schedule is only a *fallback estimate*.

**Decision:** the ingestion seam accepts an optional explicit fee override
(`feeAmount`). Live feeds that report the real per-transaction fee must pass it
so the ledger books the *actual* cost, not the flat estimate.
**Why:** real processor fees vary per charge; booking a flat % overstates/understates net.
**How to apply:** when an override is given, validate `0 <= fee <= gross`, book it
verbatim, and report the *effective* rate (`fee/gross`) — never the schedule rate.
The aggregate report's per-source `feeRate` stays the nominal schedule rate; only
gross/fee/net reflect reality.

## Live Stripe

Connected via a raw `STRIPE_SECRET_KEY` secret (user dismissed the Replit Stripe
connector), so use the Stripe SDK directly — NOT the connector's
`getUncachableStripeClient`. Import is **pull-based**: list succeeded charges,
expand `balance_transaction`, book `balance_transaction.fee` as the actual fee,
externalRef = Stripe `charge.id` (idempotent). Scoped to GrailBabe only.
**Why pull, not webhook:** simpler + idempotent re-runs are safe; no webhook
secret/raw-body wiring needed. Apple/Google deferred (APIs not available yet).
