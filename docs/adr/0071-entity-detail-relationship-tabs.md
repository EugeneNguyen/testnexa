# ADR-0071: Relationship tabs on the generic entity detail page, from a backend-derived relationship graph

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0053](0053-tabler-install-phase-1-cdn.md)-era backend-driven entity schema as delivered by [ADR-0055](0055-admin-3-backend-driven-entity-schema.md); builds on [ADR-0005](0005-traceability-link-dedicated-join-tables.md)'s dedicated link tables and [ADR-0022](0022-generic-crud-router-factory.md)'s scoped list routes
- **Partially supersedes:** [ADR-0070](0070-generic-entity-detail-page.md) — its Consequences clause "related-record panels ... are deliberately out of scope". Every other part of ADR-0070 (the page itself, the unfiltered field list, row-click entry, `detailPath` precedence, the shared value renderer) stands unchanged.

## Context

[ADR-0070](0070-generic-entity-detail-page.md) shipped a read-only detail page
that renders every field of one record. It is deliberately flat: a record's
fields and nothing else.

That leaves the other half of "what is this record?" unanswered. A `Requirement`
has test conditions, risk items, and traceability links to test cases; a
`TestCase` has steps, attachments, and linked defects; a `TestPlan` has cycles
and entry/exit criteria. Today the only way to see any of them is to navigate to
that *other* entity's list page and filter it by hand — if its list page is even
reachable in the current scope.

The relationships themselves are already fully described in the backend, twice
over, and neither description is reachable from the frontend:

- **One-to-many** is `FieldMeta.ref_entity` read backwards. `Requirement` has
  many `TestCondition`s precisely because `_TEST_CONDITION_CONFIG` declares
  `requirement_id` with `ref_entity="requirement"`.
- **Many-to-many** is [ADR-0005](0005-traceability-link-dedicated-join-tables.md)'s
  four dedicated join tables, each carrying exactly two FKs.

`GET /entities/{resource}/schema` serves an entity's *own* fields, so a client
holding one schema can see which parents a record points **at** (many-to-one),
and has no way at all to discover what points **back**. Answering that from the
frontend would mean fetching all 28 schemas on every detail page.

### Why this is not an ADR-0070 amendment

`docs/CLAUDE.md` reserves an in-place `### Amendment` for a same-branch
correction to a story's own decision. This is not a correction — ADR-0070's
read-only, no-related-panels scope was right for what it shipped and its text
stays accurate. This adds a **new API contract field** (`relations` on a route
five components already consume), a **new derivation rule** other surfaces can
consume, and a **new UI pattern** (tabs, with a new shared primitive), and it
reverses an explicit Consequences clause. Per the ADR-first policy's own rule 2
— "if you're changing a prior decision, write a new ADR and mark the old one
superseded, don't silently edit history" — that earns its own number.

## Decision

### 1. The backend derives the relationship graph; the frontend never computes it

New `crud_factory.derive_entity_relations(config, all_configs)`, surfaced as a
tenth key, `relations`, on `derive_entity_schema` — so it rides the schema
request every admin page already makes. No extra round trip, and one
implementation serves both the REST route and the MCP `describe` tool, which
share that function.

The set is **computed** by walking `ALL_ENTITY_CONFIGS`, never hand-authored.
This is the direct answer to `backend/CLAUDE.md`'s registry-completeness rule
([ADR-0068](0068-mcp-6-per-entity-mcp-tools.md)): a hand-typed per-entity
relationship map is exactly the shape that silently omits one entity and simply
never renders its tab. A derivation cannot omit what it enumerates.

`all_configs` defaults to the real registry, imported lazily inside the function
— `entity_registry` imports `crud_factory` at load time, so the dependency must
stay one-way. The parameter exists for test injection.

### 2. Inbound only — many-to-one is deliberately excluded

A relation is emitted for entities pointing **at** this one. A field of *this*
entity pointing at a parent (`Requirement.project_id`) gets no tab: it is
already a labelled, fk-resolved value on the Info tab, and a tab listing exactly
one row would be a strictly worse way to show it.

### 3. Link tables are detected structurally, never by name

An entity is many-to-many iff it has **exactly two FK fields and no
`create`/`update`** — the literal shape `app/models/trace.py` describes ("two FK
columns... links are immutable, delete-and-recreate, never edited"). Matching on
a `_link` suffix would be a naming convention masquerading as a contract.

The rule's discrimination is real, not incidental: `TestExecution` has two FKs
but a real `update`; `RoleAssignment` has two FKs but a real `update` and no
`list`; `RiskItem` has two FKs but a real `create`. All three are correctly
excluded. A unit test pins the structural classifier against the `_link` naming
convention **in both directions**, so an entity drifting into or out of the
shape fails loudly rather than silently gaining or losing a tab.

### 4. A relation is emitted only when the generic list route can actually serve it

The tab's request is `GET /{entity}?{scopeField}={parentId}`. `crud_factory`'s
`extract_scope_value` 422s a list request not carrying exactly one scope value,
so the FK must be the child's own `scope_field` (or one arm of a branching
2-tuple one, which is how `RiskItem` is correctly a child of *both*
`Requirement` and `TestPlan`). The child must also register `list`.

**An FK that is only a `filter_field` is not enough** — the caller would still
owe the child's unrelated scope value, which a detail page for a different
entity cannot know. This is a real boundary, not a technicality, and it is why
12 inbound FKs produce no tab today:

| Excluded relationship | Why |
|---|---|
| `TestCase` → `TestExecution`s | `test_case_id` is a filter field; `TestExecution`'s scope is `test_cycle_id` |
| `TestCondition` → `TestCase`s | `test_condition_id` is neither scope nor filter on `TestCase` |
| `TestLevel`/`TestType` → `TestCase`s | filter fields only; `TestCase`'s scope is `project_id` |
| `Environment`/`Release` → `TestCycle`s | `TestCycle`'s scope is `test_plan_id` |
| Reverse side of all 4 link tables | each link's scope is one of its two FKs, so it lists from that side only |
| `Project`/`Role` → `RoleAssignment`s | `RoleAssignment` registers no `list` route at all |

**These are flagged, not worked around.** Serving them needs new backend list
capability (a widened `scope_field`, a bespoke reverse-list route, or promoting
a filter field to a scope) — a per-relationship API decision, not something to
smuggle into a frontend story. `tests/unit/test_adr71_entity_relations.py`
asserts this excluded set is the exact complement of the served one, so a future
entity or FK cannot land in neither bucket.

### 5. Many-to-many tabs list the link rows but are labelled and navigated by the far entity

A link row is bookkeeping; the user clicking a "Defects" tab wants defects. The
tab therefore:

- **lists** the link entity's rows (the only thing directly listable),
- is **labelled** with the far entity's label,
- and on row click follows `targetField` to the far record's id and opens
  *that* entity's detail page.

Resolving link rows through to the far records server-side would be either N+1
requests or a new join route; neither is worth it when the link rows already
render every FK as a resolved label through `EntityFieldValue`.

Many-to-many labels carry a `" (linked)"` suffix. This is disambiguation, not
decoration: `Requirement` reaches `TestCondition` **both** directly
(`TestCondition.requirement_id`, REQ-3's rigor path) *and* through
`RequirementTestConditionLink`. Both are genuine, separately-populated tabs, and
without the suffix the strip would show two identically-labelled tabs. Applied
to every many-to-many rather than only the colliding one, so the suffix reliably
means "reached via a traceability link" wherever it appears. A test asserts no
entity has two tabs sharing a label.

### 6. The scoping column is hidden in the tab's table

`scopeField` holds the same value — the parent's id — on every row in the tab,
by construction: it *is* the filter. It is suppressed by handing `EntityTable` a
config copy whose entry for that field has `showInTable: false`, reusing the
filter the component already applies rather than teaching it a hidden-columns
prop for one caller. The copy is non-mutating — `useEntitySchema` hands the same
cached object to every consumer, so flipping the flag in place would hide the
column on that entity's own list page too. The field stays in `fields`, so it is
still part of `useFkLabels`' schema-fetch list.

### 7. The active tab lives in the URL

`?tab=<entity slug>`, validated against the served relationship set, falling
back to Info when absent or unrecognized. Same deep-link posture that made
ADR-0070 fetch its own row rather than reuse the list's in-memory copy — a
relationship tab is shareable and survives a reload. Written with `replace` so
tabbing around doesn't bury the list page in history.

### 8. A new `Tabs` molecule

The mandatory reuse check (`frontend/CLAUDE.md`) found **no** tab primitive and
no hand-rolled near-duplicate anywhere in `frontend/src` — unlike the
`Card`/`Modal` cases there was no existing copy to promote, so one is built at
the molecule tier (ADR-0043).

Stock Bootstrap 5 markup (`ul.nav.nav-tabs > li.nav-item > button.nav-link`),
which both design systems in this repo style. **No `data-bs-toggle`** — Tabler's
JS bundle is loaded (ADR-0053) and would act on it, fighting React for ownership
of which panel shows; `frontend/CLAUDE.md`'s Tabler rule is that React owns the
state and the component only renders the resulting class string. Real
`<button>`s, so keyboard activation is the platform's. `role="tablist"`/`"tab"`,
`aria-selected` and `aria-controls` are hand-written, per ADR-0042's rule that
hand-written markup owns its own semantics.

The molecule deliberately has **no count badge**: a count would mean firing
every relationship's list request on mount just to render the strip, and
`badge bg-secondary` is currently invisible repo-wide (ADR-0070's own
Consequences) — a new call site of a known-broken class is not something to add
in a story that isn't fixing it.

## Consequences

- **Positive.** Every record's related records are one click away, on all 28
  entities at once, with no per-entity code. 22 relationships across 9 entities
  become reachable today.
- **Positive.** A new backend FK whose field is the child's scope field becomes
  a tab with **zero** frontend or backend work — the property ADR-0055 was
  written to buy, now extended from fields to relationships.
- **Positive.** Relationship tabs reuse `EntityTable` wholesale, so they inherit
  fk-label resolution, enum badges, date formatting, pagination and page-size
  selection, and cannot drift from the list pages.
- **Positive (side effect).** The MCP `describe` tool serves `relations` too,
  since it shares `derive_entity_schema` — an agent can now discover the
  relationship graph it previously had to infer.
- **Neutral / accepted.** 12 inbound FKs produce no tab (Decision §4). This is a
  *backend list-capability* gap surfaced by this story, not created by it, and
  it is asserted rather than assumed.
- **Neutral / accepted.** Relationship tabs are read-only — no create, no
  link/unlink, no inline edit. Every related record is fully editable on its own
  screen, one click away. Creating a traceability link from here would be a
  write surface on a page whose whole premise is reading.
- **Neutral / accepted.** Opening a tab costs two requests (the related entity's
  schema, then its rows). The schema is `staleTime: Infinity` and shared with
  that entity's own list page, so it is usually already cached.
- **Neutral / accepted.** Relationship paging is one shared page/page-size pair
  reset on every tab switch, not per-tab state.
- **Watch.** `make_crud_router` no longer calls `derive_entity_schema` to
  compute sortable fields — that line runs at module import, while the registry
  is still importing, so asking for the registry there is a genuine circular
  import. It reads a new `derive_sortable_fields` instead. The two are a second
  *derivation* of one fact, never a second hand-kept list, and a test asserts
  they agree for every registered entity.

## Alternatives considered

- **Hand-author the relationship map on the frontend.** Rejected outright: this
  is precisely the shape `backend/CLAUDE.md`'s registry-completeness note warns
  about, and the failure is silent (a missing tab, no error). The backend
  already holds the facts.
- **Have the frontend fetch all 28 schemas and derive relations client-side.**
  Correct, and 28 requests per detail page load. The backend can do it in one
  pass over data it already has in memory.
- **Include many-to-one as tabs.** Rejected — a tab that always contains exactly
  one row, duplicating a value already on the Info tab.
- **Resolve many-to-many through to the far entity's rows server-side.**
  Rejected for now: N+1 fetches or a new join route, to avoid showing link rows
  whose FKs already render as resolved labels. Revisit if the link-row view
  proves confusing in use.
- **Accordion/expand-in-place sections instead of tabs.** Rejected: many entities
  have 3-5 relationships, and stacking that many loaded tables on one page makes
  the Info fields — the page's actual subject — scroll off the top.
- **Serve the excluded relationships by relaxing the scope requirement.**
  Rejected as out of scope: each one is its own API decision about widening a
  list route's contract, and quietly dropping the 422 guard would break the
  tenant-scoping posture ADR-0022 built it for.
