/**
 * Minimal placeholder org landing page for AUTH-1. No real org/project view
 * exists yet in this scaffold — this just gives post-login navigation (auto
 * org-context or org-picker selection) somewhere real to land.
 *
 * RBAC-2 (ADR-0017) adds a "Members" link to the new `/orgs/:orgId/members`
 * screen — the only nav entry point into it beyond a direct URL, since this
 * scaffold has no sidebar/nav-menu yet (AUTH-3 scope plan explicitly
 * descoped one). Unconditional, not org_admin-gated here: `OrgMembers.tsx`
 * itself gates on the backend's own `403`/`404` (see that file's docstring
 * for why — there is no client-side permission signal anywhere in this
 * codebase yet to gate a nav link on instead).
 *
 * Built with CoreUI (ADR-0012).
 */
import { Link, useParams } from "react-router-dom";
import { CButton, CCard, CCardBody, CCol, CContainer, CRow } from "@coreui/react";

function OrgHome() {
  const { orgId } = useParams<{ orgId: string }>();

  return (
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={8} lg={5}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="fs-4 mb-3">Org: {orgId}</h1>
                <CButton as={Link} to={`/orgs/${orgId}/members`} color="secondary" variant="outline">
                  Members
                </CButton>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default OrgHome;
