import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADR-0071 E2E: relationship tabs on the generic entity detail page — real
 * browser, full stack, real `relations` derived by the real backend from the
 * real `ALL_ENTITY_CONFIGS`.
 *
 * **Why this file exists at all, given the backend unit suite is the heavier
 * half.** `test_adr71_entity_relations.py` proves the derived relationship set
 * is complete and that every served relation *is* listable in principle. It
 * cannot prove the tab actually fetches and renders anything: the frontend's
 * own unit tests run against fixture `relations` and hand-written mocks, so
 * they equally cannot. The specific thing only a live stack can answer is
 * whether the tab's real request — `GET /{entity}?{scopeField}=<id>` against a
 * real gated route with real RBAC and real tenant scoping — returns the rows
 * and renders them. That is this file's whole job.
 *
 * **Entity choice is not arbitrary.** ADR-0071's own Decision §5 turns on
 * `Requirement` being reachable to `TestCase` one way and `TestCondition` two
 * ways, so `requirements` is the only entity that exercises every branch at
 * once — a 1-n child tab, an n-n link tab, and the `" (linked)"` label
 * disambiguation between two tabs with the same target. `test-cases` is the
 * second entity carrying both kinds, and its own derived tab set is asserted
 * too, so the feature is proven against two independent entities rather than
 * one.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container. Seed/cleanup follows `admin6-entity-detail-page.spec.ts`
 * verbatim, including the FK-safe child-first delete order and the
 * `refresh_token` row the login itself mints.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-deve77ffc-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  orgId: string;
  projectId: string;
  requirementId: string;
  requirementTitle: string;
  /** Child of the Requirement via `TestCondition.requirement_id` — the 1-n tab. */
  testConditionId: string;
  testConditionDescription: string;
  /** Linked to the Requirement via `RequirementTestCaseLink` — the n-n tab. */
  testCaseId: string;
  testCaseTitle: string;
  /** Child of the TestCase via `TestStep.test_case_id` — a 1-n tab on a second entity. */
  testStepId: string;
  testStepAction: string;
  /** `TestCase` requires both catalogs; seeded and cleaned up with the rest. */
  testLevelId: string;
  testTypeId: string;
}

/**
 * One Organization/Project + an org_admin, a Requirement carrying **both**
 * relationship kinds (a `TestCondition` child, and a `TestCase` reached through
 * `RequirementTestCaseLink`), and a `TestStep` child of that TestCase so a
 * second entity's 1-n tab has a real row too.
 *
 * The many-to-many row-click case deliberately uses the Requirement -> TestCase
 * link rather than the TestCase -> Defect one: both exercise the identical
 * `targetField` code path, and this one needs no `TestPlan` -> `TestCycle` ->
 * `TestExecution` -> `Defect` chain (every link of which carries its own
 * required FKs) to stand up. `test-cases`' own "Defects (linked)" tab is still
 * asserted to *exist* — tabs are derived from the schema, so that assertion
 * needs no Defect row behind it.
 *
 * `TestCase.test_level_id`/`test_type_id` are NOT NULL, so a TestLevel and a
 * TestType are seeded alongside (checked against the real model columns, not
 * assumed).
 */
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import Requirement, TestCase, TestCondition, TestConditionPriority, TestStep
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestCaseLink

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    async with AsyncSessionLocal() as session:
        email = f"e2e-admin7-org-admin-{suffix}@example.com"
        org_admin = User(name="ADMIN-7 E2E org admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(org_admin)
        await session.flush()
        session.add(AuthIdentity(user_id=org_admin.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADMIN-7 E2E Org", slug=f"admin7-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=org_admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=org_admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"ADMIN-7 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        level = TestLevel(name=f"ADMIN-7 Level {suffix}")
        test_type = TestType(name=f"ADMIN-7 Type {suffix}")
        session.add_all([level, test_type])
        await session.flush()

        requirement_title = f"ADMIN-7 Requirement {suffix}"
        requirement = Requirement(
            project_id=project.id,
            title=requirement_title,
            description=f"ADMIN-7 requirement description {suffix}",
            external_ref=f"ADMIN7-{suffix}",
        )
        session.add(requirement)
        await session.flush()

        # 1-n child of the Requirement.
        condition_description = f"ADMIN-7 Condition {suffix}"
        condition = TestCondition(
            requirement_id=requirement.id,
            description=condition_description,
            priority=TestConditionPriority.medium,
        )
        session.add(condition)
        await session.flush()

        # n-n partner of the Requirement, and itself a 1-n parent of TestStep.
        test_case_title = f"ADMIN-7 TestCase {suffix}"
        test_case = TestCase(
            project_id=project.id,
            title=test_case_title,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=org_admin.actor_id,
        )
        session.add(test_case)
        await session.flush()
        session.add(RequirementTestCaseLink(requirement_id=requirement.id, test_case_id=test_case.id))

        # 1-n child of the TestCase.
        step_action = f"ADMIN-7 Step action {suffix}"
        step = TestStep(test_case_id=test_case.id, sequence=1, action=step_action, expected_result="ok")
        session.add(step)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": email, "password": PASSWORD, "userId": str(org_admin.actor_id)},
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
            "requirementTitle": requirement_title,
            "testConditionId": str(condition.id),
            "testConditionDescription": condition_description,
            "testCaseId": str(test_case.id),
            "testCaseTitle": test_case_title,
            "testStepId": str(step.id),
            "testStepAction": step_action,
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

/** FK-safe delete order (child-first), link tables before the rows they link. */
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase, TestCondition, TestStep
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestCaseLink

(org_admin_id, org_id, project_id, requirement_id, condition_id, test_case_id,
 step_id, level_id, type_id) = sys.argv[1:10]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RequirementTestCaseLink).where(RequirementTestCaseLink.requirement_id == requirement_id))
        await session.execute(delete(TestStep).where(TestStep.id == step_id))
        await session.execute(delete(TestCase).where(TestCase.id == test_case_id))
        await session.execute(delete(TestCondition).where(TestCondition.id == condition_id))
        await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
        await session.execute(delete(TestLevel).where(TestLevel.id == level_id))
        await session.execute(delete(TestType).where(TestType.id == type_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == org_admin_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == org_admin_id))
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == org_admin_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == org_admin_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == org_admin_id))
        await session.execute(delete(Actor).where(Actor.id == org_admin_id))
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
      fixture.testConditionId,
      fixture.testCaseId,
      fixture.testStepId,
      fixture.testLevelId,
      fixture.testTypeId,
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

/** Open a detail page and wait for its own record fetch before asserting. */
async function gotoDetail(
  page: import("@playwright/test").Page,
  url: string,
  resourcePath: string,
) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(`/api/v1/${resourcePath}/`) && res.request().method() === "GET",
    ),
    page.goto(url),
  ]);
  expect(response.ok()).toBeTruthy();
}

test.describe("ADR-0071: entity detail relationship tabs", () => {
  // Same reasoning as `admin6-entity-detail-page.spec.ts`: each test drives
  // several full page loads against the dev-profile Vite server, and running
  // them concurrently starves it. Scoped to this file only.
  test.describe.configure({ mode: "serial" });

  /**
   * TC-ADMIN-050 / TC-ADMIN-051 / TC-ADMIN-057, against the real derivation.
   *
   * `requirements` is the entity where every branch coincides: an Info tab, two
   * 1-n child tabs, two n-n link tabs, and — the case ADR-0071 Decision §5
   * exists for — two of those tabs targeting `test-conditions`, distinguished
   * only by the `" (linked)"` suffix. A backend unit test asserts the derived
   * labels; this asserts the browser actually renders them as distinct,
   * selectable tabs.
   */
  test("TC-ADMIN-050/051/057: a Requirement's detail page shows Info plus its real 1-n and n-n tabs, with linked tabs disambiguated", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}`,
        "requirements",
      );

      // Info is first and selected on arrival, with ADR-0070's field list under it.
      const tabs = page.getByRole("tab");
      await expect(tabs.first()).toHaveText("Info");
      await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("entity-detail-fields")).toBeVisible();

      // The real derived tab set for `requirements`, in the derivation's own
      // deterministic order (children first, then links, each alphabetical).
      await expect(tabs).toHaveText([
        "Info",
        "Risk items",
        "Test conditions",
        "Test cases (linked)",
        "Test conditions (linked)",
      ]);

      // TC-ADMIN-051's exclusion half: `Requirement.project_id` is a
      // many-to-one pointing at its parent Project. It renders as a field...
      await expect(page.getByTestId("entity-detail-field-project_id")).toBeVisible();
      // ...and must not have become a tab.
      await expect(page.getByTestId("entity-detail-tab-projects")).toHaveCount(0);

      /**
       * ADR-0071's Amendment — Tabler's documented "tabs in the card header"
       * markup, asserted in a real browser because this is the half the unit
       * tests structurally cannot answer: jsdom applies no CSS, so only a real
       * engine can confirm the classes actually *resolve* (`.tab-content >
       * .tab-pane` is `display:none` without `.active`, and a strip whose
       * `card-header-tabs` were dropped would still pass every DOM assertion
       * while rendering as a detached row of tabs above the card).
       */
      const detailPage = page.getByTestId("entity-detail-page");
      const tablist = page.getByTestId("entity-detail-tablist");
      await expect(tablist).toHaveClass(/\bcard-header-tabs\b/);
      // The strip is inside the card's own header...
      await expect(detailPage.locator(".card > .card-header > .nav-tabs.card-header-tabs")).toHaveCount(1);
      // ...and the panel is an active pane in that same card's body.
      const panel = page.getByRole("tabpanel");
      await expect(panel).toHaveClass(/\btab-pane\b.*\bactive\b/);
      await expect(detailPage.locator(".card > .card-body.tab-content > .tab-pane.active")).toHaveCount(1);
      // Really painted, not merely present — the `display:none` trap above.
      await expect(panel).toBeVisible();
      // The nav sits above the panel, and both are in the one card.
      const navBox = (await tablist.boundingBox())!;
      const panelBox = (await panel.boundingBox())!;
      expect(navBox.y + navBox.height).toBeLessThanOrEqual(panelBox.y + 1);

      // The heading and Back action live above the card (Tabler's
      // `.card-header-tabs` is `flex:1` with negative margins on all four
      // sides, so it consumes the header) — and stay put on every tab.
      await expect(detailPage.locator(".card").getByTestId("entity-detail-back")).toHaveCount(0);
      await expect(page.getByTestId("entity-detail-back")).toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-052 / TC-ADMIN-054: opening a 1-n tab really fetches and renders
   * the child rows scoped to this record, the scoping column is suppressed, and
   * the tab is reflected in the URL.
   *
   * The scoped-request assertion is made on the **real network request**, not
   * inferred from the rendered rows — a tab rendering the right rows by
   * coincidence (an unscoped list that happens to contain them) would look
   * identical on screen.
   */
  test("TC-ADMIN-052/054: a one-to-many tab lists the real child rows scoped to this record and appears in the URL", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}`,
        "requirements",
      );

      const [listResponse] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/test-conditions?") && res.request().method() === "GET",
        ),
        page.getByTestId("entity-detail-tab-test-conditions").click(),
      ]);

      expect(listResponse.ok()).toBeTruthy();
      // Scoped to this Requirement, via the relation's own scopeField.
      expect(new URL(listResponse.url()).searchParams.get("requirement_id")).toBe(fixture.requirementId);

      // The real child row renders.
      await expect(page.getByText(fixture.testConditionDescription)).toBeVisible({ timeout: 15000 });

      // The scoping column is suppressed — same value on every row here.
      const headers = await page.getByRole("columnheader").allTextContents();
      expect(headers).toContain("Description");
      expect(headers).not.toContain("Requirement");

      /**
       * ADR-0071's Amendment: the related table renders inside the page's one
       * card (`EntityTable` in `bare` mode), not as a second card nested in
       * that card's body — the visible defect the relocation would otherwise
       * introduce, and one no unit test can see, since a nested `.card`'s
       * border and shadow are purely CSS.
       */
      const detailPage = page.getByTestId("entity-detail-page");
      await expect(detailPage.locator(".card")).toHaveCount(1);
      await expect(detailPage.locator(".card-header")).toHaveCount(1);
      await expect(page.getByRole("tabpanel").getByRole("table")).toHaveCount(1);
      // Back survives the tab switch — under the pre-Amendment markup the
      // whole header lived in the Info panel and vanished with it.
      await expect(page.getByTestId("entity-detail-back")).toBeVisible();
      await expect(detailPage.getByRole("heading", { name: /details$/i })).toBeVisible();

      // TC-ADMIN-054: the active tab is in the URL, so this view is shareable.
      await expect(page).toHaveURL(/\?tab=test-conditions/);
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-053: the many-to-many case, and the one that cannot be inferred
   * from the one-to-many case — the rows listed are
   * `requirement-test-case-links`, but a row click must follow `targetField`
   * to the **TestCase**, not open the link row. Asserted as an exact URL, plus
   * an explicit check that the listed row's id is NOT the TestCase's, so
   * "navigated somewhere" cannot pass and neither can a coincidence.
   */
  test("TC-ADMIN-053: a many-to-many tab lists link rows but a row click opens the far entity's detail page", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      // First, the tab set of the *other* both-kinds entity. Tabs are derived
      // from the schema, not from data, so this needs no Defect row behind it.
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}`,
        "test-cases",
      );
      await expect(page.getByRole("tab")).toHaveText([
        "Info",
        "Attachments",
        "Test steps",
        "Defects (linked)",
      ]);

      // Now the row-click case, on the Requirement -> TestCase link (same
      // `targetField` code path, no TestExecution/Defect chain to seed).
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}`,
        "requirements",
      );

      const [listResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/v1/requirement-test-case-links?") &&
            res.request().method() === "GET",
        ),
        page.getByTestId("entity-detail-tab-requirement-test-case-links").click(),
      ]);
      expect(listResponse.ok()).toBeTruthy();
      expect(new URL(listResponse.url()).searchParams.get("requirement_id")).toBe(
        fixture.requirementId,
      );

      // What is LISTED is the link row, carrying the link's own id...
      const linkRow = page.getByTestId(/^entity-table-row-/).first();
      await expect(linkRow).toBeVisible({ timeout: 15000 });
      const linkRowTestId = await linkRow.getAttribute("data-testid");
      expect(linkRowTestId).not.toBe(`entity-table-row-${fixture.testCaseId}`);

      await linkRow.click();

      // ...but the click lands on the TEST CASE, following `targetField` —
      // an exact URL, so "navigated somewhere" cannot pass, and specifically
      // not the link row's own detail page.
      await expect(page).toHaveURL(
        new RegExp(`/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}$`),
      );
      await expect(page.getByTestId("entity-detail-field-title")).toContainText(
        fixture.testCaseTitle,
      );
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-054 (deep-link half): arriving with `?tab=` opens that tab
   * directly against the real backend, without an Info-tab render first — the
   * claim that makes a relationship tab genuinely shareable.
   */
  test("TC-ADMIN-054: a ?tab= deep link opens that relationship tab directly on load", async ({ page }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await page.goto(
        `/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}?tab=test-steps`,
      );

      await expect(page.getByText(fixture.testStepAction)).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("entity-detail-tab-test-steps")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The Info panel is not also rendered.
      await expect(page.getByTestId("entity-detail-fields")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-050 (negative half), against a real entity rather than a fixture:
   * an entity the real derivation reports no relationships for renders no tab
   * strip at all. `test-steps` is such an entity — nothing in the registry
   * declares an FK to it.
   */
  test("TC-ADMIN-050: an entity with no derived relationships renders no tab strip", async ({ page }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/test-steps/${fixture.testStepId}`,
        "test-steps",
      );

      await expect(page.getByTestId("entity-detail-fields")).toBeVisible();
      await expect(page.getByTestId("entity-detail-tablist")).toHaveCount(0);
      await expect(page.getByRole("tab")).toHaveCount(0);

      // ADR-0071's Amendment: with no strip there is no header to give it, so
      // the card carries none — and no `tab-content`/`tab-pane`/`tabpanel`
      // either, which would be a tabpanel with no tablist.
      const detailPage = page.getByTestId("entity-detail-page");
      await expect(detailPage.locator(".card-header")).toHaveCount(0);
      await expect(detailPage.locator(".tab-content")).toHaveCount(0);
      await expect(detailPage.locator(".tab-pane")).toHaveCount(0);
      await expect(page.getByRole("tabpanel")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });
});
