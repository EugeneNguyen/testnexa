import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * REQ-1 E2E, browser UI (ADR-0025's frontend slice): real browser, full
 * stack, exercising `ProjectDetail.tsx`'s "Requirements" section — the
 * Requirement list + search box + "New Requirement" modal added on top of
 * the already-shipped `POST`/`GET /requirements` API (ADMIN-2/ADR-0025).
 *
 * Complements (does not replace) `req1-capture-requirement.spec.ts`, which
 * stays as the API-level (no-`page`) proof that the full stack round-trips
 * `title` correctly — this file is the actual click-through a human
 * (Priya) would do, now that a UI exists for it.
 *
 * Fixture seeding: one org_admin (one Organization, one active
 * OrgMembership, org-wide `org_admin` RoleAssignment) of one Project —
 * mirrors `project-create.spec.ts`'s seeding convention, plus a directly
 * seeded `Project` row (this spec isn't testing Project creation, PROJ-1
 * already covers that) so the test can navigate straight to
 * `/projects/{id}` without going through OrgHome's local-state-only list.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-test-17935-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
}

const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-req1-ui-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="REQ-1 UI E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="REQ-1 UI E2E Org", slug=f"req1-ui-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"REQ-1 UI E2E Project {suffix}")
        session.add(project)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring test_requirements_title.py's `_cleanup` helper.
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

test.describe("REQ-1: capture and search a Requirement via ProjectDetail's UI", () => {
  test("create via the New Requirement modal, appears in the list, searchable by title and external ref", async ({
    page,
  }) => {
    const fixture = seedFixture();
    const requirementIds: string[] = [];
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await page.goto(`/projects/${fixture.projectId}`);
      await expect(page.getByRole("heading", { name: /^requirements$/i })).toBeVisible();
      await expect(page.getByText(/no requirements yet/i)).toBeVisible();

      // --- Create a Requirement via the "New Requirement" modal -----------------
      await page.getByRole("button", { name: /new requirement/i }).click();
      await expect(page.getByRole("heading", { name: /new requirement/i })).toBeVisible();

      const title = `REQ-1 UI E2E requirement ${Date.now().toString(36)}`;
      const externalRef = `JIRA-${Date.now().toString(36)}`;
      await page.getByLabel(/^title$/i).fill(title);
      await page.getByLabel(/^description$/i).fill("Created via the ProjectDetail UI, E2E");
      await page.getByLabel(/^source$/i).fill("stakeholder interview");
      await page.getByLabel(/external ref/i).fill(externalRef);

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes("/api/v1/requirements") && response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^create$/i }).click(),
      ]);
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json();
      requirementIds.push(created.id);

      // Modal closes, new row appears with the submitted values.
      await expect(page.getByRole("heading", { name: /new requirement/i })).not.toBeVisible();
      const row = page.getByRole("row", { name: new RegExp(title) });
      await expect(row).toBeVisible();
      await expect(row.getByText(externalRef)).toBeVisible();
      await expect(row.getByText("stakeholder interview")).toBeVisible();

      // --- Search by title substring (?q=) -------------------------------------
      await page.getByLabel(/search requirements/i).fill(title.slice(0, 12));
      await page.getByRole("button", { name: /^search$/i }).click();
      await expect(page.getByRole("row", { name: new RegExp(title) })).toBeVisible();

      // --- Search for something that doesn't match -> empty state, not an error ---
      await page.getByLabel(/search requirements/i).fill("this-does-not-exist-anywhere");
      await page.getByRole("button", { name: /^search$/i }).click();
      await expect(page.getByText(/no requirements match your search/i)).toBeVisible();
    } finally {
      cleanup(fixture, requirementIds);
    }
  });
});
