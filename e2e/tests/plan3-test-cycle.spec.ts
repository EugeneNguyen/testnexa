import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * PLAN-3 E2E (ADR-0033, UI Design Document
 * `docs/ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md`).
 *
 * Two specs, deliberately split by the two halves ADR-0033 built:
 *
 * 1. **`TestCycle` creation through the real UI** — `TestPlanDetail.tsx`'s new
 *    "Test Cycles" section, including the inline "+ New Environment" toggle
 *    (ADR-0033 Decision #4: two sequential frontend calls, `POST
 *    /environments` then `POST /test-plans/{id}/test-cycles`, *not* an atomic
 *    combined route). The fixture deliberately seeds **no** `Environment`, so
 *    the inline flow is the only path to a cycle — and the new `Environment`
 *    row is asserted against the database directly, not just off the screen,
 *    because "the name renders in the list" alone cannot distinguish "both
 *    calls landed" from "the label happened to be echoed back".
 *
 * 2. **The FR-PLAN-3 AC3 scope check on `POST /test-cycles/{id}/executions`**,
 *    both directions in one test. Driven through the API rather than the
 *    browser on purpose: the UI Design Document's own Non-goals say there is
 *    no frontend execution-recording form (that's EXEC-1), so there is nothing
 *    to click. The token is obtained the same way `req1-capture-requirement`/
 *    `project-create` already do it — a real `POST /api/v1/auth/login`, never a
 *    locally minted JWT.
 *
 * The 422-vs-404 distinction in spec 2 is the whole point of the test and is
 * asserted explicitly: an out-of-scope `TestCase` that still resolves to the
 * *same org* is a business-rule rejection (`422 validation_error`), never the
 * tenant-boundary `404` (ADR-0033 §Consequences). `TestCase` B is therefore
 * seeded into a second `TestSuite` in the same project that is simply not
 * included in the plan — resolvable via `TestCase`'s suite-link resolver
 * branch (ADR-0029), so the route reaches the scope check rather than
 * short-circuiting at the resolver.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/verify/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-plan3-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface BaseFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  releaseId: string;
  releaseVersionLabel: string;
  testPlanId: string;
}

interface CycleUiFixture extends BaseFixture {}

interface ExecutionScopeFixture extends BaseFixture {
  environmentId: string;
  testCycleId: string;
  includedSuiteId: string;
  excludedSuiteId: string;
  testCaseInScopeId: string;
  testCaseOutOfScopeId: string;
  testLevelId: string;
  testTypeId: string;
}

/**
 * Spec 1's fixture: org_admin + Organization + active OrgMembership + org-wide
 * `org_admin` RoleAssignment, one Project, one Release, one TestPlan. No
 * `Environment` on purpose (see the file docstring).
 *
 * `User(name=..., email=..., password_hash=...)` is constructed *directly* —
 * never `Actor()` then `User(actor_id=...)`, which breaks the joined-table
 * mapper's identity tracking (`backend/CLAUDE.md`). The email uses a
 * real-shaped `@example.com` domain: `POST /auth/login`'s `EmailStr` rejects
 * the IANA reserved TLDs (`.local`/`.test`/`.invalid`/`.example`) with a 422
 * that reads exactly like a wrong password.
 */
const SEED_CYCLE_UI_SCRIPT = `
import asyncio, json
from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import TestPlan, TestPlanStatus
from app.models.project import Project, Release
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-plan3-ui-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="PLAN-3 UI E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="PLAN-3 UI E2E Org", slug=f"plan3-ui-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"PLAN-3 UI E2E Project {suffix}")
        session.add(project)
        await session.flush()

        version_label = f"plan3-ui-rel-{suffix}"
        release = Release(project_id=project.id, version_label=version_label, target_date=date(2026, 10, 1))
        session.add(release)
        await session.flush()

        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=f"PLAN-3 UI E2E Plan {suffix}",
            scope="Seeded for the PLAN-3 TestCycle-creation E2E spec",
            status=TestPlanStatus.draft,
        )
        session.add(plan)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "releaseId": str(release.id),
            "releaseVersionLabel": version_label,
            "testPlanId": str(plan.id),
        }))

asyncio.run(main())
`;

/**
 * Spec 2's fixture: everything above, plus an `Environment`, a `TestCycle`,
 * two `TestSuite`s (one included in the plan via `TestPlanTestSuite`, one
 * not), two `TestCase`s (one member of each suite), and the `TestLevel`/
 * `TestType` rows their non-nullable FKs require.
 *
 * Both `TestCase`s resolve to the *same org* — the out-of-scope one through
 * `resolve_test_case_org_id`'s `TestSuiteTestCase` fallback branch — which is
 * what makes the 422-not-404 assertion meaningful rather than accidental.
 */
const SEED_EXECUTION_SCOPE_SCRIPT = `
import asyncio, json
from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import TestCase, TestCaseStatus, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import Environment, TestCycle, TestPlan, TestPlanStatus, TestPlanTestSuite
from app.models.project import Project, Release
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-plan3-exec-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="PLAN-3 Exec E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="PLAN-3 Exec E2E Org", slug=f"plan3-exec-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"PLAN-3 Exec E2E Project {suffix}")
        session.add(project)
        await session.flush()

        version_label = f"plan3-exec-rel-{suffix}"
        release = Release(project_id=project.id, version_label=version_label, target_date=date(2026, 10, 1))
        session.add(release)

        environment = Environment(project_id=project.id, name=f"plan3-exec-env-{suffix}")
        session.add(environment)
        await session.flush()

        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=f"PLAN-3 Exec E2E Plan {suffix}",
            scope="Seeded for the PLAN-3 execution-scope-check E2E spec",
            status=TestPlanStatus.draft,
        )
        session.add(plan)
        await session.flush()

        cycle = TestCycle(
            test_plan_id=plan.id,
            release_id=release.id,
            environment_id=environment.id,
            name=f"PLAN-3 Exec E2E Cycle {suffix}",
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 8),
        )
        session.add(cycle)

        included_suite = TestSuite(project_id=project.id, name=f"plan3-included-suite-{suffix}")
        excluded_suite = TestSuite(project_id=project.id, name=f"plan3-excluded-suite-{suffix}")
        session.add(included_suite)
        session.add(excluded_suite)
        await session.flush()

        # Only the first suite is included in the plan — the second exists in
        # the same project purely so TestCase B resolves to this org.
        session.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=included_suite.id))

        level = TestLevel(name=f"e2e-plan3-level-{suffix}")
        test_type = TestType(name=f"e2e-plan3-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        in_scope = TestCase(
            test_condition_id=None,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=user.actor_id,
            title=f"PLAN-3 in-scope test case {suffix}",
            status=TestCaseStatus.draft,
        )
        out_of_scope = TestCase(
            test_condition_id=None,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=user.actor_id,
            title=f"PLAN-3 out-of-scope test case {suffix}",
            status=TestCaseStatus.draft,
        )
        session.add(in_scope)
        session.add(out_of_scope)
        await session.flush()

        session.add(TestSuiteTestCase(test_suite_id=included_suite.id, test_case_id=in_scope.id))
        session.add(TestSuiteTestCase(test_suite_id=excluded_suite.id, test_case_id=out_of_scope.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "releaseId": str(release.id),
            "releaseVersionLabel": version_label,
            "testPlanId": str(plan.id),
            "environmentId": str(environment.id),
            "testCycleId": str(cycle.id),
            "includedSuiteId": str(included_suite.id),
            "excludedSuiteId": str(excluded_suite.id),
            "testCaseInScopeId": str(in_scope.id),
            "testCaseOutOfScopeId": str(out_of_scope.id),
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

/**
 * One FK-safe, child-first cleanup for both specs, taking `(user_id, org_id,
 * project_id, test_level_ids, test_type_ids)` as `sys.argv`.
 *
 * Rows are discovered **by scope**, not by a pre-known id list, precisely
 * because spec 1's `Environment` is created by the *UI*, not by the seed
 * script — deleting environments by `project_id` is the only way to reach it.
 * The same reasoning applies to the `TestCycle` the UI creates.
 *
 * `TestCycle`'s three FKs (`test_plan_id`/`release_id`/`environment_id`) and
 * `TestExecution`'s two are all `ondelete="RESTRICT"`, so the order below is
 * load-bearing: executions -> cycles -> link tables -> test cases -> suites ->
 * plans -> environments/releases -> taxonomy -> RBAC/auth -> project ->
 * user/actor -> organization.
 */
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.execution import TestExecution
from app.models.planning import (
    EntryExitCriteria,
    Environment,
    TestCycle,
    TestPlan,
    TestPlanTestSuite,
)
from app.models.project import Project, Release
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestCaseLink

user_id, org_id, project_id = sys.argv[1], sys.argv[2], sys.argv[3]
test_level_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []
test_type_ids = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else []

async def main():
    async with AsyncSessionLocal() as session:
        plan_ids = (await session.execute(select(TestPlan.id).where(TestPlan.project_id == project_id))).scalars().all()
        suite_ids = (await session.execute(select(TestSuite.id).where(TestSuite.project_id == project_id))).scalars().all()
        requirement_ids = (
            await session.execute(select(Requirement.id).where(Requirement.project_id == project_id))
        ).scalars().all()
        cycle_ids = []
        if plan_ids:
            cycle_ids = (
                await session.execute(select(TestCycle.id).where(TestCycle.test_plan_id.in_(plan_ids)))
            ).scalars().all()

        if cycle_ids:
            await session.execute(delete(TestExecution).where(TestExecution.test_cycle_id.in_(cycle_ids)))
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(cycle_ids)))

        if suite_ids:
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id.in_(suite_ids)))
        if plan_ids:
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.test_plan_id.in_(plan_ids)))
            await session.execute(delete(EntryExitCriteria).where(EntryExitCriteria.test_plan_id.in_(plan_ids)))
        if requirement_ids:
            await session.execute(
                delete(RequirementTestCaseLink).where(RequirementTestCaseLink.requirement_id.in_(requirement_ids))
            )

        # Every TestCase these specs create is stamped with the seeded actor.
        await session.execute(delete(TestCase).where(TestCase.created_by_actor_id == user_id))
        if suite_ids:
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
        if requirement_ids:
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
        if plan_ids:
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(plan_ids)))

        # By project_id, not by id: spec 1's Environment is created by the UI.
        await session.execute(delete(Environment).where(Environment.project_id == project_id))
        await session.execute(delete(Release).where(Release.project_id == project_id))

        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))

        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.commit()

asyncio.run(main())
`;

/**
 * Spec 1's database-level proof that the *first* of the two sequential calls
 * really landed: count `Environment` rows by `(project_id, name)`. Reading the
 * name off the rendered list proves only that the label resolved, not that a
 * row exists.
 */
const VERIFY_ENVIRONMENT_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.planning import Environment

project_id, name = sys.argv[1], sys.argv[2]

async def main():
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(Environment).where(Environment.project_id == project_id, Environment.name == name)
            )
        ).scalars().all()
        print(json.dumps({
            "count": len(rows),
            "ids": [str(row.id) for row in rows],
            "configNotes": [row.config_notes for row in rows],
        }))

asyncio.run(main())
`;

function runBackendPython<T>(script: string, args: string[] = []): T {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-", ...args], {
    input: script,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as T;
}

function cleanup(
  fixture: { userId: string; orgId: string; projectId: string },
  testLevelIds: string[] = [],
  testTypeIds: string[] = [],
): void {
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
      JSON.stringify(testLevelIds),
      JSON.stringify(testTypeIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("PLAN-3: create a TestCycle through TestPlanDetail's Test Cycles section", () => {
  test("create a TestCycle end to end through the UI, including the inline-new-environment flow", async ({
    page,
  }) => {
    const fixture = runBackendPython<CycleUiFixture>(SEED_CYCLE_UI_SCRIPT);
    try {
      // --- Log in through the real login form ---------------------------------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // --- The plan's own route, with an empty Test Cycles section -------------
      await page.goto(`/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}`);
      await expect(page.getByRole("heading", { name: /^test cycles$/i })).toBeVisible();
      await expect(page.getByTestId("test-cycles-load-error")).toHaveCount(0);
      await expect(page.getByText(/no test cycles yet\./i)).toBeVisible();

      // --- Open "Create Cycle" -------------------------------------------------
      await page.getByTestId("create-cycle-btn").click();
      await expect(page.getByTestId("create-cycle-modal")).toBeVisible();

      // --- Release: an FkAutocomplete — type to search, then click the option --
      const releaseWrapper = page.getByTestId("create-cycle-release");
      const releaseInput = releaseWrapper.locator("#cycleReleaseId");
      await expect(releaseInput).toBeEnabled();
      await releaseInput.fill(fixture.releaseVersionLabel.slice(0, 10));
      const releaseOption = releaseWrapper.getByRole("button", {
        name: fixture.releaseVersionLabel,
        exact: true,
      });
      await expect(releaseOption).toBeVisible();
      await releaseOption.click();
      // Selecting an option stores the id and re-displays the label (the widget
      // re-fetches the row by id) — the visible confirmation a selection stuck.
      await expect(releaseInput).toHaveValue(fixture.releaseVersionLabel);

      // --- Environment: the project has none, so use the inline create flow ----
      // Before the toggle, the plain autocomplete is the rendered field.
      await expect(page.getByTestId("create-cycle-environment")).toBeVisible();
      await page.getByTestId("new-environment-toggle").click();
      // §1: the toggle *replaces* that one field — the wrapper leaves the DOM.
      await expect(page.getByTestId("create-cycle-environment")).toHaveCount(0);

      const environmentName = `plan3-ui-env-${Date.now().toString(36)}`;
      await page.getByTestId("new-environment-name").fill(environmentName);
      await page.getByTestId("new-environment-config-notes").fill("Created inline by the PLAN-3 E2E spec");

      const cycleName = `PLAN-3 UI E2E Cycle ${Date.now().toString(36)}`;
      await page.getByTestId("cycle-name").fill(cycleName);
      await page.getByTestId("cycle-start-date").fill("2026-10-01");
      await page.getByTestId("cycle-end-date").fill("2026-10-08");

      // --- Submit: two sequential calls (ADR-0033 Decision #4) ----------------
      const environmentResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/environments") && response.request().method() === "POST",
      );
      const cycleResponsePromise = page.waitForResponse(
        (response) =>
          /\/api\/v1\/test-plans\/[^/]+\/test-cycles$/.test(response.url()) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("create-cycle-submit").click();

      const environmentResponse = await environmentResponsePromise;
      expect(environmentResponse.status()).toBe(201);
      const createdEnvironment = await environmentResponse.json();
      expect(createdEnvironment.name).toBe(environmentName);
      expect(createdEnvironment.project_id).toBe(fixture.projectId);

      const cycleResponse = await cycleResponsePromise;
      expect(cycleResponse.status()).toBe(201);
      const createdCycle = await cycleResponse.json();
      // The second call really used the id the first one returned.
      expect(createdCycle.environment_id).toBe(createdEnvironment.id);
      expect(createdCycle.release_id).toBe(fixture.releaseId);
      expect(createdCycle.test_plan_id).toBe(fixture.testPlanId);

      // 1. The modal closes.
      await expect(page.getByTestId("create-cycle-modal")).toBeHidden();
      await expect(page.getByTestId("cycle-error")).toHaveCount(0);

      // 2. The new cycle appears in the list, with its name and the *newly
      //    created* environment's name (the label lookup was re-fetched, which
      //    is only possible if the Environment row is really there).
      const cycleRow = page.getByTestId(`test-cycle-${createdCycle.id}`);
      await expect(page.getByTestId("test-cycle-list")).toBeVisible();
      await expect(cycleRow).toBeVisible();
      await expect(cycleRow).toContainText(cycleName);
      await expect(cycleRow).toContainText(environmentName);
      await expect(cycleRow).toContainText(fixture.releaseVersionLabel);
      await expect(cycleRow).toContainText("2026-10-01");
      await expect(cycleRow).toContainText("2026-10-08");

      // 3. The row links to the generic admin surface rather than duplicating
      //    edit/delete here (ADR-0033's "create-and-view only" posture).
      const adminLink = page.getByTestId(`view-in-admin-${createdCycle.id}`);
      await expect(adminLink).toBeVisible();
      await expect(adminLink).toHaveAttribute(
        "href",
        `/projects/${fixture.projectId}/admin/test-cycles/${createdCycle.id}/edit`,
      );

      // 4. The Environment row genuinely exists in the database — asserted
      //    against the backend directly, not read off the screen.
      const verified = runBackendPython<{
        count: number;
        ids: string[];
        configNotes: (string | null)[];
      }>(VERIFY_ENVIRONMENT_SCRIPT, [fixture.projectId, environmentName]);
      expect(verified.count).toBe(1);
      expect(verified.ids[0]).toBe(createdEnvironment.id);
      expect(verified.configNotes[0]).toBe("Created inline by the PLAN-3 E2E spec");
    } finally {
      cleanup(fixture);
    }
  });
});

test.describe("PLAN-3: FR-PLAN-3 AC3 execution scope check", () => {
  test("an in-scope execution is accepted (201) and an out-of-scope one is rejected (422, not 404)", async ({
    request,
  }) => {
    const fixture = runBackendPython<ExecutionScopeFixture>(SEED_EXECUTION_SCOPE_SCRIPT);
    try {
      const login = await request.post("/api/v1/auth/login", {
        data: { email: fixture.email, password: fixture.password },
      });
      expect(login.ok()).toBeTruthy();
      const token = (await login.json()).access_token as string;
      const headers = { Authorization: `Bearer ${token}` };

      // --- In scope: member of a suite included in this cycle's plan -> 201 ---
      const executedAt = new Date().toISOString();
      const accepted = await request.post(`/api/v1/test-cycles/${fixture.testCycleId}/executions`, {
        headers,
        data: {
          test_case_id: fixture.testCaseInScopeId,
          result: "pass",
          actual_result: "PLAN-3 E2E: behaved as expected",
          executed_at: executedAt,
        },
      });
      expect(accepted.status()).toBe(201);
      const execution = await accepted.json();
      expect(execution.test_cycle_id).toBe(fixture.testCycleId);
      expect(execution.test_case_id).toBe(fixture.testCaseInScopeId);
      expect(execution.result).toBe("pass");
      // `executed_by_actor_id` is stamped server-side from the authenticated
      // actor — it is not in the request body at all.
      expect(execution.executed_by_actor_id).toBe(fixture.userId);

      // --- Out of scope: same org/project, but in a suite the plan doesn't
      //     include -> 422 business-rule rejection, explicitly NOT the
      //     tenant-boundary 404 (ADR-0033 §Consequences).
      const rejected = await request.post(`/api/v1/test-cycles/${fixture.testCycleId}/executions`, {
        headers,
        data: {
          test_case_id: fixture.testCaseOutOfScopeId,
          result: "pass",
          actual_result: "PLAN-3 E2E: should never be recorded",
          executed_at: new Date().toISOString(),
        },
      });
      expect(rejected.status()).not.toBe(404);
      expect(rejected.status()).toBe(422);
      const rejectedBody = await rejected.json();
      expect(rejectedBody.code).toBe("validation_error");
    } finally {
      cleanup(fixture, [fixture.testLevelId], [fixture.testTypeId]);
    }
  });
});
