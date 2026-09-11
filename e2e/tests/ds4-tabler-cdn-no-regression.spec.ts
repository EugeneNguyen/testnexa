import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * TABLER-1 / DS-4 ([ADR-0053](../../docs/adr/0053-tabler-install-phase-1-cdn.md),
 * **superseded for this file by [ADR-0054](../../docs/adr/0054-tabler-shell-migration-phase-2.md)**),
 * Test Design §44's **no-visible-regression class**. Covers **TC-DS-031**.
 *
 * **Inverted 2026-09-10 (ADR-0054, Phase 2).** ADR-0053's own claim — "Tabler
 * loads but AdminLTE keeps winning every conflicting selector" — is now FALSE
 * BY DESIGN: ADR-0054 deliberately moves Tabler's `<link>` after AdminLTE's
 * own imports in document order specifically so Tabler wins project-wide,
 * shell and unmigrated pages alike (the accepted repo-wide visual-shift
 * consequence ADR-0054's own Context section names). This file's assertions
 * are inverted to match — "as shipped" now expects TABLER's values, and the
 * old spec's own step-3 control ("move Tabler last, prove it CAN win") is
 * replaced by the mirror-image control ("move Tabler first, prove AdminLTE
 * CAN still win if it were positioned last again") — same purpose, opposite
 * direction, so a broken/unreachable CDN still fails loudly rather than
 * passing vacuously.
 *
 * The claim under test is still a real CSS cascade-order question, not a
 * source fact: AdminLTE (ADR-0042) and Tabler are both Bootstrap-5-derived
 * and both ship global, unscoped `.card`/`.btn`/`.table` rules, so whichever
 * stylesheet lands later in DOM order wins every conflicting selector
 * regardless of which markup is actually in use. jsdom/Vitest cannot answer
 * this (no layout, no real cascade), so it is answered here, against a real
 * browser. The literal-tag half of the story lives in
 * `frontend/src/main.TablerCdn.test.ts` (TC-DS-032) — see Test Design §44 for
 * why the two are not redundant.
 *
 * **Why this spec cannot pass vacuously.** A cascade-order assertion is only
 * meaningful if the thing it claims wins is actually *present and capable of
 * winning*. Each test therefore runs three measurements, not one:
 *
 *   1. **As shipped** — Tabler's CDN stylesheet loaded, in its ADR-0054
 *      position (after AdminLTE's own imports). Assert TABLER's values.
 *   2. **Tabler disabled** — AdminLTE's values reappear, proving Tabler (not
 *      some other cause) is what's winning today.
 *   3. **Tabler moved first in `<head>`** — a deliberate, in-test mutation
 *      that hands AdminLTE the cascade back. Both values MUST revert. This is
 *      the control: if the CDN were unreachable, blocked, or serving an empty
 *      file, step 1 would already have failed (nothing to revert from), so
 *      this also confirms step 1's "win" wasn't a fluke of some other rule.
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

/**
 * Re-insert Tabler's `<link>` as the FIRST child of `<head>` so AdminLTE
 * (injected later, from `src/main.tsx`) wins again — the inverse of
 * ADR-0053's own now-superseded "move last" control, matching ADR-0054's
 * flip in the opposite direction.
 */
async function moveTablerFirst(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const link of document.querySelectorAll<HTMLLinkElement>(
      'link[href*="@tabler/core"]',
    )) {
      link.disabled = false;
      document.head.insertBefore(link, document.head.firstChild);
    }
    void document.body.offsetHeight;
  });
}

/**
 * The full three-measurement assertion described in this file's header,
 * applied to whatever screen `page` is currently showing.
 */
async function assertTablerWins(page: Page, screen: string): Promise<void> {
  // Precondition: the tags ADR-0053 added are actually in this document.
  await expect(
    page.locator(`link[href*="${TABLER_CDN_MARKER}"]`),
    `${screen}: Tabler stylesheet <link> should be present`,
  ).toHaveCount(1);
  await expect(
    page.locator(`script[src*="${TABLER_CDN_MARKER}"]`),
    `${screen}: Tabler <script> should be present`,
  ).toHaveCount(1);

  // 1. As shipped (ADR-0054): Tabler wins.
  const shipped = await measure(page);
  expect(
    shipped.tablerPrimaryVar,
    `${screen}: Tabler's stylesheet must actually have loaded from the CDN — ` +
      "an unreachable/empty sheet would make every assertion below vacuous",
  ).toBe(TABLER_PRIMARY_VAR);
  expect(shipped.btnPrimaryBg, `${screen}: .btn-primary background-color`).toBe(
    TABLER_BTN_PRIMARY_BG,
  );
  expect(shipped.cardBoxShadow, `${screen}: .card box-shadow must not be AdminLTE's`).not.toBe(
    ADMINLTE_CARD_BOX_SHADOW,
  );

  // 2. Tabler disabled — AdminLTE reappears, proving Tabler (not some other
  //    rule) is what's actually winning today.
  //
  // Polled, not read once: found empirically against a live instance (this
  // repo's own "verify, don't assume" testing rule) — disabling a `<link>`
  // is not always applied synchronously by Chromium's style engine either,
  // the same async-recalc quirk the pre-existing step 3 below already
  // documented for re-enabling/re-parenting one. `--tblr-primary` (a custom
  // property read) recomputes promptly; `.btn-primary`'s own
  // `background-color` (a full cascade re-resolution) can lag a beat behind
  // it on the very same disable — confirmed on a live isolated stack, not
  // assumed from source.
  await setTablerEnabled(page, false);
  await expect
    .poll(async () => (await measure(page)).btnPrimaryBg, {
      message: `${screen}: .btn-primary bg without Tabler`,
      timeout: 10000,
    })
    .toBe(ADMINLTE_BTN_PRIMARY_BG);
  const withoutTabler = await measure(page);
  expect(
    withoutTabler.tablerPrimaryVar,
    `${screen}: --tblr-primary should be gone once the sheet is disabled`,
  ).toBe("");
  expect(withoutTabler.cardBoxShadow, `${screen}: .card box-shadow without Tabler`).toBe(
    ADMINLTE_CARD_BOX_SHADOW,
  );

  // 3. Control: hand AdminLTE the cascade back — both values MUST revert.
  //
  // Polled rather than read once: re-enabling a `disabled` stylesheet and
  // re-parenting its `<link>` is not applied synchronously by Chromium's style
  // engine, so an immediate `getComputedStyle` still reports the pre-move
  // values (found empirically on the pre-flip version of this spec).
  await moveTablerFirst(page);
  await expect
    .poll(async () => (await measure(page)).btnPrimaryBg, {
      message: `${screen}: control — with Tabler first in <head> AdminLTE should win .btn-primary again`,
      timeout: 10000,
    })
    .toBe(ADMINLTE_BTN_PRIMARY_BG);
  const adminLteWinsAgain = await measure(page);
  expect(
    adminLteWinsAgain.cardBoxShadow,
    `${screen}: control — with Tabler first in <head> AdminLTE should win .card's box-shadow again`,
  ).toBe(ADMINLTE_CARD_BOX_SHADOW);
}

test.describe("DS-4/ADR-0054 Tabler now wins the cascade project-wide (Phase 2 flip)", () => {
  test("TC-DS-031 (revised, ADR-0054): unauthenticated screen (/login)", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: /log in|sign in/i })).toBeVisible();
    await assertTablerWins(page, "/login");
  });

  test("TC-DS-031 (revised, ADR-0054): authenticated shell (org Dashboard)", async ({ page }) => {
    test.setTimeout(90000);
    const user = seedUser();

    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgId}$`), { timeout: 30000 });

      // The Tabler shell itself, not just the page body — this is the
      // screen TC-DS-031 names as its example. Selectors updated for
      // ADR-0054: `.app-sidebar`/`.app-header` (AdminLTE grid areas) →
      // `aside.navbar-vertical`/`header.navbar` (Tabler's own markup).
      await expect(page.locator("aside.navbar-vertical")).toBeVisible({ timeout: 15000 });
      await expect(page.locator("header.navbar")).toBeVisible();
      await expect(page.locator(".card").first()).toBeVisible();

      await assertTablerWins(page, "org Dashboard");
    } finally {
      cleanup(user);
    }
  });
});
