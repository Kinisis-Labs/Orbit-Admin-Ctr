import { db, pool } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  ledgerAccountsTable,
  ledgerEntriesTable,
  ledgerReconciliationRunsTable,
} from "@workspace/db";

// Purges demo/seed ledger data from the database. Idempotent — safe to re-run.
//
// Deletes:
//   - ALL ledger_journal_entries for grailbabe, grailbabe-dev, orbit
//   - ALL ledger_reconciliation_runs for the same three workload IDs
//   - ALL ledger_accounts for grailbabe-dev and orbit (orphan workloads)
//     (grailbabe accounts are kept — the chart of accounts is structural)
//
//   pnpm --filter @workspace/scripts run purge-ledger-demo-data

const ALL_WORKLOADS = ["grailbabe", "grailbabe-dev", "orbit"] as const;
const ORPHAN_WORKLOADS = ["grailbabe-dev", "orbit"] as const;

async function main() {
  console.log("Purging demo ledger data…");

  // 1. Journal entries for all three workloads
  const deletedEntries = await db
    .delete(ledgerEntriesTable)
    .where(inArray(ledgerEntriesTable.workloadId, [...ALL_WORKLOADS]))
    .returning({ id: ledgerEntriesTable.id });
  console.log(`  ledger_journal_entries deleted: ${deletedEntries.length}`);

  // 2. Reconciliation runs for all three workloads
  const deletedRuns = await db
    .delete(ledgerReconciliationRunsTable)
    .where(
      inArray(ledgerReconciliationRunsTable.workloadId, [...ALL_WORKLOADS]),
    )
    .returning({ id: ledgerReconciliationRunsTable.id });
  console.log(
    `  ledger_reconciliation_runs deleted: ${deletedRuns.length}`,
  );

  // 3. Accounts for orphan workloads only (grailbabe accounts are kept)
  const deletedAccounts = await db
    .delete(ledgerAccountsTable)
    .where(
      inArray(ledgerAccountsTable.workloadId, [...ORPHAN_WORKLOADS]),
    )
    .returning({ id: ledgerAccountsTable.id });
  console.log(`  ledger_accounts deleted: ${deletedAccounts.length}`);

  console.log("Done.");
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
