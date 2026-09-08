"""Unit tests for `app/db/rbac_seed_catalog.py` (RBAC-4).

Pure-Python, no DB/network — asserts the shape of the `Permission` catalog
and the 5 system `Role` bundles the migration
(`alembic/versions/<hash>_seed_rbac_system_roles.py`) seeds from this module.
Does NOT touch the migration or a live DB; that's covered by
`tests/integration/test_rbac_seed.py` instead.
"""

from app.db.rbac_seed_catalog import (
    ALL_RESOURCES,
    CRUD_RESOURCES,
    READ_ONLY_RESOURCES,
    SPECIAL_PERMISSIONS,
    SYSTEM_ROLE_NAMES,
    build_permission_catalog,
    build_role_bundles,
)


def test_resource_counts_match_the_plan() -> None:
    assert len(CRUD_RESOURCES) == 23
    assert len(READ_ONLY_RESOURCES) == 6
    assert len(ALL_RESOURCES) == 29
    # no accidental overlap/duplication between the two resource lists
    assert set(CRUD_RESOURCES).isdisjoint(READ_ONLY_RESOURCES)
    assert len(set(ALL_RESOURCES)) == len(ALL_RESOURCES)


def test_permission_catalog_has_one_hundred_rows() -> None:
    catalog = build_permission_catalog()
    # 23 CRUD resources x 4 actions + 6 read-only resources x 1 action + 2 special verbs
    assert len(catalog) == 23 * 4 + 6 * 1 + 2
    assert len(catalog) == 100
    codes = [code for code, _resource, _action in catalog]
    assert len(codes) == len(set(codes)), "duplicate permission codes in the catalog"


def test_permission_catalog_contains_special_verbs() -> None:
    codes = {code for code, _resource, _action in build_permission_catalog()}
    assert "test_plan.approve" in codes
    assert "requirement.export_rtm" in codes
    for resource, action in SPECIAL_PERMISSIONS:
        assert f"{resource}.{action}" in codes


def test_permission_catalog_read_only_resources_have_only_read_action() -> None:
    catalog = build_permission_catalog()
    for resource in READ_ONLY_RESOURCES:
        actions_for_resource = {action for _code, res, action in catalog if res == resource}
        assert actions_for_resource == {"read"}


def test_permission_catalog_crud_resources_have_all_four_actions() -> None:
    # Some CRUD resources (e.g. `requirement`, `test_plan`) also carry a
    # special verb on top of CRUD (`export_rtm`, `approve`) — assert the
    # CRUD actions are a subset, not an exact set, for those resources.
    catalog = build_permission_catalog()
    for resource in CRUD_RESOURCES:
        actions_for_resource = {action for _code, res, action in catalog if res == resource}
        assert {"create", "read", "update", "delete"} <= actions_for_resource


def test_five_system_role_names() -> None:
    assert SYSTEM_ROLE_NAMES == ("org_admin", "test_manager", "tester", "auditor", "ai_agent_scoped")
    assert len(SYSTEM_ROLE_NAMES) == 5


def test_org_admin_bundle_is_the_entire_catalog() -> None:
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    assert bundles["org_admin"] == all_codes
    assert len(bundles["org_admin"]) == 100


def test_ai_agent_scoped_bundle_never_contains_test_plan_approve() -> None:
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    assert "test_plan.approve" not in bundles["ai_agent_scoped"]
    # also never touches approval/role/role_assignment/org_membership at all
    forbidden_prefixes = ("approval.", "role.", "role_assignment.", "org_membership.")
    for code in bundles["ai_agent_scoped"]:
        assert not code.startswith(forbidden_prefixes), code


def test_ai_agent_scoped_bundle_has_no_delete_permissions() -> None:
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    assert not any(code.endswith(".delete") for code in bundles["ai_agent_scoped"])


def test_auditor_bundle_is_read_only_on_every_resource() -> None:
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    auditor = bundles["auditor"]
    assert "requirement.export_rtm" in auditor
    non_export_codes = auditor - {"requirement.export_rtm"}
    assert all(code.endswith(".read") for code in non_export_codes)
    # one .read per resource across all 29 resources
    assert len(non_export_codes) == len(ALL_RESOURCES)


def test_test_manager_bundle_includes_release_create_read_update_but_not_delete() -> None:
    """PROJ-2/ADR-0019: `test_manager` gains `release.create`/`.read`/
    `.update` (closing what ADR-0019 frames as an RBAC-4 oversight, given
    `test_manager` already held full `test_cycle` CRUD) but NOT
    `release.delete`, since no delete route exists to reach it.
    """
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    test_manager = bundles["test_manager"]
    assert "release.create" in test_manager
    assert "release.read" in test_manager
    assert "release.update" in test_manager
    assert "release.delete" not in test_manager


def test_test_manager_bundle_includes_full_test_condition_and_test_case_crud() -> None:
    """REQ-3/ADR-0028: `test_manager` gains `test_condition.create`/`.update`/
    `.delete` and `test_case.create`/`.update`/`.delete` — full parity with
    `tester`'s existing bundle on both resources, of which `test_manager`
    previously held only `.read`. Without these, FR-REQ-3's own persona can't
    reach that story's two authoring routes without also holding `tester`/
    `org_admin`.
    """
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    test_manager = bundles["test_manager"]
    for action in ("create", "read", "update", "delete"):
        assert f"test_condition.{action}" in test_manager
        assert f"test_case.{action}" in test_manager


def test_test_manager_matches_tester_on_test_condition_and_test_case() -> None:
    """The parity ADR-0028 actually asserts: identical code sets on both
    resources, so the two bundles can't silently diverge again.
    """
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    for resource in ("test_condition", "test_case"):
        prefix = f"{resource}."
        manager_codes = {code for code in bundles["test_manager"] if code.startswith(prefix)}
        tester_codes = {code for code in bundles["tester"] if code.startswith(prefix)}
        assert manager_codes == tester_codes, resource


def test_test_manager_bundle_includes_full_environment_crud() -> None:
    """PLAN-3/ADR-0033: `test_manager` gains `environment.create`/`.read`/
    `.update`/`.delete` — it held **none** of the four before this ADR, even
    though it has held full `test_cycle` CRUD since RBAC-4 and a `TestCycle`
    cannot be created without pointing at an `Environment`.

    FR-PLAN-3 AC2's own wording ("a user with `environment.create`
    permission…") names this story's persona directly, so without these codes
    the inline "+ New Environment" flow 403s for the very role the story is
    written around — the same class of pre-existing RBAC-4 seed gap ADR-0019
    closed once for `release.*`.
    """
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    test_manager = bundles["test_manager"]
    for action in ("create", "read", "update", "delete"):
        assert f"environment.{action}" in test_manager, action


def test_test_manager_bundle_has_test_execution_create_and_read_only() -> None:
    """PLAN-3/ADR-0033, and the *withholding* half of it, which matters as much
    as the grant: `test_manager` gains `test_execution.create` (the minimum to
    reach `POST /test-cycles/{id}/executions`, TC-PLAN-008) and
    `test_execution.read` — but deliberately **not** `.update`/`.delete`.

    No FR-PLAN-3 or FR-EXEC-1 acceptance criterion asks `test_manager` to edit
    or delete a recorded result. Asserting the absence, not just the presence,
    is what makes a later accidental widening (e.g. someone reaching for
    `_crud_codes("test_execution")` by symmetry with the resources above it)
    show up as a failing test rather than a silent scope expansion.
    """
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    test_manager = bundles["test_manager"]
    assert "test_execution.create" in test_manager
    assert "test_execution.read" in test_manager
    assert "test_execution.update" not in test_manager
    assert "test_execution.delete" not in test_manager


def test_plan3_migration_code_set_matches_the_catalog_delta() -> None:
    """The six codes the new Alembic data migration backfills must be exactly
    the six `test_manager` gained in `rbac_seed_catalog.py`.

    Both halves are required (`backend/CLAUDE.md`'s standing rule): editing the
    catalog alone only affects a *fresh* DB's initial seed, and running the
    migration alone would leave a fresh DB's seed disagreeing with an upgraded
    one. This test is the thing that catches the two drifting apart — it reads
    the migration module's own `_NEW_CODES` tuple rather than restating the
    list, so a future edit to one side without the other fails here.
    """
    import importlib.util
    from pathlib import Path

    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "e5b21d7c8f40_seed_environment_test_execution_permissions_test_manager.py"
    )
    assert migration_path.exists(), migration_path
    spec = importlib.util.spec_from_file_location("_plan3_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    test_manager = build_role_bundles(all_codes)["test_manager"]

    assert set(module._NEW_CODES) == {
        "environment.create",
        "environment.read",
        "environment.update",
        "environment.delete",
        "test_execution.create",
        "test_execution.read",
    }
    # Every code the migration inserts is one the catalog also grants...
    assert set(module._NEW_CODES) <= test_manager
    # ...and every one of them is a real catalogued Permission, so the
    # migration's own "len mismatch -> skip" guard can never silently no-op.
    assert set(module._NEW_CODES) <= all_codes
    assert module.down_revision == "a91c4e0f7db5"


def test_tester_bundle_has_no_approval_or_role_permissions() -> None:
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    tester = bundles["tester"]
    assert not any(code.startswith("approval.") for code in tester)
    assert "test_plan.approve" not in tester


def test_test_manager_bundle_gains_defect_create_only() -> None:
    """EXEC-3/ADR-0041: `test_manager` gains `defect.create` — it held only
    `.read` before (RBAC-4's original seed). `.update`/`.delete` deliberately
    NOT granted, same restraint ADR-0033 already took for `test_execution.*`
    (no FR-EXEC-3 AC asks `test_manager` to edit/delete a raised Defect).
    """
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    test_manager = build_role_bundles(all_codes)["test_manager"]

    assert "defect.create" in test_manager
    assert "defect.read" in test_manager
    assert "defect.update" not in test_manager
    assert "defect.delete" not in test_manager


def test_test_manager_and_tester_both_gain_test_case_defect_link_read() -> None:
    """EXEC-3/ADR-0041: neither role held `test_case_defect_link.read` before
    (only `org_admin`/`auditor` did) — both need it to reach the new
    `GET /test-cases/{id}/defects` view (AC3).
    """
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    assert "test_case_defect_link.read" in bundles["test_manager"]
    assert "test_case_defect_link.read" in bundles["tester"]


def test_exec3_migration_code_sets_match_the_catalog_delta() -> None:
    """The codes the new Alembic data migration backfills for each role must
    be exactly what each role gained in `rbac_seed_catalog.py` — same
    both-halves-required rule `test_plan3_migration_code_set_matches_the_catalog_delta`
    already established for `e5b21d7c8f40`, applied here for `f19a7c3e5b62`.
    """
    import importlib.util
    from pathlib import Path

    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "f19a7c3e5b62_seed_defect_permissions_test_manager_tester.py"
    )
    assert migration_path.exists(), migration_path
    spec = importlib.util.spec_from_file_location("_exec3_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    assert set(module._TEST_MANAGER_NEW_CODES) == {"defect.create", "test_case_defect_link.read"}
    assert set(module._TESTER_NEW_CODES) == {"test_case_defect_link.read"}

    # Every code the migration inserts per role is one the catalog also grants
    # that role...
    assert set(module._TEST_MANAGER_NEW_CODES) <= bundles["test_manager"]
    assert set(module._TESTER_NEW_CODES) <= bundles["tester"]
    # ...and every one of them is a real catalogued Permission, so the
    # migration's own "len mismatch -> skip" guard can never silently no-op.
    assert set(module._ALL_NEW_CODES) <= all_codes
    assert module.down_revision == "6a11a6a1d803"


def test_all_bundle_codes_are_a_subset_of_the_full_catalog() -> None:
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    for role_name in SYSTEM_ROLE_NAMES:
        assert bundles[role_name] <= all_codes, f"{role_name} references a code outside the catalog"
