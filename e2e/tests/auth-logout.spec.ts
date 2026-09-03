import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * AUTH-3 E2E: real browser, full stack (nginx -> frontend -> backend ->
 * Postgres), exercising the navbar logout flow (TC-AUTH-009's frontend half)
 * per docs/user-stories/2026-09-03-auth-stories.md and ADR-0014.
 *
 * Fixture accounts are seeded per-test, mirroring auth-refresh.spec.ts's own
 * helpers exactly (one active `OrgMembership` each, so login always resolves
 * `org_context: "auto"` and lands directly on `/orgs/:orgId`, never the
 * picker) -- seeding/cleanup are direct DB rows via SQLAlchemy's
 * `AsyncSessionLocal`, run inside the target env's own backend container
 * (`docker exec ... python -`), since there is no in-repo seed
 * script/fixture mechanism for Playwright to reuse otherwise.
 *
 * Target environment: an isolated `testnexa-auth3`-style Compose project
 * (`E2E_BASE_URL`, default below), never the main `testnexa` stack. Container
 * names are overridable via env vars for portability.
 *
 * NOTE: this file is written to match existing conventions but is not run as
 * part of this task -- it requires the isolated Docker test stack's backend
 * AND frontend rebuilt with this code, which happens in a later step.
 */

const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-auth3-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededUser {
  email: string;
  password: string;
  userId: string;
  orgId: string;
}

// Mirrors backend/tests/integration/test_auth_refresh.py's `_create_user` /
// `_create_org` / `_create_membership` helpers (also reused verbatim by
// auth-refresh.spec.ts): one `User` (+ `local` `AuthIdentity`), one
// `Organization`, one `active` `OrgMembership`.
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
    email = f"e2e-auth3-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="AUTH-3 E2E Test User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
        org = Organization(name="AUTH-3 E2E Test Org", slug=f"auth3-e2e-{suffix}")
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

test.describe("AUTH-3 logout", () => {
  test("clicking the navbar's Log out button ends the session and redirects to /login (TC-AUTH-009)", async ({
    page,
  }) => {
    const user = seedUser();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();

      // Single active OrgMembership -> org_context "auto" -> straight to
      // /orgs/{orgId}, never the picker (same rationale as auth-refresh.spec.ts).
      await page.waitForURL(new RegExp(`/orgs/${user.orgId}`));
      await expect(page.getByRole("heading", { name: `Org: ${user.orgId}` })).toBeVisible();

      // AppHeader (AUTH-3) is mounted by ProtectedRoute above every protected
      // page's content -- confirm it's actually there before driving it.
      const logoutButton = page.getByTestId("logout-button");
      await expect(logoutButton).toBeVisible();

      await logoutButton.click();

      // React Router client-side navigation to /login (AuthContext.logout()'s
      // caller, AppHeader, uses useNavigate() per the scope plan's explicit
      // "not apiFetch's hard window.location.assign" instruction).
      await page.waitForURL(/\/login/);
      await expect(page).toHaveURL(/\/login/);

      // Confirm the old refresh cookie no longer works: direct backend call
      // from the browser, same mechanism auth-refresh.spec.ts uses to prove
      // server-side rejection of a dead cookie.
      const directRefresh = await page.evaluate(async () => {
        const response = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" });
        return { status: response.status, body: await response.json() };
      });
      expect(directRefresh.status).toBe(401);
      expect(directRefresh.body.code).toBe("invalid_refresh_token");
    } finally {
      cleanupUser(user);
    }
  });
});
