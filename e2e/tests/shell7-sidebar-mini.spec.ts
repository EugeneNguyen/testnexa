import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * SHELL-7 E2E ([ADR-0044](../../docs/adr/0044-shell-7-sidebar-mini-org-crud-restructure.md)):
 * AdminLTE's `sidebar-mini` layout modifier + the org-scoped CRUD nav
 * restructure. Covers TC-SHELL-022, -023, -024 and -028 from
 * `docs/test-cases/2026-09-03-test-cases.md`.
 *
 * **Why these four live here and not in Vitest.** TC-SHELL-022/023 are CSS
 * *layout* claims — a rendered width, and a `:hover`-driven width change.
 * jsdom does no layout at all (see `AppShell.tsx`'s own docstring and root
 * `CLAUDE.md`'s "a CSS layout/height question cannot be answered from source,
 * and Vitest/RTL can't answer it either" note), so any `getBoundingClientRect()`
 * assertion at the unit layer would read 0 and prove nothing. The *class
 * application* half of TC-SHELL-022 — that `sidebar-mini` lands on `<body>` and
 * survives both directions of the collapse toggle — IS real jsdom ground and is
 * covered in `frontend/tests/components/templates/AppShell.test.tsx`; this file
 * covers the half that needs a real browser. TC-SHELL-025/026/027 (markup,
 * grouping, icons, order) are the mirror image and live entirely in
 * `frontend/tests/components/organisms/AppSidebar.test.tsx`.
 *
 * Fixture seeding follows this directory's established convention
 * (`shell-nav.spec.ts`, `org-create-second.spec.ts`): direct
 * `AsyncSessionLocal` inserts inside the target env's own backend container via
 * `docker exec -i ... python -`. One user, ONE active `OrgMembership` (so
 * `POST /auth/login` resolves `org_context: "auto"` and `Login.tsx` redirects
 * straight to `/orgs/:orgId` — no picker hop), org-wide `org_admin`.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at, never the main `testnexa` stack. `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-shell7-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

/**
 * AdminLTE's own collapsed mini-rail width, read verbatim out of the shipped
 * `admin-lte@4.9.1` stylesheet rather than hardcoded as a pixel count:
 *
 *   .sidebar-mini.sidebar-collapse .app-sidebar { min-width: 4.6rem; max-width: 4.6rem }
 *
 * Note ADR-0044's prose also mentions `3.1rem` "when the pointer isn't hovering
 * it" — that narrower value is real in the stylesheet but gated on
 * `.compact-mode`, a class this app never sets, so it never applies here. The
 * measured value on a live instance is 4.6rem in BOTH the hovering-away and
 * default collapsed states (73.59px at the default 16px root font size).
 */
const MINI_RAIL_REM = 4.6;

interface SeededUser {
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
    email = f"e2e-shell7-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="SHELL-7 E2E User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="SHELL-7 E2E Org", slug=f"shell7-e2e-{suffix}")
        session.add(org)
        await session.flush()

        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id,
                                  status=OrgMembershipStatus.active, joined_at=datetime.now(UTC)))

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

// FK-safe (child-first) delete order, mirroring shell-nav.spec.ts's cleanup.
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

function seedUser(): SeededUser {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededUser;
}

function cleanup(user: SeededUser): void {
  execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-", user.userId, user.orgId], {
    input: CLEANUP_SCRIPT,
    encoding: "utf-8",
  });
}

/** Log in and land on the org home (single membership -> `org_context: "auto"`). */
async function login(page: import("@playwright/test").Page, user: SeededUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(new RegExp(`/orgs/${user.orgId}`));
}

/** Live-measured `.app-sidebar` width, plus the rem baseline to compare against. */
async function sidebarMetrics(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".app-sidebar")!;
    const rect = el.getBoundingClientRect();
    return {
      width: rect.width,
      left: rect.left,
      rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      bodyClass: document.body.className,
    };
  });
}

/** The 3-way partition ADR-0044 specifies, keyed by the new parent group. */
const NEW_GROUPS: { testId: string; label: string; entityKeys: string[] }[] = [
  {
    testId: "sidebar-nav-group-access-control",
    label: "Access Control",
    entityKeys: ["roles", "permissions", "role-assignments", "org-memberships"],
  },
  {
    testId: "sidebar-nav-group-catalogs",
    label: "Catalogs",
    entityKeys: ["test-design-techniques", "test-levels", "test-types"],
  },
  {
    testId: "sidebar-nav-group-organization",
    label: "Organization",
    entityKeys: ["organizations"],
  },
];

test.describe("SHELL-7 sidebar-mini + org-scoped CRUD nav restructure", () => {
  // This repo's specs run against a single dev-mode stack (one Vite process,
  // one uvicorn) — serial mode avoids the documented multi-worker flakiness.
  test.describe.configure({ mode: "serial" });

  test("TC-SHELL-022/023: collapsed rail is an icon-width rail that hover-expands without changing collapse state", async ({
    page,
  }) => {
    // Playwright's 30s default is not enough here: each test pays for a
    // `docker exec` fixture seed plus several deliberate settle waits for real
    // CSS width transitions (which cannot be replaced by a state-based wait —
    // the whole point is measuring the *rendered* width after it settles).
    test.setTimeout(180_000);
    const user = seedUser();
    try {
      await page.setViewportSize({ width: 1400, height: 900 });
      await login(page, user);
      const body = page.locator("body");

      // `sidebar-mini` is a constant base modifier, present from mount.
      await expect(body).toHaveClass(/\bsidebar-mini\b/);
      await expect(body).not.toHaveClass(/\bsidebar-collapse\b/);

      const expanded = await sidebarMetrics(page);
      expect(expanded.width).toBeGreaterThan(200);

      // --- TC-SHELL-022: collapse via the real header toggler, then move the
      // pointer well away from the sidebar so no `:hover` rule applies. ---
      await page.getByTestId("sidebar-toggler").click();
      await page.mouse.move(1300, 700);
      await expect(body).toHaveClass(/\bsidebar-collapse\b/);
      await expect(body).toHaveClass(/\bsidebar-mini\b/);
      // Allow the width transition to settle before measuring.
      await page.waitForTimeout(600);

      const collapsed = await sidebarMetrics(page);
      const expectedRail = MINI_RAIL_REM * collapsed.rootFontSize;

      // The three distinct claims TC-SHELL-022 makes, asserted separately:
      // (a) it is AdminLTE's own narrow rail width...
      expect(collapsed.width).toBeGreaterThan(expectedRail - 2);
      expect(collapsed.width).toBeLessThan(expectedRail + 2);
      // (b) ...which is materially narrower than the expanded sidebar...
      expect(collapsed.width).toBeLessThan(expanded.width / 2);
      // (c) ...and NOT hidden, which is exactly what the pre-SHELL-7 collapsed
      // state did (`.sidebar-collapse:not(.sidebar-mini) .app-sidebar` sets a
      // negative margin-left of the full sidebar width, pushing it off-screen).
      expect(collapsed.width).toBeGreaterThan(0);
      expect(collapsed.left).toBeGreaterThanOrEqual(0);

      // --- TC-SHELL-023: a real pointer hover (not a click) widens it back. ---
      await page.locator(".app-sidebar").hover();
      await page.waitForTimeout(600);
      const hovered = await sidebarMetrics(page);
      expect(hovered.width).toBeGreaterThan(collapsed.width * 2);
      expect(Math.abs(hovered.width - expanded.width)).toBeLessThan(2);

      // The load-bearing half of TC-SHELL-023: hover must be PURE CSS, with no
      // state mutation. If hover-expand had been (wrongly) implemented as a
      // state-mutating handler, `sidebar-collapse` would have been cleared —
      // a width-only assertion would pass either way.
      await expect(body).toHaveClass(/\bsidebar-collapse\b/);
      await expect(body).toHaveClass(/\bsidebar-mini\b/);

      // Labels come back on hover and are hidden again when the pointer leaves.
      await expect(page.getByTestId("sidebar-nav-org-members").locator("p")).toBeVisible();

      await page.mouse.move(1300, 700);
      await page.waitForTimeout(600);
      const afterLeave = await sidebarMetrics(page);
      expect(Math.abs(afterLeave.width - collapsed.width)).toBeLessThan(2);
      await expect(body).toHaveClass(/\bsidebar-collapse\b/);

      // Round-trip: the header toggler still expands it fully.
      await page.getByTestId("sidebar-toggler").click();
      await page.waitForTimeout(600);
      await expect(body).not.toHaveClass(/\bsidebar-collapse\b/);
      const reExpanded = await sidebarMetrics(page);
      expect(Math.abs(reExpanded.width - expanded.width)).toBeLessThan(2);
    } finally {
      cleanup(user);
    }
  });

  /**
   * Locks in the behavior ADR-0044 and the Test Plan's own risk row flagged as
   * UNVERIFIED — answered by observing a real browser, not by reading
   * AdminLTE's source (root `CLAUDE.md`: "reading a library's own source to
   * predict its runtime behavior is not the same as observing it").
   *
   * Observed 2026-09-08 on a live isolated stack: **there is no hover
   * flyout.** AdminLTE's stock mini-mode flyout is JS-driven (`push-menu.ts`)
   * and this repo does not vendor that JS (ADR-0042); nothing in the shipped
   * CSS closes a `menu-open` treeview when the rail is un-hovered. So a group
   * opened while hovering STAYS open when the pointer leaves, and its children
   * render inline inside the ~4.6rem rail — still laid out, still hit-testable,
   * still navigating correctly — but visually blank, because the child `<p>`
   * labels collapse to `width: 0` and children deliberately carry no icon
   * (ADR-0044's icon-exclusivity rule). This test asserts that actual behavior
   * so a future change to it is a deliberate decision rather than a silent
   * regression.
   */
  test("SHELL-7 (ADR-0044 open point): a menu-open group stays open and stays clickable in the mini rail — no hover flyout", async ({
    page,
  }) => {
    // Playwright's 30s default is not enough here: each test pays for a
    // `docker exec` fixture seed plus several deliberate settle waits for real
    // CSS width transitions (which cannot be replaced by a state-based wait —
    // the whole point is measuring the *rendered* width after it settles).
    test.setTimeout(180_000);
    const user = seedUser();
    try {
      await page.setViewportSize({ width: 1400, height: 900 });
      await login(page, user);

      await page.getByTestId("sidebar-toggler").click();
      await page.waitForTimeout(400);

      // Hover the rail (it widens), then open a group with a real click.
      await page.locator(".app-sidebar").hover();
      await page.waitForTimeout(400);
      const group = page.getByTestId("sidebar-nav-group-access-control");
      // `> a.nav-link` specifically: the group's own toggle, not its children
      // (which are `.nav-link`s too — a bare `a.nav-link` is a strict-mode
      // violation resolving to 5 elements).
      await group.locator("> a.nav-link").click();
      await expect(group).toHaveClass(/\bmenu-open\b/);
      await expect(group.locator("> a.nav-link")).toHaveAttribute("aria-expanded", "true");

      // Move the pointer away: rail narrows, but the group stays open.
      await page.mouse.move(1300, 700);
      await page.waitForTimeout(600);
      await expect(page.locator("body")).toHaveClass(/\bsidebar-collapse\b/);
      await expect(group).toHaveClass(/\bmenu-open\b/);

      const child = page.getByTestId("sidebar-nav-admin-roles");
      const inRail = await child.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          labelWidth: parseFloat(getComputedStyle(el.querySelector("p")!).width),
          submenuDisplay: getComputedStyle(el.closest("ul.nav-treeview")!).display,
        };
      });
      // Rendered (not display:none) but narrow, and its label is collapsed.
      expect(inRail.submenuDisplay).toBe("block");
      expect(inRail.height).toBeGreaterThan(0);
      expect(inRail.width).toBeGreaterThan(0);
      expect(inRail.width).toBeLessThan(100);
      // AdminLTE's rule is `.sidebar-mini.sidebar-collapse .sidebar-menu
      // .nav-link p { width: 0 }`, but the *computed* width reads 8px, not 0 —
      // the `<p>` carries horizontal padding and `box-sizing: border-box`, so
      // the padding survives a zeroed content box. Asserting a literal "0px"
      // here failed on first run; 8px is the real collapsed value (measured),
      // against ~117px when the rail is hovered/expanded. The threshold is
      // therefore "collapsed, not merely narrow", not an exact equality.
      expect(inRail.labelWidth).toBeLessThan(16);

      // And it still navigates — functional-but-unlabeled, not broken.
      await child.click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgId}/admin/roles`));
    } finally {
      cleanup(user);
    }
  });

  /**
   * TC-SHELL-024. Mirrors TC-SHELL-004's own steps (`shell-nav.spec.ts`)
   * exactly, with `sidebar-mini` now present on `<body>` throughout — the
   * point being that every one of those pre-existing assertions still holds.
   * `sidebar-mini`'s CSS is entirely scoped `.sidebar-mini.sidebar-collapse …`,
   * and the mobile branch drives `sidebar-open` instead, so the two never
   * combine on the open path. Confirmed live rather than inferred from the
   * selectors.
   */
  test("TC-SHELL-024: sidebar-mini has no effect on the mobile off-canvas open/close mechanism", async ({
    page,
  }) => {
    // Playwright's 30s default is not enough here: each test pays for a
    // `docker exec` fixture seed plus several deliberate settle waits for real
    // CSS width transitions (which cannot be replaced by a state-based wait —
    // the whole point is measuring the *rendered* width after it settles).
    test.setTimeout(180_000);
    const user = seedUser();
    try {
      // Narrow viewport BEFORE any navigation, same reasoning as TC-SHELL-004:
      // `AppShell` resolves its initial state from `matchMedia` at mount.
      await page.setViewportSize({ width: 375, height: 812 });
      await login(page, user);

      const body = page.locator("body");
      // Mini is present on mobile too (it is a constant base class)...
      await expect(body).toHaveClass(/\bsidebar-mini\b/);
      // ...and the mobile branch's own asymmetry is unchanged: starts collapsed.
      await expect(body).toHaveClass(/\bsidebar-collapse\b/);
      await expect(body).not.toHaveClass(/\bsidebar-open\b/);

      // While closed, the sidebar is pushed fully off-screen by the mobile
      // rule — `sidebar-mini` narrows the element but does not reveal it.
      const closed = await sidebarMetrics(page);
      expect(closed.left + closed.width).toBeLessThanOrEqual(0);

      await page.getByTestId("sidebar-toggler").click();
      await expect(body).toHaveClass(/\bsidebar-open\b/);
      await expect(body).not.toHaveClass(/\bsidebar-collapse\b/);

      // Opened on mobile it is the FULL-width sidebar with real labels, not a
      // mini rail: mini's width rule requires `sidebar-collapse`, which the
      // open path clears.
      await page.waitForTimeout(600);
      const opened = await sidebarMetrics(page);
      expect(opened.left).toBe(0);
      expect(opened.width).toBeGreaterThan(closed.width * 2);
      await expect(page.getByTestId("sidebar-nav-org-members").locator("p")).toBeVisible();

      // The overlay scrim still closes it (TC-SHELL-004's own final leg).
      //
      // `position` is not optional here, and the reason is a pre-existing trap
      // this story's own work surfaced (see `e2e/CLAUDE.md`): a bare `.click()`
      // targets the element's CENTER, and the overlay spans the whole wrapper
      // (375px wide, taller than the viewport) so its center lands at x≈187 —
      // *inside* the 250px-wide open sidebar, which sits at `z-index: 1038`
      // above the overlay's `1037` and therefore intercepts the pointer.
      // Playwright then retries until the test times out, which reads exactly
      // like "the overlay is broken." It isn't: clicking any point genuinely
      // outside the sidebar fires the handler and collapses correctly.
      // Confirmed by A/B probe with and without `sidebar-mini` — identical
      // interception both ways, i.e. NOT a SHELL-7 regression.
      await page
        .locator(".app-wrapper > .sidebar-overlay")
        .click({ position: { x: 340, y: 700 } });
      await expect(body).toHaveClass(/\bsidebar-collapse\b/);
      await expect(body).not.toHaveClass(/\bsidebar-open\b/);
    } finally {
      cleanup(user);
    }
  });

  /**
   * TC-SHELL-028: every one of the 8 restructured entities still resolves to
   * the same `EntityListPage` when reached through its NEW parent group. This
   * is the routing/registry non-regression proof the markup-only assertions in
   * `AppSidebar.test.tsx` (TC-SHELL-025) structurally cannot give.
   *
   * Scope note, stated rather than implied: the per-entity *create/edit/delete*
   * permission coverage this TC also names already exists in
   * `admin2-generic-crud-ui.spec.ts` and reaches its screens by direct route
   * navigation (`page.goto`), which the restructure does not touch. The one
   * leg of that file that DID navigate through the sidebar (`test-levels`, via
   * the retired flat `Admin` group) was retargeted to `Catalogs` in this same
   * change. So no new per-entity CRUD spec is duplicated here — this test adds
   * the missing half, which is that all 8 nav paths themselves still land on
   * the right screen.
   */
  test("TC-SHELL-028: all 8 org-scoped entities still resolve to their own admin screen via their NEW parent group", async ({
    page,
  }) => {
    // Playwright's 30s default is not enough here: each test pays for a
    // `docker exec` fixture seed plus several deliberate settle waits for real
    // CSS width transitions (which cannot be replaced by a state-based wait —
    // the whole point is measuring the *rendered* width after it settles).
    test.setTimeout(180_000);
    const user = seedUser();
    try {
      await page.setViewportSize({ width: 1400, height: 900 });
      await login(page, user);
      const orgHome = `/orgs/${user.orgId}`;

      // The retired flat group must be gone, not merely accompanied.
      await expect(page.getByTestId("sidebar-nav-group-admin")).toHaveCount(0);

      let visited = 0;
      for (const group of NEW_GROUPS) {
        for (const entityKey of group.entityKeys) {
          await page.goto(orgHome);
          await expect(page.getByTestId(group.testId)).toBeVisible();

          // Expand THIS group (scoping the role lookup to the group's own
          // subtree; the label is unique within it).
          await page.getByTestId(group.testId).getByRole("link", { name: group.label }).click();

          const child = page.getByTestId(`sidebar-nav-admin-${entityKey}`);
          await expect(child).toBeVisible();
          await child.click();

          // Same `:entity` route as before the restructure.
          await page.waitForURL(new RegExp(`/orgs/${user.orgId}/admin/${entityKey}$`));
          // ...rendering the same generic admin list screen. The heading text
          // is the entity's own label, matched case-insensitively and with
          // hyphens as spaces (`role-assignments` -> "role assignments").
          const headingText = entityKey.replace(/-/g, " ");
          await expect(
            page.getByRole("heading", { name: new RegExp(`^${headingText}$`, "i") }),
          ).toBeVisible();
          visited += 1;
        }
      }

      // Completeness: all 8, not a spot-check that silently skipped one.
      expect(visited).toBe(8);
    } finally {
      cleanup(user);
    }
  });
});
