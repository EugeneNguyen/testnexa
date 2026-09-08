/**
 * `Button` atom — Bootstrap 5 buttons, as shipped inside AdminLTE v4's own
 * stylesheet (ADR-0042; originally modelled on CoreUI's Buttons page under
 * ADR-0012).
 *
 * Raw HTML/JSX against the design system's Bootstrap-family classes (never a
 * component-library `CButton`/equivalent import) — the "hand-roll the markup,
 * keep the CSS" pattern ADR-0037 established for `AppSidebar`/`AppBreadcrumb`
 * and `FeaturedCard`, which ADR-0042 has since made the repo-wide rule. Class
 * names below were copied verbatim from the source doc page's own rendered
 * `docs-example` markup (fetched via `curl`, not a screenshot/WebFetch — see
 * this story's Decomposition-stage comment for why), not reconstructed from
 * memory.
 *
 * Two ADR-0042 notes:
 * - The toggle hook is now `data-bs-toggle="button"` (was
 *   `data-coreui-toggle`), matching Bootstrap's own attribute namespace.
 *   Nothing in this app reads it — no Bootstrap JS is loaded (ADR-0042
 *   reimplements interactive behavior in React) — so it is markup-parity
 *   only; `aria-pressed` is what actually conveys the state.
 * - **`ghost` has no Bootstrap/AdminLTE equivalent.** `btn-ghost-*` was a
 *   CoreUI-only variant. The prop and its classes are kept (removing a public
 *   prop from a shared atom is a breaking API change, out of scope for a
 *   design-system swap, and `Button.test.tsx` asserts on `btn-ghost-info`),
 *   and `frontend/src/index.css` now carries a small compatibility rule set
 *   that reproduces the ghost look on top of Bootstrap's own `--bs-btn-*`
 *   variables so it still tracks the active light/dark theme.
 *
 * `atoms/` is a new tier in this repo (previously only flat `shared/`/`crud/`
 * dirs existed) — first component built against it, per this story's
 * Decomposition-stage open question 1 (default: build the tier now).
 *
 * Covers the doc page's Base class / Variants / Outline / Ghost / Sizes /
 * Shapes / Disabled state / Toggle states sections as props on one
 * component, and the Button tags section as the `as` prop (`button` | `a` |
 * `input`). "With icons" (composing a caller-supplied `@coreui/icons-react`
 * `CIcon` as a child) and Block buttons (the `ButtonStack` molecule) are
 * deliberately NOT reimplemented here — they compose this atom rather than
 * extend it.
 */
import { MouseEvent, ReactNode, useState } from "react";

export type ButtonColor =
  | "primary"
  | "secondary"
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "link"
  | "default";
export type ButtonSize = "sm" | "default" | "lg";
export type ButtonShape = "default" | "pill" | "square";
export type ButtonAs = "button" | "a" | "input";
export type ButtonType = "button" | "submit" | "reset";

const COLOR_CLASS: Record<ButtonColor, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  success: "btn-success",
  danger: "btn-danger",
  warning: "btn-warning",
  info: "btn-info",
  link: "btn-link",
  default: "",
};

const OUTLINE_COLOR_CLASS: Record<ButtonColor, string> = {
  primary: "btn-outline-primary",
  secondary: "btn-outline-secondary",
  success: "btn-outline-success",
  danger: "btn-outline-danger",
  warning: "btn-outline-warning",
  info: "btn-outline-info",
  link: "btn-outline",
  default: "btn-outline",
};

const GHOST_COLOR_CLASS: Record<ButtonColor, string> = {
  primary: "btn-ghost-primary",
  secondary: "btn-ghost-secondary",
  success: "btn-ghost-success",
  danger: "btn-ghost-danger",
  warning: "btn-ghost-warning",
  info: "btn-ghost-info",
  link: "btn-ghost",
  default: "btn-ghost",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "btn-sm",
  default: "",
  lg: "btn-lg",
};

const SHAPE_CLASS: Record<ButtonShape, string> = {
  default: "",
  pill: "rounded-pill",
  square: "rounded-0",
};

export interface ButtonProps {
  /** Polymorphic tag — native `<button>` (default), `<a role="button">`, or `<input type="...">`. */
  as?: ButtonAs;
  color?: ButtonColor;
  /** Outline variant (`.btn-outline`/`.btn-outline-*`). Mutually exclusive with `ghost`. */
  outline?: boolean;
  /** Ghost variant (`.btn-ghost`/`.btn-ghost-*`). Mutually exclusive with `outline`. */
  ghost?: boolean;
  size?: ButtonSize;
  shape?: ButtonShape;
  /** Forces the `.active` class regardless of `toggle` state. */
  active?: boolean;
  disabled?: boolean;
  /** Enables toggle-button behavior (`data-bs-toggle="button"` + `aria-pressed`). */
  toggle?: boolean;
  /** Controlled pressed state for a toggle button; omit to let the button manage its own state. */
  pressed?: boolean;
  /** Fires after a toggle button's pressed state changes (only relevant when `toggle` is set). */
  onToggle?: (pressed: boolean) => void;
  onClick?: (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement | HTMLInputElement>) => void;
  /** Used when `as` is `"button"` or `"input"`. */
  type?: ButtonType;
  /** Used when `as="a"`. */
  href?: string;
  /** Used when `as="input"` (input buttons show `value` instead of children). */
  value?: string;
  children?: ReactNode;
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
  /** Passed through to the underlying element — covers dropdown-toggle triggers (`aria-expanded`), labeling, and test hooks. */
  "aria-expanded"?: boolean;
  "aria-label"?: string;
  title?: string;
  id?: string;
  "data-testid"?: string;
}

export function Button({
  as = "button",
  color = "default",
  outline = false,
  ghost = false,
  size = "default",
  shape = "default",
  active = false,
  disabled = false,
  toggle = false,
  pressed,
  onToggle,
  onClick,
  type = "button",
  href,
  value,
  children,
  className,
  "aria-expanded": ariaExpanded,
  "aria-label": ariaLabel,
  title,
  id,
  "data-testid": dataTestId,
}: ButtonProps) {
  const [internalPressed, setInternalPressed] = useState(false);
  const isPressed = pressed ?? internalPressed;
  const isAnchorDisabled = as === "a" && disabled;
  const passthroughAttrs = {
    "aria-expanded": ariaExpanded,
    "aria-label": ariaLabel,
    title,
    id,
    "data-testid": dataTestId,
  };

  function handleClick(event: MouseEvent<HTMLButtonElement | HTMLAnchorElement | HTMLInputElement>) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (toggle) {
      const nextPressed = !isPressed;
      if (pressed === undefined) {
        setInternalPressed(nextPressed);
      }
      onToggle?.(nextPressed);
    }
    onClick?.(event);
  }

  const colorClass = outline ? OUTLINE_COLOR_CLASS[color] : ghost ? GHOST_COLOR_CLASS[color] : COLOR_CLASS[color];
  const classNames = [
    "btn",
    colorClass,
    SIZE_CLASS[size],
    SHAPE_CLASS[shape],
    active || isPressed ? "active" : "",
    isAnchorDisabled ? "disabled" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (as === "a") {
    return (
      <a
        href={href}
        role="button"
        className={classNames}
        aria-disabled={isAnchorDisabled || undefined}
        tabIndex={isAnchorDisabled ? -1 : undefined}
        aria-pressed={toggle ? isPressed : undefined}
        data-bs-toggle={toggle ? "button" : undefined}
        onClick={handleClick}
        {...passthroughAttrs}
      >
        {children}
      </a>
    );
  }

  if (as === "input") {
    return (
      <input
        type={type}
        value={value}
        className={classNames}
        disabled={disabled}
        onClick={handleClick}
        {...passthroughAttrs}
      />
    );
  }

  return (
    <button
      type={type}
      className={classNames}
      disabled={disabled}
      aria-pressed={toggle ? isPressed : undefined}
      data-bs-toggle={toggle ? "button" : undefined}
      onClick={handleClick}
      {...passthroughAttrs}
    >
      {children}
    </button>
  );
}
