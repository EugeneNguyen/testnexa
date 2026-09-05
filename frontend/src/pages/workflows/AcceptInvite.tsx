/**
 * RBAC-2 invite-acceptance screen (ADR-0017): the new-user accept path for
 * `POST /invites/{token}/accept`. Public route (no `ProtectedRoute`) — the
 * invitee has no account/credentials yet, only the raw one-time token
 * embedded in the invite link an org_admin shared out-of-band.
 *
 * `token` comes from the URL path param (`/invites/:token/accept`), matching
 * the backend route's own path shape exactly rather than a query string.
 *
 * Built with CoreUI (ADR-0012), mirrors `Signup.tsx`/`Login.tsx`'s structure.
 * React Hook Form + Zod own the form's state/validation. There is no
 * existing password-strength rule anywhere else in this codebase to mirror
 * (`Signup.tsx`'s password field has no client-side rule beyond HTML
 * `required`) — a minimum length of 8 characters plus a confirmation-match
 * check are added here as a conservative baseline, not a new strength
 * policy; the backend's own argon2 hashing has no length ceiling this could
 * conflict with.
 *
 * `useAuth().acceptInvite()` resolves `void` and updates `AuthContext` state
 * asynchronously (`access_token`/`org_context`/`orgs`), exactly the same
 * shape `login()`/`signup()` do — so, like those two screens, post-success
 * navigation is driven by the same `useEffect` watching `orgContext`/`orgs`
 * rather than a return value. This is what "lands logged in, not back at a
 * login screen" (ADR-0017) actually means on the frontend: the same
 * token-store + redirect wiring `Login`/`Signup` already use, not a bespoke
 * path.
 */
import { FormEvent, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useParams } from "react-router-dom";
import {
  CAlert,
  CButton,
  CCard,
  CCardBody,
  CCol,
  CContainer,
  CForm,
  CFormInput,
  CFormLabel,
  CRow,
} from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";

const acceptInviteSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type AcceptInviteFormValues = z.infer<typeof acceptInviteSchema>;

function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { acceptInvite, orgContext, orgs } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptInviteFormValues>({ resolver: zodResolver(acceptInviteSchema) });

  useEffect(() => {
    if (orgContext === "auto" && orgs.length > 0) {
      navigate(`/orgs/${orgs[0].id}`, { replace: true });
    } else if (orgContext === "picker") {
      navigate("/orgs/pick", { replace: true });
    }
  }, [orgContext, orgs, navigate]);

  async function onSubmit(values: AcceptInviteFormValues) {
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      await acceptInvite(token, values.password);
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
                <h1 className="mb-4 fs-4">Accept your invite</h1>
                <CForm
                  noValidate
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    void handleSubmit(onSubmit)(event);
                  }}
                >
                  <div className="mb-3">
                    <CFormLabel htmlFor="password">Password</CFormLabel>
                    <CFormInput
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      invalid={Boolean(errors.password)}
                      {...register("password")}
                    />
                  </div>
                  <div className="mb-3">
                    <CFormLabel htmlFor="confirmPassword">Confirm password</CFormLabel>
                    <CFormInput
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      invalid={Boolean(errors.confirmPassword)}
                      {...register("confirmPassword")}
                    />
                  </div>
                  {(errors.password || errors.confirmPassword || error) && (
                    <CAlert color="danger" role="alert">
                      {errors.password?.message ?? errors.confirmPassword?.message ?? error}
                    </CAlert>
                  )}
                  <CButton type="submit" color="primary" disabled={submitting} className="w-100">
                    {submitting ? "Setting password..." : "Set password"}
                  </CButton>
                </CForm>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default AcceptInvite;
