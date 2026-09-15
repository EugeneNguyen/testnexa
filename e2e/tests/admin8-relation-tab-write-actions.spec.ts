import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADR-0076 E2E: the relationship tabs' two write actions — real browser, full
 * stack, real derived `relations` and real `linkCreate` from the real backend.
 *
 * **What only a live stack can answer here.** The backend suite proves each
 * route's boundaries and that a created link row is readable through its own
 * relation's list request; the Vitest suite proves the component renders the
 * right action, gated twice, and calls the right function with the right
 * arguments. Neither can prove the two halves *meet*: that the `pathTemplate`
 * the backend serves, interpolated by the frontend from the relation's own
 * `scopeField`/`targetField`, produces a URL the real router accepts, with the
 * real permission granted to the real logged-in actor, and that the tab's
 * table then shows the row. Every layer below this one is internally
 * consistent by construction and could still be wrong about the other side —
 * exactly the class of gap `frontend/CLAUDE.md`'s "a hand-typed mock stays
 * green after a contract change" note describes.
 *
 * **Three flows, chosen to cover three structurally different paths**, per
 * ADR-0076's own decision structure:
 *
 * 1. **one-to-many create** — `TestCase` -> "Test steps". The child's own
 *    generic `POST /test-steps` with `test_case_id` locked. Proves
 *    `EntityForm`'s `lockedValues` actually reaches the payload through a real
 *    request, not just through a mocked `createEntity`.
 * 2. **many-to-many link, pre-existing route** — `TestSuite` -> "Test cases
 *    (linked)", i.e. REQ-4's `POST /test-suites/{id}/test-cases/{case_id}`,
 *    gated on `test_suite.update`. This is the case where `linkCreate` carries
 *    a permission that is *not* `<resource>.create`; if the declaration were
 *    derived rather than declared, this flow would hide its own button.
 * 3. **many-to-many link, brand-new route** — `Requirement` -> "Test cases
 *    (linked)", i.e. ADR-0076's own
 *    `POST /requirements/{id}/test-case-links/{case_id}`, gated on
 *    `requirement_test_case_link.create` — a permission code that did not
 *    exist before migration `3e6b08c5da71`, so this flow also proves the
 *    migration actually granted it to `org_admin` on this database.
 *
 * The same seeded `TestCase` is the far row in flows 2 and 3 and the parent in
 * flow 1, which is deliberate: it is a REQ-5 *standalone* case (`project_id`
 * set, no `TestCondition`, no links), the shape whose project resolution
 * ADR-0076 had to fix — so every flow here also exercises
 * `resolve_test_case_project_id`'s new branch against a live route.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container. Seed/cleanup follows `admin7-entity-relation-tabs.spec.ts`
 * verbatim, including the FK-safe child-first delete order and the
 * `refresh_token` row the login itself mints.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-deve77ffc-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

/**
 * Same reasoning as `admin7-entity-relation-tabs.spec.ts`: `seedFixture()` is
 * a `docker exec ... python -` that imports the whole FastAPI app in a fresh
 * interpreter, measured between 17s and 98s on a contended host, and it is
 * paid inside each test's own timed body before the browser does anything.
 * Each test here then drives a login, a detail-page load, a modal, a real
 * write and a re-fetch — more round trips than ADMIN-7's read-only cases, not
 * fewer.
 */
const PER_TEST_TIMEOUT_MS = 300000;

/**
 * The tab strip and the picker are driven by separate
 * `GET /entities/{resource}/schema` requests riding alongside the record
 * fetch, so the first read of a freshly-loaded strip is routinely past the 5s
 * assertion default on a busy host — `e2e/CLAUDE.md`'s own prescription for
 * this class of race.
 */
const TAB_STRIP_TIMEOUT_MS = 20000;

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  orgId: string;
  projectId: string;
  requirementId: string;
  requirementTitle: string;
  /** A REQ-5 standalone `TestCase`: `project_id` set, no condition, no links, in no suite. */
  testCaseId: string;
  testCaseTitle: string;
  testSuiteId: string;
  testSuiteName: string;
  testLevelId: string;
  testTypeId: string;
}

/**
 * One Organization/Project + an org_admin, one `Requirement`, one standalone
 * `TestCase`, one empty `TestSuite`.
 *
 * Deliberately seeds **no** link rows and **no** `TestStep` — every row this
 * spec asserts must be created by the browser through the feature under test,
 * or the test would pass against a UI that writes nothing. That is the whole
 * difference between this file and ADMIN-7's, which seeds its links because
 * its subject is rendering.
 *
 * `TestCase.test_level_id`/`test_type_id` are NOT NULL, so a `TestLevel` and a
 * `TestType` are seeded alongside.
 */
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import Requirement, TestCase, TestSuite
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    async with AsyncSessionLocal() as session:
        email = f"e2e-admin8-org-admin-{suffix}@example.com"
        org_admin = User(name="ADMIN-8 E2E org admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(org_admin)
        await session.flush()
        session.add(AuthIdentity(user_id=org_admin.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADMIN-8 E2E Org", slug=f"admin8-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=org_admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=org_admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"ADMIN-8 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        level = TestLevel(name=f"ADMIN-8 Level {suffix}")
        test_type = TestType(name=f"ADMIN-8 Type {suffix}")
        session.add_all([level, test_type])
        await session.flush()

        requirement_title = f"ADMIN-8 Requirement {suffix}"
        requirement = Requirement(
            project_id=project.id,
            title=requirement_title,
            description=f"ADMIN-8 requirement description {suffix}",
            external_ref=f"ADMIN8-{suffix}",
        )
        session.add(requirement)
        await session.flush()

        # REQ-5 standalone shape on purpose: no test_condition_id, no link rows.
        test_case_title = f"ADMIN-8 TestCase {suffix}"
        test_case = TestCase(
            project_id=project.id,
            title=test_case_title,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=org_admin.actor_id,
        )
        session.add(test_case)
        await session.flush()

        suite_name = f"ADMIN-8 Suite {suffix}"
        suite = TestSuite(project_id=project.id, name=suite_name, purpose="ADR-0076 write-action fixture")
        session.add(suite)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": email, "password": PASSWORD, "userId": str(org_admin.actor_id)},
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
            "requirementTitle": requirement_title,
            "testCaseId": str(test_case.id),
            "testCaseTitle": test_case_title,
            "testSuiteId": str(suite.id),
            "testSuiteName": suite_name,
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

/**
 * FK-safe delete order (child-first). Deletes the rows the *browser* created
 * as well as the seeded ones — `TestStep`s by `test_case_id`, and the three
 * link tables by whichever id they hang off — because which of them exist
 * depends on which test ran, and a per-test id list would have to be threaded
 * back out of the page.
 *
 * **ADR-0076 Amendment 1 widened this from "the seeded `TestCase`" to "every
 * `TestCase` in the seeded Project."** TC-ADMIN-099's flow creates a brand-new
 * far-entity row through the browser, whose id exists nowhere outside the page,
 * so a cleanup keyed on `test_case_id` alone would leave it behind — and it
 * holds an FK to the `TestLevel`/`TestType`/`Project` rows deleted below, so
 * the leak would surface as a *foreign-key violation on an unrelated later
 * test's cleanup*, not as a visibly orphaned row. The project is this fixture's
 * own, created per-run with a uuid suffix, so "every case in it" is exactly the
 * set this spec is responsible for.
 */
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase, TestStep, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestCaseLink

(org_admin_id, org_id, project_id, requirement_id, test_case_id,
 suite_id, level_id, type_id) = sys.argv[1:9]

async def main():
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(select(TestCase.id).where(TestCase.project_id == project_id))).scalars().all()
        case_ids = [str(row) for row in rows]
        if test_case_id not in case_ids:
            case_ids.append(test_case_id)
        await session.execute(delete(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id.in_(case_ids)))
        await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_case_id.in_(case_ids)))
        await session.execute(delete(TestStep).where(TestStep.test_case_id.in_(case_ids)))
        await session.execute(delete(TestSuite).where(TestSuite.id == suite_id))
        await session.execute(delete(TestCase).where(TestCase.id.in_(case_ids)))
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
      fixture.testCaseId,
      fixture.testSuiteId,
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
  await page.waitForURL(new RegExp(`/orgs/${orgId}`), { timeout: 60000 });
}

/**
 * Open a detail page on a specific relationship tab and wait for the record's
 * own fetch. The trailing container assertion earns its place for the reason
 * ADMIN-7's own helper documents: a tab assertion made against the wrong page
 * fails in a way indistinguishable from the feature being broken.
 */
async function gotoTab(
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
  await expect(page.getByTestId("entity-detail-page")).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
}

/** Type into the "Link existing ..." picker and choose the one matching row. */
async function pickInLinkModal(page: import("@playwright/test").Page, label: string, needle: string) {
  const picker = page.locator("#entity-relation-link-picker");
  await expect(picker).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
  await picker.fill(needle);
  // `FkAutocomplete` debounces, then renders its results as buttons.
  await page.getByRole("button", { name: label, exact: true }).click({ timeout: TAB_STRIP_TIMEOUT_MS });
}

test.describe("ADR-0076: relationship-tab write actions", () => {
  // Same reasoning as ADMIN-6/ADMIN-7: each test drives several full page
  // loads against the dev-profile Vite server, and running them concurrently
  // starves it. Scoped to this file only.
  test.describe.configure({ mode: "serial" });

  /**
   * TC-ADMIN-093 — the one-to-many "New" flow, end to end.
   *
   * The assertion that matters is the last one: the new row appears in the
   * tab's own table, which means the locked `test_case_id` really did reach
   * the payload *and* the tab's scoped list really does return it. A create
   * that succeeded with a null or wrong scope would 201 and then simply never
   * show up here — the same create-only blind spot the backend tests guard
   * from the other side.
   */
  test("TC-ADMIN-093: creating a child from a one-to-many tab lands it under this parent", async ({ page }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    const stepAction = `ADMIN-8 step ${Date.now()}`;
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoTab(
        page,
        `/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}?tab=test-steps`,
        "test-cases",
      );

      // The tab starts empty — the fixture seeds no TestStep, so anything that
      // appears below was created by this test.
      await expect(page.getByText("No records found.")).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });

      await page.getByTestId("entity-relation-create").click({ timeout: TAB_STRIP_TIMEOUT_MS });

      // The scoping field is shown, and is not the user's to change.
      await expect(page.getByLabel("Test case", { exact: true })).toBeDisabled();

      await page.getByLabel("Sequence", { exact: true }).fill("1");
      await page.getByLabel("Action", { exact: true }).fill(stepAction);
      await page.getByRole("button", { name: "Create", exact: true }).click();

      await expect(page.getByText(stepAction)).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-094 — "Link existing" through a route that predates this ADR.
   *
   * `test_suite_test_case`'s `linkCreate.permission` is `test_suite.update`,
   * not `test_suite_test_case.create` — REQ-4's route shipped with that gate
   * and ADR-0076 re-gates nothing. This is the flow that would break if the
   * permission were derived by convention instead of declared, and the
   * failure would be silent: the button simply would not render.
   */
  test("TC-ADMIN-094: linking an existing row through a pre-existing membership route", async ({ page }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoTab(
        page,
        `/projects/${fixture.projectId}/admin/test-suites/${fixture.testSuiteId}?tab=test-suite-test-cases`,
        "test-suites",
      );

      await expect(page.getByText("No records found.")).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });

      const linkButton = page.getByTestId("entity-relation-link");
      // Labelled by the FAR entity, not by the junction table. Icon-only
      // button (CTO request, 2026-09-15) — accessible name, not visible text.
      await expect(linkButton).toHaveAccessibleName(/link existing test cases/i, { timeout: TAB_STRIP_TIMEOUT_MS });
      await linkButton.click();

      await pickInLinkModal(page, fixture.testCaseTitle, fixture.testCaseTitle);
      await page.getByTestId("entity-relation-link-submit").click();

      // The far record's own title, resolved by the tab's fk-label lookup from
      // the link row — so this also proves the row is readable through the
      // relation's scoped list, not merely written.
      await expect(page.getByText(fixture.testCaseTitle)).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-095 — "Link existing" through one of ADR-0076's four brand-new
   * routes.
   *
   * `POST /requirements/{id}/test-case-links/{case_id}` and its
   * `requirement_test_case_link.create` code both came into existence with
   * this ADR, so a pass here also proves migration `3e6b08c5da71` actually ran
   * against this database and granted the code to `org_admin` — a failure
   * would show up as the button never rendering, which is why the explicit
   * visibility assertion precedes the click.
   *
   * The far row is the seeded **standalone** `TestCase`, so this is also the
   * live proof of `resolve_test_case_project_id`'s REQ-5 branch: before
   * ADR-0076 fixed it, that shape resolved to no project at all and every
   * cross-project check involving one rejected it.
   */
  test("TC-ADMIN-095: linking an existing row through a brand-new traceability route", async ({ page }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoTab(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}?tab=requirement-test-case-links`,
        "requirements",
      );

      await expect(page.getByText("No records found.")).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });

      const linkButton = page.getByTestId("entity-relation-link");
      await expect(linkButton).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
      await linkButton.click();

      await pickInLinkModal(page, fixture.testCaseTitle, fixture.testCaseTitle);

      const [response] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/v1/requirements/${fixture.requirementId}/test-case-links/`) &&
            res.request().method() === "POST",
        ),
        page.getByTestId("entity-relation-link-submit").click(),
      ]);
      // Asserted on the wire, not only through the rendered result: this is
      // the one flow whose URL the frontend built itself from a served
      // `pathTemplate`, so the exact path is the contract under test.
      expect(response.status()).toBe(201);
      expect(response.url()).toContain(`/test-case-links/${fixture.testCaseId}`);

      await expect(page.getByText(fixture.testCaseTitle)).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-099 — ADR-0076 **Amendment 1**: both n-n actions side by side, and
   * the compound "Create new …" flow end to end.
   *
   * **Why this needs a live stack rather than another Vitest case.** The Vitest
   * suite proves the component fires `createEntity` and then `createLinkRow`
   * with the right arguments — against mocks that agree with it by
   * construction. What only a real stack can answer is whether the *two real
   * routes compose*: whether the generic `POST /test-cases` actually accepts
   * the payload `EntityForm` builds from the served schema with `project_id`
   * merged in as a locked value, whether the id in its `201` body is the shape
   * `interpolateLinkPath` can substitute, and whether the link route then
   * accepts a row created *microseconds earlier* — the ADR-0029 resolver
   * question, which for this flow is sharper than for TC-ADMIN-095's: the far
   * row here has never been read back by anything before the link route walks
   * it. Both requests are therefore asserted **on the wire**, in order, not
   * only through the rendered result.
   *
   * The far entity is `TestCase` — `project_id`-scoped and factory-creatable,
   * i.e. scoping case 2, the shape 9 of the 12 live link directions have. The
   * new case is created **standalone** (no `test_condition_id`), which is also
   * the only shape this form can produce, so this exercises
   * `resolve_test_case_project_id`'s REQ-5 branch on a row that did not exist
   * when the page loaded.
   */
  test("TC-ADMIN-099: both n-n actions render, and Create new creates the far row then links it", async ({ page }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    const newCaseTitle = `ADMIN-8 created-and-linked ${Date.now()}`;
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoTab(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}?tab=requirement-test-case-links`,
        "requirements",
      );

      await expect(page.getByText("No records found.")).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });

      // Both, together — the whole point of the amendment. Asserted before any
      // click, since "only one rendered" is the regression this replaces.
      const linkButton = page.getByTestId("entity-relation-link");
      const createLinkButton = page.getByTestId("entity-relation-create-link");
      await expect(linkButton).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
      await expect(createLinkButton).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
      // Icon-only button (CTO request, 2026-09-15) — accessible name, not text.
      await expect(createLinkButton).toHaveAccessibleName(/create new test cases/i);
      // In the one right-aligned strip above the table, not two strips and not
      // in the card header — the placement the UI Design Document §6.2 sketch
      // and prose both describe.
      await expect(page.getByTestId("entity-relation-actions")).toHaveCount(1);

      await createLinkButton.click();

      // The far entity's own scope, prefilled from the route and not the
      // user's to change — the same `lockedValues` mechanism the 1-n action
      // uses, pointed at the FAR entity's scope field instead of the relation's.
      await expect(page.getByLabel("Project", { exact: true })).toBeDisabled({
        timeout: TAB_STRIP_TIMEOUT_MS,
      });

      await page.getByLabel("Title", { exact: true }).fill(newCaseTitle);
      // `TestLevel`/`TestType` are `select: true` (small bounded catalogs), so
      // these are native `<select>`s. Chosen by **value** (the seeded ids)
      // rather than by label: `selectOption` retries until the option exists,
      // which is also this directory's own prescription for the
      // page-mount-fetch race a one-shot option read would lose.
      await page
        .getByLabel("Test level", { exact: true })
        .selectOption(fixture.testLevelId, { timeout: TAB_STRIP_TIMEOUT_MS });
      await page
        .getByLabel("Test type", { exact: true })
        .selectOption(fixture.testTypeId, { timeout: TAB_STRIP_TIMEOUT_MS });
      /**
       * `Status` is filled explicitly even though the served schema marks it
       * **not required**, and that is a workaround for a **pre-existing**
       * generic-form defect this story neither introduced nor owns:
       * `EntityForm` maps every blank optional field to `null` before
       * submitting, but `CreateStandaloneTestCaseRequest.status` is
       * defaulted-and-non-nullable (`TestCaseStatus = "draft"`), so a blank
       * Status `422`s with `"Input should be 'draft', ..."`. The identical
       * failure is reachable today from `EntityListPage`'s own "New Test case"
       * modal — nothing about a relationship tab causes it — and the real fix
       * (omit a blank optional rather than sending `null`) is a change to the
       * shared form affecting every entity, so it belongs to its own story.
       * Flagged in ADR-0076's Amendment 1 rather than fixed as a drive-by.
       */
      await page.getByLabel("Status", { exact: true }).selectOption("draft");

      const createResponse = page.waitForResponse(
        (res) => res.url().endsWith("/api/v1/test-cases") && res.request().method() === "POST",
        { timeout: TAB_STRIP_TIMEOUT_MS },
      );
      const linkResponse = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/requirements/${fixture.requirementId}/test-case-links/`) &&
          res.request().method() === "POST",
        { timeout: TAB_STRIP_TIMEOUT_MS },
      );

      await page.getByRole("button", { name: "Create", exact: true }).click();

      const created = await createResponse;
      // Body read once and used as the failure message too: a `422` here is a
      // payload-shape mismatch between what `EntityForm` builds from the
      // served schema and what the create schema accepts, and its
      // `field_errors` name the offending field outright — a bare status
      // assertion would hide exactly the information needed to fix it.
      const createdBody = await created.text();
      expect(created.status(), createdBody).toBe(201);
      const createdCase = JSON.parse(createdBody) as { id: string; project_id: string };
      // The locked scope really did reach the payload — asserted on the row the
      // server actually stored, not on the form's own disabled input.
      expect(createdCase.project_id).toBe(fixture.projectId);

      const linked = await linkResponse;
      expect(linked.status()).toBe(201);
      // The second call's URL is built by the frontend from the *served*
      // `pathTemplate` and the id the *first* call returned. That composition
      // is the contract this test exists for, so it is asserted literally.
      expect(linked.url()).toContain(`/test-case-links/${createdCase.id}`);

      // And it is readable through the relation's own scoped list — a `201`
      // followed by a tab that still says "No records found." is exactly the
      // resolver gap ADR-0029 describes.
      await expect(page.getByText(newCaseTitle)).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
      // No "created but not linked" notice on the success path.
      await expect(page.getByTestId("entity-relation-create-link-error")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });
});
