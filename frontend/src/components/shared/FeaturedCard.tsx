/**
 * Shared featured-card primitive: a card with a header line, a
 * title+body-text+CTA-button block, and a secondary footer line.
 *
 * Raw HTML/JSX against CoreUI's Bootstrap-family CSS classes
 * (`coreui.min.css`, imported once in `main.tsx`) rather than
 * `@coreui/react` components — same "hand-roll the markup, keep the CSS"
 * pattern ADR-0037 established for `AppSidebar`/`AppBreadcrumb`. Class
 * names below are exactly Bootstrap's documented card markup (the
 * originating task's own source HTML), not reconstructed from
 * `@coreui/react`'s rendered output.
 *
 * Location/reuse scope: same convention as `FormField` (see its own
 * doc comment) — `frontend/src/components/shared/` holds cross-screen UI
 * building blocks with duplication evidence behind them, not a full
 * atoms/molecules/organisms tier. Per DS-1
 * (docs/user-stories/2026-09-04-design-system-component-stories.md) and the
 * business case it implements, that tiering is deliberately out of scope
 * until more screens show duplication beyond what's evidenced — this
 * component is a single flat file for the same reason `FormField` is,
 * not split into atom/molecule/organism sub-directories.
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
