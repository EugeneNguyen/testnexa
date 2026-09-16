"""ADR-0081 — `ScopeSelectorOption.via`: closing the two-hop scope-selector gap.

Covers TC-ADMIN-139 (the three real `via` declarations are shaped correctly)
and TC-ADMIN-140 (the entities that don't need `via` still don't declare
one).

Pure-Python, no DB/network.

## What this file is actually for

`components/molecules/scope-selector/scope-selector.tsx`'s own long-standing
docstring documented, but did not fix, a real gap: `FkAutocomplete`'s search
inside a `ScopeSelector` step 422s (silently, swallowed to an empty result)
whenever the picked entity's own `list` route needs a scope param this
page's route context doesn't already supply — `TestCycle` needs
`test_plan_id`, `TestExecution` needs `test_case_id`/`test_cycle_id`. A CTO
live click-through on `/admin/test-cycles`, `/admin/test-executions`,
`/admin/defects`, `/admin/test-logs` found exactly this: the picker never
found anything to select, no matter what was typed.

`ScopeSelectorOption.via` names a second, earlier pick to thread in as an
extra search param. This file asserts the three real declarations are
internally consistent — the oracle is the via-entity's OWN `scope_field`,
never assumed.
"""

from __future__ import annotations

from app.api.crud_factory import ScopeSelectorOption
from app.api.entity_registry import ALL_ENTITY_CONFIGS


def _options_of(key: str) -> list[ScopeSelectorOption]:
    selector = ALL_ENTITY_CONFIGS[key].scope_selector
    if selector is None:
        return []
    return list(selector) if isinstance(selector, tuple) else [selector]


# --- TC-ADMIN-139: the three real `via` declarations are internally consistent ------------------


def test_test_executions_by_test_cycle_option_declares_via_test_plan() -> None:
    option = next(o for o in _options_of("test-executions") if o.ref_entity == "test-cycle")
    assert option.via is not None
    assert option.via.ref_entity == "test-plan"
    assert option.via.param_name == "test_plan_id"


def test_test_executions_by_test_case_option_needs_no_via() -> None:
    """`TestCase`'s own list is `project_id`-scoped directly — already
    reachable from any project-scoped admin page, no second hop needed."""
    option = next(o for o in _options_of("test-executions") if o.ref_entity == "test-case")
    assert option.via is None


def test_defects_scope_selector_declares_via_test_case() -> None:
    (option,) = _options_of("defects")
    assert option.ref_entity == "test-execution"
    assert option.via is not None
    assert option.via.ref_entity == "test-case"
    assert option.via.param_name == "test_case_id"


def test_test_logs_scope_selector_declares_via_test_case() -> None:
    (option,) = _options_of("test-logs")
    assert option.ref_entity == "test-execution"
    assert option.via is not None
    assert option.via.ref_entity == "test-case"
    assert option.via.param_name == "test_case_id"


def test_every_via_param_name_is_a_real_scope_field_of_the_outer_ref_entity() -> None:
    """The load-bearing structural check, and easy to get backwards (caught
    doing exactly that while writing this test): `via.param_name` is the
    field the OUTER option's own `ref_entity` needs on ITS list route —
    `test-cycle` needs `test_plan_id`, not the via entity (`test-plan`)
    needing anything from itself. A `via` naming the wrong entity's own
    scope requirement would silently reproduce the exact bug this ADR
    closes, one level removed — the outer picker would still 422/find
    nothing, now with an extra, useless picker step in front of it.

    `ScopeSelectorOption.ref_entity` is the hyphenated singular the frontend's
    `FkAutocomplete` searches (`"test-cycle"`), while `ALL_ENTITY_CONFIGS` is
    keyed by the plural route slug (`"test-cycles"`) — `+"s"` is the exact
    same mechanical mapping the frontend's own `resolveEntityKey` applies.
    """
    for key in ("test-executions", "defects", "test-logs"):
        for option in _options_of(key):
            if option.via is None:
                continue
            outer_config = ALL_ENTITY_CONFIGS[f"{option.ref_entity}s"]
            outer_scope_field = outer_config.scope_field
            outer_scope_fields = outer_scope_field if isinstance(outer_scope_field, tuple) else (outer_scope_field,)
            assert option.via.param_name in outer_scope_fields


def test_every_via_target_entity_needs_no_via_of_its_own() -> None:
    """Every declared `via` today is exactly one level deep (`docs/adr/0081`'s
    own stated scope) — asserted rather than assumed, so a future entity
    needing a genuine three-hop chain is a visible new decision, not a
    silent extension of this one."""
    for key in ("test-executions", "defects", "test-logs"):
        for option in _options_of(key):
            if option.via is None:
                continue
            via_config = ALL_ENTITY_CONFIGS[f"{option.via.ref_entity}s"]
            via_config_scope_field = via_config.scope_field
            # `test-plan`/`test-case` are both `project_id`-scoped — a value
            # every project-scoped admin route already has in context, so
            # neither needs its own `via` to be searchable.
            assert via_config_scope_field == "project_id"
            assert via_config.scope_selector is None


# --- TC-ADMIN-140: entities that don't need `via` still don't declare one -----------------------


def test_one_hop_entities_declare_no_via() -> None:
    """`TestPlan`/`Requirement` (via `entry-exit-criteria`/`test-cycles`/
    `risk-items`'s own scope selectors) are `project_id`-scoped directly —
    a future change spuriously adding `via` here would add an unnecessary
    picker step for an entity that never needed one."""
    for key in ("entry-exit-criteria", "test-cycles", "risk-items"):
        for option in _options_of(key):
            assert option.via is None
