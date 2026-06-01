import { db, pool, appUsersTable, clerkActivityDailyTable } from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";

// Dev-only seed for the Users & activity dashboard. Populates anonymous
// Clerk-shaped activity (opaque ids + timestamps ONLY — no emails or names) so
// the preview shows realistic counts before real Clerk webhooks are connected.
// Idempotent: re-running clears prior seed rows first.
//
//   pnpm --filter @workspace/scripts run seed-clerk-activity

const CLERK_APPS = [
  { id: "grailbabe", base: 4200 },
  { id: "grailbabe-dev", base: 45 },
];

const DAY = 86_400_000;

async function counts(appId: string) {
  const r = await db.execute(sql`
    select
      count(*) filter (where not deleted) as total,
      count(*) filter (where not deleted and last_active_at >= now() - interval '24 hours') as dau,
      count(*) filter (where not deleted and last_active_at >= now() - interval '7 days') as wau,
      count(*) filter (where not deleted and last_active_at >= now() - interval '30 days') as mau
    from app_users where app_id = ${appId}
  `);
  const row = (r.rows?.[0] ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Number(v) || 0;
  return { total: n(row.total), dau: n(row.dau), wau: n(row.wau), mau: n(row.mau) };
}

async function main() {
  for (const app of CLERK_APPS) {
    // Clear prior seed users (prefixed) + this app's snapshots so re-runs are clean.
    await db
      .delete(appUsersTable)
      .where(
        and(eq(appUsersTable.appId, app.id), like(appUsersTable.clerkUserId, "seed_%")),
      );
    await db
      .delete(clerkActivityDailyTable)
      .where(eq(clerkActivityDailyTable.appId, app.id));

    const total = Math.floor(app.base * (0.85 + Math.random() * 0.3));
    const now = Date.now();
    const rows: (typeof appUsersTable.$inferInsert)[] = [];
    for (let i = 0; i < total; i++) {
      const createdDaysAgo = Math.floor(Math.random() * 400);
      const r = Math.random();
      const activeDaysAgo =
        r < 0.12
          ? Math.random()
          : r < 0.4
            ? 1 + Math.random() * 6
            : r < 0.7
              ? 7 + Math.random() * 23
              : 30 + Math.random() * 220;
      const created = new Date(now - createdDaysAgo * DAY);
      const active = new Date(now - Math.min(createdDaysAgo, activeDaysAgo) * DAY);
      rows.push({
        appId: app.id,
        clerkUserId: `seed_${app.id}_${i}`,
        createdAt: created,
        lastSignInAt: active,
        lastActiveAt: active,
        deleted: false,
      });
    }
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(appUsersTable).values(rows.slice(i, i + 500)).onConflictDoNothing();
    }

    // Backfill 15 days of daily snapshots (around today's counts) so the DAU
    // trend has a prior data point to compare against.
    const c = await counts(app.id);
    for (let d = 14; d >= 0; d--) {
      const day = new Date(now - d * DAY).toISOString().slice(0, 10);
      const jitter = 0.85 + Math.random() * 0.3;
      const snap = {
        dau: Math.round(c.dau * jitter),
        wau: Math.round(c.wau * jitter),
        mau: Math.round(c.mau * jitter),
        totalMembers: c.total,
      };
      await db
        .insert(clerkActivityDailyTable)
        .values({ appId: app.id, day, ...snap })
        .onConflictDoUpdate({
          target: [clerkActivityDailyTable.appId, clerkActivityDailyTable.day],
          set: snap,
        });
    }
    console.log(`seeded ${app.id}: ${total} users + 15 daily snapshots`);
  }
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
