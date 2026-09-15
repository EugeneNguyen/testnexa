"""ADR-0072 integration: the two junction tables ADR-0071's relationship
derivation could not see, end to end against a live server.

Real HTTP via `httpx.AsyncClient` against `TEST_API_BASE_URL`, same style and
same seeding helpers as `test_admin2_execution_trace.py` (which covers the four
ADR-0005 link tables this story's two are now peers of).

**Every test here is a round trip, never a config-shape assertion.** A test that
imported `ALL_ENTITY_CONFIGS` and asserted the config exists would pass on a
config that is registered but unreachable — wrong permission code, unresolvable
tenant walk, a `scope_field` the list route 422s on. `backend/CLAUDE.md`'s
resolver-completeness note makes the same point for bespoke creates ("write a
create-then-immediate-read integration test, not just a create-response
assertion — a create-only test cannot catch this class of bug"), and it applies
with full force here: the whole defect ADR-0072 fixes was a config that *didn't
exist*, so "the config exists" is precisely the assertion that would have looked
fine either way.

So the shape throughout is: **create the join row through the entity's own real
bespoke route** (`POST /test-suites/{id}/test-cases/{case_id}`), then read the
relationship back out of `GET /entities/{parent}/schema`, then actually fire the
list request that relation describes and assert the row comes back. That also
exercises the same "row created via its own real create route, then read via the
generic factory" combination `backend/CLAUDE.md`'s DASH-2 note flags as the
pairing no prior test had ever made.
"""

import httpx
import pytest
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.assets import TestSuite, TestSuiteTestCase
from app.models.planning import TestPlan, TestPlanTestSuite
from tests.integration.test_admin2_crud import (
    API_PREFIX,
    TEST_API_BASE_URL,
    _access_token_for,
    _create_org_admin,
    _create_project,
    _create_requirement,
    _create_taxonomy_pair,
    _create_test_case,
    _create_test_condition,
    _unique_name,
)
from tests.integration.test_admin2_crud import _cleanup as _crud_cleanup


async def _cleanup_junctions(*, suite_link_ids=None, plan_link_ids=None, suite_ids=None) -> None:
    """Child-first: the join rows, then the `TestSuite`s they pointed at.

    `test_admin2_crud._cleanup` handles everything shared (users, orgs,
    projects, requirements, conditions, cases, taxonomy) but knows nothing about
    `TestSuite`/`TestSuiteTestCase`/`TestPlanTestSuite`, so this runs first.
    """
    async with AsyncSessionLocal() as session:
        if suite_link_ids:
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.id.in_(suite_link_ids)))
        if plan_link_ids:
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.id.in_(plan_link_ids)))
        if suite_ids:
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
        await session.commit()


def _relations(schema_body: dict) -> dict[str, dict]:
    return {relation["entity"]: relation for relation in schema_body["relations"]}


@pytest.mark.asyncio
async def test_test_suite_schema_serves_a_test_case_relation_and_that_relation_actually_lists() -> None:
    """**TC-ADMIN-060.** The headline regression: before ADR-0072,
    `GET /entities/test-suites/schema` returned `"relations": []` — an entirely
    empty tab strip on `TestSuite`'s detail page — even with join rows present,
    because `test_suite_test_case` had no `CrudEntityConfig` for
    `derive_entity_relations` to walk.

    Asserts all three links of the chain, in order: the join row is created
    through REQ-4's **real** bespoke route; the schema route then advertises the
    relation; and the exact list request that relation describes
    (`GET /{entity}?{scopeField}={parentId}`, which is literally what
    `EntityRelationTab` fires) returns that row. The third assertion is the one
    that matters most — a relation that is advertised but 422s on its own list
    request would render a broken tab, and only firing it can tell.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    suite_ids: list = []
    suite_link_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "adr72-suite")
            other_admin, other_org = await _create_org_admin(session, "adr72-suite-other")
            project = await _create_project(session, org, "adr72-suite")
            requirement = await _create_requirement(session, project, "adr72-suite")
            condition = await _create_test_condition(session, requirement, "adr72-suite")
            level, type_ = await _create_taxonomy_pair(session, "adr72-suite")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="adr72-suite",
            )
            suite = TestSuite(project_id=project.id, name=_unique_name("Suite adr72"))
            session.add(suite)
            await session.flush()
            await session.commit()

            user_ids = [admin.actor_id, other_admin.actor_id]
            org_ids = [org.id, other_org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            suite_ids = [suite.id]
            token = _access_token_for(admin.actor_id)
            other_token = _access_token_for(other_admin.actor_id)
            suite_id, case_id = suite.id, case.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            # 1. Create the join row through REQ-4's own real route (ADR-0030),
            #    never a direct ORM insert — so this exercises the actual
            #    production write path the tab's rows come from.
            add = await client.post(
                f"{API_PREFIX}/test-suites/{suite_id}/test-cases/{case_id}", headers=auth
            )
            assert add.status_code == 201, add.text

            # 2. The schema route now advertises the relation.
            schema = await client.get(f"{API_PREFIX}/entities/test-suites/schema", headers=auth)
            assert schema.status_code == 200
            relations = _relations(schema.json())
            assert relations != {}, "TestSuite's relation set is empty — the ADR-0072 regression"
            relation = relations["test-suite-test-cases"]
            assert relation["kind"] == "many-to-many"
            assert relation["scopeField"] == "test_suite_id"
            assert relation["label"] == "Test cases (linked)"
            # The tab is labelled and navigated by the FAR entity (ADR-0071 §5).
            assert relation["targetEntity"] == "test-cases"
            assert relation["targetField"] == "test_case_id"

            # 3. Fire the exact request the relation describes.
            listed = await client.get(
                f"{API_PREFIX}/{relation['entity']}",
                params={relation["scopeField"]: str(suite_id)},
                headers=auth,
            )
            assert listed.status_code == 200, listed.text
            body = listed.json()
            assert body["total"] == 1
            row = body["items"][0]
            assert row["test_suite_id"] == str(suite_id)
            # `targetField` must name a real key on the row, or the tab's
            # row-click has nothing to navigate with.
            assert row[relation["targetField"]] == str(case_id)
            suite_link_ids = [row["id"]]

            # 4. NFR-1: the join row is invisible across the org boundary — 404,
            #    never 403, and the same 404 for a row that doesn't exist.
            cross_org = await client.get(
                f"{API_PREFIX}/test-suite-test-cases/{row['id']}",
                headers={"Authorization": f"Bearer {other_token}"},
            )
            assert cross_org.status_code == 404
            assert cross_org.json()["code"] == "not_found"

            # 5. Read-only: the generic factory registers no write route, so the
            #    bespoke routes stay the only way to change membership.
            for method, url in (
                ("POST", f"{API_PREFIX}/test-suite-test-cases"),
                ("PATCH", f"{API_PREFIX}/test-suite-test-cases/{row['id']}"),
                ("DELETE", f"{API_PREFIX}/test-suite-test-cases/{row['id']}"),
            ):
                response = await client.request(method, url, headers=auth, json={})
                assert response.status_code == 405, f"{method} {url} -> {response.status_code}"
    finally:
        await _cleanup_junctions(suite_link_ids=suite_link_ids, suite_ids=suite_ids)
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_test_plan_schema_serves_a_test_suite_relation_and_that_relation_actually_lists() -> None:
    """**TC-ADMIN-060** (second half). `TestPlan`'s gap was the more dangerous shape of the same
    bug: it already had three one-to-many tabs, so nothing looked broken — the
    plan-scope relationship was simply absent from a strip that rendered fine.

    Same three-link chain, through PLAN-1's own bespoke route (ADR-0031).
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    suite_ids: list = []
    plan_link_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "adr72-plan")
            project = await _create_project(session, org, "adr72-plan")
            plan = TestPlan(
                project_id=project.id,
                created_by_actor_id=admin.actor_id,
                identifier=_unique_name("plan-adr72"),
            )
            suite = TestSuite(project_id=project.id, name=_unique_name("Suite adr72-plan"))
            session.add_all([plan, suite])
            await session.flush()
            await session.commit()

            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            test_plan_ids = [plan.id]
            suite_ids = [suite.id]
            token = _access_token_for(admin.actor_id)
            plan_id, suite_id = plan.id, suite.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            include = await client.post(
                f"{API_PREFIX}/test-plans/{plan_id}/test-suites/{suite_id}", headers=auth
            )
            assert include.status_code == 201, include.text

            schema = await client.get(f"{API_PREFIX}/entities/test-plans/schema", headers=auth)
            assert schema.status_code == 200
            relations = _relations(schema.json())
            relation = relations["test-plan-test-suites"]
            assert relation["kind"] == "many-to-many"
            assert relation["scopeField"] == "test_plan_id"
            assert relation["label"] == "Test suites (linked)"
            assert relation["targetEntity"] == "test-suites"
            assert relation["targetField"] == "test_suite_id"

            # The three pre-existing one-to-many relations are untouched — this
            # story adds a tab, it does not reshuffle the strip.
            assert {"entry-exit-criteria", "risk-items", "test-cycles"} <= set(relations)

            listed = await client.get(
                f"{API_PREFIX}/{relation['entity']}",
                params={relation["scopeField"]: str(plan_id)},
                headers=auth,
            )
            assert listed.status_code == 200, listed.text
            body = listed.json()
            assert body["total"] == 1
            row = body["items"][0]
            assert row["test_plan_id"] == str(plan_id)
            assert row[relation["targetField"]] == str(suite_id)
            plan_link_ids = [row["id"]]
    finally:
        await _cleanup_junctions(plan_link_ids=plan_link_ids, suite_ids=suite_ids)
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
        )


@pytest.mark.asyncio
async def test_a_junction_list_without_its_scope_value_is_a_422_not_an_unscoped_dump() -> None:
    """**TC-ADMIN-061.** The invariant NFR-71 rests on, checked against the live route rather than
    against `_scope_candidates` in a unit test.

    `extract_scope_value` 422s a list request not carrying exactly one scope
    value. That is *why* ADR-0071 only emits a relation whose FK is the child's
    own `scope_field` — and it is also what stops the new junction routes from
    being an unscoped, cross-tenant dump of every membership row in the
    database. Asserted both ways: no scope param, and the *other* FK supplied
    instead of the scope one (the reverse-direction request an over-eager client
    might try, which is exactly the excluded relationship ADR-0071 §4 enumerates).
    """
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "adr72-scope")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            token = _access_token_for(admin.actor_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            unscoped = await client.get(f"{API_PREFIX}/test-suite-test-cases", headers=auth)
            assert unscoped.status_code == 422
            assert unscoped.json()["code"] == "validation_error"
            assert "test_suite_id" in unscoped.json()["field_errors"]

            # The reverse direction is not servable: `test_case_id` is not this
            # entity's scope field, so it is ignored as a scope and the request
            # still fails the "exactly one scope value" rule.
            reverse = await client.get(
                f"{API_PREFIX}/test-suite-test-cases",
                params={"test_case_id": "00000000-0000-0000-0000-000000000000"},
                headers=auth,
            )
            assert reverse.status_code == 422

            plan_unscoped = await client.get(f"{API_PREFIX}/test-plan-test-suites", headers=auth)
            assert plan_unscoped.status_code == 422
            assert plan_unscoped.json()["code"] == "validation_error"
            assert "test_plan_id" in plan_unscoped.json()["field_errors"]

            # Both halves for this junction too, not just the unscoped one —
            # `test_suite_id` is its non-scope FK, so a `TestSuite` cannot list
            # the plans including it from here either.
            plan_reverse = await client.get(
                f"{API_PREFIX}/test-plan-test-suites",
                params={"test_suite_id": "00000000-0000-0000-0000-000000000000"},
                headers=auth,
            )
            assert plan_reverse.status_code == 422
    finally:
        await _crud_cleanup(user_ids=user_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_the_new_read_permissions_are_seeded_and_gate_the_junction_routes() -> None:
    """**TC-ADMIN-062.** ADR-0072 adds two brand-new permission codes, so unlike every prior RBAC
    extension in this repo the `Permission` rows themselves had to be inserted
    by the migration, not just granted.

    Checked through the live server rather than by reading the catalog module:
    `GET /orgs/{org_id}/permissions/mine` is what actually resolves a caller's
    codes at request time, so it proves the migration's rows landed in *this*
    database — the thing `rbac_seed_catalog.py` alone cannot prove
    (`backend/CLAUDE.md`: editing the catalog only affects a fresh DB's seed).
    """
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "adr72-perm")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            token = _access_token_for(admin.actor_id)
            org_id = org.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/orgs/{org_id}/permissions/mine",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert response.status_code == 200
            # `MyPermissionsResponse.codes` is a list of `{code, project_id}`
            # grants, not bare strings — an org-wide grant carries
            # `project_id: None` (`app/schemas/rbac.py`).
            grants = response.json()["codes"]
            codes = {grant["code"] for grant in grants}
            assert "test_suite_test_case.read" in codes
            assert "test_plan_test_suite.read" in codes
            # Both must be org-wide, not project-scoped: `org_admin`'s grants
            # come from the seeded system-role bundle, and a project-scoped one
            # would mean the migration backfilled the wrong `RoleAssignment`.
            for grant in grants:
                if grant["code"] in {"test_suite_test_case.read", "test_plan_test_suite.read"}:
                    assert grant["project_id"] is None, grant
    finally:
        await _crud_cleanup(user_ids=user_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_the_migration_upgrade_body_is_genuinely_idempotent() -> None:
    """**TC-ADMIN-062** (idempotency half). Re-running the migration must not duplicate rows.

    **Deliberately not a second `alembic upgrade head`.** `backend/CLAUDE.md`
    documents (ADMIN-5/TC-ADMIN-041) that once the database is already at a
    revision, the CLI computes an empty migration path and never re-enters the
    migration file's `upgrade()` body at all — so a row-count assertion around a
    second CLI call passes identically whether the insert-existence-check logic
    is correct or completely broken. The wording of this TC ("doing X again
    doesn't do Y") is exactly the shape that trap hides in.

    So `upgrade()` is invoked **twice, directly**, through a real
    `alembic.operations.Operations` context bound to the app's own async engine
    — bypassing Alembic's revision bookkeeping entirely, which is what makes the
    function body genuinely execute both times. The migration module is loaded
    via `importlib.util.spec_from_file_location` because its filename (a
    revision hash) is not a valid Python module identifier.
    """
    import importlib.util
    from pathlib import Path

    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy import func, select

    from app.db.session import engine
    from app.models.rbac import Permission, RolePermission

    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "7d2c91af4e68_seed_junction_link_read_permissions.py"
    )
    assert migration_path.exists(), migration_path
    spec = importlib.util.spec_from_file_location("_adr72_live_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    async def _counts() -> tuple[int, int]:
        async with AsyncSessionLocal() as session:
            permissions = (
                await session.execute(
                    select(func.count())
                    .select_from(Permission)
                    .where(Permission.code.in_(module._NEW_CODES))
                )
            ).scalar_one()
            grants = (
                await session.execute(
                    select(func.count())
                    .select_from(RolePermission)
                    .join(Permission, Permission.id == RolePermission.permission_id)
                    .where(Permission.code.in_(module._NEW_CODES))
                )
            ).scalar_one()
        return permissions, grants

    before = await _counts()
    # The precondition, asserted rather than assumed: exactly the two new
    # Permission rows exist, so a `0 == 0` pass is impossible.
    assert before[0] == 2, before
    assert before[1] >= len(module._ROLES_TO_GRANT) * 2, before

    def _run_upgrade_twice(sync_conn) -> None:
        ctx = MigrationContext.configure(sync_conn)
        with Operations.context(ctx):
            module.upgrade()
            module.upgrade()

    async with engine.connect() as conn:
        await conn.run_sync(_run_upgrade_twice)
        await conn.commit()

    assert await _counts() == before
