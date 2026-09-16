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

/**
 * ADR-0076 Amendment 1 (2026-09-15): `data-testid` is declared and forwarded
 * explicitly. TypeScript does **not** excess-property-check a JSX attribute
 * whose name contains a hyphen, so `<Card.Body data-testid="x">` compiled
 * cleanly for as long as this atom existed and silently rendered nothing —
 * found when a test finally queried for a testid the UI Design Document had
 * documented on this element since ADR-0076 shipped. Every `data-testid` in
 * this repo is load-bearing (root `CLAUDE.md`), so an atom that drops one is a
 * hole no compile or type check can see.
 */
interface TestIdProp {
  "data-testid"?: string;
}

export interface CardProps extends TestIdProp {
  children: ReactNode;
  /** Appended to the outer `.card` element. */
  className?: string;
}

export interface CardSectionProps extends TestIdProp {
  children: ReactNode;
  /** Appended to the section's own element. */
  className?: string;
}

export interface CardTitleProps extends CardSectionProps {
  /** Heading level to render — `h3` matches this codebase's existing `EntityTable`/`Table` card-header titles. */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export function CardHeader({ children, className, "data-testid": testId }: CardSectionProps) {
  return (
    <div className={joinClassNames("card-header", className)} data-testid={testId}>
      {children}
    </div>
  );
}

export function CardBody({ children, className, "data-testid": testId }: CardSectionProps) {
  return (
    <div className={joinClassNames("card-body", className)} data-testid={testId}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className, "data-testid": testId }: CardSectionProps) {
  return (
    <div className={joinClassNames("card-footer", className)} data-testid={testId}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className, as = "h3", "data-testid": testId }: CardTitleProps) {
  return createElement(
    as,
    { className: joinClassNames("card-title", className), "data-testid": testId },
    children,
  );
}

type CardComponent = ((props: CardProps) => ReactNode) & {
  Header: typeof CardHeader;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
  Title: typeof CardTitle;
};

const CardBase = (({ children, className, "data-testid": testId }: CardProps) => (
  <div className={joinClassNames("card", className)} data-testid={testId}>
    {children}
  </div>
)) as CardComponent;

CardBase.Header = CardHeader;
CardBase.Body = CardBody;
CardBase.Footer = CardFooter;
CardBase.Title = CardTitle;

export const Card = CardBase;
