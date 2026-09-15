import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * COLPREF-1 E2E (ADR-0071 / FR-ADMIN-4): real browser, full stack, exercising
 * `EntityTable`'s new "Columns" header button + `ColumnPreferencesModal`
 * against the generic admin entity list.
 *
 * The claim this file exists to prove, and which no Vitest test can:
 * **the preference survives a genuine browser reload.** The unit suite
 * (`entity-table.columnPreferences.test.tsx`) proves it survives an
 * unmount/remount in jsdom, which is the closest in-process proxy — but
 * jsdom's `localStorage` is a per-test in-memory shim, not a real browser's
 * origin-scoped store, and nothing in a Vitest run ever tears down and
 * re-executes the whole app bundle the way `page.reload()` does.
 *
 * Fixture: one Organization/Project + an `org_admin` actor + two
 * `Environment` rows (direct `project_id` scope — the simplest entity on this
 * surface with more than two columns: `Project` (fk) / `Name` /
 * `Config notes`) + one `Requirement` row as the second entity for the
 * per-entity-isolation case. Same `docker exec -i <backend> python -`
 * seed/cleanup pattern `admin2-generic-crud-ui.spec.ts` established.
 *
 * TC-ADMIN-051's literal precondition asks for two entities "similar enough
 * to catch a key-prefix bug." That half is asserted directly, and more
 * precisely, in `frontend/src/lib/columnPreferences.test.ts`
 * (`test_case`/`test_case_step`/`test_condition`/`test` against one another);
 * what this file adds is the same isolation claim proven across two real
 * routes in a real browser, which is the part a pure-data test cannot reach.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names
 * its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-colprefs-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  orgId: string;
  projectId: string;
  environmentIds: string[];
  requirementId: string;
}

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
from app.models.planning import Environment
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    async with AsyncSessionLocal() as session:
        email = f"e2e-colpref1-{suffix}@example.com"
        user = User(name="COLPREF-1 E2E admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="COLPREF-1 E2E Org", slug=f"colpref1-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"COLPREF-1 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        environments = [
            Environment(project_id=project.id, name=f"COLPREF-1 Env A {suffix}", config_notes="notes-alpha"),
            Environment(project_id=project.id, name=f"COLPREF-1 Env B {suffix}", config_notes="notes-beta"),
        ]
        for environment in environments:
            session.add(environment)

        # Entity B for the per-entity-isolation test. A *row* is required, not
        # just the entity: with zero rows EntityTable renders "No records
        # found." and no <table> at all, so a header-order assertion would read
        # an empty list and fail for a reason unrelated to key isolation.
        requirement = Requirement(
            project_id=project.id,
            title=f"COLPREF-1 E2E Requirement {suffix}",
            description="seeded so the requirements list renders a real table",
        )
        session.add(requirement)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": email, "password": PASSWORD, "userId": str(user.actor_id)},
            "orgId": str(org.id),
            "projectId": str(project.id),
            "environmentIds": [str(e.id) for e in environments],
            "requirementId": str(requirement.id),
        }))

asyncio.run(main())
`;

const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, RefreshToken
from app.models.planning import Environment
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_id, requirement_id = sys.argv[1:5]
environment_ids = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else []

async def main():
    async with AsyncSessionLocal() as session:
        if requirement_id:
            await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
        if environment_ids:
            await session.execute(delete(Environment).where(Environment.id.in_(environment_ids)))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        if project_id:
            await session.execute(delete(Project).where(Project.id == project_id))
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
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      fixture.orgAdmin.userId,
      fixture.orgId,
      fixture.projectId,
      fixture.requirementId,
      JSON.stringify(fixture.environmentIds),
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

/** See `admin2-generic-crud-ui.spec.ts` for why the list response is awaited. */
async function gotoAndWaitForList(page: import("@playwright/test").Page, url: string, resourcePath: string) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(`/api/v1/${resourcePath}`) && res.request().method() === "GET",
    ),
    page.goto(url),
  ]);
  expect(response.ok()).toBeTruthy();
}

/**
 * The rendered column headers, in rendered order.
 *
 * Reads `textContent`, NOT Playwright's `allInnerTexts()`. `allInnerTexts()`
 * returns the *rendered* text, which applies CSS `text-transform` — and
 * Tabler styles bare `th` text uppercase, so the trailing "Actions" header
 * came back as "ACTIONS" while every sortable header (whose label sits inside
 * a `.btn`, which Bootstrap resets to `text-transform: none`) came back
 * normally. That inconsistency is a styling fact, not something this spec is
 * asserting about; `textContent` is the DOM's own source text and is stable
 * against it.
 */
async function headerLabels(page: import("@playwright/test").Page): Promise<string[]> {
  return page
    .locator("table thead th")
    .evaluateAll((cells) => cells.map((cell) => (cell.textContent ?? "").trim()));
}

test.describe("COLPREF-1: per-entity column visibility and order", () => {
  // Same rationale as `admin2-generic-crud-ui.spec.ts`: every test here drives
  // several full page loads against the unoptimized Vite dev server.
  test.describe.configure({ mode: "serial" });

  test("the Columns button opens a modal listing every column of the entity's schema (TC-ADMIN-047)", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");

      await expect(page.getByTestId("entity-table-columns")).toBeVisible();
      await expect(page.getByTestId("column-preferences-list")).toHaveCount(0);

      await page.getByTestId("entity-table-columns").click();

      const list = page.getByTestId("column-preferences-list");
      await expect(list).toBeVisible();
      await expect(list.locator("li")).toHaveCount(3);
      await expect(page.getByTestId("column-preferences-row-project_id")).toBeVisible();
      await expect(page.getByTestId("column-preferences-row-name")).toBeVisible();
      await expect(page.getByTestId("column-preferences-row-config_notes")).toBeVisible();

      expect(await headerLabels(page)).toEqual(["Project", "Name", "Config notes", "Actions"]);
    } finally {
      cleanup(fixture);
    }
  });

  test("hiding a column removes it, and it stays hidden across a full page reload (TC-ADMIN-048, TC-ADMIN-050)", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");

      await page.getByTestId("entity-table-columns").click();
      await page.getByTestId("column-preferences-toggle-config_notes").uncheck();
      await page.getByTestId("column-preferences-apply").click();

      await expect(page.getByTestId("column-preferences-list")).toHaveCount(0);
      expect(await headerLabels(page)).toEqual(["Project", "Name", "Actions"]);
      // The row data for the *other* columns is untouched.
      await expect(page.getByText("COLPREF-1 Env A")).toBeVisible();
      await expect(page.getByText("notes-alpha")).toHaveCount(0);

      // The real claim: a genuine browser reload, re-executing the whole app
      // bundle from scratch against the same origin's localStorage.
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/environments") && res.request().method() === "GET",
        ),
        page.reload(),
      ]);
      expect(response.ok()).toBeTruthy();

      expect(await headerLabels(page)).toEqual(["Project", "Name", "Actions"]);
      await expect(page.getByText("notes-alpha")).toHaveCount(0);

      // And the modal reopens showing the persisted state, not the default.
      await page.getByTestId("entity-table-columns").click();
      await expect(page.getByTestId("column-preferences-toggle-config_notes")).not.toBeChecked();
      await expect(page.getByTestId("column-preferences-toggle-name")).toBeChecked();
    } finally {
      cleanup(fixture);
    }
  });

  test("reordering a column persists across a full page reload (TC-ADMIN-049, TC-ADMIN-050)", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");
      expect(await headerLabels(page)).toEqual(["Project", "Name", "Config notes", "Actions"]);

      await page.getByTestId("entity-table-columns").click();
      // First row's Up is disabled; last row's Down is disabled.
      await expect(page.getByTestId("column-preferences-up-project_id")).toBeDisabled();
      await expect(page.getByTestId("column-preferences-down-config_notes")).toBeDisabled();

      await page.getByTestId("column-preferences-up-name").click();
      await page.getByTestId("column-preferences-apply").click();

      expect(await headerLabels(page)).toEqual(["Name", "Project", "Config notes", "Actions"]);

      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/environments") && res.request().method() === "GET",
        ),
        page.reload(),
      ]);
      expect(response.ok()).toBeTruthy();
      expect(await headerLabels(page)).toEqual(["Name", "Project", "Config notes", "Actions"]);

      // Each row's cells moved with the header, not just the header: cell 0 is
      // now the environment's Name and cell 1 the FK Project, the reverse of
      // the config default.
      //
      // `expect(locator).toContainText` (auto-retrying) rather than a one-shot
      // `textContent` read — `EntityTable` resolves FK cells through a batched
      // `getEntity` lookup that lands a moment after first paint, so
      // immediately after a reload the Project cell still holds the raw UUID.
      // That is pre-existing FK-label behaviour, unrelated to column order;
      // reading it once races it.
      const firstRow = page.locator("table tbody tr").first();
      await expect(firstRow.locator("td").nth(0)).toContainText("COLPREF-1 Env");
      await expect(firstRow.locator("td").nth(1)).toContainText("COLPREF-1 E2E Project");
    } finally {
      cleanup(fixture);
    }
  });

  test("a hidden column AND a reorder, made in one session, both survive one reload (TC-ADMIN-050)", async ({
    page,
  }) => {
    // TC-ADMIN-050's literal precondition: "one column hidden **and** two
    // columns reordered, in the same session". The two tests above each prove
    // one half after a reload; this one proves the single stored object
    // round-trips both — a write path that persists `hidden` but drops
    // `order` passes both of those and fails only here.
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");

      await page.getByTestId("entity-table-columns").click();
      await page.getByTestId("column-preferences-toggle-config_notes").uncheck();
      await page.getByTestId("column-preferences-up-name").click();
      await page.getByTestId("column-preferences-apply").click();
      expect(await headerLabels(page)).toEqual(["Name", "Project", "Actions"]);

      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/environments") && res.request().method() === "GET",
        ),
        page.reload(),
      ]);
      expect(response.ok()).toBeTruthy();

      // Both halves, after one reload, from one stored object.
      expect(await headerLabels(page)).toEqual(["Name", "Project", "Actions"]);
      const stored = await page.evaluate(() =>
        JSON.parse(window.localStorage.getItem("testnexa.column-prefs.environment") ?? "null"),
      );
      expect(stored).toEqual({ v: 1, order: ["name", "project_id", "config_notes"], hidden: ["config_notes"] });
    } finally {
      cleanup(fixture);
    }
  });

  test("the stored preference is keyed per entity (TC-ADMIN-051)", async ({ page }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");

      await page.getByTestId("entity-table-columns").click();
      await page.getByTestId("column-preferences-toggle-config_notes").uncheck();
      await page.getByTestId("column-preferences-apply").click();
      expect(await headerLabels(page)).toEqual(["Project", "Name", "Actions"]);

      const keys = await page.evaluate(() =>
        Object.keys(window.localStorage).filter((k) => k.startsWith("testnexa.column-prefs.")),
      );
      expect(keys).toEqual(["testnexa.column-prefs.environment"]);

      // A different entity on the same surface is untouched — its own key was
      // never written, so it renders its full config-default column set.
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/requirements`, "requirements");
      const requirementHeaders = await headerLabels(page);
      expect(requirementHeaders.length).toBeGreaterThan(1);

      const keysAfter = await page.evaluate(() =>
        Object.keys(window.localStorage).filter((k) => k.startsWith("testnexa.column-prefs.")),
      );
      expect(keysAfter).toEqual(["testnexa.column-prefs.environment"]);
    } finally {
      cleanup(fixture);
    }
  });

  test("Reset to defaults restores the entity's own column set (TC-ADMIN-048)", async ({ page }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoAndWaitForList(page, `/projects/${fixture.projectId}/admin/environments`, "environments");

      await page.getByTestId("entity-table-columns").click();
      await page.getByTestId("column-preferences-toggle-config_notes").uncheck();
      await page.getByTestId("column-preferences-up-name").click();
      await page.getByTestId("column-preferences-apply").click();
      expect(await headerLabels(page)).toEqual(["Name", "Project", "Actions"]);

      await page.getByTestId("entity-table-columns").click();
      await page.getByTestId("column-preferences-reset").click();

      expect(await headerLabels(page)).toEqual(["Project", "Name", "Config notes", "Actions"]);
      const keys = await page.evaluate(() =>
        Object.keys(window.localStorage).filter((k) => k.startsWith("testnexa.column-prefs.")),
      );
      expect(keys).toEqual([]);
    } finally {
      cleanup(fixture);
    }
  });

  test("a locked column cannot be hidden (TC-ADMIN-052)", async ({ page }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      // `Project` is the one entity with ADR-0060 detail navigation
      // (`detailPath` + `detailLinkField: "name"`), so its `Name` column is
      // the locked one — hiding it would remove the only way into
      // `ProjectDetail`.
      await gotoAndWaitForList(page, `/orgs/${fixture.orgId}/projects`, "projects");
      await page.getByTestId("entity-table-columns").click();

      await expect(page.getByTestId("column-preferences-toggle-name")).toBeDisabled();
      await expect(page.getByTestId("column-preferences-toggle-name")).toBeChecked();
      await expect(page.getByTestId("column-preferences-toggle-name")).toHaveAttribute(
        "title",
        /cannot be hidden/i,
      );

      // A stale stored preference that marks the locked column hidden is
      // overridden rather than obeyed.
      await page.evaluate(() =>
        window.localStorage.setItem(
          "testnexa.column-prefs.project",
          JSON.stringify({ v: 1, order: [], hidden: ["name"] }),
        ),
      );
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/v1/projects") && res.request().method() === "GET"),
        page.reload(),
      ]);
      expect(response.ok()).toBeTruthy();
      expect(await headerLabels(page)).toContain("Name");
    } finally {
      cleanup(fixture);
    }
  });
});
