import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADMIN-3 E2E (ADR-0053), TC-ADMIN-034 — "a real admin page renders
 * end-to-end from the fetched schema."
 *
 * This is the one layer where "the served schema drives the render" is a real
 * claim: a mocked `useEntitySchema` attests only that the frontend agrees with
 * itself (`frontend/CLAUDE.md`'s hand-typed-mock note), and the backend
 * integration tests (TC-ADMIN-031..033) prove only that the route serves the
 * right body. Nothing but a real browser against a real backend proves the
 * body the route served is the body the page actually rendered from.
 *
 * So every assertion below is written against the **intercepted response
 * body**, never against hardcoded expectations:
 *
 * - `GET /api/v1/entities/requirements/schema` is proven to actually happen
 *   (`page.waitForResponse` + a `page.on("response")` counter) — the
 *   load-bearing assertion, since the whole ADR is "fetch replaces import."
 * - The page heading is matched against `schema.label` read off that response.
 * - The table's `columnheader`s are matched against
 *   `schema.fields.filter(showInTable).map(label)` + the trailing "Actions"
 *   column `EntityTable` adds when `methods` include update/delete.
 * - The create modal's inputs are looked up by *the schema's own* field
 *   labels — including `title`, the exact field whose absence from the old
 *   hand-written `entityConfigs/requirement.ts` is the drift ADR-0053 exists
 *   to close.
 * - FK label resolution (`project_id` -> the Project's `name`) is asserted on
 *   both the seeded row and the row created through the UI, since `refEntity`/
 *   `labelField` are backend-declared `FieldMeta` now
 *   (`assets.py`'s `_REQUIREMENT_CONFIG`), not compiled-in frontend config.
 *
 * **Honest scoping note on "the heading uses the backend-served label":**
 * `EntityListPage` renders `label` from `useAdminRouteContext`, which today
 * sources it from `registry.ts`'s frontend-static `entityLabelByKey` —
 * ADR-0053 deliberately kept the *nav* label frontend-side, and exposes the
 * backend's own as a separate, currently-unconsumed `schemaLabel`. Asserting
 * the rendered heading equals the **served** `label` therefore pins the
 * agreement between the two end-to-end (it fails the moment the backend's
 * `CrudEntityConfig.label` and the registry entry diverge), which is the only
 * thing currently pinning it — `registry.ts`'s docstring claims a Vitest case
 * asserts this, and no such case exists in `frontend/src`.
 *
 * Enum badge classes (also named by TC-ADMIN-034) are not assertable on this
 * entity: `Requirement` has no enum field. That half is covered at the
 * integration layer by TC-ADMIN-031 (`test-plans`.status vs
 * `entry-exit-criteria`.type).
 *
 * Fixture seeding: one org_admin (one Organization, one active OrgMembership,
 * org-wide `org_admin` RoleAssignment), one Project, and one Requirement —
 * copied verbatim from `req1-requirements-ui.spec.ts`'s own SEED/CLEANUP
 * pattern, plus the extra Requirement row TC-ADMIN-034's setup calls for
 * ("a project with a Requirement").
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-admin3-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

const SCHEMA_ROUTE = "/api/v1/entities/requirements/schema";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  projectName: string;
  requirementId: string;
  requirementTitle: string;
}

interface BackendFieldConfig {
  name: string;
  label: string;
  type: string;
  required: boolean;
  showInTable: boolean;
}

interface EntitySchemaResponse {
  resource: string;
  label: string;
  methods: string[];
  fields: BackendFieldConfig[];
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
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-admin3-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="ADMIN-3 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADMIN-3 E2E Org", slug=f"admin3-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project_name = f"ADMIN-3 E2E Project {suffix}"
        project = Project(org_id=org.id, name=project_name)
        session.add(project)
        await session.flush()

        # TC-ADMIN-034's own setup line: "a project with a Requirement".
        requirement_title = f"ADMIN-3 E2E seeded requirement {suffix}"
        requirement = Requirement(
            project_id=project.id,
            title=requirement_title,
            description="Seeded directly via the ORM, ADMIN-3 E2E",
            external_ref=f"JIRA-ADMIN3-{suffix}",
            source="stakeholder interview",
        )
        session.add(requirement)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "projectName": project_name,
            "requirementId": str(requirement.id),
            "requirementTitle": requirement_title,
        }))

asyncio.run(main())
`;

// FK-safe delete order, copied verbatim from `req1-requirements-ui.spec.ts`
// (which mirrors test_requirements_title.py's `_cleanup` helper): Requirement
// rows before the Project they RESTRICT-reference, RefreshToken before the
// User the login minted it for, User before Actor.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_id = sys.argv[1], sys.argv[2], sys.argv[3]
requirement_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []

async def main():
    async with AsyncSessionLocal() as session:
        if requirement_ids:
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
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

function cleanup(fixture: SeededFixture, requirementIds: string[]): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      fixture.userId,
      fixture.orgId,
      fixture.projectId,
      JSON.stringify(requirementIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

/** The served label for one field — every form/table lookup below goes through this. */
function labelFor(schema: EntitySchemaResponse, fieldName: string): string {
  const field = schema.fields.find((f) => f.name === fieldName);
  expect(field, `served schema has no "${fieldName}" field`).toBeTruthy();
  return (field as BackendFieldConfig).label;
}

test.describe("ADMIN-3: the admin surface renders from the backend-served entity schema", () => {
  test("requirements list + create render from GET /entities/requirements/schema (TC-ADMIN-034)", async ({
    page,
  }) => {
    test.setTimeout(90000);

    const fixture = seedFixture();
    const requirementIds: string[] = [fixture.requirementId];
    try {
      // Registered before any navigation: an independent count of how many
      // times the schema route was actually hit, so "the page fetched its own
      // shape" is proven by observation, not inferred from the render.
      const schemaHits: string[] = [];
      page.on("response", (response) => {
        if (response.url().includes(SCHEMA_ROUTE)) {
          schemaHits.push(response.url());
        }
      });

      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // --- The load-bearing assertion: the schema is really fetched ------------
      const [schemaResponse, listResponse] = await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes(SCHEMA_ROUTE) && response.request().method() === "GET",
        ),
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/v1/requirements") && response.request().method() === "GET",
        ),
        page.goto(`/projects/${fixture.projectId}/admin/requirements`),
      ]);
      expect(schemaResponse.ok()).toBeTruthy();
      expect(listResponse.ok()).toBeTruthy();
      expect(schemaHits.length).toBeGreaterThan(0);

      const schema = (await schemaResponse.json()) as EntitySchemaResponse;
      expect(schema.resource).toBe("requirement");
      expect(schema.fields.length).toBeGreaterThan(0);

      // --- The heading is the served label -------------------------------------
      await expect(page.getByRole("heading", { name: schema.label, exact: true })).toBeVisible({
        timeout: 15000,
      });

      // --- The columns are the served fields -----------------------------------
      // `EntityTable` renders one `<th scope="col">` per `showInTable` field, in
      // served order, plus a trailing "Actions" header whenever `methods`
      // include update or delete.
      const table = page.getByRole("table");
      await expect(table).toBeVisible();

      const expectedColumns = schema.fields.filter((f) => f.showInTable !== false).map((f) => f.label);
      if (schema.methods.includes("update") || schema.methods.includes("delete")) {
        expectedColumns.push("Actions");
      }
      const renderedColumns = (await table.getByRole("columnheader").allTextContents()).map((text) =>
        text.trim(),
      );
      expect(renderedColumns).toEqual(expectedColumns);

      // --- The seeded row renders, with its FK column resolved to a label ------
      // `project_id`'s `refEntity`/`labelField` are backend-declared FieldMeta
      // (`_REQUIREMENT_CONFIG`), so a resolved Project *name* here (not a raw
      // UUID) is the served schema driving a second, asynchronous fetch.
      const seededRow = page.getByRole("row", { name: new RegExp(fixture.requirementTitle) });
      await expect(seededRow).toBeVisible({ timeout: 15000 });
      await expect(seededRow.getByText(fixture.projectName, { exact: true })).toBeVisible({
        timeout: 15000,
      });

      // --- Create through the generic admin form -------------------------------
      await page.getByRole("button", { name: /^new$/i }).click();
      await expect(page.getByRole("heading", { name: `New ${schema.label}`, exact: true })).toBeVisible();

      // Every writable served field has a real input, looked up by the label the
      // backend served for it. `project_id` is the route-fixed scope field, so
      // `EntityListPage` passes it as `lockedValues` and it renders display-only.
      const writableFields = schema.fields.filter((f) => f.name !== "project_id");
      for (const field of writableFields) {
        await expect(page.getByLabel(field.label, { exact: true })).toBeVisible();
      }

      const stamp = Date.now().toString(36);
      const title = `ADMIN-3 E2E schema-driven requirement ${stamp}`;
      const externalRef = `JIRA-ADMIN3-UI-${stamp}`;
      await page.getByLabel(labelFor(schema, "title"), { exact: true }).fill(title);
      await page
        .getByLabel(labelFor(schema, "description"), { exact: true })
        .fill("Created through the generic admin form, ADMIN-3 E2E");
      await page.getByLabel(labelFor(schema, "external_ref"), { exact: true }).fill(externalRef);
      await page.getByLabel(labelFor(schema, "source"), { exact: true }).fill("stakeholder interview");

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/v1/requirements") && response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^create$/i }).click(),
      ]);
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json();
      requirementIds.push(created.id);
      // The `title` the form submitted actually reached the backend — the exact
      // field whose absence from the old static config broke every create with a
      // `422 title Field required` (ADR-0053's Context).
      expect(created.title).toBe(title);

      // --- The list round-trips: modal closes, new row appears -----------------
      await expect(page.getByRole("heading", { name: `New ${schema.label}`, exact: true })).not.toBeVisible({
        timeout: 15000,
      });
      const createdRow = page.getByRole("row", { name: new RegExp(title) });
      await expect(createdRow).toBeVisible({ timeout: 15000 });
      await expect(createdRow.getByText(externalRef, { exact: true })).toBeVisible({ timeout: 15000 });
      await expect(createdRow.getByText(fixture.projectName, { exact: true })).toBeVisible({
        timeout: 15000,
      });
    } finally {
      cleanup(fixture, requirementIds);
    }
  });
});
