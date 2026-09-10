import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * TABLER-1 / DS-4 ([ADR-0053](../../docs/adr/0053-tabler-install-phase-1-cdn.md)),
 * Test Design §44's **no-visible-regression class**. Covers **TC-DS-031**.
 *
 * The claim under test is a real CSS cascade-order question, not a source
 * fact: AdminLTE (ADR-0042) and Tabler are both Bootstrap-5-derived and both
 * ship global, unscoped `.card`/`.btn`/`.table` rules, so whichever stylesheet
 * lands later in DOM order wins every conflicting selector regardless of which
 * markup is actually in use. ADR-0053 places Tabler's `<link>` first in
 * `index.html` *specifically* so AdminLTE's own imports (injected later, from
 * `src/main.tsx`) keep winning — and ADR-0053 explicitly says not to trust
 * that ordering by inspection alone. jsdom/Vitest cannot answer this (no
 * layout, no real cascade), so it is answered here, against a real browser.
 * The literal-tag half of the story lives in `frontend/src/main.TablerCdn.test.ts`
 * (TC-DS-032) — see Test Design §44 for why the two are not redundant.
 *
 * **Why this spec cannot pass vacuously.** A no-regression assertion is only
 * meaningful if the thing it claims is harmless is actually *present and
 * capable of doing harm*. Each test therefore runs three measurements, not one:
 *
 *   1. **As shipped** — Tabler's CDN stylesheet loaded, in its ADR-0053
 *      position. Assert AdminLTE's values.
 *   2. **Tabler disabled** — same values, proving Tabler contributes nothing
 *      to what is rendered today (the literal "unchanged versus without them"
 *      wording of TC-DS-031, measured rather than inferred).
 *   3. **Tabler moved last in `<head>`** — a deliberate, in-test mutation that
 *      hands Tabler the cascade. Both values MUST change. This is the control:
 *      if the CDN were unreachable, blocked, or serving an empty file, step 3
 *      would produce no change and the test fails loudly instead of silently
 *      "passing" on a stylesheet that never loaded.
 *
 * Step 3 also documents, in executable form, exactly what Phase 2 of the
 * AdminLTE -> Tabler migration will look like the moment the ordering flips.
 *
 * Fixture seeding follows this directory's established convention
 * (`shell-nav.spec.ts`, `org-create-second.spec.ts`): direct `AsyncSessionLocal`
 * inserts inside the target env's own backend container via `docker exec`.
 * A single active `OrgMembership` is what makes `POST /auth/login` resolve
 * `org_context: "auto"`, so `Login.tsx` lands straight on the org Dashboard
 * without a picker step; the org-wide `org_admin` `RoleAssignment` is what
 * makes that Dashboard render its create-Project affordance, i.e. the
 * `.btn-primary` this test measures.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-tabler-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

/** ADR-0053's pinned version — kept in sync with TC-DS-032's own constant. */
const TABLER_CDN_MARKER = "@tabler/core@1.5.1";

/**
 * AdminLTE's own rendered values, read off a live instance of this branch
 * (both `/login` and the org Dashboard produce these identically, in
 * `data-bs-theme="light"`, which is this app's default).
 *
 * `.card`'s two-layer shadow is AdminLTE's — stock Bootstrap 5 gives `.card`
 * no `box-shadow` at all — so this value doubles as proof AdminLTE's sheet
 * (not merely Bootstrap's) is the one winning.
 */
const ADMINLTE_CARD_BOX_SHADOW =
  "rgba(33, 37, 41, 0.125) 0px 0px 1px 0px, rgba(33, 37, 41, 0.2) 0px 1px 3px 0px";
/** Bootstrap/AdminLTE `$primary` — `#0d6efd`. */
const ADMINLTE_BTN_PRIMARY_BG = "rgb(13, 110, 253)";
/** Tabler's own `$primary` — `#066fd1`. Deliberately a different colour. */
const TABLER_BTN_PRIMARY_BG = "rgb(6, 111, 209)";
/** Tabler's `--tblr-primary` custom property, as served by the CDN build. */
const TABLER_PRIMARY_VAR = "#066fd1";

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
    email = f"e2e-ds4-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="DS-4 E2E User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="DS-4 E2E Org", slug=f"ds4-e2e-{suffix}")
        session.add(org)
        await session.flush()

        # Exactly ONE active membership -> login resolves org_context "auto".
        session.add(OrgMembership(
            org_id=org.id,
            user_id=user.actor_id,
            status=OrgMembershipStatus.active,
            joined_at=datetime.now(UTC),
        ))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(
            actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id,
        ))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
        }))

asyncio.run(main())
`;

/**
 * FK-safe delete order, mirroring `shell-nav.spec.ts`. `refresh_token` goes
 * first because this spec's account genuinely logs in, which mints one
 * (`RESTRICT` FK back to the user) — see `backend/CLAUDE.md`'s note on the
 * logged-in-account cleanup order differing from the seed-only one.
 */
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
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
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

interface Measurement {
  cardBoxShadow: string;
  btnPrimaryBg: string;
  tablerPrimaryVar: string;
}

/** Read the two TC-DS-031 computed values plus Tabler's own liveness marker. */
async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(() => {
    const card = document.querySelector(".card");
    const btn = document.querySelector(".btn-primary");
    if (!card) throw new Error("no .card on this screen — wrong page or a markup regression");
    if (!btn) throw new Error("no .btn-primary on this screen — wrong page or a markup regression");
    return {
      cardBoxShadow: getComputedStyle(card).boxShadow,
      btnPrimaryBg: getComputedStyle(btn).backgroundColor,
      tablerPrimaryVar: getComputedStyle(document.documentElement)
        .getPropertyValue("--tblr-primary")
        .trim(),
    };
  });
}

/** Flip every Tabler `<link>` on/off, then force a style recalculation. */
async function setTablerEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((on) => {
    for (const link of document.querySelectorAll<HTMLLinkElement>(
      'link[href*="@tabler/core"]',
    )) {
      link.disabled = !on;
    }
    void document.body.offsetHeight;
  }, enabled);
}

/** Re-append Tabler's `<link>` as the LAST child of `<head>` so it wins. */
async function moveTablerLast(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const link of document.querySelectorAll<HTMLLinkElement>(
      'link[href*="@tabler/core"]',
    )) {
      link.disabled = false;
      document.head.appendChild(link);
    }
    void document.body.offsetHeight;
  });
}

/**
 * The full three-measurement assertion described in this file's header,
 * applied to whatever screen `page` is currently showing.
 */
async function assertAdminLteStillWins(page: Page, screen: string): Promise<void> {
  // Precondition: the tags ADR-0053 added are actually in this document.
  await expect(
    page.locator(`link[href*="${TABLER_CDN_MARKER}"]`),
    `${screen}: Tabler stylesheet <link> should be present`,
  ).toHaveCount(1);
  await expect(
    page.locator(`script[src*="${TABLER_CDN_MARKER}"]`),
    `${screen}: Tabler <script> should be present`,
  ).toHaveCount(1);

  // 1. As shipped.
  const shipped = await measure(page);
  expect(
    shipped.tablerPrimaryVar,
    `${screen}: Tabler's stylesheet must actually have loaded from the CDN — ` +
      "an unreachable/empty sheet would make every assertion below vacuous",
  ).toBe(TABLER_PRIMARY_VAR);
  expect(shipped.cardBoxShadow, `${screen}: .card box-shadow`).toBe(ADMINLTE_CARD_BOX_SHADOW);
  expect(shipped.btnPrimaryBg, `${screen}: .btn-primary background-color`).toBe(
    ADMINLTE_BTN_PRIMARY_BG,
  );
  expect(shipped.btnPrimaryBg, `${screen}: .btn-primary must not be Tabler's primary`).not.toBe(
    TABLER_BTN_PRIMARY_BG,
  );

  // 2. Tabler disabled — the literal "versus without them" comparison.
  await setTablerEnabled(page, false);
  const withoutTabler = await measure(page);
  expect(
    withoutTabler.tablerPrimaryVar,
    `${screen}: --tblr-primary should be gone once the sheet is disabled`,
  ).toBe("");
  expect(withoutTabler.cardBoxShadow, `${screen}: .card box-shadow without Tabler`).toBe(
    shipped.cardBoxShadow,
  );
  expect(withoutTabler.btnPrimaryBg, `${screen}: .btn-primary bg without Tabler`).toBe(
    shipped.btnPrimaryBg,
  );

  // 3. Control: hand Tabler the cascade — both values MUST change.
  //
  // Polled rather than read once: re-enabling a `disabled` stylesheet and
  // re-parenting its `<link>` is not applied synchronously by Chromium's style
  // engine, so an immediate `getComputedStyle` still reports the pre-move
  // values. (Found empirically — a single read here failed on both screens
  // with the *old* value, which reads exactly like "the control doesn't work"
  // rather than "the control hasn't taken effect yet".)
  await moveTablerLast(page);
  await expect
    .poll(async () => (await measure(page)).btnPrimaryBg, {
      message: `${screen}: control — with Tabler last in <head> it should win .btn-primary`,
      timeout: 10000,
    })
    .toBe(TABLER_BTN_PRIMARY_BG);
  const tablerWins = await measure(page);
  expect(
    tablerWins.cardBoxShadow,
    `${screen}: control — with Tabler last in <head> it should win .card's box-shadow`,
  ).not.toBe(ADMINLTE_CARD_BOX_SHADOW);
}

test.describe("DS-4 Tabler CDN install (Phase 1) leaves AdminLTE's rendered styles unchanged", () => {
  test("TC-DS-031: unauthenticated screen (/login)", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: /log in|sign in/i })).toBeVisible();
    await assertAdminLteStillWins(page, "/login");
  });

  test("TC-DS-031: authenticated AdminLTE shell (org Dashboard)", async ({ page }) => {
    test.setTimeout(90000);
    const user = seedUser();

    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgId}$`), { timeout: 30000 });

      // The AdminLTE shell itself, not just the page body — this is the
      // screen TC-DS-031 names as its example.
      await expect(page.locator(".app-sidebar")).toBeVisible({ timeout: 15000 });
      await expect(page.locator(".app-header")).toBeVisible();
      await expect(page.locator(".card").first()).toBeVisible();

      await assertAdminLteStillWins(page, "org Dashboard");
    } finally {
      cleanup(user);
    }
  });
});
