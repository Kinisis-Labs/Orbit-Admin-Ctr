/**
 * E2E tests: export warning appears when threshold history is paginated
 *
 * The ThresholdHistoryContent component shows an amber "X of Y entries loaded"
 * warning and changes the export button label to "Load all & export" whenever
 * the API signals that more pages exist (total > loaded items).
 *
 * These tests use Playwright route interception to mock the
 * GET /api/apps/:appId/thresholds/log endpoint so we can control hasMore
 * without needing real DB rows.
 *
 * Relevant source:
 *   artifacts/orbit/src/pages/health.tsx — ThresholdHistoryContent (line ~196)
 *     hasMore flag (line ~223), amber warning (line ~370–375),
 *     button label switch (line ~388–394), "Load more" pagination (line ~437–454)
 */

import { test, expect, type Route } from "@playwright/test";

const MOCK_GROUPS_KEY = "orbit-mock-groups";
const GROUP_AUTHORIZED = "orbit-authorized-users";
const GROUP_ADMIN = "orbit-admins";

const PAGE_SIZE = 50;
const TOTAL = 75;

function makeEntries(count: number, startId = 1): object[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    appId: "grailbabe",
    oldCpuThreshold: 75,
    newCpuThreshold: 80,
    oldMemoryThreshold: 80,
    newMemoryThreshold: 85,
    changedBy: "operator@example.com",
    changedAt: new Date(Date.now() - i * 60_000).toISOString(),
  }));
}

// Intercept GET /api/apps/:appId/thresholds/log and return a paginated mock.
// offset=0  -> first 50 entries, total=75  (hasMore implied by total)
// offset=50 -> next  25 entries, total=75  (last page)
function routeThresholdLog(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const offset = Number(url.searchParams.get("offset") ?? "0");

  if (offset === 0) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: makeEntries(PAGE_SIZE, 1),
        total: TOTAL,
        limit: PAGE_SIZE,
        offset: 0,
      }),
    });
  }

  const remaining = TOTAL - offset;
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      items: makeEntries(remaining, offset + 1),
      total: TOTAL,
      limit: PAGE_SIZE,
      offset,
    }),
  });
}

async function openHistoryDialog(page: import("@playwright/test").Page) {
  await page.goto("/health");
  await page.waitForLoadState("networkidle");

  await page.getByText("Alert threshold settings").click();

  const historyBtn = page.getByTitle("View change history").first();
  await expect(historyBtn, "History button must be visible for admin users").toBeVisible({ timeout: 8_000 });
  await historyBtn.click();

  await expect(
    page.getByText("Threshold change history", { exact: false }),
    "History dialog must open",
  ).toBeVisible({ timeout: 8_000 });
}

test.describe("Threshold history export warning", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key: string, value: string) => {
      localStorage.setItem(key, value);
    }, MOCK_GROUPS_KEY, JSON.stringify([GROUP_AUTHORIZED, GROUP_ADMIN]));
  });

  test("shows amber warning and 'Load all & export' label when history is paginated", async ({ page }) => {
    await page.route("**/api/apps/*/thresholds/log*", routeThresholdLog);

    await openHistoryDialog(page);

    const warning = page.getByText(/entries loaded/i);
    await expect(warning, "Amber partial-load note must be visible when more pages exist").toBeVisible({ timeout: 8_000 });
    await expect(warning).toContainText(`${PAGE_SIZE} of ${TOTAL} entries loaded`);

    const exportBtn = page.getByRole("button", { name: /load all & export/i });
    await expect(exportBtn, "Export button must read 'Load all & export' when history is paginated").toBeVisible();
  });

  test("warning disappears and button reads 'Download CSV' once all pages are loaded", async ({ page }) => {
    await page.route("**/api/apps/*/thresholds/log*", routeThresholdLog);

    await openHistoryDialog(page);

    await expect(page.getByText(/entries loaded/i), "Amber warning must be visible before loading all pages").toBeVisible({ timeout: 8_000 });

    const loadMoreBtn = page.getByRole("button", { name: "Load more" });
    await expect(loadMoreBtn, "'Load more' pagination button must be present").toBeVisible();
    await loadMoreBtn.click();

    const downloadBtn = page.getByRole("button", { name: /download csv/i });
    await expect(downloadBtn, "Button must switch to 'Download CSV' once all entries are loaded").toBeVisible({ timeout: 8_000 });

    await expect(
      page.getByText(/entries loaded/i),
      "Amber warning note must disappear once all pages are loaded",
    ).not.toBeVisible();
  });
});
