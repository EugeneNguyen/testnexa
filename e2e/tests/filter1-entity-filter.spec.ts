import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ENTITY-FILTER-1 E2E (ADR-0072 / TC-ADMIN-058): real browser, full stack,
 * proving that the new `EntityTable` header "Filter" button actually narrows a
 * real list against the real backend — the claim neither the Vitest suite nor
 * the backend integration suite can make on its own (`frontend/CLAUDE.md`: a
 * hand-typed mock only ever attests that the frontend agrees with itself).
 *
 * **Entity under test: `Environment`, deliberately.** It is project-scoped,
 * has a plain `name` string column, and — crucially — declared **no**
 * `filter_fields` tuple at all before ADR-0072. Filtering it therefore proves
 * the derivation (Decision §1), not just the modal: against pre-ADR-0072 code
 * this spec fails at the point the Filter button is looked for, because
 * `filterableFields(config)` would be empty and the button suppressed.
 *
 * Three claims, in one serial test (each depends on the previous state):
 *   1. An unfiltered list shows all three seeded rows.
 *   2. Adding one exact-match condition through the modal narrows it to one,
 *      and the other two are genuinely gone (not merely "the target is
 *      present" — a filter that did nothing would also satisfy that).
 *   3. A reload clears the filter (ADR-0072 Decision §7 — filters are
 *      deliberately NOT persisted, unlike ADR-0071's column preferences).
 *      This is the positive control for the non-persistence decision: without
 *      it, "the list is unfiltered after reload" would pass identically on a
 *      build where filtering never worked in the first place — claim 2 is what
 *      rules that out, and the two must run in this order against one fixture.
 *
 * Fixture seeding follows the established `docker exec -i <backend-container>
 * python -` pattern (`admin2-generic-crud-ui.spec.ts` is the canonical shape
 * for this surface — copied, not reinvented), with a matching FK-safe
 * child-first cleanup in a `finally` block.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack); `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-filter1-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  orgId: string;
  projectId: string;
  environmentIds: string[];
  targetName: string;
  otherNames: string[];
}

/**
 * One Organization/Project, one `org_admin` (org-wide grant, active
 * membership), and three `Environment` rows whose names share a common
 * random suffix but differ in their leading token — so the target's name is
 * unique enough to exact-match, while all three are unambiguously this
 * fixture's own rows and not a neighbouring test's.
 */
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import Environment
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    async with AsyncSessionLocal() as session:
        email = f"e2e-filter1-admin-{suffix}@example.com"
        org_admin = User(name="FILTER-1 E2E Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(org_admin)
        await session.flush()
        session.add(AuthIdentity(user_id=org_admin.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="FILTER-1 E2E Org", slug=f"filter1-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=org_admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=org_admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"FILTER-1 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        names = [f"Alpha {suffix}", f"Bravo {suffix}", f"Charlie {suffix}"]
        environments = [
            Environment(project_id=project.id, name=name, config_notes="seeded for FILTER-1 E2E")
            for name in names
        ]
        for environment in environments:
            session.add(environment)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": email, "password": PASSWORD, "userId": str(org_admin.actor_id)},
            "orgId": str(org.id),
            "projectId": str(project.id),
            "environmentIds": [str(e.id) for e in environments],
            "targetName": names[0],
            "otherNames": names[1:],
        }))

asyncio.run(main())
`;

// FK-safe delete order (child-first): Environment -> RoleAssignment ->
// RefreshToken (the fixture account really logs in, so a refresh_token row
// exists and RESTRICTs the user delete — see `backend/CLAUDE.md`'s 6-row
// cleanup order) -> Project -> OrgMembership -> AuthIdentity -> Organization
// -> User -> Actor.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.planning import Environment
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_id = sys.argv[1:4]
environment_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []

async def main():
    async with AsyncSessionLocal() as session:
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

/**
 * Navigate and wait for the underlying list call, rather than asserting
 * straight after `goto` — the dev profile's cold Vite transform plus the
 * page's own permissions-then-data fetch chain can exceed the default 5s
 * assertion timeout (`admin2-generic-crud-ui.spec.ts` established this helper
 * for the same surface and the same reason).
 */
async function gotoAndWaitForList(page: import("@playwright/test").Page, url: string) {
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/v1/environments") && res.request().method() === "GET"),
    page.goto(url),
  ]);
  expect(response.ok()).toBeTruthy();
}

test.describe("ENTITY-FILTER-1: EntityTable filter modal narrows a real list", () => {
  test.describe.configure({ mode: "serial" });

  test("filtering by an exact field value narrows the list, and the filter does not survive a reload", async ({
    page,
  }) => {
    // Several full page loads + a modal round trip + a reload all share one
    // budget; the default 30s is not enough on a cold dev stack (`e2e/CLAUDE.md`).
    test.setTimeout(120000);

    const fixture = seedFixture();
    const listUrl = `/projects/${fixture.projectId}/admin/environments`;

    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoAndWaitForList(page, listUrl);

      // --- Claim 1: the unfiltered list shows all three seeded rows ---------
      await expect(page.getByText(fixture.targetName)).toBeVisible({ timeout: 15000 });
      for (const other of fixture.otherNames) {
        await expect(page.getByText(other)).toBeVisible();
      }

      // --- Claim 2: one exact-match condition narrows it to exactly one -----
      // The button's own presence is itself part of the claim: pre-ADR-0072,
      // `Environment` declared no `filter_fields`, so it would be suppressed.
      const filterButton = page.getByTestId("entity-table-filter");
      await expect(filterButton).toBeVisible({ timeout: 15000 });
      await filterButton.click();

      await page.getByTestId("filter-add-condition").click();

      // The first filterable field is pre-selected; point the row at `name`
      // explicitly rather than relying on field order, which the derivation
      // controls and a future schema change could reorder.
      await page.getByTestId("filter-field-0").selectOption("name");
      await page.getByTestId("filter-value-name").fill(fixture.targetName);

      await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/environments") && res.request().method() === "GET",
        ),
        page.getByTestId("filter-apply").click(),
      ]);

      // The target survives...
      await expect(page.getByText(fixture.targetName)).toBeVisible({ timeout: 15000 });
      // ...and — the half that actually proves filtering happened — the other
      // two are gone. A no-op filter would still satisfy the assertion above.
      for (const other of fixture.otherNames) {
        await expect(page.getByText(other)).toHaveCount(0);
      }

      // The header badge reports the active condition, ADR-0072 §7's own
      // mitigation for filters being invisible and non-persisted.
      await expect(page.getByTestId("entity-table-filter-count")).toHaveText("1");

      // --- Claim 3: a reload clears it (filters are NOT persisted, §7) ------
      await gotoAndWaitForList(page, listUrl);

      await expect(page.getByText(fixture.targetName)).toBeVisible({ timeout: 15000 });
      for (const other of fixture.otherNames) {
        await expect(page.getByText(other)).toBeVisible();
      }
      // No badge at all once nothing is applied.
      await expect(page.getByTestId("entity-table-filter-count")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });
});
