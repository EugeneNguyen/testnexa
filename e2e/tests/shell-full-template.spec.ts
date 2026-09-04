import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * SHELL-2/3/4 E2E (ADR-0019): dark/light mode toggle (FR-SHELL-4) and the
 * dashboard stat widgets (FR-SHELL-3). Covers TC-SHELL-012/013 from
 * `docs/test-cases/2026-09-03-test-cases.md`, plus a documented interim
 * assertion for TC-SHELL-010 (see that test below for why it isn't the
 * "real seeded counts" scenario the test-cases doc describes, yet).
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
  test("TC-SHELL-010 (interim): widgets never show a false zero — honest error state while their backing routes (GET /projects, GET /org-memberships) don't exist yet", async ({
    page,
  }) => {
    // Deviation flagged explicitly (see `lib/api/dashboard.ts`'s own
    // docstring): the generic-CRUD factory routes FR-SHELL-3 is written
    // against (API Document §3) haven't shipped in this codebase yet — only
    // PROJ-1/RBAC-2's bespoke routes exist. Both widget calls 404 today.
    // NFR-25's actual, currently-testable claim is therefore "the widgets
    // surface that failure honestly, not as a false '0'" — TC-SHELL-010's
    // own "real seeded counts" scenario is not achievable until the
    // ADMIN-2 generic-CRUD factory ships `GET /projects`/
    // `GET /org-memberships`. Once it does, this test should be rewritten
    // to seed N projects/M active members and assert those exact numbers,
    // replacing the assertion below.
    const admin = seedOrgAdmin();

    try {
      await loginToOrgHome(page, admin);

      await expect(page.getByTestId("widget-project-count")).toContainText(/unable to load/i);
      await expect(page.getByTestId("widget-active-member-count")).toContainText(/unable to load/i);
      // Never a false zero (NFR-25) — the one invariant that IS fully
      // testable against today's backend.
      await expect(page.getByTestId("widget-project-count")).not.toHaveText("0");
      await expect(page.getByTestId("widget-active-member-count")).not.toHaveText("0");
    } finally {
      cleanup(admin);
    }
  });
});
