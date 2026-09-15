# ADR-0075: Every junction table gets a read-only registry entry, and registry completeness is asserted at the model layer

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0074](0074-entity-detail-relationship-tabs.md) — completes the derivation it introduced, and corrects the exhaustiveness claim in its Decision §4. Builds on [ADR-0005](0005-traceability-link-dedicated-join-tables.md)'s dedicated link tables, [ADR-0022](0022-generic-crud-router-factory.md)'s scoped list routes, [ADR-0027](0027-generic-admin-crud-ui-and-backend-completion.md)'s read-only link-table routes (the direct template), and [ADR-0055](0055-admin-3-backend-driven-entity-schema.md)'s derived entity schema.

## Context

[ADR-0074](0074-entity-detail-relationship-tabs.md) shipped relationship tabs
derived from the backend's own entity registry, and argued — correctly, as far
as it goes — that a *computed* relationship set is immune to the silent-omission
failure a hand-authored one has:

> The set is **computed** by walking `ALL_ENTITY_CONFIGS`, never hand-authored.
> This is the direct answer to `backend/CLAUDE.md`'s registry-completeness rule:
> a hand-typed per-entity relationship map is exactly the shape that silently
> omits one entity and simply never renders its tab. **A derivation cannot omit
> what it enumerates.**

That last sentence is true and was load-bearing for the wrong thing. A
derivation cannot omit what it enumerates — but nothing in ADR-0074 examined
**the set being enumerated**. `entity_registry._ALL_CONFIGS` is a hand-typed
tuple of 27 names. It is the one hand-authored list in the chain, and therefore
precisely the artifact `backend/CLAUDE.md`'s registry-completeness note is
actually about.

### The gap, confirmed live

`GET /entities/test-suites/schema` returned `"relations": []`. `TestSuite`'s
detail page rendered **no tab strip at all** — visually indistinguishable from
`TestStep`, an entity that genuinely has no relationships.

`TestSuite` has two real many-to-many relationships, both populated in
production by their own bespoke membership routes:

| Junction table | Written by | Registered? |
|---|---|---|
| `test_suite_test_case` | `POST /test-suites/{id}/test-cases/{case_id}` (REQ-4, [ADR-0030](0030-req4-test-suite-membership-bespoke-routes.md)) | **No** |
| `test_plan_test_suite` | `POST /test-plans/{id}/test-suites/{suite_id}` (PLAN-1, [ADR-0031](0031-plan1-test-plan-membership-and-status-transition-routes.md)) | **No** |

Neither table had a `CrudEntityConfig`, so neither appeared in
`ALL_ENTITY_CONFIGS`, so `derive_entity_relations` had nothing to walk. Both
bespoke modules' own docstrings describe the table as having been "present in
the initial migration and the model layer, but unreachable over HTTP" — the
bespoke routes closed that for *writes* and for a far-side read, and left the
junction itself outside every registry-derived surface.

### Why the existing completeness test could not catch it

`tests/unit/test_adr74_entity_relations.py::TestInboundFkCompleteness` is a
genuinely good test. It partitions **every inbound FK in the whole registry**
into served-or-explicitly-excluded and asserts the partition is total, so a new
FK cannot land in neither bucket.

It was green throughout. `_all_inbound_fks()` enumerates `ALL_ENTITY_CONFIGS` —
*the same set the derivation it checks enumerates*. A model with no config
contributes no FK to either side, so the partition held **vacuously** while two
real relationships rendered nothing.

This is the sharpest instance yet of a pattern this repo already documents in
several forms: a test that checks a derived artifact against the same source the
artifact was derived from proves only internal consistency. It is the
[ADR-0053](0053-tabler-install-phase-1-cdn.md)-era "two independently-maintained
lists describing the same thing" problem inverted — here there was only *one*
list, and that was the problem: nothing outside it had standing to say it was
incomplete.

### The full audit

Every table in `app/models/` was enumerated and cross-checked against the
registry, rather than only the reported symptom. Eight junction tables exist
(structurally: exactly two FK columns, no payload of their own):

| Junction table | Registered before | Action |
|---|---|---|
| `requirement_test_case_link` | yes (ADR-0027) | — |
| `requirement_test_condition_link` | yes (ADR-0027) | — |
| `test_condition_test_case_link` | yes (ADR-0027) | — |
| `test_case_defect_link` | yes (ADR-0027) | — |
| `test_suite_test_case` | **no** | **register** |
| `test_plan_test_suite` | **no** | **register** |
| `role_permission` | no | **flag, do not register** (Decision §4) |
| `test_case_test_design_technique` | no | **flag, do not register** (Decision §4) |

Three further tables hold a one-to-many FK into a registered entity without
being registered themselves — `release` (already an explicit, ADR-0027-documented
decision), `approval`, and `invite`. All three are flagged, none registered
(Decision §4).

**The mirror case was audited and is clean.** Every `*_id` field on every
registered entity was checked for a missing `FieldMeta(ref_entity=...)`, and
cross-checked against the database's actual `pg_constraint` foreign keys rather
than against the models alone. Seven FK columns carry no `ref_entity`, and every
one is deliberate with an in-code rationale: the four `*_by_actor_id` stamps plus
`org_membership.user_id` (ADR-0027 keeps `User`/`AIAgent` off the admin surface),
and `role_assignment.actor_id`/`org_id` (documented in `rbac_routes.py` as
staying "plain read-only strings... NOT `fk`"). No registered entity has a real
FK the schema derivation is unaware of. **There was no `ref_entity` gap — the
entire defect was missing registry entries.**

## Decision

### 1. A junction table is registered as a read-only generic-CRUD entity

`TestSuiteTestCase` and `TestPlanTestSuite` each get a `CrudEntityConfig` with
`create_schema=None`, `update_schema=NoSchema`, `methods={"list","get"}` —
copied verbatim in shape from `app/api/routes/trace.py`'s four link-table
configs, which established exactly this split for ADR-0005's tables: **rows
written only as a side effect of a bespoke route, read through the factory.**

Each config lives in the bespoke module that already owns its junction's HTTP
surface (`test_suite_membership.py`, `test_plan_membership.py`) rather than in a
new module, so one junction's entire surface stays in one file.

The bespoke routes are untouched. Nothing about ADR-0030's cross-project `422`,
duplicate-add `409`, or asymmetric-`DELETE`-`404` contract changes; nor does the
far-side `GET /test-suites/{id}/test-cases`, which returns `TestCase` rows and
remains the right shape for its own callers.

**The alternative — special-casing the bespoke routes inside
`derive_entity_relations` — was rejected outright.** It would hand-author the
per-entity relationship map ADR-0074 Decision §1 exists to forbid, reintroducing
the exact failure mode both ADRs are written against. It also could not work:
a relationship tab needs a servable `GET /{entity}?{scopeField}={parentId}` list
route to call, and a derivation entry with no route behind it renders a broken
tab rather than no tab.

### 2. Completeness is asserted at the model layer, not the registry layer

This is the durable half, and the reason this is an ADR rather than a two-line
fix. Registering two configs closes today's gap; it does nothing about the next
junction table.

`tests/unit/test_adr75_registry_completeness.py` walks SQLAlchemy's own
`Base.metadata` — **not** `ALL_ENTITY_CONFIGS` — and asserts that every table
holding a foreign key into a registered entity's table is either registered
itself or listed in `EXPECTED_UNREGISTERED_CHILDREN` with a stated reason. Never
neither.

`Base.metadata` is the right oracle precisely because it is not hand-authored:
a model registers itself into it by declaration, so adding the model *is* adding
the metadata entry. There is no separate step to forget — which is the property
`_ALL_CONFIGS` lacks and the whole defect turned on.

The guard was mutation-tested: removing the two new configs from the registry
makes it fail with the exact diagnostic, and restoring them makes it pass.

Two narrower assertions ride along: an anchor pinning the exact set of
junction-shaped tables (so a *new* junction fails loudly rather than joining the
schema quietly), and a check that every registered junction declares
`ref_entity` on **both** FKs — without which `fk_fields_of` sees zero FK fields,
`is_link_entity` returns `False`, and the entity degrades to no tab with nothing
else failing.

### 3. Each junction is scoped on its parent side; the reverse stays excluded

> **Superseded by [Amendment 1](#amendment-1-2026-09-15--every-junction-is-scoped-and-therefore-tabbed-from-both-ends)
> (2026-09-15, same branch, pre-merge).** All six junctions now carry a
> branching 2-tuple `scope_field` and list from both ends. This section's text
> is left untouched below because its *reasoning* is the reason the amendment
> exists and is scoped the way it is — it named "widening all six later" as the
> open option, and that is precisely what was done. Read it as the record of
> what was decided first and why, not as the current contract.

`test_suite_test_case` uses `scope_field="test_suite_id"` and
`test_plan_test_suite` uses `scope_field="test_plan_id"` — in both cases the
side the junction's own bespoke routes are already nested under. So `TestSuite`
gains a "Test cases (linked)" tab and `TestPlan` a "Test suites (linked)" tab.

The reverse directions (a `TestCase` listing its suites, a `TestSuite` listing
its plans) join ADR-0074 §4's enumerated exclusion set alongside the four
traceability links' reverse sides, with the same reason: a link table is
listable only from whichever side is its scope field.

**Widening `scope_field` to a branching 2-tuple** — which `RiskItem` already
precedents, and which would make both directions listable — **was considered and
rejected.** Doing it for two junctions and not the other four would make the
rule incoherent, and ADR-0074's own Alternatives already rejected relaxing the
scope requirement as "its own API decision about widening a list route's
contract" rather than something to smuggle into an adjacent story. Six tables
now behave identically; that consistency is worth more than two extra tabs, and
widening all six later remains open.

The scope side is load-bearing, not cosmetic: scoping either junction on its
*child* side would have added a tab to `TestCase` and broken the exact-tab-list
assertion `e2e/tests/admin7-entity-relation-tabs.spec.ts` already makes for that
entity. A unit test pins that `test-cases`' tab set is unchanged.

### 4. Four junction/child tables are flagged, not registered

Registering everything would be the wrong reflex. Each of these is a real
decision recorded in `EXPECTED_UNREGISTERED_CHILDREN`, next to the code, with a
test asserting the consequence (the parent genuinely gets no tab):

- **`test_case_test_design_technique`** — the relationship has **no
  implementation anywhere**: zero references outside the model file, the model
  package's `__init__`, and the initial migration. No route, query, UI or MCP
  tool reads or writes it, so no row can ever exist. Registering it would ship a
  permanently-empty "Test design techniques (linked)" tab advertising an
  ADMIN-1-era feature that was never built. The correct order is to build the
  write path first — the tab then appears for free, which is the property
  ADR-0074 and this ADR exist to buy.
- **`role_permission`** — a genuine junction, and the RBAC grant graph itself.
  Exposing which permission codes each role holds is a security-surface decision
  needing its own story; and the five system roles carry `org_id IS NULL`, so
  its tenant resolver would need the `is_global_catalog`/`global_read_fallback`
  path rather than a plain `chain_resolver` — real design, not a copy of the
  template.
- **`approval`** — bespoke routes, and its own payload columns, so it is an
  ordinary one-to-many child of `TestPlan` rather than a junction. Registering
  it means a new admin-surface entity (nav entry, list page, permission-gated
  create), which is a product decision.
- **`invite`** — bespoke routes, and it carries a `token_hash`. A generic read
  surface over a credential secret is a security decision, not a completeness
  chore.

`release` is the fifth entry, already decided by ADR-0027 and merely recorded
here so the partition is total.

> **Note on ADR numbering, found while writing this and deliberately not
> fixed.** The source tree cites the backend-completion ADR as **ADR-0025**
> throughout (`app/api/routes/trace.py`'s module docstring,
> `rbac_routes.py:86/94/177`, `org_memberships.py:560`), but `docs/adr/README.md`
> — the authority — assigns that decision to **ADR-0027**; `0025` is
> `Requirement.title`. This is residue of the ADR-0024/0025/0026 renumbering
> collision `git log` records (`0754f8a`, `1fd2060`) and root `CLAUDE.md`
> documents at length. A related inconsistency sits in the file itself: its own
> H1 reads "# ADR-0026". This ADR cites **0027** (the index's number and the
> real filename). Correcting the stale citations is a repo-wide sed across
> `app/` and `docs/`, explicitly out of scope here rather than a drive-by.

### 5. Two new permission codes, and the first migration here to insert `Permission` rows

`test_suite_test_case` and `test_plan_test_suite` join
`rbac_seed_catalog.READ_ONLY_RESOURCES` (6 → 8 resources, 29 → 31 total, 100 →
102 catalog rows). `org_admin` (defined as every code) and `auditor` (defined as
`.read` on every resource) gain them by definition; `test_manager` and `tester`
are granted them explicitly, because both already hold
`test_suite.read`/`test_plan.read` and so can open those detail pages — without
the junction codes the relationship tab would `403` for exactly the two roles
that use those screens. Same shape as [ADR-0044](0044-exec-3-raise-defect-from-execution.md)'s
`test_case_defect_link.read` grant to the same two roles. `ai_agent_scoped` is
deliberately not granted either: its bundle holds no `test_suite`/`test_plan`
read at all.

Migration `7d2c91af4e68` backfills already-seeded databases. **It is the first
RBAC extension in this repo that must insert the `Permission` rows themselves**
— all five prior extensions widened a bundle with a code the RBAC-4 catalog
already contained. On a fresh database it is a pure no-op, since the initial
seed migration builds the catalog from the current code.

## Consequences

- **Positive.** `TestSuite` has a working relationship tab where it previously
  had no tab strip at all, and `TestPlan` gains a fourth tab alongside three
  that already worked. Verified live, not only by test.
- **Positive, and the point of the ADR.** The next junction table cannot repeat
  this. The model-layer guard fails loudly on any new FK-bearing model that is
  neither registered nor consciously excluded — and the exclusion table forces
  the reason to be written down next to the code rather than lost.
- **Positive (side effect).** Both junctions gain `list`/`get` MCP tools and a
  `describe`, since the MCP registry derives from the same configs. Worth
  naming: both were **already** MCP registry rows as config-less bespoke
  `create`-only pseudo-resources, which is part of why the gap was easy to miss
  — the MCP surface looked complete while the REST/relationship surface had no
  config to derive from. `TOOL_REGISTRY` stays at 31 resources; the tool count
  moves 147 → 153.
- **Neutral / accepted.** Four reverse-side link directions remain excluded
  (Decision §3), now six across all link tables. Consistent, enumerated, and
  asserted as the exact complement of the served set.
- **Neutral / accepted.** Four junction/child tables stay unregistered
  (Decision §4). Each is asserted to cost its parent a tab, so the cost is
  visible in the test suite rather than only in this prose.
- **Neutral / accepted.** The two junctions appear in the frontend's
  `registry.ts` and in `PROJECT_EXCLUDED_ENTITY_KEYS`, exactly as the four
  traceability links do — so they get breadcrumb/heading labels and an admin
  route, but no sidebar nav slot. The relationship tabs need none of this;
  `EntityRelationTab` fetches the schema by key directly. It is consistency with
  the existing link tables, not a functional requirement.
- **Watch — found, not fixed.** `main`'s own database is missing one of the five
  `TestType` rows migration `854917c76ac5` seeds ("Confirmation Testing"), which
  reproduces on every clone and fails three tests in
  `tests/integration/test_admin_testtype_seed.py`. Unrelated to this story (this
  branch touches no `test_type` code), but it is a second, sharper consequence
  of the vacuous-CLI-idempotency trap `backend/CLAUDE.md` already documents for
  ADMIN-5: because `alembic upgrade head` is a pure no-op once the DB is at that
  revision, **a data-seed migration can never self-heal a row deleted after it
  ran**. Needs its own fix; deliberately not smuggled in here.

### Amendment 1 (2026-09-15) — every junction is scoped, and therefore tabbed, from BOTH ends

A same-branch, pre-merge correction to this ADR's own **Decision §3**, on CTO
instruction after a live look at the shipped result. Per `docs/CLAUDE.md`, an
in-place `### Amendment` rather than a new ADR number: Decision §3 did not
reject this change on its merits — it explicitly parked it, named the exact
condition under which it should happen, and left the option open in the same
sentence. Taking an option an ADR itself wrote down is a correction to that
ADR, not a new architectural direction that outlives this story.

**What Decision §3 said, and why the objection is spent.** It kept both
newly-registered junctions to a single-column `scope_field`, and rejected
widening:

> Widening `scope_field` to a branching 2-tuple — which `RiskItem` already
> precedents, and which would make both directions listable — was considered and
> rejected. **Doing it for two junctions and not the other four would make the
> rule incoherent** [...] Six tables now behave identically; that consistency is
> worth more than two extra tabs, and **widening all six later remains open.**

The stated objection was *coherence across the six*, never capability, never
tenant safety, and never cost. All six are widened here, together, in one
change — so the objection does not apply: the six still behave identically, just
bidirectionally. ADR-0074's own Alternatives likewise rejected "relaxing the
scope requirement" as "its own API decision about widening a list route's
contract, rather than something to smuggle into an adjacent story"; this
amendment *is* that decision, made deliberately and uniformly rather than
smuggled.

**The symptom that prompted it.** Confirmed live before any code changed:
`GET /entities/test-cases/schema` carried no `test_suite` or `test_plan`
relation at all, and `GET /entities/defects/schema` returned `"relations": []`.
`TestCase` is the entity three separate junctions point at, and its detail page
could show none of them; `Defect`'s page rendered no tab strip whatsoever —
visually identical to `TestStep`, an entity that genuinely has no
relationships. That is the exact symptom this ADR was written to fix for
`TestSuite`, surviving in four other places because the fix registered the
missing configs without revisiting which direction they scope.

#### What changed

**1. All six `scope_field`s are the branching 2-tuple of both FK columns.**

| Junction | Was | Now |
|---|---|---|
| `requirement_test_case_link` | `requirement_id` | `("requirement_id", "test_case_id")` |
| `requirement_test_condition_link` | `requirement_id` | `("requirement_id", "test_condition_id")` |
| `test_condition_test_case_link` | `test_condition_id` | `("test_condition_id", "test_case_id")` |
| `test_case_defect_link` | `test_case_id` | `("test_case_id", "defect_id")` |
| `test_suite_test_case` | `test_suite_id` | `("test_suite_id", "test_case_id")` |
| `test_plan_test_suite` | `test_plan_id` | `("test_plan_id", "test_suite_id")` |

In each pair the arm that was the sole `scope_field` is declared **first**. That
is load-bearing twice over: `scope_validation_error` keys its `422` on
`candidates[0]`, so existing clients see the same field name; and the resolver's
first branch is the one a real row takes, which keeps every item route's tenant
walk byte-identical to its pre-amendment behaviour.

**2. `derive_entity_relations` is unchanged — not one line.** It already
iterated every FK and kept those in `_scope_candidates`, which explodes a
tuple. A 2-tuple therefore emits one relation per arm for free, exactly the
mechanism that has always made `RiskItem` a child of both `Requirement` and
`TestPlan`. This is the property ADR-0074 Decision §1 was buying and the
strongest evidence the derivation was designed correctly: a genuine capability
widening across six entities cost zero changes to the derivation, the schema
route, the MCP `describe` tool, or the frontend.

**3. A branching `scope_field` requires a branching resolver — this is the
whole risk of the change.** `crud_factory._resolve_scope_for_write` calls
`resolve_org_id` with a `types.SimpleNamespace` carrying **only the one arm the
caller actually supplied**, never a full row. A config widened to two arms but
left with its original single-arm walk type-checks, derives a perfectly good
relation, renders a tab — and 404s every request that tab fires, because the
resolver reads `None` off the stand-in. New `crud_factory.branching_resolver`
generalizes the shape `resolve_risk_item_org_id` has always hand-written; each
of the six composes existing resolvers (`chain_resolver`,
`resolve_via_test_case`) rather than adding a new walk. The reverse arms
deliberately reuse the *same* resolver the junction's own bespoke route already
uses for that side, so the two surfaces cannot drift on what org a row belongs
to.

**4. Each junction's `scope_selector` gains a second, labelled option**, mirroring
`RiskItem`'s. Without it the generic admin list page could still only scope by
the old arm — the route would serve a direction the UI had no way to ask for.

**5. No new permission codes, no migration.** Permissions are per-*resource*,
not per-direction; all six junctions already hold their `.read` code from
Decision §5 and ADR-0027. Nothing in `rbac_seed_catalog.py` moves.

#### Consequences of the amendment

- **Positive.** Six new relationship tabs across four entities, with no
  derivation, schema-route, MCP or frontend change. `TestCase` gains three at
  once (Requirements / Test conditions / Test suites, all `(linked)`),
  `TestSuite` gains "Test plans (linked)", `TestCondition` gains "Requirements
  (linked)", and `Defect` gains a tab strip where it had none.
- **Positive.** ADR-0074 §4's exclusion table loses its entire link-table block.
  Six of the fourteen enumerated exclusions were reverse-side link directions;
  eight remain, all of them genuine list-capability gaps of a different kind
  (filter-field-only FKs, and `RoleAssignment`'s missing `list` route).
- **Neutral / accepted — a small API contract change.** An unscoped list request
  against these six now returns `"exactly one of X or Y must be set"` instead of
  `"<X> is required."`. The `422`, the `validation_error` code and the keyed
  field name are unchanged, and no client in this repo matches on the message
  text. A request supplying *both* arms is newly reachable and is rejected with
  `"...not both"` — `RiskItem`'s XOR narrowing, now applying here.
- **Neutral / accepted.** `test_adr74_entity_relations.py`'s
  `test_registering_the_junctions_did_not_change_test_cases_own_tabs` asserted
  the *absence* of exactly these tabs, pinning Decision §3. It is inverted, not
  deleted, and renamed to say what it now pins — as is the integration
  assertion that the reverse direction `422`s. Both keep the record of what the
  contract used to be.
- **Watch — found, not fixed.** Two of the new `scope_selector` arms point at
  ref entities that the shared `ScopeSelector` molecule cannot search today:
  `test-condition` (its own list is scoped by `requirement_id`) and `defect`
  (scoped by `test_execution_id`). `frontend/src/components/molecules/scope-selector/scope-selector.tsx`
  already documents this limitation by name for exactly these entities — it
  threads only `project_id` through to its `FkAutocomplete`, and anything needing
  a different parent needs a cascading multi-step picker. This affects only the
  **generic admin list page's** scope-gate picker, never the relationship tabs
  (which pass the parent id directly and never render a picker), so it costs
  this amendment nothing and is pre-existing rather than introduced here.
  Fixing it is the larger `ScopeSelector` change that note already scopes.

## Alternatives considered

- **Special-case the bespoke routes inside `derive_entity_relations`.** Rejected
  — see Decision §1. It reintroduces the hand-authored map ADR-0074 forbids and
  still leaves the tab with no list route to call.
- **Register all eight junction tables.** Rejected — two of them would ship tabs
  that are permanently empty or expose the RBAC grant graph (Decision §4).
  "Complete" means every table is a decision, not that every table is registered.
- **Leave the two junctions unregistered and add the model-layer test alone.**
  Considered seriously, since the test is the durable contribution. Rejected:
  the test would then have to declare two real, populated, user-visible
  relationships as intentional exclusions, which would be false.
- **Widen every link table's `scope_field` to a branching 2-tuple** so both
  directions list. Rejected for now — see Decision §3. It is a coherent future
  change for all six at once, not a two-table exception. **Taken, same day —
  see Amendment 1 above**, which does exactly the "all six at once" version this
  line describes; the rejection was always conditional on scope, never on merit.
- **Fix the `_ALL_CONFIGS` tuple by auto-discovering configs** (import every
  route module and collect every `CrudEntityConfig` instance). Rejected: it
  trades an explicit list for import-order magic, and would silently register an
  entity someone deliberately left out — turning a loud, reviewable decision
  into an invisible default. The model-layer test gets the same completeness
  guarantee while keeping registration explicit.
