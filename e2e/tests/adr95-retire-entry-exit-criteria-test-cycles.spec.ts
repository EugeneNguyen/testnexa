import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADR-0095 E2E: retiring the standalone `EntryExitCriteria`/`TestCycle`
 * admin list pages, and extending `TestCycle` to full inline CRUD on
 * `TestPlanDetail` (the capability `TestCycle` never had elsewhere, unlike
 * `EntryExitCriteria`, whose own PLAN-2 section already had full CRUD
 * before this ADR).
 *
 * Covers TC-PLAN-018 (registry-absence + route-block, same shape as
 * ADR-0093's TC-SHELL-040/041, applied to a second entity pair) and
 * TC-PLAN-019 (the new inline Edit/Delete workflow: create via the existing
 * bespoke modal, edit the name via the new modal sending only the editable
 * fields, delete with no confirmation — same convention Entry/Exit Criteria
 * already uses).
 *
 * Deliberately does NOT re-test PLAN-2's own Entry/Exit Criteria CRUD
 * (`plan2-entry-exit-criteria.spec.ts` already covers it, unmodified — this
 * ADR doesn't touch that section) or PLAN-3's own create-path scope checks
 * (`plan3-test-cycle.spec.ts` already covers `422`/cross-project rejection,
 * unmodified — this ADR doesn't touch the create route either).
 *
 * Fixture seeding mirrors `adr93-retire-test-conditions.spec.ts`'s shape
 * (one org_admin, one Organization, one Project), extended with a TestPlan
 * + Release + Environment so TC-PLAN-019 has something to create a cycle
 * against.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-verifytc-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  testPlanId: string;
  releaseId: string;
  environmentId: string;
  releaseLabel: string;
  environmentName: string;
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
from app.models.project import Project, Release
from app.models.planning import Environment, TestPlan, TestPlanStatus
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-adr95-{suffix}@example.com"
    release_label = f"R-ADR95-{suffix}"
    environment_name = f"Env-ADR95-{suffix}"
    async with AsyncSessionLocal() as session:
        user = User(name="ADR-0095 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADR-0095 E2E Org", slug=f"adr95-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"ADR-0095 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        test_plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=f"TP-ADR95-{suffix}",
            status=TestPlanStatus.draft,
        )
        session.add(test_plan)

        release = Release(project_id=project.id, version_label=release_label)
        session.add(release)

        environment = Environment(project_id=project.id, name=environment_name)
        session.add(environment)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "testPlanId": str(test_plan.id),
            "releaseId": str(release.id),
            "environmentId": str(environment.id),
            "releaseLabel": release_label,
            "environmentName": environment_name,
        }))

asyncio.run(main())
`;

const CLEANUP_SCRIPT = `
import asyncio, sys

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project, Release
from app.models.planning import Environment, TestCycle, TestPlan
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership
from sqlalchemy import delete

user_id, org_id, project_id, test_plan_id = sys.argv[1:5]

async def main():
    async with AsyncSessionLocal() as session:
        # Any TestCycle the test itself didn't clean up via the UI (e.g. a
        # failed assertion mid-test) must go before its TestPlan/Environment
        # parents.
        await session.execute(delete(TestCycle).where(TestCycle.test_plan_id == test_plan_id))
        await session.execute(delete(TestPlan).where(TestPlan.id == test_plan_id))
        await session.execute(delete(Environment).where(Environment.project_id == project_id))
        await session.execute(delete(Release).where(Release.project_id == project_id))
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
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", fixture.userId, fixture.orgId, fixture.projectId, fixture.testPlanId],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

/**
 * `page.goto` to a protected route, then wait for the shell to actually
 * mount — same helper as `adr93-retire-test-conditions.spec.ts`'s own
 * `gotoProtected` (`e2e/CLAUDE.md`'s documented boot-race fix).
 */
async function gotoProtected(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator("aside.navbar-vertical").waitFor({ state: "attached", timeout: 60_000 });
}

async function login(page: import("@playwright/test").Page, fixture: SeededFixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByLabel(/password/i).fill(fixture.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));
}

test.describe("ADR-0095: EntryExitCriteria/TestCycle standalone admin pages are retired", () => {
  test("TC-PLAN-018: sidebar has no entry-exit-criteria/test-cycles links, and both retired URLs render 'Unknown admin entity' without ever fetching their schema", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const fixture = seedFixture();
    try {
      await login(page, fixture);

      await gotoProtected(page, `/projects/${fixture.projectId}`);
      const testPlanningGroup = page.getByTestId("sidebar-nav-group-test-planning");
      await expect(testPlanningGroup).toBeVisible();
      await testPlanningGroup.getByRole("link", { name: "Test Planning" }).click();

      await expect(page.getByTestId("sidebar-nav-admin-test-plans")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-admin-releases")).toBeVisible();
      // The load-bearing negative: neither retired child's testid exists in
      // the DOM at all, not merely hidden.
      await expect(page.getByTestId("sidebar-nav-admin-entry-exit-criteria")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-nav-admin-test-cycles")).toHaveCount(0);

      const schemaRequests: string[] = [];
      page.on("request", (req) => {
        if (req.url().includes("/api/v1/entities/") && req.url().includes("/schema")) {
          schemaRequests.push(req.url());
        }
      });

      for (const entity of ["entry-exit-criteria", "test-cycles"]) {
        await gotoProtected(page, `/projects/${fixture.projectId}/admin/${entity}`);
        await expect(page.getByText(/unknown admin entity/i)).toBeVisible();
        await expect(page.getByText(new RegExp(entity))).toBeVisible();
      }

      // Distinguishes "the frontend never asked" from "the backend
      // refused" — the backend deliberately still serves both schemas
      // (TestPlanDetail's own inline sections depend on them), so only a
      // real client-side gate, not a 404, explains the block.
      expect(
        schemaRequests.some(
          (url) =>
            url.includes("entry-exit-criteria") ||
            url.includes("entry_exit_criteria") ||
            url.includes("test-cycles") ||
            url.includes("test_cycle"),
        ),
      ).toBe(false);
    } finally {
      cleanup(fixture);
    }
  });

  test("TC-PLAN-019: TestCycle create/edit/delete happens entirely inline on TestPlanDetail, no admin surface involved", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const fixture = seedFixture();
    try {
      await login(page, fixture);
      await gotoProtected(page, `/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}`);

      // --- Create (PLAN-3's existing bespoke modal, unaffected by this ADR) ---
      await page.getByTestId("create-cycle-btn").click();
      await page.getByTestId("create-cycle-modal").waitFor({ state: "visible" });
      await page.locator("#cycleReleaseId").selectOption({ label: fixture.releaseLabel });
      await page.locator("#cycleEnvironmentId").selectOption({ label: fixture.environmentName });
      await page.getByTestId("cycle-name").fill("ADR-0095 Cycle");
      await page.getByTestId("create-cycle-submit").click();
      await page.getByText("ADR-0095 Cycle").waitFor({ state: "visible", timeout: 15000 });

      // Scoped to `<li>` specifically — the list's own wrapper `<ul>` also
      // carries a `data-testid` starting with "test-cycle-" (`test-cycle-
      // list`), which a bare prefix match would double-count.
      const row = page.locator('li[data-testid^="test-cycle-"]');
      await expect(row).toHaveCount(1);
      // No "View in Admin" link anywhere — the standalone surface it used
      // to point at no longer exists.
      await expect(page.locator('[data-testid^="view-in-admin-"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="edit-cycle-"]')).toHaveCount(1);
      await expect(page.locator('[data-testid^="delete-cycle-"]')).toHaveCount(1);

      // --- Edit: only environment_id/name/dates are editable; test_plan_id/
      // project_id/release_id never render as fields at all ---
      await page.locator('[data-testid^="edit-cycle-"]').click();
      await page.getByTestId("edit-cycle-modal").waitFor({ state: "visible" });
      await expect(page.getByLabel("Name")).toHaveValue("ADR-0095 Cycle");
      await expect(page.getByLabel("Test plan")).toHaveCount(0);
      await expect(page.getByLabel("Project")).toHaveCount(0);
      await expect(page.getByLabel("Release")).toHaveCount(0);

      const patchResponsePromise = page.waitForResponse(
        (response) =>
          /\/api\/v1\/test-cycles\/[^/]+$/.test(response.url()) && response.request().method() === "PATCH",
      );
      await page.getByLabel("Name").fill("ADR-0095 Cycle Renamed");
      await page.getByRole("button", { name: /^save$/i }).click();
      const patchResponse = await patchResponsePromise;
      expect(patchResponse.status()).toBe(200);
      const patched = await patchResponse.json();
      expect(patched.name).toBe("ADR-0095 Cycle Renamed");

      await page.getByText("ADR-0095 Cycle Renamed").waitFor({ state: "visible", timeout: 15000 });
      await expect(page.getByTestId("edit-cycle-modal")).toBeHidden();

      // --- Delete: no confirmation modal, list re-fetches to empty ---
      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          /\/api\/v1\/test-cycles\/[^/]+$/.test(response.url()) && response.request().method() === "DELETE",
      );
      await page.locator('[data-testid^="delete-cycle-"]').click();
      const deleteResponse = await deleteResponsePromise;
      expect(deleteResponse.status()).toBe(204);

      await page.getByText("No test cycles yet.").waitFor({ state: "visible", timeout: 15000 });
      await expect(page.locator('li[data-testid^="test-cycle-"]')).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });
});
