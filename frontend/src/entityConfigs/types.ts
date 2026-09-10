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

export type FieldType = "string" | "enum" | "fk" | "date" | "boolean";

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
   * Extension (see module doc comment, point 1): true for fields present in
   * a `*Summary` schema but absent from both `Create*Request` and
   * `Update*Request` — table/display only, never part of a submitted
   * payload, always rendered disabled by `EntityForm`.
   */
  readOnly?: boolean;
}

/** One option for `EntityConfig.scopeSelector` (see module doc comment, point 2). */
export interface ScopeSelectorOption {
  /** Registry key of the entity `FkAutocomplete` searches against. */
  refEntity: string;
  /** The scope query-param/body-field name this option resolves. */
  paramName: string;
  /** Toggle-button label when this option is one of several (`RiskItem`). */
  label?: string;
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
}
