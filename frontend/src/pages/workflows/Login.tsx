/**
 * AUTH-1 login screen: email+password form calling `useAuth().login`.
 * Built with CoreUI (ADR-0012) — CCard/CForm/CFormInput/CButton/CAlert.
 *
 * `login()` resolves `void` and updates `AuthContext` state asynchronously,
 * so post-success navigation is driven by a `useEffect` watching
 * `orgContext`/`orgs` rather than a return value: `org_context: "auto"` goes
 * to `/orgs/{orgs[0].id}`, `"picker"` goes to `/orgs/pick`. On failure, the
 * thrown `ApiError`'s `message` (the backend's message, or a generic
 * fallback for the 422 validation-error case — see `lib/api/auth.ts`) is
 * shown inline. The submit button is disabled while a request is in flight
 * to avoid double-submit.
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
  CRow,
} from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";

function Login() {
  const { login, orgContext, orgs } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    setSubmitting(true);
    try {
      await login(email, password);
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
                <CForm onSubmit={handleSubmit}>
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
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
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
