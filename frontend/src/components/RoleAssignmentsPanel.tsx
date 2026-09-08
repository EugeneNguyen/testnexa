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
 * Built with CoreUI (ADR-0012).
 */
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CAlert,
  CButton,
  CCard,
  CCardBody,
  CForm,
  CFormFeedback,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormText,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
  CTableDataCell,
  CTableHeaderCell,
  CTableRow,
} from "@coreui/react";
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
    <CCard className="mt-4">
      <CCardBody className="p-4">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="fs-5 mb-0">Role Assignments</h2>
          <CButton color="primary" onClick={openModal}>
            New Role Assignment
          </CButton>
        </div>

        {loading ? (
          <CSpinner size="sm" />
        ) : loadError ? (
          <CAlert color="danger" role="alert">
            {loadError}
          </CAlert>
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
              <CTableRow>
                <CTableHeaderCell>Actor</CTableHeaderCell>
                <CTableHeaderCell>Role</CTableHeaderCell>
                <CTableHeaderCell>Scope</CTableHeaderCell>
              </CTableRow>
            }
            renderRow={(assignment) => (
              <CTableRow key={assignment.id}>
                <CTableDataCell className="font-monospace small">{assignment.actor_id}</CTableDataCell>
                <CTableDataCell>{roleName(assignment.role_id)}</CTableDataCell>
                <CTableDataCell>
                  {assignment.project_id ? (
                    <span className="font-monospace small">Project {assignment.project_id}</span>
                  ) : (
                    "Org-wide"
                  )}
                </CTableDataCell>
              </CTableRow>
            )}
          />
        )}
      </CCardBody>

      <CModal visible={showModal} onClose={closeModal}>
        <CModalHeader>
          <CModalTitle>New Role Assignment</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmit(onSubmit)} noValidate>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="actorId">Actor id</CFormLabel>
              <CFormInput
                id="actorId"
                type="text"
                placeholder="00000000-0000-0000-0000-000000000000"
                invalid={!!errors.actorId}
                {...register("actorId")}
              />
              {errors.actorId && <CFormFeedback invalid>{errors.actorId.message}</CFormFeedback>}
              <CFormText>
                The User or AIAgent id to grant this role to — no member/agent picker exists yet, paste the id
                directly.
              </CFormText>
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="roleId">Role</CFormLabel>
              <CFormSelect id="roleId" invalid={!!errors.roleId} {...register("roleId")}>
                <option value="">Select a role…</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                    {role.is_system_role ? "" : " (custom)"}
                  </option>
                ))}
              </CFormSelect>
              {errors.roleId && <CFormFeedback invalid>{errors.roleId.message}</CFormFeedback>}
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="scope">Scope</CFormLabel>
              <CFormSelect id="scope" {...register("scope")}>
                <option value="org-wide">Org-wide (every project)</option>
                <option value="project-scoped">Project-scoped</option>
              </CFormSelect>
            </div>

            {scope === "project-scoped" && (
              <div className="mb-3">
                <CFormLabel htmlFor="projectId">Project id</CFormLabel>
                <CFormInput
                  id="projectId"
                  type="text"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  invalid={!!errors.projectId}
                  {...register("projectId")}
                />
                {errors.projectId && <CFormFeedback invalid>{errors.projectId.message}</CFormFeedback>}
              </div>
            )}

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
              {isSubmitting ? "Granting..." : "Grant"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>
    </CCard>
  );
}

export default RoleAssignmentsPanel;
