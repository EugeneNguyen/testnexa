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
| `EntityTable` | `CTable` with one column per `fields[]` entry (label from config), pagination controls (`CPagination`), a filter row for `filter_fields`, a `?q=` search box if `search_fields` is non-empty, and a trailing actions column (Edit/Delete icons — `cilPencil`/`cilTrash`) | an entity config + the current page/filter/search state |
| `EntityForm` | one input per `fields[]` entry, type-dispatched (§3), inside a `CModal` (create) or a dedicated `/edit` route (update) | React Hook Form, Zod schema built from `fields[]` (`required` → `.min(1)`/non-optional; `enum` → `z.enum(values)`; `fk` → `z.string().uuid()`; `date` → `z.string().date()`) |
| `FkAutocomplete` | `CFormInput` with a debounced (300ms) dropdown of matches | `?q=<term>` against the referenced entity's own list route; selecting an option stores its `id`, displays its `labelField` |
| `ScopeSelector` | a single `FkAutocomplete` gating the rest of the page — nothing else renders until a selection is made | `entityConfig.scopeSelector.refEntity`; on selection, sets the query param `EntityTable` needs to fire its first list call |

No entity-specific component exists anywhere in this list — adding entity #28 means adding a config object (§3), never touching this table.

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
  filterFields?: string[];
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

No bulk-edit, no CSV import, no per-column sort UI beyond what `filter_fields` already exposes as exact-match filters, no drag-reorder — none of FR-ADMIN-2's ACs ask for any of these, and adding them would be scope creep into what's deliberately a plain, generic list/form surface.
