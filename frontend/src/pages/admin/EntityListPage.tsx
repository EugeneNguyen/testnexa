/**
 * ADR-0025: one of the surface's two page components. Route:
 * `/orgs/:orgId/admin/:entity` (8 org/global entities) or
 * `/projects/:projectId/admin/:entity` (20 project-scoped entities) —
 * `App.tsx` routes both shapes here, `useAdminRouteContext` tells them
 * apart generically (no per-entity branch in this file).
 *
 * UI Design Document §2/§4: resolves scope (`useEntityScope`), fires
 * `EntityTable`'s list query once scope is ready, hosts the "New" button +
 * create modal (`EntityForm` create mode renders inside a modal here,
 * per §2 — only `update` gets its own route, `EntityFormPage`), and gates
 * every action behind `usePermissions` (§5) — a `<resource>.create`/
 * `.update`/`.delete` gap makes the corresponding affordance absent, not
 * disabled.
 *
 * **ADR-0042 (CoreUI -> AdminLTE v4):** raw Bootstrap 5 markup now.
 * `CContainer fluid` -> `<div class="container-fluid">`, `CCard`/`CCardBody`
 * -> `<div class="card">`/`<div class="card-body">`, `CAlert` -> `<div
 * class="alert alert-*" role="alert">`, `CButton` -> `<button class="btn
 * btn-*">`, and the two `CModal`s -> the local `AdminModal` helper below
 * (hand-rolled Bootstrap modal markup + backdrop; see its own docstring for
 * the two behavioral deltas from `CModal`).
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "../../auth/usePermissions";
import EntityForm from "../../components/crud/EntityForm";
import EntityTable from "../../components/crud/EntityTable";
import ScopeSelector from "../../components/crud/ScopeSelector";
import { ApiError } from "../../lib/api/client";
import { createEntity, deleteEntity, EntityRow, listEntities } from "../../lib/api/entityCrud";
import { useAdminRouteContext } from "./useAdminRouteContext";
import { useEntityScope } from "./useEntityScope";

/**
 * DS-2/ADR-0041: this used to be a hardcoded `const PAGE_SIZE = 25` with no
 * way for a user to change it. It's now the *initial* value of real state,
 * driven by the shared container's "Rows per page" selector (10/25/50/100).
 * Still 25, so an admin who never touches the selector sees no change; the
 * backend's ceiling was raised 25 -> 100 in the same story so the 100 option
 * isn't silently clamped. Component state only — deliberately not persisted
 * across navigation or reload (TC-DS-018).
 */
const DEFAULT_PAGE_SIZE = 25;

/**
 * ADR-0042: hand-rolled replacement for `CModal` + `CModalHeader`/
 * `CModalTitle`/`CModalBody`/`CModalFooter`. Extracted rather than inlined
 * twice because this page renders two modals (create, delete-confirm).
 *
 * Deliberate parity choices:
 * - **Renders nothing at all when closed** — `queryByText(...)`-is-null
 *   assertions and the e2e specs' `.modal-content` locators both depend on
 *   the closed modal contributing no DOM, which is what `CModal` effectively
 *   did for test purposes.
 * - **ESC closes**, matching `CModal`'s own default `keyboard` behavior. The
 *   listener is bound only while open and removed on close/unmount.
 * - The header's close `<button class="btn-close" aria-label="Close">` is
 *   kept — `CModalHeader` rendered one by default and it is the only way to
 *   dismiss the create modal besides its own Cancel button.
 *
 * Deliberate gaps, accepted in ADR-0042 rather than reimplemented: no focus
 * trap, no focus restore on close, no backdrop-click-to-close (`CModal`'s
 * `backdrop="static"`-off default did close on backdrop click; the backdrop
 * here is inert, so ESC and the explicit buttons are the dismissal paths).
 */
function AdminModal({
  visible,
  title,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
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
      <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id={titleId}>
                {title}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

function fieldErrorsFrom(error: unknown): Record<string, string> | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  const body = error.body as { field_errors?: Record<string, string[]> } | undefined;
  if (!body?.field_errors) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(body.field_errors).map(([field, messages]) => [field, messages[0]]));
}

function EntityListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { entityKey, config, orgId, projectId, routeParams } = useAdminRouteContext();
  const { scope, onScopeSelectorResolved } = useEntityScope(config, routeParams);
  const permissions = usePermissions(orgId);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  const [rowPendingDelete, setRowPendingDelete] = useState<EntityRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canList = Boolean(config?.methods.includes("list"));
  const scopeParams = scope.field && scope.value ? { [scope.field]: scope.value } : {};

  const listQuery = useQuery({
    queryKey: ["entity-list", entityKey, scope.field, scope.value, page, pageSize, filters, search],
    queryFn: () =>
      listEntities(config!, routeParams, {
        page,
        pageSize,
        q: search || undefined,
        params: { ...filters, ...scopeParams },
      }),
    enabled: canList && scope.ready,
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => createEntity(config!, routeParams, values),
    onSuccess: () => {
      setShowCreateModal(false);
      setCreateError(null);
      setCreateFieldErrors(undefined);
      void queryClient.invalidateQueries({ queryKey: ["entity-list", entityKey] });
    },
    onError: (error: unknown) => {
      const fieldErrors = fieldErrorsFrom(error);
      if (fieldErrors) {
        setCreateFieldErrors(fieldErrors);
      } else {
        setCreateError(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (row: EntityRow) => deleteEntity(config!, String(row.id)),
    onSuccess: () => {
      setRowPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["entity-list", entityKey] });
    },
    onError: (error: unknown) => {
      setDeleteError(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    },
  });

  if (!config) {
    return (
      <div className="container-fluid px-4 py-4 h-100">
        <div className="card h-100">
          <div className="card-body">
            <div className="alert alert-danger" role="alert">
              Unknown admin entity &quot;{entityKey}&quot;.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const canCreate = config.methods.includes("create") && permissions.has(`${config.resource}.create`, projectId);

  return (
    <div className="container-fluid px-4 py-4 h-100">
      <div className="card h-100">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="fs-4 mb-0">{entityKey.replace(/-/g, " ")}</h1>
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              New
            </button>
          )}
        </div>

        {!canList ? (
          <div className="alert alert-info" role="alert">
            Listing is not available for this entity through the admin surface — see this entity's own config file
            for why.
          </div>
        ) : config.scopeSelector && !scope.ready ? (
          <ScopeSelector
            options={config.scopeSelector}
            onResolved={onScopeSelectorResolved}
            extraParams={projectId ? { project_id: projectId } : undefined}
          />
        ) : (
          <EntityTable
            config={config}
            rows={listQuery.data?.items ?? []}
            total={listQuery.data?.total ?? 0}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            loading={listQuery.isLoading}
            loadError={listQuery.isError ? "Something went wrong. Please try again." : null}
            filters={filters}
            onFilterChange={(field, value) => {
              setPage(1);
              setFilters((prev) => ({ ...prev, [field]: value }));
            }}
            search={search}
            onSearchChange={(value) => {
              setPage(1);
              setSearch(value);
            }}
            canEditRow={() => permissions.has(`${config.resource}.update`, projectId)}
            canDeleteRow={() => permissions.has(`${config.resource}.delete`, projectId)}
            onEdit={(row) => navigate(`${row.id}/edit`)}
            onDelete={(row) => {
              setDeleteError(null);
              setRowPendingDelete(row);
            }}
          />
        )}
      </div>

      <AdminModal
        visible={showCreateModal}
        title={<>New {entityKey.replace(/-/g, " ")}</>}
        onClose={() => setShowCreateModal(false)}
      >
        <EntityForm
          config={config}
          mode="create"
          lockedValues={scope.field && scope.value ? { [scope.field]: scope.value } : undefined}
          submitError={createError}
          serverFieldErrors={createFieldErrors}
          onCancel={() => setShowCreateModal(false)}
          onSubmit={async (values) => {
            await createMutation.mutateAsync(values);
          }}
        />
      </AdminModal>

      <AdminModal
        visible={Boolean(rowPendingDelete)}
        title="Delete record"
        onClose={() => setRowPendingDelete(null)}
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setRowPendingDelete(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={deleteMutation.isPending}
              onClick={() => rowPendingDelete && deleteMutation.mutate(rowPendingDelete)}
            >
              Delete
            </button>
          </>
        }
      >
        {deleteError && (
          <div className="alert alert-danger" role="alert">
            {deleteError}
          </div>
        )}
        Are you sure you want to delete this record? This cannot be undone.
      </AdminModal>
      </div>
    </div>
  );
}

export default EntityListPage;
