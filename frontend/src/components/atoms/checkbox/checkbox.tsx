/**
 * `Checkbox` atom — bare `.form-check-input`, no label (labels are the
 * `labeled-checkbox` molecule's job). Per this story's Decomposition-stage
 * comment on TNX-0056, item #4.
 */
import { forwardRef, InputHTMLAttributes } from "react";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...rest },
  ref,
) {
  const classNames = ["form-check-input", className].filter(Boolean).join(" ");

  return <input type="checkbox" className={classNames} ref={ref} {...rest} />;
});
