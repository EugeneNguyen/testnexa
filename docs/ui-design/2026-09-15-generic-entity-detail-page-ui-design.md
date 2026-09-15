# UI Design Document — generic entity detail page

- **Story:** ADR-0070 / FR-ADMIN-4 / NFR-70; extended 2026-09-15 by ADR-0073 / FR-ADMIN-6 / NFR-75 (§6)
- **Date:** 2026-09-15
- **ADR:** [ADR-0070](../adr/0070-generic-entity-detail-page.md); §6 is [ADR-0073](../adr/0073-relationship-tab-write-actions.md), building on [ADR-0071](../adr/0071-entity-detail-relationship-tabs.md) + [ADR-0072](../adr/0072-junction-table-registry-completeness.md) and its Amendment 1
- **Screens touched:** the generic admin CRUD surface only (`EntityListPage`'s table, plus one new page). No bespoke screen changes. **No new screen and no new route is added by §6 either** — its two actions open modals on this same page.

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

> **Two same-day corrections to that last sentence, both additive and neither touching the header actions above.** (1) ~~No related-record panels~~ — [ADR-0071](../adr/0071-entity-detail-relationship-tabs.md) partially supersedes this clause: the page gains an **Info** tab (everything described in this §3) plus one tab per inbound relationship, selected via `?tab=`, and [ADR-0072](../adr/0072-junction-table-registry-completeness.md) + its Amendment 1 take that to **30 relationships across 10 entities**. The header row, the `dl.row` body and the Back/Edit actions above are unchanged — they are what the Info tab renders. (2) ~~read-only~~, as a whole-page claim — **§6 below** ([ADR-0073](../adr/0073-relationship-tab-write-actions.md)) puts exactly one write action on each *relationship tab*. The **Info tab stays fully read-only**, and so does this section: no inline editing and no delete, anywhere on the page.

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

## 6. Write actions on the relationship tabs ([ADR-0073](../adr/0073-relationship-tab-write-actions.md), FR-ADMIN-6 / NFR-75)

ADR-0071 and ADR-0072 left **all 30 relationship tabs read-only**. For the four [ADR-0005](../adr/0005-traceability-link-dedicated-join-tables.md) traceability link tables that was a capability gap, not a styling one: the tab is the only place in the app where the relationship is visible at all, and a link row could only ever be written as a *side effect* of authoring one of its two ends. "Link a test case that already exists", "this failure is the defect we already have" — neither was reachable from anywhere. This section adds the affordance. It adds **no new screen, no new route and no new query param**: both actions are modals on the page §3 describes.

### 6.1 One action per tab, chosen by the relationship's kind — never both

| Tab kind | Button | What it opens |
|---|---|---|
| **one-to-many** (the listed rows *are* child records) | `New` | the same `EntityForm` create modal `EntityListPage` already hosts, with the parent field locked |
| **many-to-many** (the listed rows are link rows) | `Link existing <far entity>` | a picker modal holding one `FkAutocomplete` for the far entity |

Never both, because the two kinds mean structurally different things: an n-n tab's rows are link rows, and there is no form to fill in for a link row — only two ids, one of which the page already knows. The button label for the n-n case is built from the tab's own label with the `" (linked)"` suffix stripped and lower-cased, so a `TestCase`'s "Defects (linked)" tab reads **"Link existing defects"**; the 1-n button is just `New`, exactly as `EntityListPage`'s own create button reads, because the tab the user is standing on already supplies the noun and singularizing a set of plural, not-all-regular backend labels ("Entry/exit criteria") would invent a rule this surface does not have.

### 6.2 Placement

```
┌─ card ──────────────────────────────────────────────────────────────────┐
│ card-header                                                             │
│   ul.nav.nav-tabs.card-header-tabs   [Info] [Test steps] [Defects (…)]  │  ← ADR-0071
├─────────────────────────────────────────────────────────────────────────┤
│ card-body.pb-0  ·  d-flex justify-content-end                           │
│                            [ New ]  ── or ──  [ Link existing defects ] │  ← §6, one only
├─────────────────────────────────────────────────────────────────────────┤
│ card-body (bare EntityTable)                                            │
│   ┌───────────────────────────────────────────────────────────────────┐ │
│   │ <th> … related rows, scoping column hidden, no Actions column …   │ │
│   └───────────────────────────────────────────────────────────────────┘ │
│   pagination                                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

Prose and sketch agree, deliberately (root `CLAUDE.md`'s note on ADR-0032's contradicting pair): the action sits in its **own `card-body` strip above the table**, right-aligned, inside the same card as the tab strip and the table — not in the card header beside the tabs, which is the tab strip's own row, and not below the table, which is where pagination lives. When neither action is available that strip is **not rendered at all**, so the tab looks byte-for-byte as it did before ADR-0073 rather than reserving empty vertical space. `data-testid="entity-relation-actions"` on the strip, `entity-relation-create` / `entity-relation-link` on the button.

### 6.3 Gating: hidden, not disabled — and gated twice for two different reasons

Both actions check two independent things, and conflating them would be wrong in both directions:

1. **Can the API do this at all** — `config.methods` includes `create` (1-n), or `config.linkCreate` is non-null (n-n). This is a property of the entity, identical for every user.
2. **May this actor** — `usePermissions(orgId).has(code, projectId)`, where the code is `<child resource>.create` for 1-n and the **served** `linkCreate.permission` for n-n. Fail-closed while the permission snapshot is loading.

A missing permission makes the button **absent, not disabled** — §5 of the [generic admin CRUD UI Design Document](2026-09-05-generic-admin-crud-ui-design.md)'s hide-don't-disable posture (FR-ADMIN-2 AC4 / NFR-37), identical to `EntityListPage`'s own `canCreate`. Taking the permission code from the served schema rather than guessing it is the whole point of NFR-75: two of the six junctions gate on their *parent's* `test_suite.update`/`test_plan.update`, so any client-side naming convention would hide those two buttons from exactly the people entitled to use them. As always, the check never substitutes for the API's own enforcement — a revoked-mid-session grant still gets a real `403` from the route, surfaced through the modal's own error alert.

### 6.4 The "New" modal (one-to-many)

Title: **New {tab label}**. Body: the shared `EntityForm` in `mode="create"`, nothing else — **no new form component**, and deliberately *not* a navigation to `EntityFormPage`, which ADR-0027 scopes to `/edit` only.

The relationship's own `scopeField` is passed as `lockedValues={{ [scopeField]: parentId }}`, which `EntityForm` already supports: it renders that field as a **disabled display field**, keeps it out of the Zod schema, and merges it into the submitted payload itself. So the new row lands under the record being viewed and the user cannot retarget it — which is what makes this action meaningfully different from "go to the child's list page and click New". Server-side `field_errors` land back on the matching inputs; anything else renders as the form's own submit-level error. On success the modal closes and every `entity-relation-list` query is invalidated (not just this tab's own page tuple — a new row can land on any page, and the user is not necessarily on page 1).

### 6.5 The "Link existing …" modal (many-to-many)

Title: **Link existing {far entity}**. Body, top to bottom:

```
┌─ modal ─────────────────────────────────────────────────┐
│ Link existing defects                              [×]  │
├─────────────────────────────────────────────────────────┤
│  [ alert alert-danger ]   ← only after a failed submit  │
│  [ ScopeSelector ]        ← only in scoping case 3      │
│  [ FkAutocomplete: "Defects" ]  ← once scope is known   │
├─────────────────────────────────────────────────────────┤
│                                   [ Cancel ] [ Link ]   │
└─────────────────────────────────────────────────────────┘
```

Prose and sketch agree: the error alert is **above** the picker and renders only after a failed submit; the `ScopeSelector` step, when needed, sits **above** the picker (you cannot search before you have a scope); the picker itself does not render until the scope is resolved. The footer is Cancel + **Link**, and `Link` stays **disabled until a row is picked** and while the request is in flight. `data-testid`s: `entity-relation-link-error`, `entity-relation-link-picker`, `entity-relation-link-submit`.

The picker is the same `FkAutocomplete` REQ-5/[ADR-0069](../adr/0069-req-5-standalone-test-case-with-optional-requirement-link.md) built for `EntityFormPage`'s "Link to Requirement" section — reused, not re-invented, and labelled with the far entity's own `labelField` read off the link entity's served `fields[]`. On submit the modal POSTs to the served `config.linkCreate.pathTemplate`, interpolated from `{[scopeField]: parentId, [targetField]: pickedId}` — the component hard-codes no route and knows no entity names.

### 6.6 The picker's three scoping cases

The far entity's own list route usually requires a scope value and `422`s without one, so the modal has to decide what to send *before* it can search. Resolved generically, in this order, with **no per-entity branch and no new component**:

| # | Condition | Behaviour |
|---|---|---|
| 1 | far entity has no `scopeField` | search unscoped; picker renders immediately |
| 2 | `scopeField === "project_id"` **and** the route carries `:projectId` | supply it; picker renders immediately. **9 of the 12 live link directions** |
| 3 | otherwise, far entity declares a `scopeSelector` | render the shared `ScopeSelector` molecule inside the modal, above the picker; the picker renders once a scope is chosen |

Case 3 is the same "pick a parent row before the list can fetch" step `EntityListPage` already shows for the same entities, in the same component — the modal reuses it rather than inventing a second scope-gate UI.

**Known blind spot, pre-existing and deliberately not worked around:** `TestCase` → "Defects (linked)" lands in case 3 behind `ScopeSelector`'s own cascading-picker gap — `Defect`'s selector searches `TestExecution`, which is itself scoped by `test_cycle_id` rather than `project_id`, so the search comes back empty. `scope-selector.tsx` documents that limitation by name for exactly this entity and predates this ADR; fixing it means a cascading multi-step picker, which is its own change. The same link is fully creatable from the other end (`Defect` → "Test cases (linked)", case 2) and the route itself is correct and tested, so the capability is reachable — only that one picker is blind.

### 6.7 What is still not here

- **No per-row Edit or Delete**, unchanged from ADR-0071. Every listed record is fully editable on its own screen one click away, and a link row has nothing to edit at all — links are immutable, delete-and-recreate (ADR-0005). Omitting `onEdit`/`onDelete` is still what makes `EntityTable` drop the Actions column entirely.
- **No unlink.** Two of the six junctions have a `DELETE` route already and four have none; what removing a traceability link means for an already-exported RTM is a real decision for its own story. The tabs grow monotonically today.
- **Nothing on the Info tab.** §3's page-level actions are still exactly Back and a permission-gated Edit.
