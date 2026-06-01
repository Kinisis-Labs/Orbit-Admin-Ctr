import {
  pgTable,
  serial,
  text,
  timestamp,
  numeric,
  integer,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Chart of accounts, scoped per workload (appId). Each workload that handles
// money keeps its own chart. (workloadId, code) is logically unique.
export const ledgerAccountsTable = pgTable("ledger_accounts", {
  id: serial("id").primaryKey(),
  workloadId: text("workload_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  // asset | liability | equity | revenue | expense
  type: text("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  unique("ledger_accounts_workload_code_uq").on(t.workloadId, t.code),
  check(
    "ledger_accounts_type_chk",
    sql`${t.type} in ('asset','liability','equity','revenue','expense')`,
  ),
]);

// Balanced double-entry journal. Every entry debits one account and credits
// another for the same amount, so debits always equal credits by construction.
export const ledgerEntriesTable = pgTable("ledger_journal_entries", {
  id: serial("id").primaryKey(),
  workloadId: text("workload_id").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  description: text("description").notNull(),
  debitAccount: text("debit_account").notNull(),
  creditAccount: text("credit_account").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  // posted | pending | failed
  status: text("status").notNull().default("posted"),
  // stripe | app_store | play_store | bank | manual — the ingestion seam
  source: text("source").notNull().default("manual"),
  // External system id (e.g. Stripe balance txn) for idempotent ingestion
  externalRef: text("external_ref"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  check("ledger_entries_amount_positive_chk", sql`${t.amount} > 0`),
  check(
    "ledger_entries_distinct_accounts_chk",
    sql`${t.debitAccount} <> ${t.creditAccount}`,
  ),
  check(
    "ledger_entries_status_chk",
    sql`${t.status} in ('posted','pending','failed')`,
  ),
  check(
    "ledger_entries_source_chk",
    sql`${t.source} in ('stripe','app_store','play_store','bank','manual')`,
  ),
  // Idempotency seam for external ingestion (e.g. Stripe). Rows with a NULL
  // external_ref do not collide — Postgres treats NULLs as distinct.
  unique("ledger_entries_external_ref_uq").on(
    t.workloadId,
    t.source,
    t.externalRef,
  ),
]);

// A persisted reconciliation run. The latest run per workload feeds the
// report's reconciliation block.
export const ledgerReconciliationRunsTable = pgTable(
  "ledger_reconciliation_runs",
  {
    id: serial("id").primaryKey(),
    workloadId: text("workload_id").notNull(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    // reconciled | pending | discrepancy
    status: text("status").notNull(),
    unreconciledCount: integer("unreconciled_count").notNull(),
    unreconciledAmount: numeric("unreconciled_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
  },
  (t) => [
    check(
      "ledger_runs_status_chk",
      sql`${t.status} in ('reconciled','pending','discrepancy')`,
    ),
    check("ledger_runs_count_nonneg_chk", sql`${t.unreconciledCount} >= 0`),
  ],
);

export const insertLedgerAccountSchema = createInsertSchema(
  ledgerAccountsTable,
).omit({ id: true, createdAt: true });
export const insertLedgerEntrySchema = createInsertSchema(
  ledgerEntriesTable,
).omit({ id: true, createdAt: true });
export const insertLedgerReconciliationRunSchema = createInsertSchema(
  ledgerReconciliationRunsTable,
).omit({ id: true, ranAt: true });

export type LedgerAccountRow = typeof ledgerAccountsTable.$inferSelect;
export type InsertLedgerAccount = z.infer<typeof insertLedgerAccountSchema>;
export type LedgerEntryRow = typeof ledgerEntriesTable.$inferSelect;
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
export type LedgerReconciliationRunRow =
  typeof ledgerReconciliationRunsTable.$inferSelect;
