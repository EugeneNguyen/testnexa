/**
 * AUTH-1 org picker: shown after login resolves `org_context: "picker"`
 * (more than one active org membership). Reads `orgs` from `useAuth()` and
 * renders a clickable list (name + slug); picking one navigates to
 * `/orgs/{org.id}`. If `orgs` is empty — e.g. a direct navigation to this
 * route without having logged in first — redirects back to `/login`.
 *
 * Built with CoreUI (ADR-0012) — CListGroup/CListGroupItem.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CCard, CCardBody, CCol, CContainer, CListGroup, CListGroupItem, CRow } from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";

function OrgPicker() {
  const { orgs } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (orgs.length === 0) {
      navigate("/login", { replace: true });
    }
  }, [orgs, navigate]);

  if (orgs.length === 0) {
    return null;
  }

  return (
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={8} lg={5}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="mb-3 fs-4">Choose an organization</h1>
                <CListGroup>
                  {orgs.map((org) => (
                    <CListGroupItem
                      key={org.id}
                      as="button"
                      onClick={() => navigate(`/orgs/${org.id}`)}
                      className="text-start"
                    >
                      <div className="fw-semibold">{org.name}</div>
                      <div className="text-body-secondary small">{org.slug}</div>
                    </CListGroupItem>
                  ))}
                </CListGroup>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default OrgPicker;
