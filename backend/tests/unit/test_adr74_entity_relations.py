"""ADR-0074: `crud_factory.derive_entity_relations` — the inbound-relationship
set behind `EntityDetailPage`'s tabs.

**Why the completeness test in here matters more than the per-case ones.**
`backend/CLAUDE.md`'s registry-completeness note (ADR-0068/MCP-6) is about a
registry spanning many entities where a missing row is silently invisible
rather than loudly broken. A missing relationship is exactly that shape: the
tab simply never renders, nothing fails, and nobody notices. The derivation
itself is the first line of defence — it is *computed* by walking
`ALL_ENTITY_CONFIGS`, not hand-typed, so it cannot omit an entity the way a
hand-authored map can.

That leaves one real risk, which `TestInboundFkCompleteness` below exists for:
a relationship that is genuinely *excluded* (because the generic list route
cannot serve it) being confused with one that was accidentally dropped. So
every inbound FK in the whole registry is partitioned — served, or excluded
with a named, asserted reason — and the partition is asserted total. A new
entity, or a new FK on an existing one, lands in neither bucket and fails
loudly here rather than quietly not rendering a tab.

**The gap that partition could not see, and where it is now closed
([ADR-0075](../../../docs/adr/0075-junction-table-registry-completeness.md)).**
"every inbound FK in the whole registry" is exactly as complete as the registry
is. `_all_inbound_fks()` below walks `ALL_ENTITY_CONFIGS`, and so does the
derivation it is checking — so an entity with **no config at all** contributes
no FKs to either side, and the partition holds *vacuously* while that entity's
relationships silently render no tab. That is not hypothetical: it was true of
`TestSuiteTestCase` and `TestPlanTestSuite` for this whole file's first
revision. ADR-0074 Decision §1's claim that "a derivation cannot omit what it
enumerates" is sound; what it does not cover is the set being enumerated, and
`entity_registry._ALL_CONFIGS` is hand-authored — the one hand-typed list in the
chain, and therefore the one `backend/CLAUDE.md`'s registry-completeness note
actually applies to. The guard for *that* is one level down and lives in
`test_adr75_registry_completeness.py`, which partitions the **model** layer
(`Base.metadata`) instead of the config layer.
"""

import pytest

from app.api.crud_factory import (
    _scope_candidates,
    derive_entity_relations,
    derive_entity_schema,
    derive_filter_fields,
    derive_sortable_fields,
    fk_fields_of,
    is_link_entity,
)
from app.api.entity_registry import ALL_ENTITY_CONFIGS


def _relations(entity_key: str) -> list[dict]:
    return derive_entity_relations(ALL_ENTITY_CONFIGS[entity_key], ALL_ENTITY_CONFIGS)


def _by_entity(entity_key: str) -> dict[str, dict]:
    return {r["entity"]: r for r in _relations(entity_key)}


#: Every registered entity `is_link_entity` classifies as a many-to-many join
#: table. Six since [ADR-0075](../../../docs/adr/0075-junction-table-registry-completeness.md)
#: registered `TestSuiteTestCase`/`TestPlanTestSuite`; the first four are
#: ADR-0005's traceability links.
EXPECTED_LINK_ENTITIES = {
    "requirement-test-case-links",
    "requirement-test-condition-links",
    "test-condition-test-case-links",
    "test-case-defect-links",
    # ADR-0075. Neither table name ends in `_link` — see
    # `test_structural_rule_is_not_the_table_naming_convention` below.
    "test-suite-test-cases",
    "test-plan-test-suites",
}


class TestLinkEntityClassifier:
    """**TC-ADMIN-071.** `is_link_entity` decides many-to-many-ness *structurally* (exactly two
    FKs, no create/update) rather than by table name. These tests pin that
    rule against the `*_link` naming convention in BOTH directions, so a future
    entity drifting into or out of the shape fails here rather than silently
    gaining or losing a many-to-many tab."""

    def test_structural_rule_selects_exactly_the_expected_link_entities(self) -> None:
        structural = {k for k, c in ALL_ENTITY_CONFIGS.items() if is_link_entity(c)}
        assert structural == EXPECTED_LINK_ENTITIES

    def test_structural_rule_is_not_the_table_naming_convention(self) -> None:
        """**TC-ADMIN-074.** ADR-0074 Decision §3 chose a structural classifier over a `_link`
        suffix because "matching on a `_link` suffix would be a naming
        convention masquerading as a contract." Until ADR-0075 the two sets
        happened to be identical, so nothing demonstrated the choice mattered —
        this test is the demonstration: `test_suite_test_case` and
        `test_plan_test_suite` are genuine ADR-0005-shaped join tables (exactly
        two FK fields, no `create`/`update` in their REST surface) whose names
        carry no `_link` suffix at all, and they are classified correctly
        *because* the rule is structural. A name-based rule would have silently
        given them no many-to-many tab."""
        by_table_name = {
            k for k, c in ALL_ENTITY_CONFIGS.items() if c.model.__tablename__.endswith("_link")
        }
        assert by_table_name < EXPECTED_LINK_ENTITIES, "naming convention is no longer a subset"
        assert EXPECTED_LINK_ENTITIES - by_table_name == {
            "test-suite-test-cases",
            "test-plan-test-suites",
        }
        for key in EXPECTED_LINK_ENTITIES - by_table_name:
            config = ALL_ENTITY_CONFIGS[key]
            assert not config.model.__tablename__.endswith("_link")
            assert len(fk_fields_of(config)) == 2
            assert not ({"create", "update"} & (config.full_methods or config.methods))

    @pytest.mark.parametrize(
        ("entity_key", "why_not"),
        [
            ("test-executions", "two FKs, but a real `update`"),
            ("role-assignments", "two FKs, but a real `update`"),
            ("risk-items", "two FKs, but a real `create`"),
        ],
    )
    def test_two_fk_near_misses_are_not_classified_as_link_tables(self, entity_key: str, why_not: str) -> None:
        config = ALL_ENTITY_CONFIGS[entity_key]
        assert len(fk_fields_of(config)) == 2, why_not
        assert is_link_entity(config) is False, why_not


class TestOneToManyRelations:
    def test_project_lists_its_five_direct_children(self) -> None:
        relations = _by_entity("projects")
        assert set(relations) == {
            "requirements",
            "test-cases",
            "test-suites",
            "test-plans",
            "environments",
        }
        assert all(r["kind"] == "one-to-many" for r in relations.values())
        assert all(r["scopeField"] == "project_id" for r in relations.values())

    def test_a_one_to_many_relation_targets_the_entity_it_lists(self) -> None:
        relation = _by_entity("test-cases")["test-steps"]
        assert relation["kind"] == "one-to-many"
        assert relation["targetEntity"] == "test-steps"
        # No indirection to follow: the listed row already *is* the record.
        assert relation["targetField"] is None

    def test_label_is_the_child_entitys_own_label(self) -> None:
        assert _by_entity("test-plans")["entry-exit-criteria"]["label"] == "Entry/exit criteria"

    def test_branching_scope_field_resolves_per_parent(self) -> None:
        """`RiskItem`'s `scope_field` is the 2-tuple `(requirement_id,
        test_plan_id)`. It is a child of *both* parents, each scoped by its own
        arm of that tuple — not of one arbitrarily-picked arm."""
        assert _by_entity("requirements")["risk-items"]["scopeField"] == "requirement_id"
        assert _by_entity("test-plans")["risk-items"]["scopeField"] == "test_plan_id"


class TestManyToManyRelations:
    def test_requirement_reaches_test_cases_through_the_link_table(self) -> None:
        relation = _by_entity("requirements")["requirement-test-case-links"]
        assert relation["kind"] == "many-to-many"
        # The link rows are what's listed...
        assert relation["entity"] == "requirement-test-case-links"
        assert relation["scopeField"] == "requirement_id"
        # ...but the far side is what the tab is about, and where a row click goes.
        assert relation["targetEntity"] == "test-cases"
        assert relation["targetField"] == "test_case_id"

    def test_label_is_the_far_entitys_label_with_the_linked_suffix(self) -> None:
        assert _by_entity("test-cases")["test-case-defect-links"]["label"] == "Defects (linked)"

    def test_the_linked_suffix_disambiguates_requirements_two_test_condition_tabs(self) -> None:
        """**TC-ADMIN-072.** `Requirement` reaches `TestCondition` twice over — directly via
        `TestCondition.requirement_id` (REQ-3's rigor path) and via
        `RequirementTestConditionLink` (ADR-0005 traceability). Both are real,
        separately-populated tabs, so their labels must not collide."""
        relations = _relations("requirements")
        pointing_at_test_conditions = [r for r in relations if r["targetEntity"] == "test-conditions"]
        assert len(pointing_at_test_conditions) == 2
        assert {r["kind"] for r in pointing_at_test_conditions} == {"one-to-many", "many-to-many"}
        labels = [r["label"] for r in pointing_at_test_conditions]
        assert sorted(labels) == ["Test conditions", "Test conditions (linked)"]
        assert len(set(labels)) == len(labels)

    def test_test_suite_reaches_test_cases_through_its_membership_junction(self) -> None:
        """**TC-ADMIN-075.** ADR-0075's headline fix. `TestSuite`'s relation set was literally
        empty before its junction table was registered, even though REQ-4's
        bespoke routes populate that table — the derivation walks
        `ALL_ENTITY_CONFIGS`, and `test_suite_test_case` had no entry in it."""
        relations = _relations("test-suites")
        assert relations != [], "TestSuite must no longer have an empty relation set"
        relation = _by_entity("test-suites")["test-suite-test-cases"]
        assert relation["kind"] == "many-to-many"
        assert relation["scopeField"] == "test_suite_id"
        assert relation["label"] == "Test cases (linked)"
        assert relation["targetEntity"] == "test-cases"
        assert relation["targetField"] == "test_case_id"

    def test_test_plan_reaches_test_suites_through_its_scope_junction(self) -> None:
        """**TC-ADMIN-075** (second half). `TestPlan` already had three one-to-many tabs, so unlike
        `TestSuite` its gap was invisible as a *missing* tab rather than an empty
        strip — the more dangerous shape of the same bug."""
        relation = _by_entity("test-plans")["test-plan-test-suites"]
        assert relation["kind"] == "many-to-many"
        assert relation["scopeField"] == "test_plan_id"
        assert relation["label"] == "Test suites (linked)"
        assert relation["targetEntity"] == "test-suites"
        assert relation["targetField"] == "test_suite_id"

    def test_test_case_gains_the_reverse_side_of_every_junction_pointing_at_it(self) -> None:
        """**TC-ADMIN-076** (amended by **ADR-0075 Amendment 1**).

        The original of this test asserted `test-cases`' tab list was exactly
        `["Attachments", "Test steps", "Defects (linked)"]` — pinning ADR-0075
        Decision §3's choice to scope both new junctions on their *parent*
        side, which deliberately left `TestCase` with no reverse tabs.

        Amendment 1 widened all six junctions to branching 2-tuples, so
        `TestCase` — the entity three separate junctions point at — is where
        the change is most visible: three reverse tabs appear at once. The
        assertion is kept as an exact list (not a superset) for the same reason
        it was exact before: `e2e/tests/admin7-entity-relation-tabs.spec.ts`
        asserts this entity's tab strip positionally, so a silent drift here
        must fail in the fast unit layer rather than in a browser."""
        assert [r["label"] for r in _relations("test-cases")] == [
            # one-to-many first, each alphabetical (the derivation's own sort)
            "Attachments",
            # ADR-0078: `TestExecution`'s scope widened to a branching pair
            # including `test_case_id`, so a test case's own execution history
            # becomes a tab — a side effect of the widening the `Defects
            # (linked)` picker needed, and a genuinely useful one: nothing else
            # in the app lists a single test case's runs.
            "Test executions",
            "Test steps",
            # then many-to-many, alphabetical
            "Defects (linked)",
            "Requirements (linked)",
            "Test conditions (linked)",
            "Test suites (linked)",
        ]

    def test_every_junctions_reverse_tab_is_present_on_its_far_parent(self) -> None:
        """**TC-ADMIN-078.** The reverse direction of all six junctions, enumerated — the exact
        set ADR-0074 §4's exclusion table used to list as unservable."""
        assert _by_entity("test-cases")["requirement-test-case-links"]["label"] == "Requirements (linked)"
        assert (
            _by_entity("test-conditions")["requirement-test-condition-links"]["label"]
            == "Requirements (linked)"
        )
        assert _by_entity("test-cases")["test-condition-test-case-links"]["label"] == "Test conditions (linked)"
        assert _by_entity("defects")["test-case-defect-links"]["label"] == "Test cases (linked)"
        assert _by_entity("test-cases")["test-suite-test-cases"]["label"] == "Test suites (linked)"
        assert _by_entity("test-suites")["test-plan-test-suites"]["label"] == "Test plans (linked)"

    def test_no_entity_has_two_tabs_with_the_same_label(self) -> None:
        """**TC-ADMIN-072** (generalized half). Generalizes the case above across the whole registry — a duplicate
        label is a tab strip the user cannot tell apart."""
        for key in ALL_ENTITY_CONFIGS:
            labels = [r["label"] for r in _relations(key)]
            assert len(set(labels)) == len(labels), f"{key} has duplicate relationship tab labels: {labels}"


class TestExclusions:
    """Only relationships the *generic list route* can actually serve are
    emitted. `extract_scope_value` 422s a list request that doesn't carry
    exactly one scope value, so an FK that is merely a `filter_field` is not
    enough — the caller would still owe the unrelated scope value, which a
    detail page for a different entity has no way to know."""

    def test_many_to_one_never_produces_a_tab(self) -> None:
        """A `Requirement` has a `project_id`, but `Project` is its *parent* —
        that renders as a field on the Info tab. `Requirement`'s own relations
        must contain nothing pointing back up at `projects`."""
        assert all(r["targetEntity"] != "projects" for r in _relations("requirements"))

    def test_filter_field_only_fk_is_excluded(self) -> None:
        """**Superseded premise, inverted in place rather than deleted** — the
        same treatment ADR-0075 Amendment 1 gave
        `test_a_link_table_is_listable_from_both_of_its_own_scope_arms` below,
        and for the same reason: the *rule* being demonstrated still exists,
        only its example stopped being an example.

        This test used to assert that `TestExecution.test_case_id` is a real
        filterable column whose FK is nonetheless **not** servable as a tab,
        because `TestExecution`'s scope was `test_cycle_id` alone — a value a
        `TestCase` detail page cannot supply. That was true and deliberate:
        ADR-0074 Decision §2 requires an FK to be a *scope arm*, not merely a
        filter field, precisely because the caller would still owe the
        unrelated scope value.

        ADR-0078 widened that scope to `("test_cycle_id", "test_case_id")`, so
        the FK is now both filterable and a scope arm, and the relation is
        served. The rule did not change — `TestCase` did not gain this tab by
        `test_case_id` becoming filterable (it always was), it gained it by
        that column becoming something a list request may scope by.

        `test_filterable_alone_is_still_not_enough` below keeps the original
        claim asserted against an example that is still an example.
        """
        config = ALL_ENTITY_CONFIGS["test-executions"]
        assert "test_case_id" in derive_filter_fields(config)
        assert "test_case_id" in _scope_candidates(config)
        assert "test-executions" in _by_entity("test-cases")
        assert _by_entity("test-cases")["test-executions"]["kind"] == "one-to-many"

    def test_filterable_alone_is_still_not_enough(self) -> None:
        """ADR-0074 Decision §2's actual rule, on an FK that still demonstrates
        it after ADR-0078 moved this test's original example out from under it.

        `TestCase.test_level_id` is filterable and points at a registered
        entity, and `TestLevel`'s detail page still gets no "Test cases" tab —
        because `TestCase`'s own scope is `project_id`, which a `TestLevel`
        page has no way to know. Filterable is not scopeable.
        """
        config = ALL_ENTITY_CONFIGS["test-cases"]
        assert "test_level_id" in derive_filter_fields(config)
        assert "test_level_id" not in _scope_candidates(config)
        assert "test-cases" not in _by_entity("test-levels")

    def test_a_link_table_is_listable_from_both_of_its_own_scope_arms(self) -> None:
        """**TC-ADMIN-078.** Superseded premise, deliberately inverted rather than deleted.

        This test used to be `test_link_table_is_only_listable_from_its_own_
        scope_side` and asserted `_relations("defects") == []` — true while
        `TestCaseDefectLink`'s `scope_field` was the single column
        `test_case_id`, so the link listed from the `TestCase` end only and
        `Defect`'s detail page rendered no tab strip at all (the exact symptom
        ADR-0075 was written to fix for `TestSuite`).

        **ADR-0075 Amendment 1** widened all six junctions to a branching
        2-tuple `scope_field`, so each is now listable — and therefore tabbed —
        from both ends. The old assertion is not merely stale, it asserted the
        gap as if it were the contract; keeping it inverted here preserves the
        record of what changed, per `docs/CLAUDE.md`'s supersede-in-place
        posture."""
        assert "test-case-defect-links" in _by_entity("test-cases")
        # The direction that previously had no servable list route.
        assert _relations("defects") != [], "Defect's relation set must no longer be empty"
        reverse = _by_entity("defects")["test-case-defect-links"]
        assert reverse["kind"] == "many-to-many"
        assert reverse["scopeField"] == "defect_id"
        assert reverse["label"] == "Test cases (linked)"
        assert reverse["targetEntity"] == "test-cases"
        assert reverse["targetField"] == "test_case_id"

    def test_both_arms_of_a_branching_scope_are_emitted_without_touching_the_derivation(self) -> None:
        """**TC-ADMIN-078.** ADR-0075 Amendment 1 changed six *configs* and zero lines of
        `derive_entity_relations`. The derivation already iterated every FK and
        kept the ones in `_scope_candidates`, so a 2-tuple naturally produces
        one relation per arm — exactly the mechanism that already made
        `RiskItem` a child of both `Requirement` and `TestPlan`.

        Asserted structurally over every link entity rather than on one
        example, so a future junction that widens only one arm fails here."""
        for key in EXPECTED_LINK_ENTITIES:
            config = ALL_ENTITY_CONFIGS[key]
            arms = _scope_candidates(config)
            assert set(arms) == set(fk_fields_of(config)), (
                f"{key}: every FK must be a scope arm for both directions to list"
            )
            assert len(arms) == 2, f"{key}: a junction's scope must name both ends"
            # Each arm is served as a relation on the entity that arm points at.
            for arm, ref_entity in fk_fields_of(config).items():
                parent_key = next(
                    k for k, c in ALL_ENTITY_CONFIGS.items() if c.resource.replace("_", "-") == ref_entity
                )
                served = _by_entity(parent_key)
                assert key in served, f"{parent_key} is missing the {key} tab via {arm}"
                assert served[key]["scopeField"] == arm

    def test_entity_whose_children_are_not_its_own_scope_field_gets_no_tab(self) -> None:
        """`RoleAssignment` has a `project_id` FK, and (ADR-0082) a real generic
        `list` — but that list's `scope_field` is `org_id` only, so
        `GET /role-assignments?project_id=...` isn't a legal request
        (`extract_scope_value` 422s it). `project_id`/`role_id` stay excluded
        for that reason, not for "no list route" (ADR-0082 made that half
        false)."""
        assert "list" in (
            ALL_ENTITY_CONFIGS["role-assignments"].full_methods
            or ALL_ENTITY_CONFIGS["role-assignments"].methods
        )
        assert ALL_ENTITY_CONFIGS["role-assignments"].scope_field == "org_id"
        assert "role-assignments" not in _by_entity("projects")


#: Every inbound FK the derivation deliberately does NOT serve, with the reason.
#: Keyed `(child entity, fk field)` -> the parent entity it points at.
#: `TestInboundFkCompleteness` asserts this is exactly the complement of the
#: served set — so a new entity or FK cannot land in neither bucket.
EXPECTED_EXCLUSIONS: dict[tuple[str, str], str] = {
    # FK is filterable (ADR-0072's derivation), but the child's own scope is a
    # different column the parent's detail page cannot supply.
    ("test-cases", "test_condition_id"): "test-cases scope is project_id",
    # ("test-executions", "test_case_id") lived here until ADR-0078, for the
    # same reason the six link rows below it did: `TestExecution`'s scope was
    # `test_cycle_id` alone, so a `TestCase` detail page had no way to ask for
    # its own executions. ADR-0078 widened that scope to the branching pair
    # `("test_cycle_id", "test_case_id")` — needed so the `TestCase` ->
    # "Defects (linked)" tab can narrow its execution picker to this very test
    # case — and the exclusion stopped being true the moment it did.
    # `test_no_declared_exclusion_is_actually_being_served` is what caught it.
    ("test-cases", "test_level_id"): "test-cases scope is project_id",
    ("test-cases", "test_type_id"): "test-cases scope is project_id",
    ("test-cycles", "environment_id"): "test-cycles scope is test_plan_id",
    ("test-cycles", "release_id"): "test-cycles scope is test_plan_id; Release is unregistered",
    #
    # --- No link-table entries remain here (ADR-0075 Amendment 1) -------------
    #
    # This block previously held six rows, one per junction's reverse side, all
    # reading "link scope is <the other column>". They were correct and
    # deliberate: ADR-0074 §4 established that a link table lists only from
    # whichever single column is its `scope_field`, and ADR-0075 Decision §3
    # kept its two newly-registered junctions to that same rule specifically so
    # all six would behave identically ("widening all six later remains open").
    #
    # Amendment 1 took that open option: every junction's `scope_field` is now
    # the branching 2-tuple of both its FK columns, so both directions have a
    # servable `GET /{entity}?{arm}=<id>` list route and neither side is an
    # exclusion any more. `test_no_declared_exclusion_is_actually_being_served`
    # below is what forced this deletion rather than letting the rows rot — an
    # exclusion that has quietly started working is a stale claim about a
    # capability gap that no longer exists, and it fails loudly here.
    #
    # Child has a real generic `list` (ADR-0082), but its `scope_field` is
    # `org_id` only — `project_id`/`role_id` aren't legal list-scope arms,
    # same shape as the `test-cases`/`test-cycles` rows above.
    ("role-assignments", "project_id"): "role-assignments scope is org_id",
    ("role-assignments", "role_id"): "role-assignments scope is org_id",
}


class TestInboundFkCompleteness:
    """**TC-ADMIN-070.** The diff-based completeness test (`backend/CLAUDE.md`'s registry note).

    Spot-checking a handful of entities would never notice one silently-missing
    relationship. This walks every FK of every registered entity and asserts it
    is either served as a relation or listed in `EXPECTED_EXCLUSIONS` — never
    neither, and never both.
    """

    @staticmethod
    def _all_inbound_fks() -> set[tuple[str, str]]:
        return {
            (child_key, field_name)
            for child_key, child in ALL_ENTITY_CONFIGS.items()
            for field_name in fk_fields_of(child)
        }

    @staticmethod
    def _served_fks() -> set[tuple[str, str]]:
        return {
            (relation["entity"], relation["scopeField"])
            for parent_key in ALL_ENTITY_CONFIGS
            for relation in _relations(parent_key)
        }

    def test_every_inbound_fk_is_either_served_or_explicitly_excluded(self) -> None:
        served = self._served_fks()
        unclassified = self._all_inbound_fks() - served - set(EXPECTED_EXCLUSIONS)
        assert unclassified == set(), (
            "These FKs produce no relationship tab and are not in EXPECTED_EXCLUSIONS. "
            "Either the generic list route can now serve them (and the derivation is "
            "wrong), or they need an entry naming why it cannot: "
            f"{sorted(unclassified)}"
        )

    def test_no_declared_exclusion_is_actually_being_served(self) -> None:
        """The other direction — an exclusion that has quietly started working
        is a stale comment claiming a capability gap that no longer exists."""
        stale = set(EXPECTED_EXCLUSIONS) & self._served_fks()
        assert stale == set(), f"EXPECTED_EXCLUSIONS lists FKs that ARE served: {sorted(stale)}"

    def test_every_declared_exclusion_names_a_real_fk(self) -> None:
        unknown = set(EXPECTED_EXCLUSIONS) - self._all_inbound_fks()
        assert unknown == set(), f"EXPECTED_EXCLUSIONS names FKs that don't exist: {sorted(unknown)}"

    def test_every_served_relation_points_at_a_registered_entity(self) -> None:
        for parent_key in ALL_ENTITY_CONFIGS:
            for relation in _relations(parent_key):
                assert relation["entity"] in ALL_ENTITY_CONFIGS
                assert relation["targetEntity"] in ALL_ENTITY_CONFIGS

    def test_every_served_relation_is_actually_listable(self) -> None:
        """The invariant the whole feature rests on: the tab's list request
        (`GET /{entity}?{scopeField}=<id>`) must satisfy that entity's own
        scope requirement, or it 422s instead of rendering."""
        for parent_key in ALL_ENTITY_CONFIGS:
            for relation in _relations(parent_key):
                child = ALL_ENTITY_CONFIGS[relation["entity"]]
                assert "list" in (child.full_methods or child.methods)
                assert relation["scopeField"] in _scope_candidates(child)


class TestDerivationIsStable:
    def test_relations_are_deterministically_ordered_children_then_links(self) -> None:
        """A stable order keeps the tab strip from reshuffling between deploys
        and lets assertions about it be written positionally."""
        labels = [r["label"] for r in _relations("requirements")]
        assert labels == [
            "Risk items",
            "Test conditions",
            "Test cases (linked)",
            "Test conditions (linked)",
        ]

    def test_repeated_derivation_returns_the_same_result(self) -> None:
        assert _relations("test-cases") == _relations("test-cases")

    def test_schema_route_body_carries_relations_for_every_entity(self) -> None:
        for key, config in ALL_ENTITY_CONFIGS.items():
            schema = derive_entity_schema(config)
            assert schema["relations"] == _relations(key), key


class TestSortableFieldsAgreement:
    """**TC-ADMIN-073.** `make_crud_router` reads `derive_sortable_fields` rather than
    `derive_entity_schema(config)["fields"]`, because since ADR-0074 the full
    schema needs the entity registry and that line runs while the registry is
    still importing. The two must stay a second *derivation* of one fact, never
    a second hand-kept list — this is what pins that."""

    def test_the_two_derivations_agree_for_every_registered_entity(self) -> None:
        for key, config in ALL_ENTITY_CONFIGS.items():
            from_schema = frozenset(f["name"] for f in derive_entity_schema(config)["fields"] if f["sortable"])
            assert derive_sortable_fields(config) == from_schema, key


class TestFilterFieldsAgreement:
    """**TC-ADMIN-073.** The exact same pin, for the exact same reason, on
    ADR-0072's filter allow-list.

    ADR-0072 (merged 2026-09-15) derived `?<field>=`'s allow-list from the
    served schema and had `make_crud_router` read it off
    `derive_entity_schema(config)["filterFields"]` — a call this branch's
    ADR-0074 makes unreachable at *module import* time, since the full schema
    now resolves `relations` from the registry that is mid-import at that
    moment. Resolving the merge therefore gave `filter_fields` the same
    standalone `derive_filter_fields` treatment `sortable_fields` already had,
    sharing `_derived_fields`/`_is_filterable` with the schema rather than
    re-deriving the clauses — and this is what pins the two together, so the
    columns the list route accepts and the ones its own schema advertises
    cannot drift apart.
    """

    def test_the_two_derivations_agree_for_every_registered_entity(self) -> None:
        for key, config in ALL_ENTITY_CONFIGS.items():
            schema = derive_entity_schema(config)
            assert derive_filter_fields(config) == tuple(schema["filterFields"]), key
            # …and `filterFields` is itself the per-field flags' complement, so
            # agreeing with it is agreeing with `fields[].filterable` too.
            assert tuple(f["name"] for f in schema["fields"] if f["filterable"]) == tuple(schema["filterFields"]), key

    def test_at_least_one_entity_actually_has_filterable_columns(self) -> None:
        """Positive control: the agreement above would hold vacuously if the
        derivation returned nothing for everything (`e2e/CLAUDE.md`'s own
        "prove X was live before trusting 'nothing changed'" rule)."""
        assert any(derive_filter_fields(config) for config in ALL_ENTITY_CONFIGS.values())
