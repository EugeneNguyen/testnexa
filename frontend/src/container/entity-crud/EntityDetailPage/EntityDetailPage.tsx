/**
 * [ADR-0070](../../../../../docs/adr/0070-generic-entity-detail-page.md): the
 * generic admin CRUD surface's **third** page component — a read-only record
 * view showing *every* field of one entity row, reached by clicking a row in
 * `EntityListPage`'s table.
 *
 * (ADR-0025 originally scoped this surface to exactly two page components,
 * `EntityListPage` + `EntityFormPage`. ADR-0070 extends that to three — see
 * that ADR for why a read view is not the same thing as the edit form.)
 *
 * Routes, added by `entityCrudRoutes()` alongside the existing list/edit pair:
 * `/orgs/:orgId/admin/:entity/:id` and `/projects/:projectId/admin/:entity/:id`.
 *
 * ## Why this isn't just "the edit form, disabled"
 *
 * `EntityTable` renders only `showInTable !== false` columns, and
 * `EntityForm` renders only fields the API will actually *accept* — so for six
 * entities today (`TestPlan`'s `scope`/`approach`/`staffing_and_training`/
 * `schedule`, `TestCase`'s `preconditions`/`expected_result`, `Defect`'s
 * `reported_by_actor_id`, `TestExecution`'s `actual_result`/
 * `executed_by_actor_id`, `RiskItem`'s `mitigation`, plus every entity's
 * `created_by_actor_id`) there was **no screen anywhere in the app** that
 * showed the value. This page renders `config.fields` **unfiltered** — that
 * single missing `.filter(...)` is the whole feature, and it is what makes it
 * generic across all 28 entities with no per-entity branch.
 *
 * ## Genericity
 *
 * Everything here is driven by the fetched schema (`useAdminRouteContext` ->
 * `useEntitySchema`, ADR-0053) plus one `GET {path}/{id}` (`getEntity`). There
 * is no per-entity `if`. Field *values* render through the shared
 * `EntityFieldValue` molecule — the same fk-label lookup, enum/boolean badges
 * and date formatting `EntityTable`'s cells use, so a value reads identically
 * in both places (ADR-0070's own reuse extraction, not a second renderer).
 *
 * Every entity in the registry supports `get` (verified against the live
 * `GET /entities/{resource}/schema` for all 28, plus `Release`'s static
 * config), so there is no "this entity has no detail view" branch to write.
 * The `!config.methods.includes("get")` guard is kept anyway, matching
 * `EntityListPage`'s own `canList` posture — a future entity could be served
 * without it and must degrade to a message, not a failed fetch.
 *
 * ## Tabs ([ADR-0071](../../../../../docs/adr/0071-entity-detail-relationship-tabs.md))
 *
 * The page opens on an **Info** tab — the all-fields view described above,
 * unchanged — followed by one tab per *inbound* relationship the backend
 * reports in `config.relations` (`crud_factory.derive_entity_relations`). That
 * set is derived server-side by walking the whole entity registry, so this
 * component hard-codes no entity name and no relationship; an entity with none
 * renders no tab strip at all and is byte-for-byte the pre-ADR-0071 page.
 *
 * Many-to-**one** deliberately gets no tab — a field of *this* entity pointing
 * at a parent is already a labelled value on the Info tab, and a tab listing
 * exactly one row would be a worse way to show it.
 *
 * The active tab lives in the URL (`?tab=`), not component state, so a tab is
 * shareable and survives a reload — the same deep-link posture that made
 * ADR-0070 fetch its own row rather than reuse the list's in-memory copy. An
 * unknown or absent `?tab=` falls back to Info rather than erroring.
 *
 * ## Markup
 *
 * Same shell every sibling admin page uses (`container-fluid px-4 py-4 h-100`)
 * plus the `Card` atom. **The card is no longer the container's sole child** —
 * the tab strip is a sibling above it — so per `frontend/CLAUDE.md`'s own rule
 * a bare `h-100` on the card would overflow the container by exactly the
 * strip's height. The container is `d-flex flex-column` and the panel below
 * the strip is `flex-grow-1`, which is that rule's own documented fix for
 * precisely this shape. The field list is a stock Bootstrap 5
 * `<dl className="row">` (`dt.col-sm-3` / `dd.col-sm-9`), not an invented
 * class — per ADR-0042's "use the library's own documented class names
 * verbatim" rule.
 */
import { Fragment, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "../../../auth/usePermissions";
import { Alert, Button, Card, EntityFieldValue, Spinner, Tabs, panelId } from "../../../components";
import { EntityRelation } from "../../../entityConfigs/types";
import { EntityRow, getEntity } from "../../../lib/api/entityCrud";
import { useAdminRouteContext } from "../../../pages/admin/useAdminRouteContext";
import { useFkLabels } from "../../../pages/admin/useFkLabels";
import EntityRelationTab from "./EntityRelationTab";

const EMPTY_ROWS: EntityRow[] = [];
const INFO_TAB = "info";
const TAB_TEST_ID_PREFIX = "entity-detail";
const RELATION_PAGE_SIZE = 25;

/**
 * ADR-0071: a relationship's tab id. Keyed on the **listed** entity
 * (`relation.entity`), not on `targetEntity` or the label: `Requirement`
 * reaches `TestCondition` both directly and through a traceability link, so
 * those two tabs share a `targetEntity` and differ in label only by the
 * derivation's own `" (linked)"` suffix. `entity` is unique per relation by
 * construction — one parent cannot list the same entity twice through the
 * same scope field.
 */
export function relationTabId(relation: EntityRelation): string {
  return relation.entity;
}

/**
 * ADR-0070: `entityKeyOverride` mirrors `EntityListPage`/`EntityFormPage`'s own
 * ADR-0060 prop, for a future route with no `:entity` segment. No such mount
 * exists today — `Project`'s own detail view is the bespoke `ProjectDetail`
 * workspace, reached via `EntityConfig.detailPath` (ADR-0060), which this
 * page's row-click wiring deliberately defers to.
 */
function EntityDetailPage({ entityKeyOverride }: { entityKeyOverride?: string } = {}) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { entityKey, config, label, schemaLoading, orgId, projectId, routeParams } =
    useAdminRouteContext(entityKeyOverride);
  const permissions = usePermissions(orgId);

  /**
   * ADR-0071: paging state for whichever relationship tab is open — one pair
   * of values shared across tabs, reset on every switch. Per-tab paging would
   * have to be keyed by entity and carried around, for a read-only page
   * nobody navigates deeply from. Component state only, the same posture
   * `EntityListPage` takes for its own `page`/`pageSize`.
   */
  const [relationPage, setRelationPage] = useState(1);
  const [relationPageSize, setRelationPageSize] = useState(RELATION_PAGE_SIZE);

  const canGet = Boolean(config?.methods.includes("get"));

  const itemQuery = useQuery({
    queryKey: ["entity-item", entityKey, id],
    queryFn: () => getEntity<EntityRow>(config!, id as string),
    enabled: canGet && Boolean(config) && Boolean(id),
  });

  // Every field, not just the table's columns — that is the whole point of
  // this page. `config.fields` doubles as the ref-schema fetch list, same
  // contract `EntityTable` passes.
  const fields = config?.fields ?? [];
  const row = itemQuery.data;
  const fkLabels = useFkLabels(fields, row ? [row] : EMPTY_ROWS, fields);

  /**
   * ADR-0053: `config` is `undefined` for one round trip while
   * `GET /entities/{resource}/schema` is in flight, not only for an unknown
   * `:entity` — gate the error branch below on the fetch having actually
   * settled, or every detail page flashes "Unknown admin entity" first. Same
   * branch, same `Spinner` atom, as both sibling page components.
   */
  if (schemaLoading) {
    return (
      <div className="container-fluid px-4 py-4 h-100" data-testid="entity-detail-page">
        <Card className="h-100">
          <Card.Body>
            <Spinner wrapperClassName="py-4" />
          </Card.Body>
        </Card>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="container-fluid px-4 py-4 h-100" data-testid="entity-detail-page">
        <Card className="h-100">
          <Card.Body>
            <Alert color="danger">Unknown admin entity &quot;{entityKey}&quot;.</Alert>
          </Card.Body>
        </Card>
      </div>
    );
  }

  const pageTitle = label ?? entityKey.replace(/-/g, " ");
  const canEdit =
    config.methods.includes("update") && permissions.has(`${config.resource}.update`, projectId);

  /**
   * ADR-0071. `?tab=` is validated against the served relationship set rather
   * than trusted: a stale bookmark naming a relationship a later deploy no
   * longer serves must fall back to Info, not render an empty panel.
   */
  const relations = config.relations ?? [];
  const requestedTab = searchParams.get("tab");
  const activeTab =
    requestedTab && relations.some((relation) => relationTabId(relation) === requestedTab)
      ? requestedTab
      : INFO_TAB;
  const activeRelation = relations.find((relation) => relationTabId(relation) === activeTab);

  function selectTab(tabId: string) {
    // A different tab is a different result set, not a later page of the
    // current one — same reason `EntityListPage` resets to page 1 whenever a
    // filter/search/sort changes.
    setRelationPage(1);
    const next = new URLSearchParams(searchParams);
    if (tabId === INFO_TAB) {
      next.delete("tab");
    } else {
      next.set("tab", tabId);
    }
    // `replace` so tabbing around doesn't bury the list page under a dozen
    // history entries the Back button then has to walk back through.
    setSearchParams(next, { replace: true });
  }

  const infoPanel = (
    <Card className="h-100">
      <Card.Header className="d-flex flex-wrap align-items-center justify-content-between">
        <Card.Title as="h1" className="fs-4 mb-0">
          {pageTitle} details
        </Card.Title>
        <div className="card-tools d-flex flex-wrap align-items-center gap-2 ms-auto">
          <Button outline color="secondary" data-testid="entity-detail-back" onClick={() => navigate(-1)}>
            Back
          </Button>
          {canEdit && (
            <Button color="primary" data-testid="entity-detail-edit" onClick={() => navigate("edit")}>
              Edit
            </Button>
          )}
        </div>
      </Card.Header>

      {!canGet ? (
        <Card.Body>
          <Alert color="info" data-testid="entity-detail-unsupported">
            A detail view is not available for this entity through the admin surface — its served schema
            does not include the &quot;get&quot; method.
          </Alert>
        </Card.Body>
      ) : itemQuery.isLoading ? (
        <Card.Body>
          <Spinner wrapperClassName="py-4" />
        </Card.Body>
      ) : itemQuery.isError ? (
        <Card.Body>
          <Alert color="danger" data-testid="entity-detail-error">
            Something went wrong loading this record.
          </Alert>
        </Card.Body>
      ) : (
        <Card.Body>
          <dl className="row mb-0" data-testid="entity-detail-fields">
            <dt className="col-sm-3 text-body-secondary" data-testid="entity-detail-label-id">
              ID
            </dt>
            <dd className="col-sm-9" data-testid="entity-detail-field-id">
              {String(row?.id ?? id)}
            </dd>

            {fields.map((field) => (
              <Fragment key={field.name}>
                <dt
                  className="col-sm-3 text-body-secondary"
                  data-testid={`entity-detail-label-${field.name}`}
                >
                  {field.label}
                </dt>
                <dd className="col-sm-9" data-testid={`entity-detail-field-${field.name}`}>
                  <EntityFieldValue
                    field={field}
                    row={row ?? {}}
                    fkLabels={fkLabels}
                    config={config}
                    linkDetailField={false}
                  />
                </dd>
              </Fragment>
            ))}
          </dl>
        </Card.Body>
      )}
    </Card>
  );

  return (
    <div className="container-fluid px-4 py-4 h-100 d-flex flex-column" data-testid="entity-detail-page">
      {relations.length > 0 && (
        <Tabs
          testIdPrefix={TAB_TEST_ID_PREFIX}
          activeId={activeTab}
          onSelect={selectTab}
          items={[
            { id: INFO_TAB, label: "Info" },
            ...relations.map((relation) => ({ id: relationTabId(relation), label: relation.label })),
          ]}
        />
      )}

      <div
        className="flex-grow-1"
        role={relations.length > 0 ? "tabpanel" : undefined}
        id={relations.length > 0 ? panelId(TAB_TEST_ID_PREFIX, activeTab) : undefined}
      >
        {activeRelation ? (
          <EntityRelationTab
            relation={activeRelation}
            parentId={String(id)}
            routeParams={routeParams}
            page={relationPage}
            onPageChange={setRelationPage}
            pageSize={relationPageSize}
            onPageSizeChange={setRelationPageSize}
          />
        ) : (
          infoPanel
        )}
      </div>
    </div>
  );
}

export default EntityDetailPage;
