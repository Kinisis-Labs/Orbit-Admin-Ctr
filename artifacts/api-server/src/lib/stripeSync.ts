import type Stripe from "stripe";
import { getStripeClient } from "./stripeClient";
import { ingestSale, LedgerError } from "./ledger";
import { logger } from "./logger";

export interface StripeSyncSkip {
  chargeId: string;
  reason: string;
}

export interface StripeSyncResult {
  fetched: number;
  imported: number;
  alreadyRecorded: number;
  skipped: number;
  gross: number;
  fee: number;
  net: number;
  skips: StripeSyncSkip[];
}

// Safety cap so a misconfigured account can't fan out into an unbounded import.
const MAX_CHARGES = 1000;
// Keep the skip list readable in the response/UI.
const MAX_SKIPS_REPORTED = 25;

// Pull succeeded Stripe charges and record each as a balanced ledger sale,
// booking Stripe's actual reported per-transaction fee (balance_transaction.fee)
// as the platform-fee expense rather than a flat schedule rate. Idempotent on the
// Stripe charge id via ingestSale's (workload, source, externalRef) seam, so this
// can be re-run safely.
export async function syncStripeSales(
  workloadId: string,
): Promise<StripeSyncResult> {
  const stripe = getStripeClient();
  const result: StripeSyncResult = {
    fetched: 0,
    imported: 0,
    alreadyRecorded: 0,
    skipped: 0,
    gross: 0,
    fee: 0,
    net: 0,
    skips: [],
  };

  const recordSkip = (chargeId: string, reason: string) => {
    result.skipped++;
    if (result.skips.length < MAX_SKIPS_REPORTED) {
      result.skips.push({ chargeId, reason });
    }
  };

  const params: Stripe.ChargeListParams = {
    limit: 100,
    expand: ["data.balance_transaction"],
  };

  for await (const charge of stripe.charges.list(params)) {
    if (result.fetched >= MAX_CHARGES) break;
    result.fetched++;

    if (charge.status !== "succeeded" || !charge.paid) {
      recordSkip(charge.id, `not a succeeded payment (status ${charge.status})`);
      continue;
    }

    const currency = charge.currency?.toLowerCase();
    if (currency !== "usd") {
      recordSkip(charge.id, `non-USD currency (${charge.currency})`);
      continue;
    }

    const bt = charge.balance_transaction;
    if (!bt || typeof bt === "string") {
      recordSkip(charge.id, "balance_transaction not available");
      continue;
    }

    const grossAmount = charge.amount / 100;
    const feeAmount = bt.fee / 100;

    try {
      const sale = await ingestSale(workloadId, {
        source: "stripe",
        grossAmount,
        feeAmount,
        externalRef: charge.id,
        postedAt: new Date(charge.created * 1000),
        ...(charge.description ? { description: charge.description } : {}),
      });
      if (sale.created) {
        result.imported++;
      } else {
        result.alreadyRecorded++;
      }
      result.gross += sale.gross;
      result.fee += sale.fee;
      result.net += sale.net;
    } catch (err) {
      const reason =
        err instanceof LedgerError ? err.message : "failed to record sale";
      logger.warn({ err, chargeId: charge.id }, "stripe sync: skipped charge");
      recordSkip(charge.id, reason);
    }
  }

  // Round running money totals to cents to avoid floating-point drift in the
  // response.
  result.gross = Math.round(result.gross * 100) / 100;
  result.fee = Math.round(result.fee * 100) / 100;
  result.net = Math.round(result.net * 100) / 100;

  return result;
}
