import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * RBAC-1 E2E (ADR-0016 AC2): real browser, full stack, exercising
 * `OrgPicker.tsx`'s "New Organization" modal — an already-authenticated
 * org_admin minting a further Organization via `POST /orgs`.
 *
 * Fixture seeding: a human User who is org_admin (org-wide RoleAssignment
 * against RBAC-4's seeded `org_admin` system Role, which grants
 * `organization.create` among everything else) of one Organization ("Org
 * A"), PLUS a second, merely-member `active` `OrgMembership` in a
 * throwaway "Org B" — two active memberships is what makes
 * `POST /auth/login` resolve `org_context: "picker"` (mirrors
 * `test_auth_login.py`'s TC-AUTH-004 precondition and `Login.tsx`'s own
 * `org_context === "picker" -> navigate("/orgs/pick")` redirect), which is
 * the only way to reach `OrgPicker` — and therefore its "New Organization"
 * button — through real UI navigation rather than a raw `page.goto` (a full
 * page reload would lose the in-memory `AuthContext.orgs` list `OrgPicker`
 * needs, per that component's own docstring). Seeded directly via
 * `AsyncSessionLocal` inside the target env's own backend container
 * (`docker exec ... python -`), the same established convention
 * `auth-agents.spec.ts`/`auth-logout.spec.ts` use — there is no bootstrap
 * API for arbitrary `Role`/`RoleAssignment` fixtures beyond what
 * `POST /auth/signup` itself produces.
 *
 * Target environment: the isolated `testnexa-rbac1` Compose project
 * (`E2E_BASE_URL`, set externally per this task's brief), never the main
 * `testnexa` stack. Container name overridable via env var for portability.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-rbac1-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededOrgAdmin {
  email: string;
  password: string;
  userId: string;
  orgAId: string;
  orgBId: string;
}

const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-rbac1-orgpicker-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="RBAC-1 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org_a = Organization(name="RBAC-1 E2E Org A", slug=f"rbac1-e2e-a-{suffix}")
        org_b = Organization(name="RBAC-1 E2E Org B", slug=f"rbac1-e2e-b-{suffix}")
        session.add_all([org_a, org_b])
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org_a.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))
        session.add(OrgMembership(org_id=org_b.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        # org_admin (-> organization.create) only needs to be held org-wide
        # in ONE org — has_permission_in_any_org checks across every org the
        # actor belongs to, not just the "current" one (RBAC-1/ADR-0016).
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org_a.id, project_id=None, role_id=org_admin_role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgAId": str(org_a.id),
            "orgBId": str(org_b.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring test_organizations.py's `_cleanup` helper.
// `newOrgId` may be an empty string if the test never got far enough to
// create the second org via the UI (e.g. it failed before submitting).
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

email, user_id, org_a_id, org_b_id, new_org_id = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        org_ids = [org_a_id, org_b_id] + ([new_org_id] if new_org_id else [])
        await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
        await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.commit()

asyncio.run(main())
`;

function seedOrgAdmin(): SeededOrgAdmin {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededOrgAdmin;
}

function cleanup(admin: SeededOrgAdmin, newOrgId: string | null): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", admin.email, admin.userId, admin.orgAId, admin.orgBId, newOrgId ?? ""],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("RBAC-1 AC2: existing org_admin creates a second organization via the UI", () => {
  test("OrgPicker's New Organization modal creates a second org and navigates to it", async ({ page }) => {
    const admin = seedOrgAdmin();
    let newOrgId: string | null = null;
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(admin.email);
      await page.getByLabel(/password/i).fill(admin.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();

      // Two active memberships -> org_context "picker" -> Login.tsx's own
      // redirect effect lands here automatically (never /orgs/{orgId}).
      await page.waitForURL(/\/orgs\/pick/);
      await expect(page.getByRole("heading", { name: /choose an organization/i })).toBeVisible();
      await expect(page.getByText("RBAC-1 E2E Org A")).toBeVisible();
      await expect(page.getByText("RBAC-1 E2E Org B")).toBeVisible();

      await page.getByRole("button", { name: /new organization/i }).click();

      const newOrgName = "RBAC-1 E2E Second Org";
      const newOrgSlug = `rbac1-e2e-second-${Date.now().toString(36)}`;
      await page.getByLabel(/^name$/i).fill(newOrgName);
      await page.getByLabel(/^slug$/i).fill(newOrgSlug);
      await page.getByRole("button", { name: /^create$/i }).click();

      // On success, OrgPicker navigates straight to the new org's own view
      // (it does not try to splice the new org into its own `orgs` list —
      // see OrgPicker.tsx's docstring).
      await page.waitForURL(/\/orgs\/[0-9a-f-]+/i);
      await expect(page).not.toHaveURL(/\/orgs\/pick/);
      await expect(page).not.toHaveURL(new RegExp(`/orgs/${admin.orgAId}`));
      await expect(page).not.toHaveURL(new RegExp(`/orgs/${admin.orgBId}`));

      const match = page.url().match(/\/orgs\/([0-9a-f-]+)/i);
      expect(match).not.toBeNull();
      newOrgId = match ? match[1] : null;

      await expect(page.getByRole("heading", { name: `Org: ${newOrgId}` })).toBeVisible();
    } finally {
      cleanup(admin, newOrgId);
    }
  });
});
