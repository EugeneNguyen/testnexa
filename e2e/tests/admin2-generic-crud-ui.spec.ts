import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADMIN-2 UI E2E (ADR-0025 / WBS §7): real browser, full stack, exercising
 * the frontend generic admin CRUD surface itself
 * (`EntityListPage`/`EntityFormPage`/`EntityTable`/`EntityForm`/
 * `ScopeSelector`/`FkAutocomplete`, `frontend/src/pages/admin/` +
 * `frontend/src/components/crud/`) — the part `admin2-generic-crud.spec.ts`
 * explicitly does NOT cover (that file is API-only, predating this UI; see
 * its own docstring for why).
 *
 * Fixture seeding: one Organization/Project, an `org_admin` (org-wide grant)
 * and a separate `auditor` (org-wide grant, read-only bundle per
 * `app/db/rbac_seed_catalog.py`) actor, plus one seeded row each of
 * `TestLevel` (global catalog), `Environment` (direct project scope),
 * `Requirement`/`RiskItem` (scope-selector chain) — same `docker exec ...
 * python -` pattern `req1-requirements-ui.spec.ts`/`admin2-generic-crud.spec.ts`
 * established.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 *
 * **Bug found and fixed while writing this file, flagged here (see
 * `components/crud/ScopeSelector.tsx`'s own updated docstring for the full
 * root-cause writeup):** `ScopeSelector`'s `FkAutocomplete` search fired with
 * no scope params, but every scope-selector `refEntity` on this surface is
 * itself scoped and 422s without one — so no scope-selector entity's picker
 * could ever find anything through the UI. Fixed for the one-hop case
 * (ref entity's own scope field is literally `project_id`, e.g. `RiskItem`'s
 * "by Requirement"/"by TestPlan") by threading the current route's
 * `project_id` through as `extraParams`. Multi-hop chains
 * (`TestExecution`/`Defect`/`TestLog`/`TestConditionTestCaseLink`) and
 * anything scoped via `TestCase` (no list route at all, pre-existing
 * documented gap) remain broken — out of scope for this fix, not exercised
 * by this file.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-admin2-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  auditor: { email: string; password: string; userId: string };
  orgId: string;
  projectId: string;
  testLevelId: string;
  testLevelName: string;
  environmentId: string;
  environmentName: string;
  requirementId: string;
  requirementDescription: string;
  riskItemId: string;
  riskItemDescription: string;
}

// Seeds one Organization/Project, an org_admin and an auditor (both org-wide
// RoleAssignments, active OrgMemberships), and one row each of TestLevel
// (global catalog), Environment (direct project_id scope), Requirement +
// RiskItem (RiskItem's scope-selector chain: RiskItem -> Requirement ->
// project_id) — enough real, pre-existing data for every list-renders /
// scope-selector assertion in this file without also driving a "New Project"
// modal (PROJ-1's own spec already covers that).
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, AuthProvider
from app.models.governance import RiskItem, RiskLevel
from app.models.planning import Environment
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def _create_user(session, tag):
    suffix = uuid4().hex[:8]
    email = f"e2e-admin2-ui-{tag}-{suffix}@example.com"
    user = User(name=f"ADMIN-2 UI E2E {tag}", email=email, password_hash=hash_password(PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    return user, email

async def main():
    suffix = uuid4().hex[:8]
    async with AsyncSessionLocal() as session:
        org_admin, org_admin_email = await _create_user(session, "org-admin")
        auditor, auditor_email = await _create_user(session, "auditor")

        org = Organization(name="ADMIN-2 UI E2E Org", slug=f"admin2-ui-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=org_admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))
        session.add(OrgMembership(org_id=org.id, user_id=auditor.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=org_admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        auditor_role = (
            await session.execute(select(Role).where(Role.name == "auditor", Role.org_id.is_(None)))
        ).scalars().first()
        assert auditor_role is not None, "expected the RBAC-4-seeded auditor system Role to already exist"
        session.add(RoleAssignment(actor_id=auditor.actor_id, org_id=org.id, project_id=None, role_id=auditor_role.id))

        project = Project(org_id=org.id, name=f"ADMIN-2 UI E2E Project {suffix}")
        session.add(project)
        await session.flush()

        test_level_name = f"ADMIN-2 UI E2E Level {suffix}"
        test_level = TestLevel(name=test_level_name)
        session.add(test_level)

        environment_name = f"ADMIN-2 UI E2E Env {suffix}"
        environment = Environment(project_id=project.id, name=environment_name, config_notes="seeded for E2E")
        session.add(environment)

        requirement_description = f"ADMIN-2 UI E2E requirement {suffix}"
        requirement = Requirement(
            project_id=project.id,
            title=f"ADMIN-2 UI E2E Requirement {suffix}",
            description=requirement_description,
        )
        session.add(requirement)
        await session.flush()

        risk_item_description = f"ADMIN-2 UI E2E risk {suffix}"
        risk_item = RiskItem(
            requirement_id=requirement.id,
            description=risk_item_description,
            likelihood=RiskLevel.medium,
            impact=RiskLevel.high,
        )
        session.add(risk_item)

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": org_admin_email, "password": PASSWORD, "userId": str(org_admin.actor_id)},
            "auditor": {"email": auditor_email, "password": PASSWORD, "userId": str(auditor.actor_id)},
            "orgId": str(org.id),
            "projectId": str(project.id),
            "testLevelId": str(test_level.id),
            "testLevelName": test_level_name,
            "environmentId": str(environment.id),
            "environmentName": environment_name,
            "requirementId": str(requirement.id),
            "requirementDescription": requirement_description,
            "riskItemId": str(risk_item.id),
            "riskItemDescription": risk_item_description,
        }))

asyncio.run(main())
`;

// FK-safe delete order (child-first). `extraEnvironmentIds` covers anything
// the create/edit/delete round-trip test creates beyond the seeded row, in
// case an assertion fails before that test's own delete-through-the-UI step
// runs.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, RefreshToken
from app.models.governance import RiskItem
from app.models.planning import Environment
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel
from app.models.tenancy import Organization, OrgMembership

org_admin_id, auditor_id, org_id, project_id, test_level_id, requirement_id, risk_item_id, environment_id = sys.argv[1:9]
extra_environment_ids = json.loads(sys.argv[9]) if len(sys.argv) > 9 and sys.argv[9] else []

async def main():
    user_ids = [org_admin_id, auditor_id]
    environment_ids = [eid for eid in [environment_id, *extra_environment_ids] if eid]
    async with AsyncSessionLocal() as session:
        if risk_item_id:
            await session.execute(delete(RiskItem).where(RiskItem.id == risk_item_id))
        if requirement_id:
            await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
        if environment_ids:
            await session.execute(delete(Environment).where(Environment.id.in_(environment_ids)))
        if test_level_id:
            await session.execute(delete(TestLevel).where(TestLevel.id == test_level_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
        if project_id:
            await session.execute(delete(Project).where(Project.id == project_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
        await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
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

function cleanup(fixture: SeededFixture, extraEnvironmentIds: string[] = []): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      fixture.orgAdmin.userId,
      fixture.auditor.userId,
      fixture.orgId,
      fixture.projectId,
      fixture.testLevelId,
      fixture.requirementId,
      fixture.riskItemId,
      fixture.environmentId,
      JSON.stringify(extraEnvironmentIds),
    ],
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

/**
 * `page.goto` a generic admin list page and wait for its underlying `GET
 * .../<resourcePath>` list call to complete before any assertion — the dev
 * Vite server's cold module-graph transform plus the list's own
 * permissions-then-data fetch chain can occasionally take longer than the
 * default 5s assertion timeout under parallel load, which is a test-harness
 * timing concern, not a product bug; waiting on the real network response
 * removes that flakiness without weakening what's actually being proven.
 */
async function gotoAndWaitForList(page: import("@playwright/test").Page, url: string, resourcePath: string) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(`/api/v1/${resourcePath}`) && res.request().method() === "GET",
    ),
    page.goto(url),
  ]);
  expect(response.ok()).toBeTruthy();
}

test.describe("ADMIN-2 UI: generic admin CRUD surface", () => {
  // Each test below drives multiple full page loads / modals against the
  // "dev" profile's unoptimized Vite dev server (cold module-graph transform
  // per navigation, no production build cache) — heavier than this repo's
  // other, mostly single-assertion specs. Running this file's 6 tests
  // concurrently against each other reliably starves that dev server under
  // the default `fullyParallel` worker pool (observed: `page.waitForResponse`
  // timeouts on the list fetch itself, not a product bug). Serial mode here
  // is scoped to this file only — it doesn't touch `playwright.config.ts` or
  // this file's own concurrency with *other* spec files in a full-suite run.
  test.describe.configure({ mode: "serial" });

  test("org-scoped admin page (test levels), reached via the sidebar's Admin nav group, renders a real seeded list", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      // Navigate via the real sidebar nav (AppSidebar.tsx's "Admin" CNavGroup,
      // generated from the registry's org-scoped entities) rather than a bare
      // `page.goto`, per this story's own coverage requirement — proves the
      // nav wiring itself, not just the destination route.
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/test-levels") && res.request().method() === "GET",
        ),
        (async () => {
          await page.getByTestId("sidebar-nav-group-admin").getByRole("link", { name: "Admin" }).click();
          await page.getByTestId("sidebar-nav-admin-test-levels").click();
        })(),
      ]);
      expect(response.ok()).toBeTruthy();
      await expect(page.getByRole("heading", { name: /^test levels$/i })).toBeVisible();
      await expect(page.getByRole("alert")).not.toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(fixture.testLevelName) })).toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });

  test("project-scoped admin page (environments), reached from ProjectDetail's Admin section, renders a real seeded list", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      // Navigate via ProjectDetail's own "Admin" card (ProjectDetail.tsx,
      // generated from the registry's project-scoped entities) rather than a
      // bare `page.goto` — proves that cross-link, not just the destination
      // route on its own.
      await page.goto(`/projects/${fixture.projectId}`);
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/environments") && res.request().method() === "GET",
        ),
        page.getByTestId("project-admin-link-environments").click(),
      ]);
      expect(response.ok()).toBeTruthy();
      await expect(page.getByRole("heading", { name: /^environments$/i })).toBeVisible();
      await expect(page.getByRole("alert")).not.toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(fixture.environmentName) })).toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });

  test("create button is absent for a role without the .create permission (auditor, read-only bundle)", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.auditor.email, fixture.auditor.password, fixture.orgId);

      // --- Org-scoped: test levels -------------------------------------------------------
      await gotoAndWaitForList(page, `/orgs/${fixture.orgId}/admin/test-levels`, "test-levels");
      await expect(page.getByRole("row", { name: new RegExp(fixture.testLevelName) })).toBeVisible();
      await expect(page.getByRole("button", { name: /^new$/i })).not.toBeVisible();
      // Read-only bundle: no update/delete affordance on the row either.
      await expect(page.getByRole("button", { name: "Edit" })).not.toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).not.toBeVisible();

      // --- Project-scoped: environments --------------------------------------------------
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");
      await expect(page.getByRole("row", { name: new RegExp(fixture.environmentName) })).toBeVisible();
      await expect(page.getByRole("button", { name: /^new$/i })).not.toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });

  test("create -> edit -> delete round trip through the generic UI (Environment)", async ({ page }) => {
    const fixture = seedFixture();
    const createdEnvironmentIds: string[] = [];
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");
      await expect(page.getByRole("heading", { name: /^environments$/i })).toBeVisible();

      // --- Create via the "New" modal ----------------------------------------------------
      await page.getByRole("button", { name: /^new$/i }).click();
      await expect(page.getByRole("heading", { name: /^new environments$/i })).toBeVisible();

      const name = `ADMIN-2 UI E2E round-trip env ${Date.now().toString(36)}`;
      await page.getByLabel(/^name$/i).fill(name);
      await page.getByLabel(/^config notes$/i).fill("created via the generic admin UI, E2E");

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes("/api/v1/environments") && response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^create$/i }).click(),
      ]);
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json();
      createdEnvironmentIds.push(created.id);

      await expect(page.getByRole("heading", { name: /^new environments$/i })).not.toBeVisible();
      const createdRow = page.getByRole("row", { name: new RegExp(name) });
      await expect(createdRow).toBeVisible();

      // --- Edit ---------------------------------------------------------------------------
      await createdRow.getByRole("button", { name: "Edit" }).click();
      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/admin/environments/${created.id}/edit`));
      await expect(page.getByRole("heading", { name: /^edit environments$/i })).toBeVisible();
      await expect(page.getByLabel(/^name$/i)).toHaveValue(name);

      const updatedName = `ADMIN-2 UI E2E round-trip env EDITED ${Date.now().toString(36)}`;
      await page.getByLabel(/^name$/i).fill(updatedName);

      const [updateResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/environments/${created.id}`) && response.request().method() === "PATCH",
        ),
        page.getByRole("button", { name: /^save$/i }).click(),
      ]);
      expect(updateResponse.ok()).toBeTruthy();

      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/admin/environments$`));
      const updatedRow = page.getByRole("row", { name: new RegExp(updatedName) });
      await expect(updatedRow).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);

      // --- Delete ---------------------------------------------------------------------------
      await updatedRow.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("heading", { name: /delete record/i })).toBeVisible();

      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/environments/${created.id}`) && response.request().method() === "DELETE",
        ),
        page.locator(".modal-content").getByRole("button", { name: "Delete" }).click(),
      ]);
      expect(deleteResponse.status()).toBe(204);
      createdEnvironmentIds.length = 0; // already gone

      await expect(page.getByRole("heading", { name: /delete record/i })).not.toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(updatedName.replace(/[()]/g, "\\$&")) })).toHaveCount(0);
    } finally {
      cleanup(fixture, createdEnvironmentIds);
    }
  });

  test("RiskItem scope selector: no list until a scope is chosen, then loads scoped correctly", async ({ page }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await page.goto(`/projects/${fixture.projectId}/admin/risk-items`);
      await expect(page.getByRole("heading", { name: /^risk items$/i })).toBeVisible();

      // --- Nothing loads until a scope is picked -----------------------------------------
      await expect(page.getByTestId("scope-selector")).toBeVisible();
      await expect(page.getByRole("table")).not.toBeVisible();
      await expect(page.getByText(fixture.riskItemDescription)).not.toBeVisible();

      // --- "By requirement" is the default active option; search + select the seeded one --
      await expect(page.getByRole("button", { name: /by requirement/i })).toBeVisible();
      const scopeSearch = page.getByLabel(/by requirement/i);
      await scopeSearch.fill(fixture.requirementDescription.slice(0, 20));

      const resultOption = page.getByRole("button", { name: fixture.requirementId, exact: true });
      await expect(resultOption).toBeVisible();
      await resultOption.click();

      // --- Scope resolved -> the real list for that Requirement loads, not an error -------
      await expect(page.getByTestId("scope-selector")).not.toBeVisible();
      await expect(page.getByRole("alert")).not.toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(fixture.riskItemDescription) })).toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });

  // TC-ADMIN-026: `Organization`/`Project`/`OrgMembership`/`Release` each have both a bespoke
  // screen and a generic admin page (ADR-0025 §6). `OrgMembership` deletion has no bespoke
  // affordance at all (`OrgMembers.tsx` only suspends/reactivates/revokes-an-invite) -- proves the
  // generic surface's delete round-trip actually removes the row, and the bespoke screen (a
  // different route, its own `GET /orgs/{org_id}/members` call) reflects that removal cleanly,
  // with no duplicate-action confusion or stale-row error in either UI.
  test("delete an OrgMembership via the generic admin page; the bespoke OrgMembers screen has no such action but reflects the removal", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await gotoAndWaitForList(page, `/orgs/${fixture.orgId}/admin/org-memberships`, "org-memberships");
      await expect(page.getByRole("heading", { name: /^org memberships$/i })).toBeVisible();
      const auditorRow = page.getByRole("row", { name: new RegExp(fixture.auditor.userId) });
      await expect(auditorRow).toBeVisible();

      await auditorRow.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("heading", { name: /delete record/i })).toBeVisible();

      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/v1/org-memberships/") && response.request().method() === "DELETE",
        ),
        page.locator(".modal-content").getByRole("button", { name: "Delete" }).click(),
      ]);
      expect(deleteResponse.status()).toBe(204);
      await expect(page.getByRole("heading", { name: /delete record/i })).not.toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(fixture.auditor.userId) })).toHaveCount(0);

      // Bespoke screen: a different route entirely, no delete action of its own -- confirm it
      // still loads cleanly (no stale-row error) and no longer lists the removed member.
      await page.goto(`/orgs/${fixture.orgId}/members`);
      await expect(page.getByRole("heading", { name: /members/i })).toBeVisible();
      await expect(page.getByRole("alert")).not.toBeVisible();
      await expect(page.getByText(fixture.auditor.email)).not.toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });
});
