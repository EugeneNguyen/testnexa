/**
 * `Card` atom — compound `.card` + `.card-header`/`.card-body`/`.card-footer`
 * primitives (AdminLTE/Bootstrap 5 markup, ADR-0042). Originally a bare
 * `.card` + auto-wrapped `.card-body` with no header/footer (checked against
 * `shared/FeaturedCard.tsx` first — different shape, header+footer included,
 * not a reuse match for this atom's *original* plain-card use case).
 *
 * Reworked into a compound component (`Card` + `Card.Header`/`Card.Body`/
 * `Card.Footer`/`Card.Title`) so every raw `div.card > div.card-header/
 * .card-body` hand-rolled block in the codebase (`EntityListPage.tsx` had
 * four, two with an `h3.card-title` inside the header) can reuse one
 * primitive instead of re-typing the same class strings. `Card` itself
 * renders only the outer `.card` wrapper now — no automatic `.card-body`,
 * since a header/footer sibling can't nest inside one. Every section is
 * opt-in and composes in any combination/order:
 *
 * ```tsx
 * <Card className="h-100">
 *   <Card.Header><Card.Title>Title</Card.Title></Card.Header>
 *   <Card.Body>...</Card.Body>
 *   <Card.Footer>...</Card.Footer>
 * </Card>
 * ```
 */
import { createElement, ReactNode } from "react";

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

export interface CardProps {
  children: ReactNode;
  /** Appended to the outer `.card` element. */
  className?: string;
}

export interface CardSectionProps {
  children: ReactNode;
  /** Appended to the section's own element. */
  className?: string;
}

export interface CardTitleProps extends CardSectionProps {
  /** Heading level to render — `h3` matches this codebase's existing `EntityTable`/`Table` card-header titles. */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export function CardHeader({ children, className }: CardSectionProps) {
  return <div className={joinClassNames("card-header", className)}>{children}</div>;
}

export function CardBody({ children, className }: CardSectionProps) {
  return <div className={joinClassNames("card-body", className)}>{children}</div>;
}

export function CardFooter({ children, className }: CardSectionProps) {
  return <div className={joinClassNames("card-footer", className)}>{children}</div>;
}

export function CardTitle({ children, className, as = "h3" }: CardTitleProps) {
  return createElement(as, { className: joinClassNames("card-title", className) }, children);
}

type CardComponent = ((props: CardProps) => ReactNode) & {
  Header: typeof CardHeader;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
  Title: typeof CardTitle;
};

const CardBase = (({ children, className }: CardProps) => (
  <div className={joinClassNames("card", className)}>{children}</div>
)) as CardComponent;

CardBase.Header = CardHeader;
CardBase.Body = CardBody;
CardBase.Footer = CardFooter;
CardBase.Title = CardTitle;

export const Card = CardBase;
