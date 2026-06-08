/**
 * E2E tests: threshold history button is gated by canEditThresholds
 *
 * The "View change history" clock-icon button inside the "Alert threshold
 * settings" panel is only rendered when the signed-in user belongs to
 * Orbit-Admins or Orbit-Engineers (canEditThresholds gate).
 *
 * In mock mode (Entra not configured) the frontend reads group membership from
 * localStorage under the key "orbit-mock-groups".  Setting that key before
 * page load is the same as signing in as a user with those groups.
 *
 * Relevant source:
 *   artifacts/orbit/src/pages/health.tsx — ThresholdHistoryDialog (line ~445),
 *     ThresholdRow (line ~475, gate on line ~568), ThresholdSettings (line ~582),
 *     Health component (line ~629, gate on line 842)
 *   artifacts/api-server/src/middlewares/auth.ts — requireEngineerOrAdmin
 *   artifacts/api-server/src/routes/orbit.ts — GET /apps/:appId/thresholds/log
 */

import { test, expect } from "@playwright/test";

const MOCK_GROUPS_KEY = "orbit-mock-groups";

const GROUP_AUTHORIZED = "orbit-authorized-users";
const GROUP_ADMIN = "orbit-admins";
const GROUP_ENGINEER = "orbit-engineers";

test.describe("Threshold history gate", () => {
  test("non-admin: settings panel and history button are absent", async ({ page }) => {
    await page.addInitScript((key: string, value: string) => {
      localStorage.setItem(key, value);
    }, MOCK_GROUPS_KEY, JSON.stringify([GROUP_AUTHORIZED]));

    await page.goto("/health");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText("Alert threshold settings"),
      "Threshold settings panel must not be rendered for non-admin users",
    ).not.toBeVisible();

    await expect(
      page.getByTitle("View change history"),
      "History button must not be rendered for non-admin users",
    ).not.toBeAttached();
  });

  test("admin: settings panel visible, history button present and opens dialog", async ({ page }) => {
    await page.addInitScript((key: string, value: string) => {
      localStorage.setItem(key, value);
    }, MOCK_GROUPS_KEY, JSON.stringify([GROUP_AUTHORIZED, GROUP_ADMIN]));

    await page.goto("/health");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText("Alert threshold settings"),
      "Threshold settings panel must be visible for admin users",
    ).toBeVisible();

    await page.getByText("Alert threshold settings").click();

    const historyBtn = page.getByTitle("View change history").first();
    await expect(historyBtn, "History button must be present for admin users after expanding the panel").toBeVisible({ timeout: 8000 });

    await historyBtn.click();

    await expect(
      page.getByText("Threshold change history", { exact: false }),
      "Clicking the history button must open the Threshold change history dialog",
    ).toBeVisible();
  });

  test("engineer: settings panel visible and history button present", async ({ page }) => {
    await page.addInitScript((key: string, value: string) => {
      localStorage.setItem(key, value);
    }, MOCK_GROUPS_KEY, JSON.stringify([GROUP_AUTHORIZED, GROUP_ENGINEER]));

    await page.goto("/health");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText("Alert threshold settings"),
      "Threshold settings panel must be visible for engineer users",
    ).toBeVisible();

    await page.getByText("Alert threshold settings").click();

    await expect(
      page.getByTitle("View change history").first(),
      "History button must be present for engineer users",
    ).toBeVisible({ timeout: 8000 });
  });
});
