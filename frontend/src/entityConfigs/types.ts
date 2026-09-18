/**
 * ADR-0025 / FR-ADMIN-2: field-config schema for the generic admin CRUD
 * surface. Source of truth: UI Design Document §3
 * (docs/ui-design/2026-09-05-generic-admin-crud-ui-design.md).
 *
 * `FieldConfig`/`EntityConfig`'s base shape below matches §3 verbatim. Three
 * additive, documented extensions were required once the 28 configs were
 * checked against the *actual* backend route/schema files (not just the
 * design doc's prose) — each is optional, so every config that doesn't need
 * it is unaffected, and none of §3's own fields were removed or renamed:
 *
 * 1. `FieldConfig.readOnly` — several `*Summary` schemas expose audit/
 *    system columns (`created_at`, `is_system_role`, `created_by_actor_id`,
 *    …) that their `Create*Request`/`Update*Request` siblings never accept.
 *    §3 has no "table-only, never in the form" flag; without one,
 *    `EntityForm` would try to submit a field the API rejects. `readOnly`
 *    fields render in `EntityTable` and as plain (disabled) display in
 *    `EntityForm`, never as part of the submitted payload.
 * 2. `EntityConfig.scopeSelector` accepts an *array* of options, not just a
 *    single one — needed for `RiskItem`'s real shape (UI Design Document
 *    §4, screen shape C): "a toggle between 'by Requirement' / 'by
 *    TestPlan'". §3's own dataclass sketch only wrote the single-option
 *    shape; §4's prose already describes the toggle, so this is reconciling
 *    an internal inconsistency in the design doc, not inventing new scope.
 *    A single object (not wrapped in an array) still works for every other
 *    scope-selector entity (`Attachment`, and the several "plain" §4 shape-B
 *    entities whose *real* backend `scope_field` turned out not to be
 *    `project_id` — see each config file's own docstring for specifics).
 * 3. `EntityConfig.scopeResolution` and `listPath`/`createPath` — see their
 *    own doc comments below. Both exist to represent two backend routes
 *    that don't fit the generic `{path}`/`{path}?{scopeField}=` convention
 *    at all (`Project`, `Release`) — see `entityConfigs/project.ts` and
 *    `entityConfigs/release.ts`.
 */

/**
 * `"text"` (2026-09-15, live-manual-test feedback): a nullable, unbounded
 * `Text` column (as opposed to `"string"`'s length-limited `String`) —
 * server-derived from `crud_factory.FieldMeta.long_text`, since a Pydantic
 * `str` annotation can't distinguish the two on its own. `EntityForm` renders
 * it as a `<textarea>` (`atoms/textarea`) instead of a single-line input.
 */
export type FieldType = "string" | "text" | "enum" | "fk" | "date" | "boolean";

export interface FieldConfig {
  /** Matches the API's JSON field name exactly. */
  name: string;
  /** Column header / form label. */
  label: string;
  type: FieldType;
  /**
   * Whether this field is required on `EntityForm`'s create path — mirrors
   * the entity's own `Create*Request` schema. Fields only ever supplied via
   * `Update*Request` (already-partial by construction) are not marked
   * required even though they're often "logically" required (see e.g.
   * `test-case.ts`'s own comment on `title`/`status`).
   */
  required?: boolean;
  /** enum only. */
  values?: string[];
  /**
   * enum only (ADR-0053) — value -> Bootstrap theme-colour name, e.g.
   * `{"critical": "danger"}`. Served by `GET /entities/{resource}/schema`,
   * replacing `EntityTable`'s own module-level `ENUM_BADGE_COLORS` constant.
   * Already filtered backend-side to this field's own declared `values`, and
   * omitted entirely for an enum with no semantic colouring at all
   * (`EntryExitCriteria.type`, `TestLog.event_type`) — so `EntityTable` still
   * needs its plain-grey fallback for any value not listed here.
   */
  badgeColors?: Record<string, string>;
  /** fk only — key into the registry, not necessarily an entity with its own admin page. */
  refEntity?: string;
  /** fk only — which field of the ref entity's summary to display. */
  labelField?: string;
  /** default true; e.g. hide a long text field from the table, still in the form. */
  showInTable?: boolean;
  /**
   * default true (ADR-0053, sort) — whether clicking this column's header on
   * `EntityTable` sorts the list by it. Served by `GET
   * /entities/{resource}/schema`; `false` for the 3 static `Release` fields
   * (`overrides.ts`), whose list route is 100% bespoke and doesn't support
   * `?sort=`.
   */
  sortable?: boolean;
  /**
   * default true (ADR-0072, filters) — whether this field may be used as an
   * exact-match `?<field>=<value>` condition in `EntityTable`'s Filter modal.
   * Served by `GET /entities/{resource}/schema`, derived from the entity's own
   * schema rather than a hand-kept per-entity tuple (the same posture
   * `sortable` already takes, ADR-0053). `false` for `type: "text"` fields —
   * exact equality against an unbounded free-text column answers no question
   * a user has; `?q=` (ADR-0070) is what covers those.
   *
   * `EntityConfig.filterFields` below carries the same information as a flat
   * list and is what `lib/entityFilters.ts` actually reads; this per-field
   * flag exists so the served schema is self-describing field-by-field.
   */
  filterable?: boolean;
  /**
   * Extension (see module doc comment, point 1): true for fields present in
   * a `*Summary` schema but absent from both `Create*Request` and
   * `Update*Request` — table/display only, never part of a submitted
   * payload, always rendered disabled by `EntityForm`.
   */
  readOnly?: boolean;
  /**
   * fk only (2026-09-15, live-manual-test feedback) — render as a plain
   * native `<select>` (fetches the ref entity's full list once, no
   * debounced search) instead of `FkAutocomplete`'s type-to-search widget.
   * Server-derived from `crud_factory.FieldMeta.select`; only set `true` for
   * a small, bounded catalog (`TestLevel`/`TestType`/per-project
   * `TestCondition`) — leave unset/`false` for an unbounded ref entity.
   */
  select?: boolean;
}

/** One option for `EntityConfig.scopeSelector` (see module doc comment, point 2). */
export interface ScopeSelectorOption {
  /** Registry key of the entity `FkAutocomplete` searches against. */
  refEntity: string;
  /** The scope query-param/body-field name this option resolves. */
  paramName: string;
  /** Toggle-button label when this option is one of several (`RiskItem`). */
  label?: string;
  /**
   * ADR-0081: when set, `refEntity`'s own list route needs a SECOND scope
   * param this page's own route params never supply (`TestCycle` needs
   * `test_plan_id`, `TestExecution` needs `test_case_id`) — `ScopeSelector`
   * renders this as a preceding picker step and threads its resolved value
   * in as an extra search param on the OUTER option's own `FkAutocomplete`,
   * never reporting it to `onResolved` itself.
   */
  via?: ScopeSelectorOption;
  /**
   * ADR-0087: render this option's picker as `FkSelect` (a plain `<select>`,
   * `refEntity`'s full list fetched once) instead of `FkAutocomplete` —
   * only ever `true` for a `refEntity` the backend has vetted as a small,
   * bounded catalog (`test-plan`, `test-suite`, `test-cycle`); everything
   * else defaults `false`.
   */
  select?: boolean;
  /**
   * ADR-0089: which field of `refEntity`'s own served rows the picker
   * displays for each option — `ScopeSelector` never had an equivalent to
   * `FieldConfig.labelField`/`CompoundCreateAction.parentLabelField` until
   * now, so every scope-selector picker rendered the raw `id` instead.
   */
  labelField?: string;
}

/**
 * Extension (see module doc comment, point 3): derives a scope value
 * automatically, with no user interaction, by resolving `viaEntity`'s own
 * `get` route using a route param already in context, then reading
 * `viaField` off the result.
 *
 * The one real use is `Project` (`entityConfigs/project.ts`): its backend
 * `scope_field` is `org_id`, but `/projects/:projectId/admin/projects` only
 * has a `projectId` route param, no `orgId` — so this fetches the *current*
 * Project (`GET /projects/{projectId}`, which this factory-plus-bespoke
 * entity does support) purely to read its own `org_id` off the response,
 * then lists every other Project sharing it. Unlike `scopeSelector`, this
 * never renders a picker — the value isn't a user choice, it's a fact about
 * the route's own project.
 */
export interface ScopeResolution {
  fromRouteParam: "orgId" | "projectId";
  viaEntity: string;
  viaField: string;
}

/**
 * [ADR-0074](../../../docs/adr/0074-entity-detail-relationship-tabs.md): one
 * *inbound* relationship of an entity — some other entity pointing at it —
 * rendered as one tab on `EntityDetailPage`. Derived entirely on the backend
 * (`crud_factory.derive_entity_relations`) by walking every registered
 * config, so there is no hand-authored map on either side to drift.
 *
 * Many-to-one is deliberately absent: a field of *this* entity pointing at a
 * parent already renders as a labelled value on the Info tab.
 */
export interface EntityRelation {
  /**
   * `"one-to-many"` — `entity` is a child entity whose own rows carry
   * `scopeField`. `"many-to-many"` — `entity` is one of ADR-0005's link
   * tables; its rows are what's listed, but the tab is *about*
   * `targetEntity`, the far side.
   */
  kind: "one-to-many" | "many-to-many";
  /** Plural `:entity` slug whose rows this tab lists and fetches. */
  entity: string;
  /**
   * The listed entity's own scope field, set to the parent row's id on the
   * list request. Also hidden as a column: it is the same value on every row
   * in the tab, so showing it is pure noise.
   */
  scopeField: string;
  /** Tab label — the far entity's label for many-to-many, `entity`'s own otherwise. */
  label: string;
  /** What the tab is conceptually about; equals `entity` for one-to-many. */
  targetEntity: string;
  /**
   * Many-to-many only: which FK on the *link* row names the far entity, so a
   * row click can open the far record rather than the link record. `null`
   * for one-to-many, where the listed row already is the record.
   */
  targetField: string | null;
}

/**
 * [ADR-0076](../../../docs/adr/0076-relationship-tab-write-actions.md): how to
 * create **one row** of a junction/link entity, served on that entity's own
 * schema (`crud_factory.LinkCreateAction`). Present only for the six link
 * tables; `undefined` for every other entity.
 *
 * `pathTemplate` carries one `{...}` placeholder per id-bearing path segment,
 * each named after the **link row's own FK column** — so a caller holding both
 * ids (which a relationship tab always does: one is the record being viewed,
 * the other is what the user just picked) substitutes by field name with no
 * per-entity knowledge, and the same declaration works from either end of the
 * junction.
 *
 * `permission` is the exact code the bespoke route gates on, for
 * `usePermissions`. It is **not** always `<resource>.create`: REQ-4's and
 * PLAN-1's two junction routes predate ADR-0076 and gate on the parent's
 * `test_suite.update`/`test_plan.update`.
 */
export interface LinkCreateAction {
  pathTemplate: string;
  permission: string;
}

/**
 * [ADR-0077](../../../docs/adr/0077-relationship-tab-unlink-action.md):
 * `LinkCreateAction`'s exact mirror — how to **remove one row** of a
 * junction/link entity, served on that entity's own schema
 * (`crud_factory.LinkDeleteAction`). Present only for the six link tables;
 * `undefined` for every other entity.
 *
 * `pathTemplate` is filled by `interpolateLinkPath` from the same
 * `{scopeField: parentId, targetField: farId}` map "Link existing …" already
 * builds, so a relationship tab needs no extra state to unlink a row it is
 * already rendering. For all six junctions today it is the same URL as
 * `linkCreate.pathTemplate` — a fact about how those six were designed, not a
 * rule: it is served separately precisely so a future junction whose unlink
 * lives elsewhere needs no client change.
 *
 * `permission` is the exact code the bespoke `DELETE` gates on, and is **not**
 * always `<resource>.delete`: REQ-4's and PLAN-1's junction routes predate this
 * ADR and gate both verbs on the parent's `test_suite.update`/
 * `test_plan.update`. It is also **not** necessarily the same code as
 * `linkCreate.permission` — for the four ADR-0005 traceability links the two
 * differ, which is the whole reason the actions are gated independently.
 */
export interface LinkDeleteAction {
  pathTemplate: string;
  permission: string;
}

/**
 * [ADR-0078](../../../docs/adr/0078-compound-create-through-bespoke-routes.md):
 * how a relationship tab creates the **far** entity of a junction when that
 * entity has no generic `create` route at all.
 *
 * ADR-0076 Amendment 1's "Create new <far entity>" is the far entity's generic
 * `create` followed by this junction's `linkCreate`. Three of the twelve live
 * link directions point at an entity with no generic `create` —
 * `TestCondition` and `Defect`, both authored only through a bespoke atomic
 * route because their parent FK is `NOT NULL`. This declaration substitutes
 * that bespoke route for the first call; everything else about the action is
 * unchanged.
 *
 * Served on the **link** entity's own schema, as a list, because it is
 * **directional**: a junction lists from both ends and typically only one end
 * needs this. `farField` says which — match it against
 * `relation.targetField`.
 */
export interface CompoundCreateAction {
  /**
   * Which of the link row's two FK columns the created record fills. The tab's
   * own `relation.scopeField` is the other one, by construction.
   */
  farField: string;
  /**
   * The bespoke route's URL with **exactly one** `{...}` placeholder, named
   * after the created entity's own parent FK column
   * (`/requirements/{requirement_id}/test-conditions`). Filled by
   * `interpolateLinkPath`, the same substitution `linkCreate` uses.
   */
  pathTemplate: string;
  /** The exact code that route gates on — not always `<resource>.create`. */
  permission: string;
  /**
   * Whether that route writes **this junction's** link row itself, inside its
   * own transaction. `true` — one request and the tab is done; calling
   * `linkCreate` afterwards would `409` on the pair it just wrote. `false` —
   * the route linked something else (or nothing), and the client must follow
   * with `linkCreate`, exactly as ADR-0076 Amendment 1 does.
   *
   * Not inferable from anything else on the wire, which is why it is declared.
   */
  linksAutomatically: boolean;
  /**
   * The four fields below describe the **parent picker**, and are `null`
   * exactly when none is needed — i.e. when `pathTemplate`'s placeholder names
   * the tab's own `scopeField`, so the tab already holds the value. Whether a
   * picker is needed is therefore *derived* from that comparison, never read
   * off these being present.
   */
  parentEntity: string | null;
  parentLabel: string | null;
  /** Which field of a picked parent row to display — declared, because the far entity's own FK `labelField` can be a poor picker label. */
  parentLabelField: string | null;
  /**
   * Extra fixed query params the picker must send for a business rule the
   * route enforces and the picker cannot see (`{result: "fail"}` — a defect
   * can only be raised against a failed execution). `{}` when there is none.
   */
  parentFilters: Record<string, string>;
  /** ADR-0087: render the parent picker as `FkSelect` — same bounded-catalog caveat as `ScopeSelectorOption.select`. */
  parentSelect?: boolean;
}

export interface EntityConfig {
  /** snake_case, matches the API's permission-code resource segment. */
  resource: string;
  /** e.g. "/environments" — used for `get`/`update`/`delete` always, and for `list`/`create` unless overridden below. */
  path: string;
  /**
   * Extension (see module doc comment, point 3): overrides `path` for
   * `list` only when the real backend route doesn't fit `{path}` (only
   * `Release`, whose `list` is `GET /projects/{project_id}/releases`, not
   * `GET /releases?project_id=...`). May contain a `:projectId`/`:orgId`
   * placeholder, interpolated from the current route params.
   */
  listPath?: string;
  /** Same override, for `create` (only `Release`). */
  createPath?: string;
  /**
   * ADR-0060 extension: only `Project` uses this today.
   * `EntityTable` has no built-in "click a row to navigate elsewhere"
   * concept — every entity's own detail view is its generic edit form.
   * `Project`'s pre-existing bespoke screen (`ProjectsPage`) linked each
   * row's name to `ProjectDetail`, a real per-entity workspace no other
   * generic-admin entity has an equivalent of. `detailPath` (a template with
   * a `:id` placeholder, e.g. `/projects/:id`) + `detailLinkField` (which
   * field's table cell becomes the link, e.g. `"name"`) together restore
   * that navigation generically, without inventing a per-entity special
   * case in `EntityTable` itself. Both are frontend-only route-wiring
   * (ADR-0053's split), set via `entityConfigs/overrides.ts`.
   */
  detailPath?: string;
  detailLinkField?: string;
  /** Matches backend's scope_field shape (RiskItem's tuple case). */
  scopeField?: string | [string, string];
  /** RiskItem/Attachment (per §4) plus the other scope-selector entities documented above. */
  scopeSelector?: ScopeSelectorOption | ScopeSelectorOption[];
  /** `Project` only — see `ScopeResolution`'s own doc comment. */
  scopeResolution?: ScopeResolution;
  /** mirrors the entity's own backend CrudEntityConfig.methods. */
  methods: ("list" | "get" | "create" | "update" | "delete")[];
  fields: FieldConfig[];
  filterFields?: string[];
  searchFields?: string[];
  /**
   * ADR-0074: backend-derived inbound relationships, one tab each on
   * `EntityDetailPage`.
   *
   * Optional for the same reason `filterFields`/`searchFields` are: a config
   * assembled by `toEntityConfig` always carries it (normalized to `[]` when
   * the wire omits it), but this repo has many hand-written `EntityConfig`
   * literals in Vitest fixtures, and a *required* key would make every one of
   * them a compile error for a field none of them care about. Read it as
   * `config.relations ?? []`.
   */
  relations?: EntityRelation[];
  /**
   * ADR-0076: backend-declared handle on this entity's bespoke link-create
   * route. Optional for the same reason `relations` is — every hand-written
   * `EntityConfig` literal in the Vitest fixtures would otherwise become a
   * compile error for a key none of them care about. Absent for the 25
   * non-link entities.
   */
  linkCreate?: LinkCreateAction;
  /**
   * ADR-0077: backend-declared handle on this entity's bespoke link-delete
   * route. Optional for the same reason `linkCreate` is — every hand-written
   * `EntityConfig` literal in the Vitest fixtures would otherwise become a
   * compile error for a key none of them care about. Absent for the 25
   * non-link entities, and independently absent from `linkCreate`: a junction
   * that could be linked and not unlinked was the real, shipped state of four
   * of the six between ADR-0076 and ADR-0077, so the two keys are deliberately
   * not modelled as one.
   */
  linkDelete?: LinkDeleteAction;
  /**
   * ADR-0078: per-direction compound-create actions, for a junction direction
   * whose far entity has no generic `create`. Optional for the same
   * fixture-compatibility reason as the two keys above, but semantically a
   * *list searched by direction* rather than a presence flag — a consumer does
   * `compoundCreates?.find(a => a.farField === relation.targetField)`, so
   * absent, `[]`, and "declared, but not for this direction" all correctly
   * collapse to "no compound create here".
   */
  compoundCreates?: CompoundCreateAction[];
  /**
   * ADR-0079: `compoundCreates`' one-to-many sibling — declared on the CHILD
   * entity's own config, never a link entity's, and matched by
   * `farField === relation.scopeField` (never `relation.targetField`, which
   * is `null` for every one-to-many tab). Same `CompoundCreateAction` shape;
   * only the matching key differs, because a one-to-many tab's "far field" is
   * the entity's own already-known scope column, not a second FK to solve
   * for. Optional for the same fixture-compatibility reason as the two keys
   * above.
   */
  childCompoundCreates?: CompoundCreateAction[];
}
