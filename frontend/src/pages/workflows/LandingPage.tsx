/**
 * LANDING-1 public landing page (ADR-0024): mounts at `/`, replacing the
 * scaffold-phase `ScaffoldVerificationPage` that used to live there (a
 * dev-only widget proving frontend<->backend wiring via `GET /api/health`,
 * with no product content and no path to login). That page is deleted
 * outright, not relocated — see ADR-0024's Decision/Alternatives for why an
 * unlinked debug route isn't worth keeping around.
 *
 * Built with CoreUI (ADR-0012) — same `CCard`/`CContainer` page-shell pattern
 * `Login.tsx` uses. Content is deliberately bare-bones per FR-LANDING-1 /
 * ADR-0024: product name, a one-line pitch, a "Log in" primary CTA, a
 * "Sign up" secondary link. No features grid, testimonials, or
 * persona-targeted marketing copy in this pass — explicit scope deferral,
 * not an oversight.
 *
 * Redirect-off-landing logic (NFR-35): an already-authenticated visitor
 * (`orgContext` resolved) must never see the pitch/CTA content — they're
 * redirected to their org context instead, `"auto"` -> `/orgs/{orgs[0].id}`,
 * `"picker"` -> `/orgs/pick`. This is `Login.tsx`'s own post-login
 * `useEffect` over `AuthContext`'s `orgContext`/`orgs` state, reused
 * verbatim (same two branches, same targets) rather than a second,
 * independently-maintained redirect implementation.
 *
 * Public route, no API call: this component makes no `apiFetch`/`useQuery`
 * call of any kind on render — nothing about viewing it requires a token,
 * per NFR-35/ADR-0024's public-route posture.
 */
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CButton, CCard, CCardBody, CCol, CContainer, CRow } from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";

function LandingPage() {
  const { orgContext, orgs } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (orgContext === "auto" && orgs.length > 0) {
      navigate(`/orgs/${orgs[0].id}`, { replace: true });
    } else if (orgContext === "picker") {
      navigate("/orgs/pick", { replace: true });
    }
  }, [orgContext, orgs, navigate]);

  return (
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={8} lg={6}>
            <CCard>
              <CCardBody className="p-4 text-center">
                <h1 className="mb-3 fs-3">TestNexa</h1>
                <p className="mb-4 text-body-secondary">
                  Self-hosted, ISTQB/IEEE 829-aligned test management for human + AI-agent teams.
                </p>
                <CButton as={Link} to="/login" color="primary" className="w-100 mb-2">
                  Log in
                </CButton>
                <p className="mb-0 small">
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

export default LandingPage;
