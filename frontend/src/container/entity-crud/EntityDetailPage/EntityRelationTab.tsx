/**
 * [ADR-0071](../../../../../docs/adr/0071-entity-detail-relationship-tabs.md):
 * the panel behind one relationship tab on `EntityDetailPage` — the related
 * entity's rows, scoped to the record being viewed.
 *
 * ## It is a thin adapter, not a second table
 *
 * Everything visible here is `EntityTable` (ADR-0023/ADR-0053), driven by the
 * related entity's *own* fetched schema — so a relationship tab gets that
 * entity's real columns, its fk-label resolution, its enum badges, its date
 * formatting and its pagination for free, and stays correct when a backend
 * field is added. This component's entire job is to turn one
 * `EntityRelation` into the two things `EntityTable` can't know: which list
 * request to fire, and which column to suppress.
 *
 * ## Why the scoping column is hidden
 *
 * `relation.scopeField` holds the same value — the parent record's id — on
 * every row in this tab, by construction: it *is* the filter. Rendering it
 * would spend a column repeating the record you are already looking at. It is
 * suppressed by handing `EntityTable` a config whose copy of that field has
 * `showInTable: false` — reusing the filter the component already applies,
 * rather than teaching it a new "hidden columns" prop for one caller.
 *
 * The field stays in `fields` (only its flag changes), so it is still part of
 * the fk-schema fetch list `useFkLabels` walks — narrowing that would be a
 * silent behavior change, the same reasoning ADR-0070 gives for
 * `useFkLabels`' two separate field arguments.
 *
 * ## Where a row click goes
 *
 * - **one-to-many** — the listed row *is* the record: open its own detail page.
 * - **many-to-many** — the listed row is one of ADR-0005's link rows, which is
 *   bookkeeping, not the thing the user clicked a "Test cases" tab to see. So
 *   the click follows `relation.targetField` to the far record's id and opens
 *   *that* entity's detail page instead.
 *
 * Both destinations are built from the current admin route's own prefix
 * (`/orgs/:orgId/admin` or `/projects/:projectId/admin`), so a relationship
 * tab navigates within the scope the user is already in.
 */
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, EntityTable, Spinner } from "../../../components";
import { EntityConfig, EntityRelation } from "../../../entityConfigs/types";
import { listEntities } from "../../../lib/api/entityCrud";
import { useEntitySchema } from "../../../pages/admin/useEntitySchema";

export interface EntityRelationTabProps {
  relation: EntityRelation;
  /** The id of the record whose detail page this tab is on. */
  parentId: string;
  /** `{orgId, projectId}` — for `:param` interpolation and the route prefix. */
  routeParams: Record<string, string | undefined>;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * Hide the scoping column without mutating the shared, react-query-cached
 * config object — `useEntitySchema` hands out the same reference to every
 * consumer, so flipping the flag in place would silently hide that column on
 * the entity's own list page too.
 */
export function hideScopeColumn(config: EntityConfig, scopeField: string): EntityConfig {
  return {
    ...config,
    fields: config.fields.map((field) =>
      field.name === scopeField ? { ...field, showInTable: false } : field,
    ),
  };
}

/**
 * `/orgs/:orgId/admin` or `/projects/:projectId/admin` — whichever scope the
 * user is currently in. Mirrors `entityCrudRoutes()`'s own two mounts; a
 * relationship tab never navigates across scopes.
 */
export function adminBasePath(routeParams: Record<string, string | undefined>): string {
  return routeParams.projectId
    ? `/projects/${routeParams.projectId}/admin`
    : `/orgs/${routeParams.orgId}/admin`;
}

function EntityRelationTab({
  relation,
  parentId,
  routeParams,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: EntityRelationTabProps) {
  const navigate = useNavigate();
  const { config, isLoading: schemaLoading } = useEntitySchema(relation.entity);

  const listQuery = useQuery({
    queryKey: ["entity-relation-list", relation.entity, relation.scopeField, parentId, page, pageSize],
    queryFn: () =>
      listEntities(config as EntityConfig, routeParams, {
        page,
        pageSize,
        params: { [relation.scopeField]: parentId },
      }),
    enabled: Boolean(config) && Boolean(parentId),
  });

  if (schemaLoading || !config) {
    return (
      <Card className="h-100">
        <Card.Body>
          {schemaLoading ? (
            <Spinner wrapperClassName="py-4" />
          ) : (
            <Alert color="danger" data-testid="entity-relation-schema-error">
              Could not load the schema for related records.
            </Alert>
          )}
        </Card.Body>
      </Card>
    );
  }

  return (
    <EntityTable
      title={relation.label}
      config={hideScopeColumn(config, relation.scopeField)}
      rows={listQuery.data?.items ?? []}
      total={listQuery.data?.total ?? 0}
      page={page}
      pageSize={pageSize}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      loading={listQuery.isLoading}
      loadError={listQuery.isError ? "Something went wrong. Please try again." : null}
      /**
       * Read-only by design, matching the page it sits on: no Edit, no
       * Delete, no New. Omitting `onEdit`/`onDelete` is what makes
       * `EntityTable` drop the Actions column entirely — a relationship tab
       * is a view onto related records, and every one of them is fully
       * editable on its own screen.
       */
      onRowClick={(row) => {
        const targetId =
          relation.targetField !== null ? row[relation.targetField] : row.id;
        if (targetId === undefined || targetId === null) {
          return;
        }
        navigate(`${adminBasePath(routeParams)}/${relation.targetEntity}/${String(targetId)}`);
      }}
    />
  );
}

export default EntityRelationTab;
