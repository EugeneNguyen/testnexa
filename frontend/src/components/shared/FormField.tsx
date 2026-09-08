/**
 * Shared form-field primitive (DS-1): a labeled CoreUI text/email/password
 * input bound to a React Hook Form field, with Zod-driven error feedback.
 *
 * Location/reuse scope: `frontend/src/components/shared/` holds cross-screen
 * UI building blocks with duplication evidence behind them (per the DS-1
 * story) — as opposed to `components/crud/` (generic entity CRUD widgets)
 * or page-local components under `pages/<page>/`. `FormField` is the only
 * component here today; don't add checkbox/select/radio variants or an
 * atoms/molecules/organisms tier without new duplication evidence (see
 * docs/user-stories/2026-09-04-design-system-component-stories.md).
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
 */
import { forwardRef, InputHTMLAttributes } from "react";

export interface FormFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "size" | "value"> {
  id: string;
  label: string;
  type?: string;
  error?: string;
}

const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { id, label, type = "text", error, ...rest },
  ref,
) {
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={error ? "form-control is-invalid" : "form-control"}
        ref={ref}
        {...rest}
      />
      {error && (
        <div className="invalid-feedback d-block" role="alert">
          {error}
        </div>
      )}
    </div>
  );
});

export default FormField;
