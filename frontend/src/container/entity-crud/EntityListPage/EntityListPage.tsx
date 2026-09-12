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
 * **ADR-0060:** optional `entityKeyOverride` prop, for a route with no
 * `:entity` segment at all (`/orgs/:orgId/projects`, `Project`'s
 * retired-`ProjectsPage` replacement) — passed straight through to
 * `useAdminRouteContext`. Every other mount omits it and behaves exactly as
 * before.
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
import { usePermissions } from "../../../auth/usePermissions";
import EntityForm from "../../../components/organisms/entity-form";
import EntityTable from "../../../components/organisms/entity-table";
import ScopeSelector from "../../../components/molecules/scope-selector";
import { ApiError } from "../../../lib/api/client";
import { createEntity, deleteEntity, EntityRow, listEntities } from "../../../lib/api/entityCrud";
import { useAdminRouteContext } from "../../../pages/admin/useAdminRouteContext";
import { useEntityScope } from "../../../pages/admin/useEntityScope";

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

function EntityListPage({ entityKeyOverride }: { entityKeyOverride?: string } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { entityKey, config, label, schemaLoading, orgId, projectId, routeParams } =
    useAdminRouteContext(entityKeyOverride);
  const { scope, onScopeSelectorResolved } = useEntityScope(config, routeParams);
  const permissions = usePermissions(orgId);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // ADR-0053 (sort): `null` = unsorted (today's pre-sort DB-default order).
  // Component state only, same posture as `page`/`pageSize`/`filters` above —
  // not persisted across navigation or reload.
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  const [rowPendingDelete, setRowPendingDelete] = useState<EntityRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canList = Boolean(config?.methods.includes("list"));
  const scopeParams = scope.field && scope.value ? { [scope.field]: scope.value } : {};

  const sortParam = sort ? `${sort.dir === "desc" ? "-" : ""}${sort.field}` : undefined;

  const listQuery = useQuery({
    queryKey: ["entity-list", entityKey, scope.field, scope.value, page, pageSize, filters, search, sortParam],
    queryFn: () =>
      listEntities(config!, routeParams, {
        page,
        pageSize,
        q: search || undefined,
        sort: sortParam,
        params: { ...filters, ...scopeParams },
      }),
    enabled: canList && scope.ready,
  });

  /**
   * Click-header-to-sort toggle: unsorted -> ascending -> descending ->
   * unsorted; clicking a *different* column always starts fresh at ascending.
   * Resets to page 1, same as changing a filter/search term — a sort change
   * is a new result set, not a new page of the old one.
   */
  function handleSortChange(field: string) {
    setPage(1);
    setSort((prev) => {
      if (!prev || prev.field !== field) {
        return { field, dir: "asc" };
      }
      return prev.dir === "asc" ? { field, dir: "desc" } : null;
    });
  }

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

  /**
   * ADR-0053: the entity's field shape is fetched now
   * (`GET /entities/{resource}/schema`), so `config` is legitimately
   * `undefined` for one round trip on every admin page load. Without this
   * branch that state is indistinguishable from an unknown `:entity` and the
   * page would flash the "Unknown admin entity" error before the schema
   * lands. Same `spinner-border role="status"` pattern `EntityFormPage`
   * already uses for its own item fetch.
   */
  if (schemaLoading) {
    return (
      <div className="container-fluid px-4 py-4 h-100">
        <div className="card h-100">
          <div className="card-body">
            <div className="d-flex justify-content-center py-4">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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

  const pageTitle = label ?? entityKey.replace(/-/g, " ");

  return (
    <div className="container-fluid px-4 py-4 h-100">
      {!canList ? (
        <div className="card h-100">
          <div className="card-header">
            <h3 className="card-title">{pageTitle}</h3>
          </div>
          <div className="card-body">
            <div className="alert alert-info" role="alert">
              Listing is not available for this entity through the admin surface — its served schema does not include
              the &quot;list&quot; method.
            </div>
          </div>
        </div>
      ) : config.scopeSelector && !scope.ready ? (
        <div className="card h-100">
          <div className="card-header">
            <h3 className="card-title">{pageTitle}</h3>
          </div>
          <div className="card-body">
            <ScopeSelector
              options={config.scopeSelector}
              onResolved={onScopeSelectorResolved}
              extraParams={projectId ? { project_id: projectId } : undefined}
            />
          </div>
        </div>
      ) : (
        <EntityTable
          title={pageTitle}
          headerActions={
            canCreate && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
                New
              </button>
            )
          }
          config={config}
          rows={listQuery.data?.items ?? []}
          total={listQuery.data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sortField={sort?.field}
          sortDir={sort?.dir}
          onSortChange={handleSortChange}
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

      <AdminModal
        visible={showCreateModal}
        title={<>New {label ?? entityKey.replace(/-/g, " ")}</>}
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
  );
}

export default EntityListPage;
