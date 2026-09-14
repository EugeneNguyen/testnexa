/**
 * `Textarea` atom — bare `.form-control` textarea, no label (labels are the
 * caller's job, same split `TextInput` already uses). 2026-09-15,
 * live-manual-test feedback: backs `FieldType: "text"` fields on `EntityForm`
 * (a nullable, unbounded `Text` column, as opposed to `"string"`'s
 * length-limited `String`) — a single-line `TextInput` is the wrong control
 * for a field with no length limit.
 *
 * `forwardRef` so callers can bind it via React Hook Form's `register()`
 * spread (ADR-0009), same convention as `TextInput`.
 */
import { forwardRef, TextareaHTMLAttributes } from "react";

export type TextareaSize = "sm" | "default" | "lg";

const SIZE_CLASS: Record<TextareaSize, string> = {
  sm: "form-control-sm",
  default: "",
  lg: "form-control-lg",
};

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Adds `is-invalid` (Bootstrap's validation-feedback class). */
  invalid?: boolean;
  /** `.form-control-sm`/`.form-control-lg`. Defaults to `"sm"` — matches `TextInput`'s own form-density default. */
  size?: TextareaSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, size = "sm", className, rows = 3, ...rest },
  ref,
) {
  const classNames = ["form-control", SIZE_CLASS[size], invalid ? "is-invalid" : "", className]
    .filter(Boolean)
    .join(" ");

  return <textarea className={classNames} rows={rows} ref={ref} {...rest} />;
});
