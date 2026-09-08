/**
 * `LabeledCheckbox` molecule — composes `atoms/checkbox` + a `.form-check-label`.
 * Per this story's Decomposition-stage comment on TNX-0056, item #9
 * ("Remember Me").
 */
import { forwardRef, InputHTMLAttributes } from "react";
import { Checkbox } from "../../atoms/checkbox";

export interface LabeledCheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "size"> {
  id: string;
  label: string;
  /** Appended last, to the outer `.form-check` wrapper. */
  className?: string;
}

export const LabeledCheckbox = forwardRef<HTMLInputElement, LabeledCheckboxProps>(
  function LabeledCheckbox({ id, label, className, ...rest }, ref) {
    const wrapperClassNames = ["form-check", className].filter(Boolean).join(" ");

    return (
      <div className={wrapperClassNames}>
        <Checkbox id={id} ref={ref} {...rest} />
        <label className="form-check-label" htmlFor={id}>
          {label}
        </label>
      </div>
    );
  },
);
