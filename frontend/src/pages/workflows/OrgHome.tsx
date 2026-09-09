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
 * Project count and active Org Member count (both now the shared `InfoBox`,
 * AdminLTE's own Info Box widget, each with a leading colored icon block;
 * see the DS-3 note below for what they were before) — above the project
 * list, sourced from
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
 * **DS-2 (2026-09-07, ADR-0041):** the Project table's hand-rolled
 * `CPagination` block and its hardcoded `PAGE_SIZE = 10` are replaced by the
 * shared `container/Table.tsx` in **client mode** — it receives the full,
 * already-filtered-and-sorted `filteredSortedProjects` array and does the
 * slicing itself. ADR-0039's client-side search/sort decision above is NOT
 * reopened: the search `CFormInput` and the `SortableHeader` cells stay
 * exactly where and how they were, passed through as the container's header
 * slot and `columns` respectively. The only user-visible change is a working
 * "Rows per page" selector (10/25/50/100) where none existed; the default
 * stays 10. TC-DS-015 asserts TC-PROJ-022 (search) and TC-PROJ-023 (sort)
 * still pass with zero assertion changes.
 *
 * **ADR-0042 (2026-09-08):** originally built with CoreUI (ADR-0012); the
 * `@coreui/react` components are replaced by raw Bootstrap 5 / AdminLTE v4
 * markup. Nothing about this screen's *behavior* changes — the RHF+Zod
 * wiring, the ADR-0039 client-side search/sort, the ADR-0041 shared `Table`
 * container call, and every `data-testid` are all untouched; only the
 * rendered elements and class names are. Notable local consequences: the
 * three `CModal`s become one local `Modal` helper (below) hand-rolling
 * Bootstrap's own modal markup, and `SortableHeader` now renders a real
 * `<th>` (`container/Table.tsx`'s `columns`/`renderRow` slots take raw
 * `<tr>`/`<th>`/`<td>` since ADR-0042, not `<CTableRow>`/`<CTableHeaderCell>`
 * /`<CTableDataCell>`).
 *
 * **DS-3 (2026-09-08, [ADR-0045](docs/adr/0045-ds-3-infobox-widget-consolidation.md)):**
 * both count widgets move off `WidgetStatsTile` (deleted by this story) onto
 * the shared `InfoBox`, which renders AdminLTE's own Info Box markup. A
 * rendering swap only: each widget's `useQuery` and the shared `widgetValue()`
 * loading/error/count tri-state below are untouched, and both `data-testid`s
 * (`widget-project-count`, `widget-active-member-count`) still sit on the root
 * element — TC-SHELL-010/011's own assertions pass with zero changes, which is
 * what TC-DS-020 asserts. The one user-visible change is that
 * `ActiveMemberCountWidget` gains an icon it never had (`fa-solid fa-users`);
 * see that component's own comment and ADR-0043's Consequences.
 */
import { ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import Table from "../../container/Table";
import { ApiError } from "../../lib/api/client";
import { getActiveMemberTotal, getProjectsTotal } from "../../lib/api/dashboard";
import { createProject, deleteProject, listProjects, ProjectSummary, updateProject } from "../../lib/api/projects";
import RoleAssignmentsPanel from "../../components/RoleAssignmentsPanel";
import { InfoBox } from "../../components/molecules/info-box";

/**
 * DS-2/ADR-0041: previously a hardcoded slice size with no UI to change it;
 * now the *initial* value of the shared container's page-size selector, which
 * offers 10/25/50/100. Kept at 10 so ADR-0039's own default is preserved
 * exactly (TC-DS-018 asserts a screen returns to its own default, not the
 * last-selected size, after navigating away and back).
 */
const DEFAULT_PAGE_SIZE = 10;

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
    <InfoBox
      color="primary"
      text="Projects"
      number={widgetValue(isLoading, isError, data)}
      // ADR-0042: was `"cilFolder"`, a CoreUI icon *name* string that
      // `CIcon` could never resolve without a global icon registry this app
      // never set up — i.e. the A-variant icon block rendered empty. Now a
      // Font Awesome class string, which `InfoBox` renders directly.
      icon="fa-solid fa-folder"
      testId="widget-project-count"
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
    <InfoBox
      color="info"
      text="Active org members"
      number={widgetValue(isLoading, isError, data)}
      // DS-3/ADR-0043: new. This widget rendered no icon block for its whole
      // history (`WidgetStatsTile`'s B-variant); AdminLTE's Info Box has no
      // documented icon-omitted variant, so it gains one, matching the sibling
      // Project-count widget's own `fa-solid fa-folder`. Called out as a real,
      // user-visible change in that ADR's Consequences, not an incidental one.
      icon="fa-solid fa-users"
      testId="widget-active-member-count"
    />
  );
}

/**
 * Hand-rolled Bootstrap 5 modal (ADR-0042 §2.3), replacing `CModal` +
 * `CModalHeader` + `CModalTitle`. This screen renders three of them, so the
 * block lives here once rather than being repeated per modal.
 *
 * Deliberately renders **nothing at all when closed**, matching what `CModal`
 * effectively did — several tests in this repo assert `queryBy*(...)` is null
 * while a modal is shut, which a render-but-hide modal would break.
 *
 * ESC closes (CoreUI's `keyboard` default). Focus-trapping is *not*
 * reimplemented — an accepted, documented gap in ADR-0042, not an oversight.
 */
function Modal({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!visible) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  if (!visible) {
    return null;
  }

  return (
    <>
      <div
        className="modal fade show d-block"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id={titleId}>
                {title}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            {children}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
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
    // The accessible name of these cells is computed from their descendant
    // text ("Name ▲"), and `OrgHome.test.tsx` looks them up with
    // `getByRole("columnheader", {name: /^name/i})` — do not add, reorder, or
    // wrap any text/icon inside this cell.
    <th
      scope="col"
      role="columnheader"
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      style={{ cursor: "pointer", userSelect: "none" }}
      onClick={() => onSort(field)}
    >
      {label}
      {isActive ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
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
  // DS-2/ADR-0041: page/page-size state moved into `container/Table.tsx`
  // (client mode) — this screen only needs to tell it *when* to reset back to
  // page 1 (`resetPageKey`, below), not track a page number itself.

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

  if (!orgId) {
    return null;
  }

  return (
    <div className="min-vh-100 bg-body-secondary py-4">
      <div className="container-fluid px-4">
        <div className="row justify-content-center mb-4">
          <div className="col-md-10 col-lg-8">
            <div className="row">
              <div className="col-sm-6">
                <ProjectCountWidget orgId={orgId} />
              </div>
              <div className="col-sm-6">
                <ActiveMemberCountWidget orgId={orgId} />
              </div>
            </div>
          </div>
        </div>
        <div className="row justify-content-center">
          <div className="col-md-10 col-lg-8">
            <div className="card">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0">Dashboard</h1>
                  <div>
                    {/*
                      ADR-0042 §4.5.9: was `CButton as={Link}` (polymorphic).
                      A real `<Link>` carrying the button classes, not a
                      `<button>` — it must stay an `<a>` so `getByRole("link")`
                      and real navigation both keep working.
                    */}
                    <Link className="btn btn-outline-secondary me-2" to={`/orgs/${orgId}/members`}>
                      Members
                    </Link>
                    <button type="button" className="btn btn-primary" onClick={openModal}>
                      New Project
                    </button>
                  </div>
                </div>

                {projectsLoading ? (
                  <p className="text-body-secondary mb-0">Loading projects…</p>
                ) : projectsIsError ? (
                  <div className="alert alert-danger" role="alert">
                    Unable to load projects. Please try reloading the page.
                  </div>
                ) : projects.length === 0 ? (
                  <p className="text-body-secondary mb-0">No projects yet.</p>
                ) : (
                  <>
                    <div className="mb-3" style={{ maxWidth: "20rem" }}>
                      <input
                        type="search"
                        className="form-control"
                        placeholder="Search by name…"
                        aria-label="Search projects"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>

                    {filteredSortedProjects.length === 0 ? (
                      <p className="text-body-secondary mb-0">No projects match your search.</p>
                    ) : (
                      <Table
                        mode="client"
                        items={filteredSortedProjects}
                        rowKey={(project) => project.id}
                        defaultPageSize={DEFAULT_PAGE_SIZE}
                        resetPageKey={`${search}|${sortField}|${sortDir}`}
                        paginationLabel="Project list pages"
                        testIdPrefix="project-table"
                        columns={
                          <tr>
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
                            <th scope="col">Standards profile</th>
                            <th scope="col" aria-label="Actions" />
                          </tr>
                        }
                        renderRow={(project) => (
                          <tr key={project.id}>
                            <td className="text-body-secondary small">{project.id}</td>
                            <td>
                              <Link to={`/projects/${project.id}`}>{project.name}</Link>
                            </td>
                            <td>
                              {project.standards_profile ?? <span className="text-body-secondary">—</span>}
                            </td>
                            <td className="text-end">
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm me-2"
                                onClick={() => openEditModal(project)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                onClick={() => requestDelete(project)}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        )}
                      />
                    )}
                  </>
                )}
              </div>
            </div>

            <RoleAssignmentsPanel orgId={orgId} />
          </div>
        </div>
      </div>

      <Modal visible={showModal} onClose={closeModal} title="New Project">
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="modal-body">
            <div className="mb-3">
              <label className="form-label" htmlFor="projectName">
                Name
              </label>
              <input
                id="projectName"
                type="text"
                className={`form-control${errors.name ? " is-invalid" : ""}`}
                {...register("name")}
              />
              {errors.name && <div className="invalid-feedback d-block">{errors.name.message}</div>}
            </div>
            <div className="mb-3">
              <label className="form-label" htmlFor="projectStandardsProfile">
                Standards profile
              </label>
              <input id="projectStandardsProfile" type="text" className="form-control" {...register("standardsProfile")} />
              <div className="form-text">
                Optional — defaults to the organization&apos;s standards profile if left blank.
              </div>
            </div>
            {apiError && (
              <div className="alert alert-danger" role="alert">
                {apiError}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal visible={Boolean(editingProject)} onClose={closeEditModal} title="Edit Project">
        <form onSubmit={handleEditSubmit(onEditSubmit)} noValidate>
          <div className="modal-body">
            <div className="mb-3">
              <label className="form-label" htmlFor="editProjectName">
                Name
              </label>
              <input
                id="editProjectName"
                type="text"
                className={`form-control${editErrors.name ? " is-invalid" : ""}`}
                {...registerEdit("name")}
              />
              {editErrors.name && (
                <div className="invalid-feedback d-block">{editErrors.name.message}</div>
              )}
            </div>
            <div className="mb-3">
              <label className="form-label" htmlFor="editProjectStandardsProfile">
                Standards profile
              </label>
              <input
                id="editProjectStandardsProfile"
                type="text"
                className="form-control"
                {...registerEdit("standardsProfile")}
              />
              <div className="form-text">Leave blank to clear it.</div>
            </div>
            {editApiError && (
              <div className="alert alert-danger" role="alert">
                {editApiError}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={closeEditModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isEditSubmitting}>
              {isEditSubmitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        visible={Boolean(rowPendingDelete)}
        onClose={() => setRowPendingDelete(null)}
        title="Delete Project"
      >
        <div className="modal-body">
          {deleteError && (
            <div className="alert alert-danger" role="alert">
              {deleteError}
            </div>
          )}
          Are you sure you want to delete{" "}
          <strong>{rowPendingDelete?.name}</strong>? This cannot be undone.
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setRowPendingDelete(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={deleteMutation.isPending}
            onClick={() => rowPendingDelete && deleteMutation.mutate(rowPendingDelete)}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default OrgHome;
