/**
 * Org landing page. Started as an AUTH-1 placeholder (`Org: {orgId}` only);
 * PROJ-1 (ADR-0017) extends it with a minimal Project list + "New Project"
 * modal, per the PROJ-1 scope plan's Q5 (a small end-to-end slice, not a
 * full project-management screen — same posture RBAC-1 took for
 * `OrgPicker.tsx`'s "New Organization" modal).
 *
 * Project list is local component state, not a fetched list: there is no
 * `GET /orgs/{org_id}/projects` route in this story's scope (API Document §2
 * only ships `POST /orgs/{org_id}/projects` and `GET/PATCH /projects/{id}`),
 * so this page can only know about projects it created itself this session.
 * A page reload loses the list — accepted PROJ-1 scope limitation, not a bug.
 *
 * The "New Project" modal is React Hook Form + Zod (ADR-0009's form-state
 * convention, unchanged by ADR-0012's CoreUI swap) bound to CoreUI's input
 * components — this is the first modal-form in the repo actually wired that
 * way; `OrgPicker.tsx`'s "New Organization" modal (RBAC-1, pre-dates this
 * story) uses plain `useState` + manual validation instead, which this page
 * deliberately does not copy for the *form* wiring, only for the CoreUI
 * modal *structure* (`CModal`/`CModalHeader`/`CModalBody`/`CModalFooter`
 * layout, inline `CAlert` for a non-field API error).
 *
 * Inline `standards_profile` edit is a simple click-to-edit text field, not
 * a second form — functional and CoreUI-styled per the task scope, not
 * gold-plated with its own validation library wiring.
 *
 * Built with CoreUI (ADR-0012).
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CAlert,
  CButton,
  CCard,
  CCardBody,
  CCol,
  CContainer,
  CForm,
  CFormInput,
  CFormFeedback,
  CFormLabel,
  CFormText,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from "@coreui/react";
import { ApiError } from "../../lib/api/client";
import { createProject, ProjectSummary, updateProject } from "../../lib/api/projects";
import RoleAssignmentsPanel from "../../components/RoleAssignmentsPanel";

const newProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  standardsProfile: z.string().trim().optional(),
});

type NewProjectFormValues = z.infer<typeof newProjectSchema>;

/**
 * Pulls a `422` field-level message out of an `ApiError`'s body
 * (`{code, message, field_errors}` per API Document §1) for `field`, if
 * present — mirrors the shape `organizations.ts`/`auth.ts` document on
 * `createOrg`/`signup` (`error.body.field_errors.<field>`) without those
 * modules actually parsing it themselves; this page is the first to.
 */
function fieldError(error: ApiError, field: string): string | undefined {
  const body = error.body as { field_errors?: Record<string, string> } | undefined;
  return body?.field_errors?.[field];
}

function OrgHome() {
  const { orgId } = useParams<{ orgId: string }>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewProjectFormValues>({
    resolver: zodResolver(newProjectSchema),
    defaultValues: { name: "", standardsProfile: "" },
  });

  function openModal() {
    setApiError(null);
    reset({ name: "", standardsProfile: "" });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  async function onSubmit(values: NewProjectFormValues) {
    if (!orgId) {
      return;
    }
    setApiError(null);
    try {
      const project = await createProject(orgId, {
        name: values.name,
        // Omitted (not sent as `undefined`/empty string) when blank, so the
        // backend's create route falls through to its
        // `Organization.default_standards_profile` inheritance (ADR-0017) —
        // an explicit empty string would instead be stored as-is.
        ...(values.standardsProfile ? { standards_profile: values.standardsProfile } : {}),
      });
      setProjects((prev) => [...prev, project]);
      closeModal();
    } catch (err) {
      if (err instanceof ApiError) {
        const nameError = fieldError(err, "name");
        if (nameError) {
          setError("name", { type: "server", message: nameError });
        } else {
          setApiError(err.message);
        }
      } else {
        setApiError("Something went wrong. Please try again.");
      }
    }
  }

  function startEdit(project: ProjectSummary) {
    setEditingId(project.id);
    setEditValue(project.standards_profile ?? "");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(project: ProjectSummary) {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const trimmed = editValue.trim();
      const updated = await updateProject(project.id, {
        standards_profile: trimmed === "" ? null : trimmed,
      });
      setProjects((prev) => prev.map((existing) => (existing.id === updated.id ? updated : existing)));
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setEditSubmitting(false);
    }
  }

  if (!orgId) {
    return null;
  }

  return (
    <div className="min-vh-100 bg-body-secondary py-4">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={10} lg={8}>
            <CCard>
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0">Org: {orgId}</h1>
                  <CButton color="primary" onClick={openModal}>
                    New Project
                  </CButton>
                </div>

                {projects.length === 0 ? (
                  <p className="text-body-secondary mb-0">No projects yet.</p>
                ) : (
                  <CTable hover responsive>
                    <CTableHead>
                      <CTableRow>
                        <CTableHeaderCell>Name</CTableHeaderCell>
                        <CTableHeaderCell>Standards profile</CTableHeaderCell>
                        <CTableHeaderCell aria-label="Actions" />
                      </CTableRow>
                    </CTableHead>
                    <CTableBody>
                      {projects.map((project) => (
                        <CTableRow key={project.id}>
                          <CTableDataCell>{project.name}</CTableDataCell>
                          <CTableDataCell>
                            {editingId === project.id ? (
                              <>
                                <CFormInput
                                  aria-label={`Standards profile for ${project.name}`}
                                  size="sm"
                                  value={editValue}
                                  onChange={(event) => setEditValue(event.target.value)}
                                />
                                {editError && <div className="text-danger small mt-1">{editError}</div>}
                              </>
                            ) : (
                              project.standards_profile ?? <span className="text-body-secondary">—</span>
                            )}
                          </CTableDataCell>
                          <CTableDataCell className="text-end">
                            {editingId === project.id ? (
                              <>
                                <CButton
                                  size="sm"
                                  color="primary"
                                  className="me-2"
                                  disabled={editSubmitting}
                                  onClick={() => saveEdit(project)}
                                >
                                  {editSubmitting ? "Saving..." : "Save"}
                                </CButton>
                                <CButton size="sm" color="secondary" variant="outline" onClick={cancelEdit}>
                                  Cancel
                                </CButton>
                              </>
                            ) : (
                              <CButton size="sm" color="secondary" variant="outline" onClick={() => startEdit(project)}>
                                Edit
                              </CButton>
                            )}
                          </CTableDataCell>
                        </CTableRow>
                      ))}
                    </CTableBody>
                  </CTable>
                )}
              </CCardBody>
            </CCard>

            <RoleAssignmentsPanel orgId={orgId} />
          </CCol>
        </CRow>
      </CContainer>

      <CModal visible={showModal} onClose={closeModal}>
        <CModalHeader>
          <CModalTitle>New Project</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmit(onSubmit)} noValidate>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="projectName">Name</CFormLabel>
              <CFormInput id="projectName" type="text" invalid={!!errors.name} {...register("name")} />
              {errors.name && <CFormFeedback invalid>{errors.name.message}</CFormFeedback>}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="projectStandardsProfile">Standards profile</CFormLabel>
              <CFormInput id="projectStandardsProfile" type="text" {...register("standardsProfile")} />
              <CFormText>Optional — defaults to the organization&apos;s standards profile if left blank.</CFormText>
            </div>
            {apiError && (
              <CAlert color="danger" role="alert">
                {apiError}
              </CAlert>
            )}
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={closeModal}>
              Cancel
            </CButton>
            <CButton type="submit" color="primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>
    </div>
  );
}

export default OrgHome;
