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


def test_tester_bundle_has_no_approval_or_role_permissions() -> None:
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    tester = bundles["tester"]
    assert not any(code.startswith("approval.") for code in tester)
    assert "test_plan.approve" not in tester


def test_all_bundle_codes_are_a_subset_of_the_full_catalog() -> None:
    all_codes = {code for code, _resource, _action in build_permission_catalog()}
    bundles = build_role_bundles(all_codes)

    for role_name in SYSTEM_ROLE_NAMES:
        assert bundles[role_name] <= all_codes, f"{role_name} references a code outside the catalog"
