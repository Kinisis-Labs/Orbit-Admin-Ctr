import { inflateRawSync } from "node:zlib";
import { ingestSale, LedgerError } from "./ledger.js";
import { isPlayConfigured } from "./playSubscriptions.js";
import { logger } from "./logger.js";
import type { StoreReportResult } from "./appleReports.js";

// Config gate: the three WIF credentials used by the Play subscriptions surface
// PLUS the GCS bucket name that Google Play Console provisions for your account.
//
// GOOGLE_PLAY_REPORTING_BUCKET — GCS bucket name, e.g. pubsite_prod_rev_01234567890
//   Found in Play Console → Reporting → Financial Reports → "Cloud Storage URI",
//   then strip the gs:// prefix and any trailing path component.
export function isPlayReportConfigured(): boolean {
  return (
    isPlayConfigured() &&
    Boolean(process.env.GOOGLE_PLAY_REPORTING_BUCKET?.trim())
  );
}

// Exchange an Azure managed-identity OIDC token for a Google Cloud access token
// via Workload Identity Federation (WIF). This is the same keyless pattern used
// by the Play subscriptions surface and by Orbit's Azure integrations — no JSON
// service-account key files, org policy compliant.
//
// Steps:
//  1. Azure IMDS: get a short-lived OIDC token scoped to the WIF pool audience.
//  2. Google STS: exchange it for a federated access token.
//  3. Google IAM: impersonate the service account to get GCS-scoped credentials.
async function exchangeForGoogleToken(): Promise<string> {
  const saEmail = process.env.GOOGLE_PLAY_SA_EMAIL!;
  const wifAudience = process.env.GOOGLE_PLAY_WIF_AUDIENCE!;

  // Step 1 — Azure IMDS identity token for the WIF pool audience.
  const imdsUrl =
    "http://169.254.169.254/metadata/identity/oauth2/token" +
    `?api-version=2021-02-01&resource=${encodeURIComponent(wifAudience)}`;
  const imdsRes = await fetch(imdsUrl, { headers: { Metadata: "true" } });
  if (!imdsRes.ok) {
    throw new Error(
      `Azure IMDS ${imdsRes.status}: cannot fetch managed-identity token`,
    );
  }
  const { access_token: subjectToken } = (await imdsRes.json()) as {
    access_token: string;
  };

  // Step 2 — Google STS token exchange.
  const stsRes = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: wifAudience,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requested_token_type:
        "urn:ietf:params:oauth:token-type:access_token",
      subject_token: subjectToken,
      subject_token_type:
        "urn:ietf:params:oauth:token-type:access_token",
    }).toString(),
  });
  if (!stsRes.ok) {
    const body = await stsRes.text();
    throw new Error(`Google STS ${stsRes.status}: ${body.slice(0, 200)}`);
  }
  const { access_token: federatedToken } = (await stsRes.json()) as {
    access_token: string;
  };

  // Step 3 — impersonate the Play service account to get GCS-scoped credentials.
  const iamRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(saEmail)}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${federatedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: [
          "https://www.googleapis.com/auth/devstorage.read_only",
          "https://www.googleapis.com/auth/androidpublisher",
        ],
      }),
    },
  );
  if (!iamRes.ok) {
    const body = await iamRes.text();
    throw new Error(
      `Google IAM impersonation ${iamRes.status}: ${body.slice(0, 200)}`,
    );
  }
  const { accessToken } = (await iamRes.json()) as { accessToken: string };
  return accessToken;
}

// Extract the first .csv file from a ZIP archive buffer using only Node.js
// built-ins (node:zlib inflateRawSync). Handles stored (method 0) and deflated
// (method 8) entries — the two methods Google Play uses for earnings ZIPs.
function extractFirstCsvFromZip(buf: Buffer): string {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;

  // Locate the End of Central Directory record by scanning backwards.
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Not a valid ZIP archive");

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdEntries = buf.readUInt16LE(eocdOffset + 10);

  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(pos) !== CD_SIG) {
      throw new Error("Bad central directory signature at offset " + pos);
    }
    const compression = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const fileNameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const fileName = buf.toString("utf-8", pos + 46, pos + 46 + fileNameLen);

    pos += 46 + fileNameLen + extraLen + commentLen;

    if (!fileName.toLowerCase().endsWith(".csv")) continue;

    if (buf.readUInt32LE(localHeaderOffset) !== LFH_SIG) {
      throw new Error("Bad local file header signature");
    }
    const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset =
      localHeaderOffset + 30 + localFileNameLen + localExtraLen;
    const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);

    if (compression === 0) {
      return compressed.toString("utf-8");
    } else if (compression === 8) {
      return inflateRawSync(compressed).toString("utf-8");
    } else {
      throw new Error(`Unsupported ZIP compression method: ${compression}`);
    }
  }
  throw new Error("No .csv file found inside the earnings ZIP archive");
}

// Download the Google Play earnings report for a given month from the GCS
// bucket. The file lives at earnings/earnings_YYYYMM.zip. Returns empty string
// when the report does not yet exist (404).
async function fetchPlayEarningsReport(month: string): Promise<string> {
  const bucket = process.env.GOOGLE_PLAY_REPORTING_BUCKET!;
  const token = await exchangeForGoogleToken();

  // Play filenames use YYYYMM (no dash).
  const yearMonth = month.replace("-", "");

  // Try raw CSV first (some accounts also publish an unzipped variant).
  const csvObject = encodeURIComponent(`earnings/earnings_${yearMonth}.csv`);
  const csvRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${csvObject}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (csvRes.ok) return csvRes.text();

  // Fall back to the standard ZIP file.
  const zipObject = encodeURIComponent(`earnings/earnings_${yearMonth}.zip`);
  const zipRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${zipObject}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (zipRes.status === 404) {
    logger.info({ month }, "Play report: no earnings report available for month");
    return "";
  }
  if (!zipRes.ok) {
    const body = await zipRes.text();
    throw new Error(`GCS ${zipRes.status}: ${body.slice(0, 200)}`);
  }

  const buf = Buffer.from(await zipRes.arrayBuffer());
  return extractFirstCsvFromZip(buf);
}

type PlayCsvRow = Record<string, string>;

// Parse the Play earnings CSV. Handles optional BOM and double-quoted fields
// (quotes appear on column headers and some value cells).
function parseCsv(text: string): PlayCsvRow[] {
  const lines = text
    .replace(/^\uFEFF/, "") // strip BOM if present
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
  });
}

// Financial status values in the Play earnings CSV that represent a
// completed charge (as opposed to refunds, chargebacks, or pending items).
const CHARGED_STATUSES = new Set(["Charged", "Complete"]);

// Pull the Google Play earnings report for one app / one calendar month and
// write each successful charge into the ledger via ingestSale.
//
// Gross reconstruction: the earnings CSV reports the net merchant amount (USD
// proceeds after Google's 15% fee). We reconstruct gross = net / 0.85 and
// fee = gross − net so the ledger two-leg entry (gross revenue + play fee
// expense) is consistent with the Apple ingestion pattern.
//
// Idempotent: the Google Play order number is the externalRef. Re-ingesting
// the same month is safe; already-recorded orders are counted in skipped.
//
// Dormant until WIF is provisioned: this seam throws when called before the
// Play WIF credentials exist, matching the pattern of fetchLivePlaySubscriptions.
export async function ingestPlayReport(
  appId: string,
  month: string,
): Promise<StoreReportResult> {
  const csv = await fetchPlayEarningsReport(month);

  if (!csv) {
    return {
      month,
      appId,
      total: 0,
      ingested: 0,
      skipped: 0,
      errors: 0,
      totalGross: 0,
      totalFee: 0,
      dataSource: "play_store",
    };
  }

  const rows = parseCsv(csv);
  let ingested = 0;
  let skipped = 0;
  let errors = 0;
  let totalGross = 0;
  let totalFee = 0;

  for (const row of rows) {
    const status =
      row["Financial status"] ??
      row["financial_status"] ??
      row["Order Status"] ??
      "";
    if (!CHARGED_STATUSES.has(status)) {
      skipped++;
      continue;
    }

    // Merchant-currency (USD) amount is what lands in the bank account.
    const merchantAmountStr =
      row["Amount (Merchant Currency)"] ??
      row["amount_merchant_currency"] ??
      "";
    const netProceeds = parseFloat(merchantAmountStr);
    if (!isFinite(netProceeds) || netProceeds <= 0) {
      skipped++;
      continue;
    }

    // Reconstruct gross from net: gross = net / (1 − 0.15) = net / 0.85
    const grossAmount = Math.round((netProceeds / 0.85) * 100) / 100;
    const feeAmount = Math.round((grossAmount - netProceeds) * 100) / 100;

    const orderNumber =
      row["Order Number"] ?? row["order_number"] ?? "";
    if (!orderNumber) {
      skipped++;
      continue;
    }

    const txDate =
      row["Order charged date"] ??
      row["order_charged_date"] ??
      row["Transaction Date"] ??
      month;
    const productTitle =
      row["Product title"] ??
      row["Product type"] ??
      row["Product id"] ??
      "Subscription";

    try {
      const result = await ingestSale(appId, {
        source: "play_store",
        grossAmount,
        feeAmount,
        description: `${productTitle} — charge (Google Play ${txDate.slice(0, 10)})`,
        externalRef: orderNumber,
        postedAt: new Date(txDate),
      });
      if (result.created) {
        ingested++;
        totalGross += result.gross;
        totalFee += result.fee;
      } else {
        skipped++; // idempotent replay
      }
    } catch (err) {
      if (err instanceof LedgerError && err.statusCode === 400) {
        throw err;
      }
      errors++;
      logger.warn({ err, orderNumber }, "Play report row ingestion failed");
    }
  }

  logger.info(
    { appId, month, total: rows.length, ingested, skipped, errors },
    "Google Play earnings report ingestion complete",
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
    dataSource: "play_store",
  };
}
