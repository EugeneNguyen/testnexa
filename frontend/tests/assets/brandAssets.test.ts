import { describe, expect, it } from "vitest";
import faviconSource from "../../public/favicon.svg?raw";
import indexHtmlSource from "../../index.html?raw";
import logoFullSource from "../../src/assets/brand/logo-full.svg?raw";
import logoMarkSource from "../../src/assets/brand/logo-mark.svg?raw";

/**
 * BRAND-1 ([ADR-0048](../../../docs/adr/0048-brand-1-logo-brand-system.md)).
 * Covers TC-DS-025 (SVG sources are `currentColor`-only) and TC-DS-028
 * (`index.html` declares the SVG favicon link).
 *
 * These are deliberately **static source assertions**. Per Test Design §39
 * that is their exact, limited scope: they prove the *asset* is theme-agnostic,
 * NOT that the *rendered* colour tracks `data-bs-theme` at any mount point.
 * That second claim is a live-browser one (the Test Plan's own BRAND-1 risk
 * row) and is covered in `e2e/tests/brand1-logo-system.spec.ts` — which is
 * where the live run found that an `<img src="*.svg">` mount does NOT in fact
 * inherit the page's colour, something this file cannot see.
 *
 * Sources are pulled in with Vite's own `?raw` (rather than `node:fs`) so the
 * suite needs no `@types/node`, which this project does not install.
 *
 * `public/favicon.svg` is intentionally exempt from the currentColor rule:
 * browser chrome has no app theme to inherit, so ADR-0048 Decision §5 gives it
 * its own fixed two-tone palette. The last test asserts that exemption holds,
 * rather than leaving it untested.
 */
const THEME_AWARE_ASSETS = [
  ["logo-mark.svg", logoMarkSource],
  ["logo-full.svg", logoFullSource],
] as const;

/** Hex (#abc / #aabbcc / #aabbccdd) plus rgb()/rgba()/hsl()/hsla() functions. */
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/i;

/**
 * CSS named colours a hand-authored two-tone mark would realistically reach
 * for. Deliberately not the full 148-name list — matching bare words against
 * arbitrary SVG markup produces false positives (an id, a font-family name).
 */
const NAMED_COLOURS = [
  "white",
  "black",
  "red",
  "green",
  "blue",
  "grey",
  "gray",
  "silver",
  "navy",
  "teal",
  "orange",
  "purple",
  "yellow",
];

describe("BRAND-1 brand assets", () => {
  describe.each(THEME_AWARE_ASSETS)("TC-DS-025: %s", (_name, source) => {
    it("sets every fill to currentColor", () => {
      const fills = [...source.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]);

      expect(fills.length).toBeGreaterThan(0);
      for (const fill of fills) {
        expect(fill).toBe("currentColor");
      }
    });

    it("contains no hex, rgb()/rgba() or hsl()/hsla() colour literal anywhere", () => {
      expect(COLOUR_LITERAL.test(source)).toBe(false);
    });

    it("contains no named-colour value anywhere", () => {
      for (const named of NAMED_COLOURS) {
        expect(source.toLowerCase()).not.toMatch(new RegExp(`\\b${named}\\b`));
      }
    });

    it("declares no <style> block that could reintroduce a colour out of band", () => {
      expect(source).not.toMatch(/<style[\s>]/i);
    });

    it("also pins stroke to currentColor if it uses stroke at all", () => {
      for (const [, stroke] of source.matchAll(/stroke="([^"]*)"/g)) {
        expect(stroke).toBe("currentColor");
      }
    });
  });

  // TC-DS-028
  it("TC-DS-028: index.html declares the SVG favicon link", () => {
    expect(indexHtmlSource).toMatch(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/favicon\.svg"\s*\/?>/);
  });

  it("ships the favicon asset that link points at, with its own fixed palette (ADR-0048 §5)", () => {
    // The deliberate inverse of TC-DS-025: browser chrome has no `data-bs-theme`
    // to inherit, so this asset must NOT be currentColor-driven. Asserted on the
    // `fill` ATTRIBUTES rather than the raw text — the file's own comment
    // explains why it avoids currentColor, and a naive text match would trip
    // over that prose (it did, first run).
    const fills = [...faviconSource.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]);

    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill).not.toBe("currentColor");
      expect(COLOUR_LITERAL.test(fill)).toBe(true);
    }
  });
});
