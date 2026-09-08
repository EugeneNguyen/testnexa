/**
 * `IconInputGroup` molecule — composes `atoms/text-input` + `atoms/icon`
 * inside a `.input-group`, with a visually-hidden `<label>`. Dedupes the
 * source's 2 near-identical fields (email, password) into one parametrized
 * component. Per this story's Decomposition-stage comment on TNX-0056,
 * item #8.
 *
 * `forwardRef` to the underlying `<input>` so callers can bind it via React
 * Hook Form's `register()` spread (ADR-0009) — same convention as
 * `shared/FormField.tsx`.
 *
 * `error` was added during the Wire-up stage: the source AdminLTE markup has
 * no validation-error UI to copy (its example page never fails validation),
 * but the current `Login.tsx` needs Zod's per-field messages surfaced —
 * `FormField`'s job today. Uses Bootstrap's own documented `.invalid-feedback`
 * pattern rather than inventing one; `.has-validation` on the `.input-group`
 * wrapper is Bootstrap's own required class for the sibling-selector CSS to
 * target the right control when a group has more than one form control
 * (the input + the icon slot) — see Bootstrap's Validation docs, "if you
 * have an input group with a validation state".
 */
import { forwardRef, InputHTMLAttributes } from "react";
import { Icon } from "../../atoms/icon";
import { TextInput } from "../../atoms/text-input";

export interface IconInputGroupProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "size"> {
  id: string;
  /** Visually-hidden `<label>` text — still required for accessible name. */
  label: string;
  /** Bootstrap Icons name suffix shown in the `.input-group-text` slot, e.g. "envelope". */
  icon: string;
  /** Validation message (e.g. Zod's `errors.email?.message`) — also sets `invalid`. */
  error?: string;
  /** Appended last, to the outer `.input-group` wrapper. */
  className?: string;
}

export const IconInputGroup = forwardRef<HTMLInputElement, IconInputGroupProps>(
  function IconInputGroup({ id, label, icon, error, className, ...rest }, ref) {
    const invalid = Boolean(error);
    const wrapperClassNames = ["input-group", "mb-3", invalid ? "has-validation" : "", className]
      .filter(Boolean)
      .join(" ");

    return (
      <>
        <label className="visually-hidden" htmlFor={id}>
          {label}
        </label>
        <div className={wrapperClassNames}>
          <TextInput id={id} invalid={invalid} ref={ref} {...rest} />
          <div className="input-group-text">
            <Icon name={icon} />
          </div>
          {error && (
            <div className="invalid-feedback" role="alert">
              {error}
            </div>
          )}
        </div>
      </>
    );
  },
);
