/**
 * RBAC-3 role-assignment UI (ADR-0021), mounted inside `OrgHome.tsx`.
 *
 * Split out as its own component (rather than growing `OrgHome.tsx` further
 * inline, the way PROJ-1's Project section did) — a second independent
 * list+modal slice belongs in its own file with its own clear boundary:
 * what it does (list + grant RoleAssignments for one org), how it's used
 * (`<RoleAssignmentsPanel orgId={orgId} />`), what it depends on
 * (`lib/api/roleAssignments`). `OrgHome.tsx` stays about Projects.
 *
 * Unlike PROJ-1's Project list (no `GET` route existed in that story's
 * scope, so it's local-state-only), `GET /orgs/{org_id}/role-assignments`
 * and `GET /orgs/{org_id}/roles` both exist — this panel fetches real data
 * on mount rather than only tracking what it created this session, and
 * survives a page reload.
 *
 * The "New Role Assignment" modal is React Hook Form + Zod bound to CoreUI
 * inputs, same convention `OrgHome.tsx`'s "New Project" modal established.
 * `role_id` is a `CFormSelect` populated from `listRoles` (per-org, this
 * story's explicit UI decision — no raw UUID paste for the role). `actor_id`
 * stays a raw UUID text input: no member/agent-listing endpoint exists yet
 * (RBAC-2/an agent-list route are both separate, unbuilt scope) — the field
 * label and helper text say so plainly rather than pretending otherwise.
 *
 * **DS-2/ADR-0041 (2026-09-07):** the list, previously an unpaginated
 * `CTable` (the one table-backing screen in this codebase with no
 * pagination at all), now uses the shared `container/Table.tsx` in server
 * mode, against `listRoleAssignments`'s newly-paginated route.
 *
 * **ADR-0042 (2026-09-08):** originally built with CoreUI (ADR-0012); the
 * `@coreui/react` components are now raw Bootstrap 5 / AdminLTE v4 markup.
 * The RHF+Zod wiring (including the `CFormSelect` → `<select>` `register()`
 * spread) and every behavior above are unchanged — only elements and classes
 * are. The `CModal` becomes the local `Modal` helper below, and the shared
 * `container/Table.tsx`'s `columns`/`renderRow` slots now take raw
 * `<tr>`/`<th>`/`<td>` rather than `<CTableRow>`/`<CTableHeaderCell>`/
 * `<CTableDataCell>`.
 */
import { ReactNode, useCallback, useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Table from "../container/Table";
import { ApiError } from "../lib/api/client";
import {
  createRoleAssignment,
  listRoleAssignments,
  listRoles,
  RoleAssignmentSummary,
  RoleSummary,
} from "../lib/api/roleAssignments";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const newRoleAssignmentSchema = z
  .object({
    actorId: z.string().trim().regex(UUID_PATTERN, "Must be a valid actor id (UUID)"),
    roleId: z.string().trim().min(1, "Role is required"),
    scope: z.enum(["org-wide", "project-scoped"]),
    projectId: z.string().trim().optional(),
  })
  .refine(
    (values) => values.scope !== "project-scoped" || UUID_PATTERN.test(values.projectId ?? ""),
    { message: "Must be a valid project id (UUID)", path: ["projectId"] },
  );

type NewRoleAssignmentFormValues = z.infer<typeof newRoleAssignmentSchema>;

/** Pulls a `422` field-level message out of an `ApiError`'s body, same helper `OrgHome.tsx` defines locally. */
function fieldError(error: ApiError, field: string): string | undefined {
  const body = error.body as { field_errors?: Record<string, string[]> } | undefined;
  return body?.field_errors?.[field]?.[0];
}

/**
 * Hand-rolled Bootstrap 5 modal (ADR-0042 §2.3), replacing `CModal` +
 * `CModalHeader` + `CModalTitle`.
 *
 * Renders **nothing at all when closed** — `CModal` unmounted its content, and
 * this file's own tests assert `queryByRole("heading", …)` is null once the
 * modal closes after a successful grant.
 *
 * ESC closes (CoreUI's `keyboard` default). No focus trap — an accepted,
 * documented gap in ADR-0042.
 *
 * Deliberately duplicated from `pages/workflows/OrgHome.tsx`'s own local
 * `Modal` rather than shared: `components/shared/` is a different agent's
 * surface in this migration, and ADR-0023's bucket rules mean promoting this
 * is its own decision, not a side effect of a markup swap. Worth extracting
 * in a follow-up once every screen's modal has landed.
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

interface RoleAssignmentsPanelProps {
  orgId: string;
}

function RoleAssignmentsPanel({ orgId }: RoleAssignmentsPanelProps) {
  const [assignments, setAssignments] = useState<RoleAssignmentSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const [showModal, setShowModal] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NewRoleAssignmentFormValues>({
    resolver: zodResolver(newRoleAssignmentSchema),
    defaultValues: { actorId: "", roleId: "", scope: "org-wide", projectId: "" },
  });
  const scope = watch("scope");

  const loadAssignments = useCallback(
    async (targetPage: number, targetPageSize: number) => {
      setLoading(true);
      setLoadError(null);
      try {
        const [assignmentResponse, roleRows] = await Promise.all([
          listRoleAssignments(orgId, { page: targetPage, page_size: targetPageSize }),
          listRoles(orgId),
        ]);
        setAssignments(assignmentResponse.items);
        setTotal(assignmentResponse.total);
        setRoles(roleRows);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    void loadAssignments(page, pageSize);
  }, [loadAssignments, page, pageSize]);

  function roleName(roleId: string): string {
    return roles.find((role) => role.id === roleId)?.name ?? roleId;
  }

  function openModal() {
    setApiError(null);
    reset({ actorId: "", roleId: "", scope: "org-wide", projectId: "" });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  async function onSubmit(values: NewRoleAssignmentFormValues) {
    setApiError(null);
    try {
      await createRoleAssignment(orgId, {
        actor_id: values.actorId,
        role_id: values.roleId,
        ...(values.scope === "project-scoped" && values.projectId ? { project_id: values.projectId } : {}),
      });
      // Re-fetch (rather than locally append) so `total`/the page-size
      // selector's pagination stay correct — a locally-appended row would
      // silently understate `total` by one until the next real fetch.
      setPage(1);
      await loadAssignments(1, pageSize);
      closeModal();
    } catch (err) {
      if (err instanceof ApiError) {
        const actorIdError = fieldError(err, "actor_id");
        const roleIdError = fieldError(err, "role_id");
        const projectIdError = fieldError(err, "project_id");
        if (actorIdError) {
          setError("actorId", { type: "server", message: actorIdError });
        } else if (roleIdError) {
          setError("roleId", { type: "server", message: roleIdError });
        } else if (projectIdError) {
          setError("projectId", { type: "server", message: projectIdError });
        } else {
          setApiError(err.message);
        }
      } else {
        setApiError("Something went wrong. Please try again.");
      }
    }
  }

  return (
    <div className="card mt-4">
      <div className="card-body p-4">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="fs-5 mb-0">Role Assignments</h2>
          <button type="button" className="btn btn-primary" onClick={openModal}>
            New Role Assignment
          </button>
        </div>

        {loading ? (
          // `CSpinner` carried `role="status"` implicitly (ADR-0042 §4.5.5) — a raw div must say so.
          <div className="spinner-border spinner-border-sm" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        ) : loadError ? (
          <div className="alert alert-danger" role="alert">
            {loadError}
          </div>
        ) : assignments.length === 0 ? (
          <p className="text-body-secondary mb-0">No role assignments yet.</p>
        ) : (
          <Table
            mode="server"
            items={assignments}
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            rowKey={(assignment) => assignment.id}
            testIdPrefix="role-assignment-table"
            columns={
              <tr>
                <th scope="col">Actor</th>
                <th scope="col">Role</th>
                <th scope="col">Scope</th>
              </tr>
            }
            renderRow={(assignment) => (
              <tr key={assignment.id}>
                <td className="font-monospace small">{assignment.actor_id}</td>
                <td>{roleName(assignment.role_id)}</td>
                <td>
                  {assignment.project_id ? (
                    <span className="font-monospace small">Project {assignment.project_id}</span>
                  ) : (
                    "Org-wide"
                  )}
                </td>
              </tr>
            )}
          />
        )}
      </div>

      <Modal visible={showModal} onClose={closeModal} title="New Role Assignment">
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="modal-body">
            <div className="mb-3">
              <label className="form-label" htmlFor="actorId">
                Actor id
              </label>
              <input
                id="actorId"
                type="text"
                className={`form-control${errors.actorId ? " is-invalid" : ""}`}
                placeholder="00000000-0000-0000-0000-000000000000"
                {...register("actorId")}
              />
              {/* No `role="alert"` on these feedback blocks — `CFormFeedback` had none, and adding one here would multiply alert-role nodes. */}
              {errors.actorId && (
                <div className="invalid-feedback d-block">{errors.actorId.message}</div>
              )}
              <div className="form-text">
                The User or AIAgent id to grant this role to — no member/agent picker exists yet, paste the id
                directly.
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="roleId">
                Role
              </label>
              <select
                id="roleId"
                className={`form-select${errors.roleId ? " is-invalid" : ""}`}
                {...register("roleId")}
              >
                <option value="">Select a role…</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                    {role.is_system_role ? "" : " (custom)"}
                  </option>
                ))}
              </select>
              {errors.roleId && (
                <div className="invalid-feedback d-block">{errors.roleId.message}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="scope">
                Scope
              </label>
              <select id="scope" className="form-select" {...register("scope")}>
                <option value="org-wide">Org-wide (every project)</option>
                <option value="project-scoped">Project-scoped</option>
              </select>
            </div>

            {scope === "project-scoped" && (
              <div className="mb-3">
                <label className="form-label" htmlFor="projectId">
                  Project id
                </label>
                <input
                  id="projectId"
                  type="text"
                  className={`form-control${errors.projectId ? " is-invalid" : ""}`}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  {...register("projectId")}
                />
                {errors.projectId && (
                  <div className="invalid-feedback d-block">{errors.projectId.message}</div>
                )}
              </div>
            )}

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
              {isSubmitting ? "Granting..." : "Grant"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default RoleAssignmentsPanel;
