/**
 * RBAC-1 bootstrap signup screen: name/email/password/org_name/org_slug form
 * calling `useAuth().signup`. Built with CoreUI (ADR-0012), mirrors
 * `Login.tsx`'s structure exactly.
 *
 * `signup()` resolves `void` and updates `AuthContext` state asynchronously
 * (same as `login()`), so post-success navigation is driven by the same
 * `useEffect` pattern watching `orgContext`/`orgs` — a fresh signup always
 * yields `org_context: "auto"` with exactly one org (this route creates
 * the org itself), so this always lands on `/orgs/{orgs[0].id}` in
 * practice, but reusing the exact same effect as `Login.tsx` (rather than a
 * hardcoded redirect) keeps the two screens' post-auth behavior identical
 * and avoids a second place this logic could drift.
 *
 * `org_slug` gets the same `^[a-z0-9-]+$` client-side hint the backend
 * enforces server-side (`SignupRequest.org_slug`, `app/schemas/auth.py`) —
 * a malformed slug still round-trips to the backend's own 422 either way,
 * this is just a faster first-pass signal.
 */
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  CFormText,
  CRow,
} from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function Signup() {
  const { signup, orgContext, orgs } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (orgContext === "auto" && orgs.length > 0) {
      navigate(`/orgs/${orgs[0].id}`, { replace: true });
    } else if (orgContext === "picker") {
      navigate("/orgs/pick", { replace: true });
    }
  }, [orgContext, orgs, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!SLUG_PATTERN.test(orgSlug)) {
      setError("Organization slug may only contain lowercase letters, numbers, and hyphens.");
      return;
    }

    setSubmitting(true);
    try {
      await signup({ name, email, password, org_name: orgName, org_slug: orgSlug });
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
          <CCol md={7} lg={5}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="mb-4 fs-4">Create your organization</h1>
                <CForm onSubmit={handleSubmit}>
                  <div className="mb-3">
                    <CFormLabel htmlFor="name">Your name</CFormLabel>
                    <CFormInput
                      id="name"
                      type="text"
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div className="mb-3">
                    <CFormLabel htmlFor="email">Email</CFormLabel>
                    <CFormInput
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                  <div className="mb-3">
                    <CFormLabel htmlFor="password">Password</CFormLabel>
                    <CFormInput
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                  <div className="mb-3">
                    <CFormLabel htmlFor="orgName">Organization name</CFormLabel>
                    <CFormInput
                      id="orgName"
                      type="text"
                      required
                      value={orgName}
                      onChange={(event) => setOrgName(event.target.value)}
                    />
                  </div>
                  <div className="mb-3">
                    <CFormLabel htmlFor="orgSlug">Organization slug</CFormLabel>
                    <CFormInput
                      id="orgSlug"
                      type="text"
                      required
                      value={orgSlug}
                      onChange={(event) => setOrgSlug(event.target.value)}
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
