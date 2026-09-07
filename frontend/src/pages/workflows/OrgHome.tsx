/**
 * Org landing page. Started as an AUTH-1 placeholder (`Org: {orgId}` only);
 * PROJ-1 (ADR-0017) extends it with a minimal Project list + "New Project"
 * modal, per the PROJ-1 scope plan's Q5 (a small end-to-end slice, not a
 * full project-management screen — same posture RBAC-1 took for
 * `OrgPicker.tsx`'s "New Organization" modal).
 *
 * **Project list fix (2026-09-07):** originally local `useState`, populated
 * only by `createProject`'s own response — any unmount (not just a page
 * reload; navigating into a project's own detail page and back unmounts this
 * component too) silently lost the list, even though the rows still existed
 * server-side. Fixed by fetching real data via `lib/api/projects.ts`'s
 * `listProjects` (`GET /projects?org_id=`, the generic-CRUD factory route
 * ADR-0022 already shipped and `getProjectsTotal` already calls for the
 * dashboard widget below) through a `useQuery`, same pattern the two widgets
 * already use. `createProject`/`updateProject` still write straight into the
 * query cache (`queryClient.setQueryData`) for an instant UI update without
 * waiting on a refetch — the `useQuery` is what makes the list durable across
 * a remount, not what every single edit round-trips through.
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
 * RBAC-2 (ADR-0017) adds a "Members" link to the new `/orgs/:orgId/members`
 * screen — the only nav entry point into it beyond a direct URL, since this
 * scaffold has no sidebar/nav-menu yet (AUTH-3 scope plan explicitly
 * descoped one). Unconditional, not org_admin-gated here: `OrgMembers.tsx`
 * itself gates on the backend's own `403`/`404` (see that file's docstring
 * for why — there is no client-side permission signal anywhere in this
 * codebase yet to gate a nav link on instead).
 *
 * SHELL-3 (ADR-0020, FR-SHELL-3/NFR-27) adds two dashboard stat widgets —
 * Project count (`CWidgetStatsA`) and active Org Member count
 * (`CWidgetStatsB`) — above the project list, sourced from
 * `lib/api/dashboard.ts`'s `getProjectsTotal`/`getActiveMemberTotal` (see
 * that module's own docstring for the exact endpoints and a flagged
 * backend-not-shipped-yet deviation). Each widget is its own `useQuery`,
 * matching this codebase's original inline-`useQuery` precedent (the
 * now-deleted `App.tsx`'s `ScaffoldVerificationPage`, replaced at `/` by
 * `LandingPage.tsx` per ADR-0024/LANDING-1 and since replaced again by
 * DASH-1/ADR-0035's `RootRedirect`) rather than a bespoke generic
 * list-hook (`useEntityList` etc. is WBS task 6.2 scope, not built yet).
 * Loading/error/success are three distinct rendered states — a failed or
 * still-in-flight fetch never renders "0", only a real `total: 0` response
 * does (NFR-27, TC-SHELL-011).
 *
 * **DASH-2 (2026-09-07):** this page is relabeled "Dashboard" (heading text
 * only — route stays `/orgs/:orgId`, same as the sidebar's own label change
 * in `AppSidebar.tsx`). This is a distinct page from the separate, unrelated
 * global `/dashboard` placeholder (ADR-0035/DASH-1) — see this story's own
 * ADR for the naming-collision call and why that route is untouched.
 *
 * The Project table gains an ID column, a dedicated "Edit" modal (replacing
 * the old click-to-edit-in-place `standards_profile` field — now edits
 * `name` + `standards_profile` together, same RHF+Zod pattern as "New
 * Project"), a "Delete" button + confirm modal (`deleteProject`, wired to
 * the generic factory's `DELETE /projects/{id}` — already shipped under
 * ADR-0022, just never called from any frontend screen until now), and
 * client-side search/sort/pagination over the already-fully-fetched list
 * (`listProjects` pages through every row up front — see that function's own
 * docstring — so there's no server round-trip per search/sort/page change).
 * Client-side, not server-side, because the backend generic factory has no
 * `order_by`/sort support at all today (confirmed: adding one is out of
 * scope for this story) and the list is already fetched in full; revisit if
 * an org's project count ever grows large enough for this to matter.
 *
 * Built with CoreUI (ADR-0012).
 */
import { ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  CPagination,
  CPaginationItem,
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
import { createProject, deleteProject, listProjects, ProjectSummary, updateProject } from "../../lib/api/projects";
import RoleAssignmentsPanel from "../../components/RoleAssignmentsPanel";

const PAGE_SIZE = 10;

const newProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  standardsProfile: z.string().trim().optional(),
});

type NewProjectFormValues = z.infer<typeof newProjectSchema>;

const editProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  standardsProfile: z.string().trim().optional(),
});

type EditProjectFormValues = z.infer<typeof editProjectSchema>;

type SortField = "id" | "name";
type SortDir = "asc" | "desc";

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
 * place loading/error/success are told apart (NFR-27, TC-SHELL-011): a
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
 * `lib/api/dashboard.ts`'s `getProjectsTotal`, scoped to the current
 * `orgId` (ADMIN-2/ADR-0022: `Project`'s factory-served list route
 * requires `org_id` explicitly, same as `ActiveMemberCountWidget` already
 * does for `org-memberships`).
 */
function ProjectCountWidget({ orgId }: { orgId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "projects-total", orgId],
    queryFn: () => getProjectsTotal(orgId),
    // A backend error won't start succeeding on retry — TanStack Query's
    // default `retry: 3` would otherwise hold the widget in its loading
    // state for ~7s (exponential backoff) before surfacing the error.
    retry: false,
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
    retry: false, // see ProjectCountWidget's own comment above
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

/** Sortable column header — click toggles asc/desc, a second field click resets to asc. */
function SortableHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const isActive = sortField === field;
  return (
    <CTableHeaderCell
      role="columnheader"
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      style={{ cursor: "pointer", userSelect: "none" }}
      onClick={() => onSort(field)}
    >
      {label}
      {isActive ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </CTableHeaderCell>
  );
}

function OrgHome() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const projectsQueryKey = ["projects", orgId] as const;
  const {
    data: projects = [],
    isLoading: projectsLoading,
    isError: projectsIsError,
  } = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => listProjects(orgId as string),
    enabled: !!orgId,
  });

  const [showModal, setShowModal] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [editingProject, setEditingProject] = useState<ProjectSummary | null>(null);
  const [editApiError, setEditApiError] = useState<string | null>(null);

  const [rowPendingDelete, setRowPendingDelete] = useState<ProjectSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

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

  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEdit,
    setError: setEditFieldError,
    formState: { errors: editErrors, isSubmitting: isEditSubmitting },
  } = useForm<EditProjectFormValues>({
    resolver: zodResolver(editProjectSchema),
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
      queryClient.setQueryData<ProjectSummary[]>(projectsQueryKey, (prev = []) => [...prev, project]);
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

  function openEditModal(project: ProjectSummary) {
    setEditApiError(null);
    resetEdit({ name: project.name, standardsProfile: project.standards_profile ?? "" });
    setEditingProject(project);
  }

  function closeEditModal() {
    setEditingProject(null);
  }

  async function onEditSubmit(values: EditProjectFormValues) {
    if (!editingProject) {
      return;
    }
    setEditApiError(null);
    try {
      const trimmedProfile = (values.standardsProfile ?? "").trim();
      const updated = await updateProject(editingProject.id, {
        name: values.name,
        standards_profile: trimmedProfile === "" ? null : trimmedProfile,
      });
      queryClient.setQueryData<ProjectSummary[]>(projectsQueryKey, (prev = []) =>
        prev.map((existing) => (existing.id === updated.id ? updated : existing)),
      );
      closeEditModal();
    } catch (err) {
      if (err instanceof ApiError) {
        const nameError = fieldError(err, "name");
        if (nameError) {
          setEditFieldError("name", { type: "server", message: nameError });
        } else {
          setEditApiError(err.message);
        }
      } else {
        setEditApiError("Something went wrong. Please try again.");
      }
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (project: ProjectSummary) => deleteProject(project.id),
    onSuccess: (_data, project) => {
      queryClient.setQueryData<ProjectSummary[]>(projectsQueryKey, (prev = []) =>
        prev.filter((existing) => existing.id !== project.id),
      );
      setRowPendingDelete(null);
    },
    onError: (err: unknown) => {
      setDeleteError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    },
  });

  function requestDelete(project: ProjectSummary) {
    setDeleteError(null);
    setRowPendingDelete(project);
  }

  function handleSort(field: SortField) {
    setPage(1);
    if (field === sortField) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const filteredSortedProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term ? projects.filter((project) => project.name.toLowerCase().includes(term)) : projects;
    const sorted = [...filtered].sort((a, b) => {
      const cmp = a[sortField].localeCompare(b[sortField]);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [projects, search, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSortedProjects.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageProjects = filteredSortedProjects.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (!orgId) {
    return null;
  }

  return (
    <div className="min-vh-100 bg-body-secondary py-4">
      <CContainer fluid className="px-4">
        <CRow className="justify-content-center mb-4">
          <CCol md={10} lg={8}>
            <CRow>
              <CCol sm={6}>
                <ProjectCountWidget orgId={orgId} />
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
                  <h1 className="fs-4 mb-0">Dashboard</h1>
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

                {projectsLoading ? (
                  <p className="text-body-secondary mb-0">Loading projects…</p>
                ) : projectsIsError ? (
                  <CAlert color="danger" role="alert">
                    Unable to load projects. Please try reloading the page.
                  </CAlert>
                ) : projects.length === 0 ? (
                  <p className="text-body-secondary mb-0">No projects yet.</p>
                ) : (
                  <>
                    <div className="mb-3" style={{ maxWidth: "20rem" }}>
                      <CFormInput
                        type="search"
                        placeholder="Search by name…"
                        aria-label="Search projects"
                        value={search}
                        onChange={(event) => {
                          setPage(1);
                          setSearch(event.target.value);
                        }}
                      />
                    </div>

                    {filteredSortedProjects.length === 0 ? (
                      <p className="text-body-secondary mb-0">No projects match your search.</p>
                    ) : (
                      <>
                        <CTable hover responsive>
                          <CTableHead>
                            <CTableRow>
                              <SortableHeader
                                field="id"
                                label="ID"
                                sortField={sortField}
                                sortDir={sortDir}
                                onSort={handleSort}
                              />
                              <SortableHeader
                                field="name"
                                label="Name"
                                sortField={sortField}
                                sortDir={sortDir}
                                onSort={handleSort}
                              />
                              <CTableHeaderCell>Standards profile</CTableHeaderCell>
                              <CTableHeaderCell aria-label="Actions" />
                            </CTableRow>
                          </CTableHead>
                          <CTableBody>
                            {pageProjects.map((project) => (
                              <CTableRow key={project.id}>
                                <CTableDataCell className="text-body-secondary small">{project.id}</CTableDataCell>
                                <CTableDataCell>
                                  <Link to={`/projects/${project.id}`}>{project.name}</Link>
                                </CTableDataCell>
                                <CTableDataCell>
                                  {project.standards_profile ?? <span className="text-body-secondary">—</span>}
                                </CTableDataCell>
                                <CTableDataCell className="text-end">
                                  <CButton
                                    size="sm"
                                    color="secondary"
                                    variant="outline"
                                    className="me-2"
                                    onClick={() => openEditModal(project)}
                                  >
                                    Edit
                                  </CButton>
                                  <CButton
                                    size="sm"
                                    color="danger"
                                    variant="outline"
                                    onClick={() => requestDelete(project)}
                                  >
                                    Delete
                                  </CButton>
                                </CTableDataCell>
                              </CTableRow>
                            ))}
                          </CTableBody>
                        </CTable>

                        {totalPages > 1 && (
                          <CPagination aria-label="Project list pages">
                            <CPaginationItem
                              disabled={currentPage <= 1}
                              onClick={() => setPage(currentPage - 1)}
                            >
                              Previous
                            </CPaginationItem>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                              <CPaginationItem key={p} active={p === currentPage} onClick={() => setPage(p)}>
                                {p}
                              </CPaginationItem>
                            ))}
                            <CPaginationItem
                              disabled={currentPage >= totalPages}
                              onClick={() => setPage(currentPage + 1)}
                            >
                              Next
                            </CPaginationItem>
                          </CPagination>
                        )}
                      </>
                    )}
                  </>
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

      <CModal visible={Boolean(editingProject)} onClose={closeEditModal}>
        <CModalHeader>
          <CModalTitle>Edit Project</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleEditSubmit(onEditSubmit)} noValidate>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="editProjectName">Name</CFormLabel>
              <CFormInput
                id="editProjectName"
                type="text"
                invalid={!!editErrors.name}
                {...registerEdit("name")}
              />
              {editErrors.name && <CFormFeedback invalid>{editErrors.name.message}</CFormFeedback>}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="editProjectStandardsProfile">Standards profile</CFormLabel>
              <CFormInput id="editProjectStandardsProfile" type="text" {...registerEdit("standardsProfile")} />
              <CFormText>Leave blank to clear it.</CFormText>
            </div>
            {editApiError && (
              <CAlert color="danger" role="alert">
                {editApiError}
              </CAlert>
            )}
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={closeEditModal}>
              Cancel
            </CButton>
            <CButton type="submit" color="primary" disabled={isEditSubmitting}>
              {isEditSubmitting ? "Saving..." : "Save"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>

      <CModal visible={Boolean(rowPendingDelete)} onClose={() => setRowPendingDelete(null)}>
        <CModalHeader>
          <CModalTitle>Delete Project</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {deleteError && (
            <CAlert color="danger" role="alert">
              {deleteError}
            </CAlert>
          )}
          Are you sure you want to delete{" "}
          <strong>{rowPendingDelete?.name}</strong>? This cannot be undone.
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" onClick={() => setRowPendingDelete(null)}>
            Cancel
          </CButton>
          <CButton
            color="danger"
            disabled={deleteMutation.isPending}
            onClick={() => rowPendingDelete && deleteMutation.mutate(rowPendingDelete)}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </CButton>
        </CModalFooter>
      </CModal>
    </div>
  );
}

export default OrgHome;
