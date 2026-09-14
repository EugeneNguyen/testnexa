# UI Design Document — generic entity detail page

- **Story:** ADR-0070 / FR-ADMIN-4 / NFR-70
- **Date:** 2026-09-15
- **ADR:** [ADR-0070](../adr/0070-generic-entity-detail-page.md)
- **Screens touched:** the generic admin CRUD surface only (`EntityListPage`'s table, plus one new page). No bespoke screen changes.

## 1. The problem, in UI terms

Two filters sit between an entity's data and a human's eyes:

- `EntityTable` renders a column only for a field the served schema marks `showInTable`.
- `EntityForm` renders a control only for a field the API accepts in a write payload.

A field satisfying neither is invisible everywhere. Verified live against all 28 entities' served schemas (2026-09-15):

| Entity | Fields with `showInTable: false` |
|---|---|
| `TestPlan` | `scope`, `approach`, `staffing_and_training`, `schedule`, `created_by_actor_id` |
| `TestCase` | `preconditions`, `expected_result`, `created_by_actor_id` |
| `TestExecution` | `actual_result`, `executed_by_actor_id` |
| `Defect` | `reported_by_actor_id` |
| `RiskItem` | `mitigation` |

The `*_by_actor_id` columns are also `readOnly`, so `EntityForm` shows them only as disabled display — readable today by accident of that rendering choice, on a page whose purpose is editing. `TestPlan.scope`/`approach`/`schedule` and `TestCase.preconditions`/`expected_result` are the long-form content a tester most wants to read, and reading them currently means opening a mutation surface.

## 2. Entry point: the row itself

`EntityTable`'s rows become clickable. Affordance details, all owned by `EntityTable`:

- `cursor: pointer` on the `<tr>`.
- `tabIndex={0}`, and `Enter`/`Space` fire the same navigation as a click. A mouse-only row would be a new accessibility regression, not a feature.
- `data-testid="entity-table-row-<id>"` on each interactive row.
- **The trailing Actions cell stops propagation** (`click` and `keydown`), so Edit and Delete stay independent affordances. Visually nothing about that cell changes.
- A list whose caller wires no destination renders rows exactly as before — no cursor change, no `tabIndex`, no testid. Non-admin callers are untouched.

Destination, owned by `EntityListPage`: `./:id`, **except** when the entity's config declares `detailPath` (ADR-0060 — only `Project` today), in which case the row click follows that instead. `Project` rows already link their name cell to `ProjectDetail`; a row click landing somewhere else would give one row two destinations.

## 3. The detail page

Route: `/orgs/:orgId/admin/:entity/:id` and `/projects/:projectId/admin/:entity/:id`.

```
┌─ container-fluid px-4 py-4 ───────────────────────────────────────────┐
│ ┌─ card ────────────────────────────────────────────────────────────┐ │
│ │ card-header                                                       │ │
│ │   h1.card-title.fs-4   "{Entity label} details"                   │ │
│ │                                     card-tools ▸ [Back] [Edit]    │ │
│ ├───────────────────────────────────────────────────────────────────┤ │
│ │ card-body                                                         │ │
│ │   dl.row                                                          │ │
│ │     dt.col-sm-3  ID            dd.col-sm-9  <uuid>                │ │
│ │     dt.col-sm-3  {field label} dd.col-sm-9  {formatted value}     │ │
│ │     …one pair per field in the served schema, in schema order…    │ │
│ └───────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

Prose and sketch agree, deliberately (per root `CLAUDE.md`'s note on ADR-0032's contradicting pair): the header row is title-left / actions-right; the body is a single `<dl class="row">` whose **first** pair is the record's `id`, followed by one pair per schema field **in the order the schema serves them**, with no filtering of any kind.

Markup is stock Bootstrap 5 (`dl.row` + `dt.col-sm-3` + `dd.col-sm-9` is Bootstrap's own documented horizontal-description-list pattern), consistent with the sibling admin pages' `container-fluid px-4 py-4 h-100` + `Card` atom shell. No invented class names.

### Values

Every value renders through the shared `EntityFieldValue` molecule that `EntityTable`'s cells now also use — so a value looks the same in both places by construction, not by convention:

| Field type | Rendering |
|---|---|
| `fk` | the ref entity's `labelField`, resolved via the same batched/deduped lookup the table uses; falls back to the raw id |
| `enum` | `<span class="badge bg-*">`, colour from the schema's own `badgeColors`, grey fallback |
| `boolean` | `<span class="badge bg-success\|bg-secondary">Yes\|No</span>` |
| `date` | `Intl.DateTimeFormat(dateStyle: "medium")` |
| everything else | plain text, `—` when null/empty |

One deliberate difference: `detailPath`'s name-cell **link** is suppressed here (`linkDetailField={false}`) — linking to the page you are already on is noise.

### Actions

- **Back** — always present, `navigate(-1)`. Navigation, not a mutation, so it is ungated.
- **Edit** — present only when the served schema includes `update` **and** the actor holds `<resource>.update`. Absent, not disabled, matching NFR-37's established posture for the list's own "New" button. Navigates to `./edit`.

Nothing else. No inline editing, no delete, no related-record panels. `TestCase`'s Defects and Requirement sections stay on `EntityFormPage` where ADR-0044/ADR-0069 put them.

### States

| State | Renders |
|---|---|
| schema in flight (ADR-0053, one round trip on every load) | `Spinner` — explicitly **not** the unknown-entity error |
| schema settled, no config (unrecognised `:entity`) | `Alert color="danger"` — "Unknown admin entity …" |
| schema has no `get` method | `Alert color="info"` — a detail view is unavailable for this entity. No entity hits this today; kept so a future one degrades to a message rather than a failed fetch |
| record fetch in flight | `Spinner` |
| record fetch failed | `Alert color="danger"` — "Something went wrong loading this record." |

## 4. Breadcrumb

Two new `ROUTE_BREADCRUMBS` patterns, same shape as the existing `/edit` pair:

- org-scoped: `Dashboard → {entity label} → Details`
- project-scoped: `Projects → {project name} → {entity label} → Details`

The entity segment links back to that entity's list; `Details` is the active, unlinked final segment.

## 5. Open questions, and the defaults taken

1. **Should the detail page show the `id`?** Yes — it is not in `fields[]`, it is what the URL is keyed on, and it is the value a user needs when cross-referencing an API response or a log line.
2. **Should Back be `navigate(-1)` or a link to the entity's list?** `navigate(-1)`, so arriving from a filtered/paginated/sorted list returns to that exact state rather than a reset page 1. The breadcrumb's entity segment already offers the "go to the list" link for anyone who wants it.
3. **Should a row click be suppressed while a delete modal is open?** Not needed — the modal's own backdrop already intercepts clicks.
4. **Should `readOnly` fields be visually distinguished?** Not this pass. Every field on this page is read-only, so a per-field marker would mark almost everything and mean nothing.
