/**
 * AUTH-1 org picker: shown after login resolves `org_context: "picker"`
 * (more than one active org membership). Reads `orgs` from `useAuth()` and
 * renders a clickable list (name + slug); picking one navigates to
 * `/orgs/{org.id}`. If `orgs` is empty — e.g. a direct navigation to this
 * route without having logged in first — redirects back to `/login`.
 *
 * RBAC-1/ADR-0016 AC2: adds a small "New Organization" action — a CoreUI
 * modal with `name`/`slug` inputs calling `createOrg` (`POST /orgs`). This
 * is the already-authenticated-org_admin path (distinct from `Signup.tsx`'s
 * bootstrap-only `POST /auth/signup`). On success, navigates straight to
 * the newly created org (`/orgs/{new org.id}`) rather than trying to splice
 * it into this screen's own `orgs` list — that list is `AuthContext` state
 * populated only by `login()`/`signup()`'s response and has no setter
 * exposed for a one-off addition; the new org is fully usable via direct
 * navigation regardless (the access token alone is what `/orgs/:orgId`
 * needs), so there's nothing missing by not updating the list here. A
 * `403 permission_denied` (no `organization.create` grant anywhere) or
 * `422` (slug collision) is shown inline in the modal.
 *
 * Built with CoreUI (ADR-0012) — CListGroup/CListGroupItem/CModal/CForm.
 */
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  CListGroup,
  CListGroupItem,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
} from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";
import { createOrg } from "../../lib/api/organizations";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function OrgPicker() {
  const { orgs } = useAuth();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (orgs.length === 0) {
      navigate("/login", { replace: true });
    }
  }, [orgs, navigate]);

  function openModal() {
    setNewOrgName("");
    setNewOrgSlug("");
    setCreateError(null);
    setShowModal(true);
  }

  async function handleCreateOrg(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);

    if (!SLUG_PATTERN.test(newOrgSlug)) {
      setCreateError("Slug may only contain lowercase letters, numbers, and hyphens.");
      return;
    }

    setCreating(true);
    try {
      const org = await createOrg({ name: newOrgName, slug: newOrgSlug });
      setShowModal(false);
      navigate(`/orgs/${org.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

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
                <CListGroup className="mb-3">
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
                <CButton color="secondary" variant="outline" className="w-100" onClick={openModal}>
                  New Organization
                </CButton>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>

      <CModal visible={showModal} onClose={() => setShowModal(false)}>
        <CModalHeader>
          <CModalTitle>New Organization</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleCreateOrg}>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="newOrgName">Name</CFormLabel>
              <CFormInput
                id="newOrgName"
                type="text"
                required
                value={newOrgName}
                onChange={(event) => setNewOrgName(event.target.value)}
              />
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="newOrgSlug">Slug</CFormLabel>
              <CFormInput
                id="newOrgSlug"
                type="text"
                required
                value={newOrgSlug}
                onChange={(event) => setNewOrgSlug(event.target.value)}
              />
              <CFormText>Lowercase letters, numbers, and hyphens only.</CFormText>
            </div>
            {createError && (
              <CAlert color="danger" role="alert">
                {createError}
              </CAlert>
            )}
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </CButton>
            <CButton type="submit" color="primary" disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>
    </div>
  );
}

export default OrgPicker;
