/**
 * PROJ-4 (ADR-0047): dedicated Project management screen at
 * `/orgs/:orgId/projects`, reached via `AppSidebar`'s new "Projects" nav
 * item. This is the full Project CRUD table (ID/Name/Standards
 * profile/Actions, "New Project" modal, Edit modal, Delete confirm modal,
 * client-side search/sort/pagination) **extracted verbatim out of
 * `OrgHome.tsx`**, not rewritten — every `data-testid`, form-validation
 * schema, and API call is byte-for-byte the same code that shipped under
 * PROJ-1/DASH-2/ADR-0039/ADR-0040/DS-2. Only the page's own heading changes
 * ("Projects", not "Dashboard") and the mount route changes (`/orgs/:orgId`
 * -> `/orgs/:orgId/projects`).
 *
 * **Why this moved off `OrgHome`/"Dashboard" (ADR-0047, amends ADR-0039):**
 * ADR-0039 deliberately put full Project CRUD on the org's landing/"Dashboard"
 * screen — reasonable at the time, since no sidebar entry existed for it. This
 * story gives Projects its own reachable nav entry instead, which makes a
 * standalone page the more legible home for it: "Dashboard" now shows only
 * the two summary widgets + `RoleAssignmentsPanel` (see `OrgHome.tsx`'s own
 * docstring), and the Project-count widget links here rather than duplicating
 * the table in two places.
 *
 * See ADR-0047 for the full reasoning and the doc propagation this pass did
 * (Requirements FR-PROJ-3 revised in place, new FR-PROJ-4; Sitemap; new UI
 * Design Document; Test-Design §38; Test-Cases TC-PROJ-019/024 location
 * clause corrected, new TC-PROJ-025/026).
 */
import { ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import Table from "../../container/Table";
import { ApiError } from "../../lib/api/client";
import { createProject, deleteProject, listProjects, ProjectSummary, updateProject } from "../../lib/api/projects";

/**
 * DS-2/ADR-0041: the *initial* value of the shared container's page-size
 * selector (10/25/50/100). Kept at 10 so ADR-0039's own default is preserved
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
 * (`{code, message, field_errors}` per API Document §1) for `field`.
 */
function fieldError(error: ApiError, field: string): string | undefined {
  const body = error.body as { field_errors?: Record<string, string> } | undefined;
  return body?.field_errors?.[field];
}

/**
 * Hand-rolled Bootstrap 5 modal (ADR-0042 §2.3). Renders nothing at all when
 * closed — several tests assert `queryBy*(...)` is null while a modal is
 * shut. ESC closes; focus-trapping is not reimplemented (accepted gap,
 * ADR-0042).
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

function ProjectsPage() {
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
        <div className="row justify-content-center">
          <div className="col-md-10 col-lg-8">
            <div className="card">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0">Projects</h1>
                  <button type="button" className="btn btn-primary" onClick={openModal}>
                    New Project
                  </button>
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

export default ProjectsPage;
