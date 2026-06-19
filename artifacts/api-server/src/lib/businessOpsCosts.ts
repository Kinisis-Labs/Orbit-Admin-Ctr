import { and, eq } from "drizzle-orm";
import { db, opsCostsTable, type NewOpsCostRow, type OpsCostRow } from "@workspace/db";
import { randomUUID } from "node:crypto";

export type OpsCostCategory = "website-ops" | "network-ops" | "m365-licenses";

const CATEGORY_LABELS: Record<OpsCostCategory, string> = {
  "website-ops": "Website Ops",
  "network-ops": "Network Ops",
  "m365-licenses": "M365 Licenses",
};

const ALL_CATEGORIES: OpsCostCategory[] = [
  "website-ops",
  "network-ops",
  "m365-licenses",
];

export type OpsCostItemDto = {
  id: string;
  appId: string;
  category: OpsCostCategory;
  name: string;
  vendor: string | null;
  amountMonthly: number;
  currency: string;
  billingCycle: string;
  active: boolean;
  notes: string | null;
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
};

export type OpsCostCategoryTotal = {
  category: OpsCostCategory;
  label: string;
  total: number;
  itemCount: number;
  items: OpsCostItemDto[];
};

export type OpsCostSummary = {
  totalMonthly: number;
  byCategory: OpsCostCategoryTotal[];
};

function rowToDto(row: OpsCostRow): OpsCostItemDto {
  return {
    id: row.id,
    appId: row.appId,
    category: row.category as OpsCostCategory,
    name: row.name,
    vendor: row.vendor ?? null,
    amountMonthly: Number(row.amountMonthly),
    currency: row.currency,
    billingCycle: row.billingCycle,
    active: row.active,
    notes: row.notes ?? null,
    effectiveFrom: row.effectiveFrom.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listOpsCostItems(appId: string): Promise<OpsCostItemDto[]> {
  const rows = await db
    .select()
    .from(opsCostsTable)
    .where(eq(opsCostsTable.appId, appId))
    .orderBy(opsCostsTable.category, opsCostsTable.name);
  return rows.map(rowToDto);
}

export async function fetchOpsCostSummary(appId: string): Promise<OpsCostSummary> {
  const items = await listOpsCostItems(appId);
  const activeItems = items.filter((i) => i.active);

  const byCategory: OpsCostCategoryTotal[] = ALL_CATEGORIES.map((cat) => {
    const catItems = activeItems.filter((i) => i.category === cat);
    return {
      category: cat,
      label: CATEGORY_LABELS[cat],
      total: Number(catItems.reduce((s, i) => s + i.amountMonthly, 0).toFixed(2)),
      itemCount: catItems.length,
      items: catItems,
    };
  });

  const totalMonthly = Number(
    byCategory.reduce((s, c) => s + c.total, 0).toFixed(2)
  );

  return { totalMonthly, byCategory };
}

export async function createOpsCostItem(
  appId: string,
  input: {
    category: OpsCostCategory;
    name: string;
    vendor?: string;
    amountMonthly: number;
    currency?: string;
    billingCycle?: string;
    active?: boolean;
    notes?: string;
    effectiveFrom?: string;
  }
): Promise<OpsCostItemDto> {
  const now = new Date();
  const row: NewOpsCostRow = {
    id: randomUUID(),
    appId,
    category: input.category,
    name: input.name,
    vendor: input.vendor ?? null,
    amountMonthly: String(input.amountMonthly),
    currency: input.currency ?? "USD",
    billingCycle: input.billingCycle ?? "monthly",
    active: input.active ?? true,
    notes: input.notes ?? null,
    effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : now,
    createdAt: now,
    updatedAt: now,
  };
  const [inserted] = await db.insert(opsCostsTable).values(row).returning();
  return rowToDto(inserted);
}

export async function updateOpsCostItem(
  appId: string,
  itemId: string,
  input: {
    category?: OpsCostCategory;
    name?: string;
    vendor?: string | null;
    amountMonthly?: number;
    currency?: string;
    billingCycle?: string;
    active?: boolean;
    notes?: string | null;
    effectiveFrom?: string;
  }
): Promise<OpsCostItemDto | null> {
  const updates: Partial<NewOpsCostRow> = {
    updatedAt: new Date(),
  };
  if (input.category !== undefined) updates.category = input.category;
  if (input.name !== undefined) updates.name = input.name;
  if ("vendor" in input) updates.vendor = input.vendor ?? null;
  if (input.amountMonthly !== undefined) updates.amountMonthly = String(input.amountMonthly);
  if (input.currency !== undefined) updates.currency = input.currency;
  if (input.billingCycle !== undefined) updates.billingCycle = input.billingCycle;
  if (input.active !== undefined) updates.active = input.active;
  if ("notes" in input) updates.notes = input.notes ?? null;
  if (input.effectiveFrom !== undefined) updates.effectiveFrom = new Date(input.effectiveFrom);

  const [updated] = await db
    .update(opsCostsTable)
    .set(updates)
    .where(and(eq(opsCostsTable.id, itemId), eq(opsCostsTable.appId, appId)))
    .returning();
  return updated ? rowToDto(updated) : null;
}

export async function deleteOpsCostItem(
  appId: string,
  itemId: string
): Promise<boolean> {
  const result = await db
    .delete(opsCostsTable)
    .where(and(eq(opsCostsTable.id, itemId), eq(opsCostsTable.appId, appId)))
    .returning({ id: opsCostsTable.id });
  return result.length > 0;
}
