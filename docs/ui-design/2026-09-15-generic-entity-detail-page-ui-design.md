# UI Design Document — generic entity detail page

- **Story:** ADR-0073 / FR-ADMIN-6 / NFR-73; extended 2026-09-15 by ADR-0076 / FR-ADMIN-8 / NFR-78 (§6), corrected the same day by ADR-0076 Amendment 1 / NFR-79 (§6.1, §6.2, §6.3, §6.7a)
- **Date:** 2026-09-15
- **ADR:** [ADR-0073](../adr/0073-generic-entity-detail-page.md); §6 is [ADR-0076](../adr/0076-relationship-tab-write-actions.md), building on [ADR-0074](../adr/0074-entity-detail-relationship-tabs.md) + [ADR-0075](../adr/0075-junction-table-registry-completeness.md) and its Amendment 1
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

> **Two same-day corrections to that last sentence, both additive and neither touching the header actions above.** (1) ~~No related-record panels~~ — [ADR-0074](../adr/0074-entity-detail-relationship-tabs.md) partially supersedes this clause: the page gains an **Info** tab (everything described in this §3) plus one tab per inbound relationship, selected via `?tab=`, and [ADR-0075](../adr/0075-junction-table-registry-completeness.md) + its Amendment 1 take that to **30 relationships across 10 entities**. The header row, the `dl.row` body and the Back/Edit actions above are unchanged — they are what the Info tab renders. (2) ~~read-only~~, as a whole-page claim — **§6 below** ([ADR-0076](../adr/0076-relationship-tab-write-actions.md)) puts write actions on each *relationship tab* — ~~exactly one~~ one on a 1-n tab and **two** on an n-n tab, per that ADR's own Amendment 1 (see §6.1). The **Info tab stays fully read-only**, and so does this section: no inline editing and no delete, anywhere on the page.

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

## 6. Write actions on the relationship tabs ([ADR-0076](../adr/0076-relationship-tab-write-actions.md), FR-ADMIN-8 / NFR-78)

ADR-0074 and ADR-0075 left **all 30 relationship tabs read-only**. For the four [ADR-0005](../adr/0005-traceability-link-dedicated-join-tables.md) traceability link tables that was a capability gap, not a styling one: the tab is the only place in the app where the relationship is visible at all, and a link row could only ever be written as a *side effect* of authoring one of its two ends. "Link a test case that already exists", "this failure is the defect we already have" — neither was reachable from anywhere. This section adds the affordance. It adds **no new screen, no new route and no new query param**: both actions are modals on the page §3 describes.

### 6.1 Which actions a tab carries, chosen by the relationship's kind

> **Corrected by [ADR-0076](../adr/0076-relationship-tab-write-actions.md) Amendment 1 (2026-09-15, pre-merge).** This section originally read *"One action per tab — never both"*, with the n-n row offering only `Link existing`. That was right about *kind* and wrong about *count*: an n-n tab could only link a record that **already existed**, so the commonest authoring case ("this requirement needs a test case, and that test case does not exist yet") still meant leaving the record, creating the row on the far entity's own list page, navigating back, and only then linking. Found by a live click-through, not by a failing test. The table below is the corrected rule; §6.7a describes the new modal.

| Tab kind | Buttons | What they open |
|---|---|---|
| **one-to-many** (the listed rows *are* child records) | `New` | the same `EntityForm` create modal `EntityListPage` already hosts, with the parent field locked |
| **many-to-many** (the listed rows are link rows) | `Link existing <far entity>` **and** `Create new <far entity>`, side by side | a picker modal holding one `FkAutocomplete` for the far entity (§6.5) — and, respectively, a form modal holding the **far entity's** own `EntityForm`, whose submit creates *and then links* (§6.7a) |

**Both n-n buttons render whenever permitted**, never conditioned on whether any linkable far rows exist: hiding `Create new` until a search came back empty would hide it exactly when it is least discoverable, and would make the strip's contents depend on a request the user has not made yet.

**1-n tabs are deliberately left with one action.** The mirror of "link an existing far record" would be "re-parent an existing child", which is a different and materially riskier operation — it moves a row out from under whatever else already references it — and is out of scope here.

The n-n button labels are both built from the tab's own label with the `" (linked)"` suffix stripped and lower-cased, so a `TestCase`'s "Defects (linked)" tab reads **"Link existing defects"** and **"Create new defects"** — the far entity names both, never the junction table. The 1-n button is just `New`, exactly as `EntityListPage`'s own create button reads, because the tab the user is standing on already supplies the noun and singularizing a set of plural, not-all-regular backend labels ("Entry/exit criteria") would invent a rule this surface does not have.

### 6.2 Placement

```
┌─ card ──────────────────────────────────────────────────────────────────┐
│ card-header                                                             │
│   ul.nav.nav-tabs.card-header-tabs   [Info] [Test steps] [Defects (…)]  │  ← ADR-0074
├─────────────────────────────────────────────────────────────────────────┤
│ card-body.pb-0  ·  d-flex justify-content-end gap-2                     │
│   1-n tab:                                                    [ New ]   │
│   n-n tab:   [ Link existing defects ]  [ Create new defects ]          │  ← §6.1, both
├─────────────────────────────────────────────────────────────────────────┤
│ card-body.pb-0  ·  alert-danger   ← only after a create-then-link whose │
│   "Ninth defect" (id d-9) was created, but linking it …       link half │  ← §6.7a
│   failed: … It was saved and is NOT linked — use "Link         failed   │
│   existing defects" to link it.                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ card-body (bare EntityTable)                                            │
│   ┌───────────────────────────────────────────────────────────────────┐ │
│   │ <th> … related rows, scoping column hidden, no Actions column …   │ │
│   └───────────────────────────────────────────────────────────────────┘ │
│   pagination                                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

Prose and sketch agree, deliberately (root `CLAUDE.md`'s note on ADR-0032's contradicting pair): the actions sit in **one `card-body` strip above the table**, right-aligned, inside the same card as the tab strip and the table — not in the card header beside the tabs, which is the tab strip's own row, and not below the table, which is where pagination lives. **One strip, not one per action** (Amendment 1): the two n-n buttons are siblings in it, separated by `gap-2`, since two adjacent `.btn`s carry no margin of their own. When no action is available that strip is **not rendered at all**, so the tab looks byte-for-byte as it did before ADR-0076 rather than reserving empty vertical space. `data-testid="entity-relation-actions"` on the strip, `entity-relation-create` / `entity-relation-link` / `entity-relation-create-link` on the buttons.

`Link existing` is the solid `btn-primary` and `Create new` the `btn-outline-primary`: both are real actions, but linking a record that already exists is the one ADR-0076 exists for, and two solid primaries side by side would assert no hierarchy at all. Outline **primary**, not secondary — this is not a cancel-shaped action.

The "created, but not linked" alert (§6.7a) is its own `card-body` strip directly below the actions, above the table — deliberately **outside** the modal that produced it, because it must outlive that modal's close. `data-testid="entity-relation-create-link-error"`.

> **Found and fixed while writing the test for the strip's own testid (Amendment 1):** `data-testid="entity-relation-actions"` had **never rendered**. The `Card` atom's section props declared only `children`/`className`, and TypeScript does not excess-property-check a JSX attribute whose name contains a hyphen — so `<Card.Body data-testid="…">` compiled cleanly and the attribute was discarded, invisible to `tsc` and to every test that had not yet queried it. `components/atoms/card` now declares and forwards `data-testid` on `Card`/`Header`/`Body`/`Footer`/`Title`.

### 6.3 Gating: hidden, not disabled — and gated twice for two different reasons

Both actions check two independent things, and conflating them would be wrong in both directions:

1. **Can the API do this at all** — `config.methods` includes `create` (1-n), or `config.linkCreate` is non-null (n-n). This is a property of the entity, identical for every user.
2. **May this actor** — `usePermissions(orgId).has(code, projectId)`, where the code is `<child resource>.create` for 1-n and the **served** `linkCreate.permission` for n-n. Fail-closed while the permission snapshot is loading.

**`Create new <far entity>` checks both of those twice over, once for each half of what it does** (Amendment 1 / NFR-79): the far entity's schema must declare `create` **and** the link entity must declare `linkCreate`; the actor must hold the far entity's own `<resource>.create` **and** the declared `linkCreate.permission`. All four, or no button. The permission conjunction is the load-bearing one: an actor holding only the create half would get a `201` and then a `403`, leaving a real far-entity row that is not linked and that this tab — which lists *link* rows — structurally cannot display. So the matrix is:

| Actor holds | `Link existing` | `Create new` |
|---|---|---|
| both codes | shown | shown |
| link code only | shown | hidden |
| far-`create` code only | hidden | **hidden** |
| neither | hidden | hidden |

The third row is the one worth stating outright, because the intuitive expectation is that it shows `Create new` alone. It does not, on purpose. The API-capability half matters too and is not hypothetical: 3 of the 12 live link directions point at an entity with no generic `create` at all (`TestCondition` and `Defect` are authored only through bespoke routes), so the button correctly never appears on those tabs regardless of permissions.

A missing permission makes the button **absent, not disabled** — §5 of the [generic admin CRUD UI Design Document](2026-09-05-generic-admin-crud-ui-design.md)'s hide-don't-disable posture (FR-ADMIN-2 AC4 / NFR-37), identical to `EntityListPage`'s own `canCreate`. Taking the permission code from the served schema rather than guessing it is the whole point of NFR-78: two of the six junctions gate on their *parent's* `test_suite.update`/`test_plan.update`, so any client-side naming convention would hide those two buttons from exactly the people entitled to use them. As always, the check never substitutes for the API's own enforcement — a revoked-mid-session grant still gets a real `403` from the route, surfaced through the modal's own error alert.

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

### 6.7a The "Create new …" modal (many-to-many) — one step, two requests ([ADR-0076](../adr/0076-relationship-tab-write-actions.md) Amendment 1, NFR-79)

Title: **Create new {far entity}**. Body, top to bottom:

```
┌─ modal ─────────────────────────────────────────────────┐
│ Create new test cases                              [×]  │
├─────────────────────────────────────────────────────────┤
│  [ Project      (disabled, = this route's project) ]    │  ← locked scope
│  [ Title                                           ]    │
│  [ Test level  ▾ ] [ Test type ▾ ] [ Status ▾ ]         │  ← the FAR entity's
│  [ Description                                     ]    │     own fields
│  [ alert alert-danger ]  ← only after a failed create   │
├─────────────────────────────────────────────────────────┤
│                                  [ Cancel ] [ Create ]  │
└─────────────────────────────────────────────────────────┘
```

Prose and sketch agree: the locked scope field renders **first**, disabled, exactly as `EntityForm` already renders any `lockedValues` entry; the far entity's own editable fields follow; the submit-level error alert is **below** the fields, which is where `EntityForm` puts it for every other form in this app (unlike §6.5's picker modal, whose alert is above the picker because there is only one control to be above).

**The form is backed by the far entity's schema, never the link entity's.** A link row is two FK columns and has no `create_schema` at all (ADR-0005); rendering *its* fields would ask the user to fill in two ids, one of which is the record they are already standing on.

**The far entity's own scope field is prefilled and locked**, from the same derivation §6.6 uses for the picker — a scope field is a query param on `list` and a body field on `create`, so one rule serves both rather than growing a second notion of "which project is this". In scoping case 3, where no scope can be derived from the route, the field is left **editable** rather than locked to a guess: degrading to "the user picks it" beats shipping a form that cannot be submitted.

**Submit runs two requests, in order:** the far entity's own generic `create`, then — with the id that returned — the **same** `config.linkCreate.pathTemplate` §6.5 POSTs to. The order is forced: the link route takes an id that must already exist.

**They are not one transaction, and the partial state has a defined outcome.** They are two independent routes, so atomicity would need a new backend route combining two separately-gated operations — a larger decision than the residual risk warrants (ADR-0076 Amendment 1's Alternatives). The only reachable partial state is *created, not linked*, and it is handled in two places:

- **Before**: the both-permissions gate in §6.3 forecloses the one predictable cause.
- **After**: if the link half fails regardless (a race, a duplicate-pair `409`, a cross-project `422`), the modal **closes** — a resubmit would otherwise create a second record for one intent — and the §6.2 alert appears above the table carrying four things, none of them optional: the created record's **own label** *and* its **id** (the label is what the user recognises, the id is what survives a rename and can be pasted into a search), the API's **own** reason rather than a generic failure string, the plain statement that it was saved and is **not** linked, and the **recovery** — "Link existing …", the sibling button already on screen, which now needs no form at all because the record exists. No bespoke "retry link" state was added for exactly that reason.
- An **ordinary create failure** (nothing was written) gets the opposite handling: the modal stays open with the user's input intact, `field_errors` land on their matching inputs, and no "created, not linked" alert appears — because nothing was created.

### 6.7 What is still not here

- **No per-row Edit or Delete**, unchanged from ADR-0074. Every listed record is fully editable on its own screen one click away, and a link row has nothing to edit at all — links are immutable, delete-and-recreate (ADR-0005). Omitting `onEdit`/`onDelete` is still what makes `EntityTable` drop the Actions column entirely.
- **No unlink.** Two of the six junctions have a `DELETE` route already and four have none; what removing a traceability link means for an already-exported RTM is a real decision for its own story. The tabs grow monotonically today.
- **Nothing on the Info tab.** §3's page-level actions are still exactly Back and a permission-gated Edit.
