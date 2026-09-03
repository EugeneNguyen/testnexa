/**
 * Minimal placeholder org landing page for AUTH-1. No real org/project view
 * exists yet in this scaffold — this just gives post-login navigation (auto
 * org-context or org-picker selection) somewhere real to land.
 *
 * Built with CoreUI (ADR-0012).
 */
import { useParams } from "react-router-dom";
import { CCard, CCardBody, CCol, CContainer, CRow } from "@coreui/react";

function OrgHome() {
  const { orgId } = useParams<{ orgId: string }>();

  return (
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={8} lg={5}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="fs-4 mb-0">Org: {orgId}</h1>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default OrgHome;
