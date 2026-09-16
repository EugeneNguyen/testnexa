/**
 * [ADR-0074](../../../../../docs/adr/0074-entity-detail-relationship-tabs.md):
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
 * silent behavior change, the same reasoning ADR-0073 gives for
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
 * ## It renders card *sections*, not a card (ADR-0074's Amendment)
 *
 * This component is mounted inside `EntityDetailPage`'s single card, in the
 * `.tab-pane` of its `.card-body` — Tabler's documented "tabs in the card
 * header" pattern, where one card spans every tab. So it renders
 * `EntityTable` with `bare`, and its own schema-loading/error branch is a bare
 * `.card-body` too: a card of its own here would paint a second border and
 * shadow inside the page's card, and repeat the tab's label as a card title.
 * It is not a standalone mount — it expects a `.card` ancestor.
 *
 * ## Write actions ([ADR-0076](../../../../../docs/adr/0076-relationship-tab-write-actions.md))
 *
 * The tab is no longer read-only. Which actions render is decided by
 * `relation.kind`, because the two kinds mean structurally different things:
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
 *   `config.linkCreate` (ADR-0076's `LinkCreateAction`) on the **link
 *   entity's** own schema — the same schema this tab already fetched to render
 *   the table, so the action costs no extra round trip and this component
 *   hard-codes no route.
 * - **many-to-many — "Create new <far entity>"**, ADR-0076's
 *   **Amendment 1**. Both n-n actions render together, side by side; the
 *   original "one action per tab, never both" rule turned out to strand the
 *   common case where the record you want to link does not exist yet, forcing
 *   a detour to the far entity's own list page and back. This one is a
 *   *compound* action, not a second create surface: one modal, holding the far
 *   entity's own `EntityForm`, whose submit runs the far entity's generic
 *   `create` and then the **same** `config.linkCreate` route "Link existing"
 *   already calls. Nothing new on the backend — it is exactly the two requests
 *   a user could already make by hand, in one step.
 *
 * ### The two calls are not one transaction, and the second one can fail
 *
 * They are two independent routes (a generic factory `create`, then a bespoke
 * link `POST`), so there is no transaction to put them in short of a new
 * backend route, which this change deliberately does not add. The failure that
 * matters is therefore **create succeeded, link failed** — a real far-entity
 * row now exists, unlinked, and this tab cannot show it (it lists *link* rows).
 * Two things stop it becoming a row the user cannot find again:
 *
 * 1. The button is gated on **both** permissions up front — the far entity's
 *    own `<resource>.create` *and* `config.linkCreate.permission` — so the one
 *    predictable cause of a half-completed write (an actor who may create but
 *    may not link) can never start it. Fail-closed: either missing hides the
 *    button, exactly as a single missing permission already does.
 * 2. If it still happens (a race, a `409`, a cross-project `422` on the link
 *    half), the modal **closes** — so a retry cannot silently create a second
 *    row — and a persistent alert above the table names the created record by
 *    its own label *and* its id, says plainly that it was saved but not linked,
 *    and points at "Link existing …" as the one-click way to finish. See
 *    `createdNotLinkedMessage`.
 *
 * Both actions are gated twice, and the two gates answer different questions:
 * *can this API do it at all* (`config.methods`/`config.linkCreate`) and *may
 * this actor* (`usePermissions`, fail-closed while loading). A missing
 * permission makes the button **absent**, not disabled — UI Design Document
 * §5's hide-don't-disable posture, the same one `EntityListPage`'s `canCreate`
 * takes.
 *
 * ### Scoping the picker — and prefilling the create form
 *
 * `pickerScopeParams` answers one question that both n-n actions need: *what
 * is the far entity's scope, here?* For "Link existing" it is the search's
 * query params; for "Create new" the identical answer is the create form's
 * `lockedValues`, since a scope field is a body field on create and a query
 * param on list (`crud_factory`'s own convention). One rule, two consumers —
 * rather than a second, separately-drifting notion of "which project is this".
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
 * ## Removing a link ([ADR-0077](../../../../../docs/adr/0077-relationship-tab-unlink-action.md))
 *
 * A many-to-many tab's rows carry a per-row **Remove**, the exact counterpart
 * of "Link existing …" above and declared the same way: `config.linkDelete`
 * (`LinkDeleteAction`) names the bespoke `DELETE` and the permission it gates
 * on, so this component hard-codes no route here either. Both ids the route
 * needs are already on screen — `relation.scopeField` is the record being
 * viewed, `relation.targetField` is read off the row the button sits in — so
 * unlinking needs no picker, no form and no extra fetch.
 *
 * Three things about it are deliberate:
 *
 * - **It is on n-n tabs only.** A one-to-many tab's rows are *records*, and
 *   removing one would mean deleting the child outright, which is a different
 *   and much larger action that the child's own screen already offers. Same
 *   asymmetry ADR-0076 Amendment 1 kept for "Create new" vs "New".
 * - **`config.linkDelete` is read independently of `config.linkCreate`.** A
 *   junction that can be linked and not unlinked is not hypothetical — it is
 *   what four of the six were between the two ADRs — so neither key is
 *   inferred from the other, and the two permissions are checked separately
 *   (for the four traceability links they are genuinely different codes).
 * - **It confirms before writing**, in the same `Modal` shape
 *   `EntityListPage`'s own row delete uses (title, plain-language body, Cancel
 *   + a `danger` confirm, the API's own error rendered inside the modal so the
 *   user can read it and retry or cancel). Reused rather than reinvented, and
 *   specifically not a native `confirm()` — nothing else in this app uses one,
 *   and it cannot render an `ApiError`'s message on a failed attempt.
 *
 * Like every other action here it is gated twice and **hidden, not disabled**,
 * when either gate fails. One accepted consequence of the fail-closed gate:
 * while `permissions` is still in flight the column is absent and appears when
 * it resolves. The actions strip above the table renders its own explicit
 * "loading actions" placeholder for that same window (see `actionsLoading`),
 * so the arrival is accounted for on screen rather than unexplained.
 *
 * One live direction (`TestCase` -> "Defects (linked)") lands in case 3 behind
 * `ScopeSelector`'s own **pre-existing** cascading-picker gap: `Defect`'s
 * selector searches `TestExecution`, which is itself scoped by `test_cycle_id`
 * rather than `project_id`, so the search comes back empty. That limitation is
 * documented by name in `scope-selector.tsx`'s own docstring, predates this
 * ADR, and is not worked around here. The same link is fully creatable from
 * the other end (`Defect` -> "Test cases (linked)", case 2), so the capability
 * is reachable; see ADR-0076's Consequences.
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
import { Icon } from "../../../components/atoms/icon/icon";
import { usePermissions } from "../../../auth/usePermissions";
import { EntityConfig, EntityRelation } from "../../../entityConfigs/types";
import { ApiError } from "../../../lib/api/client";
import {
  EntityRow,
  createEntity,
  createLinkRow,
  deleteLinkRow,
  listEntities,
} from "../../../lib/api/entityCrud";
import { useEntitySchema } from "../../../pages/admin/useEntitySchema";

export interface EntityRelationTabProps {
  relation: EntityRelation;
  /** The id of the record whose detail page this tab is on. */
  parentId: string;
  /** `{orgId, projectId}` — for `:param` interpolation and the route prefix. */
  routeParams: Record<string, string | undefined>;
  /**
   * ADR-0076: the resolved org, for `usePermissions`. Passed down rather than
   * re-resolved here — `useAdminRouteContext` already fetched it (on a
   * project-scoped route the URL carries no `:orgId` at all), and resolving it
   * twice would fire the same `GET /projects/{id}` again per tab.
   */
  orgId: string | undefined;
  /** ADR-0076: the project half of the same context, for project-scoped grants. */
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
 * ADR-0076: which scope params the "Link existing ..." picker must send with
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

/**
 * A `422`'s per-field messages, flattened to the one-message-per-field shape
 * `EntityForm`'s `serverFieldErrors` takes. Shared by both create paths.
 */
function fieldErrorsOf(error: unknown): Record<string, string> | undefined {
  const body = error instanceof ApiError ? (error.body as { field_errors?: Record<string, string[]> }) : undefined;
  if (!body?.field_errors) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(body.field_errors).map(([field, messages]) => [field, messages[0]]));
}

/**
 * ADR-0076 Amendment 1: how a just-created far row is named back to the user
 * when its link half failed.
 *
 * `labelField` is the same one the picker labels its search results with — it
 * is declared on the *link* entity's own FK field pointing at the far entity
 * (`FieldConfig.labelField`), so this needs no per-entity knowledge either.
 * Falls back to the id when the create response carries no such field, which
 * is why the id is reported **as well as** the label rather than instead of
 * it: the label is what the user typed and recognizes, the id is what survives
 * a rename and can be pasted into a search.
 */
export function farRowDisplay(row: EntityRow, labelField: string | undefined): string {
  const raw = labelField ? row[labelField] : undefined;
  return typeof raw === "string" && raw.trim() ? raw : String(row.id ?? "");
}

/**
 * ADR-0076 Amendment 1: the "created, but not linked" message.
 *
 * Its literal wording is load-bearing, which is why it is a pure function with
 * its own test rather than an inline template. It has to carry four things, and
 * dropping any one of them leaves the user guessing: **that the row was
 * saved** (so they do not create it a second time), **which row** (label *and*
 * id — see `farRowDisplay`), **why the link failed** (the API's own message,
 * e.g. a cross-project `422`, not a generic "something went wrong"), and
 * **how to finish** (the "Link existing …" action sitting right above the
 * table, which now needs no form at all because the record exists).
 */
export function createdNotLinkedMessage(display: string, id: string, reason: string, farLabelLower: string): string {
  return `"${display}" (id ${id}) was created, but linking it to this record failed: ${reason} It was saved and is NOT linked — use "Link existing ${farLabelLower}" to link it.`;
}

/**
 * ADR-0076 Amendment 1: thrown when the far-entity `create` succeeded and the
 * link `POST` that follows it did not. A distinct type because the two
 * failures need opposite handling — an ordinary create failure keeps the form
 * open so the user can fix and resubmit, while this one must **close** it, or
 * a resubmit creates a second row for the same intent.
 */
class CreatedNotLinkedError extends Error {}

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
   * ADR-0076: only the many-to-many branch needs the far entity's schema (to
   * scope and label the picker). Called unconditionally anyway — Rules of
   * Hooks — with `relation.targetEntity`, which equals `relation.entity` for
   * one-to-many, so the one-to-many case resolves the cache entry the line
   * above already populated rather than firing a second request.
   */
  const { config: farConfig, isLoading: farSchemaLoading } = useEntitySchema(relation.targetEntity);

  /**
   * CTO-reported bug, 2026-09-15: the action buttons "sometimes show,
   * sometimes don't" on the identical tab/account — not a permission logic
   * bug, a **race**. `canCreateChild`/`canLinkExisting`/`canCreateAndLink`
   * below fail closed (return `false`) while `permissions.isLoading` is true
   * (by `usePermissions`'s own documented design) or while `farConfig` for an
   * n-n tab hasn't arrived yet — both are correct as a *default*, but nothing
   * distinguished that transient "don't know yet" state from "permanently
   * absent," so the whole actions strip silently omitted itself and only
   * popped in once both queries resolved. Whether a user caught the gap
   * depended entirely on React Query cache warmth (fast on a revisited org,
   * slow on a cold one) — hence "sometimes." `actionsLoading` names the state
   * explicitly so the render below can show a placeholder instead of nothing.
   */
  const actionsLoading = permissions.isLoading || farSchemaLoading;

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const [pickerScope, setPickerScope] = useState<Record<string, string> | undefined>(undefined);
  const [linkError, setLinkError] = useState<string | null>(null);

  // ADR-0076 Amendment 1 — the compound "Create new <far entity>" action.
  const [showCreateLinkModal, setShowCreateLinkModal] = useState(false);
  const [createLinkError, setCreateLinkError] = useState<string | null>(null);
  const [createLinkFieldErrors, setCreateLinkFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  /**
   * Survives the modal closing, deliberately: it is the only remaining record
   * of a row that exists and is not linked, so it stays on the tab until the
   * user navigates away rather than vanishing with the dialog that caused it.
   */
  const [createdNotLinked, setCreatedNotLinked] = useState<string | null>(null);

  // ADR-0077 — the per-row "Remove" action's confirm step. `rowPendingUnlink`
  // doubles as the modal's own visibility flag, exactly as
  // `EntityListPage`'s `rowPendingDelete` does for its row delete.
  const [rowPendingUnlink, setRowPendingUnlink] = useState<EntityRow | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const isOneToMany = relation.kind === "one-to-many";
  /**
   * What the tab is *about* — the far entity for n-n, `entity` itself for 1-n
   * (ADR-0074 §5). Computed above the schema guard because both mutations and
   * the "created, not linked" message need it, and hooks cannot sit below a
   * conditional return.
   */
  const farLabel = relation.label.replace(/ \(linked\)$/, "");
  /**
   * Which field of the far entity's summary names it — declared on the *link*
   * entity's own FK field pointing at it. Used to label the picker's results
   * and, on Amendment 1's failure path, to name the created row back.
   */
  const farLabelField = config?.fields.find((f) => f.name === relation.targetField)?.labelField;

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
      const fieldErrors = fieldErrorsOf(error);
      if (fieldErrors) {
        setCreateFieldErrors(fieldErrors);
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

  /**
   * ADR-0077: remove the one link row this table row *is*.
   *
   * The far id comes off the row itself (`relation.targetField`), so the
   * request needs nothing the table was not already rendering. Guarded on a
   * real string: a row missing that column would otherwise reach
   * `interpolateLinkPath` and throw its "Missing …" programming-error, which
   * is the right behaviour for a bug but a poor one to surface to a user
   * mid-confirm.
   */
  const unlinkMutation = useMutation({
    mutationFn: (row: EntityRow) => {
      const farId = relation.targetField !== null ? row[relation.targetField] : undefined;
      if (typeof farId !== "string" || !farId) {
        return Promise.reject(new Error("This row is missing the id of the record it links to."));
      }
      return deleteLinkRow(config!.linkDelete!, {
        [relation.scopeField]: parentId,
        [relation.targetField as string]: farId,
      });
    },
    onSuccess: () => {
      setRowPendingUnlink(null);
      setUnlinkError(null);
      invalidateRelationList();
    },
    // Kept open on failure, unlike `createAndLinkMutation`'s own close-on-error
    // path: nothing was written here, so re-confirming is a retry rather than a
    // second write, and the API's own reason (a `404` for an already-removed
    // pair, a `403`) is worth reading in place.
    onError: (error: unknown) => setUnlinkError(errorMessage(error)),
  });

  function closeUnlinkModal() {
    setRowPendingUnlink(null);
    setUnlinkError(null);
  }

  function closeLinkModal() {
    setShowLinkModal(false);
    setPickedId(undefined);
    setPickerScope(undefined);
    setLinkError(null);
  }

  function closeCreateLinkModal() {
    setShowCreateLinkModal(false);
    setCreateLinkError(null);
    setCreateLinkFieldErrors(undefined);
  }

  /**
   * ADR-0076 Amendment 1: create the far row, then link it — two real
   * requests, sequenced client-side, because they are two independent routes
   * (see this module's own docstring for why there is no transaction to use).
   *
   * The ordering is not arbitrary: create first, because the link route takes
   * an id that has to exist. That is also what makes "created but not linked"
   * the only partial state reachable, and it is why it gets its own error type
   * rather than being folded into the generic failure path.
   */
  const createAndLinkMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const created = (await createEntity(farConfig as EntityConfig, routeParams, values)) as EntityRow;
      const farId = created?.id;
      if (typeof farId !== "string" || !farId) {
        // Not reachable against this API (every create returns its row), but
        // silently skipping the link half would be the worst possible
        // outcome of it ever becoming reachable.
        throw new CreatedNotLinkedError(
          createdNotLinkedMessage(
            farRowDisplay(created ?? {}, farLabelField),
            "unknown",
            "The server did not return the new record's id.",
            farLabel.toLowerCase(),
          ),
        );
      }
      try {
        await createLinkRow(config!.linkCreate!, {
          [relation.scopeField]: parentId,
          [relation.targetField as string]: farId,
        });
      } catch (linkFailure) {
        throw new CreatedNotLinkedError(
          createdNotLinkedMessage(
            farRowDisplay(created, farLabelField),
            farId,
            errorMessage(linkFailure),
            farLabel.toLowerCase(),
          ),
        );
      }
      return created;
    },
    onSuccess: () => {
      closeCreateLinkModal();
      setCreatedNotLinked(null);
      invalidateRelationList();
    },
    onError: (error: unknown) => {
      if (error instanceof CreatedNotLinkedError) {
        // Close, so a resubmit cannot create a second row for one intent, and
        // surface the notice on the tab itself where it outlives the dialog.
        closeCreateLinkModal();
        setCreatedNotLinked(error.message);
        // The link half's own outcome is genuinely unknown when it failed at
        // the transport layer rather than with a status, so refetch instead of
        // assuming nothing landed.
        invalidateRelationList();
        return;
      }
      const fieldErrors = fieldErrorsOf(error);
      if (fieldErrors) {
        setCreateLinkFieldErrors(fieldErrors);
      } else {
        setCreateLinkError(errorMessage(error));
      }
    },
  });

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

  const canCreateChild =
    isOneToMany &&
    config.methods.includes("create") &&
    permissions.has(`${config.resource}.create`, projectId);

  const canLinkExisting =
    !isOneToMany && Boolean(config.linkCreate) && permissions.has(config.linkCreate!.permission, projectId);

  /**
   * ADR-0077. Structurally parallel to `canLinkExisting` and deliberately
   * **not** derived from it: the capability is a different served key
   * (`config.linkDelete`) and, for the four ADR-0005 traceability links, a
   * different permission code (`<link>.delete`, not `<link>.create`). An actor
   * can legitimately hold either without the other — `tester` is a real
   * example in the opposite direction on three of the four links — so "may
   * link" is never evidence of "may unlink".
   *
   * `relation.targetField !== null` is the third conjunct and is what confines
   * this to many-to-many tabs: it is `null` exactly when the listed row *is*
   * the record (one-to-many), where there is no link row to remove and
   * "Remove" would have to mean "delete this child", a different action
   * entirely (see the module docstring).
   */
  const canUnlink =
    !isOneToMany &&
    relation.targetField !== null &&
    Boolean(config.linkDelete) &&
    permissions.has(config.linkDelete!.permission, projectId);

  /**
   * ADR-0076 Amendment 1. Four conditions, and every one of them is a
   * different question:
   *
   * 1. `canLinkExisting` — this compound action *ends* with the same link
   *    request that action makes, so everything it needs (an n-n tab, a
   *    declared `linkCreate`, the permission that route gates on) is needed
   *    here too. Reusing the flag rather than restating it keeps the two from
   *    drifting into disagreeing about the same route.
   * 2. The far entity's schema has arrived — `farConfig` is undefined for one
   *    round trip, and there is no form to render without it.
   * 3. The far entity actually has a generic `create`. Three of the twelve
   *    live link directions point at an entity that does not (`TestCondition`
   *    and `Defect` are authored through bespoke routes only), and for those
   *    this action correctly never appears — the same API-capability gate the
   *    1-n branch already applies to `config.methods`.
   * 4. The actor may create it. **Gated in addition to, never instead of, the
   *    link permission**: an actor who may create but may not link would get
   *    a `201` and then a `403`, i.e. exactly the orphaned row this action's
   *    whole error path exists to avoid — so it is refused before it starts.
   */
  const canCreateAndLink =
    canLinkExisting &&
    Boolean(farConfig) &&
    farConfig!.methods.includes("create") &&
    permissions.has(`${farConfig!.resource}.create`, projectId);

  // Which scope the picker can fire with, and whether a `ScopeSelector` step
  // is needed first. `farConfig` is undefined for one schema round trip.
  const derivedScope = farConfig ? pickerScopeParams(farConfig, projectId) : {};
  const needsScopeStep = derivedScope === null;
  const effectiveScope = needsScopeStep ? pickerScope : derivedScope ?? undefined;
  const pickerReady = !needsScopeStep || Boolean(pickerScope);

  /**
   * The same derived scope, as the create form's locked fields — a scope field
   * is a query param on `list` and a body field on `create`, so one answer
   * serves both (see the module docstring). `null`/empty means the route could
   * not derive one, and the field is then left editable rather than locked to
   * a guess: degrading to "the user picks it" beats shipping a form that
   * cannot be submitted.
   */
  const createLinkLockedValues =
    derivedScope && Object.keys(derivedScope).length > 0 ? derivedScope : undefined;

  return (
    <>
      {actionsLoading ? (
        /**
         * Same slot, same alignment, as the real actions strip below — a
         * placeholder, not silence, while `permissions`/`farConfig` are still
         * in flight (see `actionsLoading`'s own docstring above for why this
         * exists at all). Kept deliberately minimal: no text, since this is
         * gone within one query round trip on any reasonable connection and
         * a label would only flash.
         */
        <Card.Body
          className="pb-0 mb-3 d-flex justify-content-end"
          data-testid="entity-relation-actions-loading"
        >
          <Spinner wrapperClassName="p-0" label="Loading available actions…" />
        </Card.Body>
      ) : (
        (canCreateChild || canLinkExisting || canCreateAndLink) && (
        /**
         * `gap-2` (Amendment 1): an n-n tab can now render two buttons here,
         * and two `.btn`s are adjacent siblings with no margin of their own.
         * Harmless on a 1-n tab, which still renders exactly one child.
         *
         * `mb-3`: separates the strip from `EntityTable` below — `bare` mode
         * renders no card header/spacing of its own for this component to
         * lean on (see that prop's own docstring), so without this the
         * buttons sit flush against the table's top border.
         *
         * Icon-only (CTO request, 2026-09-15): each button's visible label is
         * gone, replaced by `aria-label` carrying the exact former text — the
         * same `Icon`-atom-plus-`aria-label` pattern `EntityTable`'s own
         * per-row Edit/Delete buttons already use, not a new convention.
         */
        <Card.Body className="pb-0 mb-3 d-flex justify-content-end gap-2" data-testid="entity-relation-actions">
          {canCreateChild && (
            <Button
              color="primary"
              size="sm"
              aria-label={`New ${farLabel.toLowerCase()}`}
              title={`New ${farLabel.toLowerCase()}`}
              data-testid="entity-relation-create"
              onClick={() => {
                setCreateError(null);
                setCreateFieldErrors(undefined);
                setShowCreateModal(true);
              }}
            >
              <Icon name="plus" />
            </Button>
          )}
          {canLinkExisting && (
            <Button
              color="primary"
              size="sm"
              aria-label={`Link existing ${farLabel.toLowerCase()}`}
              title={`Link existing ${farLabel.toLowerCase()}`}
              data-testid="entity-relation-link"
              onClick={() => {
                setLinkError(null);
                setShowLinkModal(true);
              }}
            >
              <Icon name="link" />
            </Button>
          )}
          {canCreateAndLink && (
            <Button
              /**
               * `outline`, where "Link existing" is solid: both are real
               * actions, but linking an existing record is the one ADR-0076
               * exists for (assembling a matrix from rows that already exist),
               * and two solid primaries side by side assert no hierarchy at
               * all. Not `secondary` — this is not a cancel-shaped action.
               */
              outline
              color="primary"
              size="sm"
              aria-label={`Create new ${farLabel.toLowerCase()}`}
              title={`Create new ${farLabel.toLowerCase()}`}
              data-testid="entity-relation-create-link"
              onClick={() => {
                setCreateLinkError(null);
                setCreateLinkFieldErrors(undefined);
                setCreatedNotLinked(null);
                setShowCreateLinkModal(true);
              }}
            >
              <Icon name="plus" />
            </Button>
          )}
        </Card.Body>
        )
      )}

      {createdNotLinked && (
        <Card.Body className="pb-0">
          <Alert color="danger" data-testid="entity-relation-create-link-error">
            {createdNotLinked}
          </Alert>
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
         * keeps `EntityTable` from offering either: every listed record is
         * fully editable on its own screen, one click away, and a link row has
         * nothing to edit at all (ADR-0005 — links are immutable,
         * delete-and-recreate).
         *
         * ADR-0077 adds the third action, `onUnlink`, and it is the
         * *delete-and-* half of that same rule rather than an exception to it:
         * it removes the link row, never the record the row points at. Passed
         * as `undefined` when either gate fails, which is what makes the whole
         * Actions column disappear rather than render an inert cell — the
         * hide-don't-disable posture every other action here takes.
         */
        onUnlink={canUnlink ? (row) => { setUnlinkError(null); setRowPendingUnlink(row); } : undefined}
        onRowClick={(row) => {
          const targetId =
            relation.targetField !== null ? row[relation.targetField] : row.id;
          if (targetId === undefined || targetId === null) {
            return;
          }
          navigate(`${adminBasePath(routeParams)}/${relation.targetEntity}/${String(targetId)}`);
        }}
      />

      {/*
        ADR-0077: the confirm step for the per-row Remove.

        Same `Modal` + `Modal.Body` + `Modal.Footer` shape `EntityListPage`'s
        own row-delete confirm uses, deliberately reused rather than reinvented
        — and specifically not a native `confirm()`, which nothing in this app
        uses and which could not render the `ApiError` message this one does on
        a failed attempt.

        The body says what actually happens, in the two sentences that answer
        the only two questions a user has here: *does this delete the record?*
        (no) and *is it final?* (no — the sibling "Link existing …" button puts
        it back, and re-linking is exactly what ADR-0005's immutable
        delete-and-recreate model means in practice).
      */}
      {canUnlink && (
        <Modal
          visible={Boolean(rowPendingUnlink)}
          title={<>Remove link</>}
          onClose={closeUnlinkModal}
        >
          <Modal.Body>
            {unlinkError && (
              <Alert color="danger" data-testid="entity-relation-unlink-error">
                {unlinkError}
              </Alert>
            )}
            {/*
              Deliberately does NOT interpolate `farLabel` here, though an
              earlier draft did. A relation's label is a *plural* ("Test
              cases", "Defects"), so "The test cases itself is not deleted"
              reads as a grammar bug — caught by looking at the rendered
              modal, not by any assertion, since every test that could have
              pinned the wording would have pinned the wrong wording equally
              happily. "the record it points to" is number-agnostic and its
              referent is unambiguous: the user is looking at the row whose
              own cell carries that record's title.
            */}
            Remove this link? Only the link is removed — the record it points to is not deleted,
            and you can link it again at any time.
          </Modal.Body>
          <Modal.Footer>
            <Button outline color="secondary" type="button" onClick={closeUnlinkModal}>
              Cancel
            </Button>
            <Button
              color="danger"
              type="button"
              data-testid="entity-relation-unlink-submit"
              disabled={unlinkMutation.isPending}
              onClick={() => rowPendingUnlink && unlinkMutation.mutate(rowPendingUnlink)}
            >
              Remove
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {canCreateAndLink && farConfig && (
        <Modal
          visible={showCreateLinkModal}
          title={<>Create new {farLabel.toLowerCase()}</>}
          onClose={closeCreateLinkModal}
        >
          <Modal.Body>
            {/*
             * The FAR entity's own schema drives this form — `farConfig`, not
             * `config`. `config` here is the *link* entity, whose two FK
             * columns are the whole row and which has no `create_schema` at
             * all (ADR-0005); rendering its fields would ask the user to fill
             * in two ids, one of which is the record they are already on.
             */}
            <EntityForm
              config={farConfig}
              mode="create"
              lockedValues={createLinkLockedValues}
              submitError={createLinkError}
              serverFieldErrors={createLinkFieldErrors}
              onCancel={closeCreateLinkModal}
              onSubmit={async (values) => {
                /**
                 * Swallowed on purpose: `onError` above has already routed
                 * this to either the form's own error slots or the tab's
                 * "created, not linked" alert. Letting it propagate would
                 * reach react-hook-form, which rethrows out of its submit
                 * handler as an unhandled rejection with nothing left to
                 * render it.
                 */
                try {
                  await createAndLinkMutation.mutateAsync(values);
                } catch {
                  /* handled in onError */
                }
              }}
            />
          </Modal.Body>
        </Modal>
      )}

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
                labelField={farLabelField}
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
