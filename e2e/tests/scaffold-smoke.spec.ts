import { expect, test } from "@playwright/test";

/**
 * Scaffold smoke test: proves nginx -> backend actually wire together end to
 * end, not a feature test. Originally did this by loading `/` and asserting
 * the frontend's `ScaffoldVerificationPage` widget rendered "Backend: ok"
 * after fetching same-origin `/api/health`. LANDING-1 (ADR-0024) deleted that
 * widget outright, and DASH-1 (ADR-0035) has since deleted its `LandingPage`
 * replacement too — `/` is now a pure auth-state redirect with no content of
 * its own (see `root-redirect.spec.ts`). `GET /api/health` itself stays
 * directly reachable through nginx's proxy regardless of what the SPA renders
 * at `/` (ADR-0024's Consequences section calls this out explicitly, and
 * ADR-0035 leaves it untouched), so this test hits it directly via
 * Playwright's `request` fixture instead of through a page load.
 */
test("GET /api/health is reachable through nginx and reports ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe("ok");
});
