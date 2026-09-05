/**
 * AUTH-1 login screen: email+password form calling `useAuth().login`.
 * Built with CoreUI (ADR-0012) — CCard/CForm/CButton/CAlert, with the
 * label+input+error markup delegated to the shared `FormField` component
 * (DS-1, `components/shared/FormField.tsx`).
 *
 * Form state/validation is React Hook Form + Zod (ADR-0009): `loginSchema`
 * requires non-empty `email`/`password`; RHF's `zodResolver` populates
 * `formState.errors`, which `FormField` renders via `CFormFeedback`.
 *
 * `login()` resolves `void` and updates `AuthContext` state asynchronously,
 * so post-success navigation is driven by a `useEffect` watching
 * `orgContext`/`orgs` rather than a return value: `org_context: "auto"` goes
 * to `/orgs/{orgs[0].id}`, `"picker"` goes to `/orgs/pick`. On failure, the
 * thrown `ApiError`'s `message` (the backend's message, or a generic
 * fallback for the 422 validation-error case — see `lib/api/auth.ts`) is
 * shown inline via the page-level `CAlert` (non-field errors stay outside
 * `FormField`'s per-field error scope). The submit button is disabled while
 * a request is in flight to avoid double-submit.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CAlert, CButton, CCard, CCardBody, CCol, CContainer, CForm, CRow } from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";
import FormField from "../../components/shared/FormField";

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
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={6} lg={4}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="mb-4 fs-4">Log in</h1>
                <CForm noValidate onSubmit={(event) => { void handleSubmit(onSubmit)(event); }}>
                  <FormField
                    id="email"
                    label="Email"
                    type="email"
                    autoComplete="email"
                    error={errors.email?.message}
                    {...register("email")}
                  />
                  <FormField
                    id="password"
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    error={errors.password?.message}
                    {...register("password")}
                  />
                  {error && (
                    <CAlert color="danger" role="alert">
                      {error}
                    </CAlert>
                  )}
                  <CButton type="submit" color="primary" disabled={submitting} className="w-100">
                    {submitting ? "Logging in..." : "Log in"}
                  </CButton>
                </CForm>
                <p className="mt-3 mb-0 text-body-secondary small">
                  New to TestNexa? <Link to="/signup">Sign up</Link>
                </p>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default Login;
