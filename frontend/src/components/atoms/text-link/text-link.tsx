/**
 * `TextLink` atom — plain `<a>`, optionally centered. Per this story's
 * Decomposition-stage comment on TNX-0056, item #5 (covers both footer
 * links: "I forgot my password" and "Register a new membership").
 *
 * Plain `href`, not a `react-router-dom` `Link`, deliberately: the target
 * routes (`forgot-password`, `register`) aren't in this task's scope
 * (login screen only) and may not exist yet. Whether this becomes a
 * router `Link` is a Wire-up & Integration stage decision, not scaffolding.
 */
import { AnchorHTMLAttributes } from "react";

export interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Adds `text-center` — set on the source's "Register" link, not the "Forgot password" one. */
  centered?: boolean;
}

export function TextLink({ centered = false, className, children, ...rest }: TextLinkProps) {
  const classNames = [centered ? "text-center" : "", className].filter(Boolean).join(" ");

  return (
    <a className={classNames || undefined} {...rest}>
      {children}
    </a>
  );
}
