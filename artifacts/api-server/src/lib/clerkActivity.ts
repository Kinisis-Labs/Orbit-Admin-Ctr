import { db } from "@workspace/db";
import {
  clerkEventsTable,
  appUsersTable,
  clerkActivityDailyTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { clerkApps } from "../routes/orbit";

// A drizzle executor: either the base client or an open transaction. Lets the
// query helpers run inside `recordEvent`'s transaction or standalone.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

// Per-app Clerk webhook signing secret, stored as an env secret keyed by app:
//   CLERK_WEBHOOK_SECRET__<APPID>   (appId upper-cased, non-alnum -> "_")
// e.g. "grailbabe" -> CLERK_WEBHOOK_SECRET__GRAILBABE,
//      "grailbabe-dev" -> CLERK_WEBHOOK_SECRET__GRAILBABE_DEV
export function clerkSecretFor(appId: string): string | undefined {
  const key =
    "CLERK_WEBHOOK_SECRET__" + appId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return process.env[key];
}

export type ClerkEvent = {
  type: string;
  data: Record<string, unknown>;
  // Clerk event envelope occurrence time (unix seconds or ms).
  timestamp?: number;
};

export type UserActivityRow = {
  appId: string;
  appName: string;
  environment: string;
  totalMembers: number;
  dau: number;
  wau: number;
  mau: number;
  inactive30d: number;
  newLast7d: number;
  dauTrendPct: number;
  dataSource: "live" | "demo";
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Coerce a Clerk numeric timestamp to a Date. Clerk uses unix milliseconds;
// guard against seconds-precision values just in case.
function tsToDate(v: unknown): Date | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function envelopeTime(evt: ClerkEvent): Date | undefined {
  return tsToDate(evt.timestamp);
}

// Trusted "user was active" time from the verified payload — never ingest time,
// so delayed deliveries / replays don't inflate activity windows.
function activityTime(evt: ClerkEvent): Date {
  const d = evt.data ?? {};
  return (
    tsToDate(d.last_active_at) ??
    tsToDate(d.updated_at) ??
    tsToDate(d.created_at) ??
    envelopeTime(evt) ??
    new Date()
  );
}

function createdTime(evt: ClerkEvent): Date {
  return tsToDate(evt.data?.created_at) ?? activityTime(evt);
}

// Clerk user events carry the user id on `data.id`; session events carry it on
// `data.user_id`. Only this opaque id is read — never email/name.
function extractUserId(evt: ClerkEvent): string | undefined {
  const d = evt.data ?? {};
  if (evt.type.startsWith("session.")) {
    return typeof d.user_id === "string" ? d.user_id : undefined;
  }
  return typeof d.id === "string" ? d.id : undefined;
}

async function applyUserEvent(
  exec: Exec,
  appId: string,
  userId: string,
  evt: ClerkEvent,
): Promise<void> {
  const type = evt.type;
  if (type === "user.deleted") {
    await exec
      .update(appUsersTable)
      .set({ deleted: true })
      .where(
        and(
          eq(appUsersTable.appId, appId),
          eq(appUsersTable.clerkUserId, userId),
        ),
      );
    return;
  }

  const active = activityTime(evt);
  // GREATEST ignores NULLs, so first-seen rows take the new value and
  // out-of-order deliveries never move a timestamp backwards.
  const newestActive = sql`greatest(${appUsersTable.lastActiveAt}, ${active})`;

  if (type === "user.created") {
    await exec
      .insert(appUsersTable)
      .values({
        appId,
        clerkUserId: userId,
        createdAt: createdTime(evt),
        lastActiveAt: active,
      })
      .onConflictDoNothing();
    return;
  }

  if (type === "session.created") {
    // A sign-in: ensure the member exists and advance sign-in + activity.
    await exec
      .insert(appUsersTable)
      .values({
        appId,
        clerkUserId: userId,
        lastSignInAt: active,
        lastActiveAt: active,
      })
      .onConflictDoUpdate({
        target: [appUsersTable.appId, appUsersTable.clerkUserId],
        set: {
          lastSignInAt: sql`greatest(${appUsersTable.lastSignInAt}, ${active})`,
          lastActiveAt: newestActive,
          deleted: false,
        },
      });
    return;
  }

  // user.updated / other activity — advance last-active, ensure the row.
  await exec
    .insert(appUsersTable)
    .values({ appId, clerkUserId: userId, lastActiveAt: active })
    .onConflictDoUpdate({
      target: [appUsersTable.appId, appUsersTable.clerkUserId],
      set: { lastActiveAt: newestActive },
    });
}

type Counts = {
  totalMembers: number;
  dau: number;
  wau: number;
  mau: number;
  newLast7d: number;
};

async function computeCounts(exec: Exec, appId: string): Promise<Counts> {
  const r = await exec.execute(sql`
    select
      count(*) filter (where not deleted) as total_members,
      count(*) filter (where not deleted and last_active_at >= now() - interval '24 hours') as dau,
      count(*) filter (where not deleted and last_active_at >= now() - interval '7 days') as wau,
      count(*) filter (where not deleted and last_active_at >= now() - interval '30 days') as mau,
      count(*) filter (where not deleted and created_at >= now() - interval '7 days') as new_last_7d
    from app_users
    where app_id = ${appId}
  `);
  const row = (r.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    totalMembers: num(row.total_members),
    dau: num(row.dau),
    wau: num(row.wau),
    mau: num(row.mau),
    newLast7d: num(row.new_last_7d),
  };
}

// DAU trend vs the most recent daily snapshot at least 7 days old.
async function dauTrend(
  exec: Exec,
  appId: string,
  todayDau: number,
): Promise<number> {
  const r = await exec.execute(sql`
    select dau from clerk_activity_daily
    where app_id = ${appId} and day <= current_date - 7
    order by day desc
    limit 1
  `);
  const prior = num((r.rows?.[0] as Record<string, unknown> | undefined)?.dau);
  if (prior <= 0) return 0;
  return Number((((todayDau - prior) / prior) * 100).toFixed(1));
}

async function refreshDailySnapshot(exec: Exec, appId: string): Promise<void> {
  const c = await computeCounts(exec, appId);
  const today = new Date().toISOString().slice(0, 10);
  await exec
    .insert(clerkActivityDailyTable)
    .values({
      appId,
      day: today,
      dau: c.dau,
      wau: c.wau,
      mau: c.mau,
      totalMembers: c.totalMembers,
    })
    .onConflictDoUpdate({
      target: [clerkActivityDailyTable.appId, clerkActivityDailyTable.day],
      set: {
        dau: c.dau,
        wau: c.wau,
        mau: c.mau,
        totalMembers: c.totalMembers,
        capturedAt: new Date(),
      },
    });
}

// Ingest a verified Clerk event. The whole operation runs in one transaction so
// the dedupe marker (clerk_events) is committed only if the user mutation and
// snapshot also succeed — a mid-ingest failure rolls back and is safely retried.
// Idempotent on the Svix message id, so retries/replays never double-count.
export async function recordEvent(
  appId: string,
  svixId: string,
  evt: ClerkEvent,
): Promise<void> {
  await db.transaction(async (tx) => {
    const userId = extractUserId(evt);
    const inserted = await tx
      .insert(clerkEventsTable)
      .values({
        svixId,
        appId,
        eventType: evt.type,
        clerkUserId: userId ?? null,
        occurredAt: envelopeTime(evt) ?? new Date(),
      })
      .onConflictDoNothing()
      .returning({ svixId: clerkEventsTable.svixId });
    if (inserted.length === 0) return; // already processed this delivery

    if (userId) await applyUserEvent(tx, appId, userId, evt);
    await refreshDailySnapshot(tx, appId);
  });
}

// Returns true when at least one real (non-seeded) Clerk webhook event exists in
// the DB. A single row in clerk_events means real webhook traffic has arrived.
async function hasRealClerkEvents(): Promise<boolean> {
  const r = await db.execute(
    sql`select 1 from clerk_events limit 1`,
  );
  return (r.rows?.length ?? 0) > 0;
}

// Aggregate per-app activity for the Clerk-backed consumer apps.
export async function getActivity(): Promise<UserActivityRow[]> {
  const apps = clerkApps();
  const dataSource: "live" | "demo" = (await hasRealClerkEvents()) ? "live" : "demo";
  const out: UserActivityRow[] = [];
  for (const app of apps) {
    const c = await computeCounts(db, app.id);
    out.push({
      appId: app.id,
      appName: app.name,
      environment: app.environment,
      totalMembers: c.totalMembers,
      dau: c.dau,
      wau: c.wau,
      mau: c.mau,
      inactive30d: Math.max(0, c.totalMembers - c.mau),
      newLast7d: c.newLast7d,
      dauTrendPct: await dauTrend(db, app.id, c.dau),
      dataSource,
    });
  }
  return out;
}
