/**
 * Featured-card primitive: a card with a header line, a
 * title+body-text+CTA-button block, and a secondary footer line.
 *
 * Raw HTML/JSX against AdminLTE/Bootstrap's CSS classes (ADR-0042) — same
 * "hand-roll the markup, keep the CSS" pattern ADR-0037 established for
 * `AppSidebar`/`AppBreadcrumb`, now the universal rule repo-wide. Class
 * names below are exactly Bootstrap's documented card markup, not
 * reconstructed from any component library's rendered output.
 *
 * Location/reuse scope: `frontend/src/components/molecules/` (ADR-0043,
 * superseding ADR-0023's `components/shared/` location) — cross-screen UI
 * building blocks with duplication evidence behind them, tiered here as a
 * molecule (a fixed composite of header/title/body/CTA/footer, no further
 * sub-composition of other custom components).
 */

export interface FeaturedCardProps {
  /** Text shown in the card header (e.g. "Featured"). */
  headerText: string;
  /** Card title (rendered as an `h5`). */
  title: string;
  /** Supporting body copy below the title. */
  bodyText: string;
  /** Label for the call-to-action button. */
  ctaLabel: string;
  /** href the call-to-action button links to. */
  ctaHref: string;
  /** Secondary text shown in the footer (e.g. a relative timestamp). */
  footerText: string;
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

export function FeaturedCard({
  headerText,
  title,
  bodyText,
  ctaLabel,
  ctaHref,
  footerText,
  className,
}: FeaturedCardProps) {
  const cardClassName = className ? `card text-center ${className}` : "card text-center";

  return (
    <div className={cardClassName}>
      <div className="card-header">{headerText}</div>
      <div className="card-body">
        <h5 className="card-title">{title}</h5>
        <p className="card-text">{bodyText}</p>
        <a href={ctaHref} className="btn btn-primary">
          {ctaLabel}
        </a>
      </div>
      <div className="card-footer text-body-secondary">{footerText}</div>
    </div>
  );
}
