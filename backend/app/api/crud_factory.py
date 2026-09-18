"""API-1: generic CRUD router factory (ADR-0022).

`make_crud_router(config)` registers whichever of `list`/`get`/`create`/
`update`/`delete` are named in `config.methods` as flat, row-resolved routes
(`/{resource}s`, `/{resource}s/{id}`) for a single entity — called once per
entity from each cluster route module (`app/api/routes/assets.py`,
`planning.py`, `taxonomy.py`, `governance.py`, `rbac_routes.py`,
`execution.py`, plus a handful of routes bolted onto the existing
`organizations.py`/`projects.py`/`org_memberships.py` modules), never
subclassed — composition over inheritance, matching FastAPI's own
function/dependency-based idiom (ADR-0022's Alternatives section).

**Item routes** (`GET`/`PATCH`/`DELETE /{resource}/{id}`) are flat — no
`org_id`/`project_id` path segment — so they fetch the row first, resolve its
`org_id` via `config.resolve_org_id`, apply the any-status-`OrgMembership`
404-vs-403 boundary (`projects.py`/`releases.py`'s established pattern), then
call `has_permission` directly. `require_permission` (`app/core/rbac.py`)
reads `org_id`/`project_id` off *path* params and doesn't fit this flat shape
(ADR-0022 Context #2) — every route built here calls `has_permission`
directly instead, same posture `projects.py`'s own row-resolved routes
already established.

**Global-catalog entities** (`config.scope_field is None`, e.g.
`TestDesignTechnique`/`TestLevel`/`TestType`/`Permission`) have no tenant to
boundary-check at all — `has_permission_in_any_org` gates their list/create,
and `config.is_global_catalog=True` makes item routes use the same gate
whenever `resolve_org_id` returns `None` (which, for these entities, is
always — `resolve_org_id` is a constant-`None` function, never a per-row
resolution failure).

**Distinguishing "statically global" from "this particular row's chain
resolved to `None`"** is the whole point of the `is_global_catalog`/
`global_read_fallback` flags (ADR-0022 edge case #1): a tenant-owned row
whose FK chain can't be walked (e.g. an orphaned `TestCase`, or a multi-hop
`Defect` chain missing an intermediate row) must `404`, exactly like a
missing/cross-tenant row — it must NOT silently fall back to the
any-org gate meant for entities that never had a tenant in the first place.
`Role.org_id IS NULL` (a system-role template, Q3) is the one deliberate
exception: readable via the any-org fallback on `GET` only
(`global_read_fallback=True`), `404` on `PATCH`/`DELETE` — this asymmetry is
`Role`-specific, not a generic "read is always more permissive" rule.

**List/create routes require the entity's own scope FK explicitly**
(`config.scope_field`) — a query param on `list`, a body field on `create`,
never inferred; missing it is `422`, not an empty/degraded result.
`scope_field` is usually a single column name, but `RiskItem`'s branching
`requirement_id` **or** `test_plan_id` shape (exactly one, per its own `CHECK`
constraint) doesn't fit a single string — `scope_field` additionally accepts
a 2-tuple of alternative field names for exactly this case (a typing
generalization of ADR-0022's dataclass sketch, not a new behavior: the ADR's
own prose and the API Document's §3 resolver table both already specify
"exactly one, both set -> 422" for `RiskItem` specifically).

**DELETE's flush-then-catch-`IntegrityError` maps to `409 restrict_blocked`**
— a RESTRICT-blocked FK is a different failure class than create/update's
`422` (a well-formed request blocked by a still-referencing child row, not a
malformed one).
"""

import datetime
import enum
import types
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal, Union, get_args, get_origin

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, create_model
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    cast,
    func,
    or_,
    select,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission, has_permission_in_any_org
from app.db.base import Base
from app.models.actor import AIAgent, User
from app.models.assets import Requirement, TestCase, TestCondition, TestSuite, TestSuiteTestCase
from app.models.planning import TestPlan
from app.models.project import Project
from app.models.tenancy import OrgMembership
from app.models.trace import RequirementTestCaseLink

# API Document §1: offset-based pagination (NFR-6). Default page_size stays
# 25; the *ceiling* was raised 25 -> 100 by DS-2/ADR-0041 so the shared
# `container/Table.tsx` page-size selector's 100 option isn't silently
# clamped back to 25 by every list route. Kept as a plain per-module literal
# (not a new shared cross-module constant) per that ADR's explicit direction
# — `releases.py`/`org_memberships.py` each carry their own copy the same way.
_DEFAULT_PAGE_SIZE = 25
_MAX_PAGE_SIZE = 100

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."

# Model columns this factory auto-stamps with the acting actor's id on
# `create`, never accepted from the request body — `TestPlan.created_by_actor_id`
# and `TestExecution.executed_by_actor_id` (ADR-0025's `CreateTestExecutionRequest`
# docstring: "not accepted from the body... this field simply doesn't exist on
# the request schema at all", relying on this tuple to stamp it) are the two
# create-registered models that carry one of these (`TestCase`/`Defect` also
# have an equivalent column but neither registers `create` via this factory,
# ADR-0022). `hasattr(model, stamped_field)` in the caller below makes adding
# a field here safe for every other model — it's simply skipped when absent.
_ACTOR_STAMPED_FIELDS: tuple[str, ...] = ("created_by_actor_id", "executed_by_actor_id")

# `entry_exit_criteria` is already grammatically plural ("criteria") — the
# one exception to "resource.replace('_', '-') + 's'" among this factory's 20
# entities (verified against every path the API Document §3/§4 names).
_PLURAL_PATH_EXCEPTIONS: dict[str, str] = {"entry_exit_criteria": "entry-exit-criteria"}

ScopeField = str | tuple[str, str] | None
ResolveOrgId = Callable[[AsyncSession, Any], Awaitable[uuid.UUID | None]]
# PLAN-1/ADR-0031: optional per-entity business-rule check on `PATCH`, run
# after the 404/403 tenant gate and before any field is mutated. Receives the
# already-gated row and the caller's `exclude_unset` update dict; returns a
# `JSONResponse` to short-circuit with, or `None` to let the update proceed.
UpdateGuard = Callable[[Any, dict[str, Any]], JSONResponse | None]
# EXEC-2: optional per-entity side-effect hook on `PATCH`, run after `setattr`
# but before `flush`/`commit` — same transaction, so any row the hook
# `db.add()`s (e.g. a `TestLog` append) lands atomically with the update it
# describes. Receives the already-gated+mutated row, the pre-mutation values
# of every field named in the update dict (`old_values`), the raw
# `exclude_unset` update dict (`updates`), the acting actor, and the session.
# Only `_TEST_EXECUTION_CONFIG` sets this today (append a `TestLog` row when
# `result` changes) — every other entity's `PATCH` path is unchanged.
PostUpdateHook = Callable[[Any, dict[str, Any], dict[str, Any], "User | AIAgent", AsyncSession], Awaitable[None]]


class NoSchema(BaseModel):
    """Placeholder `update_schema` for an entity that never registers `update`.

    `CrudEntityConfig.update_schema` has no default (ADR-0022's dataclass
    sketch lists it as a required field) — entities like `Permission` (`list`/
    `get` only) still need to satisfy the type, so they pass this rather than
    a real per-entity schema that would never be bound to a route.
    """


# ADR-0053: moved verbatim from `EntityTable`'s own `ENUM_BADGE_COLORS`
# (frontend), which ADR-0053 retires as a *frontend* constant. Keyed by enum
# VALUE, not by entity — "high" reads as danger whether it's a `Defect`'s
# severity, a `RiskItem`'s likelihood or a `TestCondition`'s priority — so a
# per-entity copy would be the same 4 lines repeated 10 times with no entity
# ever legitimately disagreeing.
#
# Applied as the DEFAULT for any enum field; `FieldMeta.badge_colors`
# overrides it per-field where an entity ever does need its own palette,
# which is the per-field declarability ADR-0053's Decision asks for.
# `derive_entity_schema` filters whichever palette applies down to the
# field's own declared values, so a field never advertises a colour for a
# value it can't hold.
#
# UI Design Document §3: colour only where the value has an obvious status
# semantic. Values absent here (`EntryExitCriteria.type`, `TestLog.event_type`)
# deliberately have none and fall through to the frontend's plain-grey default.
ENUM_BADGE_COLORS: dict[str, str] = {
    "critical": "danger",
    "high": "danger",
    "fail": "danger",
    "suspended": "warning",
    "blocked": "warning",
    "medium": "warning",
    "invited": "info",
    "reviewed": "info",
    "low": "success",
    "pass": "success",
    "active": "success",
    "approved": "success",
    "draft": "secondary",
    "deprecated": "secondary",
    "superseded": "secondary",
    "skipped": "secondary",
}


@dataclass
class FieldMeta:
    """ADR-0053: per-field metadata `derive_entity_schema` cannot get from
    Pydantic alone — see that function's own docstring for exactly what's
    auto-derived vs. declared here. Only fields needing an override get an
    entry in `CrudEntityConfig.field_meta`; a field with no entry is fully
    auto-derived (type/required/enum-values), which is the common case.
    """

    # fk only — the ref entity's own `:entity` route slug (this module's own
    # `_resource_path(resource)`, e.g. "project"/"requirement"). Presence of
    # this field is what promotes a bare `uuid.UUID` annotation to `type:
    # "fk"` in the derived schema — nothing about the Python type itself
    # signals "this UUID is a foreign key," let alone which entity it targets.
    ref_entity: str | None = None
    # fk only — which field of the ref entity's own summary schema to
    # display (e.g. `Project`'s `name`, `TestCase`'s `title`).
    label_field: str | None = None
    # enum only — value -> Bootstrap color name, e.g. {"critical": "danger"}.
    # No correlate in the Python type at all; pure presentation.
    badge_colors: dict[str, str] | None = None
    # Overrides the auto-title-cased label ("external_ref" -> "External
    # ref") for a field whose hand-picked label doesn't match that pattern.
    label: str | None = None
    # Hide a field from the table (still in the form) — an arbitrary UI
    # choice, not derivable from anything Pydantic knows.
    show_in_table: bool = True
    # Overrides the auto-derived required-ness. Only needed for a field
    # that's logically required but has no `create_schema` to derive it
    # from (`Project`'s `name` — its real create is a 100% bespoke route,
    # `POST /orgs/{org_id}/projects`, never registered through this factory
    # at all — `required_fields` below can only ever see this config's own
    # `create_schema`, which is `None`).
    required: bool | None = None
    # ADR-0053 (sort): whether `?sort=<name>`/`?sort=-<name>` may target this
    # column on the generic `list` route. Default `True`, same auto-derive-
    # unless-overridden posture as `show_in_table` — every field maps 1:1 to a
    # real model column (`_to_summary`'s own docstring), so ordering by any of
    # them is always valid SQL; this exists purely for a field where sorting
    # would be misleading rather than for correctness (none needed yet).
    sortable: bool = True
    # ADR-0072 (ENTITY-FILTER-1): whether `?<name>=<value>` exact-match
    # filtering may target this column on the generic `list` route. Default
    # `True`, same auto-derive-unless-overridden posture as `sortable` above —
    # and, like it, the *derived* value is what
    # `derive_entity_schema`/`make_crud_router` actually use: a column holding
    # a value nobody can meaningfully type an exact match for is never
    # filterable regardless of what this flag says. That means `long_text`
    # below (the `<textarea>` presentation opt-in), OR a `Text` model column,
    # OR a `JSON`/`JSONB` one — see `_is_unfilterable_column`, and note how
    # little `long_text` covers on its own: it is declared on exactly one
    # field in this repo, against 16 `Text` columns and one `JSONB`. Set this
    # `False` by hand only for a column where exact matching would be
    # actively misleading for some *other* reason (none needed yet).
    filterable: bool = True
    # fk only — render as a plain native `<select>` (fetches the ref
    # entity's full list once, no search) instead of `FkAutocomplete`'s
    # debounced type-to-search widget. For a small, bounded catalog
    # (`TestLevel`/`TestType`/per-project `TestCondition`) a dropdown is
    # less friction than typing to search; large/unbounded ref entities
    # (`Requirement`, `Project`) should leave this `False` (the default).
    select: bool = False
    # Promotes a bare `str` annotation to `type: "text"` — a nullable/
    # unbounded SQLAlchemy `Text` column (as opposed to a length-limited
    # `String`), same "can't be inferred from the Pydantic annotation alone"
    # reasoning as `ref_entity` above (both `String`/`Text` columns type-check
    # identically as `str` in the schema). The frontend renders this as a
    # `<textarea>` (`EntityForm`'s `Textarea` atom) instead of a single-line
    # input. 2026-09-15, live-manual-test feedback on `TestCase.description`.
    long_text: bool = False


@dataclass
class ScopeSelectorOption:
    """ADR-0053 (moved from the frontend's `entityConfigs/types.ts`, per the
    CTO's own explicit direction — fully backend-driven, no residual static
    frontend file). One choice on `EntityListPage`'s "pick a parent row
    before the list can even fetch" step, for an entity whose `scope_field`
    has no value until the admin picks which row to scope by (`RiskItem`'s
    `requirement_id`-or-`test_plan_id` branch is the one entity needing more
    than one option — `CrudEntityConfig.scope_selector` accepts a tuple for
    exactly that case, same as its single-option siblings accept one).

    ADR-0081. `via`, when set, names a SECOND, earlier pick this option's own
    `ref_entity` needs before its list route can be searched at all — this
    entity's own `scope_selector` docstring already flagged the gap this
    closes: `ref_entity`'s own generic `list` route requires a scope query
    param (`TestCycle` needs `test_plan_id`, `TestExecution` needs
    `test_case_id`/`test_cycle_id`) that this page's own route params never
    supply, so `FkAutocomplete`'s search 422s, is swallowed, and the picker
    silently never finds anything — not a rendering bug, a missing query
    param. `via` is itself a full `ScopeSelectorOption` (recursive, though
    every declaration today is exactly one level deep) so the frontend
    renders it as a preceding picker step, feeding its resolved value in as
    `{via.param_name: pickedId}` on the OUTER option's own search — never
    reported to `onResolved` itself, which still only ever fires for the
    outer, real scope field this page's list route actually needs.

    ADR-0087. `select`, when `True`, renders this option's picker as
    `FkSelect` (a plain `<select>`, `ref_entity`'s full list fetched once, no
    `?q=` search) instead of `FkAutocomplete` — the same opt-in
    `FieldMeta.select` already uses for a small, bounded catalog
    (`TestLevel`/`TestType`/`TestCondition`, REQ-5). **Only set this for a
    `ref_entity` that is genuinely small and bounded** (`test-plan`,
    `test-suite`, `test-cycle` — typically a handful per project/plan) —
    never for one that can grow unboundedly per project (`requirement`,
    `test-case`, `defect`, `test-execution`, `test-condition`): `FkSelect`
    fetches at most `FULL_LIST_PAGE_SIZE` (100) rows and offers no search, so
    a large ref entity would silently truncate the choices, not just look
    different. Defaults `False` (`FkAutocomplete`) — the safe default for a
    ref entity nobody has explicitly vetted as bounded.

    ADR-0089. `label_field`, when set, is which field of `ref_entity`'s own
    served rows the picker displays for each option — the same job
    `FieldMeta.label_field`/`CompoundCreateAction.parent_label_field` already
    do for their own pickers. **Never had an equivalent here until now**: the
    frontend's `ScopeSelector` component never received *any* label field to
    pass its `FkAutocomplete`/`FkSelect`, so every scope-selector picker in
    the app rendered the referenced row's raw `id` in its dropdown/search
    results — flagged as a known gap in ADR-0081's own Consequences
    ("cosmetic, not a CRUD blocker, a distinct contained follow-up") and left
    unfixed until ADR-0087 widened `FkSelect` into a real dropdown, which
    turns "cosmetic" into "every option is a UUID, in your face, in a
    `<select>`."
    """

    ref_entity: str
    param_name: str
    label: str | None = None
    via: "ScopeSelectorOption | None" = None
    select: bool = False
    label_field: str | None = None


@dataclass
class LinkCreateAction:
    """[ADR-0076](../../../docs/adr/0076-relationship-tab-write-actions.md): how
    to create **one row** of a junction/link entity, described declaratively so
    a generic caller can invoke a bespoke route it knows nothing else about.

    Every one of ADR-0005's link tables (and REQ-4's/PLAN-1's two junctions)
    is `list`/`get` only through the factory — a row is written exclusively by
    a bespoke route (`test_suite_membership.py`, `test_plan_membership.py`,
    `trace.py`'s own four). ADR-0074's relationship tabs list those rows
    generically; ADR-0076 lets them *create* one, which needs two facts the
    generic surface cannot derive:

    - **`path_template`** — the bespoke route's own URL, with one `{...}`
      placeholder **named after this entity's own FK column** per path
      segment that carries an id (e.g.
      `"/test-suites/{test_suite_id}/test-cases/{test_case_id}"`). A caller
      that holds both FK values — which a relationship tab always does: one
      is the record being viewed, the other is what the user just picked —
      can build the URL with zero per-entity knowledge. Deliberately *not*
      the route's positional shape: naming the placeholders after the link
      row's own columns is what makes the substitution generic, and what lets
      the same declaration serve a tab mounted from **either** end of the
      junction (ADR-0075 Amendment 1 made all six bidirectional).
    - **`permission`** — the exact code the bespoke route gates on, so
      `usePermissions` can hide the affordance before an attempt rather than
      surfacing a `403` after it (ADR-0025's own pre-emptive posture, UI
      Design Document §5). It is **not** always `<resource>.create`: REQ-4's
      and PLAN-1's routes predate this ADR and gate on the *parent* entity's
      `test_suite.update`/`test_plan.update`, which ADR-0076 deliberately
      leaves alone rather than re-gating a shipped route. Declaring the code
      rather than deriving it is what accommodates both.

    A completeness test (`tests/unit/test_adr76_link_create_actions.py`) pins
    every `is_link_entity` config in the registry to declaring one of these,
    so a future junction cannot silently ship a read-only tab.
    """

    path_template: str
    permission: str


@dataclass
class LinkDeleteAction:
    """[ADR-0077](../../../docs/adr/0077-relationship-tab-unlink-action.md):
    `LinkCreateAction`'s exact mirror — how to **remove one row** of a
    junction/link entity, declared so a generic caller can invoke a bespoke
    `DELETE` it knows nothing else about.

    Everything `LinkCreateAction`'s own docstring says about *why* this is
    declared rather than derived applies here verbatim and for the same two
    reasons:

    - **`path_template`** — the bespoke route's URL, one `{...}` placeholder
      per id-bearing segment, each named after **this entity's own FK column**
      so a caller holding both ids substitutes by field name. For all six
      junctions today the template happens to equal the entity's own
      `link_create.path_template` (same URL, different verb), which is a
      *fact about how these six were designed*, not a contract — deriving
      one from the other would silently bake it in, and the first junction
      whose unlink lives elsewhere would fail with a literal brace in its URL.
      `tests/unit/test_adr76_link_create_actions.py` therefore checks the
      placeholders against `fk_fields_of` (the real contract) rather than
      against the create template.
    - **`permission`** — the exact code the bespoke `DELETE` gates on. Not
      always `<resource>.delete`: REQ-4's and PLAN-1's two junction routes
      predate this ADR and gate their `DELETE` on the *parent's*
      `test_suite.update`/`test_plan.update`, exactly as their `POST` does,
      and ADR-0077 re-gates no shipped route.

    A completeness test pins every `is_link_entity` config in the registry to
    declaring one, in both directions, mutation-tested in suite — the same
    partition `link_create` already has, in the same file, because the two
    range over the identical six configs and splitting them would create two
    checkers that have to agree.
    """

    path_template: str
    permission: str


@dataclass
class CompoundCreateAction:
    """[ADR-0078](../../../docs/adr/0078-compound-create-through-bespoke-routes.md):
    how a relationship tab creates the **far** entity of a junction when that
    entity has no generic `create` at all — by invoking the bespoke atomic
    route that is its only real authoring path.

    ADR-0076 Amendment 1 gave every many-to-many tab a "Create new <far
    entity>" action, built as the far entity's generic `create` followed by
    this junction's own `link_create`. That composition is only available when
    the far entity *has* a generic `create`, and three of the twelve live link
    directions point at one that does not: `TestCondition` (authored only by
    `POST /requirements/{id}/test-conditions`, REQ-3/ADR-0028) and `Defect`
    (only by `POST /executions/{id}/defects`, EXEC-3/ADR-0044). Both are
    bespoke precisely because the row cannot exist without a parent the
    generic factory has no way to stamp — `TestCondition.requirement_id` and
    `Defect.test_execution_id` are both `NOT NULL`.

    So this is not "a second create surface"; it is the *same* compound action
    pointed at a different first call. Declared, never derived, for exactly the
    two reasons `LinkCreateAction`'s docstring gives — a bespoke route's URL
    shape and its permission code are both arbitrary facts about that route.

    - **`far_field`** — which of this link entity's own two FK columns the
      created row fills (`"test_condition_id"`). This is what makes the
      declaration *directional*: a junction lists from both ends (ADR-0075
      Amendment 1), and only one end may need this. The tab's own scope field
      is the other FK, by construction.
    - **`path_template`** — the bespoke route's URL, carrying **exactly one**
      `{...}` placeholder, named after the FK column of the **created entity**
      that the segment fills (`"/requirements/{requirement_id}/test-conditions"`,
      `"/executions/{test_execution_id}/defects"`). Same naming convention as
      `LinkCreateAction`, and named rather than positional for the same reason.
    - **`permission`** — the code that route gates on (`"test_condition.create"`),
      so the affordance is hidden before an attempt rather than surfacing a
      `403` after it.
    - **`links_automatically`** — whether that route *already writes this
      junction's row itself*, inside its own transaction. This is the one fact
      a client cannot possibly infer and the one that changes what it must do:
      `True` means the tab is finished after one request; `False` means it must
      follow with this entity's own `link_create`, the identical second call
      ADR-0076 Amendment 1 already makes. Both shapes are live — see the three
      declarations in `app/api/routes/trace.py` for which is which and why.

    The remaining fields describe the **parent picker**, and are set only when
    one is needed. Whether it is needed is *derived*, not declared: the
    placeholder either names the tab's own scope field (so the tab already
    holds the value — `Requirement` -> "Test conditions (linked)", where the
    route's parent *is* the record being viewed) or it names something else the
    tab cannot know, and the user must pick it first. `tests/unit/
    test_adr78_compound_create_actions.py` asserts that partition in both
    directions, so a declaration cannot claim a picker it does not need or omit
    one it does.

    - **`parent_entity`** — the resource slug to search (`"requirement"`,
      `"test-execution"`), in the same singular-hyphenated spelling
      `FieldMeta.ref_entity` uses.
    - **`parent_label`** / **`parent_label_field`** — the picker's own label,
      and which field of the picked row to display. `parent_label_field` is
      declared rather than reused from the far entity's FK `label_field`
      because the two answer different questions: `Defect.test_execution_id`'s
      `label_field` is `"result"`, correct for naming a defect's execution in a
      table, and useless in a picker this action filters to `result=fail` —
      every option would read "fail".
    - **`parent_filters`** — extra fixed query params the picker must send,
      for a business rule the route enforces but the picker cannot see.
      `("result", "fail")` on the `Defect` action is the only one today:
      `POST /executions/{id}/defects` `422`s against a non-failed execution
      (EXEC-3 AC1's own literal precondition), so offering those rows would be
      offering a guaranteed rejection.

    The picker's *scope* needs no declaration at all and deliberately gets
    none — the client derives it, because the answer is already in the served
    schemas: if the parent entity's own scope field is the same column the tab
    is scoped by (`TestExecution.test_case_id` on a `TestCase` tab), the tab's
    parent id *is* the scope; otherwise the ordinary `pickerScopeParams` rule
    (ADR-0076 Decision §5) applies unchanged.

    ADR-0087. `parent_select`, when `True`, renders the parent picker as
    `FkSelect` instead of `FkAutocomplete` — same mechanism and same
    bounded-catalog caveat as `ScopeSelectorOption.select`'s own docstring.
    `TestCycle`'s `test-plan` parent (ADR-0086) is the one live case; the two
    `trace.py` declarations (`requirement`, `test-execution`) stay `False` —
    neither parent entity is bounded the way `test-plan` is.
    """

    far_field: str
    path_template: str
    permission: str
    links_automatically: bool
    parent_entity: str | None = None
    parent_label: str | None = None
    parent_label_field: str | None = None
    parent_filters: tuple[tuple[str, str], ...] = ()
    parent_select: bool = False


@dataclass
class ScopeResolution:
    """ADR-0053 (moved from the frontend, same posture as `ScopeSelectorOption`
    above). Derives a scope value automatically, no picker, by resolving
    `via_entity`'s own `get` route using a route param already in context,
    then reading `via_field` off the result — `Project`'s own admin page is
    the one user today (`/projects/:projectId/admin/projects`'s real
    `scope_field` is `org_id`, but that route has no `:orgId` param; this
    fetches the *current* Project and reads its `org_id` off the response).
    """

    from_route_param: Literal["orgId", "projectId"]
    via_entity: str
    via_field: str


@dataclass
class CrudEntityConfig:
    """Per-entity configuration consumed by `make_crud_router` (ADR-0022).

    Field list matches the ADR's own sketch verbatim, plus two additions the
    ADR's prose requires but its dataclass sketch didn't literally spell out
    by name (`is_global_catalog`, `global_read_fallback`) — see this module's
    own docstring for why both are necessary, not merely convenient.
    """

    model: type[Base]
    resource: str
    create_schema: type[BaseModel] | None
    update_schema: type[BaseModel]
    summary_schema: type[BaseModel]
    scope_field: ScopeField
    resolve_org_id: ResolveOrgId
    search_fields: tuple[str, ...] = ()
    # ADR-0072 (ENTITY-FILTER-1): **optional narrowing override only.** Leave
    # unset (the default, and what every config in this repo does) and the
    # filterable column set is DERIVED — every field `derive_entity_schema`
    # serves with `filterable: true`, exactly as `sortable_fields` is derived
    # from `sortable` (ADR-0053's "one source of truth, not a second
    # hand-kept list"). Naming fields here narrows that derived set to the
    # intersection; it can never widen it, and a name that isn't a derived
    # field of this entity is simply absent from the result rather than
    # reaching `getattr(model, ...)`. Unlike `search_fields` above — which
    # stays a genuine per-entity opt-in (ADR-0070), because "is this column
    # worth substring-scanning" is a product judgment — "can this column be
    # matched exactly" is answerable mechanically, so the default is yes.
    filter_fields: tuple[str, ...] = ()
    methods: frozenset[str] = field(default_factory=lambda: frozenset({"list", "get", "create", "update", "delete"}))
    # True for entities with no tenant at all (TestDesignTechnique/TestLevel/
    # TestType/Permission): `resolve_org_id` is a constant-`None` function,
    # and item routes gate via `has_permission_in_any_org` unconditionally
    # whenever it returns `None` (which, for these, is always).
    is_global_catalog: bool = False
    # True only for `Role`: `GET` on a `org_id IS NULL` row falls back to
    # `has_permission_in_any_org` (Q3/edge case 2); `PATCH`/`DELETE` still
    # `404`. Meaningless unless `is_global_catalog` is False.
    global_read_fallback: bool = False
    # PLAN-1/ADR-0031: optional business-rule guard on `PATCH` only. Set today
    # by `_TEST_PLAN_CONFIG` alone (the `status`-transition legality table);
    # every other entity leaves it `None` and its `PATCH` path is byte-for-byte
    # unchanged. ADR-0031's Alternatives section rejected giving `TestPlan` a
    # second, bespoke `PATCH`-alternative route for this — a body-shape-
    # conditional check inside the existing factory-produced handler is the
    # smaller, more honest diff, and this hook is how it gets there without
    # teaching the factory anything entity-specific.
    update_guard: UpdateGuard | None = None
    # EXEC-2: optional post-mutation side-effect hook on `PATCH`, see
    # `PostUpdateHook`'s own docstring above.
    post_update_hook: PostUpdateHook | None = None
    # ADR-0053: this entity's own nav-label, served by `GET
    # /entities/{resource}/schema` (`derive_entity_schema`). Falls back to
    # `_display_name(resource)` when unset so a config can still compile
    # before its own ADR-0053 port lands — every entity's config sets this
    # explicitly once ported, matching the frontend's pre-ADR-0053
    # `registry.ts` label verbatim.
    label: str | None = None
    # ADR-0053: per-field overrides for facts `derive_entity_schema` cannot
    # get from Pydantic alone — see `FieldMeta`'s own docstring for exactly
    # what. Only fields needing an override get an entry here.
    field_meta: dict[str, FieldMeta] = field(default_factory=dict)
    # ADR-0053: only set for the ~15 entities whose list can't fetch until
    # the admin picks (or the surface auto-resolves) which parent row to
    # scope by — see `ScopeSelectorOption`/`ScopeResolution`'s own
    # docstrings. A tuple of options is `RiskItem`'s branching-scope shape;
    # every other scope-selector entity sets exactly one.
    scope_selector: ScopeSelectorOption | tuple[ScopeSelectorOption, ...] | None = None
    scope_resolution: ScopeResolution | None = None
    # ADR-0076: set on link/junction entities only (`is_link_entity`) — the
    # declarative handle on the bespoke route that writes one of this entity's
    # rows. See `LinkCreateAction`'s own docstring. `None` everywhere else: an
    # entity whose rows the generic factory itself creates needs no such
    # declaration, its `create` method already says so.
    link_create: LinkCreateAction | None = None
    # ADR-0077: `link_create`'s mirror — the declarative handle on the bespoke
    # route that *removes* one of this entity's rows. Set on link/junction
    # entities only (`is_link_entity`), `None` everywhere else, for exactly the
    # reasons `link_create` above is. Deliberately NOT expressed by adding
    # `"delete"` to `methods`/`full_methods`: that flag means "the generic
    # factory's `DELETE /{resource}/{id}` works", which stays false — a link
    # row is addressed by its *pair* of FK ids on a bespoke path, never by its
    # own id, and flipping the flag would make `EntityTable` render a per-row
    # Delete calling a route that answers `405`.
    link_delete: LinkDeleteAction | None = None
    # ADR-0078: set on link/junction entities only, and only for a *direction*
    # whose far entity has no generic `create` — see `CompoundCreateAction`.
    # A tuple because the declaration is per-direction and a junction has two;
    # empty (the default, and what three of the six link configs keep) means
    # every direction's far entity can already be created generically, which is
    # what ADR-0076 Amendment 1's own composition needs and all this field
    # exists to substitute for.
    compound_creates: tuple[CompoundCreateAction, ...] = ()
    # ADR-0079: `compound_creates`' sibling for a one-to-many tab, declared on
    # the CHILD entity's own config (never a link entity's) — deliberately a
    # separate field rather than widening `compound_creates` itself, because
    # the two shapes disagree about what `CompoundCreateAction.far_field`
    # means: for `compound_creates` it names the link row's FAR FK (the one
    # `ADR-0078`'s own completeness suite computes as "the other of exactly
    # two"); here it names the entity's OWN scope FK — the field already known
    # from the tab being viewed, not a second one to solve for. A one-to-many
    # entity's `fk_fields_of` set is not reliably size-2 (`TestCondition` has
    # exactly one), so `compound_creates`' own "the other FK" derivation would
    # raise `StopIteration` rather than silently misidentify anything — reusing
    # the field and papering over that with a branch would still leave a test
    # suite built entirely around "a junction has two FKs" quietly describing
    # a shape that no longer holds for every declarer. A separate field keeps
    # both completeness suites simple and honest about which shape each one
    # actually checks.
    #
    # Matched by `EntityRelationTab` against `relation.scopeField` (never
    # `relation.targetField`, which is `null` for every one-to-many tab) — see
    # `CompoundCreateAction`'s own docstring for the field-by-field meaning,
    # unchanged here; only the matching key differs. `TestExecution` is the one
    # live entity needing two entries (`test_case_id`/`test_cycle_id`), because
    # it has two distinct one-to-many parents and each tab must resolve the
    # *other* one via whichever picker mechanism that direction needs.
    child_compound_creates: tuple[CompoundCreateAction, ...] = ()
    # ADR-0053: overrides `methods` for the derived schema's own `methods`
    # array only — never affects which routes `make_crud_router` registers.
    # `Project` is the one user today: its real REST surface is `list`/
    # `get`/`update`/`delete`, but `get`/`update` are this module's own
    # bespoke routes at the same URL shape (this config's own `methods`
    # above is only `{"list","delete"}`, the two the factory itself
    # registers) — the admin surface still needs to know all four exist.
    full_methods: frozenset[str] | None = None
    # ADR-0053 (Amendment 1): display order for the derived `fields[]`. Needed
    # because `derive_entity_schema`'s own natural order is an artefact of
    # *which schema* a field came from (writable schemas first, summary-only
    # last), not of how the entity reads on screen — so an FK/scope field
    # that's absent from `create_schema`/`update_schema` (e.g. `Project`'s
    # `org_id`, `TestCase`'s `test_condition_id`) sorts to the bottom, while
    # every hand-written `entityConfigs/*.ts` led with it.
    #
    # Deliberately order-ONLY, never a field *filter*: any field not named
    # here still appears, appended in derived order. Letting this double as
    # the field list would reintroduce exactly the `Requirement.title` drift
    # this ADR exists to close (a new required backend field silently absent
    # from the form because nobody added it to a second list).
    field_order: tuple[str, ...] = ()


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors every existing route module's own `_error()` verbatim — this
    factory keeps its own copy per that established per-module convention.
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


async def _org_membership_exists(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Any-status `OrgMembership` existence check for the 404-vs-403 boundary.

    Mirrors `projects.py`/`releases.py`/`org_memberships.py`'s helper of the
    same name verbatim (NFR-1: any-status counts, not just active).
    """
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


async def _actor_membership_exists(db: AsyncSession, org_id: uuid.UUID, actor: "User | AIAgent") -> bool:
    """`_org_membership_exists`, `AIAgent`-correct (EXEC-2; mirrors
    `assets.py`'s own helper of the same name verbatim, ADR-0033/MCP-1's
    precedent). `OrgMembership.user_id` FKs `user.actor_id` specifically — an
    `AIAgent` caller has no `user` row of its own, so the plain
    `_org_membership_exists(org_id, actor.actor_id)` check above always
    returns `False` for an agent, 404-ing every agent-originated request as
    "no membership" regardless of its `acting_on_behalf_of_user_id`'s real
    membership. Any *new* route gated on org membership and taking a
    `User | AIAgent` actor should use this, not the plain helper
    (`backend/CLAUDE.md`'s standing rule) -- added here rather than only in
    `assets.py` because `execution.py`'s two new EXEC-2 bespoke routes and
    `execution_authoring.py`'s existing create route (which had never been
    exercised by a real `AIAgent` caller before EXEC-2's own test suite) both
    need it too.
    """
    target_user_id = actor.acting_on_behalf_of_user_id if isinstance(actor, AIAgent) else actor.actor_id
    return await _org_membership_exists(db, org_id, target_user_id)


# --- resolve_org_id building blocks (ADR-0022's resolver map) --------------------------------


async def resolve_terminal_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Resolve a row that should carry `org_id` directly, or `project_id` (one further hop).

    The shared "last step" every `chain_resolver` walk ends on: most entities
    either have their own `org_id` column (`Role`/`OrgMembership`/
    `RoleAssignment`, or a `Project`/`Organization` row reached by an earlier
    hop) or a `project_id` column one hop from `Project.org_id`
    (`Requirement`/`TestSuite`/`Environment`/`TestPlan`, or a row reached by
    an earlier hop that itself has one). `getattr(..., None)` throughout so
    this also works against a `types.SimpleNamespace` stand-in carrying only
    the one scope-FK attribute a list/create scope check has available (see
    `extract_scope_value`) — not just a real ORM instance.
    """
    org_id = getattr(row, "org_id", None)
    if org_id is not None:
        return org_id
    project_id = getattr(row, "project_id", None)
    if project_id is None:
        return None
    project = await db.get(Project, project_id)
    return project.org_id if project is not None else None


def chain_resolver(hops: Sequence[tuple[type, str]]) -> ResolveOrgId:
    """Build a `resolve_org_id(db, row)` that walks `hops` via `db.get`, then resolves the terminal row.

    Each hop is `(ParentModel, fk_column_name)`: read `fk_column_name` off
    the current row, `db.get(ParentModel, that_value)`, and continue from
    there. An empty `hops` list resolves `row` itself via
    `resolve_terminal_org_id` — the "direct column" case (`Requirement`,
    `OrgMembership`, ...). A missing FK value or a hop that resolves to no
    row at all short-circuits to `None` (unresolvable chain -> the caller
    404s, never a partial/guessed result).
    """

    async def _resolve(db: AsyncSession, row: Any) -> uuid.UUID | None:
        current: Any = row
        for parent_model, fk_column in hops:
            fk_value = getattr(current, fk_column, None)
            if fk_value is None:
                return None
            current = await db.get(parent_model, fk_value)
            if current is None:
                return None
        return await resolve_terminal_org_id(db, current)

    return _resolve


def branching_resolver(branches: Sequence[tuple[str, ResolveOrgId]]) -> ResolveOrgId:
    """Build a `resolve_org_id(db, row)` that picks a branch by which FK is present.

    ADR-0075 Amendment 1. The generalization of `resolve_risk_item_org_id`'s
    hand-written shape, needed once a `scope_field` is a branching 2-tuple: the
    factory's own `_resolve_scope_for_write` calls `resolve_org_id` with a
    `types.SimpleNamespace` carrying **only the one scope attribute the request
    actually supplied**, so a resolver hard-coded to walk the other arm reads
    `None` off that stand-in and 404s a perfectly valid list request. A
    bidirectional junction therefore needs one branch per arm, not one walk.

    Branches are tried in declaration order and the first whose named attribute
    is non-`None` wins. Order is load-bearing for the *other* call site, and in
    the opposite way: `_fetch_and_gate` passes a **real row**, which carries
    every FK at once, so the first branch always fires there. Declaring the arm
    that was the config's sole `scope_field` before the widening first is what
    makes the item-route (`get`) walk byte-identical to its pre-widening self —
    the new arm only ever runs for a scope stand-alone that lacks the old one.

    Both arms of a junction necessarily resolve to the same org (a link row
    whose two ends sat in different tenants could not have been created — every
    bespoke write route checks both sides against one `org_id` first), so
    branch order is a *behaviour-preservation* choice, never a correctness one.

    Returns `None` when no branch's attribute is set — an unresolvable chain,
    which every caller turns into `404`, never a partial or guessed result,
    exactly as `chain_resolver` does.
    """

    async def _resolve(db: AsyncSession, row: Any) -> uuid.UUID | None:
        for field_name, resolver in branches:
            if getattr(row, field_name, None) is not None:
                return await resolver(db, row)
        return None

    return _resolve


async def resolve_test_case_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Bespoke `TestCase` resolver (ADR-0022): nullable-hop with three fallbacks.

    `test_condition_id` (if set) -> `TestCondition.requirement_id` ->
    `Requirement.project_id` -> `Project.org_id`. If `test_condition_id` is
    `None` (ADR-0006), falls back first to any linked `RequirementTestCaseLink`
    -> `Requirement.project_id` -> `Project.org_id` (REQ-2's direct-link
    path — the whole point of ADR-0006 is that this shape is first-class, not
    an edge case), then to `project_id` if set -> `Project.org_id` directly
    (REQ-5's standalone path, ADR-0069 — checked after both link-table
    branches, so a since-linked standalone case resolves via the more
    specific branch instead), then to any linked `TestSuiteTestCase` ->
    `TestSuite.project_id` -> `Project.org_id`. A `TestCase` reachable by
    none of the four resolves `None` — genuinely orphaned (schema-legal, no
    create path in this codebase produces it) — the caller must treat this
    as "unresolvable tenant", i.e. `404`, never the any-org global-catalog
    fallback (ADR-0022 edge case #1; `is_global_catalog=False` on `TestCase`'s
    own config makes that distinction automatically).
    """
    test_condition_id = getattr(row, "test_condition_id", None)
    if test_condition_id is not None:
        condition = await db.get(TestCondition, test_condition_id)
        if condition is None:
            return None
        requirement = await db.get(Requirement, condition.requirement_id)
        if requirement is None:
            return None
        return await resolve_terminal_org_id(db, requirement)

    row_id = getattr(row, "id", None)

    # `row_id` is `None` for the scope-resolution call `_resolve_scope_for_write`
    # makes for the new generic `create`/`list` (a `types.SimpleNamespace`
    # carrying only `project_id`, ADR-0069) — the requirement-link and
    # suite-link branches below both need a real row id, so they're skipped
    # for that call rather than short-circuiting to `None` outright; the
    # `project_id` branch (which needs no row id) still runs.
    if row_id is not None:
        requirement_link = await db.scalar(
            select(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id == row_id).limit(1)
        )
        if requirement_link is not None:
            requirement = await db.get(Requirement, requirement_link.requirement_id)
            if requirement is None:
                return None
            return await resolve_terminal_org_id(db, requirement)

    project_id = getattr(row, "project_id", None)
    if project_id is not None:
        # REQ-2's/REQ-3's own resolved-parent chains above are checked first —
        # a standalone case that has since gained a `RequirementTestCaseLink`
        # via `link_test_case_to_requirement` resolves via that branch above,
        # not this one, even though `project_id` is deliberately never
        # cleared on link (ADR-0069). This branch only actually fires for a
        # case with no Requirement/TestCondition traceability yet.
        project = await db.get(Project, project_id)
        if project is None:
            return None
        return project.org_id

    if row_id is None:
        return None

    suite_link = await db.scalar(select(TestSuiteTestCase).where(TestSuiteTestCase.test_case_id == row_id).limit(1))
    if suite_link is None:
        return None
    suite = await db.get(TestSuite, suite_link.test_suite_id)
    if suite is None:
        return None
    return await resolve_terminal_org_id(db, suite)


async def resolve_test_case_project_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """The `project_id` sibling of `resolve_test_case_org_id`, same four branches, same order.

    Needed by every bespoke route that has to answer "are these two rows in
    the same **project**?" — a business-rule question ADR-0030/ADR-0031 answer
    with `422`, distinct from the tenant question `resolve_test_case_org_id`
    answers with `404`. The org resolver's terminal step
    (`resolve_terminal_org_id`) converts `project_id` -> `Project.org_id` and
    discards the `project_id` on the way, so there is no seam in it to reuse.

    **ADR-0076 — found and fixed.** `test_suite_membership.py` had carried a
    private three-branch copy of this since REQ-4 (`_resolve_test_case_project_id`),
    written before `TestCase` had a `project_id` column at all. REQ-5/ADR-0069
    added that column and a matching fourth branch to the *org* resolver above
    — but nothing pointed at the private project-side copy, so it kept
    returning `None` for a standalone `TestCase`, and
    `add_test_case_to_suite` rejected **every** standalone case with
    `422 "This test case belongs to a different project."` even when the suite
    and the case sat in the same project. Exactly the duplicated-walk drift
    that copy's own docstring predicted ("if these two ever drift, the failure
    mode is a wrong `422`") — it drifted, silently, because the duplication
    made the REQ-5 change look complete. Promoted here so the two walks are
    one function and cannot drift again; `test_suite_membership.py` now
    delegates.

    Branch order mirrors `resolve_test_case_org_id` exactly, which matters for
    the same reason it does there: a standalone case that has *since* gained a
    `RequirementTestCaseLink` resolves through that link (its `project_id` is
    deliberately never cleared on link, ADR-0069), so both resolvers agree on
    which parent a case belongs to.

    Returns `None` for a `TestCase` reachable by none of the four — genuinely
    orphaned, no create path in this codebase produces one. Callers treat that
    as "cannot prove same-project", i.e. reject.
    """
    test_condition_id = getattr(row, "test_condition_id", None)
    if test_condition_id is not None:
        condition = await db.get(TestCondition, test_condition_id)
        if condition is None:
            return None
        requirement = await db.get(Requirement, condition.requirement_id)
        return requirement.project_id if requirement is not None else None

    row_id = getattr(row, "id", None)
    if row_id is not None:
        requirement_link = await db.scalar(
            select(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id == row_id).limit(1)
        )
        if requirement_link is not None:
            requirement = await db.get(Requirement, requirement_link.requirement_id)
            return requirement.project_id if requirement is not None else None

    project_id = getattr(row, "project_id", None)
    if project_id is not None:
        return project_id

    if row_id is None:
        return None

    suite_link = await db.scalar(select(TestSuiteTestCase).where(TestSuiteTestCase.test_case_id == row_id).limit(1))
    if suite_link is None:
        return None
    suite = await db.get(TestSuite, suite_link.test_suite_id)
    return suite.project_id if suite is not None else None


async def resolve_via_test_case(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Shared by `TestStep`/`Attachment`: one hop to `TestCase`, then delegate.

    `TestCase`'s own resolver is bespoke (branching + fallback), not a plain
    FK-to-`org_id`/`project_id` terminal, so this can't be expressed as a
    `chain_resolver` hop — it fetches the real `TestCase` row and hands it to
    `resolve_test_case_org_id` directly.
    """
    test_case_id = getattr(row, "test_case_id", None)
    if test_case_id is None:
        return None
    test_case = await db.get(TestCase, test_case_id)
    if test_case is None:
        return None
    return await resolve_test_case_org_id(db, test_case)


async def resolve_risk_item_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Bespoke `RiskItem` resolver (ADR-0022): branch on whichever FK is set.

    `RiskItem`'s own `CHECK` constraint only requires "at least one of
    `requirement_id`/`test_plan_id`" (an `OR`, not `XOR`) — the factory's
    `create_schema`/scope-validation layer enforces "exactly one" before a
    row can ever exist with both set via this API (edge case #5), so this
    resolver only ever needs to pick whichever single FK is actually
    present. `getattr(..., None)` (not direct attribute access) so this also
    works against a `types.SimpleNamespace` scope stand-in that only carries
    ONE of the two attributes (see `extract_scope_value`).
    """
    requirement_id = getattr(row, "requirement_id", None)
    if requirement_id is not None:
        requirement = await db.get(Requirement, requirement_id)
        if requirement is None:
            return None
        return await resolve_terminal_org_id(db, requirement)

    test_plan_id = getattr(row, "test_plan_id", None)
    if test_plan_id is not None:
        test_plan = await db.get(TestPlan, test_plan_id)
        if test_plan is None:
            return None
        return await resolve_terminal_org_id(db, test_plan)

    return None


async def resolve_organization_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """`Organization`'s own resolver: the row IS the tenant, `id` IS `org_id`.

    `Organization` has no `org_id`/`project_id` column of its own (only `id`)
    so `resolve_terminal_org_id`'s generic attribute lookup doesn't apply —
    this is the one entity where "id is itself the scope" (API Document §3).
    """
    return getattr(row, "id", None)


async def resolve_global_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Constant-`None` resolver for true global catalogs (no tenant, ever).

    Used by `TestDesignTechnique`/`TestLevel`/`TestType`/`Permission`
    (`is_global_catalog=True` on all four) — distinguished from a *row*
    resolving to `None` (see this module's own docstring, edge case #1).
    """
    return None


# --- scope-field helpers (list/create) --------------------------------------------------------


def _scope_candidates(config: CrudEntityConfig) -> tuple[str, ...]:
    if config.scope_field is None:
        return ()
    if isinstance(config.scope_field, tuple):
        return config.scope_field
    return (config.scope_field,)


def extract_scope_value(config: CrudEntityConfig, source: Mapping[str, Any]) -> tuple[str, Any] | None:
    """Pick the single present scope field + value out of `source`.

    `source` is either `request.query_params` (`list`) or a create payload's
    `model_dump()` (`create`). Returns `None` — the caller then 422s via
    `scope_validation_error` — when zero or more than one of the candidate
    fields is present: for a plain single-field `scope_field` that's simply
    "missing"; for `RiskItem`'s 2-tuple shape, "more than one present"
    collapses the DB `CHECK` constraint's `OR` down to the API's own
    "exactly one" rule (ADR-0022 edge case #5), applied identically on `list`
    and `create` (API Document §3's resolver table states the "exactly one"
    rule for the scope param generally, not create-only).
    """
    candidates = _scope_candidates(config)
    if not candidates:
        return None
    present = [(f, source.get(f)) for f in candidates if source.get(f) not in (None, "")]
    if len(present) != 1:
        return None
    return present[0]


def scope_validation_error(config: CrudEntityConfig, source: Mapping[str, Any]) -> JSONResponse:
    """Build the `422` for a missing/ambiguous scope value (see `extract_scope_value`)."""
    candidates = _scope_candidates(config)
    primary_field = candidates[0]
    present_count = sum(1 for f in candidates if source.get(f) not in (None, ""))

    if len(candidates) == 1:
        field_errors = {primary_field: [f"{primary_field} is required."]}
    elif present_count == 0:
        field_errors = {primary_field: [f"exactly one of {' or '.join(candidates)} must be set"]}
    else:
        field_errors = {primary_field: [f"exactly one of {' or '.join(candidates)} must be set, not both"]}

    return _error(422, "validation_error", "Request failed validation.", field_errors=field_errors)


# --- list query-building (pure, no DB access — unit-testable) --------------------------------


def _search_clause(model: type[Base], column_name: str, search_term: str) -> Any:
    """Build one `?q=` `ILIKE` clause for a single `search_fields` column.

    ADR-0070: a numeric column is `CAST`-to-text first, a string column is
    matched directly. This is not a cosmetic nicety — Postgres has no
    `integer ~~* unknown` operator at all, so an un-cast `ILIKE` against an
    `Integer`/`BigInteger`/`Numeric` column is a hard `ProgrammingError` at
    query time (`operator does not exist`), not a silently-empty result. That
    made numeric columns structurally unlistable in `search_fields` before
    this cast existed, which is why every pre-ADR-0070 `search_fields` tuple
    in this repo happens to be string-only.

    `SmallInteger`/`BigInteger` subclass `Integer` and `Float` subclasses
    `Numeric`, so the two-entry isinstance check covers every numeric column
    type SQLAlchemy ships — no per-subclass enumeration needed.

    Cast-to-text gives *substring* semantics on the rendered digits, matching
    what the one `?q=` box in the UI can express: `?q=1` matches sequence
    `1`, `10` and `21` alike. That is the deliberate trade (ADR-0070
    Alternatives considered exact-match-on-numeric and rejected it — one
    query param cannot carry two different match semantics without the
    caller knowing each column's type, and `filter_fields` already covers
    exact match for anyone who needs it).
    """
    column = getattr(model, column_name)
    if isinstance(column.type, (Integer, Numeric)):
        return cast(column, String).ilike(f"%{search_term}%")
    return column.ilike(f"%{search_term}%")


# Accepted spellings for a `Boolean` filter value (ADR-0072). Case-folded
# before lookup. Deliberately NOT "yes"/"on"/"y" — the frontend's own filter
# control emits exactly `true`/`false`, and `1`/`0` is here only because a
# hand-written `curl`/MCP caller reaches for it first.
_TRUE_FILTER_VALUES = frozenset({"true", "1"})
_FALSE_FILTER_VALUES = frozenset({"false", "0"})


def coerce_filter_value(column: Any, column_name: str, value: Any) -> Any:
    """Parse one raw `?<column_name>=<value>` query-string value into whatever
    Python type `column`'s own SQLAlchemy type expects (ADR-0072).

    Every query param arrives as a `str`. Comparing that string against a
    `uuid`/`timestamptz`/`date`/`integer`/`boolean`/enum column is not a
    silently-empty result — Postgres raises, and the request surfaces as a
    **500**. Before ADR-0072 only 7 entities declared `filter_fields` (all of
    them `String`/enum columns, where the raw string happened to be correct),
    so the gap never bit; with the set derived across all 27 it would bite
    immediately. Branching on `column.type` is the same `isinstance`-on-the-
    column's-own-type technique ADR-0070 §1 used for its `?q=` numeric cast.

    | column type | parse rule |
    |---|---|
    | `Uuid` (incl. `postgresql.UUID`) | `uuid.UUID(value)` |
    | `Boolean` | `true`/`false`/`1`/`0`, case-insensitive |
    | `Enum` | must be one of `column.type.enums`, passed through as `str` |
    | `Integer` (incl. `SmallInteger`/`BigInteger`) | `int(value)` |
    | `Float` | `float(value)` |
    | `Numeric` | `Decimal(value)` |
    | `DateTime` | `datetime.datetime.fromisoformat(value)` |
    | `Date` | `datetime.date.fromisoformat(value)` |
    | anything else (`String`/`Text`/JSON/...) | passed through unchanged |

    Order is load-bearing in two places: SQLAlchemy's `Enum` **subclasses
    `String`**, so it must be tested before the string fallthrough; and
    `Float` subclasses `Numeric`, so it must be tested before it. `Integer`
    covers `SmallInteger`/`BigInteger` by subclassing rather than by
    enumeration, same completeness argument ADR-0070 §1 makes for its own
    two-entry check.

    Raises `ValueError(column_name)` for anything unparseable — the field name
    is the payload, mirroring `apply_sort`'s own contract exactly, so the
    caller can build the API Document §1 `field_errors` body without a second
    lookup. Pure: no DB access, no I/O.
    """
    column_type = getattr(column, "type", None)
    try:
        if isinstance(column_type, Uuid):
            return uuid.UUID(str(value))
        if isinstance(column_type, Boolean):
            lowered = str(value).strip().lower()
            if lowered in _TRUE_FILTER_VALUES:
                return True
            if lowered in _FALSE_FILTER_VALUES:
                return False
            raise ValueError(column_name)
        if isinstance(column_type, SAEnum):
            # Before the `String` fallthrough (see docstring). `.enums` is the
            # declared value list (`values_callable` already applied), so this
            # rejects an unknown member with a 422 instead of letting Postgres
            # raise `invalid input value for enum ...` as a 500.
            if str(value) not in (column_type.enums or ()):
                raise ValueError(column_name)
            return str(value)
        if isinstance(column_type, Integer):
            return int(str(value))
        if isinstance(column_type, Float):
            return float(str(value))
        if isinstance(column_type, Numeric):
            return Decimal(str(value))
        if isinstance(column_type, DateTime):
            return datetime.datetime.fromisoformat(str(value))
        if isinstance(column_type, Date):
            return datetime.date.fromisoformat(str(value))
    except (TypeError, ValueError, ArithmeticError) as exc:
        # `Decimal("nope")` raises `decimal.InvalidOperation`, an
        # `ArithmeticError` and NOT a `ValueError` — normalising here is what
        # lets every caller catch one exception type.
        raise ValueError(column_name) from exc
    return value


def apply_filters_and_search(
    query: Any,
    model: type[Base],
    filter_fields: tuple[str, ...],
    search_fields: tuple[str, ...],
    query_params: Mapping[str, Any],
) -> Any:
    """Translate `filter_fields`/`?q=` query params into `WHERE` clauses on `query`.

    `filter_fields` are exact-match (`WHERE column = value` for each param
    actually present, the value first parsed to the column's own type by
    `coerce_filter_value`, ADR-0072); `search_fields`, if configured, back a
    single `?q=` param compiled to `OR`-joined `ILIKE '%term%'` across those
    columns — numeric columns cast to text first, see `_search_clause`
    (ADR-0070). An entity with no `search_fields` configured silently ignores `?q=` rather
    than erroring (ADR-0022) — `q` is only ever consulted when `search_fields`
    is non-empty. A filter param that is absent or an empty string is likewise
    a no-op, unchanged from ADR-0022. Pure query-building: never executes
    anything, so this is testable without a DB
    (`tests/unit/test_crud_factory.py`).

    Raises `ValueError(column_name)` when a present filter value can't be
    parsed for its column (ADR-0072) — the caller maps that to a `422`, the
    same shape `apply_sort`'s own `ValueError` already gets.
    """
    for column_name in filter_fields:
        raw_value = query_params.get(column_name)
        if raw_value in (None, ""):
            continue
        column = getattr(model, column_name)
        query = query.where(column == coerce_filter_value(column, column_name, raw_value))

    search_term = query_params.get("q")
    if search_term and search_fields:
        query = query.where(or_(*[_search_clause(model, f, search_term) for f in search_fields]))

    return query


def apply_sort(query: Any, model: type[Base], sort_param: str | None, sortable_fields: frozenset[str]) -> Any:
    """Translate `?sort=<field>`/`?sort=-<field>` (leading `-` = descending)
    into an `ORDER BY` clause on `query`. A falsy `sort_param` leaves `query`
    unchanged (today's pre-sort behavior: whatever order the DB returns).

    `sortable_fields` gates which column names are acceptable — never
    `getattr(model, ...)` an arbitrary caller-supplied string, both because an
    unknown attribute name would 500 and because the field list is this
    route's own declared contract (`derive_entity_schema`'s `sortable`
    flags), not "every column this ORM model happens to have". Raises
    `ValueError(field_name)` for a name outside that set — the caller maps
    that to a `422`, matching every other malformed-list-query-param shape
    this module already 422s (`extract_scope_value`'s missing/ambiguous
    scope, the list route's own scope-UUID-parse failure). Pure query-
    building, no DB access — unit-testable without a DB, same posture as
    `apply_filters_and_search`/`clamp_pagination`.
    """
    if not sort_param:
        return query
    descending = sort_param.startswith("-")
    field_name = sort_param[1:] if descending else sort_param
    if not field_name or field_name not in sortable_fields:
        raise ValueError(field_name)
    column = getattr(model, field_name)
    return query.order_by(column.desc() if descending else column.asc())


def clamp_pagination(page: int, page_size: int, max_page_size: int = _MAX_PAGE_SIZE) -> tuple[int, int]:
    """Clamp `page`/`page_size` to the API Document §1/NFR-6 convention.

    `page` floors at 1; `page_size` floors at 1 and ceilings at
    `max_page_size` (100 by default since DS-2/ADR-0041 raised the ceiling
    from 25, same as `releases.py`'s own list route). The ceiling is
    *inclusive*: `page_size=100` is returned unchanged, `page_size=101` (or
    500) clamps to exactly 100 — never a `422`, per TC-DS-012.
    Pure function — unit-testable without a DB.
    """
    return max(page, 1), min(max(page_size, 1), max_page_size)


# --- row <-> schema mapping -------------------------------------------------------------------


def _to_summary(config: CrudEntityConfig, row: Any) -> BaseModel:
    """Build `config.summary_schema` off `row`'s own attributes, by field name.

    Every schema in this factory's cluster files names its fields identically
    to the ORM column they mirror, so a plain by-name `getattr` covers every
    entity generically — no per-entity mapping function needed (unlike the
    bespoke `_release_summary`/`_member_summary` helpers in `releases.py`/
    `org_memberships.py`, which exist precisely because THEIR shapes don't
    map 1:1, e.g. a joined `User.email`). SQLAlchemy `Enum` columns store a
    Python `str` `Enum` member (`TestCaseStatus.draft`, etc.) — `.value` is
    extracted explicitly rather than relying on `str, Enum`'s implicit str
    behavior, matching `releases.py`'s own explicit `.value if hasattr(...)`
    precedent for `TestExecutionResult`.
    """
    data: dict[str, Any] = {}
    for field_name in config.summary_schema.model_fields:
        value = getattr(row, field_name, None)
        if isinstance(value, enum.Enum):
            value = value.value
        data[field_name] = value
    return config.summary_schema(**data)


def _build_list_response_schema(summary_schema: type[BaseModel]) -> type[BaseModel]:
    """Build the `{items, total, page, page_size}` envelope model for `summary_schema`.

    Built dynamically via `pydantic.create_model` rather than requiring a
    `list_response_schema` field on `CrudEntityConfig` — keeps the config
    dataclass exactly matching ADR-0022's own field list (schema files still
    define an explicit `<Entity>ListResponse` per the plan, for OpenAPI/type-
    generation consumers, but this factory doesn't need to be handed one to
    wire the route: same JSON shape either way).
    """
    return create_model(
        f"{summary_schema.__name__}ListResponse",
        items=(list[summary_schema], ...),
        total=(int, ...),
        page=(int, ...),
        page_size=(int, ...),
    )


# --- path/display-name helpers -----------------------------------------------------------------


def _resource_path(resource: str) -> str:
    """`"test_condition"` -> `"test-conditions"` (API Document §3/§4 path convention)."""
    if resource in _PLURAL_PATH_EXCEPTIONS:
        return _PLURAL_PATH_EXCEPTIONS[resource]
    return resource.replace("_", "-") + "s"


def _display_name(resource: str) -> str:
    """`"test_condition"` -> `"Test condition"` (for `"{name} not found."` bodies)."""
    return resource.replace("_", " ").capitalize()


# --- entity schema derivation (ADR-0053) ---------------------------------------------------------


def _unwrap_optional(annotation: Any) -> Any:
    """`X | None` / `Optional[X]` -> `X`. A field's own optionality is tracked
    separately via `required_fields` (derived from `create_schema`'s own
    `is_required()`, not from the annotation) — this only strips the wrapper
    so the inner type can be classified."""
    origin = get_origin(annotation)
    if origin is types.UnionType or origin is Union:
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return args[0]
    return annotation


def _field_type_and_values(annotation: Any) -> tuple[str, list[str] | None]:
    """Mechanical half of ADR-0053's hybrid derivation — everything Pydantic's
    own type annotation can answer without any per-field declaration:
    `Literal[...]` -> enum + its values, `uuid.UUID`/`datetime.date`/
    `datetime.datetime`/`bool` -> their obvious counterpart, everything else
    (str, dict/JSON columns like `TestLog.payload`, etc.) -> "string" as the
    generic fallback `EntityTable`'s own `displayValue()` already handles.
    `uuid.UUID` deliberately maps to `"string"` here, not `"fk"` — promoting
    it requires a `FieldMeta.ref_entity` entry (see that dataclass's own
    docstring for why this can't be inferred from the type alone).
    """
    annotation = _unwrap_optional(annotation)
    origin = get_origin(annotation)
    if origin is Literal:
        return "enum", [str(v) for v in get_args(annotation)]
    if annotation in (datetime.date, datetime.datetime):
        return "date", None
    if annotation is bool:
        return "boolean", None
    return "string", None


def _is_unfilterable_column(model: type[Base], field_name: str) -> bool:
    """Is `field_name` backed by a column no user can meaningfully exact-match?

    ADR-0072 offers every served field as an exact-match filter except the ones
    holding **a value a user cannot meaningfully type an exact match for**. Two
    column categories qualify, for the one shared reason:

    - **`Text`** — unbounded free text. A person filtering on a paragraph
      column types a fragment, gets zero rows, and reads that as "no such
      record" rather than "this filter is exact-match". `?q=` (ADR-0070) is
      what covers these columns properly.
    - **`JSON`/`JSONB`** — a structured blob. Equality compares the *whole
      document*, so the only input that ever matches is a byte-exact
      re-serialization of it. Worse than the text case rather than better:
      it does not error (SQLAlchemy serializes the raw string to valid jsonb
      and Postgres has a `jsonb = jsonb` operator), it just silently always
      returns nothing. `TestLog.payload` is the schema's only such column.

    Deriving both from the column's own type — rather than from
    `FieldMeta.long_text`, a *presentation* opt-in (render a `<textarea>`)
    that exactly one field in this repo sets (`TestCase.description`) against
    `mapped_column(Text, ...)`'s 16 — makes the exclusion mechanical and
    complete: a new `Text`/`JSON` column is non-filterable the moment it is
    mapped, with nothing to remember.

    **`Text`, never `String`.** `Text` subclasses `String`, so an
    `isinstance(..., String)` check would exclude every string column in the
    schema, including the short, bounded, genuinely-exact-matchable ones
    (`Requirement.title`, `Project.name`) this rule is meant to keep. `Enum`
    also subclasses `String` and is likewise unaffected — a closed vocabulary
    is precisely what exact-match filtering is for (ADR-0070 §4).

    **Generic `JSON`, not `postgresql.JSONB`.** `JSONB` subclasses the
    dialect-agnostic `sqlalchemy.JSON`, so the generic check catches both and
    will not miss a future plain-`JSON` column the way a dialect-specific one
    would. (`JSON` subclasses neither `String` nor `Text`, so it genuinely
    needs its own clause rather than riding along with the text one.)

    A served field with no matching mapped column (a computed/derived Pydantic
    field, or one whose attribute isn't a column at all) has no type to judge
    and is left filterable — the same permissive default the rest of this
    derivation takes.
    """
    attribute = getattr(model, field_name, None)
    column_type = getattr(attribute, "type", None)
    return isinstance(column_type, Text | JSON)


def _is_filterable(
    config: CrudEntityConfig,
    name: str,
    info: Any,
    explicit_filter_fields: set[str],
) -> bool:
    """ADR-0072's per-field `filterable` decision, in one place.

    Extracted (merge of ADR-0072 with ADR-0074/0076, 2026-09-15) so that
    `derive_entity_schema`'s `fields[].filterable`/`filterFields` and
    `derive_filter_fields` — which `make_crud_router` needs at *module import*
    time, where the full schema is unreachable (see `derive_sortable_fields`)
    — are the same derivation rather than two copies of the same three clauses.

    ANDed, in decreasing generality: the structural rule (a column whose value
    nobody can type an exact match for is never filterable — because
    `long_text` promoted its derived type, or because the model column is
    `Text`/`JSON`, see `_is_unfilterable_column`), the per-field override, and
    the per-entity narrowing tuple.
    """
    meta = config.field_meta.get(name, FieldMeta())
    field_type, _ = _field_type_and_values(info.annotation)
    if meta.ref_entity:
        field_type = "fk"
    if meta.long_text:
        field_type = "text"
    unfilterable = field_type == "text" or _is_unfilterable_column(config.model, name)
    filterable = meta.filterable and not unfilterable
    if explicit_filter_fields:
        filterable = filterable and name in explicit_filter_fields
    return filterable


def _label_for(field_name: str) -> str:
    """`"external_ref"` -> `"External ref"` — the auto-title-cased fallback
    label, overridden per-field by `FieldMeta.label` where a hand-picked
    label doesn't match this pattern (e.g. `"project_id"` -> "Project", not
    "Project id")."""
    return field_name.replace("_", " ").capitalize()


def _derived_fields(config: CrudEntityConfig) -> tuple[dict[str, Any], dict[str, Any], set[str]]:
    """The `(all_fields, writable_fields, required_fields)` triple every
    schema-derived view of an entity starts from.

    Factored out of `derive_entity_schema` so `derive_entity_relations`
    (ADR-0074) can ask "which fields does this entity's schema actually
    serve?" without either re-deriving the whole schema (O(n^2) across the
    registry) or reading `config.field_meta` directly — the latter would be
    wrong, because a `FieldMeta` entry naming a field that no schema actually
    carries is silently ignored here and must stay ignored there too.
    """
    writable_schemas = [s for s in (config.create_schema, config.update_schema) if s is not None and s is not NoSchema]
    writable_fields: dict[str, Any] = {}
    required_fields: set[str] = set()
    for schema in writable_schemas:
        for name, info in schema.model_fields.items():
            writable_fields.setdefault(name, info)
            if schema is config.create_schema and info.is_required():
                required_fields.add(name)

    all_fields: dict[str, Any] = dict(writable_fields)
    for name, info in config.summary_schema.model_fields.items():
        if name == "id":
            continue
        all_fields.setdefault(name, info)

    # ADR-0053 Amendment 1 — see `CrudEntityConfig.field_order`. Order-only:
    # named fields lead, in the order given; everything else keeps its derived
    # position after them, so a field nobody remembered to name is still served.
    if config.field_order:
        ordered = {name: all_fields[name] for name in config.field_order if name in all_fields}
        for name, info in all_fields.items():
            ordered.setdefault(name, info)
        all_fields = ordered

    return all_fields, writable_fields, required_fields


def derive_sortable_fields(config: CrudEntityConfig) -> frozenset[str]:
    """Which of this entity's fields `?sort=` may target — the same answer
    `derive_entity_schema`'s own `sortable` flags give, derived without
    building the whole schema.

    Exists because `make_crud_router` needs this at *module import* time,
    where `derive_entity_schema` is unreachable: since ADR-0074 that function
    resolves `relations` from the entity registry, and the registry is itself
    mid-import at that moment (it imports the route modules that call this
    factory). `tests/unit/test_adr74_entity_relations.py` asserts the two stay
    in agreement for every registered entity, so this is a second *derivation*
    of one fact, never a second hand-kept list.
    """
    all_fields, _, _ = _derived_fields(config)
    return frozenset(name for name in all_fields if config.field_meta.get(name, FieldMeta()).sortable)


def derive_filter_fields(config: CrudEntityConfig) -> tuple[str, ...]:
    """Which columns `?<name>=` may target — the same answer
    `derive_entity_schema`'s own `filterFields` key gives, derived without
    building the whole schema.

    Exists for exactly the reason `derive_sortable_fields` does (see its
    docstring): `make_crud_router` needs this at *module import* time, and
    since ADR-0074 the full schema resolves `relations` from the entity
    registry, which is itself mid-import at that moment. Both functions share
    `_is_filterable`/`_derived_fields` with the schema route, so this is a
    second *derivation* of one fact, never a second hand-kept list —
    `tests/unit/test_adr74_entity_relations.py` pins the agreement.
    """
    all_fields, _, _ = _derived_fields(config)
    explicit_filter_fields = set(config.filter_fields)
    return tuple(
        name for name, info in all_fields.items() if _is_filterable(config, name, info, explicit_filter_fields)
    )


def derive_entity_schema(
    config: CrudEntityConfig,
    all_configs: Mapping[str, CrudEntityConfig] | None = None,
) -> dict[str, Any]:
    """ADR-0053: the `GET /entities/{resource}/schema` response body for one
    entity — the single source of truth `EntityListPage`/`EntityFormPage`/
    `EntityTable`/`EntityForm` fetch instead of importing a static
    `frontend/src/entityConfigs/<entity>.ts`.

    Field-shape source: the **union** of `create_schema` (if any),
    `update_schema` (if not `NoSchema`), and `summary_schema` (always
    present, minus `id`) — matching declaration order, writable schemas
    first. A field present only in `summary_schema` (e.g. `created_at`) is
    marked `readOnly: true`, mirroring `FieldConfig.readOnly`'s existing
    frontend contract (table/display only, never part of a submitted
    payload). `required` is `True` only for a field required by
    `create_schema` specifically — the same "only ever supplied via
    `Update*Request` isn't marked required" posture `FieldConfig.required`'s
    own frontend doc comment already establishes.

    **ADR-0074** adds a tenth key, `relations` — see
    `derive_entity_relations`. `all_configs` defaults to the real registry,
    imported lazily because `entity_registry` imports *this* module at load
    time; deferring it to call time (long after both modules are loaded)
    keeps that one-way. The parameter exists so a unit test can inject a
    synthetic registry, and so both callers of this function — the REST route
    and the MCP `describe` tool — keep serving byte-identical bodies without
    either having to remember to pass anything.
    """
    if all_configs is None:
        from app.api.entity_registry import ALL_ENTITY_CONFIGS

        all_configs = ALL_ENTITY_CONFIGS

    all_fields, writable_fields, required_fields = _derived_fields(config)

    # ADR-0072: an explicit `filter_fields` tuple NARROWS the derived set (see
    # `CrudEntityConfig.filter_fields`'s own docstring). Empty (every config in
    # this repo) leaves the derivation alone.
    explicit_filter_fields = set(config.filter_fields)

    fields_out: list[dict[str, Any]] = []
    for name, info in all_fields.items():
        meta = config.field_meta.get(name, FieldMeta())
        field_type, enum_values = _field_type_and_values(info.annotation)
        if meta.ref_entity:
            field_type = "fk"
        if meta.long_text:
            field_type = "text"

        # ADR-0072. Deriving this — rather than writing 27 hand-kept
        # `filterable=False` entries — is what makes "which columns can be
        # filtered" a derivation instead of a second list to keep in sync
        # (ADR-0053's posture, applied to filters). See `_is_filterable` for
        # the clauses; it is shared with `derive_filter_fields` so the schema
        # this route serves and the `?<name>=` params it accepts cannot drift.
        filterable = _is_filterable(config, name, info, explicit_filter_fields)

        entry: dict[str, Any] = {
            "name": name,
            "label": meta.label or _label_for(name),
            "type": field_type,
            "required": meta.required if meta.required is not None else name in required_fields,
            "showInTable": meta.show_in_table,
            "sortable": meta.sortable,
            "filterable": filterable,
        }
        if field_type == "enum" and enum_values:
            entry["values"] = enum_values
        if field_type == "fk":
            entry["refEntity"] = meta.ref_entity
            entry["labelField"] = meta.label_field
            if meta.select:
                entry["select"] = True
        if field_type == "enum" and enum_values:
            # Per-field override, else the shared palette — then filtered to
            # this field's own values, so a field never advertises a colour
            # for a value it cannot hold. Omitted entirely when nothing
            # matches (`EntryExitCriteria.type`, `TestLog.event_type`), which
            # is how the frontend's plain-grey default stays in play.
            palette = meta.badge_colors if meta.badge_colors is not None else ENUM_BADGE_COLORS
            badge_colors = {value: palette[value] for value in enum_values if value in palette}
            if badge_colors:
                entry["badgeColors"] = badge_colors
        elif meta.badge_colors:
            entry["badgeColors"] = meta.badge_colors
        if name not in writable_fields:
            entry["readOnly"] = True
        fields_out.append(entry)

    scope_field = list(config.scope_field) if isinstance(config.scope_field, tuple) else config.scope_field

    def _serialize_scope_selector_option(option: ScopeSelectorOption) -> dict[str, Any]:
        out: dict[str, Any] = {"refEntity": option.ref_entity, "paramName": option.param_name}
        if option.label:
            out["label"] = option.label
        if option.via is not None:
            out["via"] = _serialize_scope_selector_option(option.via)
        if option.select:
            out["select"] = True
        if option.label_field:
            out["labelField"] = option.label_field
        return out

    scope_selector: Any = None
    if isinstance(config.scope_selector, tuple):
        scope_selector = [_serialize_scope_selector_option(o) for o in config.scope_selector]
    elif config.scope_selector is not None:
        scope_selector = _serialize_scope_selector_option(config.scope_selector)

    # ADR-0076 — see `LinkCreateAction`. Serialized camelCase like every other
    # key here; `None` for the 23 non-link entities.
    link_create: dict[str, Any] | None = None
    if config.link_create is not None:
        link_create = {
            "pathTemplate": config.link_create.path_template,
            "permission": config.link_create.permission,
        }

    # ADR-0077 — `link_create`'s mirror, serialized the same way.
    link_delete: dict[str, Any] | None = None
    if config.link_delete is not None:
        link_delete = {
            "pathTemplate": config.link_delete.path_template,
            "permission": config.link_delete.permission,
        }

    # ADR-0078 — `link_create`'s directional companion. Serialized as a LIST,
    # always present (`[]` for every entity that declares none), so a client
    # reads "no compound create for this direction" off a `find` that misses
    # rather than off the key's absence — the same posture ADR-0077 took for
    # `linkDelete`'s `null`.
    compound_creates: list[dict[str, Any]] = [
        {
            "farField": action.far_field,
            "pathTemplate": action.path_template,
            "permission": action.permission,
            "linksAutomatically": action.links_automatically,
            "parentEntity": action.parent_entity,
            "parentLabel": action.parent_label,
            "parentLabelField": action.parent_label_field,
            "parentFilters": {name: value for name, value in action.parent_filters},
            "parentSelect": action.parent_select,
        }
        for action in config.compound_creates
    ]

    # ADR-0079: `compound_creates`' own serialization, verbatim shape, for the
    # sibling field. Two lists rather than one merged list because the two
    # mean different things to the client — see `child_compound_creates`'s own
    # docstring for why they cannot share a matching key.
    child_compound_creates: list[dict[str, Any]] = [
        {
            "farField": action.far_field,
            "pathTemplate": action.path_template,
            "permission": action.permission,
            "linksAutomatically": action.links_automatically,
            "parentEntity": action.parent_entity,
            "parentLabel": action.parent_label,
            "parentLabelField": action.parent_label_field,
            "parentFilters": {name: value for name, value in action.parent_filters},
            "parentSelect": action.parent_select,
        }
        for action in config.child_compound_creates
    ]

    scope_resolution: dict[str, Any] | None = None
    if config.scope_resolution is not None:
        scope_resolution = {
            "fromRouteParam": config.scope_resolution.from_route_param,
            "viaEntity": config.scope_resolution.via_entity,
            "viaField": config.scope_resolution.via_field,
        }

    return {
        "resource": config.resource,
        "label": config.label or _display_name(config.resource),
        "methods": sorted(config.full_methods or config.methods),
        "scopeField": scope_field,
        "scopeSelector": scope_selector,
        "scopeResolution": scope_resolution,
        "searchFields": list(config.search_fields),
        # ADR-0072: DERIVED, never `list(config.filter_fields)` — the one
        # source of truth is the per-field `filterable` flag computed just
        # above, so this list and `fields[].filterable` can never disagree.
        "filterFields": [entry["name"] for entry in fields_out if entry["filterable"]],
        "fields": fields_out,
        "relations": derive_entity_relations(config, all_configs),
        # ADR-0076: an eleventh key, `null` for every entity that isn't a link
        # table. Rides the same schema request ADR-0074's `relations` already
        # does — a relationship tab has this entity's schema in hand before it
        # can render a row, so a "Link existing ..." action costs no extra
        # round trip, and the MCP `describe` tool gets it for free.
        "linkCreate": link_create,
        # ADR-0077: a twelfth key, and `linkCreate`'s exact mirror — `null` for
        # every entity that isn't a link table, present unconditionally for the
        # same reason (a client reads "no unlink action" off the *value*, never
        # off the key's absence, so an older backend and a non-link entity stay
        # distinguishable).
        "linkDelete": link_delete,
        # ADR-0078: a thirteenth key. Empty for the 23 non-link entities AND
        # for the three junctions whose every direction's far entity already
        # has a generic `create` — a relationship tab asks "is there a compound
        # create for THIS direction", never "is this a link table".
        "compoundCreates": compound_creates,
        # ADR-0079: a fourteenth key, `compoundCreates`' one-to-many sibling.
        "childCompoundCreates": child_compound_creates,
    }


# --- relationship derivation (ADR-0074) ----------------------------------------------------------


def fk_fields_of(config: CrudEntityConfig) -> dict[str, str]:
    """`{field_name: ref_entity}` for every FK the entity's schema serves.

    Keyed off `_derived_fields` rather than `config.field_meta` for the reason
    that helper's own docstring gives — a `FieldMeta(ref_entity=...)` entry
    naming a field no schema carries is inert in `derive_entity_schema`, and
    must be equally inert here.
    """
    all_fields, _, _ = _derived_fields(config)
    return {
        name: meta.ref_entity
        for name, meta in config.field_meta.items()
        if meta.ref_entity and name in all_fields
    }


def is_link_entity(config: CrudEntityConfig) -> bool:
    """Is this config one of ADR-0005's dedicated join tables?

    Decided **structurally**, never by table name: exactly two FK fields, and
    no `create`/`update` in its REST surface. That is the literal shape
    `app/models/trace.py`'s own docstring describes ("two FK columns... links
    are immutable — delete-and-recreate, never edited"), so an entity that
    genuinely has it *is* a link table whatever it is called.

    It also excludes the near-misses deliberately: `TestExecution` has two FKs
    but a real `update`; `RoleAssignment` has two FKs but a real `update` and
    no `list` at all; `RiskItem` has two FKs but a real `create`.
    `tests/unit/test_adr74_entity_relations.py` pins this classifier against
    the `*_link` naming convention in both directions, so a future entity that
    drifts into (or out of) this shape fails loudly rather than silently
    gaining or losing a many-to-many tab.
    """
    methods = config.full_methods or config.methods
    return len(fk_fields_of(config)) == 2 and not ({"create", "update"} & methods)


def derive_entity_relations(
    config: CrudEntityConfig,
    all_configs: Mapping[str, CrudEntityConfig],
) -> list[dict[str, Any]]:
    """ADR-0074: the *inbound* relationships of `config` — every place some
    **other** entity points at this one — as the detail page's relationship
    tabs.

    Deliberately inbound-only. A field of this entity that points at a parent
    (`Requirement.project_id`) is a many-to-**one**; it already renders as a
    labelled value on the Info tab and would be a tab listing exactly one row.

    Two kinds, both discovered by walking `all_configs` — there is no
    hand-authored per-entity map anywhere, which is what keeps this complete
    by construction (`backend/CLAUDE.md`'s registry-completeness note: the
    only registry that cannot silently omit a row is one nobody types):

    - **one-to-many** — another entity `C` has an FK field pointing here.
    - **many-to-many** — a link entity (`is_link_entity`) has one FK pointing
      here; its *other* FK names the far entity the tab is really about.

    A candidate is only emitted when the generic list route can actually
    serve it: `C` must register `list`, and the FK must be `C`'s own
    `scope_field` (or one arm of a branching 2-tuple one), because
    `extract_scope_value` 422s a list request that doesn't carry exactly one
    scope value. An FK that is merely a `filter_field` is *not* enough — the
    caller would still owe the unrelated scope value, which a detail page for
    a different entity has no way to know. Every relationship excluded this
    way is enumerated, with its reason, in
    `tests/unit/test_adr74_entity_relations.py`, so the excluded set is an
    asserted partition rather than an accident.
    """
    # `ref_entity` is singular and hyphenated ("test-case"); registry keys are
    # plural ("test-cases"). Build the map from the configs themselves rather
    # than re-deriving it by string surgery, so `entry-exit-criteria` and any
    # future irregular plural come out right for free.
    plural_by_singular = {c.resource.replace("_", "-"): key for key, c in all_configs.items()}
    target = config.resource.replace("_", "-")

    def label_of(c: CrudEntityConfig) -> str:
        return c.label or _display_name(c.resource)

    relations: list[dict[str, Any]] = []
    for key, candidate in all_configs.items():
        if candidate is config:
            continue
        methods = candidate.full_methods or candidate.methods
        if "list" not in methods:
            continue
        scopes = _scope_candidates(candidate)
        fks = fk_fields_of(candidate)
        link = is_link_entity(candidate)
        for field_name, ref_entity in fks.items():
            if ref_entity != target or field_name not in scopes:
                continue
            if link:
                far_field, far_ref = next((n, r) for n, r in fks.items() if n != field_name)
                far_key = plural_by_singular.get(far_ref)
                if far_key is None:
                    # The far side isn't a registered entity (no config to
                    # label or link to). Skip rather than emit a tab that
                    # cannot resolve — `Release` is the only entity this can
                    # be today, and no link table points at it.
                    continue
                # `" (linked)"` is not decoration — it disambiguates a real
                # collision. `Requirement` reaches `TestCondition` **both**
                # ways: directly (`TestCondition.requirement_id`, REQ-3's
                # rigor path) and through `RequirementTestConditionLink`
                # (ADR-0005 traceability). Both are genuine, separately
                # listable relationships, and without the suffix the detail
                # page would show two differently-populated tabs with the
                # identical label "Test conditions". Applied to every
                # many-to-many rather than only the colliding one, so the
                # rule stays generic and the suffix reliably means "reached
                # via a traceability link" wherever it appears.
                relations.append(
                    {
                        "kind": "many-to-many",
                        "entity": key,
                        "scopeField": field_name,
                        "label": f"{label_of(all_configs[far_key])} (linked)",
                        "targetEntity": far_key,
                        "targetField": far_field,
                    }
                )
            else:
                relations.append(
                    {
                        "kind": "one-to-many",
                        "entity": key,
                        "scopeField": field_name,
                        "label": label_of(candidate),
                        "targetEntity": key,
                        "targetField": None,
                    }
                )

    # Direct children first, then the traceability links, each alphabetical —
    # a stable order so the tab strip doesn't reshuffle between deploys and so
    # every assertion about it can be written positionally.
    relations.sort(key=lambda r: (r["kind"] != "one-to-many", r["label"], r["entity"]))
    return relations


# --- the factory itself -----------------------------------------------------------------------


def make_crud_router(config: CrudEntityConfig) -> APIRouter:
    """Build an `APIRouter` registering whichever of `config.methods` are configured.

    See this module's own docstring for the shared gating/resolution
    behavior every route below shares.
    """
    router = APIRouter()
    resource = config.resource
    model = config.model
    path = _resource_path(resource)
    display_name = _display_name(resource)
    list_response_schema = _build_list_response_schema(config.summary_schema) if "list" in config.methods else None

    async def _fetch_and_gate(
        db: AsyncSession, actor: User | AIAgent, item_id: uuid.UUID, action: str
    ) -> tuple[Any, JSONResponse | None]:
        """Fetch `model` row `item_id`, resolve its org, apply the 404-vs-403 boundary.

        Shared by `get`/`update`/`delete` — only `action` (`"read"`/
        `"update"`/`"delete"`) differs between call sites, both for the
        `{resource}.{action}` permission code and for whether a `None`
        `resolve_org_id` result falls back to `has_permission_in_any_org`
        (see this module's own docstring on `is_global_catalog`/
        `global_read_fallback`).
        """
        row = await db.get(model, item_id)
        if row is None:
            return None, _error(404, "not_found", f"{display_name} not found.")

        org_id = await config.resolve_org_id(db, row)
        if org_id is None:
            if config.is_global_catalog or (action == "read" and config.global_read_fallback):
                if not await has_permission_in_any_org(actor, f"{resource}.{action}"):
                    return None, _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)
                return row, None
            return None, _error(404, "not_found", f"{display_name} not found.")

        if not await _actor_membership_exists(db, org_id, actor):
            return None, _error(404, "not_found", f"{display_name} not found.")
        if not await has_permission(actor, str(org_id), f"{resource}.{action}"):
            return None, _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

        return row, None

    async def _resolve_scope_for_write(
        db: AsyncSession, actor: User | AIAgent, data: Mapping[str, Any], action: str
    ) -> JSONResponse | None:
        """Shared `create`/list-scope gate: resolve+404-vs-403+permission on the scope value.

        Returns an error `JSONResponse` if any check fails, `None` if the
        caller may proceed. `data` supplies the scope field's already-parsed
        value (a real `UUID`, not a query string — `list`'s caller parses the
        raw query-string value into a `UUID` itself first, see `list_items`).
        """
        scope = extract_scope_value(config, data)
        if scope is None:
            return scope_validation_error(config, data)
        field_name, raw_value = scope
        org_id = await config.resolve_org_id(db, types.SimpleNamespace(**{field_name: raw_value}))
        if org_id is None or not await _actor_membership_exists(db, org_id, actor):
            return _error(404, "not_found", f"{display_name} not found.")
        if not await has_permission(actor, str(org_id), f"{resource}.{action}"):
            return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)
        return None

    # --- list -----------------------------------------------------------------------------

    if "list" in config.methods:
        assert list_response_schema is not None
        # ADR-0053 (sort): computed once at router-build time from this
        # config's own derived field set — the single source of truth for
        # which columns are sortable is the same derivation the `GET
        # /entities/{resource}/schema` route serves, not a second hand-kept
        # list (the exact drift ADR-0053 already exists to close).
        #
        # ADR-0072 (filter): `filter_fields` is derived the same way, for the
        # same reason — the columns this route accepts as `?<name>=` are
        # exactly the ones its own schema advertises in `filterFields`.
        #
        # ADR-0074: both read the standalone `derive_sortable_fields`/
        # `derive_filter_fields` rather than `derive_entity_schema(config)` —
        # they agree with the schema by construction (there is a test pinning
        # that, and they share `_derived_fields`/`_is_filterable` with it), but
        # the full schema now also derives `relations`, which needs the whole
        # registry, and this line runs at *module import* time, from inside the
        # very route modules `entity_registry` is in the middle of importing.
        # Asking for the registry there is a genuine circular import, not a
        # lazy-import ordering nit.
        sortable_fields = derive_sortable_fields(config)
        filter_fields: tuple[str, ...] = derive_filter_fields(config)

        async def list_items(
            request: Request,
            page: int = 1,
            page_size: int = _DEFAULT_PAGE_SIZE,
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> BaseModel | JSONResponse:
            query_params = request.query_params
            query = select(model)

            if config.scope_field is None:
                if not await has_permission_in_any_org(actor, f"{resource}.read"):
                    return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)
            else:
                scope = extract_scope_value(config, query_params)
                if scope is None:
                    return scope_validation_error(config, query_params)
                field_name, raw_value = scope
                try:
                    scope_uuid = uuid.UUID(str(raw_value))
                except (ValueError, TypeError, AttributeError):
                    return _error(
                        422,
                        "validation_error",
                        "Request failed validation.",
                        field_errors={field_name: ["must be a valid UUID"]},
                    )
                error = await _resolve_scope_for_write(db, actor, {field_name: scope_uuid}, "read")
                if error is not None:
                    return error
                query = query.where(getattr(model, field_name) == scope_uuid)

            try:
                query = apply_filters_and_search(query, model, filter_fields, config.search_fields, query_params)
            except ValueError as exc:
                # ADR-0072. Same envelope as the `?sort=` rejection below —
                # `422 validation_error` + a `field_errors` entry keyed by the
                # offending query param (here the column name itself, since a
                # filter param IS its column's name).
                bad_field = exc.args[0] if exc.args else ""
                return _error(
                    422,
                    "validation_error",
                    "Request failed validation.",
                    field_errors={
                        bad_field: [f"'{query_params.get(bad_field)}' is not a valid value for '{bad_field}'"]
                    },
                )

            sort_param = query_params.get("sort")
            if sort_param:
                try:
                    query = apply_sort(query, model, sort_param, sortable_fields)
                except ValueError as exc:
                    field_name = exc.args[0] if exc.args else ""
                    return _error(
                        422,
                        "validation_error",
                        "Request failed validation.",
                        field_errors={"sort": [f"'{field_name}' is not a sortable field"]},
                    )

            page_c, page_size_c = clamp_pagination(page, page_size)
            total = await db.scalar(select(func.count()).select_from(query.subquery()))
            result = await db.execute(query.offset((page_c - 1) * page_size_c).limit(page_size_c))
            rows = result.scalars().all()

            return list_response_schema(
                items=[_to_summary(config, row) for row in rows],
                total=total or 0,
                page=page_c,
                page_size=page_size_c,
            )

        router.add_api_route(f"/{path}", list_items, methods=["GET"], response_model=list_response_schema)

    # --- get ------------------------------------------------------------------------------

    if "get" in config.methods:

        async def get_item(
            id: uuid.UUID,
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> BaseModel | JSONResponse:
            row, error = await _fetch_and_gate(db, actor, id, "read")
            if error is not None:
                return error
            return _to_summary(config, row)

        router.add_api_route(f"/{path}/{{id}}", get_item, methods=["GET"], response_model=config.summary_schema)

    # --- create -----------------------------------------------------------------------------

    if "create" in config.methods and config.create_schema is not None:
        CreateSchema = config.create_schema

        async def create_item(
            payload: CreateSchema,  # type: ignore[valid-type]
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> BaseModel | JSONResponse:
            data = payload.model_dump(exclude_none=True)

            if config.scope_field is None:
                if not await has_permission_in_any_org(actor, f"{resource}.create"):
                    return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)
            else:
                error = await _resolve_scope_for_write(db, actor, data, "create")
                if error is not None:
                    return error

            for stamped_field in _ACTOR_STAMPED_FIELDS:
                if hasattr(model, stamped_field) and stamped_field not in data:
                    data[stamped_field] = actor.actor_id

            row = model(**data)
            db.add(row)
            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                return _error(422, "validation_error", "Request failed validation.")

            await db.commit()
            await db.refresh(row)
            return _to_summary(config, row)

        router.add_api_route(
            f"/{path}", create_item, methods=["POST"], response_model=config.summary_schema, status_code=201
        )

    # --- update -----------------------------------------------------------------------------

    if "update" in config.methods:
        UpdateSchema = config.update_schema

        async def update_item(
            id: uuid.UUID,
            payload: UpdateSchema,  # type: ignore[valid-type]
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> BaseModel | JSONResponse:
            row, error = await _fetch_and_gate(db, actor, id, "update")
            if error is not None:
                return error

            updates = payload.model_dump(exclude_unset=True)

            # PLAN-1/ADR-0031: entity-specific business-rule check, if the
            # config supplies one. Ordering is deliberate and load-bearing:
            # this runs *after* `_fetch_and_gate` (so a caller outside the
            # row's org still gets the NFR-1 `404` — a `409` here would
            # confirm the row exists across a tenant boundary) and *before*
            # any `setattr` (so a rejected request mutates nothing, not even
            # in the session's identity map).
            if config.update_guard is not None:
                guard_error = config.update_guard(row, updates)
                if guard_error is not None:
                    return guard_error

            # EXEC-2: capture pre-mutation values only for fields actually
            # being updated, before `setattr` overwrites them — the hook
            # (if any) needs the "from" side of a change (e.g. old `result`).
            old_values = {f: getattr(row, f) for f in updates} if config.post_update_hook is not None else {}

            for field_name, value in updates.items():
                setattr(row, field_name, value)

            if config.post_update_hook is not None:
                await config.post_update_hook(row, old_values, updates, actor, db)

            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                return _error(422, "validation_error", "Request failed validation.")

            await db.commit()
            await db.refresh(row)
            return _to_summary(config, row)

        router.add_api_route(
            f"/{path}/{{id}}", update_item, methods=["PATCH"], response_model=config.summary_schema
        )

    # --- delete -----------------------------------------------------------------------------

    if "delete" in config.methods:

        async def delete_item(
            id: uuid.UUID,
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> Response | JSONResponse:
            row, error = await _fetch_and_gate(db, actor, id, "delete")
            if error is not None:
                return error

            await db.delete(row)
            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                return _error(
                    409,
                    "restrict_blocked",
                    "This item cannot be deleted while other records still reference it.",
                )

            await db.commit()
            return Response(status_code=204)

        router.add_api_route(
            f"/{path}/{{id}}", delete_item, methods=["DELETE"], status_code=204, response_model=None
        )

    return router


def get_crud_handlers(config: CrudEntityConfig) -> dict[str, Any]:
    """MCP-5/ADR-0065: the generic-entity route handler closures for `config`,
    keyed by CRUD verb (`"list"`/`"get"`/`"create"`/`"update"`/`"delete"`) —
    only whichever verbs `config.methods` actually registers are present.

    Builds a throwaway `APIRouter` via `make_crud_router(config)` (never
    `include_router`-ed into the FastAPI app — `make_crud_router` has no
    side effect beyond constructing local closures and calling
    `router.add_api_route` on that one new router instance, so building a
    second one purely to introspect it is safe) and reads the exact
    `APIRoute.endpoint` object FastAPI would otherwise dispatch to. This is
    the *same* handler function the real REST route calls — not a second,
    reimplemented copy — so `app/mcp/tool_registry.py`'s generic tools
    reuse it the same "direct-call dispatch" way `app/mcp/tools/entity_tools.py`
    (MCP-1) already established for the bespoke routes: pass `actor=`/`db=`
    explicitly, bypassing the `Depends(get_current_actor)`/`Depends(get_db)`
    defaults without invoking their dependency bodies.

    `list`'s handler still declares `request: Request` (for `.query_params`,
    the one thing `list_items` reads off it) — callers needing to invoke it
    directly pass any object exposing a `.query_params` mapping (e.g.
    `types.SimpleNamespace(query_params={...})`), not a real Starlette
    `Request`; nothing else on `request` is ever touched.
    """
    router = make_crud_router(config)
    path = _resource_path(config.resource)
    handlers: dict[str, Any] = {}
    for route in router.routes:
        methods = getattr(route, "methods", None) or set()
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None:
            continue
        if route.path == f"/{path}" and "GET" in methods:
            handlers["list"] = endpoint
        elif route.path == f"/{path}/{{id}}" and "GET" in methods:
            handlers["get"] = endpoint
        elif route.path == f"/{path}" and "POST" in methods:
            handlers["create"] = endpoint
        elif route.path == f"/{path}/{{id}}" and "PATCH" in methods:
            handlers["update"] = endpoint
        elif route.path == f"/{path}/{{id}}" and "DELETE" in methods:
            handlers["delete"] = endpoint
    return handlers


__all__ = [
    "CrudEntityConfig",
    "NoSchema",
    "apply_filters_and_search",
    "apply_sort",
    "branching_resolver",
    "chain_resolver",
    "clamp_pagination",
    "coerce_filter_value",
    "extract_scope_value",
    "get_crud_handlers",
    "make_crud_router",
    "resolve_global_org_id",
    "resolve_organization_org_id",
    "resolve_risk_item_org_id",
    "resolve_terminal_org_id",
    "resolve_test_case_org_id",
    "resolve_via_test_case",
    "scope_validation_error",
]
