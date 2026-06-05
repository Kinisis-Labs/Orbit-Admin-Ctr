import { db, pool, appThresholdsTable, appThresholdsLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// One-time backfill: creates an initial app_thresholds_log entry for every
// app_thresholds row that was written before the audit-log feature shipped.
// Idempotent: apps that already have at least one log row are skipped.
//
//   pnpm --filter @workspace/scripts run backfill-threshold-history

async function main() {
  const thresholds = await db.select().from(appThresholdsTable);

  if (thresholds.length === 0) {
    console.log("No rows in app_thresholds — nothing to backfill.");
    await pool.end();
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const row of thresholds) {
    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appThresholdsLogTable)
      .where(eq(appThresholdsLogTable.appId, row.appId));

    const alreadyHasHistory = (existing[0]?.count ?? 0) > 0;

    if (alreadyHasHistory) {
      console.log(`  skip  ${row.appId} (already has history)`);
      skipped++;
      continue;
    }

    await db.insert(appThresholdsLogTable).values({
      appId: row.appId,
      oldCpuThreshold: null,
      newCpuThreshold: row.cpuThreshold,
      oldMemoryThreshold: null,
      newMemoryThreshold: row.memoryThreshold,
      changedBy: row.updatedBy || "backfill",
      changedAt: row.updatedAt,
    });

    console.log(`  insert ${row.appId} (backfilled from updatedAt=${row.updatedAt.toISOString()}, updatedBy="${row.updatedBy || "backfill"}")`);
    inserted++;
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
