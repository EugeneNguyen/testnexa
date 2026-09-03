import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * AUTH-2 E2E: real browser, full stack (nginx -> frontend -> backend ->
 * Postgres), exercising session persistence (AC1) and revoked-refresh-token
 * rejection (AC2) per docs/user-stories/2026-09-03-auth-stories.md.
 *
 * Fixture accounts, unlike auth-login.spec.ts's single pre-seeded account,
 * are seeded per-test here (one active `OrgMembership` each, so login always
 * resolves `org_context: "auto"` and lands directly on `/orgs/:orgId`,
 * never the picker — required per the AUTH-2 implementation plan's binding
 * cross-task guidance: a page reload does NOT restore `orgContext`/`orgs`
 * (only `{access_token}` comes back from `/auth/refresh`), so any test that
 * reloads through the picker would be testing a known-broken path, not AC1).
 *
 * Seeding/cleanup mirror backend/tests/integration/test_auth_refresh.py's
 * own helpers (`User` + `AuthIdentity` + `Organization` + `OrgMembership`,
 * direct DB rows via SQLAlchemy's `AsyncSessionLocal`) exactly, just run
 * inside the target env's own backend container (`docker exec ... python -`)
 * since these tests are TypeScript/Playwright, not Python — there is no
 * existing seed script/fixture mechanism in this repo's `e2e/` package to
 * reuse (`auth-login.spec.ts`'s fixture account is seeded out-of-band, not
 * by that spec itself), so this is the closest in-repo convention available.
 *
 * Target environment: Task 0's isolated `testnexa-auth2` Compose project
 * (`E2E_BASE_URL`, default below), never the main `testnexa` stack.
 * Container names are overridable via env vars for portability.
 */

const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-auth2-backend-1";
const POSTGRES_CONTAINER = process.env.E2E_POSTGRES_CONTAINER ?? "testnexa-auth2-postgres-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededUser {
  email: string;
  password: string;
  userId: string;
  orgId: string;
}

// Mirrors backend/tests/integration/test_auth_refresh.py's `_create_user` /
// `_create_org` / `_create_membership` helpers: one `User` (+ `local`
// `AuthIdentity`), one `Organization`, one `active` `OrgMembership`.
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-auth2-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="AUTH-2 E2E Test User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
        org = Organization(name="AUTH-2 E2E Test Org", slug=f"auth2-e2e-{suffix}")
        session.add(org)
        await session.flush()
        session.add(
            OrgMembership(
                org_id=org.id,
                user_id=user.actor_id,
                status=OrgMembershipStatus.active,
                joined_at=datetime.now(UTC),
            )
        )
        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring test_auth_refresh.py's `_cleanup` helper.
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, LoginAttempt, RefreshToken
from app.models.tenancy import Organization, OrgMembership

email, user_id, org_id = sys.argv[1], sys.argv[2], sys.argv[3]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(LoginAttempt).where(LoginAttempt.email == email))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.org_id == org_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.commit()

asyncio.run(main())
`;

function seedUser(): SeededUser {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededUser;
}

function cleanupUser(user: SeededUser): void {
  execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-", user.email, user.userId, user.orgId], {
    input: CLEANUP_SCRIPT,
    encoding: "utf-8",
  });
}

/**
 * Revokes every live `RefreshToken` row for `userId` directly via `psql`
 * against the isolated env's OWN Postgres container — a write against
 * `testnexa-auth2`'s DB, never the main `testnexa` stack (per this task's
 * binding constraints). Simple `UPDATE`, no ORM needed: mirrors what an
 * admin's "force logout" action would do server-side per AUTH-2 AC2.
 */
function revokeRefreshTokens(userId: string): void {
  const sql = `UPDATE refresh_token SET revoked_at = now(), revoked_reason = 'e2e-test-revoke' WHERE user_id = '${userId}' AND revoked_at IS NULL;`;
  execFileSync("docker", ["exec", POSTGRES_CONTAINER, "psql", "-U", "testnexa", "-d", "testnexa", "-c", sql], {
    encoding: "utf-8",
  });
}

test.describe("AUTH-2 session persistence", () => {
  test("session survives a page reload (AC1: refresh token restores session across a browser restart)", async ({
    page,
  }) => {
    const user = seedUser();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();

      // Single active OrgMembership -> org_context "auto" -> straight to
      // /orgs/{orgId}, never the picker (see file docstring for why the
      // picker path is deliberately out of scope for this test).
      await page.waitForURL(new RegExp(`/orgs/${user.orgId}`));
      await expect(page.getByRole("heading", { name: `Org: ${user.orgId}` })).toBeVisible();

      // The actual proof of AC1: reload the page (module-level token store
      // resets to empty on every fresh load) and confirm AuthContext's
      // boot-time silent refresh (POST /auth/refresh against the httpOnly
      // refresh_token cookie) restores the session before ProtectedRoute
      // decides whether to redirect -- i.e. no bounce to /login, protected
      // content is still visible.
      await page.reload();

      await expect(page).toHaveURL(new RegExp(`/orgs/${user.orgId}`));
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { name: `Org: ${user.orgId}` })).toBeVisible();
    } finally {
      cleanupUser(user);
    }
  });

  test("session survives a genuine browser restart, not just a same-tab reload (AC1, fix round 2 Finding 1)", async ({
    page,
    context,
    browser,
  }) => {
    // The `page.reload()` test above proves the session survives *within
    // the same browser context* -- but a session cookie (no `Max-Age`/
    // `Expires` on the wire) would ALSO survive a same-tab reload, which is
    // exactly how the missing-`max_age` bug (fix round 2, Finding 1) slipped
    // past that test. This test is the actual differentiator: it saves
    // `context.storageState()` after login, then opens a genuinely NEW
    // browser context (`browser.newContext({ storageState })`, Playwright's
    // closest approximation of a real browser restart -- a fresh context has
    // no in-memory state at all, only whatever was persisted into the saved
    // storage state) and navigates fresh from there. This only works if the
    // `refresh_token` cookie was actually persisted into the saved storage
    // state WITH a real expiry -- a session cookie would serialize with
    // Playwright's `expires: -1` sentinel and most likely not even be
    // treated as still-valid the same way, so asserting a real numeric
    // `expires` first makes the persistence claim explicit before relying on
    // it.
    const user = seedUser();
    let newContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();

      await page.waitForURL(new RegExp(`/orgs/${user.orgId}`));
      await expect(page.getByRole("heading", { name: `Org: ${user.orgId}` })).toBeVisible();

      const storageState = await context.storageState();
      const refreshCookie = storageState.cookies.find((cookie) => cookie.name === "refresh_token");
      expect(refreshCookie).toBeDefined();
      // Playwright serializes a session cookie's `expires` as `-1`; a real
      // persistent cookie serializes as a Unix timestamp comfortably in the
      // future. This is the assertion that would have caught the bug: before
      // the fix, `expires` here was `-1`, and the new-context navigation
      // below would still have happened to work in some Playwright versions
      // purely because Chromium keeps a session cookie alive for the
      // lifetime of the browser *process*, not just the tab -- an even
      // sneakier false-negative than a plain reload, which is exactly why
      // asserting the numeric expiry directly (not just "did navigation
      // succeed") is the load-bearing check here.
      const nearFutureSeconds = Date.now() / 1000 + 60 * 60 * 24; // now + 1 day
      expect(refreshCookie!.expires).toBeGreaterThan(nearFutureSeconds);

      newContext = await browser.newContext({ storageState });
      const newPage = await newContext.newPage();
      await newPage.goto(`/orgs/${user.orgId}`);

      await expect(newPage).not.toHaveURL(/\/login/);
      await expect(newPage.getByRole("heading", { name: `Org: ${user.orgId}` })).toBeVisible();
    } finally {
      await newContext?.close();
      cleanupUser(user);
    }
  });

  test("revoked refresh token is rejected and the user ends up back at /login (AC2)", async ({ page }) => {
    const user = seedUser();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();

      await page.waitForURL(new RegExp(`/orgs/${user.orgId}`));
      await expect(page.getByRole("heading", { name: `Org: ${user.orgId}` })).toBeVisible();

      // Revoke the session's RefreshToken row server-side -- simulates an
      // admin force-logout / explicit logout per AUTH-2 AC2's precondition.
      revokeRefreshTokens(user.userId);

      // Mechanism note: this test exercises two complementary, real
      // production code paths rather than the mid-session apiFetch 401
      // interceptor specifically (which would require the in-memory access
      // token to look expired/invalid to the backend -- doable only by
      // reaching into the frontend's module-private token store from
      // outside the page, which is more invasive/fragile than what follows,
      // and the AUTH-2 plan explicitly permits picking whichever mechanism
      // is more reliable/less flaky over waiting on the real 15-minute
      // access-token TTL):
      //
      // 1. Direct proof the revoked token is rejected server-side -- the
      //    same rejection every refresh attempt (boot-time or mid-session)
      //    depends on: call POST /auth/refresh straight from the browser
      //    with its real httpOnly cookie attached, assert 401
      //    invalid_refresh_token.
      const directRefresh = await page.evaluate(async () => {
        const response = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" });
        return { status: response.status, body: await response.json() };
      });
      expect(directRefresh.status).toBe(401);
      expect(directRefresh.body.code).toBe("invalid_refresh_token");

      // 2. The app's own reactive behavior: reload triggers AuthContext's
      //    real boot-time silent refresh against the same now-revoked
      //    cookie. It fails the same way, the token store stays empty,
      //    isInitializing settles, and ProtectedRoute (wrapping the current
      //    /orgs/:orgId route) redirects to /login since no access token is
      //    present -- a real, undoctored exercise of this repo's actual
      //    session-restoration code path, just entered via the boot-refresh
      //    trigger rather than a mid-session apiFetch call.
      await page.reload();
      await page.waitForURL(/\/login/);
      await expect(page).toHaveURL(/\/login/);
    } finally {
      cleanupUser(user);
    }
  });
});

/**
 * Fix round 2, Finding 3: TC-AUTH-006's exact scenario ("expired access
 * token -> next API call -> frontend interceptor calls refresh -> retries ->
 * succeeds transparently") had never run against a REAL backend before this.
 * The gaps this closes:
 * - `test_auth_refresh.py::test_refresh_issues_new_access_token_that_works_against_me`
 *   proves the backend side (a fresh refresh + `/auth/me` call) but never
 *   drives an actual 401 first.
 * - The frontend Vitest suite for `apiFetch`'s interceptor mocks `fetch`
 *   entirely -- no real backend involved.
 * - This spec's other tests exercise boot-time refresh and a raw direct
 *   `fetch('/auth/refresh')`, but never `apiFetch`'s own 401 interceptor
 *   against a real 401 from a real backend call.
 *
 * Requires the target backend to actually issue short-lived access tokens
 * (`JWT_ACCESS_TTL_MINUTES` overridden to a few seconds' worth, e.g. `0.05`)
 * so the test can wait out a REAL expiry instead of waiting on the 15-minute
 * production default or faking expiry client-side. Since that changes
 * behavior for the whole target backend container (not just this test), the
 * test is opt-in via `E2E_SHORT_ACCESS_TTL=1` rather than assumed -- running
 * the full suite against a normally-configured backend skips it cleanly
 * instead of hanging for 15 minutes waiting on the default TTL.
 */
test.describe("AUTH-2 TC-AUTH-006: real 401 -> refresh -> retry chain", () => {
  test("an authenticated call with an expired access token transparently recovers via apiFetch's own interceptor", async ({
    page,
  }) => {
    test.skip(
      process.env.E2E_SHORT_ACCESS_TTL !== "1",
      "Requires the target backend started with a short JWT_ACCESS_TTL_MINUTES override " +
        "(e.g. JWT_ACCESS_TTL_MINUTES=0.05 on the backend container) so the access token " +
        "actually expires within a few seconds instead of the real 15-minute default -- " +
        "opt in with E2E_SHORT_ACCESS_TTL=1 once that override is deployed. See this file's " +
        "docstring above this describe block.",
    );

    const user = seedUser();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgId}`));
      await expect(page.getByRole("heading", { name: `Org: ${user.orgId}` })).toBeVisible();

      // Let the deliberately short-lived access token actually expire.
      // Overridable so the wait can be tuned to whatever TTL override was
      // actually deployed without touching test code.
      const waitMs = Number(process.env.E2E_ACCESS_TOKEN_EXPIRY_WAIT_MS ?? 8000);
      await page.waitForTimeout(waitMs);

      // Trigger a real authenticated call through the app's own `apiFetch`
      // (exposed as `window.__testApiFetch` in dev builds only, see
      // `frontend/src/lib/api/client.ts`) -- this is the exact same function
      // every real authenticated call in the app uses, reading the current
      // (now-expired) access token from the module-private token store
      // itself. This exercises the real chain: 401 from the backend ->
      // `apiFetch`'s interceptor calls `POST /auth/refresh` -> retries the
      // original request once -> succeeds.
      const result = await page.evaluate(async () => {
        const testWindow = window as unknown as {
          __testApiFetch?: (path: string) => Promise<unknown>;
        };
        if (!testWindow.__testApiFetch) {
          throw new Error("window.__testApiFetch is not present -- is this a dev build?");
        }
        return testWindow.__testApiFetch("/api/v1/auth/me");
      });

      expect(result).toMatchObject({
        actor_id: user.userId,
        email: user.email,
        actor_type: "user",
      });

      // No forced re-login: the interceptor recovered transparently, so the
      // page never bounced to /login.
      await expect(page).not.toHaveURL(/\/login/);
    } finally {
      cleanupUser(user);
    }
  });
});
