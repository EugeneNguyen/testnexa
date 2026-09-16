"""ADR-0075 Amendment 1: every n-n junction is scoped from BOTH ends.

Six junction tables had a single-column `scope_field`, so ADR-0074's
`derive_entity_relations` emitted a relation for that one side only — e.g.
`TestSuite` got a "Test cases (linked)" tab while `TestCase` got nothing for
the identical, genuinely bidirectional relationship, and `Defect`'s detail
page rendered no tab strip at all. Amendment 1 widens all six to the branching
2-tuple shape `RiskItem` has always used.

**Why this file exists separately from `test_adr74_entity_relations.py`.** That
file asserts the *derivation's* output — which relations are emitted. It cannot
see the half of this change that actually decides whether a tab renders data or
a `404`: the **resolver**. A branching `scope_field` and a single-arm
`resolve_org_id` type-check fine, derive a perfectly good relation, and then
404 every request scoped by the new arm, because
`crud_factory._resolve_scope_for_write` calls `resolve_org_id` with a
`types.SimpleNamespace` carrying **only the one attribute the caller actually
supplied** — never a real row with both FKs populated. A test that hands the
resolver a full two-FK row would pass against the broken single-arm version and
prove nothing, which is the whole trap here.

So every resolver assertion below deliberately builds the **single-attribute
stand-in**, mirroring `_resolve_scope_for_write`'s own construction, rather
than a convenient full row. The mutation check
(`TestSingleArmResolverWouldRegress`) pins that this distinction is real by
running the pre-Amendment resolver shape against the same stand-in and
asserting it *fails* — so a future "simplification" back to a single-arm
resolver cannot pass this suite silently (`backend/CLAUDE.md`'s note that a
verification the framework can skip is not a verification).

Same hand-rolled fake-session convention as `tests/unit/test_crud_factory.py`,
`test_execution_trace_resolvers.py` and `test_req4_suite_membership_resolvers.py`
— no DB, no live server. The live round trips (create through the real bespoke
route, then `GET ?<reverse arm>=`) are in
`tests/integration/test_adr75_amendment1_bidirectional_junctions.py`; neither
layer substitutes for the other.
"""

import types
import uuid
from typing import Any

import pytest

from app.api.crud_factory import (
    _scope_candidates,
    branching_resolver,
    chain_resolver,
    extract_scope_value,
    fk_fields_of,
    resolve_via_test_case,
    scope_validation_error,
)
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.models.assets import Requirement, TestCase, TestCondition, TestSuite
from app.models.execution import Defect, TestExecution
from app.models.planning import TestCycle, TestPlan
from app.models.project import Project

#: The six junctions, each with the arm that was its sole `scope_field` before
#: Amendment 1 ("original") and the arm the amendment added ("reverse").
JUNCTIONS: list[tuple[str, str, str]] = [
    ("requirement-test-case-links", "requirement_id", "test_case_id"),
    ("requirement-test-condition-links", "requirement_id", "test_condition_id"),
    ("test-condition-test-case-links", "test_condition_id", "test_case_id"),
    ("test-case-defect-links", "test_case_id", "defect_id"),
    ("test-suite-test-cases", "test_suite_id", "test_case_id"),
    ("test-plan-test-suites", "test_plan_id", "test_suite_id"),
]


class _FakeSession:
    """`db.get` by `(model, pk)`; `db.scalar` returns from a queue, else `None`.

    Copied in shape from `test_req4_suite_membership_resolvers.py`'s fake — the
    queue matters because `resolve_test_case_org_id` can issue two different
    `scalar` lookups (the `RequirementTestCaseLink` probe, then the
    `TestSuiteTestCase` fallback) inside one call.
    """

    def __init__(
        self,
        rows: dict[tuple[type, Any], Any] | None = None,
        scalar_results: list[Any] | None = None,
    ) -> None:
        self._rows = rows or {}
        self._scalar_results = list(scalar_results or [])

    async def get(self, model: type, pk: Any) -> Any:
        return self._rows.get((model, pk))

    async def scalar(self, *_args: Any, **_kwargs: Any) -> Any:
        if not self._scalar_results:
            return None
        return self._scalar_results.pop(0)


def _row(**attrs: Any) -> Any:
    class _Row:
        pass

    r = _Row()
    for key, value in attrs.items():
        setattr(r, key, value)
    return r


def _scope_stand_in(field_name: str, value: Any) -> Any:
    """Exactly what `crud_factory._resolve_scope_for_write` hands the resolver.

    One attribute, nothing else — not a row. Built through the same
    `types.SimpleNamespace(**{field: value})` expression that function uses, so
    this cannot drift into being a friendlier object than production supplies.
    """
    return types.SimpleNamespace(**{field_name: value})


# --- the primitive ------------------------------------------------------------------------------


class TestBranchingResolverPrimitive:
    """**TC-ADMIN-078.** `branching_resolver` itself, independent of any entity."""

    async def test_first_branch_whose_attribute_is_set_wins(self) -> None:
        async def _a(_db: Any, _row: Any) -> uuid.UUID:
            return uuid.UUID(int=1)

        async def _b(_db: Any, _row: Any) -> uuid.UUID:
            return uuid.UUID(int=2)

        resolver = branching_resolver([("a_id", _a), ("b_id", _b)])
        assert await resolver(_FakeSession(), _row(a_id=uuid.uuid4(), b_id=None)) == uuid.UUID(int=1)
        assert await resolver(_FakeSession(), _row(a_id=None, b_id=uuid.uuid4())) == uuid.UUID(int=2)

    async def test_declaration_order_decides_when_a_real_row_carries_both(self) -> None:
        """The behaviour-preservation property. `_fetch_and_gate` passes a real
        link row, which always carries both FKs — so the first branch always
        fires there, and declaring the pre-Amendment arm first keeps every item
        route's (`get`) tenant walk byte-identical to what it did before."""

        async def _a(_db: Any, _row: Any) -> uuid.UUID:
            return uuid.UUID(int=1)

        async def _b(_db: Any, _row: Any) -> uuid.UUID:
            return uuid.UUID(int=2)

        both = _row(a_id=uuid.uuid4(), b_id=uuid.uuid4())
        assert await branching_resolver([("a_id", _a), ("b_id", _b)])(_FakeSession(), both) == uuid.UUID(int=1)
        assert await branching_resolver([("b_id", _b), ("a_id", _a)])(_FakeSession(), both) == uuid.UUID(int=2)

    async def test_no_branch_set_resolves_none_rather_than_guessing(self) -> None:
        """An unresolvable chain must be `None` — every caller turns that into
        `404`, never a partial or guessed org (NFR-1, same posture as
        `chain_resolver`)."""

        async def _never_called(_db: Any, _row: Any) -> uuid.UUID:  # pragma: no cover
            raise AssertionError("must not be reached")

        resolver = branching_resolver([("a_id", _never_called)])
        assert await resolver(_FakeSession(), _row(a_id=None)) is None
        assert await resolver(_FakeSession(), _row()) is None

    async def test_a_missing_attribute_is_skipped_not_an_attribute_error(self) -> None:
        """The stand-in genuinely lacks the other arm's attribute — `getattr`
        with a default, not direct access, is what makes that safe."""

        async def _b(_db: Any, _row: Any) -> uuid.UUID:
            return uuid.UUID(int=7)

        resolver = branching_resolver([("a_id", _b), ("b_id", _b)])
        assert await resolver(_FakeSession(), _scope_stand_in("b_id", uuid.uuid4())) == uuid.UUID(int=7)


# --- config shape -------------------------------------------------------------------------------


class TestEveryJunctionIsScopedFromBothEnds:
    """**TC-ADMIN-078.** The config-level half: all six, not two of six.

    ADR-0075 Decision §3 rejected widening only its own two junctions because
    "doing it for two junctions and not the other four would make the rule
    incoherent." These assertions are what makes "all six" a checked fact rather
    than a claim in prose — a seventh junction added later with a single-column
    scope fails `test_every_link_entity_is_covered_by_this_files_table` below.
    """

    @pytest.mark.parametrize(("key", "original", "reverse"), JUNCTIONS)
    def test_scope_field_is_the_two_tuple_of_both_fks(self, key: str, original: str, reverse: str) -> None:
        config = ALL_ENTITY_CONFIGS[key]
        assert config.scope_field == (original, reverse)
        assert set(_scope_candidates(config)) == set(fk_fields_of(config))

    @pytest.mark.parametrize(("key", "original", "reverse"), JUNCTIONS)
    def test_the_original_arm_is_still_declared_first(self, key: str, original: str, reverse: str) -> None:
        """Order is not cosmetic. `scope_validation_error` reports
        `candidates[0]` as the field its `422` is keyed on, and the resolver's
        first branch is the one a real row takes — so putting the
        pre-Amendment arm first keeps both the error shape and the item-route
        walk stable for every existing caller."""
        assert _scope_candidates(ALL_ENTITY_CONFIGS[key])[0] == original

    @pytest.mark.parametrize(("key", "original", "reverse"), JUNCTIONS)
    def test_scope_selector_offers_one_labelled_option_per_arm(
        self, key: str, original: str, reverse: str
    ) -> None:
        """Without this the generic admin list page would still only let an
        admin scope by the old arm, so the route would serve a direction the
        UI had no way to ask for — a silent half-shipped widening."""
        selector = ALL_ENTITY_CONFIGS[key].scope_selector
        assert isinstance(selector, tuple), f"{key}: a branching scope needs a tuple of options"
        assert [o.param_name for o in selector] == [original, reverse]
        assert all(o.label for o in selector), f"{key}: each option needs a label to tell the two apart"

    def test_every_link_entity_is_covered_by_this_files_table(self) -> None:
        """The diff, not a spot check (`backend/CLAUDE.md`'s registry note):
        `JUNCTIONS` must name exactly the entities the structural classifier
        calls link tables, so a newly-registered junction cannot skip every
        assertion in this file by simply not being listed."""
        from tests.unit.test_adr74_entity_relations import EXPECTED_LINK_ENTITIES

        assert {key for key, _, _ in JUNCTIONS} == EXPECTED_LINK_ENTITIES

    async def test_every_link_entitys_resolver_actually_branches_on_both_arms(self) -> None:
        """**TC-ADMIN-078.** The structural half of "and `resolve_org_id` branches on both arms",
        asserted over *every* link entity rather than as six hand-written cases.

        The probe distinguishes a branching resolver from a single-arm one
        without needing a real database, by counting `db.get` calls: given a
        stand-in carrying only arm B, a resolver hard-coded to walk arm A finds
        no attribute, short-circuits, and issues **zero** lookups; a branching
        one enters B's branch and issues at least one before failing on the
        empty session. `resolve_via_test_case` is the one branch that reaches
        for `db.get` directly rather than through `chain_resolver`, and it
        counts the same way.

        Without this, a seventh junction could be added with a correct 2-tuple
        `scope_field` and a copy-pasted single-arm resolver, derive both
        relations, render both tabs, and 404 one of them — with every other
        assertion in this file still green.
        """

        class _CountingSession(_FakeSession):
            def __init__(self) -> None:
                super().__init__()
                self.gets = 0

            async def get(self, model: type, pk: Any) -> Any:
                self.gets += 1
                return None

        for key, original, reverse in JUNCTIONS:
            for arm in (original, reverse):
                session = _CountingSession()
                result = await _resolver(key)(session, _scope_stand_in(arm, uuid.uuid4()))
                # The empty session means every walk dead-ends, so the *result*
                # is always None — what differs is whether the walk started.
                assert result is None
                assert session.gets >= 1, (
                    f"{key}: resolve_org_id issued no lookup for the {arm} arm — it does not "
                    f"branch on that arm, so every list request scoped by it will 404"
                )

    def test_no_junction_gained_a_write_method(self) -> None:
        """Amendment 1 widens *reads* only. A junction that picked up
        `create`/`update` would also stop classifying as a link table, silently
        losing both its tabs."""
        for key, _, _ in JUNCTIONS:
            config = ALL_ENTITY_CONFIGS[key]
            assert sorted(config.full_methods or config.methods) == ["get", "list"]
            assert config.create_schema is None


# --- the resolvers, via the single-attribute stand-in ---------------------------------------------


def _resolver(key: str) -> Any:
    return ALL_ENTITY_CONFIGS[key].resolve_org_id


class TestTheNumbersTheDocsQuote:
    """**TC-ADMIN-078.** Every concrete figure ADR-0075 Amendment 1 and ADR-0074 §4 now state, pinned.

    `docs/CLAUDE.md` documents at length that a doc's own confidently-worded
    count drifts silently once nothing asserts it — the coverage-summary table
    in this repo has accumulated two separate undetected drifts that way. These
    figures are load-bearing prose in two ADRs, so they get the same treatment
    as any other claim: derived here from the real registry, never retyped.
    """

    def test_relation_and_entity_totals_match_the_adr(self) -> None:
        """ADR-0074's Consequences: "22 relationships across 9 entities" at
        ship, "30 across 10" after Amendment 1 (+2 from ADR-0075 registering the
        two junctions, +6 from making all six bidirectional; the tenth entity is
        `Defect`, which previously had no tab strip at all)."""
        from app.api.crud_factory import derive_entity_relations

        per_entity = {
            key: derive_entity_relations(config, ALL_ENTITY_CONFIGS)
            for key, config in ALL_ENTITY_CONFIGS.items()
        }
        with_tabs = {key: rels for key, rels in per_entity.items() if rels}
        assert sum(len(r) for r in with_tabs.values()) == 30
        assert len(with_tabs) == 10
        assert "defects" in with_tabs, "Defect is the tenth entity — it had no tab strip before"

    def test_the_excluded_inbound_fk_count_matches_adr_0071_section_4(self) -> None:
        """ADR-0074 §4's table: 12 as first written, 14 after ADR-0075, **8**
        after Amendment 1 struck the whole "reverse side of all 6 link tables"
        row. The eight that remain are a different kind of gap entirely —
        filter-field-only FKs, and `RoleAssignment`'s missing `list` route."""
        from tests.unit.test_adr74_entity_relations import EXPECTED_EXCLUSIONS

        assert len(EXPECTED_EXCLUSIONS) == 8
        # None of the survivors is a link table's own reverse side.
        assert not ({key for key, _ in EXPECTED_EXCLUSIONS} & EXPECTED_LINK_ENTITIES_FOR_ASSERTION())

    def test_the_exact_tab_list_of_every_entity_the_amendment_changed(self) -> None:
        """The four entities whose strips moved, each asserted as an EXACT list
        rather than a superset — `e2e/tests/admin7-entity-relation-tabs.spec.ts`
        asserts the rendered strips positionally, so a drift must fail in the
        fast layer first. `test-cases` is covered by its own dedicated test in
        `test_adr74_entity_relations.py`; the other three are only covered here."""
        from app.api.crud_factory import derive_entity_relations

        def labels(key: str) -> list[str]:
            return [r["label"] for r in derive_entity_relations(ALL_ENTITY_CONFIGS[key], ALL_ENTITY_CONFIGS)]

        assert labels("test-suites") == ["Test cases (linked)", "Test plans (linked)"]
        assert labels("test-conditions") == ["Requirements (linked)", "Test cases (linked)"]
        assert labels("defects") == ["Test cases (linked)"]
        # Unchanged by the amendment — asserted so "adds a direction, never
        # trades one" is a checked claim about the whole strip, not just the
        # two entities anyone thought to look at.
        assert labels("requirements") == [
            "Risk items",
            "Test conditions",
            "Test cases (linked)",
            "Test conditions (linked)",
        ]
        assert labels("test-plans") == [
            "Entry/exit criteria",
            "Risk items",
            "Test cycles",
            "Test suites (linked)",
        ]

    def test_no_new_permission_code_was_introduced(self) -> None:
        """Amendment 1 adds no RBAC surface and needs no migration: permission
        codes are per-*resource*, not per-direction, so all six junctions were
        already covered by the `.read` code ADR-0027 and ADR-0075 Decision §5
        seeded. Asserted rather than asserted-in-prose, because "no migration
        needed" is exactly the kind of claim that is expensive to be wrong
        about — a missing code would 403 the new tab for every role that can
        open the page.

        **ADR-0076 amends the final assertion, not the claim.** Amendment 1
        still introduces no permission code of its own — the per-*direction*
        assertions below are what actually test that, and they are untouched.
        What changed underneath is that ADR-0076 later gave the four ADR-0005
        traceability links a `.create` code each (for its own new bespoke
        link-create routes), so "exactly one code per junction resource" is no
        longer the right exact set. The assertion is narrowed rather than
        loosened to a subset check: each junction's code set must be exactly
        `.read`, plus `.create` for precisely the four ADR-0076 names, so a
        *fifth* code on any of the six still fails here.

        **ADR-0077 amends it the same way, for the same reason** — its four
        `<link>.delete` codes widen the set once more, and the assertion stays
        exact (now `.read` + `.create` + `.delete` for the four named
        resources, `.read` alone for REQ-4's/PLAN-1's two, whose own
        link/unlink routes gate on the parent's `.update` instead). Kept exact
        rather than relaxed to a subset check deliberately: the whole value of
        this test is that an *unplanned* code on a junction resource fails it,
        and every ADR that legitimately adds one pays a one-line edit here as
        the price of keeping that property.
        """
        from app.db.rbac_seed_catalog import (
            LINK_CREATE_RESOURCES,
            LINK_DELETE_RESOURCES,
            READ_ONLY_RESOURCES,
            build_permission_catalog,
        )

        codes = {code for code, _, _ in build_permission_catalog()}
        for key, original, reverse in JUNCTIONS:
            resource = ALL_ENTITY_CONFIGS[key].resource
            assert f"{resource}.read" in codes
            # Nothing per-direction may have crept in.
            assert f"{resource}.read_{original}" not in codes
            assert f"{resource}.read_{reverse}" not in codes
        for key, _, _ in JUNCTIONS:
            resource = ALL_ENTITY_CONFIGS[key].resource
            assert resource in READ_ONLY_RESOURCES
            expected = {f"{resource}.read"}
            if resource in LINK_CREATE_RESOURCES:
                expected.add(f"{resource}.create")
            # ADR-0077 — see this test's own docstring.
            if resource in LINK_DELETE_RESOURCES:
                expected.add(f"{resource}.delete")
            assert {c for c in codes if c.startswith(f"{resource}.")} == expected, resource


def EXPECTED_LINK_ENTITIES_FOR_ASSERTION() -> set[str]:
    from tests.unit.test_adr74_entity_relations import EXPECTED_LINK_ENTITIES

    return EXPECTED_LINK_ENTITIES


class TestReverseArmResolvesTheSameOrg:
    """**TC-ADMIN-078.** The half `test_adr74_entity_relations.py` structurally cannot see.

    Each test builds the org chain the *reverse* arm must walk, hands the
    resolver only that arm (as `_resolve_scope_for_write` does), and asserts the
    org comes back. Against the pre-Amendment single-arm resolvers every one of
    these returns `None` — i.e. a `404` on a tab that renders perfectly.
    """

    async def test_requirement_test_case_link_resolves_from_the_test_case_arm(self) -> None:
        case_id, project_id, org_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={
                (TestCase, case_id): _row(id=case_id, test_condition_id=None, project_id=project_id),
                (Project, project_id): _row(id=project_id, org_id=org_id),
            }
        )
        resolved = await _resolver("requirement-test-case-links")(
            session, _scope_stand_in("test_case_id", case_id)
        )
        assert resolved == org_id

    async def test_requirement_test_condition_link_resolves_from_the_test_condition_arm(self) -> None:
        condition_id, requirement_id, project_id, org_id = (
            uuid.uuid4(),
            uuid.uuid4(),
            uuid.uuid4(),
            uuid.uuid4(),
        )
        session = _FakeSession(
            rows={
                (TestCondition, condition_id): _row(id=condition_id, requirement_id=requirement_id),
                (Requirement, requirement_id): _row(id=requirement_id, project_id=project_id),
                (Project, project_id): _row(id=project_id, org_id=org_id),
            }
        )
        resolved = await _resolver("requirement-test-condition-links")(
            session, _scope_stand_in("test_condition_id", condition_id)
        )
        assert resolved == org_id

    async def test_test_condition_test_case_link_resolves_from_the_test_case_arm(self) -> None:
        case_id, project_id, org_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={
                (TestCase, case_id): _row(id=case_id, test_condition_id=None, project_id=project_id),
                (Project, project_id): _row(id=project_id, org_id=org_id),
            }
        )
        resolved = await _resolver("test-condition-test-case-links")(
            session, _scope_stand_in("test_case_id", case_id)
        )
        assert resolved == org_id

    async def test_test_case_defect_link_resolves_from_the_defect_arm(self) -> None:
        """The longest new chain, and the one worth spelling out: `Defect` ->
        `TestExecution` -> `TestCycle` -> `TestPlan.project_id` ->
        `Project.org_id` is `_DEFECT_CONFIG`'s own resolver with one hop
        prepended, composed rather than re-derived."""
        defect_id, execution_id, cycle_id, plan_id, project_id, org_id = (uuid.uuid4() for _ in range(6))
        session = _FakeSession(
            rows={
                (Defect, defect_id): _row(id=defect_id, test_execution_id=execution_id),
                (TestExecution, execution_id): _row(id=execution_id, test_cycle_id=cycle_id),
                (TestCycle, cycle_id): _row(id=cycle_id, test_plan_id=plan_id),
                (TestPlan, plan_id): _row(id=plan_id, project_id=project_id),
                (Project, project_id): _row(id=project_id, org_id=org_id),
            }
        )
        resolved = await _resolver("test-case-defect-links")(session, _scope_stand_in("defect_id", defect_id))
        assert resolved == org_id

    async def test_test_suite_test_case_resolves_from_the_test_case_arm(self) -> None:
        case_id, project_id, org_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={
                (TestCase, case_id): _row(id=case_id, test_condition_id=None, project_id=project_id),
                (Project, project_id): _row(id=project_id, org_id=org_id),
            }
        )
        resolved = await _resolver("test-suite-test-cases")(session, _scope_stand_in("test_case_id", case_id))
        assert resolved == org_id

    async def test_test_plan_test_suite_resolves_from_the_test_suite_arm(self) -> None:
        suite_id, project_id, org_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={
                (TestSuite, suite_id): _row(id=suite_id, project_id=project_id),
                (Project, project_id): _row(id=project_id, org_id=org_id),
            }
        )
        resolved = await _resolver("test-plan-test-suites")(
            session, _scope_stand_in("test_suite_id", suite_id)
        )
        assert resolved == org_id


class TestOriginalArmIsUnchanged:
    """Behaviour preservation: the arm that already worked still works, and a
    real row (both FKs set, the `get`/`update`/`delete` case) still walks it."""

    async def test_requirement_arm_still_resolves_via_the_requirement_chain(self) -> None:
        requirement_id, project_id, org_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={
                (Requirement, requirement_id): _row(id=requirement_id, project_id=project_id),
                (Project, project_id): _row(id=project_id, org_id=org_id),
            }
        )
        resolved = await _resolver("requirement-test-case-links")(
            session, _scope_stand_in("requirement_id", requirement_id)
        )
        assert resolved == org_id

    async def test_a_real_row_takes_the_original_arm_even_though_both_are_set(self) -> None:
        """`_fetch_and_gate` passes the actual link row. Only the `Requirement`
        side is stocked in this fake session, and the `TestCase` side is
        deliberately left dangling — so if the resolver took the *new* arm it
        would return `None` and this would fail. That asymmetry is the
        assertion; a session stocked with both sides could not tell which arm
        ran."""
        requirement_id, project_id, org_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={
                (Requirement, requirement_id): _row(id=requirement_id, project_id=project_id),
                (Project, project_id): _row(id=project_id, org_id=org_id),
            }
        )
        link_row = _row(id=uuid.uuid4(), requirement_id=requirement_id, test_case_id=uuid.uuid4())
        assert await _resolver("requirement-test-case-links")(session, link_row) == org_id

    async def test_an_unresolvable_reverse_arm_is_none_not_a_guess(self) -> None:
        """A dangling FK on the new arm must 404 exactly as a dangling FK on
        the old one does — never fall through to the other arm's answer."""
        session = _FakeSession()
        assert (
            await _resolver("test-case-defect-links")(session, _scope_stand_in("defect_id", uuid.uuid4()))
            is None
        )


class TestSingleArmResolverWouldRegress:
    """The mutation check, in the suite rather than done once by hand.

    `backend/CLAUDE.md`: "a partition asserted against a fixed codebase has
    never been observed to fail, so nothing distinguishes correct from
    vacuous." Every assertion in `TestReverseArmResolvesTheSameOrg` passes
    trivially if someone later decides the branching resolver is over-
    engineering and the config can just keep its old single-arm walk — so this
    runs the *pre-Amendment* resolver expression against the identical stand-in
    and asserts it genuinely fails, making the two results differ for a reason.
    """

    async def test_the_pre_amendment_resolver_404s_the_reverse_arm(self) -> None:
        case_id, project_id, org_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        rows = {
            (TestCase, case_id): _row(id=case_id, test_condition_id=None, project_id=project_id),
            (Project, project_id): _row(id=project_id, org_id=org_id),
        }
        stand_in = _scope_stand_in("test_case_id", case_id)

        # What `_REQUIREMENT_TEST_CASE_LINK_CONFIG` used before Amendment 1.
        pre_amendment = chain_resolver([(Requirement, "requirement_id")])
        assert await pre_amendment(_FakeSession(rows=rows), stand_in) is None, (
            "the single-arm resolver must NOT resolve the reverse arm — if this "
            "starts passing, the reverse-arm tests above have stopped proving anything"
        )

        # What it uses now, against the byte-identical session and stand-in.
        assert await _resolver("requirement-test-case-links")(_FakeSession(rows=rows), stand_in) == org_id

    async def test_resolve_via_test_case_alone_404s_the_defect_arm(self) -> None:
        """Same check for the other shape of pre-Amendment resolver — a bare
        function rather than a `chain_resolver` closure."""
        defect_id = uuid.uuid4()
        stand_in = _scope_stand_in("defect_id", defect_id)
        assert await resolve_via_test_case(_FakeSession(), stand_in) is None


# --- the 422 contract ---------------------------------------------------------------------------


class TestScopeValidationUnderABranchingScope:
    """**TC-ADMIN-078.** Widening `scope_field` changes the `422` body for a badly-scoped list
    request, which is a real (if small) API contract change worth pinning
    rather than discovering from a failing client."""

    @pytest.mark.parametrize(("key", "original", "reverse"), JUNCTIONS)
    def test_exactly_one_arm_is_required(self, key: str, original: str, reverse: str) -> None:
        config = ALL_ENTITY_CONFIGS[key]
        one = uuid.uuid4()
        assert extract_scope_value(config, {original: one}) == (original, one)
        assert extract_scope_value(config, {reverse: one}) == (reverse, one)
        # Zero arms, and both arms, are each rejected — the `XOR` narrowing
        # `RiskItem` already established, applied identically on `list`.
        assert extract_scope_value(config, {}) is None
        assert extract_scope_value(config, {original: one, reverse: uuid.uuid4()}) is None

    @pytest.mark.parametrize(("key", "original", "reverse"), JUNCTIONS)
    def test_the_422_names_both_arms_instead_of_requiring_one(
        self, key: str, original: str, reverse: str
    ) -> None:
        """Before Amendment 1 an unscoped list returned `"<arm> is required."`;
        a branching scope reports the `exactly one of X or Y` wording instead.
        Keyed on `candidates[0]`, i.e. the original arm, so a client matching
        on the field name sees no change."""
        import json

        config = ALL_ENTITY_CONFIGS[key]
        body = json.loads(bytes(scope_validation_error(config, {}).body))
        assert body["code"] == "validation_error"
        assert list(body["field_errors"]) == [original]
        assert body["field_errors"][original] == [f"exactly one of {original} or {reverse} must be set"]

        both = json.loads(bytes(scope_validation_error(config, {original: "a", reverse: "b"}).body))
        assert both["field_errors"][original] == [
            f"exactly one of {original} or {reverse} must be set, not both"
        ]
