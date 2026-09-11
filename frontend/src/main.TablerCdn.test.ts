import { describe, expect, it } from "vitest";
import indexHtmlSource from "../index.html?raw";
import packageJsonSource from "../package.json?raw";

/**
 * TABLER-1 / DS-4 ([ADR-0053](../../docs/adr/0053-tabler-install-phase-1-cdn.md)),
 * Test Design §44's **asset-presence class**. Covers **TC-DS-032** only.
 *
 * **One assertion updated for [ADR-0054](../../docs/adr/0054-tabler-shell-migration-phase-2.md)
 * (Phase 2, 2026-09-10):** the stylesheet's document position moved from
 * `<head>` to `<body>` (after the module script) — the deliberate cascade
 * flip ADR-0054 makes so Tabler wins conflicting selectors project-wide.
 * Every other assertion in this file (tag count, pinned version, no npm
 * package) is unchanged — Phase 2 only reordered the existing tags, it
 * didn't add, remove, or re-source either one.
 *
 * Scope, deliberately narrow: this file asserts what `frontend/index.html`
 * and `frontend/package.json` literally *declare* — that exactly the two
 * documented CDN tags exist, both pinned to `1.5.1`, and that no
 * `@tabler/core` npm dependency was added. It says **nothing** about what the
 * browser then does with those tags. The cascade-order claim (ADR-0053's
 * actual risk: two Bootstrap-family stylesheets loaded together) is a real
 * computed-style question that jsdom cannot answer at all, and lives in
 * `e2e/tests/ds4-tabler-cdn-no-regression.spec.ts` (TC-DS-031) against a real
 * browser — per Test Design §44's own split, and root `CLAUDE.md`'s standing
 * note that CSS layout/cascade claims need a live instance, not a unit test.
 *
 * Test Design §44 is explicit that this class is NOT redundant with TC-DS-031:
 * a silently bumped version, an accidentally duplicated tag, or a swap to the
 * npm package would all leave TC-DS-031 passing unchanged, because none of
 * them changes AdminLTE's rendered output.
 *
 * Location: co-located beside its subject. `index.html` is the Vite entry that
 * pairs with `src/main.tsx` (the file whose own CSS imports ADR-0053's cascade
 * decision is stated relative to), so this sits at `src/main.<Section>.test.ts`
 * per `frontend/CLAUDE.md`'s per-story multi-section naming convention.
 * Sources are pulled in with Vite's own `?raw` rather than `node:fs`, matching
 * `src/assets/brand/brandAssets.test.ts`'s precedent — this project installs no
 * `@types/node`.
 */

/** ADR-0053 Decision: the exact pinned version, CDN-hosted, jsDelivr. */
const TABLER_VERSION = "1.5.1";
const TABLER_CSS_HREF = `https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/css/tabler.min.css`;
const TABLER_JS_SRC = `https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/js/tabler.min.js`;

/** Every `@tabler/core@<something>` occurrence, whatever version it names. */
const TABLER_REF = /@tabler\/core@([^/"'\s]+)/g;

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("TC-DS-032: index.html declares exactly the documented Tabler CDN tags", () => {
  it("has the Tabler stylesheet <link>, pinned to 1.5.1, exactly once", () => {
    expect(indexHtmlSource).toContain(TABLER_CSS_HREF);
    expect(occurrences(indexHtmlSource, TABLER_CSS_HREF)).toBe(1);
  });

  it("declares that <link> as a real rel=stylesheet link element", () => {
    // Attribute order is not asserted (a formatter could reorder it); what is
    // asserted is that the href sits inside a `<link>` carrying
    // `rel="stylesheet"`, not, say, a preload hint or a bare comment.
    const linkTags = indexHtmlSource.match(/<link\b[^>]*>/g) ?? [];
    const tablerLinks = linkTags.filter((tag) => tag.includes(TABLER_CSS_HREF));
    expect(tablerLinks).toHaveLength(1);
    expect(tablerLinks[0]).toMatch(/rel=["']stylesheet["']/);
  });

  it("has the Tabler <script>, pinned to 1.5.1, exactly once", () => {
    expect(indexHtmlSource).toContain(TABLER_JS_SRC);
    expect(occurrences(indexHtmlSource, TABLER_JS_SRC)).toBe(1);

    const scriptTags = indexHtmlSource.match(/<script\b[^>]*>/g) ?? [];
    const tablerScripts = scriptTags.filter((tag) => tag.includes(TABLER_JS_SRC));
    expect(tablerScripts).toHaveLength(1);
  });

  it("references @tabler/core exactly twice, and never at any other version", () => {
    // Catches both a silently duplicated tag and a partial version bump (one
    // tag moved to a new version while the other was left behind) — neither of
    // which TC-DS-031 could ever see, since neither changes AdminLTE's output.
    const versions = [...indexHtmlSource.matchAll(TABLER_REF)].map((m) => m[1]);
    expect(versions).toHaveLength(2);
    expect(new Set(versions)).toEqual(new Set([TABLER_VERSION]));
  });

  // ADR-0054 (Phase 2) moves the stylesheet from <head> to <body>, after the
  // app's own module script — the exact move ADR-0053's own Alternatives
  // section named and deferred ("revisit this ordering choice deliberately
  // once the real migration begins moving screens onto Tabler markup"). Both
  // tags now sit in <body>, both after `/src/main.tsx` — that ordering is
  // what makes Tabler win the cascade project-wide (see `index.html`'s own
  // updated comment and ADR-0054 Decision).
  it("places both the stylesheet and the script in <body>, after the app's own module script (ADR-0054)", () => {
    const bodyStart = indexHtmlSource.indexOf("<body>");
    const bodyEnd = indexHtmlSource.indexOf("</body>");
    const appScriptAt = indexHtmlSource.indexOf("/src/main.tsx");
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    expect(appScriptAt).toBeGreaterThan(bodyStart);
    expect(appScriptAt).toBeLessThan(bodyEnd);

    const cssAt = indexHtmlSource.indexOf(TABLER_CSS_HREF);
    expect(cssAt).toBeGreaterThan(appScriptAt);
    expect(cssAt).toBeLessThan(bodyEnd);

    const jsAt = indexHtmlSource.indexOf(TABLER_JS_SRC);
    expect(jsAt).toBeGreaterThan(appScriptAt);
    expect(jsAt).toBeLessThan(bodyEnd);
  });
});

describe("TC-DS-032: package.json declares no Tabler npm package", () => {
  const pkg = JSON.parse(packageJsonSource) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("has no @tabler/core in dependencies or devDependencies", () => {
    expect(pkg.dependencies ?? {}).not.toHaveProperty("@tabler/core");
    expect(pkg.devDependencies ?? {}).not.toHaveProperty("@tabler/core");
  });

  it("has no @tabler/* package at all (CDN-only, per ADR-0053)", () => {
    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    expect(declared.filter((name) => name.startsWith("@tabler/"))).toEqual([]);
  });

  it("still declares admin-lte and bootstrap — Phase 1 removes nothing", () => {
    // ADR-0053 Consequences: AdminLTE (ADR-0042) remains the live design
    // system in full; this phase is install-only. A Tabler install that also
    // dropped either package would be a Phase 2 change smuggled in here.
    expect(pkg.dependencies ?? {}).toHaveProperty("admin-lte");
    expect(pkg.dependencies ?? {}).toHaveProperty("bootstrap");
  });
});
