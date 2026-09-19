import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADR-0093 E2E: retiring the standalone `TestCondition` admin list page.
 *
 * Covers TC-SHELL-040 (sidebar's Test Design group no longer lists "Test
 * conditions", 3 children not 4) and TC-SHELL-041 (a direct/typed visit to
 * `/admin/test-conditions` — list, detail, edit — renders "Unknown admin
 * entity" and never even asks the backend for that key's schema).
 *
 * Deliberately does NOT re-test the relation-tab/inline paths that stay
 * untouched (`admin7-entity-relation-tabs.spec.ts`, `admin10-compound-
 * create.spec.ts`, `req3-test-condition-rigor-path.spec.ts` already cover
 * those, unmodified — see ADR-0093's own Consequences) — duplicating their
 * assertions here would prove nothing new.
 *
 * Fixture seeding mirrors `req1-requirements-ui.spec.ts`'s minimal shape:
 * one org_admin, one Organization, one Project — nothing TestCondition-
 * specific is needed since this spec's whole point is that the surface no
 * longer exists.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-adr93-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
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
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-adr93-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="ADR-0093 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADR-0093 E2E Org", slug=f"adr93-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"ADR-0093 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
        }))

asyncio.run(main())
`;

const CLEANUP_SCRIPT = `
import asyncio, sys

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership
from sqlalchemy import delete

user_id, org_id, project_id = sys.argv[1:4]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
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
  execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-", fixture.userId, fixture.orgId, fixture.projectId], {
    input: CLEANUP_SCRIPT,
    encoding: "utf-8",
  });
}

/**
 * `page.goto` to a protected route, then wait for the shell to actually
 * mount — same helper/reasoning as `shell9-project-nav-context.spec.ts`'s
 * own `gotoProtected`. On a full page load (not a client-side `<Link>`
 * click), `ProtectedRoute` renders only a boot spinner until `AuthContext`'s
 * silent refresh round-trips; `AppShell`/`AppSidebar` don't exist in the DOM
 * at all until then. A plain 5s assertion immediately after `page.goto` can
 * lose that race and fail with "element(s) not found," reading exactly like
 * an unresolved/broken nav rather than a page that simply hadn't booted yet.
 */
async function gotoProtected(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator("aside.navbar-vertical").waitFor({ state: "attached", timeout: 60_000 });
}

test.describe("ADR-0093: TestCondition standalone admin page is retired", () => {
  test("TC-SHELL-040: sidebar's Test Design group no longer lists Test conditions", async ({ page }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await gotoProtected(page, `/projects/${fixture.projectId}`);
      const testDesignGroup = page.getByTestId("sidebar-nav-group-test-design");
      await expect(testDesignGroup).toBeVisible();
      await testDesignGroup.getByRole("link", { name: "Test Design" }).click();

      await expect(page.getByTestId("sidebar-nav-admin-requirements")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-admin-test-cases")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-admin-test-suites")).toBeVisible();
      // The load-bearing negative: the retired child's testid must not exist
      // in the DOM at all, not merely be hidden.
      await expect(page.getByTestId("sidebar-nav-admin-test-conditions")).toHaveCount(0);
      await expect(testDesignGroup.getByText("Test conditions", { exact: true })).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });

  test("TC-SHELL-041: a direct/typed visit to the retired standalone list/detail/edit URLs renders 'Unknown admin entity' and never fetches its schema", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      const schemaRequests: string[] = [];
      page.on("request", (req) => {
        if (req.url().includes("/api/v1/entities/") && req.url().includes("/schema")) {
          schemaRequests.push(req.url());
        }
      });

      for (const path of [
        `/projects/${fixture.projectId}/admin/test-conditions`,
        `/projects/${fixture.projectId}/admin/test-conditions/00000000-0000-0000-0000-000000000000`,
        `/projects/${fixture.projectId}/admin/test-conditions/00000000-0000-0000-0000-000000000000/edit`,
      ]) {
        await gotoProtected(page, path);
        await expect(page.getByText(/unknown admin entity/i)).toBeVisible();
        await expect(page.getByText(/test-conditions/)).toBeVisible();
      }

      // Distinguishes "the frontend never asked" from "the backend refused" —
      // the backend deliberately still serves this schema for the relation
      // tab, so only a real client-side gate (not a 404) explains the block.
      expect(schemaRequests.some((url) => url.includes("test-conditions") || url.includes("test_condition"))).toBe(
        false,
      );
    } finally {
      cleanup(fixture);
    }
  });
});
