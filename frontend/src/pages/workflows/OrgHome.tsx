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
 * RBAC-2 (ADR-0017) adds a "Members" link to the new `/orgs/:orgId/members`
 * screen — the only nav entry point into it beyond a direct URL, since this
 * scaffold has no sidebar/nav-menu yet (AUTH-3 scope plan explicitly
 * descoped one). Unconditional, not org_admin-gated here: `OrgMembers.tsx`
 * itself gates on the backend's own `403`/`404` (see that file's docstring
 * for why — there is no client-side permission signal anywhere in this
 * codebase yet to gate a nav link on instead).
 *
 * SHELL-3 (ADR-0019, FR-SHELL-3/NFR-25) adds two dashboard stat widgets —
 * Project count (`CWidgetStatsA`) and active Org Member count
 * (`CWidgetStatsB`) — above the project list, sourced from
 * `lib/api/dashboard.ts`'s `getProjectsTotal`/`getActiveMemberTotal` (see
 * that module's own docstring for the exact endpoints and a flagged
 * backend-not-shipped-yet deviation). Each widget is its own `useQuery`,
 * matching this codebase's one existing inline-`useQuery` precedent
 * (`App.tsx`'s `ScaffoldVerificationPage`) rather than a bespoke generic
 * list-hook (`useEntityList` etc. is WBS task 6.2 scope, not built yet).
 * Loading/error/success are three distinct rendered states — a failed or
 * still-in-flight fetch never renders "0", only a real `total: 0` response
 * does (NFR-25, TC-SHELL-011).
 *
 * Built with CoreUI (ADR-0012).
 */
import { ReactNode, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
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
  CWidgetStatsA,
  CWidgetStatsB,
} from "@coreui/react";
import { ApiError } from "../../lib/api/client";
import { getActiveMemberTotal, getProjectsTotal } from "../../lib/api/dashboard";
import { createProject, ProjectSummary, updateProject } from "../../lib/api/projects";

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

/**
 * Renders a `useQuery` count result as a widget's `value` node — the one
 * place loading/error/success are told apart (NFR-25, TC-SHELL-011): a
 * still-in-flight or failed fetch never renders "0", only a real
 * `total: 0` response does.
 */
function widgetValue(isLoading: boolean, isError: boolean, total: number | undefined): ReactNode {
  if (isLoading) {
    return "Loading…";
  }
  if (isError || total === undefined) {
    return "Unable to load";
  }
  return total;
}

/**
 * FR-SHELL-3 Project-count widget. Its own `useQuery` (not a shared list
 * hook — see this file's own docstring for why) against
 * `lib/api/dashboard.ts`'s `getProjectsTotal`.
 */
function ProjectCountWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "projects-total"],
    queryFn: getProjectsTotal,
  });

  return (
    <CWidgetStatsA
      data-testid="widget-project-count"
      color="primary"
      value={widgetValue(isLoading, isError, data)}
      title="Projects"
    />
  );
}

/**
 * FR-SHELL-3 active-Org-Member-count widget. Its own `useQuery` against
 * `lib/api/dashboard.ts`'s `getActiveMemberTotal`, scoped to the current
 * `orgId`.
 */
function ActiveMemberCountWidget({ orgId }: { orgId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "active-members-total", orgId],
    queryFn: () => getActiveMemberTotal(orgId),
  });

  return (
    <CWidgetStatsB
      data-testid="widget-active-member-count"
      color="info"
      value={widgetValue(isLoading, isError, data)}
      title="Active org members"
      text=""
    />
  );
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
        <CRow className="justify-content-center mb-4">
          <CCol md={10} lg={8}>
            <CRow>
              <CCol sm={6}>
                <ProjectCountWidget />
              </CCol>
              <CCol sm={6}>
                <ActiveMemberCountWidget orgId={orgId} />
              </CCol>
            </CRow>
          </CCol>
        </CRow>
        <CRow className="justify-content-center">
          <CCol md={10} lg={8}>
            <CCard>
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0">Org: {orgId}</h1>
                  <div>
                    <CButton
                      as={Link}
                      to={`/orgs/${orgId}/members`}
                      color="secondary"
                      variant="outline"
                      className="me-2"
                    >
                      Members
                    </CButton>
                    <CButton color="primary" onClick={openModal}>
                      New Project
                    </CButton>
                  </div>
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
