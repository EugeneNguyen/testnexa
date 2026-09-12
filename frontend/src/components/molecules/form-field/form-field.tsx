/**
 * Shared form-field primitive (DS-1): a labeled text/email/password input
 * (raw Bootstrap 5 markup, ADR-0042) bound to a React Hook Form field, with
 * Zod-driven error feedback.
 *
 * Location/reuse scope: `frontend/src/components/molecules/` (ADR-0043,
 * superseding ADR-0023's `components/shared/` location) — cross-screen UI
 * building blocks with duplication evidence behind them (per the DS-1
 * story), tiered on composition complexity same as every other molecule —
 * as opposed to `components/organisms/`/`components/molecules/` (generic
 * entity CRUD widgets) or page-local components under `pages/<page>/`.
 *
 * Raw Bootstrap 5 markup per ADR-0042 (AdminLTE v4 design system), replacing
 * `@coreui/react`'s `CFormLabel` + `CFormInput` + `CFormFeedback`. Expects to
 * be bound via React Hook Form's `register()` return value spread as rest
 * props — this codebase never uses RHF's `Controller`, only `register()`
 * spread (see OrgHome.tsx/AcceptInvite.tsx), so this component doesn't
 * support a Controller-style API. `error` is a plain message string
 * (typically `errors.<field>?.message` from a Zod resolver), not a FieldError
 * object. The feedback element carries `role="alert"` so screen readers
 * announce it and so it's reachable via Testing Library's
 * `getByRole("alert")`, same as this codebase's existing page-level alert
 * convention.
 *
 * Two class details that are load-bearing, not incidental:
 * - `is-invalid` on the input is what `FormField.test.tsx` asserts on
 *   (both the present and absent cases). It is also what Bootstrap's own
 *   sibling-selector CSS keys off to reveal the feedback element.
 * - `d-block` is added alongside `invalid-feedback` because the feedback is
 *   rendered **conditionally**. Bootstrap only unhides `.invalid-feedback`
 *   when it is an adjacent sibling of a `.is-invalid` control; that holds
 *   here today, but `d-block` makes the message's visibility independent of
 *   the surrounding DOM shape, so a caller wrapping the input can't silently
 *   render an invisible error.
 *
 * Composes `atoms/text-input` for the control itself (was a second,
 * independently hand-rolled `.form-control` — the same "check for an
 * existing primitive first" reuse gap `frontend/CLAUDE.md` names) — inherits
 * its `size="sm"` default, so every `FormField` is small unless a caller
 * overrides `size`.
 */
import { forwardRef, InputHTMLAttributes } from "react";
import { TextInput, TextInputSize } from "../../atoms/text-input";

export interface FormFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "size" | "value"> {
  id: string;
  label: string;
  type?: string;
  error?: string;
  /** `.form-control-sm`/`.form-control-lg`. Defaults to `"sm"`, same as `TextInput`. */
  size?: TextInputSize;
}

const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { id, label, type = "text", error, size, ...rest },
  ref,
) {
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <TextInput id={id} type={type} size={size} invalid={Boolean(error)} ref={ref} {...rest} />
      {error && (
        <div className="invalid-feedback d-block" role="alert">
          {error}
        </div>
      )}
    </div>
  );
});

export default FormField;
