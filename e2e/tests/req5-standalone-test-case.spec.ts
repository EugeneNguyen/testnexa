import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * REQ-5 E2E, browser UI (ADR-0068): the standalone TestCase authoring path
 * (no Requirement, no TestCondition) via the project-mode sidebar's
 * "Test cases" nav item — the generic admin surface at
 * `/projects/:projectId/admin/test-cases`, non-functional until this story
 * (ADR-0051's own dead-end nav item, now working) — plus the retrofit
 * "Link to Requirement" action on the standalone case's edit page.
 *
 * Covers TC-REQ-015/016/017's UI path, complementing (not replacing) the
 * backend's own `test_req5_standalone_test_case.py` integration suite.
 *
 * Fixture seeding mirrors `req2-direct-test-case-ui.spec.ts`.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-req5-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  requirementId: string;
  requirementTitle: string;
  testLevelName: string;
  testTypeName: string;
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
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-req5-ui-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="REQ-5 UI E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="REQ-5 UI E2E Org", slug=f"req5-ui-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"REQ-5 UI E2E Project {suffix}")
        session.add(project)
        await session.flush()

        requirement_title = f"REQ-5 UI E2E requirement {suffix}"
        requirement = Requirement(project_id=project.id, title=requirement_title, description="Seeded for REQ-5 UI E2E")
        session.add(requirement)
        await session.flush()

        test_level_name = f"E2E Level {suffix}"
        test_type_name = f"E2E Type {suffix}"
        session.add(TestLevel(name=test_level_name))
        session.add(TestType(name=test_type_name))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
            "requirementTitle": requirement_title,
            "testLevelName": test_level_name,
            "testTypeName": test_type_name,
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring test_req5_standalone_test_case.py's `_cleanup` helper.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestCaseLink

user_id, org_id, project_id, requirement_id, test_level_name, test_type_name = sys.argv[1:7]
test_case_ids = json.loads(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else []

async def main():
    async with AsyncSessionLocal() as session:
        if test_case_ids:
            await session.execute(delete(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id.in_(test_case_ids)))
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
        await session.execute(delete(TestLevel).where(TestLevel.name == test_level_name))
        await session.execute(delete(TestType).where(TestType.name == test_type_name))
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

function cleanup(fixture: SeededFixture, testCaseIds: string[]): void {
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
      fixture.requirementId,
      fixture.testLevelName,
      fixture.testTypeName,
      JSON.stringify(testCaseIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("REQ-5: standalone TestCase authoring via the sidebar's generic admin surface + Link to Requirement", () => {
  test("create via /admin/test-cases (no Requirement picker), then link it to a Requirement from its edit page", async ({
    page,
  }) => {
    // e2e/CLAUDE.md: bump the whole-test timeout — this spec chains login +
    // create + a modal round trip + a second link-requirement modal round trip.
    test.setTimeout(90000);
    const fixture = seedFixture();
    const testCaseIds: string[] = [];
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // --- Reach the generic admin surface via the sidebar's "Test cases" nav item --
      await page.goto(`/projects/${fixture.projectId}`);
      // Wait for the page to genuinely finish loading before looking for the
      // nav item — a cold first navigation's org/project-context resolution
      // can otherwise race the locator (e2e/CLAUDE.md's own read-before-render note).
      await expect(page.getByRole("heading", { name: /^requirements$/i })).toBeVisible({ timeout: 15000 });
      await page.getByRole("link", { name: /^test cases$/i }).first().click();
      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/admin/test-cases$`));

      // Previously a dead end ("Listing is not available for this entity",
      // ADR-0051) — now a working list, empty for a fresh project.
      await expect(page.getByText(/listing is not available/i)).not.toBeVisible();
      await expect(page.getByText(/no records found/i)).toBeVisible();

      // --- Create a standalone TestCase — no Requirement field on this form ----
      // (`test_condition_id` does render, always optional and left blank here —
      // it's `UpdateTestCaseRequest`'s own field, unioned into the generic
      // form's schema per ADR-0053; the generic factory's `create_schema`
      // itself, `CreateStandaloneTestCaseRequest`, has no such field at all.)
      await page.getByRole("button", { name: /^new$/i }).click();
      await expect(page.getByLabel(/^title$/i)).toBeVisible();
      await expect(page.getByLabel(/requirement/i)).toHaveCount(0);

      const testCaseTitle = `REQ-5 UI E2E standalone case ${Date.now().toString(36)}`;
      await page.getByLabel(/^title$/i).fill(testCaseTitle);

      // `test_level_id`/`test_type_id` are FK fields — `FkAutocomplete`
      // (type-to-search), not a plain `<select>`, on this generic form.
      await page.getByLabel(/test level/i).fill(fixture.testLevelName.slice(0, 8));
      await page.getByText(fixture.testLevelName, { exact: true }).click();
      await page.getByLabel(/test type/i).fill(fixture.testTypeName.slice(0, 8));
      await page.getByText(fixture.testTypeName, { exact: true }).click();
      // `status` is a plain enum `<select>`, no default pre-selected on this
      // generic create form — pick one explicitly, same as a real user would.
      await page.getByLabel(/^status$/i).selectOption("draft");

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes("/api/v1/test-cases") && response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^create$/i }).click(),
      ]);
      expect(createResponse.ok()).toBeTruthy();
      const createdTestCase = await createResponse.json();
      testCaseIds.push(createdTestCase.id);
      expect(createdTestCase.test_condition_id).toBeNull();
      expect(createdTestCase.project_id).toBe(fixture.projectId);

      // --- Sidebar-reachability: the new case appears on the same list ---------
      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/admin/test-cases$`));
      await expect(page.getByText(testCaseTitle)).toBeVisible();

      // --- Edit page: unlinked state, "Link to Requirement" section ------------
      const row = page.getByRole("row", { name: new RegExp(testCaseTitle) });
      await row.getByRole("button", { name: /^edit$/i }).click();
      await page.waitForURL(new RegExp(`/admin/test-cases/${createdTestCase.id}/edit`));
      await expect(page.getByTestId("test-case-requirement-link-empty")).toContainText(
        "This test case has no Requirement.",
      );

      await page.getByTestId("test-case-link-requirement-button").click();
      await expect(page.getByRole("heading", { name: /link to requirement/i })).toBeVisible();

      await page.getByLabel(/^requirement$/i).fill(fixture.requirementTitle.slice(0, 12));
      await page.getByText(fixture.requirementTitle, { exact: true }).click();

      const [linkResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/test-cases/${createdTestCase.id}/link-requirement`) &&
            response.request().method() === "POST",
        ),
        page.getByTestId("test-case-link-requirement-submit").click(),
      ]);
      expect(linkResponse.ok()).toBeTruthy();

      // Modal closes, section flips to the read-only linked state showing the
      // Requirement's own title.
      await expect(page.getByRole("heading", { name: /link to requirement/i })).not.toBeVisible();
      await expect(page.getByLabel(/linked requirement/i)).toHaveValue(fixture.requirementTitle);
      await expect(page.getByTestId("test-case-link-requirement-button")).not.toBeVisible();
    } finally {
      cleanup(fixture, testCaseIds);
    }
  });
});
