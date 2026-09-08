/**
 * `BrandLogo` atom — the "**Admin**LTE" bold-prefix wordmark link. Per this
 * story's Decomposition-stage comment on TNX-0056, item #6.
 *
 * Approximates AdminLTE's own `.login-logo` (centered, spaced heading) via
 * Bootstrap utilities (`h1 text-center mb-4`) since `coreui.min.css` has no
 * equivalent bespoke class — flagged in the Style-Translation stage as
 * **not pixel-verified**, needs a live-browser parity check before ship.
 */
export interface BrandLogoProps {
  href: string;
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

export function BrandLogo({ href, className }: BrandLogoProps) {
  const classNames = ["h1", "text-center", "mb-4", className].filter(Boolean).join(" ");

  return (
    <h1 className={classNames}>
      <a href={href}>
        <b>Admin</b>LTE
      </a>
    </h1>
  );
}
