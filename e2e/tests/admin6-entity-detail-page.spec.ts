import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADR-0070 E2E: the generic, read-only entity detail page — real browser, full
 * stack, real schemas served by `GET /entities/{resource}/schema`.
 *
 * The claim under test is **genericity**, so the same row-click -> detail flow
 * is driven against three structurally different real entities, not one:
 *
 * | Entity | Scope | Why this one |
 * |---|---|---|
 * | `test-plans` | project | 8 served fields, **5 of them `showInTable: false`** (`scope`, `approach`, `staffing_and_training`, `schedule`, `created_by_actor_id`) — the largest hidden-field set in the app, i.e. the gap this ADR closes |
 * | `environments` | project | 3 fields, none hidden — proves the page isn't specialised to the hidden-field case |
 * | `test-levels` | org/global | 1 field, no project scope at all — proves the other route shape and the minimal-schema case |
 *
 * Nothing in `EntityDetailPage` branches on entity, so if the flow works for
 * these three it works for all 28. (The unit suite,
 * `EntityDetailPage.test.tsx`, covers the loading/error/permission branches
 * against fixture configs; this file covers the real thing end to end.)
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls. Seed/cleanup
 * follows `admin2-generic-crud-ui.spec.ts`'s established pattern verbatim.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-deve77ffc-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  orgId: string;
  projectId: string;
  projectName: string;
  testPlanId: string;
  testPlanIdentifier: string;
  testPlanScope: string;
  testPlanApproach: string;
  testPlanStaffing: string;
  testPlanSchedule: string;
  environmentId: string;
  environmentName: string;
  environmentConfigNotes: string;
  testLevelId: string;
  testLevelName: string;
}

// One Organization/Project + an org_admin, plus one row each of TestPlan
// (5 hidden fields, all populated so "the detail page shows them" is a real
// assertion rather than a vacuous one against NULLs), Environment (no hidden
// fields) and TestLevel (global catalog).
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import Environment, TestPlan, TestPlanStatus
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    async with AsyncSessionLocal() as session:
        email = f"e2e-admin6-org-admin-{suffix}@example.com"
        org_admin = User(name="ADMIN-6 E2E org admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(org_admin)
        await session.flush()
        session.add(AuthIdentity(user_id=org_admin.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADMIN-6 E2E Org", slug=f"admin6-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=org_admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=org_admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project_name = f"ADMIN-6 E2E Project {suffix}"
        project = Project(org_id=org.id, name=project_name)
        session.add(project)
        await session.flush()

        # Every one of TestPlan's four hidden long-form fields is populated —
        # the detail page assertion is only meaningful against real values.
        plan_identifier = f"ADMIN-6-PLAN-{suffix}"
        plan_scope = f"ADMIN-6 scope text {suffix}"
        plan_approach = f"ADMIN-6 approach text {suffix}"
        plan_staffing = f"ADMIN-6 staffing text {suffix}"
        plan_schedule = f"ADMIN-6 schedule text {suffix}"
        test_plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=org_admin.actor_id,
            identifier=plan_identifier,
            scope=plan_scope,
            approach=plan_approach,
            staffing_and_training=plan_staffing,
            schedule=plan_schedule,
            status=TestPlanStatus.draft,
        )
        session.add(test_plan)

        environment_name = f"ADMIN-6 E2E Env {suffix}"
        environment_config_notes = f"ADMIN-6 config notes {suffix}"
        environment = Environment(project_id=project.id, name=environment_name, config_notes=environment_config_notes)
        session.add(environment)

        test_level_name = f"ADMIN-6 E2E Level {suffix}"
        test_level = TestLevel(name=test_level_name)
        session.add(test_level)

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": email, "password": PASSWORD, "userId": str(org_admin.actor_id)},
            "orgId": str(org.id),
            "projectId": str(project.id),
            "projectName": project_name,
            "testPlanId": str(test_plan.id),
            "testPlanIdentifier": plan_identifier,
            "testPlanScope": plan_scope,
            "testPlanApproach": plan_approach,
            "testPlanStaffing": plan_staffing,
            "testPlanSchedule": plan_schedule,
            "environmentId": str(environment.id),
            "environmentName": environment_name,
            "environmentConfigNotes": environment_config_notes,
            "testLevelId": str(test_level.id),
            "testLevelName": test_level_name,
        }))

asyncio.run(main())
`;

// FK-safe delete order (child-first). `extraEnvironmentIds` covers any row a
// test creates through the UI, in case an assertion fails before its own
// delete-through-the-UI step runs.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.planning import Environment, TestPlan
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel
from app.models.tenancy import Organization, OrgMembership

org_admin_id, org_id, project_id, test_plan_id, environment_id, test_level_id = sys.argv[1:7]
extra_environment_ids = json.loads(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else []

async def main():
    user_ids = [org_admin_id]
    environment_ids = [eid for eid in [environment_id, *extra_environment_ids] if eid]
    async with AsyncSessionLocal() as session:
        if test_plan_id:
            await session.execute(delete(TestPlan).where(TestPlan.id == test_plan_id))
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
      fixture.orgId,
      fixture.projectId,
      fixture.testPlanId,
      fixture.environmentId,
      fixture.testLevelId,
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
 * `page.goto` a generic admin list page and wait for its underlying list call
 * before any assertion — same cold-Vite/permissions-chain timing guard
 * `admin2-generic-crud-ui.spec.ts` already uses, for the same reason.
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

test.describe("ADR-0070: generic entity detail page", () => {
  // Same reasoning as `admin2-generic-crud-ui.spec.ts`: these tests each drive
  // several full page loads against the dev-profile Vite server, and running
  // them concurrently with each other starves it. Scoped to this file only.
  test.describe.configure({ mode: "serial" });

  /**
   * TC-ADMIN-044: clicking a row on a generic admin CRUD list opens that
   * record's detail page, which shows a labeled value for EVERY field the
   * served schema declares — including the five `test-plans` fields the list
   * table itself does not render.
   */
  test("TC-ADMIN-044: a row click opens the detail page, showing every served field including the five the list table hides", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/test-plans`, "test-plans");
      await expect(page.getByRole("heading", { name: /^test plans$/i })).toBeVisible();

      // Precondition, asserted rather than assumed: the four hidden long-form
      // values are genuinely absent from the LIST view. Without this, the
      // detail-page assertions below would pass even if nothing had changed.
      await expect(page.getByRole("row", { name: new RegExp(fixture.testPlanIdentifier) })).toBeVisible();
      await expect(page.getByText(fixture.testPlanScope)).toHaveCount(0);
      await expect(page.getByText(fixture.testPlanApproach)).toHaveCount(0);
      await expect(page.getByText(fixture.testPlanStaffing)).toHaveCount(0);
      await expect(page.getByText(fixture.testPlanSchedule)).toHaveCount(0);
      // `created_by_actor_id` is the fifth `showInTable: false` field and the
      // TC names it alongside the four above — assert its absence from the
      // list too, or the detail-page assertion for it below proves nothing.
      await expect(page.getByText(fixture.orgAdmin.userId)).toHaveCount(0);

      // --- The row click itself ----------------------------------------------------------
      const [detailResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/v1/test-plans/${fixture.testPlanId}`) && res.request().method() === "GET",
        ),
        page.getByTestId(`entity-table-row-${fixture.testPlanId}`).click(),
      ]);
      expect(detailResponse.ok()).toBeTruthy();
      await page.waitForURL(
        new RegExp(`/projects/${fixture.projectId}/admin/test-plans/${fixture.testPlanId}$`),
      );
      await expect(page.getByTestId("entity-detail-page")).toBeVisible();

      // --- Every one of the 8 served fields is present, labeled -------------------------
      const expectedFields: Record<string, string> = {
        project_id: fixture.projectName, // fk, resolved to the ref entity's label field
        identifier: fixture.testPlanIdentifier,
        scope: fixture.testPlanScope,
        approach: fixture.testPlanApproach,
        staffing_and_training: fixture.testPlanStaffing,
        schedule: fixture.testPlanSchedule,
        status: "draft",
        created_by_actor_id: fixture.orgAdmin.userId,
      };
      for (const [name, value] of Object.entries(expectedFields)) {
        await expect(page.getByTestId(`entity-detail-label-${name}`), `label for ${name}`).toBeVisible();
        await expect(
          page.getByTestId(`entity-detail-field-${name}`),
          `value for ${name}`,
        ).toHaveText(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      // The record's own id, which is not in `fields[]`.
      await expect(page.getByTestId("entity-detail-field-id")).toHaveText(fixture.testPlanId);
      // 8 schema fields + the id row, nothing else.
      await expect(page.locator('[data-testid^="entity-detail-field-"]')).toHaveCount(9);

      // The enum renders through the same shared value renderer the table uses.
      await expect(page.getByTestId("entity-detail-field-status").locator("span.badge")).toBeVisible();

      // Breadcrumb: Projects -> {project} -> Test plans -> Details.
      await expect(page.locator("ol.breadcrumb li.breadcrumb-item").last()).toHaveText("Details");
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-045: the identical flow, with no per-entity code path, across two
   * more structurally different entities — a project-scoped one with **no**
   * hidden fields, and an org/global-scoped single-field catalog on the other
   * route shape entirely.
   */
  test("TC-ADMIN-045: the same row-click detail flow works unchanged for a no-hidden-field entity and an org-scoped catalog entity", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      // --- Project-scoped, 3 fields, none hidden ------------------------------------------
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");
      await page.getByTestId(`entity-table-row-${fixture.environmentId}`).click();
      await page.waitForURL(
        new RegExp(`/projects/${fixture.projectId}/admin/environments/${fixture.environmentId}$`),
      );

      await expect(page.getByTestId("entity-detail-field-name")).toHaveText(fixture.environmentName);
      await expect(page.getByTestId("entity-detail-field-config_notes")).toHaveText(
        fixture.environmentConfigNotes,
      );
      await expect(page.getByTestId("entity-detail-field-project_id")).toHaveText(fixture.projectName);
      // Exactly this entity's own 3 fields + the id row — not test-plans' 8.
      await expect(page.locator('[data-testid^="entity-detail-field-"]')).toHaveCount(4);

      // --- Org/global-scoped, 1 field, the other route shape ------------------------------
      await gotoAndWaitForList(page, `/orgs/${fixture.orgId}/admin/test-levels`, "test-levels");
      await page.getByTestId(`entity-table-row-${fixture.testLevelId}`).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}/admin/test-levels/${fixture.testLevelId}$`));

      await expect(page.getByTestId("entity-detail-field-name")).toHaveText(fixture.testLevelName);
      await expect(page.locator('[data-testid^="entity-detail-field-"]')).toHaveCount(2);
      // Org-scoped breadcrumb shape: Dashboard -> Test levels -> Details.
      await expect(page.locator("ol.breadcrumb li.breadcrumb-item").last()).toHaveText("Details");

      // Back returns to the list it came from, on both route shapes.
      await page.getByTestId("entity-detail-back").click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}/admin/test-levels$`));
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-046: the row's own action controls are not row clicks. Clicking
   * Edit opens the edit form (not the detail page); clicking Delete opens the
   * delete-confirm modal and leaves the route alone entirely.
   */
  test("TC-ADMIN-046: Edit and Delete in a row still work and never open the detail page", async ({ page }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");
      const row = page.getByTestId(`entity-table-row-${fixture.environmentId}`);
      await expect(row).toBeVisible();

      // --- Delete: opens the confirm modal, route unchanged --------------------------------
      await row.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("heading", { name: /delete record/i })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(`/projects/${fixture.projectId}/admin/environments`);
      await expect(page.getByTestId("entity-detail-page")).toHaveCount(0);
      await page.locator(".modal-content").getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: /delete record/i })).not.toBeVisible();

      // --- Edit: goes to the edit form, NOT the detail page --------------------------------
      await row.getByRole("button", { name: "Edit" }).click();
      await page.waitForURL(
        new RegExp(`/projects/${fixture.projectId}/admin/environments/${fixture.environmentId}/edit$`),
      );
      await expect(page.getByRole("heading", { name: /^edit environments$/i })).toBeVisible();
      await expect(page.getByTestId("entity-detail-page")).toHaveCount(0);

      // --- ...while a click on the row body still opens the detail page --------------------
      await page.goBack();
      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/admin/environments$`));
      await page.getByTestId(`entity-table-row-${fixture.environmentId}`).click();
      await page.waitForURL(
        new RegExp(`/projects/${fixture.projectId}/admin/environments/${fixture.environmentId}$`),
      );
      await expect(page.getByTestId("entity-detail-page")).toBeVisible();

      // The detail page's own Edit affordance reaches the same edit form.
      await page.getByTestId("entity-detail-edit").click();
      await page.waitForURL(
        new RegExp(`/projects/${fixture.projectId}/admin/environments/${fixture.environmentId}/edit$`),
      );
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-047 (keyboard half, live): a row is genuinely keyboard-reachable
   * — focusing it and pressing Enter navigates exactly as a mouse click does.
   * The unit suite proves the handler wiring; this proves the affordance
   * survives into a real browser's focus model.
   */
  test("TC-ADMIN-047: a focused row navigates on Enter, same as a mouse click", async ({ page }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await gotoAndWaitForList(page, `/orgs/${fixture.orgId}/admin/test-levels`, "test-levels");
      const row = page.getByTestId(`entity-table-row-${fixture.testLevelId}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("tabindex", "0");

      await row.focus();
      await expect(row).toBeFocused();
      await page.keyboard.press("Enter");

      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}/admin/test-levels/${fixture.testLevelId}$`));
      await expect(page.getByTestId("entity-detail-field-name")).toHaveText(fixture.testLevelName);
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-048: ADR-0070 Decision §4 against the one real entity that
   * declares `detailPath` — `Project`. Its row click must land on the bespoke
   * `ProjectDetail` workspace (the same target its own name cell links to),
   * not on the generic detail route.
   */
  test("TC-ADMIN-048: a Project row click opens the bespoke ProjectDetail workspace, not the generic detail route", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await gotoAndWaitForList(page, `/orgs/${fixture.orgId}/projects`, "projects");
      const row = page.getByTestId(`entity-table-row-${fixture.projectId}`);
      await expect(row).toBeVisible();

      // ADR-0060's name-cell link and ADR-0070's row click agree on one target.
      await expect(row.getByRole("link", { name: fixture.projectName })).toHaveAttribute(
        "href",
        `/projects/${fixture.projectId}`,
      );

      /**
       * Click a cell that contains **no anchor**, not merely "the first cell".
       * `Project`'s `detailLinkField` is `name`, and that cell renders an
       * `<a href="/projects/:id">` — clicking it would follow the ADR-0060
       * link and reach the same URL, so the assertion below would pass
       * identically whether the row-click handler existed or not. Filtering
       * the anchor-bearing cell out is what makes this test actually exercise
       * `onRowClick`. (Same vacuous-pass class root CLAUDE.md's testing notes
       * describe — caught in this story's own literal-wording coverage audit,
       * after the weaker version had already passed.)
       */
      const nonLinkCell = row.locator("td").filter({ hasNot: page.locator("a") }).first();
      await expect(nonLinkCell).toBeVisible();
      await nonLinkCell.click();
      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}$`));
      await expect(page.getByTestId("entity-detail-page")).toHaveCount(0);
      // `ProjectDetail`'s own page heading — its literal current shape is
      // `Project: {projectId}`, not the project's name (checked against the
      // component source rather than assumed, per root CLAUDE.md's "grep the
      // actual source for a claim about existing code" rule).
      await expect(
        page.getByRole("heading", { name: `Project: ${fixture.projectId}` }),
      ).toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });
});
