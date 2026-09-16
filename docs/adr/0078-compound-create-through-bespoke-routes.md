# ADR-0078: "Create new" on every relationship tab, by borrowing the far entity's bespoke create route

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0076](0076-relationship-tab-write-actions.md), specifically its **Amendment 1** (both n-n actions, "Create new" as a compound create-then-link). Nothing in ADR-0076 or [ADR-0077](0077-relationship-tab-unlink-action.md) is superseded: the four link-create routes, the four `DELETE`s, `linkCreate`/`linkDelete`, the permission catalog and the picker-scoping rule all stand unchanged, and no route or permission code is added here.
- **Builds on:** [ADR-0028](0028-req3-test-condition-rigor-path-bespoke-routes.md) (`POST /requirements/{id}/test-conditions`, the atomic entity-plus-link write), [ADR-0044](0044-exec-3-raise-defect-from-execution.md) (`POST /executions/{id}/defects`, same shape), [ADR-0074](0074-entity-detail-relationship-tabs.md) (the derived tabs), [ADR-0075](0075-junction-table-registry-completeness.md) + Amendment 1 (all six junctions registered and bidirectional), [ADR-0055](0055-admin-3-backend-driven-entity-schema.md) (`GET /entities/{resource}/schema` as the one place a client learns what an entity can do).

## Context

The requirement, verbatim: *"i need all entity with nested crud of relationship,
and in page n2n like this, have both link and add, in 1-n have only add."*

ADR-0076 Amendment 1 is supposed to be that. It gives every many-to-many tab
two actions — "Link existing &lt;far entity&gt;" and "Create new &lt;far entity&gt;" —
and builds the second as a client-side sequence: the far entity's **generic
`create`**, then the junction's own `linkCreate`.

That sequence needs a generic `create` to exist. Its own gating says so
outright, and its own Decision text already names the consequence: *"3 of the 12
live link directions point at an entity authored only through bespoke routes, so
the action correctly never appears for them."*

Three of twelve is 25% of the surface the requirement is about, and the word
"correctly" is doing a lot of work. The three:

| Tab | Junction | Far entity | Why it has no generic `create` |
|---|---|---|---|
| `Requirement` → "Test conditions (linked)" | `requirement_test_condition_link` | `TestCondition` | ADR-0028 removed it. `TestCondition.requirement_id` is `NOT NULL`, and its real create must write the `RequirementTestConditionLink` row in the **same transaction** — which the generic factory structurally cannot do (`create_item` inserts one row). |
| `TestCase` → "Test conditions (linked)" | `test_condition_test_case_link` | `TestCondition` | same entity, same reason |
| `TestCase` → "Defects (linked)" | `test_case_defect_link` | `Defect` | `Defect.test_execution_id` is `NOT NULL`; EXEC-3's route additionally rejects a non-failed execution. |

So the entities whose authoring is *least* discoverable elsewhere are exactly
the ones whose tabs offer no way to author them. And the absence is silent —
no error, no `403`, just a button that never renders, which is the precise
failure shape `backend/CLAUDE.md`'s registry-completeness note keeps describing.

There is a second, quieter gap in the same three tabs. ADR-0076's own
Consequences records that `TestCase` → "Defects (linked)" cannot be **linked**
from that end either, behind `ScopeSelector`'s cascading-picker limitation:
`Defect`'s selector searches `TestExecution`, which was scoped by
`test_cycle_id` alone, so the search came back empty. That tab therefore had
*neither* action working. The requirement says both, on every tab.

### What the generic surface cannot derive (again)

ADR-0076 §1 established that a bespoke route's **URL shape** and **permission
code** are arbitrary facts no derivation produces, and declared them. The same
is true here, plus one more that is genuinely new:

**Whether the bespoke create route already writes the junction's link row
itself.** `POST /requirements/{id}/test-conditions` does — REQ-3 wrote it that
way precisely so a condition can never exist unlinked. `POST /executions/{id}/defects`
does too. This is a fact about another module's *transaction body*: not in the
URL, not in the response, not inferable from any schema. And it is the fact that
decides whether the client makes one request or two — get it wrong in the
"already linked" direction and the follow-up `linkCreate` `409`s on the pair the
first call just wrote, turning a successful create into a user-visible error.

## Decision

### 1. `CrudEntityConfig.compound_creates` — a per-*direction* declaration

A new optional field on `CrudEntityConfig`, set on link entities only, as a
**tuple** because the declaration is directional and a junction has two ends:

```python
@dataclass
class CompoundCreateAction:
    far_field: str              # "test_condition_id" — which FK the created row fills
    path_template: str          # "/requirements/{requirement_id}/test-conditions"
    permission: str             # "test_condition.create"
    links_automatically: bool   # does that route write THIS junction's row itself?
    parent_entity: str | None = None       # picker only
    parent_label: str | None = None        # picker only
    parent_label_field: str | None = None  # picker only
    parent_filters: tuple[tuple[str, str], ...] = ()
```

Served as a **thirteenth** key on `GET /entities/{resource}/schema`
(`"compoundCreates"`), beside `linkCreate`/`linkDelete`, riding the request the
tab already makes.

Two things differ from `LinkCreateAction`, deliberately:

- **It is a list, and `[]` rather than `null` when empty.** `linkCreate` is a
  presence flag ("can this junction be linked at all"); this is a list a client
  searches *by direction* (`find(a => a.farField === relation.targetField)`), so
  "declares none" and "declares some, but not for your direction" already
  collapse to the same miss. Three of the six link entities serve `[]` for the
  second reason rather than the first.
- **`far_field` makes it directional.** ADR-0075 Amendment 1 made all six
  junctions list from both ends, and the two ends genuinely disagree: the same
  atomic route serves `Requirement` → "Test conditions (linked)" with
  `links_automatically=True` and no picker, and `TestCase` → "Test conditions
  (linked)" with `links_automatically=False` and a picker. One flag per junction
  could not express that.

`tests/unit/test_adr78_compound_create_actions.py` pins the shape: `far_field`
is one of the entity's own FKs, exactly one placeholder per template, every
template resolves to a real `POST` in `app.openapi()`'s path table, every
permission exists in the live RBAC catalog, and `parent_*` is present exactly
when a picker is needed (§3).

### 2. Whether a parent picker is needed is **derived**, not declared

The bespoke route is mounted under a parent. Sometimes the tab is already
standing on it; sometimes it cannot know it. The client decides by comparing the
template's single placeholder against the tab's own `relation.scopeField`:

- **placeholder == scopeField** → the route's parent **is** the record being
  viewed. `Requirement` → "Test conditions (linked)": `POST /requirements/{requirement_id}/test-conditions`
  where `requirement_id` is the tab's scope. One modal, no picker, one request,
  done. This is the clean case and it is clean for a real reason — REQ-3's route
  was designed to write exactly this junction's row for exactly this parent.
- **placeholder != scopeField** → the user picks the parent first, in the same
  `FkAutocomplete` "Link existing" uses, above the form and gating it.

Derived rather than declared because a declaration could contradict the
template, and then one of the two would be wrong with nothing to say which. The
unit test asserts the partition in both directions, so a declaration cannot
claim a picker it does not need or omit one it does.

### 3. The two `TestCase`-side directions, and why each is shaped the way it is

**`TestCase` → "Test conditions (linked)" — two calls, a Requirement picker.**
`TestCondition.requirement_id` is `NOT NULL`. There is no "create it without
one" to fall back to and no honest way to guess which requirement a new
condition belongs to — that is a real authoring decision, not a scoping detail.
So the user picks the requirement, the atomic route creates the condition
*under* it (writing the `requirement_test_condition_link` row, not this one),
and the client follows with this junction's own `linkCreate`. That is the rigor
path run in reverse: author the condition under its requirement, then attach it
to the case that covers it.

`links_automatically=False`, so ADR-0076 Amendment 1's entire "created, but not
linked" error path applies unchanged — including its two-permission gate, its
close-the-modal-on-failure rule and its `entity-relation-create-link-error`
alert naming the created row. Nothing new was needed for the failure case
because nothing about the failure case changed.

**`TestCase` → "Defects (linked)" — one call, a scoped execution picker.**
This is the direction that needs the most care, because "create a defect from
this test case" is only meaningful through an execution. `POST /executions/{id}/defects`
writes `TestCaseDefectLink(test_case_id=execution.test_case_id, ...)` — so it
lands on *this* tab's test case **precisely when the chosen execution belongs to
it**, and on someone else's test case otherwise. An unnarrowed execution picker
would let a user create a defect that silently files against a record they are
not looking at and never appears in the tab they created it from.

So the picker is scoped to this test case's own executions, and filtered to the
failed ones (`parent_filters={"result": "fail"}` — EXEC-3's route `422`s
otherwise, so offering a passed execution is offering a guaranteed rejection).
Inside that scope `links_automatically=True` is exact, not approximate, and the
whole action is **one request in one transaction** — strictly safer than the
generic two-call path, which is worth stating plainly: the compound path is not
a degraded fallback, it is the better one wherever it applies.

### 4. `TestExecution.scope_field` widens to `("test_cycle_id", "test_case_id")`

§3's scoping needs `GET /test-executions?test_case_id=<id>` to be a legal list
request. It was not: `TestExecution`'s scope was `test_cycle_id` alone, so
`extract_scope_value` `422`'d it.

Widened to a branching 2-tuple — the shape `RiskItem` has always had and
ADR-0075 Amendment 1 gave all six junctions — with a `branching_resolver` whose
**cycle arm is declared first**, keeping the item-route walk
(`GET`/`PATCH`/`DELETE`, where a real row carries both FKs) byte-identical to
its pre-widening behaviour. Both columns are `NOT NULL` on every row, so this
changes only which one a *list request* may scope by. `scope_selector` gains a
matching second option, or the admin list page could scope by the cycle arm
only while the route served both.

Three consequences, all checked before the change rather than discovered after:

- **`GET /test-executions?test_case_id=` becomes legal.** No caller in the repo
  passes both arms (audited across `backend/tests/`, `e2e/tests/`,
  `frontend/src/`; every existing caller passes `test_cycle_id` alone,
  optionally with `result`), so nobody newly `422`s.
- **`TestCase` gains a one-to-many "Test executions" tab.** A test case's own
  execution history, which nothing else in the app surfaces. A side effect of a
  change made for another reason, and a welcome one.
- **This retires ADR-0076's own documented dead end.** "Link existing" on
  `TestCase` → "Defects (linked)" now has a scope it can fire with, so that tab
  goes from *neither* action working to both.

### 5. Gating: the far-create permission, and the link permission only when a link call is actually owed

The button requires the create half's permission — **the action's own declared
`permission`**, not `${farResource}.create` by convention (they coincide for all
three today, which the unit test pins; the client still reads the declared
value, for the same reason `LinkCreateAction` declares its own).

ADR-0076 Amendment 1 additionally required `linkCreate.permission`
unconditionally, for a specific reason: an actor who may create but may not link
would get a `201` then a `403`, stranding a real row the tab cannot display.
**That reason does not apply when `links_automatically` is true** — there is no
second call to be refused. Requiring the link permission there would hide a
button for a request that is never made: over-gating, not caution. So the
condition moves with its reason, and `createLinkNeedsLinkCall` is what both turn
on.

This is the single most surprising cell of the matrix — "holds only the create
permission" renders the button for the `Requirement`/`Defect` directions and
hides it for the `TestCase` → test-conditions one — so it is called out at the
Vitest call site as well as here.

Everything else is unchanged: hidden not disabled, fail-closed while permissions
load (UI Design Document §5).

### 6. No new routes, no new permission codes, no migration

Every route this ADR invokes already shipped (ADR-0028, ADR-0044, ADR-0076).
Every permission code it names already exists (`test_condition.create`,
`defect.create`). Catalog stays at **110**; MCP tools stay at **157**.

Worth noting which roles this actually reaches, since it is not uniform:
`test_manager` holds full `test_condition` CRUD and all four link creates, so
both `TestCondition` directions work for it; it holds only `defect.read`, so the
`Defect` direction correctly does not appear. `tester` holds `defect.create` and
`test_case_defect_link.create`, so that direction is exactly the persona whose
workflow it is. No bundle is extended — which is a deliberate non-decision:
ADR-0076's Consequences already flagged `test_manager`'s seeded bundle as
overdue a dedicated audit (seventh ad hoc extension), and adding an eighth here
would make that worse.

## Consequences

- **The requirement is met, and mechanically asserted.** All **12** n-n tab
  directions across all 6 junctions now offer both actions. The assertion is not
  "the three declarations exist" — it is
  `directions_without_a_create_path(ALL_ENTITY_CONFIGS) == set()`, computed over
  the directions `derive_entity_relations` actually emits, so a future junction
  cannot ship a create-less tab silently. Per ADR-0075's own lesson the checker
  takes its collection as a parameter and is mutation-tested in-suite, including
  against the subtlest vacuous-pass shape available here: a declaration pointed
  at the junction's *other* direction, which a "does this entity declare
  anything" check would have accepted.
- **`TestCase` → "Defects (linked)" goes from zero working actions to two**, and
  ADR-0076's Consequences entry recording it as unlinkable from that end is
  retired by §4 rather than worked around. That ADR's text is left exactly as
  written — it is the accurate record of what was true then
  (`docs/CLAUDE.md`'s forward-pointing-addendum convention).
- **Relationship-tab totals move: 30 relations → 31**, and ADR-0074 §4's
  exclusion table 8 rows → **7** (`("test-executions", "test_case_id")` stopped
  being an exclusion the moment the scope widened). Both counts are asserted, in
  `test_adr75_amendment1_bidirectional_junctions.py`, and both docstrings quote
  the ADR prose — so this ADR is what those numbers now trace to.
- **One test's premise was superseded and inverted in place, not deleted.**
  `test_filter_field_only_fk_is_excluded` existed to demonstrate ADR-0074 §2's
  rule (*an FK must be a scope arm, not merely a filter field*) using
  `TestExecution.test_case_id` as its example. The rule is untouched; that
  column simply stopped being an example. Inverted following ADR-0075 Amendment
  1's own precedent, with `test_filterable_alone_is_still_not_enough` added
  beside it asserting the original claim against `TestCase.test_level_id`, which
  still demonstrates it. A rule with no live example is a rule nothing defends.
- **`scopeField` is now array-valued for a third entity, and one frontend
  comparison was quietly wrong about that.** `pickerScopeParams` did
  `scopeField === "project_id"`, which silently answers *no* for an array — the
  wrong answer, and an invisible one. Normalized through a new `scopeArmsOf`
  helper rather than fixed at the one call site, since the next config to widen
  would have hit the same edge. No behaviour changes today (no far entity in a
  link direction has an array scope), which is exactly when this kind of fix is
  cheap.
- **The compound path is strictly safer than the generic one where
  `links_automatically` holds** — one request, one transaction, so ADR-0076
  Amendment 1's "created but not linked" partial state is unreachable on it by
  construction rather than merely improbable. Two of the three new directions
  are that shape.
- **The blank-optional-enum `422` ADR-0076 Amendment 1 found, and deliberately
  did not fix, is reachable from these modals too.** `EntityForm` maps a blank
  optional field to `null`, and a Pydantic field that is defaulted and
  non-nullable rejects `null`. `TestCondition.priority` and `Defect.severity`
  are both required by their bespoke request schemas but derive as
  `required: false` (their configs have `create_schema=None`, so the derivation
  has no create schema to read required-ness from) — so leaving either blank
  `422`s with the field's own message rather than being caught client-side. Same
  finding, same reason for not fixing it here: the fix is a change to the shared
  form affecting every entity and every create path. Flagged again rather than
  absorbed; the tests select both fields explicitly and say why at the call site.
- **A new tab appeared on a screen this story is not about.** `TestCase`'s
  detail page has one more tab, and `e2e/tests/admin7-entity-relation-tabs.spec.ts`
  asserts that strip positionally — updated in the same change, which is the
  only reason it was caught before a browser found it.

### Found by looking, not by testing

Two defects surfaced after every suite was green, and both are worth recording
because neither was reachable from the tests that existed:

- **The parent-picker hint was ungrammatical.** It interpolated the relation's
  own label, which is a *plural* ("Test conditions"), into a singular sentence:
  *"the new test conditions is created under it."* Found in a screenshot of the
  live modal. This is the identical trap — and the identical fix — that
  ADR-0077's unlink confirm body already carries a comment about, which is the
  point: a test asserting the wording would have pinned the wrong wording just
  as happily, so only rendering it catches it. Now number-agnostic ("the new
  record"), with the modal's own title carrying the specificity.
- **The client disagreed with itself about which create path it was on.**
  `EntityRelationTab`'s mutation body branched on *a declaration existing* while
  every gate around it branched on `createLinkMode`, which prefers the generic
  path. A junction whose far entity had both a generic `create` and a compound
  declaration would have been permission-gated and locked-value-filled for one
  path while sending the other. Unreachable from any live config — and the
  backend's own `test_no_declaration_is_dead_code` rejects the shape — but
  "another layer forbids it" is not "cannot be expressed here". Fixed with a
  single `activeCompoundCreate` derivation every consumer reads, so there is
  only one value left to disagree about. Surfaced by a test written to the
  contract rather than to the code; the characterization test written for it was
  **inverted, not deleted**, since the inverted assertion is what stops it
  returning.

Neither is a coverage gap in the sense the rest of this ADR's tests address —
there was no TC to match against for either. They are the PROJ-4 class root
`CLAUDE.md` describes: 100% coverage against a written spec says nothing about
what the spec never thought to say.

## Alternatives considered

- **A new backend route per direction that creates the far row and links it
  atomically.** This is the "right" answer in the abstract and was rejected for
  the same reasons ADR-0076 Amendment 1 rejected it, which have not changed: it
  is real new API surface needing its own permission question (which code gates
  a route doing two separately-gated things?) and its own boundary semantics —
  and here it would be **three** such routes, two of which would duplicate a
  transaction that already exists and is already correct. For two of the three
  directions the existing atomic route *is* the single-transaction route; the
  only thing missing was a way for a generic client to know that.
- **Give `TestCondition` and `Defect` a generic `create`.** Rejected outright:
  ADR-0028's own `backend/CLAUDE.md` rule exists because that is precisely the
  bug it fixed — `TestCondition` had a generic create that silently never wrote
  its link row. Re-adding it to make a UI composition work would reintroduce a
  data-integrity defect to avoid a declaration.
- **A frontend map from link entity + direction to bespoke route.** Rejected for
  the third time, on ADR-0074 Decision §1's original grounds: it is a
  hand-authored per-entity map on the far side of the network boundary from the
  routes it describes, uncheckable against them, and a route change would not
  even be in the same diff.
- **Derive `links_automatically` by attempting the link and treating `409` as
  success.** Rejected. It would work, and it would make a real conflict
  (genuinely already-linked pair, a race) indistinguishable from expected
  behaviour — swallowing exactly the error the two-call path's whole recovery
  story is built on. A boolean declared next to the route is cheaper than
  permanently blinding the client to one status code.
- **Skip the `Defect` direction as not domain-valid.** Considered seriously:
  `Defect` has no existence independent of an execution, so "create a defect
  from a test case" is not obviously meaningful. Rejected after reading the
  route — it links to `execution.test_case_id`, which makes "raise a defect on
  one of *this* test case's failed runs" both meaningful and exactly what the
  route already does. Forcing the tab to skip the button would have been reading
  the model less carefully than the model deserved.
- **A bespoke `GET /test-cases/{id}/test-executions` instead of widening
  `scope_field`.** Rejected: it would need a per-entity `listPath` override the
  generic picker cannot use (the id is the tab's parent, not a route param), and
  it leaves `TestExecution` still unscopeable by the column it is genuinely
  scoped by. The widening is the same move ADR-0075 Amendment 1 made six times,
  and it gives `TestCase` a useful tab for free.
- **A per-picker `ScopeSelector` cascade (test cycle → execution) for the
  `Defect` direction.** Rejected: it is the cascading-picker gap ADR-0076
  documented, it asks the user for a cycle they have no reason to care about,
  and — decisively — it does not constrain the execution to this test case, so
  it would not fix the correctness problem at all, only the emptiness one.
