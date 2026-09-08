/**
 * `TextInput` atom — bare `.form-control` input, no label (labels are the
 * `icon-input-group` molecule's job). Per this story's Decomposition-stage
 * comment on TNX-0056, item #3.
 *
 * `forwardRef` so callers can bind it via React Hook Form's `register()`
 * spread (ADR-0009), same convention as `shared/FormField.tsx`.
 */
import { forwardRef, InputHTMLAttributes } from "react";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Adds `is-invalid` (Bootstrap's validation-feedback class). */
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid = false, className, ...rest },
  ref,
) {
  const classNames = ["form-control", invalid ? "is-invalid" : "", className]
    .filter(Boolean)
    .join(" ");

  return <input className={classNames} ref={ref} {...rest} />;
});
