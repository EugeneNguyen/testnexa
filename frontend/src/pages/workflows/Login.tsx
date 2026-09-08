/**
 * AUTH-1 login screen: email+password form calling `useAuth().login`.
 *
 * Markup layer migrated to the AdminLTE-sourced component set (TNX-0056,
 * Decomposition/Style-Translation/Scaffold stage comments) — `AuthBoxLayout`
 * template + `LoginPanel`/`LoginForm` organisms, replacing the previous
 * CoreUI (`CCard`/`CForm`/`CButton`) markup. Per the Decomposition stage's
 * open question 4 default, this is a markup-layer swap only: React Hook
 * Form + Zod (ADR-0009) still own form state/validation here, unchanged.
 * `LoginForm`/`LoginPanel` are presentational-only (no `useForm`/`useAuth`
 * inside them) — this page is the container that wires field bindings and
 * the submit/error handling into them, per TNX-0056's Wire-up stage brief.
 *
 * `login()` resolves `void` and updates `AuthContext` state asynchronously,
 * so post-success navigation is driven by a `useEffect` watching
 * `orgContext`/`orgs` rather than a return value: `org_context: "auto"` goes
 * to `/orgs/{orgs[0].id}`, `"picker"` goes to `/orgs/pick`. On failure, the
 * thrown `ApiError`'s `message` (the backend's message, or a generic
 * fallback for the 422 validation-error case — see `lib/api/auth.ts`) is
 * shown via `LoginForm`'s `errorSlot` (non-field error, outside the
 * per-field `IconInputGroup` messages). The submit button is disabled while
 * a request is in flight to avoid double-submit.
 *
 * `socialAuthProviders` is `[]` — TestNexa has no OAuth login path (ADR-0003
 * is password + refresh-token only), so the AdminLTE source's Facebook/
 * Google buttons aren't wired to anything real. `SocialAuthPanel` renders
 * nothing for an empty array (no dead affordance shown), see the Wire-up
 * stage comment for why this isn't styled out instead.
 *
 * `forgotPasswordHref="#"` — no forgot-password screen/route exists yet in
 * this app; kept as a visible but inert placeholder link rather than
 * omitting `LoginPanel`'s required prop, flagged in the Wire-up stage
 * comment as a known gap, not silently treated as functional.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";
import { AuthBoxLayout } from "../../components/templates/auth-box-layout";
import { LoginPanel } from "../../components/organisms/login-panel";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required."),
  password: z.string().min(1, "Password is required."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function Login() {
  const { login, orgContext, orgs } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (orgContext === "auto" && orgs.length > 0) {
      navigate(`/orgs/${orgs[0].id}`, { replace: true });
    } else if (orgContext === "picker") {
      navigate("/orgs/pick", { replace: true });
    }
  }, [orgContext, orgs, navigate]);

  async function onSubmit(values: LoginFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await login(values.email, values.password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthBoxLayout logoHref="/login">
      <LoginPanel
        loginFormProps={{
          emailFieldProps: {
            autoComplete: "email",
            error: errors.email?.message,
            ...register("email"),
          },
          passwordFieldProps: {
            autoComplete: "current-password",
            error: errors.password?.message,
            ...register("password"),
          },
          onSubmit: (event) => {
            void handleSubmit(onSubmit)(event);
          },
          submitting,
          errorSlot: error ? (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          ) : undefined,
        }}
        socialAuthProviders={[]}
        forgotPasswordHref="#"
        registerHref="/signup"
      />
    </AuthBoxLayout>
  );
}

export default Login;
