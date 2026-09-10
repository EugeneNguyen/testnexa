import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * BRAND-1 E2E ([ADR-0048](../../docs/adr/0048-brand-1-logo-brand-system.md)) —
 * the live-browser half of TC-DS-023..030.
 *
 * **Why these live here and not in Vitest.** The Test Plan's own BRAND-1 risk
 * row names three claims jsdom structurally cannot answer, and this file exists
 * to answer exactly those:
 *
 * 1. **Theme tracking.** A unit test asserting the SVG source contains
 *    `fill="currentColor"` proves the *asset* is theme-agnostic, not that the
 *    *rendered* mark actually follows `data-bs-theme` at its mount points.
 * 2. **The sidebar cross-fade.** `AppSidebar.test.tsx` (TC-DS-027) can only see
 *    that both `<img>` slots exist with the right classes. Which one is
 *    *visible* is decided by AdminLTE's shipped CSS, and jsdom runs no CSS.
 * 3. **The favicon actually resolving** over HTTP from the running stack.
 *
 * **What the live run found, which the source-level view got wrong.** Reading
 * `fill="currentColor"` off the assets predicts the mark inherits the page's
 * text colour. It does not: an `<img src="*.svg">` loads the SVG as a separate
 * document, so `currentColor` resolves against *that* document's initial colour
 * (black), never the host page's. Measured on the isolated stack, the marks
 * painted BLACK in dark mode — invisible against a dark sidebar — while
 * `getComputedStyle(img).color` cheerfully reported `rgb(110, 168, 254)`.
 * That computed value is the element's inherited CSS `color`, which replaced
 * <img> content never consults, so asserting on it is a FALSE PASS. This is
 * root `CLAUDE.md`'s "reading source is not observing behaviour" rule landing
 * on a real defect.
 *
 * The fix (see `frontend/src/index.css`) drives the swap from the host document
 * instead, via a `data-bs-theme`-keyed `filter`. So the assertions below check
 * the *effective* rendering — the filter that is actually applied, and the
 * resulting contrast against the real background behind the mark — rather than
 * a `color` property that provably means nothing here.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at, never the main `testnexa` stack. `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls. Seeding follows
 * this directory's established convention (`shell6-org-switcher.spec.ts`).
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-brand1-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

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
    email = f"e2e-brand1-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="BRAND-1 E2E User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="BRAND-1 E2E Org", slug=f"brand1-e2e-{suffix}")
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
async function login(page: Page, user: SeededUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(new RegExp(`/orgs/${user.orgId}`));
}

/** Drive the real color-mode toggle rather than poking the attribute directly. */
async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByTestId("color-mode-toggle").click();
  await page.getByTestId(`color-mode-${theme}`).click();
  await expect(page.locator("html")).toHaveAttribute("data-bs-theme", theme);
  // Let AdminLTE's own 0.3s fade/transition settle before measuring.
  await page.waitForTimeout(400);
}

/** sRGB relative luminance of an `rgb()`/`rgba()` string, 0 (black) to 1 (white). */
function luminance(cssColor: string): number {
  const [r, g, b] = cssColor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The mark's effective paint, plus the first painted background behind it.
 * `filter` is what actually recolours the glyph (see this file's header for why
 * `color` is meaningless on a replaced <img>).
 */
async function markPaint(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element for ${sel}`);
    const cs = getComputedStyle(el);

    let node: Element | null = el;
    let background = "rgb(255, 255, 255)";
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        background = bg;
        break;
      }
      node = node.parentElement;
    }

    return {
      filter: cs.filter,
      visibility: cs.visibility,
      opacity: cs.opacity,
      src: el.getAttribute("src") ?? "",
      background,
      width: el.getBoundingClientRect().width,
    };
  }, selector);
}

const LOGIN_MARK = '[data-testid="brand-logo-mark"]';
// ADR-0054: AdminLTE's xl/xs mini-rail cross-fade pair collapses to a single
// always-visible mark — the fold/mini-rail feature they served has no Tabler
// equivalent this pass (see ADR-0054 Consequences).
const SIDEBAR_LOGO = '[data-testid="sidebar-brand-logo"]';

test.describe("BRAND-1 logo/brand system", () => {
  // This repo's specs run against a single dev-mode stack (one Vite process,
  // one uvicorn) — serial mode avoids the documented multi-worker flakiness.
  test.describe.configure({ mode: "serial" });

  let user: SeededUser;

  test.beforeAll(() => {
    user = seedUser();
  });

  test.afterAll(() => {
    cleanup(user);
  });

  test("TC-DS-023/029: the login screen renders the full brand lockup as a named link, with no 'AdminLTE' text", async ({
    page,
  }) => {
    await page.goto("/login");

    // TC-DS-029: real link, accessible name, at the auth mount.
    const brand = page.getByRole("link", { name: /TestNexa home/i });
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute("data-brand-logo-size", "full");

    // TC-DS-023: the full lockup asset, and the removed wordmark stays removed.
    await expect(page.locator(LOGIN_MARK)).toHaveAttribute("src", /logo-full/);
    await expect(page.getByText(/adminlte/i)).toHaveCount(0);
  });

  test("TC-DS-028: /favicon.svg resolves over HTTP as an SVG", async ({ page }) => {
    const response = await page.request.get("/favicon.svg");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/svg+xml");

    const body = await response.text();
    expect(body).toContain("<svg");
    // ADR-0048 §5: the favicon carries its own fixed palette — browser chrome
    // has no `data-bs-theme` for `currentColor` to inherit from.
    expect(body).not.toMatch(/fill="currentColor"/);

    // And index.html actually points at it (TC-DS-028's own <head> claim,
    // asserted here against what the server really serves).
    const html = await (await page.request.get("/")).text();
    expect(html).toMatch(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/favicon\.svg"/);
  });

  // TC-DS-026, revised 2026-09-09 (direct CTO instruction): the header
  // originally got the small mark; that's reversed — no logo in the header at
  // all, sidebar is the sole brand mount. Asserted as an explicit negative
  // over a real running page, not just the jsdom unit test, so a future
  // re-add can't silently reintroduce a duplicate mark unnoticed.
  test("TC-DS-026: the header carries no brand mark or link (sidebar is the sole mount)", async ({ page }) => {
    await login(page, user);

    // ADR-0054: the sidebar itself now carries Tabler's own `.navbar-brand`
    // class (its `<h1>` brand wrapper) — this assertion moves from "no
    // `.navbar-brand` anywhere" to "the header's own root has none," scoped
    // accordingly so it can't be satisfied by the sidebar's.
    await expect(page.locator("header.navbar .navbar-brand")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /TestNexa home/i })).toHaveCount(1);
    // The one remaining "TestNexa home" link is the sidebar's — not a second,
    // header-mounted one hiding behind a different selector.
    await expect(page.locator(SIDEBAR_LOGO).locator("..")).toHaveAttribute(
      "aria-label",
      "TestNexa home",
    );
  });

  /**
   * The Test Plan's BRAND-1 risk row, answered directly: read the mark's real
   * paint at all three mount points in both themes, and require it to actually
   * contrast with the background it sits on. Asserting a luminance flip (rather
   * than an exact colour) keeps this a legibility claim, which is what the risk
   * row is really about, and keeps it robust to token tweaks.
   */
  test("live light/dark: every brand mark tracks the theme and stays legible at all 3 mount points", async ({
    page,
  }) => {
    // --- Mount point 1: login screen (logged out, no header toggle yet). ---
    await page.goto("/login");
    await page.evaluate(() => document.documentElement.setAttribute("data-bs-theme", "light"));
    await page.waitForTimeout(200);
    const loginLight = await markPaint(page, LOGIN_MARK);
    await page.evaluate(() => document.documentElement.setAttribute("data-bs-theme", "dark"));
    await page.waitForTimeout(200);
    const loginDark = await markPaint(page, LOGIN_MARK);

    expect(loginLight.filter).toBe("brightness(0)");
    expect(loginDark.filter).toBe("brightness(0) invert(1)");

    // --- Mount point 2: sidebar. (Header dropped 2026-09-09, direct CTO
    // instruction — no longer a brand mount at all, see TC-DS-026's own
    // revised assertion above.) ---
    await login(page, user);

    await setTheme(page, "light");
    const lightPaint = await markPaint(page, SIDEBAR_LOGO);

    await setTheme(page, "dark");
    const darkPaint = await markPaint(page, SIDEBAR_LOGO);

    // ADR-0054: the sidebar now carries `data-bs-theme="dark"` directly
    // (restoring FR-SHELL-5's "sidebar stays dark independent of the
    // app-wide toggle" claim — see `app-sidebar.tsx`'s own docstring), so its
    // background is genuinely fixed-dark in BOTH app-wide theme states, not
    // just visually similar. A mark that still recoloured with `<html>`'s
    // toggle (the pre-ADR-0054 behavior this test originally asserted) would
    // now be a real legibility regression — invisible black-on-dark whenever
    // the app-wide toggle said "light" but the sidebar itself stayed dark.
    // The correct, fixed invariant is the mark stays white in both states —
    // confirmed live against a running instance before asserting it here,
    // not assumed from the CSS source.
    expect(lightPaint.filter, "sidebar filter, app-wide light").toBe("brightness(0) invert(1)");
    expect(darkPaint.filter, "sidebar filter, app-wide dark").toBe("brightness(0) invert(1)");
    expect(lightPaint.filter).toBe(darkPaint.filter);

    // The sidebar's own background stays dark in both states too (the same
    // invariant TC-SHELL-015 asserts via the `data-bs-theme` attribute
    // directly) — checked here via luminance, since that's what the glyph
    // actually needs to contrast against.
    expect(luminance(lightPaint.background), "sidebar bg, app-wide light").toBeLessThan(0.5);
    expect(luminance(darkPaint.background), "sidebar bg, app-wide dark").toBeLessThan(0.5);

    // And the glyph (now white via invert(1)) genuinely contrasts with that
    // dark background in both states — the legibility claim the source-level
    // `currentColor` assertion alone cannot make.
    expect(luminance(lightPaint.background), "sidebar contrast, app-wide light").toBeLessThan(0.3);
    expect(luminance(darkPaint.background), "sidebar contrast, app-wide dark").toBeLessThan(0.3);
  });

  // TC-DS-027 (superseded by ADR-0054, 2026-09-10): AdminLTE's mini-rail
  // logo-xl/logo-xs cross-fade (SHELL-7's `sidebar-mini`) has no Tabler
  // equivalent this pass — the fold/mini-rail feature it served is retired
  // outright (ADR-0054 Consequences), so there is no collapse state left to
  // cross-fade between. This replaces the old cross-fade test with the
  // single-mark contract that took its place: one always-visible mark, no
  // hidden sibling to ever leak into view.
  test("TC-DS-027 (superseded by ADR-0054): sidebar shows a single, always-visible brand mark", async ({ page }) => {
    await login(page, user);

    await expect(page.locator(SIDEBAR_LOGO)).toHaveCount(1);
    const paint = await markPaint(page, SIDEBAR_LOGO);
    expect(paint.visibility).toBe("visible");
    expect(Number(paint.opacity)).toBe(1);

    // The retired xl/xs pair must not have come back under any other name.
    await expect(page.locator('[data-testid="sidebar-brand-logo-xl"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sidebar-brand-logo-xs"]')).toHaveCount(0);
  });

  /**
   * Guards the exact conflict that forced this story's one deviation from
   * TC-DS-027's literal asset choice: the sidebar must show the wordmark
   * "TestNexa" EXACTLY ONCE. Putting the full lockup (which embeds its own
   * wordmark) in AdminLTE's absolutely-positioned `.brand-image-xl` slot
   * painted it a second time, on top of `.brand-text`; Tabler's own
   * `.navbar-brand` lays the mark and text out in normal inline flow
   * (ADR-0054), so this guard now also confirms no such overlap can recur
   * structurally, not only that it doesn't happen to today. Also re-confirms
   * TC-SHELL-005's own still-shipping claim that the wordmark stays visible.
   */
  test("sidebar shows the TestNexa wordmark exactly once, and keeps TC-SHELL-005's brand-text visible", async ({
    page,
  }) => {
    await login(page, user);

    const brandText = page.locator(".navbar-brand .brand-text");
    await expect(brandText).toBeVisible();
    await expect(brandText).toHaveText("TestNexa");

    // The mark slot is a decorative image mount — it must not contribute a
    // second rendered wordmark.
    await expect(page.locator(".navbar-brand")).toHaveText("TestNexa");
    await expect(page.locator(SIDEBAR_LOGO)).toHaveAttribute("alt", "");

    // Geometry: the mark must not overlap the wordmark — both sit in normal
    // inline flow under Tabler, so the mark's right edge should fall at or
    // before the text's left edge.
    const boxes = await page.evaluate(() => {
      const mark = document.querySelector('[data-testid="sidebar-brand-logo"]')!.getBoundingClientRect();
      const text = document.querySelector(".navbar-brand .brand-text")!.getBoundingClientRect();
      return { markRight: mark.right, textLeft: text.left };
    });
    expect(boxes.markRight).toBeLessThanOrEqual(boxes.textLeft);
  });
});
