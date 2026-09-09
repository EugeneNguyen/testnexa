import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandLogo } from "../../../src/components/atoms/brand-logo";

/**
 * BRAND-1 ([ADR-0048](../../../../docs/adr/0048-brand-1-logo-brand-system.md)).
 * Covers TC-DS-023, TC-DS-024 and the `BrandLogo` half of TC-DS-029.
 *
 * These assertions replace the pre-BRAND-1 ones that checked for the accessible
 * name `"Admin LTE"` — the hardcoded `<b>Admin</b>LTE` wordmark this story
 * exists to remove. That is the change under test, not collateral damage: the
 * old expectations asserted the bug.
 *
 * Which asset a variant renders is asserted through the `src` URL rather than
 * through visible text, because the wordmark lives *inside* `logo-full.svg` (as
 * SVG `<text>`), not in the DOM. Vite resolves the `import ... from "*.svg"` to
 * a URL whose basename is the filename, which is what these match on.
 */
describe("BrandLogo (BRAND-1)", () => {
  // TC-DS-023
  it("TC-DS-023: renders no 'AdminLTE' text, and renders the full mark + wordmark lockup instead", () => {
    render(<BrandLogo href="/dashboard" />);

    // Negative half: the regression this story fixes. A partial fix (new mark
    // added, old text left beside it) would pass a positive-only check, so the
    // negative assertion is the load-bearing one here (Test Design §39).
    expect(screen.queryByText(/adminlte/i)).toBeNull();
    expect(screen.queryByText(/admin\s*lte/i)).toBeNull();

    // Positive half: the full lockup asset — mark + "**Test**Nexa" wordmark.
    const mark = screen.getByTestId("brand-logo-mark");
    expect(mark).toHaveAttribute("src", expect.stringContaining("logo-full"));
    expect(screen.getByTestId("brand-logo")).toHaveAttribute("href", "/dashboard");
  });

  it("defaults to the full lockup when `size` is omitted", () => {
    render(<BrandLogo href="/dashboard" />);

    expect(screen.getByTestId("brand-logo")).toHaveAttribute("data-brand-logo-size", "full");
  });

  // TC-DS-024
  it("TC-DS-024: size='small' renders the mark only, with no wordmark", () => {
    render(<BrandLogo href="/dashboard" size="small" />);

    const mark = screen.getByTestId("brand-logo-mark");
    expect(mark).toHaveAttribute("src", expect.stringContaining("logo-mark"));

    // Negative check on the wordmark, per Test Design §39's "don't infer
    // completeness from the positive case alone": the full lockup asset (the
    // only thing that carries a wordmark) must not be mounted at all...
    expect(mark).not.toHaveAttribute("src", expect.stringContaining("logo-full"));
    expect(screen.queryByText(/testnexa/i)).toBeNull();
    expect(screen.queryByText(/nexa/i)).toBeNull();
  });

  // TC-DS-029 (BrandLogo mounts: full + small)
  it.each([["full"], ["small"]] as const)(
    "TC-DS-029: size='%s' exposes an accessible link named 'TestNexa home'",
    (size) => {
      render(<BrandLogo href="/dashboard" size={size} />);

      const link = screen.getByRole("link", { name: /TestNexa home/i });
      expect(link).toHaveAttribute("href", "/dashboard");
    },
  );

  it("keeps the image out of the accessibility tree so the link's name is exactly the aria-label", () => {
    render(<BrandLogo href="/dashboard" />);

    // alt="" — otherwise the link would be announced as its label *plus* a
    // duplicated image name.
    expect(screen.getByTestId("brand-logo-mark")).toHaveAttribute("alt", "");
  });

  it("keeps the auth screens' centered h1 wrapper for the full variant only", () => {
    const { unmount } = render(<BrandLogo href="/dashboard" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-center", "mb-4");
    unmount();

    // The small variant mounts in the app header on every authenticated page —
    // an extra h1 there would be wrong.
    render(<BrandLogo href="/dashboard" size="small" />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("appends a caller-supplied className last", () => {
    render(<BrandLogo href="/dashboard" size="small" className="navbar-brand mb-0" />);

    expect(screen.getByTestId("brand-logo")).toHaveClass("brand-logo", "brand-logo-small", "navbar-brand", "mb-0");
  });
});
