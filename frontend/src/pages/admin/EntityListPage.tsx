/**
 * ADR-0025: one of the surface's two page components. Route:
 * `/orgs/:orgId/admin/:entity` (8 org/global entities) or
 * `/projects/:projectId/admin/:entity` (20 project-scoped entities) —
 * `App.tsx` routes both shapes here, `useAdminRouteContext` tells them
 * apart generically (no per-entity branch in this file).
 *
 * UI Design Document §2/§4: resolves scope (`useEntityScope`), fires
 * `EntityTable`'s list query once scope is ready, hosts the "New" button +
 * create `CModal` (`EntityForm` create mode renders inside a modal here,
 * per §2 — only `update` gets its own route, `EntityFormPage`), and gates
 * every action behind `usePermissions` (§5) — a `<resource>.create`/
 * `.update`/`.delete` gap makes the corresponding affordance absent, not
 * disabled.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CAlert, CButton, CCard, CCardBody, CModal, CModalBody, CModalFooter, CModalHeader, CModalTitle } from "@coreui/react";
import { usePermissions } from "../../auth/usePermissions";
import EntityForm from "../../components/crud/EntityForm";
import EntityTable from "../../components/crud/EntityTable";
import ScopeSelector from "../../components/crud/ScopeSelector";
import { ApiError } from "../../lib/api/client";
import { createEntity, deleteEntity, EntityRow, listEntities } from "../../lib/api/entityCrud";
import { useAdminRouteContext } from "./useAdminRouteContext";
import { useEntityScope } from "./useEntityScope";

const PAGE_SIZE = 25;

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
    queryKey: ["entity-list", entityKey, scope.field, scope.value, page, filters, search],
    queryFn: () =>
      listEntities(config!, routeParams, {
        page,
        pageSize: PAGE_SIZE,
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
      <CCard>
        <CCardBody>
          <CAlert color="danger" role="alert">
            Unknown admin entity &quot;{entityKey}&quot;.
          </CAlert>
        </CCardBody>
      </CCard>
    );
  }

  const canCreate = config.methods.includes("create") && permissions.has(`${config.resource}.create`, projectId);

  return (
    <CCard>
      <CCardBody>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="fs-4 mb-0">{entityKey.replace(/-/g, " ")}</h1>
          {canCreate && (
            <CButton color="primary" onClick={() => setShowCreateModal(true)}>
              New
            </CButton>
          )}
        </div>

        {!canList ? (
          <CAlert color="info" role="alert">
            Listing is not available for this entity through the admin surface — see this entity's own config file
            for why.
          </CAlert>
        ) : config.scopeSelector && !scope.ready ? (
          <ScopeSelector options={config.scopeSelector} onResolved={onScopeSelectorResolved} />
        ) : (
          <EntityTable
            config={config}
            rows={listQuery.data?.items ?? []}
            total={listQuery.data?.total ?? 0}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
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
      </CCardBody>

      <CModal visible={showCreateModal} onClose={() => setShowCreateModal(false)}>
        <CModalHeader>
          <CModalTitle>New {entityKey.replace(/-/g, " ")}</CModalTitle>
        </CModalHeader>
        <CModalBody>
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
        </CModalBody>
      </CModal>

      <CModal visible={Boolean(rowPendingDelete)} onClose={() => setRowPendingDelete(null)}>
        <CModalHeader>
          <CModalTitle>Delete record</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {deleteError && (
            <CAlert color="danger" role="alert">
              {deleteError}
            </CAlert>
          )}
          Are you sure you want to delete this record? This cannot be undone.
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
            Delete
          </CButton>
        </CModalFooter>
      </CModal>
    </CCard>
  );
}

export default EntityListPage;
