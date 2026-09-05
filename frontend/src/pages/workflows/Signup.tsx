/**
 * RBAC-1 bootstrap signup screen: name/email/password/org_name/org_slug form
 * calling `useAuth().signup`. Built with CoreUI (ADR-0012), mirrors
 * `Login.tsx`'s structure, including its use of the shared `FormField`
 * component (DS-1) for all 5 fields.
 *
 * Form state is React Hook Form, validation schema is Zod (ADR-0009):
 * `signupSchema` requires non-empty `name`/`email`/`password`/`orgName`,
 * plus an `orgSlug` `^[a-z0-9-]+$` format check via `.regex()` — this used
 * to be a manual `handleSubmit` guard that set the page-level `CAlert` and
 * returned before calling `signup()`; it's now a Zod refinement surfaced
 * per-field via `FormField`'s `error` prop instead.
 *
 * Deliberately NOT wired through RHF's own `handleSubmit(onSubmit)` +
 * `@hookform/resolvers/zod`'s `zodResolver` (the pattern `Login.tsx` uses):
 * `zodResolver` always resolves via a Promise internally (even in its
 * "sync" mode — see `@hookform/resolvers/zod`'s source, which wraps every
 * path in `Promise.resolve(...).then(...)`), so `formState.errors` is only
 * populated a microtask after the submit event, never synchronously within
 * it. `Signup.test.tsx`'s "rejects a slug..." and "disables the submit
 * button..." cases assert synchronously immediately after
 * `fireEvent.click()` with no `await`/`waitFor` (pre-existing, must stay
 * unmodified per DS-1's AC3) — those assertions can only pass if validation
 * and the resulting `formState`/submitting-state updates happen
 * synchronously inside the click handler, the same way the original
 * `useState`-driven implementation did. So this file validates with a
 * plain synchronous `signupSchema.safeParse(getValues())` call and RHF's
 * `setError`/`clearErrors` (both synchronous), then only calls `signup()`
 * once that passes — RHF still owns field registration/state
 * (`register()`/`formState.errors`) and Zod still owns the validation
 * rules, just orchestrated manually instead of via the resolver bridge.
 *
 * `signup()` resolves `void` and updates `AuthContext` state asynchronously
 * (same as `login()`), so post-success navigation is driven by the same
 * `useEffect` pattern watching `orgContext`/`orgs` — a fresh signup always
 * yields `org_context: "auto"` with exactly one org (this route creates
 * the org itself), so this always lands on `/orgs/{orgs[0].id}` in
 * practice, but reusing the exact same effect as `Login.tsx` (rather than a
 * hardcoded redirect) keeps the two screens' post-auth behavior identical
 * and avoids a second place this logic could drift.
 */
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CAlert, CButton, CCard, CCardBody, CCol, CContainer, CForm, CFormText, CRow } from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";
import FormField from "../../components/shared/FormField";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

const signupSchema = z.object({
  name: z.string().trim().min(1, "Your name is required."),
  email: z.string().trim().min(1, "Email is required."),
  password: z.string().min(1, "Password is required."),
  orgName: z.string().trim().min(1, "Organization name is required."),
  orgSlug: z
    .string()
    .trim()
    .min(1, "Organization slug is required.")
    .regex(SLUG_PATTERN, "Organization slug may only contain lowercase letters, numbers, and hyphens."),
});

type SignupFormValues = z.infer<typeof signupSchema>;

function Signup() {
  const { signup, orgContext, orgs } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    getValues,
    setError: setFieldError,
    clearErrors,
    formState: { errors },
  } = useForm<SignupFormValues>();

  useEffect(() => {
    if (orgContext === "auto" && orgs.length > 0) {
      navigate(`/orgs/${orgs[0].id}`, { replace: true });
    } else if (orgContext === "picker") {
      navigate("/orgs/pick", { replace: true });
    }
  }, [orgContext, orgs, navigate]);

  async function submitSignup(values: SignupFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await signup({
        name: values.name,
        email: values.email,
        password: values.password,
        org_name: values.orgName,
        org_slug: values.orgSlug,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const result = signupSchema.safeParse(getValues());
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        setFieldError(issue.path[0] as keyof SignupFormValues, {
          type: "manual",
          message: issue.message,
        });
      });
      return;
    }

    clearErrors();
    void submitSignup(result.data);
  }

  return (
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={7} lg={5}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="mb-4 fs-4">Create your organization</h1>
                <CForm noValidate onSubmit={handleFormSubmit}>
                  <FormField
                    id="name"
                    label="Your name"
                    autoComplete="name"
                    error={errors.name?.message}
                    {...register("name")}
                  />
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
                    autoComplete="new-password"
                    error={errors.password?.message}
                    {...register("password")}
                  />
                  <FormField
                    id="orgName"
                    label="Organization name"
                    error={errors.orgName?.message}
                    {...register("orgName")}
                  />
                  <div>
                    <FormField
                      id="orgSlug"
                      label="Organization slug"
                      error={errors.orgSlug?.message}
                      {...register("orgSlug")}
                    />
                    <CFormText>Lowercase letters, numbers, and hyphens only.</CFormText>
                  </div>
                  {error && (
                    <CAlert color="danger" role="alert">
                      {error}
                    </CAlert>
                  )}
                  <CButton type="submit" color="primary" disabled={submitting} className="w-100">
                    {submitting ? "Creating..." : "Create organization"}
                  </CButton>
                </CForm>
                <p className="mt-3 mb-0 text-body-secondary small">
                  Already have an account? <Link to="/login">Log in</Link>
                </p>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default Signup;
