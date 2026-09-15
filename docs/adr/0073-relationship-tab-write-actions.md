# ADR-0073: Write actions on the entity detail page's relationship tabs, from a declared link-create action

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0071](0071-entity-detail-relationship-tabs.md) (the relationship tabs themselves) and [ADR-0072](0072-junction-table-registry-completeness.md) + its Amendment 1 (all six junctions registered and bidirectional). Neither is superseded: the derivation, the exclusion rules, the `?tab=` posture and the hidden scoping column all stand unchanged, and `derive_entity_relations` is not touched.
- **Builds on:** [ADR-0005](0005-traceability-link-dedicated-join-tables.md) (dedicated link tables), [ADR-0027](0027-generic-admin-crud-ui-and-backend-completion.md) (the generic admin CRUD UI — create renders in a modal, only update gets a route), [ADR-0030](0030-req4-test-suite-membership-bespoke-routes.md)/[ADR-0031](0031-plan1-test-plan-membership-and-status-transition-routes.md) (the two membership routes this ADR's four new routes are shaped on), [ADR-0055](0055-admin-3-backend-driven-entity-schema.md) (`GET /entities/{resource}/schema` as the one place a client learns what an entity can do).

## Context

ADR-0071 gave the generic detail page one tab per inbound relationship, and
ADR-0072's Amendment 1 made all six junction tables list from both ends. The
result is thirty relationships across ten entities, and **every one of them is
read-only**.

That is a real gap, not a cosmetic one, because for most of these relationships
the tab is the *only* place in the app where the relationship is visible at all:

- A `Requirement`'s "Test cases (linked)" tab lists its traceability links. The
  only way to add one was to create a *brand-new* `TestCase` through
  `POST /requirements/{id}/test-cases` (REQ-2), which writes the link as a side
  effect. Linking a test case that already exists had no route at all.
- A `TestCondition`'s "Test cases (linked)" tab: same shape, same gap
  (`POST /test-conditions/{id}/test-cases`, REQ-3).
- A `TestCase`'s "Defects (linked)" tab: the link row is written only by
  EXEC-3's `POST /executions/{id}/defects`, i.e. only while *raising* a new
  defect. "This failure is the defect we already have" was unreachable.
- A `Requirement`'s "Test conditions (linked)" tab: written only by REQ-3's
  authoring route, same as the first two.

So four of ADR-0005's own traceability tables could only ever be populated as a
side effect of creating one of their two ends. The traceability matrix the
tables exist to support cannot be *assembled* from existing rows — only grown by
authoring new ones.

The one-to-many tabs have the mirror-image gap and a much smaller cause: the
child entity's generic `create` route already exists and is already used by
`EntityListPage`. What the tab lacked was simply an affordance, plus a way to
fix the parent id so the new row lands under the record being viewed.

### What the generic surface cannot derive

A relationship tab is entirely derived — it hard-codes no entity, no route and
no relationship. Adding a *create* affordance needs two facts that no amount of
derivation produces:

1. **Which route writes a link row.** Every link table is `list`/`get` only
   through the factory (ADR-0005/ADR-0072); its rows come from a bespoke route
   whose URL shape is arbitrary (`/test-suites/{id}/test-cases/{case_id}`,
   `/test-plans/{id}/test-suites/{suite_id}`, and four that did not exist).
   Nothing about the entity's schema implies any of those.
2. **Which permission that route gates on.** Not derivable even by convention:
   REQ-4's and PLAN-1's routes gate on the *parent's*
   `test_suite.update`/`test_plan.update`, not on anything named after the
   junction.

The obvious shortcut — a hand-authored map in the frontend from link entity to
route — is exactly the per-entity map ADR-0071 Decision §1 exists to forbid, and
it would sit on the far side of the network boundary from the routes it
describes, free to drift silently.

## Decision

### 1. `CrudEntityConfig.link_create` — the route declares itself

A new optional field on `CrudEntityConfig`, set on link/junction entities only:

```python
@dataclass
class LinkCreateAction:
    path_template: str   # "/test-suites/{test_suite_id}/test-cases/{test_case_id}"
    permission: str      # "test_suite.update"
```

served as an eleventh key on `GET /entities/{resource}/schema`
(`"linkCreate"`, `null` for the 23 non-link entities), beside ADR-0071's
`relations`.

Two properties make it generic rather than a map in disguise:

- **The placeholders are named after the link row's own FK columns**, not
  positional. A caller holding both ids substitutes by field name. A
  relationship tab always holds both — one is the record being viewed
  (`relation.scopeField`), the other is what the user just picked
  (`relation.targetField`) — so the *same* declaration serves a tab mounted at
  either end of the junction, which matters because Amendment 1 made all six
  bidirectional.
- **It lives next to the route it describes.** Each declaration sits in the
  module that defines the route (`trace.py`, `test_suite_membership.py`,
  `test_plan_membership.py`), in the same `CrudEntityConfig` literal. A route
  change and its declaration are one diff.

It rides the schema request the tab already makes, so the action costs no extra
round trip — the same reasoning ADR-0071 gives for putting `relations` there.

`tests/unit/test_adr73_link_create_actions.py` asserts the partition in both
directions (every `is_link_entity` config declares one; nothing else does),
checks each template's placeholders against `fk_fields_of` and each permission
against the live RBAC catalog, and — per ADR-0072's own lesson — is
**mutation-tested in-suite**, so "no gaps" and "the checker cannot see gaps" are
distinguishable results.

### 2. Four new bespoke link-create routes, shaped on ADR-0030/ADR-0031

```
POST /requirements/{id}/test-case-links/{test_case_id}            requirement_test_case_link.create
POST /requirements/{id}/test-condition-links/{test_condition_id}  requirement_test_condition_link.create
POST /test-conditions/{id}/test-case-links/{test_case_id}         test_condition_test_case_link.create
POST /test-cases/{id}/defect-links/{defect_id}                    test_case_defect_link.create
```

All four live in `app/api/routes/trace.py`, beside the configs they serve — the
split `test_suite_membership.py` already established for its own junction.
Each is the byte-identical boundary sequence ADR-0030 fixed:

1. fetch the path parent; unresolvable org **or** no `OrgMembership` → `404`;
2. permission missing → `403`;
3. fetch the far row; different org, or unresolvable → `404`, never `403` and
   never `422` (NFR-1/ADR-0007: existence is not confirmable across a tenant
   boundary);
4. same org but different **project** → `422 validation_error`. Past the tenant
   boundary there is no existence left to hide, only an invalid relationship;
5. insert, and translate the pair's own unique constraint into `409`.

Three things are deliberately shared rather than written four times:
`_gate_parent`, `_load_same_org` and `_insert_link`. A fifth independently
reasoned copy of that sequence is how the boundary semantics end up
disagreeing between routes that are supposed to be identical.

**No generic surface changes.** `methods` stays `{"list","get"}`,
`create_schema` stays `None`; a link row still cannot be `PATCH`ed, `DELETE`d,
or created through the factory. Links remain immutable
(delete-and-recreate), exactly as `app/models/trace.py` says.

Membership is checked with `_actor_membership_exists`, not the older
`User`-only `_org_membership_exists` — `backend/CLAUDE.md`'s rule for any *new*
resource-gating route, so an MCP/`AIAgent` caller is not 404'd unconditionally.
The two older membership routes are left on the older helper; changing them is
its own fix.

### 3. Four new permission codes — and the two older routes keep their gates

`rbac_seed_catalog.py` gains `LINK_CREATE_RESOURCES`, a fourth resource
grouping alongside `CRUD_RESOURCES`/`READ_ONLY_RESOURCES`/`SPECIAL_PERMISSIONS`,
adding one `.create` code per traceability link (catalog 102 → **106**).

Modelled as its own tuple rather than by promoting the four into
`CRUD_RESOURCES`, which would mint `.update`/`.delete` codes for routes that do
not exist and never will. The four stay in `READ_ONLY_RESOURCES` because that
tuple's real meaning — no generic CRUD surface, no update, no delete — is still
exactly true of them.

`test_suite_test_case` and `test_plan_test_suite` get **no** new code. Their
routes shipped under ADR-0030/ADR-0031 gated on `test_suite.update` /
`test_plan.update`; re-gating a live contract for symmetry would break every
existing caller and buy nothing. `LinkCreateAction` *declares* its permission
rather than deriving it precisely so both shapes coexist.

Bundles, and the reasoning for each:

| Role | Gains | Why |
|---|---|---|
| `org_admin` | all 4 `.create` | Its bundle is "every permission that exists", by definition. |
| `test_manager` | all 4 `.create` **+ the 3 `.read` it lacked** | The traceability-owning persona: the only bundle with `requirement.export_rtm` (the RTM these links populate), already holding full `test_condition`/`test_case` CRUD and `defect.create` — both ends of all four links. Read and write together, because the tab's own list request gates on `.read`: granting the write alone ships a button on a tab that `403`s before it renders. |
| `tester` | `test_case_defect_link.create` only | Already holds that link's `.read` (ADR-0044) and full `defect` create/read/update, so "this failure is a defect that already exists" is a workflow it performs. The three requirement-level links are withheld: `tester` holds only `requirement.read`, and requirement-level traceability is `test_manager`'s activity — granting it would be a silent scope expansion no acceptance criterion asks for, the same restraint ADR-0033 took for `test_execution.update` and ADR-0044 for `defect.delete`. |
| `auditor` | nothing | Read-only by definition; it already holds all four `.read` codes. |
| `ai_agent_scoped` | nothing | Reaches none of the linked entities at all. |

Migration `3e6b08c5da71` backfills this — the second RBAC extension in this
repo (after ADR-0072's `7d2c91af4e68`) that inserts `Permission` rows rather
than only grants, since the codes are new. Its `downgrade()` is asymmetric on
purpose: it removes the four new codes and every grant of them, but for the
three *pre-existing* `.read` codes it only revokes `test_manager`'s grants,
never the catalog rows, which predate it and other roles hold.

Idempotency is proven by invoking `upgrade()` **twice through a real
`Operations` context**, not by a second `alembic upgrade head` — which
`backend/CLAUDE.md` documents as a bookkeeping-level no-op that never re-enters
the function body, making the obvious assertion vacuous.

### 4. One action per tab, chosen by `relation.kind`

- **one-to-many → "New"**, opening the same `EntityForm` create modal
  `EntityListPage` already hosts. `relation.scopeField` is passed as
  `lockedValues`, which `EntityForm` already renders as a disabled display
  field, keeps out of the Zod schema, and merges into the payload itself. The
  new row lands under this parent and the user cannot retarget it. **No new
  form component**, and deliberately not a route to `EntityFormPage`, which is
  the `/edit` route only (ADR-0027's own two-page split, as `EntityFormPage`'s docstring states).
- **many-to-many → "Link existing <far entity>"**, opening a modal with a
  searchable `FkAutocomplete` picker for the far entity — the same
  pick-an-existing-row modal REQ-5/ADR-0069 built for `EntityFormPage`'s
  "Link to Requirement" section, reused rather than re-invented. On submit it
  POSTs to `config.linkCreate.pathTemplate`, interpolated from
  `{scopeField: parentId, targetField: pickedId}`.

Never both: the two kinds mean structurally different things, and an n-n tab's
rows are link rows, which there is no form to fill in.

Both are gated twice, answering different questions — *can the API do this at
all* (`config.methods` / `config.linkCreate`) and *may this actor*
(`usePermissions`, fail-closed while loading). A missing permission makes the
button **absent**, not disabled: UI Design Document §5's hide-don't-disable
posture, identical to `EntityListPage`'s own `canCreate`.

Still no per-row Edit or Delete. Every listed record is fully editable on its
own screen one click away, and a link row has nothing to edit (ADR-0005).
Unlinking is **out of scope** — see Consequences.

### 5. Picker scoping is derived, with the existing `ScopeSelector` as the fallback

The far entity's list route usually requires a scope value and `422`s without
one. Resolved generically, in this order:

1. no `scopeField` → search unscoped;
2. `scopeField === "project_id"` and the route carries `:projectId` → supply it
   (9 of the 12 live link directions);
3. otherwise, if the far entity declares a `scopeSelector`, render the shared
   `ScopeSelector` molecule inside the modal above the picker — the same
   "pick a parent row before the list can fetch" step `EntityListPage` shows
   for the same entities, in the same component.

No per-entity branch, and no new picker component.

## Consequences

- **The traceability matrix becomes assemblable, not just growable.** All four
  ADR-0005 link tables can be populated from rows that already exist, which is
  what a requirements-traceability workflow actually looks like once a project
  is past its first week.
- **Thirty relationship tabs gain an action** — every one of them, with no
  per-entity work, because both affordances read only from the served schema.
- **Permission catalog 102 → 106; MCP tools 153 → 157.** Each new route also
  gets its registry executor, `BESPOKE_EXTRA_ACTIONS` row and generated-tool
  description entry in the same change, per `backend/CLAUDE.md`'s rule — the
  capability is reachable over MCP and REST identically.
- **The `TestCase` → "Defects (linked)" direction cannot be linked from that
  end today.** It lands in scoping case 3 behind `ScopeSelector`'s own
  **pre-existing** cascading-picker gap, documented by name in
  `scope-selector.tsx` since before this ADR: `Defect`'s selector searches
  `TestExecution`, which is itself scoped by `test_cycle_id`, not `project_id`.
  Not worked around here — a cascading multi-step picker is its own change. The
  same link is fully creatable from the other end (`Defect` → "Test cases
  (linked)", case 2), and the route itself is correct and tested, so the
  capability is reachable; only that one picker is blind.
- **`POST /test-cases/{id}/link-requirement` (REQ-5/ADR-0069) and
  `POST /requirements/{id}/test-case-links/{case_id}` now both write
  `RequirementTestCaseLink`, under different rules, and this is accepted
  rather than reconciled.** REQ-5's route is a one-shot *retrofit* for a
  standalone case with no traceability at all and `409`s if the case already
  has **any** requirement link — at-most-one, from the `TestCase` side.
  ADR-0073's route is the table's real many-to-many contract and `409`s only on
  the *pair*. Reconciling them would mean changing REQ-5's shipped contract,
  which no acceptance criterion asks for; a future story that wants one rule
  should pick it deliberately rather than have this ADR decide it as a side
  effect.
- **Unlinking is not shipped.** The `DELETE` halves of REQ-4's and PLAN-1's
  membership routes exist; the four traceability links have no delete route,
  generic or bespoke, and ADR-0005 makes a link row immutable rather than
  editable. Adding one is a real decision (what does removing a traceability
  link mean for an already-exported RTM?) and belongs to its own story, not to
  this one's scope. The tabs therefore grow monotonically today.
- **Seventh ad hoc extension of `test_manager`'s seeded bundle.**
  `backend/CLAUDE.md` has flagged this pattern as overdue a dedicated bundle
  audit since the fifth. This ADR does not attempt it — noted again, and
  deliberately not absorbed.

### Found and fixed: standalone `TestCase`s could not be added to a `TestSuite`

`test_suite_membership.py` carried a private three-branch copy of the
`TestCase`-project walk (`_resolve_test_case_project_id`), written for REQ-4
before `TestCase` had a `project_id` column at all. REQ-5/ADR-0069 added that
column and a fourth branch to the *org* resolver — and nothing pointed at the
project-side copy, so it kept returning `None` for a standalone case and
`add_test_case_to_suite` rejected **every** one of them with
`422 "This test case belongs to a different project."`, even when the suite and
the case sat in the same project.

That copy's own docstring had predicted this exactly ("if these two ever drift,
the failure mode is a wrong `422`") and argued the duplication was safe because
it never gates tenancy. It was safe in that narrow sense and still wrong: the
duplication is what made the REQ-5 change *look* complete.

Found while building this ADR's own routes, which need the same walk. Fixed by
promoting it to `crud_factory.resolve_test_case_project_id`, beside its org-side
sibling and mirroring its branch order exactly, with
`test_suite_membership.py` delegating. Regression test: TC-ADMIN-071, asserted
against **REQ-4's own route** rather than any new one, since that is the route
that was broken.

Recorded here rather than in its own ADR: it is a resolver-branch completeness
fix inside this ADR's necessary surface, found *before* shipping rather than a
defect in already-merged behaviour discovered later — the ADR-0039/ADR-0040
"found and fixed the same day, still gets its own ADR" convention applies to
the latter shape (`docs/CLAUDE.md`).

## Alternatives considered

- **A frontend map from link entity to route.** Rejected: it is the
  hand-authored per-entity map ADR-0071 Decision §1 exists to forbid, sitting on
  the far side of the network boundary from the routes it describes. It cannot
  be completeness-tested against the real routes, and a route change would not
  even be in the same repository diff as a rule.
- **Introspect the route table at request time** (walk `app.routes` for
  something matching the entity's FK names). Rejected: a name-shape heuristic
  over a URL space nobody designed to be parsed, silently wrong for the first
  route that does not match, and unable to answer the permission question at
  all.
- **One generic `POST /{link-entity}` through the factory.** Rejected: it would
  bypass every one of ADR-0030's boundary rules (cross-project `422`, the
  same-org far-side `404`, the duplicate `409`), and `create_schema=None` on
  these entities is a deliberate ADR-0005 decision, not an oversight.
- **Re-gate REQ-4's and PLAN-1's routes on new `test_suite_test_case.create` /
  `test_plan_test_suite.create` codes, for symmetry.** Rejected: a breaking
  change to two shipped contracts, for consistency no user can observe. Every
  role that can manage suite membership today would silently lose the ability
  until a migration granted the new code.
- **Per-row "Unlink" on n-n tabs.** Deferred, not rejected — see Consequences.
  Two of six junctions have a `DELETE` route already, four have none, and
  shipping the action for a third of the tabs would be exactly the
  incoherence ADR-0072 Decision §3 declined to create for scoping.
- **Reuse `EntityFormPage` for the one-to-many create.** Rejected because it
  does not do that: ADR-0027 scopes it to `/edit` and puts create in a modal on
  `EntityListPage`. The reused component is `EntityForm`, which is the actual
  form; routing to `EntityFormPage` would have meant building a create route
  that this surface deliberately does not have.
