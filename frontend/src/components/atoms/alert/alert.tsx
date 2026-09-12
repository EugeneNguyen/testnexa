/**
 * `Alert` atom — Bootstrap 5 `.alert`/`.alert-*` feedback box (ADR-0042).
 * `EntityListPage.tsx` alone hand-rolled `<div class="alert alert-*"
 * role="alert">` three times (danger x2, info x1); 12 other files across the
 * codebase do the same, so this atom is the reusable primitive going
 * forward — not retrofitted into every existing call site in this pass.
 *
 * `role="alert"` is always applied, matching every existing hand-rolled
 * instance in this codebase (root `CLAUDE.md`'s a11y note: hand-written
 * markup owns its own accessible semantics — a screen reader announces
 * `role="alert"` content immediately). Per that same note, don't render more
 * than one `Alert` where a test does a singular `getByRole("alert")` lookup
 * — that's a strict-mode violation, not this atom's own bug.
 */
import { ReactNode } from "react";

export type AlertColor = "primary" | "secondary" | "success" | "danger" | "warning" | "info" | "light" | "dark";

const COLOR_CLASS: Record<AlertColor, string> = {
  primary: "alert-primary",
  secondary: "alert-secondary",
  success: "alert-success",
  danger: "alert-danger",
  warning: "alert-warning",
  info: "alert-info",
  light: "alert-light",
  dark: "alert-dark",
};

export interface AlertProps {
  color?: AlertColor;
  children: ReactNode;
  /** Appended last. */
  className?: string;
  /** Passed through — several existing hand-rolled alerts carry a load-bearing test hook. */
  "data-testid"?: string;
}

export function Alert({ color = "info", children, className, "data-testid": dataTestId }: AlertProps) {
  const classNames = ["alert", COLOR_CLASS[color], className].filter(Boolean).join(" ");

  return (
    <div className={classNames} role="alert" data-testid={dataTestId}>
      {children}
    </div>
  );
}
