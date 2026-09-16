import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * [ADR-0078](../../docs/adr/0078-compound-create-through-bespoke-routes.md) E2E
 * — "Create new" on a relationship tab whose far entity has **no generic
 * `create` at all**, served by borrowing that entity's bespoke atomic route.
 *
 * TC-ADMIN-128.
 *
 * ## Why this needs a live stack, and why it is a different question from TC-ADMIN-099
 *
 * ADMIN-8's TC-ADMIN-099 proves the *generic* composition end to end: a far
 * entity's own `POST /test-cases`, then `linkCreate`. That is 9 of the 12 live
 * link directions. This spec covers the other shape — the far entity
 * (`TestCondition`) has no generic create, so the first call is REQ-3's
 * `POST /requirements/{id}/test-conditions`, which additionally writes the
 * junction row **inside its own transaction**.
 *
 * Which makes the load-bearing assertion here a **negative one**: exactly one
 * `POST` must leave the browser. `links_automatically=True` is a claim about
 * another module's transaction body — nothing in any schema, response or URL
 * carries it, and the backend unit test can only assert that we *declared* it.
 * If the declaration were wrong in the "already linked" direction, the client
 * would follow with `linkCreate` and get a `409` on the pair the first call
 * just wrote: a successful create surfacing to the user as a failure. So this
 * test watches the wire for the whole submit window and asserts on the
 * complete set of requests, not just on the one it expects to see.
 *
 * The mirror claim — that the link row really is written, by that one call — is
 * asserted the only way that proves it: the tab lists **link** rows, so the new
 * condition appearing in it *is* the `RequirementTestConditionLink` being
 * readable through its own scoped list. A `201` followed by a tab still reading
 * "No records found." is exactly the resolver gap ADR-0029 describes.
 *
 * ## Why the `Requirement` direction specifically
 *
 * It is the one of ADR-0078's three where the route's parent placeholder equals
 * the tab's own `relation.scopeField` — so no parent picker renders, and the
 * whole action is one modal and one request. That makes it the cleanest live
 * proof that the derivation (`compoundParentField` vs `scopeField`) resolves
 * correctly against the **real** served declaration rather than a fixture's.
 * The absence of the picker is asserted, not assumed: a wrong derivation would
 * render one and wait forever for a pick the flow never makes.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container. Seed/cleanup follows `admin8-relation-tab-write-actions.spec.ts`
 * verbatim, including the FK-safe child-first delete order and the
 * `refresh_token` row the login itself mints.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-deve77ffc-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

/** Same budget and reasoning as ADMIN-8's: the seed alone is a cold app import. */
const PER_TEST_TIMEOUT_MS = 300000;
const TAB_STRIP_TIMEOUT_MS = 20000;

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  orgId: string;
  projectId: string;
  requirementId: string;
}

/**
 * One Organization/Project + an org_admin, and one `Requirement`.
 *
 * Deliberately seeds **no** `TestCondition` and **no** link row — every row this
 * spec asserts is created by the browser through the feature under test, or the
 * test would pass against a UI that writes nothing.
 *
 * Note how much smaller this fixture is than ADMIN-8's: a `TestCondition` needs
 * only its `Requirement` (`requirement_id` + `description` + `priority`), with
 * no `TestLevel`/`TestType` to seed. That is the same `NOT NULL`-parent fact
 * that makes this entity bespoke-create-only in the first place.
 */
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
    async with AsyncSessionLocal() as session:
        email = f"e2e-admin10-org-admin-{suffix}@example.com"
        org_admin = User(name="ADMIN-10 E2E org admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(org_admin)
        await session.flush()
        session.add(AuthIdentity(user_id=org_admin.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADMIN-10 E2E Org", slug=f"admin10-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=org_admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=org_admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"ADMIN-10 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        requirement = Requirement(
            project_id=project.id,
            title=f"ADMIN-10 Requirement {suffix}",
            description=f"ADMIN-10 requirement description {suffix}",
            external_ref=f"ADMIN10-{suffix}",
        )
        session.add(requirement)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": email, "password": PASSWORD, "userId": str(org_admin.actor_id)},
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
        }))

asyncio.run(main())
`;

/**
 * FK-safe delete order (child-first).
 *
 * Keyed on the **Requirement**, not on any `TestCondition` id: every condition
 * this spec creates is created by the browser and its id exists nowhere outside
 * the page. Same widening ADR-0076 Amendment 1 forced on ADMIN-8's cleanup, and
 * for the same reason — a leaked row here holds an FK to the `Requirement` and
 * `Project` deleted below, so the leak would surface as a foreign-key violation
 * in *some later, unrelated* test's cleanup rather than as a visible orphan.
 *
 * `RequirementTestConditionLink` goes first: the atomic route writes it, so it
 * always exists for any condition this spec created, and it `RESTRICT`s both
 * ends.
 */
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCondition
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestConditionLink, TestConditionTestCaseLink

org_admin_id, org_id, project_id, requirement_id = sys.argv[1:5]

async def main():
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(TestCondition.id).where(TestCondition.requirement_id == requirement_id)
            )
        ).scalars().all()
        condition_ids = [str(row) for row in rows]
        if condition_ids:
            await session.execute(
                delete(TestConditionTestCaseLink).where(
                    TestConditionTestCaseLink.test_condition_id.in_(condition_ids)
                )
            )
            await session.execute(
                delete(RequirementTestConditionLink).where(
                    RequirementTestConditionLink.test_condition_id.in_(condition_ids)
                )
            )
            await session.execute(delete(TestCondition).where(TestCondition.id.in_(condition_ids)))
        await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
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
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

async function login(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
  orgId: string,
) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(new RegExp(`/orgs/${orgId}`), { timeout: 60000 });
}

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

test.describe("ADR-0078: compound create through a bespoke route", () => {
  // Same reasoning as ADMIN-6/7/8: several full page loads against one
  // dev-profile Vite server; concurrency here buys nothing and flakes.
  test.describe.configure({ mode: "serial" });

  test("TC-ADMIN-128: Create new on a tab whose far entity has no generic create", async ({
    page,
  }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    const newConditionText = `ADMIN-10 compound-created condition ${Date.now()}`;
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoTab(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}?tab=requirement-test-condition-links`,
        "requirements",
      );

      await expect(page.getByText("No records found.")).toBeVisible({
        timeout: TAB_STRIP_TIMEOUT_MS,
      });

      /**
       * The regression this whole ADR exists to end: before it, this exact tab
       * rendered "Link existing" **alone**, because `TestCondition` has no
       * generic `create` for ADR-0076 Amendment 1's composition to use.
       * Asserted before any click, since "only one button rendered" is the
       * failure being replaced.
       */
      const linkButton = page.getByTestId("entity-relation-link");
      const createLinkButton = page.getByTestId("entity-relation-create-link");
      await expect(linkButton).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
      await expect(createLinkButton).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
      await expect(createLinkButton).toHaveAccessibleName(/create new test conditions/i);
      await expect(page.getByTestId("entity-relation-actions")).toHaveCount(1);

      await createLinkButton.click();

      /**
       * No parent picker, and its absence is the derivation under test — the
       * declared template's single placeholder is `{requirement_id}`, which IS
       * this tab's own `relation.scopeField`, so the route's parent is the
       * record already on screen. A wrong derivation renders a picker here and
       * blocks the form behind a pick this flow never makes.
       */
      await expect(page.getByTestId("entity-relation-compound-parent-hint")).toHaveCount(0);
      await expect(page.locator("#entity-relation-compound-parent-picker")).toHaveCount(0);

      // The parent shown, and not the user's to change.
      await expect(page.getByLabel("Requirement", { exact: true })).toBeDisabled({
        timeout: TAB_STRIP_TIMEOUT_MS,
      });

      await page.getByLabel("Description", { exact: true }).fill(newConditionText);
      /**
       * `Priority` is selected explicitly even though the served schema marks
       * it **not required**, and that is a workaround for the same
       * **pre-existing** generic-form defect ADR-0076 Amendment 1 found and
       * deliberately did not fix: `EntityForm` maps every blank optional field
       * to `null`, but `CreateTestConditionForRequirementRequest.priority` is
       * required and non-nullable, so a blank `422`s. It derives as
       * `required: false` only because `_TEST_CONDITION_CONFIG` has
       * `create_schema=None` — there is no create schema for the derivation to
       * read required-ness from. Nothing about a relationship tab causes this;
       * the fix is a change to the shared form affecting every entity and every
       * create path, so it stays its own story (ADR-0078's Consequences).
       */
      await page.getByLabel("Priority", { exact: true }).selectOption("medium");

      /**
       * Watch the wire for the WHOLE submit window, not just for the one
       * request we expect. `links_automatically=True` is a claim that exactly
       * one `POST` is needed, and the only way to falsify it is to observe a
       * second one — so every `POST` is recorded and the complete set asserted
       * below.
       */
      const postedUrls: string[] = [];
      const recordPost = (request: import("@playwright/test").Request) => {
        if (request.method() === "POST" && request.url().includes("/api/v1/")) {
          postedUrls.push(request.url());
        }
      };
      page.on("request", recordPost);

      const createResponse = page.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/v1/requirements/${fixture.requirementId}/test-conditions`) &&
          res.request().method() === "POST",
        { timeout: TAB_STRIP_TIMEOUT_MS },
      );

      await page.getByRole("button", { name: "Create", exact: true }).click();

      const created = await createResponse;
      // Body read once and reused as the failure message: a `422` here is a
      // payload-shape mismatch between what `EntityForm` builds from the served
      // schema and what the bespoke request schema accepts, and its
      // `field_errors` name the offending field outright.
      const createdBody = await created.text();
      expect(created.status(), createdBody).toBe(201);
      const createdCondition = JSON.parse(createdBody) as {
        id: string;
        requirement_id: string;
        description: string;
      };
      // The parent really came from the path, and really is this Requirement.
      expect(createdCondition.requirement_id).toBe(fixture.requirementId);
      expect(createdCondition.description).toBe(newConditionText);

      /**
       * The link row is readable through the relation's OWN scoped list — this
       * tab lists `RequirementTestConditionLink` rows, so the new condition
       * showing up here *is* the link having been written. One request did both.
       */
      await expect(page.getByText(newConditionText)).toBeVisible({
        timeout: TAB_STRIP_TIMEOUT_MS,
      });

      page.off("request", recordPost);

      /**
       * The negative half, and the reason this test is on a live stack at all.
       * Exactly one API `POST` — no `linkCreate` follow-up. A second call here
       * would hit `POST /requirements/{id}/test-condition-links/{id}` and `409`
       * on the pair the first call already wrote, turning a successful create
       * into a user-visible error.
       */
      expect(postedUrls).toHaveLength(1);
      expect(postedUrls[0]).toContain(
        `/api/v1/requirements/${fixture.requirementId}/test-conditions`,
      );
      expect(postedUrls[0]).not.toContain("test-condition-links");

      // And no "created but not linked" notice — that partial state is
      // unreachable on this path by construction, not merely improbable.
      await expect(page.getByTestId("entity-relation-create-link-error")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });
});
