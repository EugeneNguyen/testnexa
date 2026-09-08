/**
 * `Card` atom — bare `.card` + `.card-body` wrapper, no header/footer. Per
 * this story's Decomposition-stage comment on TNX-0056, item #7 (checked
 * against `shared/FeaturedCard.tsx` first — different shape, header+footer
 * included, not a reuse match for this screen's plain card).
 */
import { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  /** Appended to the outer `.card` element. */
  className?: string;
  /** Appended to the inner `.card-body` element (e.g. `"p-4"`). */
  bodyClassName?: string;
}

export function Card({ children, className, bodyClassName }: CardProps) {
  const cardClassNames = ["card", className].filter(Boolean).join(" ");
  const bodyClassNames = ["card-body", bodyClassName].filter(Boolean).join(" ");

  return (
    <div className={cardClassNames}>
      <div className={bodyClassNames}>{children}</div>
    </div>
  );
}
