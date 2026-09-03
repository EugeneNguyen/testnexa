import { expect, test } from "@playwright/test";

/**
 * Scaffold smoke test: proves nginx -> frontend -> backend actually wire
 * together end to end, not a feature test. The frontend's `/` page fetches
 * same-origin `/api/health` (proxied by nginx to the backend's `/health`)
 * and renders "Backend: ok" once it resolves.
 */
test("home page shows Backend: ok once the health check resolves", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Backend: ok")).toBeVisible();
});
