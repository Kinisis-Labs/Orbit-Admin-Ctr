import { db } from "@workspace/db";
import {
  ledgerAccountsTable,
  ledgerEntriesTable,
  ledgerReconciliationRunsTable,
  type LedgerEntryRow,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

const CURRENCY = "USD";

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
type EntryStatus = "posted" | "pending" | "failed";
type EntrySource = "stripe" | "app_store" | "play_store" | "bank" | "manual";
type ReconStatus = "reconciled" | "pending" | "discrepancy";

// Accounts whose balance increases on the debit side. Everything else
// (liability, equity, revenue) increases on the credit side.
const DEBIT_NORMAL = new Set<AccountType>(["asset", "expense"]);

// Human-readable labels per ingestion source.
const SOURCE_LABELS: Record<EntrySource, string> = {
  stripe: "Stripe",
  app_store: "Apple App Store",
  play_store: "Google Play Store",
  bank: "Bank",
  manual: "Manual",
};

// Platform fee the storefront/processor keeps of each gross sale, in basis
// points (1% = 100 bps) so the split stays exact in integer cents. Apple takes
// 30%, Google Play 15%, Stripe 3%; bank/manual settlements have no platform cut.
const PLATFORM_FEE_BPS: Record<EntrySource, number> = {
  app_store: 3000,
  play_store: 1500,
  stripe: 300,
  bank: 0,
  manual: 0,
};

export function feeRateFor(source: EntrySource): number {
  return (PLATFORM_FEE_BPS[source] ?? 0) / 10000;
}

// Chart-of-accounts codes a platform sale touches. Gross cash in, gross revenue
// recognized, and the platform fee booked as an expense paid out of cash.
const SALE_CASH_ACCOUNT = "1000";
const SALE_REVENUE_ACCOUNT = "4000";
const SALE_FEE_ACCOUNT = "5100";

// Fixed display order for the per-source revenue breakdown.
const REVENUE_SOURCE_ORDER: EntrySource[] = [
  "stripe",
  "app_store",
  "play_store",
  "bank",
  "manual",
];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Amounts are NUMERIC(14,2). Convert to integer cents so aggregation is exact
// and free of binary floating-point drift; convert back only at the boundary.
function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

function entryId(workloadId: string, id: number): string {
  return `${workloadId}-jrnl-${id}`;
}

// Derive the canonical gross/fee/net of a sale from its persisted journal rows,
// so idempotent replays report what is actually stored rather than echoing the
// (possibly mismatched) request payload. Gross is the cash<-revenue capture leg;
// fee is the processing-fee<-cash leg.
function summarizeSaleRows(rows: LedgerEntryRow[]): {
  grossCents: number;
  feeCents: number;
  netCents: number;
} {
  let grossCents = 0;
  let feeCents = 0;
  for (const r of rows) {
    if (r.debitAccount === SALE_CASH_ACCOUNT && r.creditAccount === SALE_REVENUE_ACCOUNT) {
      grossCents += toCents(r.amount);
    } else if (r.debitAccount === SALE_FEE_ACCOUNT && r.creditAccount === SALE_CASH_ACCOUNT) {
      feeCents += toCents(r.amount);
    }
  }
  return { grossCents, feeCents, netCents: grossCents - feeCents };
}

export interface LedgerEntryDto {
  id: string;
  postedAt: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  status: EntryStatus;
  source: EntrySource;
}

function toEntryDto(row: LedgerEntryRow): LedgerEntryDto {
  return {
    id: entryId(row.workloadId, row.id),
    postedAt: row.postedAt.toISOString(),
    description: row.description,
    debitAccount: row.debitAccount,
    creditAccount: row.creditAccount,
    amount: round2(Number(row.amount)),
    status: row.status as EntryStatus,
    source: row.source as EntrySource,
  };
}

function getAccountRows(workloadId: string) {
  return db
    .select()
    .from(ledgerAccountsTable)
    .where(eq(ledgerAccountsTable.workloadId, workloadId));
}

function getEntryRows(workloadId: string): Promise<LedgerEntryRow[]> {
  return db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.workloadId, workloadId))
    .orderBy(desc(ledgerEntriesTable.postedAt), desc(ledgerEntriesTable.id));
}

export async function listEntries(
  workloadId: string,
  limit = 200,
): Promise<LedgerEntryDto[]> {
  const rows = await getEntryRows(workloadId);
  const capped = Math.max(1, Math.min(Math.trunc(limit), 200));
  return rows.slice(0, capped).map(toEntryDto);
}

function computeReconciliation(entries: LedgerEntryRow[]): {
  status: ReconStatus;
  unreconciledCount: number;
  unreconciledAmount: number;
} {
  const unreconciled = entries.filter((e) => e.status !== "posted");
  const unreconciledAmount =
    unreconciled.reduce((s, e) => s + toCents(e.amount), 0) / 100;
  const status: ReconStatus = unreconciled.some((e) => e.status === "failed")
    ? "discrepancy"
    : unreconciled.length > 0
      ? "pending"
      : "reconciled";
  return { status, unreconciledCount: unreconciled.length, unreconciledAmount };
}

export interface ReconciliationResult {
  status: ReconStatus;
  lastReconciledAt: string;
  unreconciledCount: number;
  unreconciledAmount: number;
}

export async function runReconciliation(
  workloadId: string,
): Promise<ReconciliationResult> {
  const entries = await getEntryRows(workloadId);
  const { status, unreconciledCount, unreconciledAmount } =
    computeReconciliation(entries);
  const [run] = await db
    .insert(ledgerReconciliationRunsTable)
    .values({
      workloadId,
      status,
      unreconciledCount,
      unreconciledAmount: unreconciledAmount.toFixed(2),
    })
    .returning();
  return {
    status,
    lastReconciledAt: run!.ranAt.toISOString(),
    unreconciledCount,
    unreconciledAmount,
  };
}

function latestRun(workloadId: string) {
  return db
    .select()
    .from(ledgerReconciliationRunsTable)
    .where(eq(ledgerReconciliationRunsTable.workloadId, workloadId))
    .orderBy(
      desc(ledgerReconciliationRunsTable.ranAt),
      desc(ledgerReconciliationRunsTable.id),
    )
    .limit(1);
}

export async function getLedgerReport(workloadId: string) {
  const [accountRows, entryRows, runRows] = await Promise.all([
    getAccountRows(workloadId),
    getEntryRows(workloadId),
    latestRun(workloadId),
  ]);

  // Balances are derived from POSTED entries only; pending/failed entries are
  // not part of the settled position. Aggregate in integer cents to stay exact.
  const debitCents = new Map<string, number>();
  const creditCents = new Map<string, number>();
  for (const e of entryRows) {
    if (e.status !== "posted") continue;
    const c = toCents(e.amount);
    debitCents.set(e.debitAccount, (debitCents.get(e.debitAccount) ?? 0) + c);
    creditCents.set(e.creditAccount, (creditCents.get(e.creditAccount) ?? 0) + c);
  }

  const accounts = [...accountRows]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => {
      const debit = debitCents.get(a.code) ?? 0;
      const credit = creditCents.get(a.code) ?? 0;
      const type = a.type as AccountType;
      const balanceCents = DEBIT_NORMAL.has(type)
        ? debit - credit
        : credit - debit;
      return { code: a.code, name: a.name, type, balance: balanceCents / 100 };
    });

  const totalBalance =
    accounts
      .filter((a) => a.type === "asset")
      .reduce((s, a) => s + Math.round(a.balance * 100), 0) / 100;

  const run = runRows[0];
  const live = computeReconciliation(entryRows);
  const reconciliation = run
    ? {
        status: run.status as ReconStatus,
        lastReconciledAt: run.ranAt.toISOString(),
        unreconciledCount: run.unreconciledCount,
        unreconciledAmount: round2(Number(run.unreconciledAmount)),
      }
    : {
        status: live.status,
        lastReconciledAt: new Date().toISOString(),
        unreconciledCount: live.unreconciledCount,
        unreconciledAmount: live.unreconciledAmount,
      };

  const transactions = entryRows.slice(0, 25).map((e) => ({
    id: entryId(e.workloadId, e.id),
    postedAt: e.postedAt.toISOString(),
    description: e.description,
    debitAccount: e.debitAccount,
    creditAccount: e.creditAccount,
    amount: round2(Number(e.amount)),
    status: e.status as EntryStatus,
  }));

  // Revenue breakdown: gross is recognized revenue (credits to the revenue
  // account) and platform fees are the expense legs (debits to the fee account),
  // both grouped by source from POSTED entries. Net = gross - fee.
  const grossBySourceCents = new Map<string, number>();
  const feeBySourceCents = new Map<string, number>();
  for (const e of entryRows) {
    if (e.status !== "posted") continue;
    const c = toCents(e.amount);
    if (e.creditAccount === SALE_REVENUE_ACCOUNT) {
      grossBySourceCents.set(
        e.source,
        (grossBySourceCents.get(e.source) ?? 0) + c,
      );
    }
    if (e.debitAccount === SALE_FEE_ACCOUNT) {
      feeBySourceCents.set(e.source, (feeBySourceCents.get(e.source) ?? 0) + c);
    }
  }

  const revenueBySource = REVENUE_SOURCE_ORDER.map((src) => ({
    src,
    grossCents: grossBySourceCents.get(src) ?? 0,
    feeCents: feeBySourceCents.get(src) ?? 0,
  }))
    .filter((r) => r.grossCents !== 0 || r.feeCents !== 0)
    .map((r) => ({
      source: r.src,
      label: SOURCE_LABELS[r.src],
      feeRate: feeRateFor(r.src),
      gross: r.grossCents / 100,
      fee: r.feeCents / 100,
      net: (r.grossCents - r.feeCents) / 100,
    }));

  const grossTotalCents = [...grossBySourceCents.values()].reduce(
    (s, v) => s + v,
    0,
  );
  const feeTotalCents = [...feeBySourceCents.values()].reduce(
    (s, v) => s + v,
    0,
  );
  const revenue = {
    grossRevenue: grossTotalCents / 100,
    platformFees: feeTotalCents / 100,
    netRevenue: (grossTotalCents - feeTotalCents) / 100,
    bySource: revenueBySource,
  };

  return {
    currency: CURRENCY,
    totalBalance,
    accounts,
    reconciliation,
    transactions,
    revenue,
  };
}

export class LedgerError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "LedgerError";
    this.statusCode = statusCode;
  }
}

export interface PostEntryInput {
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  source?: EntrySource;
  status?: EntryStatus;
  postedAt?: Date;
}

export async function postEntry(
  workloadId: string,
  input: PostEntryInput,
): Promise<LedgerEntryDto> {
  if (input.debitAccount === input.creditAccount) {
    throw new LedgerError(400, "debitAccount and creditAccount must differ");
  }
  if (!(input.amount > 0)) {
    throw new LedgerError(400, "amount must be greater than 0");
  }

  const accountRows = await getAccountRows(workloadId);
  const codes = new Set(accountRows.map((a) => a.code));
  if (codes.size === 0) {
    throw new LedgerError(400, `no chart of accounts for workload ${workloadId}`);
  }
  if (!codes.has(input.debitAccount)) {
    throw new LedgerError(400, `unknown debit account: ${input.debitAccount}`);
  }
  if (!codes.has(input.creditAccount)) {
    throw new LedgerError(400, `unknown credit account: ${input.creditAccount}`);
  }

  const [row] = await db
    .insert(ledgerEntriesTable)
    .values({
      workloadId,
      description: input.description,
      debitAccount: input.debitAccount,
      creditAccount: input.creditAccount,
      amount: input.amount.toFixed(2),
      status: input.status ?? "posted",
      source: input.source ?? "manual",
      ...(input.postedAt ? { postedAt: input.postedAt } : {}),
    })
    .returning();
  return toEntryDto(row!);
}

export interface IngestSaleInput {
  source: EntrySource;
  grossAmount: number;
  // Actual platform fee for this sale. When provided it overrides the flat
  // schedule rate — used by live feeds (e.g. Stripe) that report the real
  // per-transaction fee. When omitted the source's schedule rate is applied.
  feeAmount?: number;
  description?: string;
  externalRef?: string;
  status?: EntryStatus;
  postedAt?: Date;
}

export interface IngestSaleResult {
  source: EntrySource;
  // true when this call recorded new legs; false on an idempotent replay of an
  // already-recorded sale.
  created: boolean;
  feeRate: number;
  gross: number;
  fee: number;
  net: number;
  entries: LedgerEntryDto[];
}

// Record a platform sale as a balanced pair of journal entries so the ledger
// reflects gross revenue, the platform's cut as an expense, and net cash:
//   1) gross capture:  D Cash (gross)  / C Recognized Revenue (gross)
//   2) platform fee:   D Processing Fees (fee) / C Cash (fee)
// Net cash settled = gross - fee. Both legs are written in one transaction so a
// sale never lands half-recorded. Idempotent on (source, externalRef): re-running
// the same external transaction returns the already-recorded pair instead of
// double-counting. The fee leg uses a derived "<ref>:fee" external ref so it does
// not collide with the gross leg under the (workload, source, externalRef) seam.
export async function ingestSale(
  workloadId: string,
  input: IngestSaleInput,
): Promise<IngestSaleResult> {
  if (!(input.grossAmount > 0)) {
    throw new LedgerError(400, "grossAmount must be greater than 0");
  }
  const bps = PLATFORM_FEE_BPS[input.source];
  if (bps === undefined) {
    throw new LedgerError(400, `unknown source: ${input.source}`);
  }

  const accountRows = await getAccountRows(workloadId);
  const codes = new Set(accountRows.map((a) => a.code));
  if (codes.size === 0) {
    throw new LedgerError(400, `no chart of accounts for workload ${workloadId}`);
  }
  for (const code of [SALE_CASH_ACCOUNT, SALE_REVENUE_ACCOUNT, SALE_FEE_ACCOUNT]) {
    if (!codes.has(code)) {
      throw new LedgerError(
        400,
        `chart of accounts for workload ${workloadId} is missing required account ${code}`,
      );
    }
  }

  const grossCents = toCents(input.grossAmount);
  if (grossCents < 1) {
    throw new LedgerError(400, "grossAmount must be at least 0.01");
  }
  // Prefer the actual fee when a live feed supplies it; otherwise fall back to
  // the source's flat schedule rate.
  let feeCents: number;
  if (input.feeAmount !== undefined) {
    if (!(input.feeAmount >= 0)) {
      throw new LedgerError(400, "feeAmount must be zero or greater");
    }
    feeCents = toCents(input.feeAmount);
    if (feeCents > grossCents) {
      throw new LedgerError(400, "feeAmount must not exceed grossAmount");
    }
  } else {
    feeCents = Math.round((grossCents * bps) / 10000);
  }
  const status: EntryStatus = input.status ?? "posted";
  const label = SOURCE_LABELS[input.source];
  const description = input.description ?? `${label} sale`;
  const feeRef = input.externalRef ? `${input.externalRef}:fee` : null;

  const { rows, created } = await db.transaction(async (tx) => {
    // Re-read every leg already recorded for this external ref (both the gross
    // ref and its derived "<ref>:fee"), used for the fast idempotent path and to
    // resolve a lost insert race below.
    const readExisting = () =>
      tx
        .select()
        .from(ledgerEntriesTable)
        .where(
          and(
            eq(ledgerEntriesTable.workloadId, workloadId),
            eq(ledgerEntriesTable.source, input.source),
            inArray(
              ledgerEntriesTable.externalRef,
              feeRef ? [input.externalRef!, feeRef] : [input.externalRef!],
            ),
          ),
        );

    // Idempotency fast path: if this sale was already recorded, return the
    // persisted legs untouched.
    if (input.externalRef) {
      const existing = await readExisting();
      if (existing.length > 0) return { rows: existing, created: false };
    }

    const inserted: LedgerEntryRow[] = [];
    const grossInsert = await tx
      .insert(ledgerEntriesTable)
      .values({
        workloadId,
        description,
        debitAccount: SALE_CASH_ACCOUNT,
        creditAccount: SALE_REVENUE_ACCOUNT,
        amount: (grossCents / 100).toFixed(2),
        status,
        source: input.source,
        externalRef: input.externalRef ?? null,
        ...(input.postedAt ? { postedAt: input.postedAt } : {}),
      })
      .onConflictDoNothing()
      .returning();
    // Lost a concurrent insert race on (workload, source, externalRef): the other
    // request already committed this sale. Return its persisted legs instead of
    // surfacing the unique violation as a 500.
    if (grossInsert.length === 0) {
      return {
        rows: input.externalRef ? await readExisting() : [],
        created: false,
      };
    }
    inserted.push(grossInsert[0]!);

    if (feeCents > 0) {
      const feeInsert = await tx
        .insert(ledgerEntriesTable)
        .values({
          workloadId,
          description: `${label} platform fee`,
          debitAccount: SALE_FEE_ACCOUNT,
          creditAccount: SALE_CASH_ACCOUNT,
          amount: (feeCents / 100).toFixed(2),
          status,
          source: input.source,
          externalRef: feeRef,
          ...(input.postedAt ? { postedAt: input.postedAt } : {}),
        })
        .onConflictDoNothing()
        .returning();
      if (feeInsert[0]) inserted.push(feeInsert[0]);
    }
    return { rows: inserted, created: true };
  });

  // Report the canonical gross/fee/net derived from the persisted rows so an
  // idempotent replay reflects what is stored, not the (possibly mismatched)
  // request payload.
  const summary = summarizeSaleRows(rows);
  return {
    source: input.source,
    created,
    // Effective rate actually booked (matches persisted rows) — equals the
    // schedule rate for estimated fees, or the real rate for live actual fees.
    feeRate: summary.grossCents > 0 ? summary.feeCents / summary.grossCents : 0,
    gross: summary.grossCents / 100,
    fee: summary.feeCents / 100,
    net: summary.netCents / 100,
    entries: rows.map(toEntryDto),
  };
}

/**
 * Current-month gross revenue for a workload, split by channel.
 *
 * Sums all posted credit entries to account 4000 (sale revenue) for the
 * current calendar month. Used by the cost route to surface live revenue
 * instead of the old REVENUE_BY_APP constant.
 *
 * Returns zeroed object when no ledger entries exist (e.g. before any Stripe
 * sync has run or before the app goes live).
 */
export async function getLedgerMonthRevenue(workloadId: string): Promise<{
  stripe: number;
  appStore: number;
  playStore: number;
}> {

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const rows = await db
    .select({
      source: ledgerEntriesTable.source,
      amount: ledgerEntriesTable.amount,
    })
    .from(ledgerEntriesTable)
    .where(
      and(
        eq(ledgerEntriesTable.workloadId, workloadId),
        eq(ledgerEntriesTable.creditAccount, SALE_REVENUE_ACCOUNT),
        gte(ledgerEntriesTable.postedAt, monthStart),
        lte(ledgerEntriesTable.postedAt, monthEnd),
      ),
    );

  let stripe = 0;
  let appStore = 0;
  let playStore = 0;

  for (const row of rows) {
    const amt = parseFloat(String(row.amount));
    if (isNaN(amt)) continue;
    if (row.source === "stripe") stripe += amt;
    else if (row.source === "app_store") appStore += amt;
    else if (row.source === "play_store") playStore += amt;
  }

  return {
    stripe: Number(stripe.toFixed(2)),
    appStore: Number(appStore.toFixed(2)),
    playStore: Number(playStore.toFixed(2)),
  };
}
