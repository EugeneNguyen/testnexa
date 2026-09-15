# UI Design Document — Generic Admin CRUD Surface

**Date:** 2026-09-05
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md), [ADR-0022](../adr/0022-generic-crud-router-factory.md) (backend contract this UI renders), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI, the project's design system), [ADR-0023](../adr/0023-frontend-shared-component-location.md) (`components/crud/` location, `FormField` error convention), [API Document §3/§5](../api/2026-09-03-api-design.md), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md)

First UI Design Document for this repo — no prior one existed; bespoke workflow screens (`Login`, `OrgHome`, `ProjectDetail`, etc.) were each specced inline in their own story/ADR instead. This document exists because the generic admin surface is, by construction, **not** one-screen-per-entity — it's one config schema rendered by 2 page components across 28 entities, and that schema is the artifact worth designing explicitly. Future generic-surface entities are additions to §3's config table, not new sections here.

**Out of scope, not an oversight:** REQ-2's direct TestCase-authoring UI (Requirement rows in `ProjectDetail.tsx` expanding to a TestCase list + "New Test Case" modal, TestCase entries expanding to a TestStep list + add/inline-edit) is a bespoke workflow-screen extension, not a generic-admin-surface entity — it isn't rendered by `EntityTable`/`EntityForm` or driven by an entity-config object, so per this document's own stated scope it belongs with the other bespoke screens instead. See the [REQ-2 scope plan](../superpowers/plans/2026-09-05-req-2-direct-test-case-plan.md) for its spec, and note one convention worth carrying forward to any future bespoke nested-list UI: it renders as a flat `<ul>`, not a nested `<CTable>`, inside an already-expanded outer row — a `<table>` nested inside another `<table>`'s cell aggregates the inner rows' text into the outer row's accessible name, breaking `getByRole("row", {name})`-style lookups (the same reason the pre-existing Release→TestCycle audit view above already avoided nested tables).

**Out of scope, not an oversight:** MCP-1 ([ADR-0033](../adr/0033-mcp-server-architecture.md), FR-MCP-1) — the MCP server is an AI-agent surface (Claude Code, Cursor), not a human-facing UI; there is no React component, no CoreUI element, no `EntityTable`/`EntityForm` rendering. Per this document's stated scope (the generic admin CRUD surface, which renders the 28-entity `entityConfigs/` family), MCP is structurally out of scope by definition. The Persona's explicit non-adoption of human-facing UX for this flow is documented in the Personas doc's "Persona 3 — agent-primary team" entry.

## 1. Design system constraints (carried from ADR-0012/ADR-0023, not re-litigated)

**Revised 2026-09-08 ([ADR-0042](../adr/0042-adminlte-design-system.md)):** every component below is written as **raw HTML/JSX against AdminLTE v4 / Bootstrap 5 classes** — `table.table`, `<form>`/`input.form-control`/`select.form-select`, a hand-rolled `div.modal` (render-nothing-when-closed, ESC + backdrop, **no focus trap**), `button.btn.btn-*`, `span.badge.bg-*` (`bg-*`, **not** `text-bg-*` — existing assertions check the exact class), `div.spinner-border[role=status]`, `div.alert.alert-*[role=alert]`. Still **no Tailwind**, and still no *invented* primitives — the constraint moved from "use the library's components" to "use the library's own class names verbatim." ~~Every component below is CoreUI-first (`CTable`, `CForm`/`CFormInput`/`CFormSelect`, `CModal`, `CButton`, `CBadge`, `CSpinner`, `CAlert`) — no hand-rolled table/form/input primitives~~ (superseded, kept for history). Text/date fields reuse `FormField`'s `invalid-feedback d-block`+`is-invalid` error-display convention (~~`CFormFeedback`+`invalid`~~) (DS-1/NFR-34); this surface does not introduce a second error-display pattern for its own enum/FK/boolean fields — the plan is a small family of sibling components (`FormField`, `FormSelect`, `FormFkAutocomplete`, `FormCheckbox`) all sharing that same convention.

## 2. Component inventory (`components/crud/`)

| Component | Renders | Bound to |
|---|---|---|
| `EntityTable` | `CTable` with one column per `fields[]` entry (label from config), pagination controls (`CPagination`), ~~a filter row for `filter_fields`~~ a header "Filter" button opening `FilterModal` (see below), a `?q=` search box if `search_fields` is non-empty, and a trailing actions column (Edit/Delete icons — `cilPencil`/`cilTrash`) | an entity config + the current page/filter/search state |
| `FilterModal` | a modal listing the current exact-match conditions, one row each (field picker + typed value control + remove button), an "Add condition" button, and Cancel/Clear all/Apply; opened from `EntityTable`'s header Filter button ([ADR-0072](../adr/0072-entity-table-filter-modal.md)) | the entity config's served `filterFields`, seeded on every open from the **applied** filter state `EntityListPage` owns |
| `EntityForm` | one input per `fields[]` entry, type-dispatched (§3), inside a `CModal` (create) or a dedicated `/edit` route (update) | React Hook Form, Zod schema built from `fields[]` (`required` → `.min(1)`/non-optional; `enum` → `z.enum(values)`; `fk` → `z.string().uuid()`; `date` → `z.string().date()`) |
| `FkAutocomplete` | `CFormInput` with a debounced (300ms) dropdown of matches | `?q=<term>` against the referenced entity's own list route; selecting an option stores its `id`, displays its `labelField` |
| `ScopeSelector` | a single `FkAutocomplete` gating the rest of the page — nothing else renders until a selection is made | `entityConfig.scopeSelector.refEntity`; on selection, sets the query param `EntityTable` needs to fire its first list call |

No entity-specific component exists anywhere in this list — adding entity #28 means adding a config object (§3), never touching this table.

**Correction — the struck-through "filter row for `filter_fields`" above described a control that did not exist ([ADR-0072](../adr/0072-entity-table-filter-modal.md)/ENTITY-FILTER-1, 2026-09-15).** It was accurate when this document was written, but an earlier refactor dropped the per-column filter row and nothing updated this row, `EntityTable`'s own module docstring (which made the identical claim), or its props — `filters?: Record<string, string>` and `onFilterChange?: (field, value) => void` stayed *declared* while neither was destructured in the component body or rendered anywhere. The state itself was never dead: `EntityListPage` owned real `filters` state the whole time, kept it in the list query's `queryKey`, and passed it to `listEntities` — so the state-to-query pipeline was live and correct end to end, and only the control that writes to it was missing. Replaced by the header Filter button + `FilterModal` row above, and the dead `onFilterChange(field, value)` prop by `onFiltersChange(filters)` (Apply commits the whole set at once, and a removed condition must actually disappear rather than survive a per-key merge). **This is why §8's own non-goals line needed correcting too** — it cited the filter row as an existing capability when justifying a scope boundary.

## 3. Field-config schema (drives both `EntityTable` and `EntityForm`)

```ts
type FieldType = "string" | "enum" | "fk" | "date" | "boolean";

interface FieldConfig {
  name: string;           // matches the API's JSON field name exactly
  label: string;          // column header / form label
  type: FieldType;
  required?: boolean;
  values?: string[];              // enum only
  refEntity?: string;             // fk only — key into the registry, not necessarily an entity with its own admin page
  labelField?: string;            // fk only — which field of the ref entity's summary to display
  showInTable?: boolean;          // default true; e.g. hide a long text field from the table, still in the form
}

interface EntityConfig {
  resource: string;               // snake_case, matches the API's permission-code resource segment
  path: string;                   // e.g. "/environments"
  scopeField?: string | [string, string]; // matches backend's scope_field shape (RiskItem's tuple case)
  scopeSelector?: { refEntity: string; paramName: string }; // RiskItem/Attachment only
  methods: ("list" | "get" | "create" | "update" | "delete")[]; // mirrors the entity's own backend CrudEntityConfig.methods
  fields: FieldConfig[];
  filterFields?: string[];        // served, derived from the schema's own per-field `filterable` (ADR-0072) — not hand-authored
  searchFields?: string[];
}
```

**Field-type → input mapping (FR-ADMIN-2 AC2):**

| `type` | Table cell | Form input |
|---|---|---|
| `string` | plain text | `FormField` (text) |
| `enum` | `CBadge` (color by value where the entity has an obvious status semantic, e.g. `Defect.severity`; plain text otherwise) | `CFormSelect` populated from `values[]` |
| `fk` | the referenced row's `labelField` value (resolved via a batched lookup, not one request per row) | `FkAutocomplete` |
| `date` | formatted date (`Intl.DateTimeFormat`, no raw ISO string) | native `CFormInput type="date"` |
| `boolean` | `CBadge` (Yes/No) | `CFormSwitch` |

A `methods` list without `"create"`/`"update"` means `EntityForm` is never mounted for that entity at all (`Permission`, `TestLog`, the 4 link tables) — the table's actions column simply has no Edit/Delete icons, not disabled ones, matching the "read-only, structurally, not permission-denied" distinction from a permission-hidden button (§5).

**Where this config comes from ([ADR-0055](../adr/0055-admin-3-backend-driven-entity-schema.md), ADMIN-3, 2026-09-09):** the two interfaces above are unchanged as a *shape* — `EntityTable`/`EntityForm` still consume exactly this — but they are no longer **authored** in the frontend. The per-entity `frontend/src/entityConfigs/<entity>.ts` files this section originally specified are deleted; every admin page now fetches its entity's shape from `GET /entities/{resource}/schema` (API Document §3.1) and assembles it into the same `EntityConfig` via `pages/admin/useEntitySchema.ts`. Three consequences for this section specifically:

- **The enum row's "color by value where the entity has an obvious status semantic" is now a served fact, not a per-screen judgement call** — `FieldConfig` gains `badgeColors?: Record<string, string>` (enum value → Bootstrap theme-colour name), already filtered backend-side to that field's own `values` and **omitted entirely** for the two enums with no semantic colouring (`EntryExitCriteria.type`, `TestLog.event_type`), which is what keeps the plain-text/grey fallback in this table live.
- **Only `path`/`listPath`/`createPath` stay frontend-owned** (`entityConfigs/overrides.ts`) — route wiring is information architecture, deliberately outside ADR-0055's scope. Everything else in `EntityConfig` is served.
- **Every screen shape in §4 gains a schema-fetch loading state** it did not have when this document was written, since a static import resolved synchronously and a fetch does not. `Release` is the one entity that still resolves synchronously from a hand-written config: it has no backend `CrudEntityConfig` to derive from (100% bespoke routes, §6), so it is absent from the registry by construction.

The `readOnly`, array-shaped `scopeSelector`, `scopeResolution` and `listPath`/`createPath` members also present in today's `entityConfigs/types.ts` predate ADR-0055 — they are ADR-0027's own documented additive extensions to this sketch, recorded in that file's module docstring rather than here.

**Column sort ([ADR-0056](../adr/0056-admin-4-generic-admin-crud-column-sort.md), ADMIN-4, 2026-09-11):** every column whose served `sortable !== false` (§3, `FieldConfig` gains `sortable?: boolean`, defaults `true`) renders its header as a clickable button instead of plain text. Three states, one icon per state, cycling on each click:

| State | Icon | Meaning |
|---|---|---|
| Unsorted | `fa-sort` (grey, `text-body-tertiary`) | this column is sortable but not the active sort key |
| Ascending | `fa-sort-up` | active sort key, A→Z / oldest→newest |
| Descending | `fa-sort-down` | active sort key, Z→A / newest→oldest |

Click cycle: unsorted → ascending → descending → unsorted. Clicking a *different* column's header always restarts that column at ascending (never carries over the previous column's direction) — only one column is ever the active sort key at a time, no multi-column sort. Choosing a sort resets the table to page 1 (a sort change is a new result set, not a new page of the old one — same convention as choosing a filter or typing a search term, §4). `Actions` (the trailing Edit/Delete icon column, when present) and any column with `sortable: false` (`Release`'s three fields — its list route is 100% bespoke, out of ADMIN-4's scope) render as plain, non-interactive header text, same as before this ADR.

**Filter modal ([ADR-0072](../adr/0072-entity-table-filter-modal.md), ENTITY-FILTER-1, 2026-09-15):** the exact-match filter capability gets its first real control (see §2's correction for what it replaces). `FieldConfig` gains `filterable?: boolean` (defaults `true`, served — §3's `EntityConfig.filterFields` is now the aggregate of it) and the header gains one **icon-only** "Filter" button (Font Awesome `filter` via the `Icon` atom, `aria-label`/`title="Filter"`), sitting in the `.card-header .card-tools` row immediately beside [ADR-0071](../adr/0071-entity-table-column-preferences.md)'s sibling "Columns" button — the two are designed to be adjacent. `FilterModal` composes the existing `Modal` molecule + `Button`/`Select`/`TextInput` atoms + `FkSelect`/`FkAutocomplete` molecules; no new raw `.modal`/`.btn`/`.form-select` markup is introduced.

Header row, left to right (prose and this sketch must stay in agreement — root `CLAUDE.md`'s own rule for this document):

```
┌─ .card-header ─────────────────────────────────────────────────────────────┐
│ .card-title: "<Entity label>"          .card-tools: [🔍 Search…] [▦][▼ 2][+ New] │
└────────────────────────────────────────────────────────────────────────────┘
                                                        │   │    │      │
                    the `?q=` search box ───────────────┘   │    │      └── "New" (hidden/disabled per §5)
            "Columns" button (ADR-0071, icon-only) ─────────┘    │
              "Filter" button (icon-only) + active-condition ────┘
              count badge; `btn-outline-primary` while any
              filter is applied, plain otherwise
```

Each condition row is a **field picker plus a value control** — and nothing else:

| Element | Behaviour |
|---|---|
| Field picker (`Select`) | offers only fields the served schema marks `filterable` (every field **except** those of type `text`), in config order, **minus any field another row already claims** — the row's own current field always stays selectable. Re-pointing a row at a different field clears its value |
| Value control | typed, reusing **exactly** `EntityForm`'s own §3 branch above, so a field is filtered through the same control it is edited through: `enum` → `Select` of its served `values`; `boolean` → Yes/No `Select`; `date` → `<input type="date">`; `fk` → `field.select ? FkSelect : FkAutocomplete`; everything else → `TextInput` |
| Operator control | **none rendered at all.** The backend supports exact equality and nothing else, and `AND`s its conditions unconditionally — there is no `OR` to express and no operator to choose, so a single-option `<select>` would imply a choice nobody has. The conjunction is stated once in the modal's prose instead |
| Remove button | drops exactly that row; the rest keep their order |
| "Add condition" | appends a row **pre-assigned to the first still-unused filterable field**, never a blank picker; `disabled` once every filterable field is claimed (at most one condition per field — a second on the same field would compile to `field = a AND field = b`, always empty, which a user reads as "no results" rather than "contradictory query") |

Exits, and the state model behind them: **Apply** commits the whole condition set at once (incomplete rows — a field with no value, or a value with no field — are dropped rather than sent as empty-string filters); **Cancel** and **ESC** discard; **Clear all** empties the draft but still requires Apply to take effect. Draft edits are local until Apply, and the draft **re-seeds from the applied filters on every open**, so an abandoned edit never survives a reopen — same mechanism and same reason as ADR-0071's own re-seed. Applying a filter resets the table to page 1, the same convention a sort or search change already uses (§4).

**Filter state lives in `EntityListPage`, not `EntityTable` — deliberately the opposite of ADR-0071's column preferences**, on ADR-0071's own stated rule: a parameter that maps to a backend query parameter belongs to whoever owns the list query, and filters map directly to `?<field>=<value>` where column visibility/order map to nothing server-side. `EntityTable` owns only the modal's open/closed boolean. **Filters are also not persisted**, a second deliberate divergence from the sibling button's `localStorage`: a hidden column announces itself (a header is visibly missing), while a silently-filtered list just shows *fewer rows*, which reads as missing data or someone else's deletions — so filters stay session-only alongside `page`/`pageSize`/`sort`/`search`, all five of which are already component state only. The active-condition count badge in the sketch above is the mitigation that argument depends on: a narrowed list always has a visible cause in the header directly above it.

## 4. Screen layouts (three shapes, not 28)

**A — Global catalog** (`Role`, `Permission`, `RoleAssignment`, `TestDesignTechnique`, `TestLevel`, `TestType`): route `/orgs/:orgId/admin/:entity`. `EntityTable` fires its list query immediately on mount — no scope param needed.

**B — Project-scoped** (`Environment`, `TestPlan`, `EntryExitCriteria`, `TestCycle`, `Requirement`, `TestCondition`, `TestCase`, `TestStep`, `TestSuite`, `Defect`, `TestExecution`, `Organization`\*, `Project`\*, `OrgMembership`\*, `Release`\*): route `/projects/:projectId/admin/:entity`. `EntityTable` fires its list query with `?<scope_field>=:projectId` (or the entity's own resolved-chain param) immediately — the project is already the route context, no extra selector needed. (\*`Organization`/`Project`/`OrgMembership`/`Release` are technically org-scoped, not project-scoped, and additionally reachable from their bespoke screens — see §6.)

**C — Branch/deep-chain scope** (`RiskItem`, `Attachment`): route `/projects/:projectId/admin/:entity`, but `ScopeSelector` renders first — for `RiskItem`, a toggle between "by Requirement" / "by TestPlan" then an `FkAutocomplete` against whichever; for `Attachment`, a single `FkAutocomplete` against `TestCase`. `EntityTable` only mounts after that selection resolves to a concrete id.

## 5. Permission-driven hide/disable (FR-ADMIN-2 AC4, NFR-37)

`usePermissions(orgId)` (new hook, `auth/usePermissions.ts`) wraps `GET /orgs/{org_id}/permissions/mine` in a `useQuery`, exposing `has(code, projectId?)`. Every action affordance checks it **before** rendering:

- No `<resource>.create` → the "New" button above `EntityTable` is absent, not disabled (matches the existing codebase convention: `AppSidebar`'s org-scoped nav items are absent with no org context, never greyed out — same posture, ADR-0018).
- No `<resource>.update`/`.delete` on a **specific row** → that row's Edit/Delete icon is absent from that row's actions cell only — relevant where a permission is project-scoped and the entity spans rows in different projects (not reachable in this scaffold's route shapes today, since every list is already scoped to one project/org, but the per-row check is what makes the component correct if that ever changes).
- The check never substitutes for the API's own enforcement — a race between `usePermissions`' cached snapshot and a permission being revoked mid-session still gets the correct `403` from the write call itself, surfaced via the same generic error-toast every 403/409/422 already renders through.

## 6. Coexistence with bespoke screens

`Organization`, `Project`, `OrgMembership`, `Release` get a generic admin page **in addition to** their existing bespoke screen (`OrgHome`, `ProjectDetail`, `OrgMembers`) — this is deliberate (ADR-0027), not a duplicate-effort oversight. The bespoke screens stay the primary, task-shaped entry points (e.g. "create a project" is a purpose-built modal on `OrgHome`, not a raw field-by-field form); the generic admin page is the fallback for actions the bespoke screen doesn't surface (e.g. deleting an `OrgMembership` row outright, which no bespoke screen does today). No navigation link points from a bespoke screen into its own entity's generic admin page — that would be a confusing "two ways to do the same thing" affordance; the generic page for these 4 entities is reachable only via the Admin nav group (§7/Sitemap), not cross-linked from the bespoke one.

## 7. Navigation placement

Shape-A entities (global/org-scoped) get a new "Admin" `CNavGroup` in `AppSidebar`, alongside the existing "UI Elements" group, gated on `orgId` the same way — generated from the registry, not one nav-item literal per entity. Shape-B/C entities (project-scoped) are linked from `ProjectDetail.tsx`'s own body (a new "Admin" tab/section, since the sidebar has no project-context nav today) — see the [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md) for the full route tree.

## 8. Non-goals

No bulk-edit, no CSV import, ~~no per-column sort UI beyond what `filter_fields` already exposes as exact-match filters~~, no drag-reorder — none of FR-ADMIN-2's ACs ask for any of these, and adding them would be scope creep into what's deliberately a plain, generic list/form surface.

**Two clauses above are now stale, for two different reasons** (2026-09-15). (a) The sort clause was **overtaken**: [ADR-0056](../adr/0056-admin-4-generic-admin-crud-column-sort.md)/ADMIN-4 shipped click-to-sort headers under its own FR-ADMIN-3, so "no per-column sort UI" no longer holds — §3's Column sort block above is the live description. (b) Its justification was **never accurate to begin with**: it cited "what `filter_fields` already exposes as exact-match filters" as an existing UI capability, but the filter row it referred to had already been removed by an earlier refactor (§2's correction) — the exact-match filters were reachable only by hand-editing a query string until [ADR-0072](../adr/0072-entity-table-filter-modal.md) built the Filter modal. **Still non-goals** and unchanged: bulk-edit, CSV import, drag-reorder, multi-column sort, and — per ADR-0072's own rejected alternatives — per-condition operators (`contains`/`>`/`<`/`in`) and `OR`/nested condition groups, both of which are absent backend capabilities rather than declined UI choices, and each its own future ADR.

**Correction in place (2026-09-15): two of the four non-goals above have since been deliberately lifted by their own ADRs, and the sentence as written no longer describes this surface.** The original text is kept rather than rewritten (it is an accurate record of FR-ADMIN-2's own scope boundary at the time), with the two changes named here: **(a) per-column sort UI now exists** — ADMIN-4 ([ADR-0056](../adr/0056-admin-4-generic-admin-crud-column-sort.md), FR-ADMIN-3) added a click-to-toggle sort header on `EntityTable`, backed by a real `?sort=` query parameter, which is a strictly larger thing than the exact-match filters this line contemplated; **(b) column *reordering* now exists, but still not by dragging** — COLPREF-1 ([ADR-0071](../adr/0071-entity-table-column-preferences.md), FR-ADMIN-4, §9 below) adds per-viewer column visibility and ordering via Up/Down buttons in a modal, and explicitly keeps "no drag-reorder" as a live constraint, for the dependency reason ADR-0071 Decision §2 states. Bulk-edit and CSV import remain non-goals, unchanged.

**ADMIN-5 ([ADR-0066](../adr/0066-admin-5-seed-test-level-catalog.md), 2026-09-13) — reviewed, no UI impact.** This screen and every consumer of `TestLevel` (the `TestCase` create-form dropdown, `TestLevel`'s own generic admin list/form here) are unchanged — the seed migration only makes the data non-empty.

## 9. Column preferences — the "Columns" control ([ADR-0071](../adr/0071-entity-table-column-preferences.md), FR-ADMIN-4, COLPREF-1)

**Placement.** A "Columns" button in `EntityTable`'s own `.card-header .card-tools` — the same flex row that already holds the search input (`entity-table-search`) and the caller-supplied `headerActions` node, and where ADMIN-4's sort affordances already live. No new header region, no new card, no change to §4's three screen shapes: all three (global catalog, project-scoped, branch/deep-chain) get the control identically, because it lives on the table component itself rather than on any per-shape page wrapper.

```
┌─ .card-header ─────────────────────────────────────────────────────────┐
│  Requirements                      [ search… ] [ Columns ] [ + New ]   │
│  .card-title                       └──────── .card-tools ─────────┘    │
└────────────────────────────────────────────────────────────────────────┘
┌─ .card-body ───────────────────────────────────────────────────────────┐
│  Title ▲ | Status | Priority | …                                       │
└────────────────────────────────────────────────────────────────────────┘
```

(Prose and sketch agree deliberately, per root `CLAUDE.md`'s own ADR-0032 lesson: the button sits **to the right of the search box and to the left of `headerActions`**, inside `.card-tools`, in both descriptions.)

**The modal.** Clicking it opens `ColumnPreferencesModal` (`components/organisms/column-preferences-modal/`, an organism per [ADR-0043](../adr/0043-atomic-design-tiering-for-frontend-components.md) — it composes existing primitives and owns its own draft state). One row per field, in the current effective order:

```
┌─ Columns ──────────────────────────────────────────────┐
│  [x] Title            (locked)              ▲   ▼      │   ← detailLinkField: checkbox disabled,
│  [x] Status                                 ▲   ▼      │      Up/Down still enabled
│  [ ] Created at                             ▲   ▼      │   ← unchecked = hidden column
│  [x] Priority                               ▲   ▼      │   ← last row: ▼ disabled
│                                                        │
│  Reset to defaults              [ Cancel ]  [ Apply ]  │
└────────────────────────────────────────────────────────┘
```

- **Rows offered** = exactly the served schema's `showInTable !== false` fields ([ADR-0055](../adr/0055-admin-3-backend-driven-entity-schema.md)) — the same source the rendered columns come from. This control narrows the served set; it never widens it, and a `showInTable: false` field is never offerable here.
- **Checkbox** = show/hide. **Up/Down** = reorder — the first row's Up and the last row's Down are disabled. Not drag-and-drop, deliberately (ADR-0071 Decision §2): no drag library is a frontend dependency today, and adding one is its own decision with accessibility, touch-target and testability consequences this story declines rather than smuggles in.
- **Locked rows** (the config's `detailLinkField` when `detailPath` is set — [ADR-0060](../adr/0060-projects-page-retired-generic-surface.md)'s navigation affordance; and whichever field is the last one still visible) render with a **disabled, checked** checkbox — visibly present and visibly unchangeable, rather than omitted from the list, which would read as a missing field rather than a protected one. Locking governs visibility only: a locked row's Up/Down stay enabled.
- **Reset to defaults** clears the stored preference outright, returning the table to the served schema's own set and order.

**Where the state lives.** `EntityTable` itself, persisted to `localStorage` under `testnexa.column-prefs.<config.resource>` — **not** `EntityListPage`, which owns `page`/`pageSize`/`sort`/`filters`/`search`. The dividing line, stated here because this is the screen where a future contributor will have to apply it: those four each map to a backend query parameter and so belong to the component owning the list query; column visibility/order maps to nothing server-side and changes only what this component paints. Consequence for this document's own §4/§5: **no screen shape changes and no page-level prop changes** — `EntityListPage.tsx` is untouched by FR-ADMIN-4, and any future non-`EntityListPage` caller of `EntityTable` gets the control for free.

**Permission posture (relative to §5).** None. Column preferences are a per-viewer rendering convenience with no server-side effect and no data-access implication — there is no `<resource>.` permission code gating this control, and the button renders for anyone who can see the list at all. This is not an exception to §5's hide/disable rule; §5 governs *action* affordances (create/update/delete) that map to permission-checked writes, and this maps to no write.

**Degradation.** Every `localStorage` read and write is `try`/`catch`-wrapped: a private window, blocked or cleared site data, a quota failure, or a corrupt/unrecognised stored value all fall back to the served schema's defaults and the table renders normally (NFR-71). A stored preference is merged additively with the live schema — unknown stored names ignored, newly-served fields appended in config order — so a schema change under an existing preference never silently drops a column.
