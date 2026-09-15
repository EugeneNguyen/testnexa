# ADR-0073: A generic, read-only entity detail page on the admin CRUD surface

- **Status:** Partially superseded by [ADR-0074](0074-entity-detail-relationship-tabs.md) (the "related-record panels are out of scope" Consequences clause only — every other decision below stands unchanged)
- **Date:** 2026-09-15
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0025](0025-requirement-title-field.md)-era generic admin CRUD surface as delivered by [ADR-0027](0027-generic-admin-crud-ui-and-backend-completion.md) / [ADR-0055](0055-admin-3-backend-driven-entity-schema.md) / [ADR-0057](0057-admin-crud-pages-relocated-to-container.md); interacts with [ADR-0060](0060-projects-page-retired-generic-surface.md)'s `detailPath`
- **Supersedes:** nothing

## Context

The generic admin CRUD surface (28 entities, two route scopes) has exactly two
page components today: `EntityListPage` (list + create-in-a-modal + delete
confirm) and `EntityFormPage` (the `/edit` route). There is no way to *read* a
single record.

That gap is not cosmetic. Two independent filters mean a field can exist on an
entity and be visible **nowhere in the application**:

- `EntityTable` renders only columns with `showInTable !== false`.
- `EntityForm` renders only fields the API will accept in a write payload.

Confirmed against the live `GET /entities/{resource}/schema` for all 28
registered entities (2026-09-15, this branch's own isolated stack), five
entities carry `showInTable: false` fields today:

| Entity | Fields the list table does not show |
|---|---|
| `test-plans` | `scope`, `approach`, `staffing_and_training`, `schedule`, `created_by_actor_id` |
| `test-cases` | `preconditions`, `expected_result`, `created_by_actor_id` |
| `test-executions` | `actual_result`, `executed_by_actor_id` |
| `defects` | `reported_by_actor_id` |
| `risk-items` | `mitigation` |

`TestPlan.scope`/`approach`/`schedule` and `TestCase.preconditions`/
`expected_result` are exactly the long-form content a tester most wants to
read, and the only current way to see any of them is to open the edit form —
i.e. to enter a mutation surface in order to perform a read. Worse, the
`*_by_actor_id` audit columns are `readOnly`, so `EntityForm` renders them as
disabled display-only controls; they are readable today only by accident of
that rendering choice, on a page whose purpose is editing.

The obvious place to put a read view is the row itself — a table row that is
not clickable is a dead affordance that every other list surface in this app
(`ProjectsPage`'s name link, `TestPlanDetail`'s cycle rows) already contradicts.

## Decision

### 1. A third page component, `EntityDetailPage`

`container/entity-crud/EntityDetailPage/` joins `EntityListPage` and
`EntityFormPage` under ADR-0057's relocation. ADR-0025's "this surface has
exactly two page components" claim is extended to three; it is not superseded
in any other respect.

Routes, added inside `entityCrudRoutes()` (ADR-0057's one call site) so both
scopes get them from the same two existing `App.tsx` calls:

```
/orgs/:orgId/admin/:entity/:id
/projects/:projectId/admin/:entity/:id
```

React Router v6 ranks by segment specificity, so this cannot be ambiguous with
the existing 5-segment `/:entity/:id/edit`.

### 2. It renders `config.fields` **unfiltered** — that is the whole feature

The page reads the same fetched schema every other page on this surface reads
(`useAdminRouteContext` → `useEntitySchema`, ADR-0055) and one
`GET {path}/{id}` (`getEntity`), then renders a labeled value for **every**
entry in `fields[]` plus the record's own `id`. The single absent
`.filter((f) => f.showInTable !== false)` is the difference from `EntityTable`.

This is what makes it generic across all 28 entities with **no per-entity
branch anywhere in the component** — a new backend field appears on the detail
page the moment the schema serves it, with no frontend change, which is
precisely the property ADR-0055 was written to buy.

All 28 entities support `get` (verified live for the 27 factory-served ones,
plus `Release`'s static config and its real bespoke `GET /releases/{id}`
route), so no entity is excluded. A `!methods.includes("get")` branch is kept
anyway, mirroring `EntityListPage`'s own `canList` posture, so a future
get-less entity degrades to a message rather than a failed fetch.

### 3. Row click is the entry point; action controls are not row clicks

`EntityTable` gains an optional `onRowClick`. When passed, each `<tr>` becomes
a real, **keyboard-reachable** affordance (`tabIndex={0}`, Enter/Space parity
with the mouse, `cursor: pointer`). When omitted, the rendered `<tr>` is
byte-for-byte what it was before — every pre-existing caller and fixture is
untouched.

The trailing Actions cell calls `stopPropagation` on both `click` and
`keydown`, so Edit and Delete remain independent affordances. This is the one
piece of "where a click does *not* navigate" knowledge the component owns;
*where* a row click goes is `EntityListPage`'s, the same split already used for
sort and pagination state.

`tabIndex` changes neither a row's ARIA role nor its computed accessible name,
so every existing `getByRole("row", { name })` lookup resolves exactly as
before (`frontend/CLAUDE.md`'s nested-table note).

### 4. `EntityConfig.detailPath` takes precedence over the generic route

`Project` is the one entity with a real bespoke workspace of its own
(`ProjectDetail`), already reachable by clicking its name cell via ADR-0060's
`detailPath`/`detailLinkField`. Sending a row click somewhere *different* from
that same row's own visible link would give one row two destinations.

So `EntityListPage`'s `onRowClick` navigates to `config.detailPath` when the
entity declares one, and only falls back to the generic `./:id` route for the
27 entities that declare none. The branch is on **config data, not on an entity
name**, so it stays generic: any future entity that declares a bespoke
workspace gets the same behavior for free.

Corollary: no `/orgs/:orgId/projects/:id` route is added to `App.tsx` alongside
ADR-0060's existing `projects` list/edit mounts. `Project`'s detail view is
`ProjectDetail`; a second competing detail route for the same entity would be
the exact ambiguity this clause exists to avoid.

### 5. Value rendering is extracted, not duplicated

`EntityTable`'s private `renderCell`/`formatDate`/`displayValue` helpers and
its batched FK-label effect move to
`components/molecules/entity-field-value/` and `pages/admin/useFkLabels`
respectively, and both pages consume them. A field therefore reads identically
in a table cell and on the detail page — same fk-label lookup, same
`badge bg-*` enum/boolean badges, same date format, same `—` empty
placeholder.

Per `frontend/CLAUDE.md`'s own rule this extraction is a **reuse check, not an
architecture decision** — it needs no ADR of its own and gets none; it is
recorded here only because it happened in the same change. The rendered output
is unchanged (all 548 pre-existing Vitest tests pass across the move,
unmodified).

`useFkLabels` deliberately takes the label-field list and the schema-fetch
field list as **separate** arguments: `EntityTable` has always fetched ref
schemas for every `refEntity` on the config, visible column or not, and
narrowing that would be a silent behavior change smuggled into an unrelated
extraction.

### 6. Breadcrumb

Two `ROUTE_BREADCRUMBS` patterns added, one per scope, trailing segment
`Details`, with the entity segment linking back to its list — matching the
existing `/edit` entries' shape exactly.

## Consequences

- **Positive.** Five entities' hidden long-form fields and every entity's audit
  columns become readable without entering an edit form. A row click does the
  obvious thing on all 28 entities at once. A new backend field is visible with
  zero frontend work.
- **Positive.** One cell renderer instead of two-that-will-drift, and one
  fk-label implementation instead of two.
- **Neutral / accepted.** `/orgs/:orgId/admin/projects/:id` exists and renders
  the generic detail page for a Project, even though row clicks from that list
  go to `ProjectDetail` instead (Decision §4). A reachable-but-not-linked route
  is harmless; forbidding it would mean a per-entity exclusion in
  `entityCrudRoutes()`, i.e. exactly the per-entity branching this surface
  exists to avoid.
- **Neutral / accepted.** The detail page is **read-only**. It offers Back and
  (permission-gated) Edit, and nothing else. Inline editing, related-record
  panels, and per-entity sections are deliberately out of scope — `TestCase`'s
  own Defects/Requirement sections stay on `EntityFormPage` where ADR-0044/
  ADR-0069 put them, rather than being moved or mirrored here.

  > **Partially superseded the same day, [ADR-0074](0074-entity-detail-relationship-tabs.md)
  > — see that ADR.** The *related-record panels* half of this clause no longer
  > holds: the page gained an Info tab plus one tab per inbound relationship,
  > driven by a new backend-derived `relations` key on the entity schema. The
  > rest of the clause stands exactly as written — the page is still read-only
  > (the relationship tabs offer no create, link/unlink or inline edit), there
  > are still no per-entity sections, and `TestCase`'s bespoke
  > Defects/Requirement sections still live on `EntityFormPage`. The text above
  > is left as-is: it is an accurate record of what this ADR decided and why,
  > not a stale claim to strike out (`docs/CLAUDE.md`'s forward-pointing-
  > addendum convention).
- **Neutral / accepted.** The detail page issues its own `GET {path}/{id}`
  rather than reusing the row object the list already has in memory. That is
  one extra request per navigation, in exchange for a page that works on a
  deep link / hard refresh — the `useState`-instead-of-`useQuery` failure mode
  `frontend/CLAUDE.md` documents at length for `OrgHome`. It shares
  `EntityFormPage`'s own `["entity-item", entityKey, id]` query key, so
  detail → Edit is served from cache.
- **Watch.** `EntityTable`'s `<tr>` now carries `tabIndex={0}` on the admin
  surface. Tab order through a 100-row page is 100 stops longer than before.
  Accepted as the cost of not shipping a mouse-only affordance; revisit if a
  real complaint arrives.

### Pre-existing defect found during this ADR's own verification — badge text is invisible

A screenshot of the finished detail page (a real rendered page, not an
assertion) showed `TestPlan.status` as an **empty grey pill**: the text `draft`
is present in the DOM and the element has real size — so this ADR's own
`toHaveText(/draft/)` and `toBeVisible()` assertions both passed — but its text
colour equals its background colour, so nothing is readable.

Measured live across every variant: **every** `badge bg-*` renders its text in
one fixed grey, `rgb(107, 114, 128)`, that does not track the background.
`bg-secondary`'s background is that same grey, so it is invisible; the others
are merely low-contrast. Root cause is the same cascade class
`frontend/CLAUDE.md` already documents for `<pre>` — Tabler sets a fixed colour
on `.badge` and, since ADR-0054 moved its `<link>` after `main.tsx`'s CSS, that
rule beats Bootstrap's own `.badge { color: var(--bs-badge-color) }`.

**This is pre-existing and repo-wide, not introduced here.** The list table's
own badge was measured in the same pass and is byte-for-byte identical (same
class string, same computed `color` and `background-color`) — which is exactly
what Decision §5 predicts, since both now render through the one shared
`EntityFieldValue`. It affects `EntityTable`'s enum and boolean cells,
`EntityFormPage`'s Defect-severity badges, and anywhere else a badge renders.
`bg-secondary` matters most because it is the **default fallback for every enum
value the backend serves no `badgeColors` for** — the invisible case is the
default case.

**Deliberately NOT fixed in this pass**, and it needs its own ADR rather than a
drive-by: the obvious fix (Bootstrap 5.3's `text-bg-*`) is ruled out by this
repo's own standing convention that badges use `bg-*`, with 8+ existing
assertions pinning the exact class — so correcting it is a design-system
decision plus a coordinated assertion update, not a cleanup. Recorded in
`frontend/CLAUDE.md` with the full measurement table and the likely mechanism
(a class selector on the element, as used for the `<pre>` case). Same posture
ADR-0039 took toward the FK defect its own verification surfaced: name it,
don't absorb it, don't retrofit the fix into the ADR that found it.

### Amendment 1 (2026-09-15, same branch, pre-merge) — the shipped detail page issued unbounded FK-resolution requests

Found during [ADR-0074](0074-entity-detail-relationship-tabs.md)'s own
implementation, on this same unmerged branch, so it is recorded here as an
in-place amendment rather than a new ADR (`docs/CLAUDE.md`'s pre-merge
same-story-correction convention). The fix is one line in
`pages/admin/useFkLabels.ts`, not a new architectural decision.

**The defect.** `useFkLabels`' effect keyed on the `rows` **array identity**.
This page passed `row ? [row] : EMPTY_ROWS` — a freshly allocated array on
every render — so the effect re-ran on *every* render, and every run ends in
`setFkLabels(next)` with a fresh object, which re-renders. A self-sustaining
loop: **2913 `getEntity` calls in 400ms**, measured directly, for a record with
a single FK field. Every detail page for an entity with any FK — which is most
of them — hammered the backend for as long as it stayed open.

**Why nothing caught it.** The rendered output is byte-for-byte identical
whether the effect runs once or forever. Decision §5's claim that the value
renders correctly was true; §2's field-completeness claim was true; every
assertion in this ADR's own 17 unit tests and 5 e2e cases passed, because all of
them ask *what does the page show*. The live manual pass could not see it
either — the page looks and behaves correctly while doing it. This is the same
class as the invisible-badge finding below: a defect a rendered-output assertion
is structurally incapable of detecting, just reached by counting requests rather
than by looking at a screenshot.

It also did not reproduce as a *test* failure until ADR-0074's own new suite
happened to hold the component mounted a little longer, at which point the loop
starved the test runner and the file hung at 88% CPU — which is how it surfaced
at all.

**The fix.** `useFkLabels` already solved this exact problem one argument over:
`refConfigFingerprint` exists specifically because keying the effect on
`refConfigs`' object identity would loop. The same primitive-fingerprint
treatment now applies to the FK ids (`fkIdFingerprint`), so the effect re-runs
when the ids genuinely change and not when a caller merely rebuilt the array.
This fixes it for every caller rather than asking each one to memoize, and it
additionally stops `EntityTable` re-resolving labels on a list refetch that
returned the same FK values.

`pages/admin/useFkLabels.test.tsx` is new and exists solely to pin this: it
counts requests rather than asserting rendered output, because — per the
paragraph above — nothing about the rendered output can distinguish the fixed
from the broken version.

## Alternatives considered

- **Reuse `EntityFormPage` with every field disabled.** Rejected: `EntityForm`
  renders the *writable* field set by construction, which is the wrong set — it
  is missing exactly the `showInTable: false` + `readOnly` combination this ADR
  exists to surface. Widening it would mean a form component that sometimes
  renders non-submittable fields, which is worse than a second, simpler page.
- **Expand-in-place (a detail panel inside the list row).** Rejected: not
  deep-linkable, and `frontend/CLAUDE.md`'s nested-table rule makes rendering
  structured content inside a `<td>` an accessible-name hazard.
- **Make the whole row a `<Link>`.** Not possible — a `<tr>` cannot contain an
  anchor spanning its cells, and wrapping each cell's content in its own
  anchor breaks the Actions cell's buttons (an interactive control nested in a
  link).
- **Row click always uses the generic route, ignoring `detailPath`.** Rejected
  per Decision §4: for `Project` it would make the name cell and the rest of
  the row navigate to two different pages.
