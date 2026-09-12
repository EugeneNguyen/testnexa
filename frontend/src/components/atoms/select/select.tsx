/**
 * `Select` atom — bare `.form-select` (ADR-0042), same shape as
 * `atoms/text-input`. Two existing hand-rolled `<select class="form-select">`
 * blocks (`entity-form.tsx`'s enum field, `RoleAssignmentsPanel.tsx`) meet
 * `frontend/CLAUDE.md`'s 2+-use threshold for promoting a new atom rather
 * than hand-rolling a third copy.
 *
 * `forwardRef` so callers can bind it via React Hook Form's `register()`
 * spread (ADR-0009), same convention as `TextInput`.
 */
import { forwardRef, SelectHTMLAttributes } from "react";

export type SelectSize = "sm" | "default" | "lg";

const SIZE_CLASS: Record<SelectSize, string> = {
  sm: "form-select-sm",
  default: "",
  lg: "form-select-lg",
};

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Adds `is-invalid` (Bootstrap's validation-feedback class). */
  invalid?: boolean;
  /** `.form-select-sm`/`.form-select-lg`. Defaults to `"sm"` — this repo's own form-density default, same as `TextInput`. */
  size?: SelectSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, size = "sm", className, children, ...rest },
  ref,
) {
  const classNames = ["form-select", SIZE_CLASS[size], invalid ? "is-invalid" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <select className={classNames} ref={ref} {...rest}>
      {children}
    </select>
  );
});
