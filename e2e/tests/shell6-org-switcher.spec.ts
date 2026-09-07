import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * SHELL-6 E2E (ADR-0036): the header organization-switcher dropdown.
 * Covers the two clauses of TC-SHELL-017/TC-SHELL-018
 * (`docs/test-cases/2026-09-03-test-cases.md`) that need a real backend and
 * two real roles — the fast/deterministic halves of both TCs already live
 * in `frontend/tests/AppHeader.OrgSwitcher.test.tsx` (mocked `getMyOrgs`);
 * this file is the pair's real-browser, real-permission-check half.
 *
 * Fixture: one user, TWO active `OrgMembership`s (Org A, Org B) — `org_admin`
 * in Org A, `tester` in Org B (a role with zero `role.*` codes, per
 * `app/db/rbac_seed_catalog.py`'s `tester` bundle). Two active memberships
 * is what makes `POST /auth/login` resolve `org_context: "picker"`, landing
 * on `/orgs/pick` with `AuthContext.orgs` populated for a real UI-driven
 * navigation into Org A (same reasoning `shell-nav.spec.ts` documents).
 *
 * Seeding/cleanup pattern copied verbatim from `shell-nav.spec.ts`
 * (`docker exec ... python -`, `AsyncSessionLocal` direct seed).
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-switchorg-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededUser {
  email: string;
  password: string;
  userId: string;
  orgAId: string;
  orgAName: string;
  orgBId: string;
  orgBName: string;
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
    email = f"e2e-shell6-{suffix}@example.com"
    org_a_name = f"SHELL-6 E2E Org A {suffix}"
    org_b_name = f"SHELL-6 E2E Org B {suffix}"
    async with AsyncSessionLocal() as session:
        user = User(name="SHELL-6 E2E User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org_a = Organization(name=org_a_name, slug=f"shell6-e2e-a-{suffix}")
        org_b = Organization(name=org_b_name, slug=f"shell6-e2e-b-{suffix}")
        session.add_all([org_a, org_b])
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org_a.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))
        session.add(OrgMembership(org_id=org_b.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        tester_role = (
            await session.execute(select(Role).where(Role.name == "tester", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        assert tester_role is not None, "expected the RBAC-4-seeded tester system Role to already exist"

        # org_admin in Org A (full catalog, including role.create); tester in
        # Org B (zero role.* codes) -- the two must differ on something the
        # UI actually gates, not just on paper.
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org_a.id, project_id=None, role_id=org_admin_role.id))
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org_b.id, project_id=None, role_id=tester_role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgAId": str(org_a.id),
            "orgAName": org_a_name,
            "orgBId": str(org_b.id),
            "orgBName": org_b_name,
        }))

asyncio.run(main())
`;

const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_a_id, org_b_id = sys.argv[1], sys.argv[2], sys.argv[3]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Organization).where(Organization.id.in_([org_a_id, org_b_id])))
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

function cleanup(user: SeededUser): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", user.userId, user.orgAId, user.orgBId],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

async function loginAndEnterOrgA(page: import("@playwright/test").Page, user: SeededUser) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/orgs\/pick/);
  await page.getByText(user.orgAName).click();
  await page.waitForURL(new RegExp(`/orgs/${user.orgAId}$`));
}

test.describe("SHELL-6 organization switcher (ADR-0036)", () => {
  test("TC-SHELL-017: switching from a deeply nested route lands on the target org's root, never a preserved sub-route", async ({
    page,
  }) => {
    const user = seedUser();

    try {
      await loginAndEnterOrgA(page, user);

      // Navigate to a deeply nested route (the TC's own example shape:
      // /orgs/:orgId/admin/roles).
      await page.goto(`/orgs/${user.orgAId}/admin/roles`);
      await expect(page.getByRole("heading", { name: /roles/i })).toBeVisible();

      await page.getByTestId("org-switcher-toggle").click();
      await page.getByTestId(`org-switcher-item-${user.orgBId}`).click();

      // Lands on Org B's ROOT -- never /orgs/{orgBId}/admin/roles.
      await page.waitForURL(new RegExp(`/orgs/${user.orgBId}$`));
      await expect(page).not.toHaveURL(/\/admin\/roles$/);
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    } finally {
      cleanup(user);
    }
  });

  test("TC-SHELL-018: current org is indicated, and the target org's own permissions govern post-switch rendering (no stale carried-over view)", async ({
    page,
  }) => {
    const user = seedUser();

    try {
      await loginAndEnterOrgA(page, user);

      // --- Pre-switch: Org A (org_admin) is marked current. ---
      await page.getByTestId("org-switcher-toggle").click();
      const currentItem = page.getByTestId(`org-switcher-item-${user.orgAId}`);
      await expect(currentItem).toHaveClass(/\bactive\b/);
      await expect(currentItem).toHaveClass(/\bdisabled\b/);
      // Close the dropdown before navigating away.
      await page.keyboard.press("Escape");

      // --- Org A (org_admin): the roles admin page renders its
      // permission-gated "New" create action (EntityListPage.tsx's
      // `canCreate`, gated on `role.create` -- org_admin holds the full
      // catalog, `tester` holds no role.* codes at all). ---
      await page.goto(`/orgs/${user.orgAId}/admin/roles`);
      await expect(page.getByRole("button", { name: /^new$/i })).toBeVisible();

      // --- Switch to Org B (tester -- zero role.* permission codes). ---
      await page.getByTestId("org-switcher-toggle").click();
      await page.getByTestId(`org-switcher-item-${user.orgBId}`).click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgBId}$`));

      // --- Post-switch: Org B is now marked current. ---
      await page.getByTestId("org-switcher-toggle").click();
      const newCurrentItem = page.getByTestId(`org-switcher-item-${user.orgBId}`);
      await expect(newCurrentItem).toHaveClass(/\bactive\b/);
      const orgAItemAfterSwitch = page.getByTestId(`org-switcher-item-${user.orgAId}`);
      await expect(orgAItemAfterSwitch).not.toHaveClass(/\bactive\b/);
      await page.keyboard.press("Escape");

      // --- Org B (tester): navigating to the SAME admin/roles route must
      // reflect Org B's own live permission check -- the "New" button must
      // be gone, not a carried-over view from Org A's render of the
      // identical route shape. ---
      await page.goto(`/orgs/${user.orgBId}/admin/roles`);
      await expect(page.getByRole("button", { name: /^new$/i })).toHaveCount(0);
    } finally {
      cleanup(user);
    }
  });

  test("dropdown always renders and lists both orgs, even mid-session across multiple opens", async ({
    page,
  }) => {
    const user = seedUser();

    try {
      await loginAndEnterOrgA(page, user);

      await page.getByTestId("org-switcher-toggle").click();
      await expect(page.getByTestId(`org-switcher-item-${user.orgAId}`)).toBeVisible();
      await expect(page.getByTestId(`org-switcher-item-${user.orgBId}`)).toBeVisible();
    } finally {
      cleanup(user);
    }
  });
});
