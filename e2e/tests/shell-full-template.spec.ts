import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * SHELL-2/3/4 E2E (ADR-0020): dark/light mode toggle (FR-SHELL-4) and the
 * dashboard stat widgets (FR-SHELL-3). Covers TC-SHELL-010/012/013 from
 * `docs/test-cases/2026-09-03-test-cases.md` — TC-SHELL-010 asserts real
 * seeded counts (2 Projects, 1 active member) as of ADMIN-2/ADR-0022's
 * generic-CRUD factory shipping `GET /projects`/`GET /org-memberships`;
 * it previously asserted an honest-error-state fallback while those routes
 * didn't exist.
 *
 * Fixture seeding/cleanup: copied verbatim from `project-create.spec.ts`'s
 * convention (single active `OrgMembership` -> `org_context: "auto"` ->
 * `Login.tsx` lands straight on `OrgHome` through real UI navigation, no
 * raw `page.goto("/orgs/...")`).
 *
 * Target environment: the isolated Compose project set via `E2E_BASE_URL`
 * (external to this file, per this task's brief), never the main `testnexa`
 * stack. Container name overridable via `E2E_BACKEND_CONTAINER`.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-shell2-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededOrgAdmin {
  email: string;
  password: string;
  userId: string;
  orgId: string;
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
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-shell2-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="SHELL-2/3/4 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="SHELL-2/3/4 E2E Org", slug=f"shell2-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
        }))

asyncio.run(main())
`;

const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id = sys.argv[1], sys.argv[2]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.commit()

asyncio.run(main())
`;

function seedOrgAdmin(): SeededOrgAdmin {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededOrgAdmin;
}

function cleanup(admin: SeededOrgAdmin): void {
  execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-", admin.userId, admin.orgId], {
    input: CLEANUP_SCRIPT,
    encoding: "utf-8",
  });
}

// --- TC-SHELL-010 real-count seeding (ADMIN-2/ADR-0022 follow-up) -------------------------------
// `GET /projects`/`GET /org-memberships` now exist (the generic-CRUD factory) — this seeds real
// rows so the widgets' actual counts can be asserted, replacing the old interim-error-state test.

interface SeededOrgAdminWithProjects extends SeededOrgAdmin {
  projectIds: string[];
}

const SEED_WITH_PROJECTS_SCRIPT = `
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
PROJECT_COUNT = 2

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-shell2-widgets-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="SHELL-3 Widgets E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="SHELL-3 Widgets E2E Org", slug=f"shell3-widgets-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        projects = [Project(org_id=org.id, name=f"SHELL-3 Widget Project {i} {suffix}") for i in range(PROJECT_COUNT)]
        session.add_all(projects)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectIds": [str(p.id) for p in projects],
        }))

asyncio.run(main())
`;

const CLEANUP_WITH_PROJECTS_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_ids_json = sys.argv[1], sys.argv[2], sys.argv[3]
project_ids = json.loads(project_ids_json)

async def main():
    async with AsyncSessionLocal() as session:
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.commit()

asyncio.run(main())
`;

function seedOrgAdminWithProjects(): SeededOrgAdminWithProjects {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_WITH_PROJECTS_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededOrgAdminWithProjects;
}

function cleanupWithProjects(admin: SeededOrgAdminWithProjects): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", admin.userId, admin.orgId, JSON.stringify(admin.projectIds)],
    { input: CLEANUP_WITH_PROJECTS_SCRIPT, encoding: "utf-8" },
  );
}

async function loginToOrgHome(page: import("@playwright/test").Page, admin: SeededOrgAdmin) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(admin.email);
  await page.getByLabel(/password/i).fill(admin.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(new RegExp(`/orgs/${admin.orgId}$`));
}

test.describe("SHELL-4 dark/light color-mode toggle", () => {
  test("TC-SHELL-012: toggling the color mode flips the applied theme", async ({ page }) => {
    const admin = seedOrgAdmin();

    try {
      await loginToOrgHome(page, admin);

      const html = page.locator("html");
      // useColorModes' default resolution (no localStorage key set yet):
      // system preference, i.e. `prefers-color-scheme`-derived — not
      // asserted here, only the *change* below is.
      await page.getByTestId("color-mode-toggle").click();
      await page.getByTestId("color-mode-dark").click();
      await expect(html).toHaveAttribute("data-coreui-theme", "dark");

      await page.getByTestId("color-mode-toggle").click();
      await page.getByTestId("color-mode-light").click();
      await expect(html).toHaveAttribute("data-coreui-theme", "light");
    } finally {
      cleanup(admin);
    }
  });

  test("TC-SHELL-013: theme choice persists across a reload", async ({ page }) => {
    const admin = seedOrgAdmin();

    try {
      await loginToOrgHome(page, admin);

      await page.getByTestId("color-mode-toggle").click();
      await page.getByTestId("color-mode-dark").click();
      await expect(page.locator("html")).toHaveAttribute("data-coreui-theme", "dark");

      await page.reload();
      // AuthContext's boot-time silent refresh (AUTH-2) re-establishes the
      // session on reload; the theme survives independently of it, read
      // straight from localStorage on mount — not reset to the default.
      await page.waitForURL(new RegExp(`/orgs/${admin.orgId}$`));
      await expect(page.locator("html")).toHaveAttribute("data-coreui-theme", "dark");
    } finally {
      cleanup(admin);
    }
  });
});

test.describe("SHELL-3 dashboard stat widgets", () => {
  test("TC-SHELL-010: widgets show real, seeded counts (GET /projects, GET /org-memberships now exist — ADMIN-2/ADR-0022)", async ({
    page,
  }) => {
    // Rewritten per this test's own previously-documented follow-up: the
    // generic-CRUD factory (ADR-0022) now ships `GET /projects`/
    // `GET /org-memberships`, closing the gap that made only the
    // honest-error-state assertion achievable before. 2 seeded Projects +
    // the seeded org_admin's own 1 active OrgMembership (no other members
    // invited) is the exact fixture asserted below — not a snapshot of
    // whatever the DB happens to contain.
    const admin = seedOrgAdminWithProjects();

    try {
      await loginToOrgHome(page, admin);

      await expect(page.getByTestId("widget-project-count")).toContainText("2");
      await expect(page.getByTestId("widget-active-member-count")).toContainText("1");
      // Never a false zero (NFR-27/NFR-31) — both widgets show real,
      // non-zero counts here since the fixture itself is non-zero.
      await expect(page.getByTestId("widget-project-count")).not.toContainText(/unable to load/i);
      await expect(page.getByTestId("widget-active-member-count")).not.toContainText(/unable to load/i);
    } finally {
      cleanupWithProjects(admin);
    }
  });
});
