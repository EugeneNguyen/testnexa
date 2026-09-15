# ADR-0074: Relationship tabs on the generic entity detail page, from a backend-derived relationship graph

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0053](0053-tabler-install-phase-1-cdn.md)-era backend-driven entity schema as delivered by [ADR-0055](0055-admin-3-backend-driven-entity-schema.md); builds on [ADR-0005](0005-traceability-link-dedicated-join-tables.md)'s dedicated link tables and [ADR-0022](0022-generic-crud-router-factory.md)'s scoped list routes
- **Completed by:** [ADR-0075](0075-junction-table-registry-completeness.md) (2026-09-15) — this ADR's derivation was correct but incomplete in one specific way, found the same day: it enumerates `ALL_ENTITY_CONFIGS`, and two real junction tables had no entry there, so two genuine many-to-many relationships produced no tab (`TestSuite`'s strip was empty entirely). Decision §1's "a derivation cannot omit what it enumerates" and Decision §4's excluded-set-is-exhaustive claim are both corrected in place below. **Nothing in this ADR's Decision is reversed** — the derivation rule, the exclusion rules, the `?tab=` posture, the hidden scoping column and the read-only stance all stand; ADR-0075 registers the missing entities and moves the completeness assertion down to the model layer.
- **Partially supersedes:** [ADR-0073](0073-generic-entity-detail-page.md) — its Consequences clause "related-record panels ... are deliberately out of scope". Every other part of ADR-0073 (the page itself, the unfiltered field list, row-click entry, `detailPath` precedence, the shared value renderer) stands unchanged.

## Context

[ADR-0073](0073-generic-entity-detail-page.md) shipped a read-only detail page
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

### Why this is not an ADR-0073 amendment

`docs/CLAUDE.md` reserves an in-place `### Amendment` for a same-branch
correction to a story's own decision. This is not a correction — ADR-0073's
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

> **Corrected by [ADR-0075](0075-junction-table-registry-completeness.md)
> (2026-09-15).** That last sentence is true and was load-bearing for the wrong
> thing. A derivation cannot omit what it enumerates — but this paragraph never
> examined **the set being enumerated**, and `entity_registry._ALL_CONFIGS` is
> itself a hand-typed tuple, i.e. exactly the artifact the rule it cites is
> about. Two junction tables (`test_suite_test_case`, `test_plan_test_suite`)
> had bespoke membership routes and no `CrudEntityConfig`, so their
> relationships were invisible here and `TestSuite` rendered no tab strip at
> all. ADR-0075 registers both and moves the completeness assertion to the
> model layer (`Base.metadata`), which a model joins by declaration and so
> cannot be forgotten the way a registry row can.

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
**8** inbound FKs produce no tab today (12 as first written; 14 after ADR-0075
registered two more junctions, each contributing its own reverse side; **8**
since [ADR-0075 Amendment 1](0075-junction-table-registry-completeness.md#amendment-1-2026-09-15--every-junction-is-scoped-and-therefore-tabbed-from-both-ends)
removed the entire link-table row below):

| Excluded relationship | Why |
|---|---|
| `TestCase` → `TestExecution`s | `test_case_id` is a filter field; `TestExecution`'s scope is `test_cycle_id` |
| `TestCondition` → `TestCase`s | `test_condition_id` is neither scope nor filter on `TestCase` |
| `TestLevel`/`TestType` → `TestCase`s | filter fields only; `TestCase`'s scope is `project_id` |
| `Environment`/`Release` → `TestCycle`s | `TestCycle`'s scope is `test_plan_id` |
| ~~Reverse side of all 6 link tables~~ | ~~each link's scope is one of its two FKs, so it lists from that side only~~ — **no longer excluded.** [ADR-0075 Amendment 1](0075-junction-table-registry-completeness.md#amendment-1-2026-09-15--every-junction-is-scoped-and-therefore-tabbed-from-both-ends) (2026-09-15) widened all six junctions' `scope_field` to the branching 2-tuple of both FK columns — the option ADR-0075 Decision §3 explicitly left open for "all six at once" — so every link table now lists, and tabs, from both ends. This clause was the *only* entry in the table that described a deliberate design limit rather than a genuine list-capability gap, and the remaining rows are unaffected |
| `Project`/`Role` → `RoleAssignment`s | `RoleAssignment` registers no `list` route at all |

Note what did **not** change to make that happen: this section's rule is still
exactly "the FK must be the child's own `scope_field`, or one arm of a branching
2-tuple one." The six junctions became servable by satisfying that rule, not by
relaxing it — `derive_entity_relations` is byte-for-byte unchanged.

**These are flagged, not worked around.** Serving them needs new backend list
capability (a widened `scope_field`, a bespoke reverse-list route, or promoting
a filter field to a scope) — a per-relationship API decision, not something to
smuggle into a frontend story. `tests/unit/test_adr74_entity_relations.py`
asserts this excluded set is the exact complement of the served one, so a future
entity or FK cannot land in neither bucket.

> **Scope of that guarantee, per [ADR-0075](0075-junction-table-registry-completeness.md):**
> "a future entity or FK" means one *registered in `ALL_ENTITY_CONFIGS`*. The
> partition enumerates the same registry the derivation does, so a model with no
> config contributes to neither side and the assertion holds vacuously — which
> is precisely how the two missing junctions went unnoticed. The model-layer
> partition in `tests/unit/test_adr75_registry_completeness.py` is what closes
> that outer ring.

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
ADR-0073 fetch its own row rather than reuse the list's in-memory copy — a
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
`badge bg-secondary` is currently invisible repo-wide (ADR-0073's own
Consequences) — a new call site of a known-broken class is not something to add
in a story that isn't fixing it.

## Consequences

- **Positive.** Every record's related records are one click away, on all 28
  entities at once, with no per-entity code. 22 relationships across 9 entities
  became reachable when this shipped; **30 across 10** as of
  [ADR-0075](0075-junction-table-registry-completeness.md) and its Amendment 1
  (+2 from registering the two missing junctions, +6 from making all six
  bidirectional — the tenth entity is `Defect`, which had no tab strip at all).
- **Positive.** A new backend FK whose field is the child's scope field becomes
  a tab with **zero** frontend or backend work — the property ADR-0055 was
  written to buy, now extended from fields to relationships.
- **Positive.** Relationship tabs reuse `EntityTable` wholesale, so they inherit
  fk-label resolution, enum badges, date formatting, pagination and page-size
  selection, and cannot drift from the list pages.
- **Positive (side effect).** The MCP `describe` tool serves `relations` too,
  since it shares `derive_entity_schema` — an agent can now discover the
  relationship graph it previously had to infer.
- **Neutral / accepted.** 12 inbound FKs produce no tab (Decision §4) — 14 after
  [ADR-0075](0075-junction-table-registry-completeness.md) registered two more
  link tables, each adding its own reverse side, then **8** after that ADR's
  Amendment 1 made all six junctions bidirectional. This is a *backend
  list-capability* gap surfaced by this story, not created by it, and it is
  asserted rather than assumed — the drop from 14 to 8 is the clearest evidence
  the assertion was doing real work: six of the fourteen turned out to be a
  design choice that could simply be reversed, and the exclusion table is what
  made them visible as such rather than forgotten.
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

### Amendment 1 (2026-09-14) — the strip is mounted as the card header, per Tabler's own "tabs in a card" pattern

A same-branch, pre-merge correction to this ADR's own Decision §8, on CTO
instruction after a live look at the shipped result (`docs/CLAUDE.md`'s
`### Amendment` case, not a new ADR: no architecture, contract or schema
changes — the derivation, the exclusion rules, the `?tab=` posture, the hidden
scoping column and the read-only stance are all untouched, and so is every
`data-testid`).

**What shipped first:** the strip was a bare `ul.nav.nav-tabs` *above* the
card, with each panel rendering its own card underneath — so a relationship tab
showed a second card titled with the tab's own label, and the page's Back/Edit
actions (which lived in the Info card's header) disappeared entirely whenever a
relationship tab was open.

**What it is now**, matching https://docs.tabler.io/ui/components/tab verbatim:
one card spans every tab; the strip is the **only** child of its `.card-header`,
as `ul.nav.nav-tabs.card-header-tabs`; each panel is a `.tab-pane.active.show`
inside `.card-body > .tab-content`.

Three consequences of that pattern, each read out of the shipped CSS rather
than assumed (ADR-0042's own rule), not inferred from the reference HTML:

1. **The heading and Back/Edit moved above the card, not beside the strip.**
   Tabler sets `.card-header{display:flex}` and `.card-header-tabs{flex:1;
   margin:calc(-1*cap-padding-y) calc(-1*cap-padding-x); background:
   var(--tblr-bg-surface-tertiary)}` — the nav is built to *become* the whole
   header and would paint over any sibling in it. Confirmed by live
   measurement, not by reading the rule: the rendered nav's box is the header's
   box (958x47 in a 958x48 header). A side effect worth naming: Back/Edit are
   now present on every tab, where before they vanished with the Info panel.
2. **`EntityTable` gained an opt-in `bare` prop** (default off, so all 24 list
   screens render byte-for-byte as before) that drops its own `.card`/
   `.card-header` wrapper. The relationship pane uses it — a card nested in the
   page's card body would paint a second border and shadow around the table and
   repeat the tab's label as a card title. `EntityRelationTab` therefore renders
   card *sections*, not a card, and is no longer a standalone mount.
3. **`.active` on the rendered pane is load-bearing, not decorative.**
   `.tab-content > .tab-pane{display:none}` in both design systems' shipped CSS,
   so a pane that lost the class would be present in the DOM, pass every
   query-by-testid assertion, and render nothing. `show` is the reference
   markup's own companion class.

**Explicitly unchanged: still no `data-bs-toggle`, and still real `<button>`
triggers.** Decision §8's reasoning survives the relocation intact — Tabler's JS
bundle is loaded (ADR-0053) and would take ownership of panel visibility from
React; the reference's own `<a href="#...">` is Bootstrap's stock anchor variant,
not a requirement, and adopting it would cost the free keyboard semantics a real
`<button>` has. Only class names and DOM placement changed. `Tabs` additionally
now gives each trigger an `id` (`tabTriggerId`) so the panel can point back with
`aria-labelledby`, completing the pair `aria-controls` already started;
`card-header-tabs` is passed in by the caller rather than baked into the
molecule, since a strip mounted anywhere else must not carry it.

**Coverage.** No new TC — this is a markup correction inside TC-ADMIN-065..069's
existing scope, and the assertions were added to the specs those TCs already
name: `tabs.test.tsx` (trigger ids, `className` reaching the list),
`EntityDetailPage.tabs.test.tsx` (strip is the card header's only child, pane is
`.tab-pane.active.show` in `.card-body.tab-content`, one card not two, heading
and Back outside the card on every tab, and the no-relations negative),
`entity-table.test.tsx` (`bare` drops the wrapper, default keeps it), and
`admin7-entity-relation-tabs.spec.ts` — which carries the half no unit test can
reach, since jsdom applies no CSS: a real engine confirming the pane is actually
`visible` and the nav actually sits flush above it.

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
  tenant-scoping posture ADR-0022 built it for. **Six of them were subsequently
  served — without relaxing anything** ([ADR-0075](0075-junction-table-registry-completeness.md)
  Amendment 1, 2026-09-15): widening the six link tables' own `scope_field` to a
  branching 2-tuple makes both directions satisfy the scope rule as written, so
  the `422` guard is fully intact and each direction still carries exactly one
  scope value. That is the "its own API decision" this line asks for, taken
  deliberately and for all six at once.
