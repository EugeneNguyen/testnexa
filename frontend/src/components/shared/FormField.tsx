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
 * Composes CFormLabel + CFormInput + CFormFeedback (ADR-0012) and expects
 * to be bound via React Hook Form's `register()` return value spread as
 * rest props — this codebase never uses RHF's `Controller`, only
 * `register()` spread (see OrgHome.tsx/AcceptInvite.tsx), so this
 * component doesn't support a Controller-style API. `error` is a plain
 * message string (typically `errors.<field>?.message` from a Zod
 * resolver), not a FieldError object. The feedback element carries
 * `role="alert"` so screen readers announce it and so it's reachable via
 * Testing Library's `getByRole("alert")`, same as this codebase's existing
 * page-level `CAlert` error convention.
 */
import { forwardRef, InputHTMLAttributes } from "react";
import { CFormFeedback, CFormInput, CFormLabel } from "@coreui/react";

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
      <CFormLabel htmlFor={id}>{label}</CFormLabel>
      <CFormInput id={id} type={type} invalid={Boolean(error)} ref={ref} {...rest} />
      {error && (
        <CFormFeedback invalid role="alert">
          {error}
        </CFormFeedback>
      )}
    </div>
  );
});

export default FormField;
