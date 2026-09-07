/**
 * Shared featured-card primitive: a CoreUI card with a header line, a
 * title+body-text+CTA-button block, and a secondary footer line.
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
 *
 * Composes CoreUI's `CCard`/`CCardHeader`/`CCardBody`/`CCardTitle`/
 * `CCardText`/`CCardFooter`/`CButton` (ADR-0012) — no bespoke markup.
 */
import { CButton, CCard, CCardBody, CCardFooter, CCardHeader, CCardText, CCardTitle } from "@coreui/react";

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
  const cardClassName = className ? `text-center ${className}` : "text-center";

  return (
    <CCard className={cardClassName}>
      <CCardHeader>{headerText}</CCardHeader>
      <CCardBody>
        <CCardTitle>{title}</CCardTitle>
        <CCardText>{bodyText}</CCardText>
        <CButton color="primary" href={ctaHref}>
          {ctaLabel}
        </CButton>
      </CCardBody>
      <CCardFooter className="text-body-secondary">{footerText}</CCardFooter>
    </CCard>
  );
}
