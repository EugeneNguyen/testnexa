import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * PLAN-2 E2E, browser UI (ADR-0032 + the PLAN-2 UI Design Document): real
 * browser, full stack, exercising both halves of FR-PLAN-2 end to end.
 *
 * Two tests, one per test case, each with its own self-seeded fixture and
 * FK-safe teardown (the `e2e/CLAUDE.md` seed/cleanup pattern, copied from
 * `plan1-test-plan-membership.spec.ts`):
 *
 * - **TC-PLAN-004** — `TestPlanDetail`'s new "Entry/Exit Criteria" section.
 *   All four criteria types (`entry`/`exit`/`suspension`/`resumption`) are
 *   created *through the "Add Criteria" modal in the real UI*, not seeded,
 *   because the TC's literal wording is "POST one criteria row per type" —
 *   seeding them and only asserting rendering would prove the read path and
 *   silently skip the write path. Then the list `GET` is asserted to carry all
 *   four, one row is `PATCH`ed via its "Edit" button (new text present, OLD
 *   text gone), and another is `DELETE`d via its "Delete" button (absent
 *   afterward). Every assertion is made against what the UI shows after its
 *   own re-fetch, per UI Design Document §1's "always reflects the server's
 *   own current state" posture.
 *
 * - **TC-PLAN-005** — `ProjectDetail`'s Release→TestCycle expand-in-place view.
 *   Its fixture (Release + TestPlan + Environment + TestCycle + TestExecution
 *   + criteria rows) is seeded directly, since `TestCycle`/`TestExecution`
 *   have no create route at all and the TC is about the *read* view. The plan
 *   deliberately carries BOTH an `exit`-type row and a non-`exit` (`entry`)
 *   row, so the assertion that the non-`exit` row is **absent** — not merely
 *   unasserted — is the load-bearing one: ADR-0032's decision 2 says only
 *   `type = exit` surfaces here, and a fixture with only an exit row cannot
 *   distinguish "filtered correctly" from "nothing to filter". A second cycle,
 *   under a second plan holding an `entry` row and zero `exit` rows, covers
 *   UI Design Document §4's empty state (TC-PLAN-012's UI counterpart) — again
 *   engineered so "empty" proves the filter, not just an empty table.
 *
 * Complements (does not replace) the API-level integration coverage of the
 * same TCs — this file is the actual click-through a human (Priya, the test
 * manager persona) would do.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls, per
 * `e2e/CLAUDE.md`.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-plan2-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  suffix: string;
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  testLevelId: string;
  testTypeId: string;
  testCaseId: string;
  /** TC-PLAN-004's plan: starts with ZERO criteria rows, the UI creates all four. */
  planAId: string;
  planAIdentifier: string;
  /** TC-PLAN-005's plan: one `exit` row + one non-`exit` (`entry`) row. */
  planBId: string;
  /** TC-PLAN-012's plan: one `entry` row, ZERO `exit` rows. */
  planCId: string;
  exitCriteriaId: string;
  exitCriteriaText: string;
  nonExitCriteriaId: string;
  nonExitCriteriaText: string;
  planCEntryCriteriaId: string;
  planCEntryCriteriaText: string;
  releaseId: string;
  releaseVersionLabel: string;
  environmentId: string;
  cycleBId: string;
  cycleBName: string;
  cycleCId: string;
  cycleCName: string;
}

const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import TestCase, TestCaseStatus
from app.models.auth import AuthIdentity, AuthProvider
from app.models.execution import TestExecution, TestExecutionResult
from app.models.planning import (
    EntryExitCriteria,
    EntryExitCriteriaType,
    Environment,
    TestCycle,
    TestPlan,
    TestPlanStatus,
)
from app.models.project import Project, Release
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    # example.com deliberately: never a reserved special-use TLD, which
    # POST /auth/login's EmailStr would 422 (backend/CLAUDE.md).
    email = f"e2e-plan2-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        # User: constructed directly, never Actor()-then-User() — the joined-
        # table-inheritance mapper inserts the parent Actor row itself
        # (backend/CLAUDE.md).
        user = User(name="PLAN-2 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="PLAN-2 E2E Org", slug=f"plan2-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"PLAN-2 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        # TestLevel/TestType ship with ZERO seeded rows on a main-cloned DB
        # (root CLAUDE.md) — seed our own throwaway pair for the TestCase the
        # TestExecution needs.
        level = TestLevel(name=f"e2e-plan2-level-{suffix}")
        test_type = TestType(name=f"e2e-plan2-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        test_case = TestCase(
            test_condition_id=None,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=user.actor_id,
            title=f"PLAN-2 E2E case {suffix}",
            status=TestCaseStatus.draft,
        )
        session.add(test_case)

        plan_a_identifier = f"PLAN-2-E2E-A-{suffix}"
        plan_a = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=plan_a_identifier,
            scope="TC-PLAN-004: criteria CRUD driven entirely through the UI",
            status=TestPlanStatus.draft,
        )
        plan_b = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=f"PLAN-2-E2E-B-{suffix}",
            scope="TC-PLAN-005: one exit row AND one non-exit row",
            status=TestPlanStatus.approved,
        )
        plan_c = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=f"PLAN-2-E2E-C-{suffix}",
            scope="TC-PLAN-012: an entry row but ZERO exit rows",
            status=TestPlanStatus.approved,
        )
        session.add(plan_a)
        session.add(plan_b)
        session.add(plan_c)
        await session.flush()

        # plan_a deliberately gets NO criteria rows — TC-PLAN-004 creates all
        # four types through the "Add Criteria" modal itself.
        exit_text = f"plan2-exit-row-{suffix}"
        non_exit_text = f"plan2-nonexit-entry-row-{suffix}"
        plan_c_entry_text = f"plan2-planc-entry-row-{suffix}"
        exit_row = EntryExitCriteria(
            test_plan_id=plan_b.id, type=EntryExitCriteriaType.exit, condition_text=exit_text
        )
        non_exit_row = EntryExitCriteria(
            test_plan_id=plan_b.id, type=EntryExitCriteriaType.entry, condition_text=non_exit_text
        )
        plan_c_entry_row = EntryExitCriteria(
            test_plan_id=plan_c.id, type=EntryExitCriteriaType.entry, condition_text=plan_c_entry_text
        )
        session.add(exit_row)
        session.add(non_exit_row)
        session.add(plan_c_entry_row)

        version_label = f"PLAN-2-E2E-REL-{suffix}"
        release = Release(project_id=project.id, version_label=version_label, target_date=date(2026, 12, 1))
        environment = Environment(project_id=project.id, name=f"PLAN-2 E2E Env {suffix}")
        session.add(release)
        session.add(environment)
        await session.flush()

        cycle_b_name = f"PLAN-2 E2E Cycle B {suffix}"
        cycle_c_name = f"PLAN-2 E2E Cycle C {suffix}"
        cycle_b = TestCycle(
            test_plan_id=plan_b.id,
            release_id=release.id,
            environment_id=environment.id,
            name=cycle_b_name,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 30),
        )
        cycle_c = TestCycle(
            test_plan_id=plan_c.id,
            release_id=release.id,
            environment_id=environment.id,
            name=cycle_c_name,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 30),
        )
        session.add(cycle_b)
        session.add(cycle_c)
        await session.flush()

        # NOTE: the enum MEMBER is \`passed\`; its stored value is "pass"
        # (\`pass\` is a Python keyword) — app/models/execution.py.
        session.add(
            TestExecution(
                test_cycle_id=cycle_b.id,
                test_case_id=test_case.id,
                executed_by_actor_id=user.actor_id,
                result=TestExecutionResult.passed,
                executed_at=now,
            )
        )

        await session.commit()
        print(json.dumps({
            "suffix": suffix,
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
            "testCaseId": str(test_case.id),
            "planAId": str(plan_a.id),
            "planAIdentifier": plan_a_identifier,
            "planBId": str(plan_b.id),
            "planCId": str(plan_c.id),
            "exitCriteriaId": str(exit_row.id),
            "exitCriteriaText": exit_text,
            "nonExitCriteriaId": str(non_exit_row.id),
            "nonExitCriteriaText": non_exit_text,
            "planCEntryCriteriaId": str(plan_c_entry_row.id),
            "planCEntryCriteriaText": plan_c_entry_text,
            "releaseId": str(release.id),
            "releaseVersionLabel": version_label,
            "environmentId": str(environment.id),
            "cycleBId": str(cycle_b.id),
            "cycleBName": cycle_b_name,
            "cycleCId": str(cycle_c.id),
            "cycleCName": cycle_c_name,
        }))

asyncio.run(main())
`;

/**
 * FK-safe (child-first) teardown. Everything below `Project` is swept by
 * *derived* id (plans/cycles looked up from `project_id` at cleanup time),
 * never by ids the spec happened to capture: TC-PLAN-004 creates
 * `EntryExitCriteria` rows through the browser, and a run that fails midway
 * may leave rows the spec never recorded. Leaking those into the cloned DB
 * would poison later runs (and the "no orphan rows" check), so the sweep is
 * deliberately broader than the capture — safe because the whole Project is
 * created and destroyed by this spec alone.
 */
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.execution import TestExecution
from app.models.planning import EntryExitCriteria, Environment, TestCycle, TestPlan, TestPlanTestSuite
from app.models.project import Project, Release
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_id, test_level_id, test_type_id = sys.argv[1:6]
case_ids = json.loads(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else []

async def main():
    async with AsyncSessionLocal() as session:
        plan_ids = list(
            (await session.execute(select(TestPlan.id).where(TestPlan.project_id == project_id))).scalars()
        )
        cycle_ids = []
        if plan_ids:
            cycle_ids = list(
                (await session.execute(select(TestCycle.id).where(TestCycle.test_plan_id.in_(plan_ids)))).scalars()
            )
        if cycle_ids:
            await session.execute(delete(TestExecution).where(TestExecution.test_cycle_id.in_(cycle_ids)))
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(cycle_ids)))
        if plan_ids:
            # Sweeps BOTH the seeded rows and every row the browser created.
            await session.execute(delete(EntryExitCriteria).where(EntryExitCriteria.test_plan_id.in_(plan_ids)))
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.test_plan_id.in_(plan_ids)))
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(plan_ids)))
        await session.execute(delete(Release).where(Release.project_id == project_id))
        await session.execute(delete(Environment).where(Environment.project_id == project_id))
        if case_ids:
            await session.execute(delete(TestCase).where(TestCase.id.in_(case_ids)))
        await session.execute(delete(TestLevel).where(TestLevel.id == test_level_id))
        await session.execute(delete(TestType).where(TestType.id == test_type_id))
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
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      fixture.userId,
      fixture.orgId,
      fixture.projectId,
      fixture.testLevelId,
      fixture.testTypeId,
      JSON.stringify([fixture.testCaseId]),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

async function login(page: import("@playwright/test").Page, fixture: SeededFixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByLabel(/password/i).fill(fixture.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));
}

test.describe("PLAN-2: entry/exit criteria visibility", () => {
  test("TC-PLAN-004: add one criteria row per type through the UI, list, edit one, delete another", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture);

      await page.goto(`/projects/${fixture.projectId}/test-plans/${fixture.planAId}`);
      await expect(
        page.getByRole("heading", { name: new RegExp(fixture.planAIdentifier) }),
      ).toBeVisible();

      // --- Empty state, exact wording (UI Design Document §4) -------------
      await expect(page.getByText("No entry/exit criteria defined yet.")).toBeVisible();
      await expect(page.getByTestId("criteria-list")).toHaveCount(0);

      /**
       * One create per type, driven through the "Add Criteria" modal — the
       * literal "POST one criteria row per type" half of TC-PLAN-004. Returns
       * the new row's id, read off the real `POST /entry-exit-criteria`
       * response, so later assertions can target `criteria-<id>` testids.
       */
      const conditionText: Record<string, string> = {
        entry: `plan2-tc004-entry-original-${fixture.suffix}`,
        exit: `plan2-tc004-exit-${fixture.suffix}`,
        suspension: `plan2-tc004-suspension-${fixture.suffix}`,
        resumption: `plan2-tc004-resumption-${fixture.suffix}`,
      };

      async function addCriteria(type: string): Promise<string> {
        await page.getByTestId("add-criteria-btn").click();
        const modal = page.getByTestId("criteria-modal");
        await expect(modal).toBeVisible();
        await modal.getByLabel("Type", { exact: true }).selectOption(type);
        await modal.getByLabel("Condition", { exact: true }).fill(conditionText[type]);

        const [createResponse, listResponse] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url().includes("/api/v1/entry-exit-criteria") &&
              response.request().method() === "POST",
          ),
          // §1: every write re-fetches the list rather than splicing local
          // state — this is the TC's own "then GET
          // /entry-exit-criteria?test_plan_id= to confirm listed" step,
          // performed by the UI itself.
          page.waitForResponse(
            (response) =>
              response.url().includes(`/api/v1/entry-exit-criteria?`) &&
              response.url().includes(`test_plan_id=${fixture.planAId}`) &&
              response.request().method() === "GET",
          ),
          modal.getByRole("button", { name: /^create$/i }).click(),
        ]);
        expect(createResponse.status()).toBe(201);
        expect(listResponse.status()).toBe(200);

        const created = await createResponse.json();
        expect(created.type).toBe(type);
        expect(created.condition_text).toBe(conditionText[type]);
        expect(created.test_plan_id).toBe(fixture.planAId);

        // The modal closes and the re-fetched list renders the new row.
        await expect(page.getByTestId("criteria-modal")).toHaveCount(0);
        await expect(page.getByTestId(`criteria-${created.id}`)).toBeVisible();
        return created.id as string;
      }

      const entryId = await addCriteria("entry");
      const exitId = await addCriteria("exit");
      const suspensionId = await addCriteria("suspension");
      const resumptionId = await addCriteria("resumption");

      // --- All 4 types listed against the plan ---------------------------
      await expect(page.getByTestId("criteria-list").getByRole("listitem")).toHaveCount(4);
      for (const [type, id] of [
        ["entry", entryId],
        ["exit", exitId],
        ["suspension", suspensionId],
        ["resumption", resumptionId],
      ] as const) {
        const row = page.getByTestId(`criteria-${id}`);
        await expect(row).toBeVisible();
        // The row carries both its type badge and its condition text.
        await expect(row).toContainText(type);
        await expect(row).toContainText(conditionText[type]);
      }

      // The same claim straight off the wire, not just off the DOM: a fresh
      // `GET /entry-exit-criteria?test_plan_id=<planA>` carries all four types.
      const [reloadList] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`test_plan_id=${fixture.planAId}`) &&
            response.request().method() === "GET",
        ),
        page.reload(),
      ]);
      const listed = await reloadList.json();
      expect(listed.items.map((row: { type: string }) => row.type).sort()).toEqual([
        "entry",
        "exit",
        "resumption",
        "suspension",
      ]);

      // --- PATCH one row's condition_text via its "Edit" button ----------
      const editedText = `plan2-tc004-entry-EDITED-${fixture.suffix}`;
      await page.getByTestId(`edit-criteria-${entryId}`).click();
      const editModal = page.getByTestId("criteria-modal");
      await expect(editModal).toBeVisible();
      // Pre-filled from the row being edited.
      await expect(editModal.getByLabel("Condition", { exact: true })).toHaveValue(
        conditionText.entry,
      );
      await editModal.getByLabel("Condition", { exact: true }).fill(editedText);

      const [patchResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/entry-exit-criteria/${entryId}`) &&
            response.request().method() === "PATCH",
        ),
        page.waitForResponse(
          (response) =>
            response.url().includes(`test_plan_id=${fixture.planAId}`) &&
            response.request().method() === "GET",
        ),
        editModal.getByRole("button", { name: /^save$/i }).click(),
      ]);
      expect(patchResponse.status()).toBe(200);

      // The PATCH'd row reflects the edit on the UI's own next GET: NEW text
      // present, OLD text gone (the two strings share no substring, so the
      // negative assertion is real).
      await expect(page.getByTestId(`criteria-${entryId}`)).toContainText(editedText);
      await expect(page.getByText(conditionText.entry)).toHaveCount(0);
      await expect(page.getByTestId("criteria-list").getByRole("listitem")).toHaveCount(4);

      // --- DELETE another row via its "Delete" button --------------------
      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/entry-exit-criteria/${suspensionId}`) &&
            response.request().method() === "DELETE",
        ),
        page.waitForResponse(
          (response) =>
            response.url().includes(`test_plan_id=${fixture.planAId}`) &&
            response.request().method() === "GET",
        ),
        page.getByTestId(`delete-criteria-${suspensionId}`).click(),
      ]);
      expect(deleteResponse.status()).toBe(204);

      // The DELETE'd row is absent on the next GET; the other three survive.
      await expect(page.getByTestId(`criteria-${suspensionId}`)).toHaveCount(0);
      await expect(page.getByText(conditionText.suspension)).toHaveCount(0);
      await expect(page.getByTestId("criteria-list").getByRole("listitem")).toHaveCount(3);
      await expect(page.getByTestId(`criteria-${exitId}`)).toBeVisible();
      await expect(page.getByTestId(`criteria-${resumptionId}`)).toBeVisible();
      await expect(page.getByTestId(`criteria-${entryId}`)).toBeVisible();

      // No error alert ever surfaced across the whole CRUD walk (§1).
      await expect(page.getByTestId("criteria-error")).toHaveCount(0);
      await expect(page.getByTestId("criteria-load-error")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });

  test("TC-PLAN-005 (+TC-PLAN-012): expanded Release row shows a cycle's executions AND only its plan's exit criteria", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture);

      // --- Both criteria rows exist on the plan's own screen -------------
      // Precondition for the negative assertion below: the non-`exit` row is
      // real and visible SOMEWHERE, so its absence on the cycle view is proof
      // of ADR-0032's `type = exit` filter, not proof of a missing fixture.
      await page.goto(`/projects/${fixture.projectId}/test-plans/${fixture.planBId}`);
      await expect(page.getByTestId(`criteria-${fixture.exitCriteriaId}`)).toContainText(
        fixture.exitCriteriaText,
      );
      await expect(page.getByTestId(`criteria-${fixture.nonExitCriteriaId}`)).toContainText(
        fixture.nonExitCriteriaText,
      );

      // --- ProjectDetail: expand the Release row in place ----------------
      await page.goto(`/projects/${fixture.projectId}`);
      const releaseCell = page.getByRole("cell", { name: fixture.releaseVersionLabel });
      await expect(releaseCell).toBeVisible();

      const [cyclesResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/releases/${fixture.releaseId}/test-cycles`) &&
            response.request().method() === "GET",
        ),
        releaseCell.click(),
      ]);
      expect(cyclesResponse.status()).toBe(200);

      // --- Cycle B: executions AND exit criteria, in ONE view ------------
      const cycleBItem = page
        .getByTestId(`cycle-exit-criteria-label-${fixture.cycleBId}`)
        .locator("xpath=..");
      await expect(cycleBItem).toContainText(fixture.cycleBName);
      await expect(page.getByTestId(`cycle-exit-criteria-label-${fixture.cycleBId}`)).toHaveText(
        "Exit criteria:",
      );

      // The `exit`-type row is listed...
      await expect(page.getByTestId(`cycle-exit-criteria-${fixture.cycleBId}`)).toBeVisible();
      await expect(
        page.getByTestId(`cycle-exit-criterion-${fixture.exitCriteriaId}`),
      ).toHaveText(fixture.exitCriteriaText);
      await expect(
        page.getByTestId(`cycle-exit-criteria-${fixture.cycleBId}`).getByRole("listitem"),
      ).toHaveCount(1);

      // ...and the non-`exit` row is ABSENT — the load-bearing negative
      // assertion (ADR-0032 decision 2). Checked two independent ways: no
      // testid for that row anywhere in the DOM, and its condition text does
      // not appear anywhere on this screen.
      await expect(
        page.getByTestId(`cycle-exit-criterion-${fixture.nonExitCriteriaId}`),
      ).toHaveCount(0);
      await expect(page.getByText(fixture.nonExitCriteriaText)).toHaveCount(0);
      await expect(cycleBItem).not.toContainText(fixture.nonExitCriteriaText);

      // The execution is visible in the SAME expanded cell — AC2's "one view"
      // claim: exit criteria next to execution progress, no second lookup.
      // The stored enum value is "pass" (member name `passed`).
      const cycleBExecutions = cycleBItem.locator("ul:not([data-testid])");
      await expect(cycleBExecutions.getByRole("listitem")).toHaveCount(1);
      await expect(cycleBExecutions).toContainText("pass");
      await expect(cycleBItem).not.toContainText("No executions yet.");

      // --- Cycle C: a plan with an `entry` row but ZERO `exit` rows ------
      // (TC-PLAN-012's UI counterpart, UI Design Document §4.) Again the
      // empty state proves the filter, not an empty table: plan C DOES have a
      // criteria row, it's just not an `exit` one.
      const cycleCItem = page
        .getByTestId(`cycle-exit-criteria-label-${fixture.cycleCId}`)
        .locator("xpath=..");
      await expect(cycleCItem).toContainText(fixture.cycleCName);
      await expect(page.getByTestId(`cycle-exit-criteria-empty-${fixture.cycleCId}`)).toHaveText(
        "No exit criteria defined.",
      );
      await expect(page.getByTestId(`cycle-exit-criteria-${fixture.cycleCId}`)).toHaveCount(0);
      await expect(page.getByText(fixture.planCEntryCriteriaText)).toHaveCount(0);
      // Distinct copy from the executions list's own empty state (§4) — both
      // appear in this same cell and must not be identical strings.
      await expect(cycleCItem).toContainText("No executions yet.");
    } finally {
      cleanup(fixture);
    }
  });
});
