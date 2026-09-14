import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * TestType catalog default seed (ADR-0067, TC-ADMIN-043): real browser,
 * full stack, proving the 5 seeded `TestType` rows are actually visible
 * through the real generic admin CRUD surface (`/orgs/:orgId/admin/test-types`),
 * reached via the sidebar's Catalogs nav group — not just present in the DB.
 * Same fixture/login/navigation shape `admin2-generic-crud-ui.spec.ts`
 * already established for the sibling `TestLevel` global-catalog entity;
 * `TestType` needs no fixture row of its own (it's the seed migration's own
 * permanent rows being asserted, not a fixture this spec creates), so the
 * seed script here is deliberately smaller — org + org_admin only.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-testtype-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

const SEEDED_TEST_TYPE_NAMES = [
  "Functional Testing",
  "Non-functional Testing",
  "Black-box Testing",
  "White-box Testing",
  "Confirmation Testing",
];

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  orgId: string;
}

// Seeds one Organization + one org_admin (org-wide RoleAssignment, active
// OrgMembership) — enough to reach the org-scoped admin nav and its
// global-catalog `test-types` list page. Does NOT touch `test_type` itself;
// the 5 rows under test are the migration's own permanent seed.
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
    async with AsyncSessionLocal() as session:
        email = f"e2e-testtype-seed-{suffix}@example.com"
        org_admin = User(name=f"TestType Seed E2E {suffix}", email=email, password_hash=hash_password(PASSWORD))
        session.add(org_admin)
        await session.flush()
        session.add(AuthIdentity(user_id=org_admin.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="TestType Seed E2E Org", slug=f"testtype-seed-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=org_admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=org_admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": email, "password": PASSWORD, "userId": str(org_admin.actor_id)},
            "orgId": str(org.id),
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

org_admin_id, org_id = sys.argv[1:3]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == org_admin_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == org_admin_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == org_admin_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == org_admin_id))
        await session.execute(delete(Actor).where(Actor.id == org_admin_id))
        await session.commit()

asyncio.run(main())
`;

function seedFixture(): SeededFixture {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededFixture;
}

function cleanup(fixture: SeededFixture): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", fixture.orgAdmin.userId, fixture.orgId],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

async function login(page: import("@playwright/test").Page, email: string, password: string, orgId: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(new RegExp(`/orgs/${orgId}`));
}

test.describe("TestType catalog default seed (ADR-0067)", () => {
  test("the 5 seeded TestType rows render on the real admin list, reached via the sidebar's Catalogs nav group", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/test-types") && res.request().method() === "GET",
        ),
        (async () => {
          await page
            .getByTestId("sidebar-nav-group-catalogs")
            .getByRole("link", { name: "Catalogs" })
            .click();
          await page.getByTestId("sidebar-nav-admin-test-types").click();
        })(),
      ]);
      expect(response.ok()).toBeTruthy();

      await expect(page.getByRole("heading", { name: /^test types$/i })).toBeVisible();
      await expect(page.getByRole("alert")).not.toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();

      for (const name of SEEDED_TEST_TYPE_NAMES) {
        await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
      }
    } finally {
      cleanup(fixture);
    }
  });
});
