import { db } from "@workspace/db";
import {
  ledgerAccountsTable,
  ledgerEntriesTable,
  ledgerReconciliationRunsTable,
  type LedgerEntryRow,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const CURRENCY = "USD";

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
type EntryStatus = "posted" | "pending" | "failed";
type EntrySource = "stripe" | "app_store" | "play_store" | "bank" | "manual";
type ReconStatus = "reconciled" | "pending" | "discrepancy";

// Accounts whose balance increases on the debit side. Everything else
// (liability, equity, revenue) increases on the credit side.
const DEBIT_NORMAL = new Set<AccountType>(["asset", "expense"]);

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

  return { currency: CURRENCY, totalBalance, accounts, reconciliation, transactions };
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
