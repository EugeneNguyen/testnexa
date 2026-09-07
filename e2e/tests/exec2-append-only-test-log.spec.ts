import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * EXEC-2 E2E (ADR-0036, UI Design Document
 * `docs/ui-design/2026-09-07-exec-2-append-only-test-log-ui-design.md`).
 *
 * The one thing no lower test layer can prove: that the append-then-**refetch**
 * loop works through a real browser. Backend unit/integration tests prove the
 * routes append and return ordered rows; a Vitest test proves the component
 * renders mocked rows. Neither can prove that clicking "History" on a real
 * execution row fetches that row's own log, that submitting the comment form
 * re-reads the server rather than splicing locally, or that closing and
 * reopening the modal starts from a fresh fetch instead of stale state.
 *
 * The flow, one test because every claim is sequential and shares one fixture:
 *
 * 1. Log in through the real login form (never a locally minted JWT — same
 *    posture `exec1-record-execution.spec.ts` takes).
 * 2. Reach `TestCycleDetail` by clicking `TestPlanDetail`'s cycle link.
 * 3. Record a result through the "Record Result" modal. This is EXEC-2's
 *    *create-time* log hook (ADR-0036 Q2, `from=None`) exercised through the
 *    UI — the recording form itself has no idea a `TestLog` row is being
 *    written, which is exactly the point.
 * 4. Click "History" on that execution's row -> the timeline modal opens and
 *    shows the initial `status_change` entry ("Result changed: (none) -> pass").
 * 5. Add a plain comment through the modal's form -> the timeline **re-fetches**
 *    and now shows two entries.
 * 6. **Close the modal, reopen it** -> the comment is still there. This is the
 *    load-bearing step: `closeHistoryModal` clears `logs` to `[]`, so anything
 *    rendered after reopening came from a genuinely new
 *    `GET /executions/{id}/logs`, not from state that survived the close. A
 *    local-splice implementation passes step 5 and fails here.
 * 7. Add an *attachment* entry (comment text + `attachment_url` + `file_name`)
 *    -> a third entry, and its badge reads `attachment`, not `comment`. The
 *    form has no attachment toggle; the presence of a value in those two
 *    optional fields is the whole signal (ADR-0036 Q4), so this asserts a
 *    server-side classification the client never states.
 * 8. Oldest-first ordering (AC3) asserted two ways: the rendered badges read
 *    `status_change` -> `comment` -> `attachment`, and the DOM's own entry ids,
 *    read in render order, equal the database's rows ordered by
 *    `logged_at ASC` — three badges in the right order could be a coincidence
 *    of insertion order, matching ids against a `logged_at`-sorted query cannot.
 *
 * --- A real product gap this spec deliberately does NOT paper over -----------
 *
 * **Result correction is not reachable through the UI at all.** ADR-0036's
 * `post_update_hook` logs a `status_change` on `PATCH /test-executions/{id}`
 * whenever `result` actually changes — but no screen in this app ever issues
 * that `PATCH`. `TestCycleDetail`'s own docstring lists "no edit/delete of a
 * recorded execution" as an explicit EXEC-1 non-goal, `lib/api/testExecutions.ts`
 * exports no update function, and "Record Result" always *creates* a new
 * `TestExecution` (that is TC-EXEC-003's whole subject). So the correction
 * branch of AC1 is backend-only today, covered by the integration suite and
 * unreachable from any browser. This spec therefore exercises the two triggers
 * that *are* UI-reachable (create-time status change, comment/attachment)
 * rather than minting a `PATCH` from the test and calling that "the UI flow" —
 * flagged here rather than silently worked around.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/verify/cleanup `docker exec` calls. Both must
 * be set together; the default below is this story's own stack and will not
 * exist in a later session (`e2e/CLAUDE.md`'s container-name gotcha).
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-exec2-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface ExecFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  releaseId: string;
  testPlanId: string;
  testPlanIdentifier: string;
  environmentId: string;
  testCycleId: string;
  testCycleName: string;
  includedSuiteId: string;
  testCaseId: string;
  testCaseTitle: string;
  testLevelId: string;
  testTypeId: string;
}

/**
 * org_admin + Organization + active OrgMembership + org-wide `org_admin`
 * RoleAssignment, one Project/Release/Environment/TestPlan, one TestSuite
 * *included* in the plan, one TestCase inside that suite, and one TestCycle.
 * Deliberately **zero** `TestExecution` rows — every execution (and therefore
 * every `TestLog` row) in this spec must be one the UI itself caused.
 *
 * Identical in shape to `exec1-record-execution.spec.ts`'s seed, and for the
 * same reasons: the included-suite membership is load-bearing (without it the
 * `TestCase` is out of scope and ADR-0033's `422` scope check rejects the
 * recording, so the picker offers nothing), `User(...)` is constructed
 * *directly* rather than `Actor()`-then-`User(actor_id=...)`
 * (`backend/CLAUDE.md`'s joined-table-inheritance trap), and the email uses a
 * real-shaped `@example.com` domain because `POST /auth/login`'s `EmailStr`
 * rejects the IANA reserved TLDs with a `422` that reads like a wrong password.
 */
const SEED_SCRIPT = `
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
    email = f"e2e-exec2-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="EXEC-2 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="EXEC-2 E2E Org", slug=f"exec2-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"EXEC-2 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        release = Release(project_id=project.id, version_label=f"exec2-rel-{suffix}", target_date=date(2026, 10, 1))
        session.add(release)

        environment = Environment(project_id=project.id, name=f"exec2-env-{suffix}")
        session.add(environment)
        await session.flush()

        plan_identifier = f"EXEC-2 E2E Plan {suffix}"
        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=plan_identifier,
            scope="Seeded for the EXEC-2 append-only TestLog E2E spec",
            status=TestPlanStatus.draft,
        )
        session.add(plan)
        await session.flush()

        cycle_name = f"EXEC-2 E2E Cycle {suffix}"
        cycle = TestCycle(
            test_plan_id=plan.id,
            release_id=release.id,
            environment_id=environment.id,
            name=cycle_name,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 8),
        )
        session.add(cycle)

        suite = TestSuite(project_id=project.id, name=f"exec2-suite-{suffix}")
        session.add(suite)
        await session.flush()

        # Load-bearing: this is what puts the TestCase in scope for the plan.
        session.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite.id))

        level = TestLevel(name=f"e2e-exec2-level-{suffix}")
        test_type = TestType(name=f"e2e-exec2-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        title = f"EXEC-2 logged test case {suffix}"
        case = TestCase(
            test_condition_id=None,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=user.actor_id,
            title=title,
            status=TestCaseStatus.draft,
        )
        session.add(case)
        await session.flush()
        session.add(TestSuiteTestCase(test_suite_id=suite.id, test_case_id=case.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "releaseId": str(release.id),
            "testPlanId": str(plan.id),
            "testPlanIdentifier": plan_identifier,
            "environmentId": str(environment.id),
            "testCycleId": str(cycle.id),
            "testCycleName": cycle_name,
            "includedSuiteId": str(suite.id),
            "testCaseId": str(case.id),
            "testCaseTitle": title,
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

/**
 * The database's own answer to "what is this execution's log, oldest first" —
 * the exact ordering `GET /executions/{id}/logs` promises (`logged_at ASC,
 * id ASC`), queried independently of that route so the rendered order can be
 * checked against storage rather than against the same route that produced it.
 */
const VERIFY_LOGS_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.execution import TestLog

execution_id = sys.argv[1]

async def main():
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(TestLog)
                .where(TestLog.test_execution_id == execution_id)
                .order_by(TestLog.logged_at, TestLog.id)
            )
        ).scalars().all()
        print(json.dumps({
            "count": len(rows),
            "ids": [str(row.id) for row in rows],
            "eventTypes": [
                row.event_type.value if hasattr(row.event_type, "value") else row.event_type
                for row in rows
            ],
            "payloads": [row.payload for row in rows],
            "loggedAt": [row.logged_at.isoformat() for row in rows],
        }))

asyncio.run(main())
`;

/**
 * FK-safe, child-first cleanup taking `(user_id, org_id, project_id,
 * test_level_ids, test_type_ids)` as `sys.argv`.
 *
 * One deliberate difference from `exec1-record-execution.spec.ts`'s otherwise
 * identical script: **`TestLog` rows are deleted before their `TestExecution`
 * parents.** `TestLog.test_execution_id` is `ON DELETE RESTRICT` (Database
 * Document §3.8), and after EXEC-2 every execution created through the app has
 * at least one log row — so the EXEC-1-era delete order now raises a
 * `ForeignKeyViolationError` on the `TestExecution` delete. That is the
 * intended structural consequence of an append-only audit trail (ADR-0036's
 * own "a TestExecution with any log entry can no longer be deleted" section),
 * not a bug to route around; a cleanup script simply has to respect it.
 */
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.execution import TestExecution, TestLog
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

user_id, org_id, project_id = sys.argv[1], sys.argv[2], sys.argv[3]
test_level_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []
test_type_ids = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else []

async def main():
    async with AsyncSessionLocal() as session:
        plan_ids = (await session.execute(select(TestPlan.id).where(TestPlan.project_id == project_id))).scalars().all()
        suite_ids = (await session.execute(select(TestSuite.id).where(TestSuite.project_id == project_id))).scalars().all()
        cycle_ids = []
        if plan_ids:
            cycle_ids = (
                await session.execute(select(TestCycle.id).where(TestCycle.test_plan_id.in_(plan_ids)))
            ).scalars().all()

        if cycle_ids:
            execution_ids = (
                await session.execute(
                    select(TestExecution.id).where(TestExecution.test_cycle_id.in_(cycle_ids))
                )
            ).scalars().all()
            # TestLog before TestExecution: ON DELETE RESTRICT (ADR-0036).
            if execution_ids:
                await session.execute(delete(TestLog).where(TestLog.test_execution_id.in_(execution_ids)))
            await session.execute(delete(TestExecution).where(TestExecution.test_cycle_id.in_(cycle_ids)))
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(cycle_ids)))

        if suite_ids:
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id.in_(suite_ids)))
        if plan_ids:
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.test_plan_id.in_(plan_ids)))
            await session.execute(delete(EntryExitCriteria).where(EntryExitCriteria.test_plan_id.in_(plan_ids)))

        await session.execute(delete(TestCase).where(TestCase.created_by_actor_id == user_id))
        if suite_ids:
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
        if plan_ids:
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(plan_ids)))

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

interface StoredLogs {
  count: number;
  ids: string[];
  eventTypes: string[];
  payloads: Record<string, unknown>[];
  loggedAt: string[];
}

test.describe("EXEC-2: append-only TestLog timeline on TestCycleDetail", () => {
  test("logs the initial result, appends comment/attachment entries, and re-reads the server on reopen", async ({
    page,
  }) => {
    const fixture = runBackendPython<ExecFixture>(SEED_SCRIPT);
    try {
      // --- Log in through the real login form ---------------------------------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // --- Reach the cycle by clicking the link, not by goto -------------------
      await page.goto(`/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}`);
      await expect(page.getByRole("heading", { name: /^test cycles$/i })).toBeVisible();
      const cycleLink = page.getByTestId(`open-test-cycle-${fixture.testCycleId}`);
      await expect(cycleLink).toHaveText(fixture.testCycleName);
      await cycleLink.click();
      await page.waitForURL(
        new RegExp(
          `/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}/test-cycles/${fixture.testCycleId}`,
        ),
      );
      await expect(page.getByTestId("test-cycle-name")).toHaveText(fixture.testCycleName);
      await expect(page.getByTestId("test-cycle-load-error")).toHaveCount(0);

      // --- Record a result: EXEC-2's create-time log hook, via the UI ----------
      // The recording form knows nothing about `TestLog`; the row is a server-side
      // side effect of `POST /test-cycles/{id}/executions` (ADR-0036 Q2).
      await page.getByTestId("record-result-btn").click();
      await expect(page.getByTestId("record-result-modal")).toBeVisible();

      const pickerWrapper = page.getByTestId("record-result-test-case");
      const pickerInput = pickerWrapper.locator("#recordTestCaseId");
      await expect(pickerInput).toBeEnabled();
      await pickerInput.fill(fixture.testCaseTitle.slice(0, 12));
      const caseOption = pickerWrapper.getByRole("button", {
        name: fixture.testCaseTitle,
        exact: true,
      });
      await expect(caseOption).toBeVisible();
      await caseOption.click();
      await expect(pickerInput).toHaveValue(fixture.testCaseTitle);

      await page.getByTestId("record-result-select").selectOption("pass");
      await page.getByTestId("record-actual-result").fill("Behaved as expected.");
      await page.getByTestId("record-executed-at").fill("2026-09-07T09:00");
      await page.getByTestId("record-result-submit").click();
      await expect(page.getByTestId("record-result-modal")).toBeHidden();

      const historyItems = page.getByTestId("execution-history-list").getByRole("listitem");
      await expect(historyItems).toHaveCount(1);

      // The execution's own id, read off the rendered row rather than queried —
      // the "History" button's test id is derived from it, and so is every
      // assertion below, so this ties the whole spec to the row the UI created.
      const rowTestId = await historyItems.first().getAttribute("data-testid");
      expect(rowTestId).toMatch(/^execution-[0-9a-f-]{36}$/);
      const executionId = rowTestId!.replace(/^execution-/, "");

      // --- Open the History modal: the initial `status_change` entry -----------
      await page.getByTestId(`execution-${executionId}-view-history`).click();
      const historyModal = page.getByTestId("execution-history-modal");
      await expect(historyModal).toBeVisible();
      await expect(page.getByTestId("execution-log-load-error")).toHaveCount(0);

      const timelineEntries = page.getByTestId("execution-log-timeline").getByRole("listitem");
      await expect(timelineEntries).toHaveCount(1);
      // AC1's first trigger, via the create route's `from=None` payload —
      // `logSummaryLine` renders that as "(none)".
      await expect(timelineEntries.nth(0)).toContainText("status_change");
      await expect(timelineEntries.nth(0)).toContainText("Result changed: (none) → pass");

      // --- Append a plain comment: the timeline re-fetches ---------------------
      const commentText = "Retested on staging, still green.";
      await page.getByTestId("add-comment-text").fill(commentText);
      await page.getByTestId("add-comment-submit").click();

      await expect(timelineEntries).toHaveCount(2);
      await expect(timelineEntries.nth(1)).toContainText("comment");
      await expect(timelineEntries.nth(1)).toContainText(commentText);
      // The modal stays open and the form clears on success (UI Design §3).
      await expect(historyModal).toBeVisible();
      await expect(page.getByTestId("add-comment-text")).toHaveValue("");
      await expect(page.getByTestId("add-comment-error")).toHaveCount(0);

      // --- Close, reopen: the comment came back from the SERVER ----------------
      // `closeHistoryModal` sets `logs` to `[]`, so anything rendered after this
      // reopen is a genuinely fresh `GET /executions/{id}/logs`. A local-splice
      // implementation passes the assertion above and fails this one.
      await page.getByTestId("execution-history-close").click();
      await expect(historyModal).toBeHidden();

      await page.getByTestId(`execution-${executionId}-view-history`).click();
      await expect(historyModal).toBeVisible();
      await expect(timelineEntries).toHaveCount(2);
      await expect(timelineEntries.nth(0)).toContainText("status_change");
      await expect(timelineEntries.nth(1)).toContainText(commentText);

      // --- Append an attachment entry -----------------------------------------
      // No client-side toggle exists: supplying `attachment_url`/`file_name` is
      // itself what makes the server log this as `attachment` (ADR-0036 Q4), so
      // the badge below asserts a classification the client never sends.
      const attachmentText = "Screenshot of the failing step.";
      await page.getByTestId("add-comment-text").fill(attachmentText);
      await page.getByTestId("add-comment-attachment-url").fill("https://example.com/evidence.png");
      await page.getByTestId("add-comment-file-name").fill("evidence.png");
      await page.getByTestId("add-comment-submit").click();

      await expect(timelineEntries).toHaveCount(3);
      await expect(timelineEntries.nth(2)).toContainText("attachment");
      await expect(timelineEntries.nth(2)).toContainText(`${attachmentText} (evidence.png)`);

      // --- Oldest-first ordering (AC3), asserted against storage ---------------
      await expect(timelineEntries.nth(0)).toContainText("status_change");
      await expect(timelineEntries.nth(1)).toContainText("comment");
      await expect(timelineEntries.nth(2)).toContainText("attachment");

      const renderedIds = await timelineEntries.evaluateAll((nodes) =>
        nodes.map((node) =>
          (node.getAttribute("data-testid") ?? "").replace(/^execution-log-entry-/, ""),
        ),
      );

      const stored = runBackendPython<StoredLogs>(VERIFY_LOGS_SCRIPT, [executionId]);
      expect(stored.count).toBe(3);
      expect(stored.eventTypes).toEqual(["status_change", "comment", "attachment"]);
      // Rendered order === `logged_at ASC` order, id for id. Three badges in the
      // right order could be an artifact of insertion order; this cannot.
      expect(renderedIds).toEqual(stored.ids);
      const loggedAtMillis = stored.loggedAt.map((value) => new Date(value).getTime());
      expect(loggedAtMillis[0]).toBeLessThanOrEqual(loggedAtMillis[1]);
      expect(loggedAtMillis[1]).toBeLessThanOrEqual(loggedAtMillis[2]);

      // The payloads the badges were derived from, spot-checked at the source.
      expect(stored.payloads[0]).toMatchObject({
        kind: "status_change",
        from: null,
        to: "pass",
        actor_id: fixture.userId,
        actor_type: "user",
      });
      expect(stored.payloads[1]).toMatchObject({
        kind: "comment",
        text: commentText,
        attachment_url: null,
        file_name: null,
      });
      expect(stored.payloads[2]).toMatchObject({
        kind: "attachment",
        text: attachmentText,
        attachment_url: "https://example.com/evidence.png",
        file_name: "evidence.png",
      });
    } finally {
      cleanup(fixture, [fixture.testLevelId], [fixture.testTypeId]);
    }
  });
});
