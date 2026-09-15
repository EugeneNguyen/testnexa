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
 *
 * ## It renders card *sections*, not a card (ADR-0071's Amendment)
 *
 * This component is mounted inside `EntityDetailPage`'s single card, in the
 * `.tab-pane` of its `.card-body` — Tabler's documented "tabs in the card
 * header" pattern, where one card spans every tab. So it renders
 * `EntityTable` with `bare`, and its own schema-loading/error branch is a bare
 * `.card-body` too: a card of its own here would paint a second border and
 * shadow inside the page's card, and repeat the tab's label as a card title.
 * It is not a standalone mount — it expects a `.card` ancestor.
 *
 * ## Write actions ([ADR-0073](../../../../../docs/adr/0073-relationship-tab-write-actions.md))
 *
 * The tab is no longer read-only. Exactly one action renders per tab, decided
 * by `relation.kind` — never both, because the two kinds mean structurally
 * different things:
 *
 * - **one-to-many — "New <child>"**. The listed rows *are* child records, so
 *   the action creates one, through the same `EntityForm` create modal
 *   `EntityListPage` already hosts (ADR-0025's own "create renders in a modal,
 *   only update gets a route" decision, reused verbatim rather than routed to
 *   `EntityFormPage`, which is the `/edit` route only). `relation.scopeField`
 *   is passed as `lockedValues` — rendered as a disabled display field, kept
 *   out of the Zod schema, and merged into the payload by `EntityForm` itself
 *   — so the new row lands under *this* parent and the user cannot retarget it.
 *   That prop already existed for `EntityListPage`'s own scope-gated create;
 *   nothing new was needed to lock a field.
 * - **many-to-many — "Link existing <far entity>"**. The listed rows are link
 *   rows, so creating one means picking an existing far record, not filling a
 *   form. The parent id and the picked id are the entire request; both travel
 *   in the path of a bespoke route the backend declares as
 *   `config.linkCreate` (ADR-0073's `LinkCreateAction`) on the **link
 *   entity's** own schema — the same schema this tab already fetched to render
 *   the table, so the action costs no extra round trip and this component
 *   hard-codes no route.
 *
 * Both actions are gated twice, and the two gates answer different questions:
 * *can this API do it at all* (`config.methods`/`config.linkCreate`) and *may
 * this actor* (`usePermissions`, fail-closed while loading). A missing
 * permission makes the button **absent**, not disabled — UI Design Document
 * §5's hide-don't-disable posture, the same one `EntityListPage`'s `canCreate`
 * takes.
 *
 * ### Scoping the picker
 *
 * The far entity's own list route usually requires a scope value, and refusing
 * to supply one 422s (`extract_scope_value`). Resolved generically, never per
 * entity:
 *
 * 1. Far entity has no `scopeField` — search unscoped.
 * 2. Its `scopeField` is `project_id` and the route carries a `:projectId` —
 *    supply it. This is 9 of the 12 live link directions.
 * 3. Otherwise, if it declares a `scopeSelector`, render the shared
 *    `ScopeSelector` molecule *inside the modal, above the picker* — the same
 *    "pick a parent row before the list can fetch" step `EntityListPage` shows
 *    for the same entities, in the same component.
 *
 * One live direction (`TestCase` -> "Defects (linked)") lands in case 3 behind
 * `ScopeSelector`'s own **pre-existing** cascading-picker gap: `Defect`'s
 * selector searches `TestExecution`, which is itself scoped by `test_cycle_id`
 * rather than `project_id`, so the search comes back empty. That limitation is
 * documented by name in `scope-selector.tsx`'s own docstring, predates this
 * ADR, and is not worked around here. The same link is fully creatable from
 * the other end (`Defect` -> "Test cases (linked)", case 2), so the capability
 * is reachable; see ADR-0073's Consequences.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  EntityForm,
  EntityTable,
  FkAutocomplete,
  Modal,
  ScopeSelector,
  Spinner,
} from "../../../components";
import { usePermissions } from "../../../auth/usePermissions";
import { EntityConfig, EntityRelation } from "../../../entityConfigs/types";
import { ApiError } from "../../../lib/api/client";
import { createEntity, createLinkRow, listEntities } from "../../../lib/api/entityCrud";
import { useEntitySchema } from "../../../pages/admin/useEntitySchema";

export interface EntityRelationTabProps {
  relation: EntityRelation;
  /** The id of the record whose detail page this tab is on. */
  parentId: string;
  /** `{orgId, projectId}` — for `:param` interpolation and the route prefix. */
  routeParams: Record<string, string | undefined>;
  /**
   * ADR-0073: the resolved org, for `usePermissions`. Passed down rather than
   * re-resolved here — `useAdminRouteContext` already fetched it (on a
   * project-scoped route the URL carries no `:orgId` at all), and resolving it
   * twice would fire the same `GET /projects/{id}` again per tab.
   */
  orgId: string | undefined;
  /** ADR-0073: the project half of the same context, for project-scoped grants. */
  projectId: string | undefined;
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

/**
 * ADR-0073: which scope params the "Link existing ..." picker must send with
 * its search, given the far entity's own schema and the current route.
 *
 * Returns `null` when the far entity needs a scope the route cannot supply and
 * the caller must therefore show a `ScopeSelector` first; returns an object
 * (possibly empty) when the search can fire immediately. Exported for its own
 * unit test — the three cases are the whole of the picker's scoping rule and
 * are much cheaper to pin here than through three rendered modals.
 */
export function pickerScopeParams(
  farConfig: EntityConfig,
  projectId: string | undefined,
): Record<string, string> | null {
  const { scopeField } = farConfig;
  if (!scopeField) {
    return {};
  }
  if (scopeField === "project_id" && projectId) {
    return { project_id: projectId };
  }
  return farConfig.scopeSelector ? null : {};
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function EntityRelationTab({
  relation,
  parentId,
  routeParams,
  orgId,
  projectId,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: EntityRelationTabProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = usePermissions(orgId);
  const { config, isLoading: schemaLoading } = useEntitySchema(relation.entity);

  /**
   * ADR-0073: only the many-to-many branch needs the far entity's schema (to
   * scope and label the picker). Called unconditionally anyway — Rules of
   * Hooks — with `relation.targetEntity`, which equals `relation.entity` for
   * one-to-many, so the one-to-many case resolves the cache entry the line
   * above already populated rather than firing a second request.
   */
  const { config: farConfig } = useEntitySchema(relation.targetEntity);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const [pickerScope, setPickerScope] = useState<Record<string, string> | undefined>(undefined);
  const [linkError, setLinkError] = useState<string | null>(null);

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

  /**
   * Both mutations invalidate the whole `entity-relation-list` key, not just
   * this tab's own tuple: a new row can land on any page of the list, and the
   * user is not necessarily on page 1.
   */
  function invalidateRelationList() {
    void queryClient.invalidateQueries({ queryKey: ["entity-relation-list"] });
  }

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => createEntity(config as EntityConfig, routeParams, values),
    onSuccess: () => {
      setShowCreateModal(false);
      setCreateError(null);
      setCreateFieldErrors(undefined);
      invalidateRelationList();
    },
    onError: (error: unknown) => {
      const body = error instanceof ApiError ? (error.body as { field_errors?: Record<string, string[]> }) : undefined;
      if (body?.field_errors) {
        setCreateFieldErrors(
          Object.fromEntries(Object.entries(body.field_errors).map(([field, messages]) => [field, messages[0]])),
        );
      } else {
        setCreateError(errorMessage(error));
      }
    },
  });

  const linkMutation = useMutation({
    mutationFn: (farId: string) =>
      createLinkRow(config!.linkCreate!, {
        [relation.scopeField]: parentId,
        [relation.targetField as string]: farId,
      }),
    onSuccess: () => {
      closeLinkModal();
      invalidateRelationList();
    },
    onError: (error: unknown) => setLinkError(errorMessage(error)),
  });

  function closeLinkModal() {
    setShowLinkModal(false);
    setPickedId(undefined);
    setPickerScope(undefined);
    setLinkError(null);
  }

  if (schemaLoading || !config) {
    return (
      <Card.Body>
        {schemaLoading ? (
          <Spinner wrapperClassName="py-4" />
        ) : (
          <Alert color="danger" data-testid="entity-relation-schema-error">
            Could not load the schema for related records.
          </Alert>
        )}
      </Card.Body>
    );
  }

  const isOneToMany = relation.kind === "one-to-many";
  const farLabel = relation.label.replace(/ \(linked\)$/, "");

  const canCreateChild =
    isOneToMany &&
    config.methods.includes("create") &&
    permissions.has(`${config.resource}.create`, projectId);

  const canLinkExisting =
    !isOneToMany && Boolean(config.linkCreate) && permissions.has(config.linkCreate!.permission, projectId);

  // Which scope the picker can fire with, and whether a `ScopeSelector` step
  // is needed first. `farConfig` is undefined for one schema round trip.
  const derivedScope = farConfig ? pickerScopeParams(farConfig, projectId) : {};
  const needsScopeStep = derivedScope === null;
  const effectiveScope = needsScopeStep ? pickerScope : derivedScope ?? undefined;
  const pickerReady = !needsScopeStep || Boolean(pickerScope);

  return (
    <>
      {(canCreateChild || canLinkExisting) && (
        <Card.Body className="pb-0 d-flex justify-content-end" data-testid="entity-relation-actions">
          {canCreateChild ? (
            <Button
              color="primary"
              size="sm"
              data-testid="entity-relation-create"
              onClick={() => {
                setCreateError(null);
                setCreateFieldErrors(undefined);
                setShowCreateModal(true);
              }}
            >
              {/*
               * Just "New", exactly as `EntityListPage`'s own create button
               * reads — the tab the user is standing on supplies the noun, the
               * same way that page's card title does. Avoids inventing a
               * singularizer for a set of backend labels that are all plural
               * and not all regular ("Entry/exit criteria").
               */}
              New
            </Button>
          ) : (
            <Button
              color="primary"
              size="sm"
              data-testid="entity-relation-link"
              onClick={() => {
                setLinkError(null);
                setShowLinkModal(true);
              }}
            >
              Link existing {farLabel.toLowerCase()}
            </Button>
          )}
        </Card.Body>
      )}

      <EntityTable
        /**
         * No `title`: the tab the user just clicked already carries
         * `relation.label`, and in `bare` mode there is no card header to put it
         * in — the page's card header is the tab strip itself.
         */
        bare
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
         * Still no Edit and no Delete — omitting `onEdit`/`onDelete` is what
         * makes `EntityTable` drop the Actions column entirely. ADR-0073 adds
         * a *create* affordance above the table, deliberately not per-row
         * ones: every listed record is fully editable on its own screen, one
         * click away, and a link row has nothing to edit at all (ADR-0005 —
         * links are immutable, delete-and-recreate).
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

      {canCreateChild && (
        <Modal
          visible={showCreateModal}
          title={<>New {farLabel}</>}
          onClose={() => setShowCreateModal(false)}
        >
          <Modal.Body>
            <EntityForm
              config={config}
              mode="create"
              // The whole point of the action: the new row belongs to the
              // record being viewed, and that field is not the user's to
              // change. `EntityForm` renders it disabled, keeps it out of the
              // Zod schema, and merges it into the payload itself.
              lockedValues={{ [relation.scopeField]: parentId }}
              submitError={createError}
              serverFieldErrors={createFieldErrors}
              onCancel={() => setShowCreateModal(false)}
              onSubmit={async (values) => {
                await createMutation.mutateAsync(values);
              }}
            />
          </Modal.Body>
        </Modal>
      )}

      {canLinkExisting && (
        <Modal
          visible={showLinkModal}
          title={<>Link existing {farLabel.toLowerCase()}</>}
          onClose={closeLinkModal}
        >
          <Modal.Body>
            {linkError && (
              <Alert color="danger" data-testid="entity-relation-link-error">
                {linkError}
              </Alert>
            )}

            {needsScopeStep && farConfig?.scopeSelector && (
              <ScopeSelector
                options={farConfig.scopeSelector}
                onResolved={(paramName, value) => {
                  setPickerScope({ [paramName]: value });
                  setPickedId(undefined);
                }}
                extraParams={projectId ? { project_id: projectId } : undefined}
              />
            )}

            {pickerReady && (
              <FkAutocomplete
                id="entity-relation-link-picker"
                label={farLabel}
                refEntity={relation.targetEntity}
                labelField={config.fields.find((f) => f.name === relation.targetField)?.labelField}
                value={pickedId}
                onChange={setPickedId}
                extraParams={effectiveScope}
                routeParams={routeParams}
              />
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button outline color="secondary" type="button" onClick={closeLinkModal}>
              Cancel
            </Button>
            <Button
              color="primary"
              type="button"
              data-testid="entity-relation-link-submit"
              disabled={!pickedId || linkMutation.isPending}
              onClick={() => pickedId && linkMutation.mutate(pickedId)}
            >
              Link
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </>
  );
}

export default EntityRelationTab;
