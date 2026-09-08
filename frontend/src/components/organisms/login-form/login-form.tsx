/**
 * `LoginForm` organism — composes 2× `icon-input-group`, `labeled-checkbox`,
 * and `atoms/button` (submit) inside the source's row/col split. Per this
 * story's Decomposition-stage comment on TNX-0056, item #12.
 *
 * **Presentational only** — does not call `useForm`/RHF or `useAuth`
 * itself. Field bindings (React Hook Form's `register()` return values,
 * `formState.errors`) and the submit handler are owned by the page
 * component, same as the current `pages/workflows/Login.tsx` already does;
 * this organism only renders markup and forwards events. No `useList`/
 * `useResource`/`resource.*` calls apply here — this screen has no
 * list/CRUD data, so no sibling container is needed for this component.
 */
import { FormEvent, ReactNode } from "react";
import { Button } from "../../atoms/button";
import { IconInputGroup, IconInputGroupProps } from "../../molecules/icon-input-group";
import { LabeledCheckbox, LabeledCheckboxProps } from "../../molecules/labeled-checkbox";

export interface LoginFormProps {
  /** Props for the email `icon-input-group`, typically RHF `register("email")` spread + `error`. */
  emailFieldProps: Omit<IconInputGroupProps, "id" | "label" | "icon" | "type">;
  /** Props for the password `icon-input-group`, typically RHF `register("password")` spread + `error`. */
  passwordFieldProps: Omit<IconInputGroupProps, "id" | "label" | "icon" | "type">;
  /** Props for the "Remember Me" checkbox — omit entirely to leave it uncontrolled. */
  rememberMeProps?: Omit<LabeledCheckboxProps, "id" | "label">;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting?: boolean;
  submitLabel?: string;
  /** Non-field error slot (e.g. a page-level alert) rendered above the submit row. */
  errorSlot?: ReactNode;
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

export function LoginForm({
  emailFieldProps,
  passwordFieldProps,
  rememberMeProps,
  onSubmit,
  submitting = false,
  submitLabel = "Sign In",
  errorSlot,
  className,
}: LoginFormProps) {
  return (
    <form onSubmit={onSubmit} className={className} noValidate>
      <IconInputGroup id="loginEmail" label="Email" icon="envelope" type="email" {...emailFieldProps} />
      <IconInputGroup
        id="loginPassword"
        label="Password"
        icon="lock-fill"
        type="password"
        {...passwordFieldProps}
      />
      {errorSlot}
      <div className="row">
        <div className="col-8">
          <LabeledCheckbox id="flexCheckDefault" label="Remember Me" {...rememberMeProps} />
        </div>
        <div className="col-4">
          <div className="d-grid gap-2">
            <Button type="submit" color="primary" disabled={submitting}>
              {submitting ? "Signing in..." : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
