/**
 * `BrandLogo` atom — TestNexa's checkmark-in-shield brand lockup, as a link.
 *
 * ## BRAND-1 / ADR-0048
 *
 * This atom previously rendered a hardcoded `<b>Admin</b>LTE` wordmark — text
 * lifted verbatim from an AdminLTE demo screen during the ADR-0042 migration
 * and never corrected. It shipped that way on the login and signup screens.
 * ADR-0048 replaces it with the real brand assets and adds a `size` prop so
 * one atom serves both the auth screens (full lockup) and the header (mark
 * only), rather than two near-duplicate components.
 *
 * Both assets are `fill="currentColor"` throughout (ADR-0048 Decision §2), so
 * a single file serves light and dark mode rather than a per-theme pair.
 *
 * ## Accessibility
 *
 * Every variant is a real `<a href>` with `aria-label="TestNexa home"`
 * (ADR-0048 Decision §9) — the `size="small"` variant conveys no readable text
 * of its own, so without the label it would be an unnamed link. The image
 * carries `alt=""` so the link's accessible name is exactly that label, not
 * the label plus a duplicated image name.
 */
import logoFullUrl from "../../../assets/brand/logo-full.svg";
import logoMarkUrl from "../../../assets/brand/logo-mark.svg";

export type BrandLogoSize = "full" | "small";

export interface BrandLogoProps {
  href: string;
  /**
   * `"full"` (default) renders the icon + "**Test**Nexa" wordmark lockup, used
   * by the auth screens via `AuthBoxLayout`. `"small"` renders the icon only,
   * used by `AppHeader` — the header is a fixed-height single row, not a
   * widening rail, so it has no full/small state to swap (ADR-0048 §7).
   */
  size?: BrandLogoSize;
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

const ASSETS: Record<BrandLogoSize, { url: string; height: string }> = {
  full: { url: logoFullUrl, height: "2.5rem" },
  small: { url: logoMarkUrl, height: "2rem" },
};

export function BrandLogo({ href, size = "full", className }: BrandLogoProps) {
  const { url, height } = ASSETS[size];
  const classNames = ["brand-logo", `brand-logo-${size}`, className].filter(Boolean).join(" ");

  const link = (
    <a
      href={href}
      className={classNames}
      aria-label="TestNexa home"
      data-testid="brand-logo"
      data-brand-logo-size={size}
    >
      <img src={url} alt="" data-testid="brand-logo-mark" style={{ height, width: "auto" }} />
    </a>
  );

  // The `full` variant keeps the centered `h1` wrapper the pre-BRAND-1 atom
  // used (AdminLTE's own `.login-logo` equivalent, approximated with Bootstrap
  // utilities). Only the wordmark inside it changed, so the auth screens'
  // heading semantics and spacing are preserved rather than quietly dropped —
  // TC-DS-030 asks for exactly that behaviour preservation. The `small`
  // variant deliberately gets no heading: it mounts in the app header on every
  // authenticated page, where an extra `h1` would be wrong.
  if (size === "small") {
    return link;
  }

  return <h1 className="h1 text-center mb-4">{link}</h1>;
}
