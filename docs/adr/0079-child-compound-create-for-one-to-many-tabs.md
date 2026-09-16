# ADR-0079: "New" on a one-to-many tab whose child has no generic create, via the child's own bespoke route

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0078](0078-compound-create-through-bespoke-routes.md) (compound create through a bespoke route, for many-to-many tabs). Nothing in ADR-0078 or its ancestors is superseded — `compound_creates`, `LinkCreateAction`, `LinkDeleteAction`, the picker-scoping rule and the permission catalog all stand unchanged, and no new route or permission code is added here.
- **Builds on:** [ADR-0028](0028-req3-test-condition-rigor-path-bespoke-routes.md) (`POST /requirements/{id}/test-conditions`), [ADR-0044](0044-exec-3-raise-defect-from-execution.md) (`POST /executions/{id}/defects`), [ADR-0033](0033-plan3-test-cycle-creation-and-execution-scope-check.md) (`POST /test-plans/{id}/test-cycles`), [ADR-0074](0074-entity-detail-relationship-tabs.md) (the derived tabs).

## Context

ADR-0078 closed the CTO's requirement for **many-to-many** tabs: every n-n
direction now offers both "Link existing" and "Create new", even the three
whose far entity has no generic `create`. The identical CTO click-through
that confirmed ADR-0078 (`http://.../requirements/{id}?tab=requirement-test-condition-links`)
led to a follow-up question about a *different* tab on the same screen:
`?tab=test-conditions` — the **direct**, one-to-many "Test conditions" tab,
not the traceability-link one. It has no "New" button either, for the exact
same underlying reason (`TestCondition` has no generic `create`), but ADR-0078's
mechanism never looked at one-to-many tabs at all.

A live audit of every entity's schema found seven one-to-many tabs whose child
has no generic `create`:

| Tab | Child | Real create route exists? |
|---|---|---|
| `Requirement` → "Test conditions" | `TestCondition` | `POST /requirements/{id}/test-conditions` — same route ADR-0078 already borrows for the n-n direction |
| `TestExecution` → "Defects" | `Defect` | `POST /executions/{id}/defects` — same route ADR-0078 already borrows |
| `TestPlan` → "Test cycles" | `TestCycle` | `POST /test-plans/{id}/test-cycles` |
| `TestCase` → "Test executions" | `TestExecution` | `POST /test-cycles/{id}/executions` — needs a `TestCycle` picked |
| `TestCycle` → "Test executions" | `TestExecution` | same route — needs a `TestCase` picked |
| `TestExecution` → "Test logs" | `TestLog` | none — append-only by schema, no `create` route exists anywhere |
| `Organization` → "Org memberships" | `OrgMembership` | none — authored only through Invite+Accept, a materially different flow |

Three of the seven have a real bespoke route whose own parent **is** the tab's
own scope — no picker needed, the same shape ADR-0078's `Requirement` →
"Test conditions (linked)" direction already has. Two need a picker for a
*second* parent (`TestExecution` has two real FKs, `test_case_id` and
`test_cycle_id`, and each tab already knows one of them and needs the other).
Two are not gaps at all: `TestLog` is append-only by schema (no route could
exist without inventing a new capability this story does not touch), and
`OrgMembership`'s real authoring flow (Invite → Accept) cannot be represented
by a plain "New" form without misrepresenting it.

## Decision

**Close the three no-picker directions now. Name the two picker-needing
directions as open, not silently pass over them.** Forcing the two open ones
into this same pass would mean designing a *second* net-new UI mechanism
(a parent picker whose picked value fills a **body** field, not the path —
`TestCycle`'s own tab already knows the path parameter and only needs the
body's `test_case_id`) under time pressure; better to ship the three real,
low-risk wins and name the other two precisely, the same posture ADR-0078
itself took toward `TestExecution`'s scope widening.

**A new field, `CrudEntityConfig.child_compound_creates`, not a widened
`compound_creates`.** The two mean different things by `far_field`, and the
difference is not cosmetic:

- `compound_creates`' own completeness suite derives "the tab's own known
  field" as *"the other of this entity's exactly two FK columns"* — true for
  every link entity, which is what makes a link entity a link entity.
- A one-to-many child is not reliably two-FK. `TestCondition` has exactly
  one relevant FK (`requirement_id`). Reusing `compound_creates` and
  special-casing the "other FK" derivation for a one-FK entity would leave a
  test suite built entirely around "a junction has two FKs" quietly
  describing a shape that no longer holds for every declarer — cheaper to
  keep two small, honest fields than one field with a silent branch inside
  its own oracle.

Same `CompoundCreateAction` dataclass shape (`path_template`, `permission`,
`links_automatically`, the four parent-picker fields) — only the *matching
key* differs: `EntityRelationTab` reads `childCompoundCreates` for a
one-to-many tab and matches `far_field === relation.scopeField` (never
`relation.targetField`, which is `null` for every one-to-many relation).

**No parent-picker UI is built for the one-to-many case in this pass.** All
three closed declarations have `path_template`'s placeholder equal to
`far_field` by construction — pinned by
`test_path_template_placeholder_equals_far_field`, which also asserts
`parent_entity`/`parent_label`/`parent_label_field`/`parent_filters` are all
absent. `EntityRelationTab`'s existing "New" modal (`EntityForm` +
`lockedValues={{ [relation.scopeField]: parentId }}`) already produces
exactly the right request with **zero new JSX** — the same `lockedValues`
object that already worked for a generic `create` locks the identical field
for a compound one, since `config === farConfig` on a one-to-many tab. The
mutation itself is a one-line branch: `activeChildCompoundCreate` present →
`createViaCompoundRoute`; absent → the existing `createEntity`. No
"created, not linked" failure mode exists here at all — a one-to-many row's
presence in the list **is** the relationship, so there is never a second call
to fail.

**Served as a fourteenth schema key, `childCompoundCreates`**, riding the
same `GET /entities/{resource}/schema` request every other action already
does, `[]` for every entity that declares none — identical posture to
`compoundCreates`.

## Consequences

- **Three tabs gain "New": `Requirement` → "Test conditions", `TestExecution`
  → "Defects", `TestPlan` → "Test cycles".** Verified live against the
  isolated stack: a real `TestCondition` created from the `Requirement`'s own
  direct tab, `201 POST /api/v1/requirements/{id}/test-conditions`, visible in
  the list immediately after.
- **Two tabs remain open, named rather than silently passed over:** `TestCase`
  → "Test executions" and `TestCycle` → "Test executions", each needing a
  parent-picker mechanism whose picked value fills a **body** field rather
  than the path — a real, larger piece of work than this pass's three, flagged
  as its own future decision.
- **Two are documented exceptions, not gaps:** `TestExecution` → "Test logs"
  (append-only, no route could exist) and `Organization` → "Org memberships"
  (Invite+Accept is a different flow a "New" button would misrepresent).
  `test_the_two_exception_directions_have_no_generic_create_and_no_declaration`
  pins both explicitly, so a future change quietly adding either doesn't merge
  unreviewed — the exception's own reasoning would need re-litigating, not
  just re-testing.
- **`is_link_entity(config)` is false for every entity declaring
  `child_compound_creates`**, asserted directly — the two fields are mutually
  exclusive by construction, one per config.
- A completeness oracle mirroring ADR-0075's own lesson: `derive_entity_relations`
  is the source of truth for which one-to-many directions exist, never a
  hand-list, and both the "every closed direction actually works" and "no
  spurious declaration exists" halves are mutation-tested in-suite.

## Verification

Backend unit **889/889** (35 new — `test_adr79_child_compound_create.py`,
covering TC-ADMIN-129/130), `tsc` clean, Vitest **780/780** (3 new —
`EntityDetailPage.childCompoundCreate.test.tsx`, covering TC-ADMIN-131/132).
Live click-through (TC-ADMIN-133): `Requirement` → "Test conditions", New →
locked `Requirement` field, real `201`, row appears. `TestPlan` → "Test
cycles" and `TestExecution` → "Defects" confirmed reachable and correctly
validating at the API layer (a raw request without `release_id`/
`environment_id` `422`s exactly as the real form's own required fields would
supply). FR-ADMIN-11, NFR-82, WBS 11.61, Test-Design §68.

## Alternatives considered

- **Force the two picker-needing directions into this pass too.** Rejected —
  a body-filling picker is a genuinely different mechanism from anything
  `EntityRelationTab` has today (every existing picker fills a **path**
  placeholder), and building it under time pressure risks shipping something
  subtly wrong rather than three correct wins plus two precisely-named gaps.
- **Widen `compound_creates` itself, branching its own "other FK" derivation
  on whether the config is a link entity.** Rejected — see Decision: it would
  leave the existing, rigorously-tested ADR-0078 suite's own assumptions
  quietly false for a subset of its declarers, for a saving of one field name.
- **Build the one-to-many parent-picker UI now, even for the three that don't
  need it, for "consistency."** Rejected — nothing about a picker for a
  direction that needs none is more correct than omitting it; it would be
  unused code with its own test burden and no user-visible benefit.
