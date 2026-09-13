import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADR-0063 E2E: the MCP Integration screen — real UI click-through against a
 * real deployed stack (nginx -> backend -> real Postgres). Login -> navigate
 * via the sidebar's own "MCP Integration" nav item -> confirm the
 * client-connection docs render -> issue an agent API key through the
 * live form -> the raw key is shown exactly once -> the new row appears in
 * the table as Active -> Revoke -> the row flips to Revoked and the Revoke
 * button disappears.
 *
 * Fixture seeding mirrors `auth-agents.spec.ts`'s exact convention: a
 * `docker exec <backend-container> python -` script granting a fresh human
 * `User` an active `OrgMembership` + a `Role` holding `ai_agent.create`
 * (this story's list route reuses that same permission code, not a new
 * `.read` one — see `backend/app/api/routes/agents.py`'s own docstring).
 *
 * Target environment: an isolated Compose project, never the main `testnexa`
 * stack. Container name overridable via env var, matching every other spec.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-test-mcp1-backend-1";
const PASSWORD = "E2ETestPass123!";

interface SeededOrgAdmin {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  roleId: string;
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
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-mcp1-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="MCP-1 E2E Test User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="MCP-1 E2E Test Org", slug=f"mcp1-e2e-{suffix}")
        session.add(org)
        await session.flush()
        session.add(
            OrgMembership(
                org_id=org.id,
                user_id=user.actor_id,
                status=OrgMembershipStatus.active,
                joined_at=datetime.now(UTC),
            )
        )

        # The full org_admin-equivalent set the MCP Integration page's
        # key-management panel exercises end to end: create + revoke a key
        # (ai_agent.create/.update) and list org members for the "acting on
        # behalf of" dropdown + email lookup (org_membership.read, RBAC-2).
        permission_codes = ["ai_agent.create", "ai_agent.update", "org_membership.read"]
        permissions = []
        for code in permission_codes:
            permission = (
                await session.execute(select(Permission).where(Permission.code == code))
            ).scalars().first()
            assert permission is not None, f"{code} catalog Permission must already be seeded"
            permissions.append(permission)

        role = Role(org_id=org.id, name="e2e-mcp1-org-admin-equivalent", is_system_role=False)
        session.add(role)
        await session.flush()
        for permission in permissions:
            session.add(RolePermission(role_id=role.id, permission_id=permission.id))
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "roleId": str(role.id),
        }))

asyncio.run(main())
`;

// Matches by agent_name (unique per test run) rather than agent_id, since
// the UI flow never surfaces the id directly — same net effect as
// `auth-agents.spec.ts`'s id-based cleanup, adapted for a UI-driven test.
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, AIAgent, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import Role, RoleAssignment, RolePermission
from app.models.tenancy import Organization, OrgMembership

email, user_id, org_id, role_id, agent_name = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

async def main():
    async with AsyncSessionLocal() as session:
        agent_ids = []
        if agent_name:
            result = await session.execute(select(AIAgent.actor_id).where(AIAgent.agent_name == agent_name))
            agent_ids = [str(row[0]) for row in result.all()]

        actor_ids = [user_id] + agent_ids
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(actor_ids)))
        await session.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
        await session.execute(delete(Role).where(Role.id == role_id))
        for agent_id in agent_ids:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id == agent_id))
            await session.execute(delete(Actor).where(Actor.id == agent_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        # The real login step mints a RefreshToken row (httpOnly-cookie
        # session, ADR-0003) — must go before the User delete or the FK
        # (RESTRICT) blocks it, same order auth-agents.spec.ts uses.
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.org_id == org_id))
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

function cleanup(admin: SeededOrgAdmin, agentName: string | null): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      admin.email,
      admin.userId,
      admin.orgId,
      admin.roleId,
      agentName ?? "",
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("ADR-0063 MCP Integration screen", () => {
  test("login -> nav to MCP Integration -> connect-a-client docs render -> issue key -> row Active -> revoke -> row Revoked", async ({
    page,
  }) => {
    const admin = seedOrgAdmin();
    const agentName = `MCP-1 E2E Agent ${admin.userId.slice(0, 8)}`;
    let createdAgent = false;

    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(admin.email);
      await page.getByLabel(/^password$/i).fill(admin.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${admin.orgId}$`));

      await page.getByTestId("sidebar-nav-mcp-integration").click();
      await page.waitForURL(new RegExp(`/orgs/${admin.orgId}/mcp$`));

      // Client-connection docs, real content, not a placeholder screen.
      await expect(page.getByRole("heading", { name: "Claude Code" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Codex CLI" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Cursor" })).toBeVisible();
      await expect(page.getByText(/claude mcp add --transport http testnexa/)).toBeVisible();

      // Issue a key through the live form.
      await page.getByLabel("Agent name").fill(agentName);
      await page.getByLabel("Acting on behalf of").selectOption({ label: admin.email });
      await page.getByRole("button", { name: "Issue key" }).click();

      await expect(page.getByText(/copy it now/i)).toBeVisible();
      const rawKey = await page.locator("input[readonly]").inputValue();
      expect(rawKey).toMatch(/^tnx_agent_/);
      createdAgent = true;

      // New row, Active, in the table.
      const row = page.getByRole("row", { name: new RegExp(agentName) });
      await expect(row).toBeVisible();
      await expect(row.getByText("Active")).toBeVisible();
      const revokeButton = row.getByRole("button", { name: "Revoke" });
      await expect(revokeButton).toBeVisible();

      await revokeButton.click();

      await expect(row.getByText("Revoked")).toBeVisible();
      await expect(row.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    } finally {
      cleanup(admin, createdAgent ? agentName : null);
    }
  });
});
