import { sign as cryptoSign, createPrivateKey } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { ingestSale, LedgerError } from "./ledger.js";
import { isAppleConfigured } from "./appleSubscriptions.js";
import { logger } from "./logger.js";

const gunzipAsync = promisify(gunzip);

// Config gate: all three existing Apple API credentials PLUS the vendor number
// that scopes financial/subscription reports. The vendor number is distinct from
// the API key credentials; it lives in App Store Connect → Payments and Financial
// Reports → "Vendor/Provider" column.
//
// APPLE_VENDOR_NUMBER — numeric vendor number from App Store Connect
export function isAppleReportConfigured(): boolean {
  return (
    isAppleConfigured() &&
    Boolean(process.env.APPLE_VENDOR_NUMBER?.trim())
  );
}

// Generate a short-lived ES256 JWT for App Store Connect API requests.
// The .p8 private key is ECDSA P-256; Node's built-in crypto handles it
// without any external dependency. dsaEncoding "ieee-p1363" gives the raw
// r||s form (64 bytes for P-256) that JWT requires instead of ASN.1 DER.
function createAppStoreJwt(): string {
  const issuerId = process.env.APPLE_CONNECT_ISSUER_ID!;
  const keyId = process.env.APPLE_CONNECT_KEY_ID!;
  // .p8 files sometimes have escaped newlines when stored as env vars.
  const pem = process.env.APPLE_CONNECT_PRIVATE_KEY!.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 1200, // App Store Connect allows up to 20 min
    aud: "appstoreconnect-v1",
  };

  const enc = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const key = createPrivateKey(pem);
  const sig = cryptoSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${sig.toString("base64url")}`;
}

type ReportRow = Record<string, string>;

// Fetch one month's SUBSCRIPTION_EVENT DETAILED report from App Store Connect.
// The response is a gzip-compressed TSV. Returns [] when no report exists for
// the period (Apple returns 404 for future or not-yet-available months).
async function fetchAppleSubscriptionReport(month: string): Promise<ReportRow[]> {
  const vendorNumber = process.env.APPLE_VENDOR_NUMBER!;
  const jwt = createAppStoreJwt();

  const url = new URL("https://api.appstoreconnect.apple.com/v1/salesReports");
  url.searchParams.set("filter[reportType]", "SUBSCRIPTION_EVENT");
  url.searchParams.set("filter[reportSubType]", "DETAILED");
  url.searchParams.set("filter[frequency]", "MONTHLY");
  url.searchParams.set("filter[vendorNumber]", vendorNumber);
  url.searchParams.set("filter[reportDate]", month);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/a-gzip",
    },
  });

  if (res.status === 404) {
    logger.info({ month }, "Apple report: no report available for this month");
    return [];
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apple Reports API ${res.status}: ${body.slice(0, 300)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  // Reports are always gzip-compressed; the Content-Type confirms it but we
  // attempt decompression regardless since Apple is consistent here.
  let tsv: string;
  try {
    tsv = (await gunzipAsync(buf)).toString("utf-8");
  } catch {
    // Non-gzip body (e.g. Apple returned a JSON error despite 2xx).
    tsv = buf.toString("utf-8");
  }

  const lines = tsv.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0]!.split("\t").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    return Object.fromEntries(headers.map((h, i) => [h, cols[i]?.trim() ?? ""]));
  });
}

// Revenue-generating subscription event types. Cancellations, expirations,
// trial starts, and grace-period entries carry no proceeds and are skipped.
const REVENUE_EVENTS = new Set(["subscribe", "renew", "resubscribe"]);

function firstNonEmpty(...vals: string[]): string {
  return vals.find((v) => Boolean(v) && v !== "0") ?? "";
}

export type StoreReportResult = {
  month: string;
  appId: string;
  total: number;
  ingested: number;
  skipped: number;
  errors: number;
  totalGross: number;
  totalFee: number;
  dataSource: "app_store" | "play_store";
};

// Pull the SUBSCRIPTION_EVENT report for one app / one calendar month and
// write each renewal or new subscription into the ledger via ingestSale.
//
// Idempotency: the (workloadId, source, externalRef) unique constraint in the
// ledger prevents double-counting when the same month is re-ingested. The
// externalRef is "{subscriberId}:{eventDate}:{subscriptionAppleId}".
//
// Fee precision: we use the actual (customerPrice - developerProceeds) from the
// report rather than the flat 30% schedule, so long-term subscribers who earn
// the reduced 15% rate are booked correctly.
//
// Multi-currency: only USD rows are ingested today. Non-USD rows are counted in
// skipped. An FX-rate seam can be added when needed.
export async function ingestAppleReport(
  appId: string,
  month: string,
): Promise<StoreReportResult> {
  const rows = await fetchAppleSubscriptionReport(month);

  let ingested = 0;
  let skipped = 0;
  let errors = 0;
  let totalGross = 0;
  let totalFee = 0;

  for (const row of rows) {
    const event = (row["Event"] ?? "").toLowerCase().trim();

    if (!REVENUE_EVENTS.has(event)) {
      skipped++;
      continue;
    }

    const currency = row["Currency"] ?? "";
    if (currency !== "USD") {
      skipped++;
      continue;
    }

    const customerPriceStr = firstNonEmpty(
      row["Standard Customer Price"] ?? "",
      row["Promotional Customer Price"] ?? "",
      row["Introductory Customer Price"] ?? "",
    );
    const proceedsStr = firstNonEmpty(
      row["Proceeds"] ?? "",
      row["Promotional Proceeds"] ?? "",
      row["Introductory Proceeds"] ?? "",
    );

    const grossAmount = parseFloat(customerPriceStr);
    if (!isFinite(grossAmount) || grossAmount <= 0) {
      skipped++;
      continue;
    }

    const proceeds = parseFloat(proceedsStr || customerPriceStr);
    const feeAmount = Math.max(0, grossAmount - proceeds);

    const subscriberId = row["Subscription Identifier"] ?? "";
    const eventDate = row["Event Date"] ?? month;
    const subscriptionAppleId =
      row["Subscription Apple ID"] ?? row["App Apple ID"] ?? "";
    const externalRef = `${subscriberId}:${eventDate}:${subscriptionAppleId}`;

    const subscriptionName =
      row["Subscription Name"] ?? row["App Name"] ?? "Subscription";

    try {
      const result = await ingestSale(appId, {
        source: "app_store",
        grossAmount,
        feeAmount: feeAmount > 0 ? feeAmount : undefined,
        description: `${subscriptionName} — ${event} (App Store ${eventDate})`,
        externalRef,
        postedAt: new Date(eventDate),
      });
      if (result.created) {
        ingested++;
        totalGross += result.gross;
        totalFee += result.fee;
      } else {
        skipped++; // idempotent replay, already recorded
      }
    } catch (err) {
      if (err instanceof LedgerError && err.statusCode === 400) {
        // Chart-of-accounts not set up for this workload — surface immediately.
        throw err;
      }
      errors++;
      logger.warn({ err, externalRef }, "Apple report row ingestion failed");
    }
  }

  logger.info(
    { appId, month, total: rows.length, ingested, skipped, errors },
    "Apple App Store report ingestion complete",
  );

  return {
    month,
    appId,
    total: rows.length,
    ingested,
    skipped,
    errors,
    totalGross: Math.round(totalGross * 100) / 100,
    totalFee: Math.round(totalFee * 100) / 100,
    dataSource: "app_store",
  };
}
