"""Integration tests for PLAN-2's `EntryExitCriteria` visibility surfaces (ADR-0032).

Routes under test:
- the pre-existing generic-CRUD routes for `EntryExitCriteria`
  (`POST`/`GET /entry-exit-criteria`, `PATCH`/`DELETE /entry-exit-criteria/{id}`),
  which ADR-0032 explicitly leaves untouched — TC-PLAN-004 exercises them as the
  add/edit/delete round trip `TestPlanDetail`'s new section drives;
- `GET /releases/{id}/test-cycles` (ADR-0019, response shape extended by
  ADR-0032), which now nests an `exit_criteria` array per cycle and gates on a
  fourth permission code.

Real HTTP via `httpx.AsyncClient` against a live server (`TEST_API_BASE_URL`),
matching `test_planning_test_plans.py`'s / `test_releases.py`'s established
style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse, session-scoped) applies to this module too.

Covers TC-PLAN-004, 005, 012, 013 from
`docs/test-cases/2026-09-03-test-cases.md`, plus the multi-cycle-same-plan
batching class `docs/test-design/2026-09-03-test-design.md` §28 adds on top of
them.

Four things §28 / the TCs' own wording are explicit about, each of which changes
what the test must actually *do*, not merely what it asserts:

- **TC-PLAN-004 is a create-then-immediate-READ round trip.** Every step is
  re-asserted against a fresh `GET` of the list, never against the write call's
  own response body: a `201`/`200` that echoed a plausible-looking row back
  without persisting it (or a row that inserts fine and then 404s as
  "unresolvable tenant" on the next read — `backend/CLAUDE.md`'s
  resolver-completeness rule, ADR-0029's precedent) passes a write-only
  assertion and fails this one.
- **TC-PLAN-005's fixture must be mixed-type.** §28: "a single-type fixture
  cannot distinguish 'correctly filtered' from 'nothing else existed to
  filter'". The plan below carries all four types, and the non-`exit` rows are
  asserted **absent** from `exit_criteria` by id — the negative assertion is the
  TC's own core claim, not a nice-to-have.
- **TC-PLAN-012 asserts key presence, not just emptiness.** `exit_criteria == []`
  alone passes vacuously against a `.get("exit_criteria", [])`-shaped read of an
  omitted key, so `"exit_criteria" in cycle` is asserted separately, and `is not
  None` on top of that. The plan still carries entry/suspension/resumption rows,
  so this proves type-filtering, not merely that the plan had no criteria.
- **TC-PLAN-013 is an independent case, not an inference.** §28: "a naive
  additive implementation could easily leave the route's permission check
  unchanged while only editing its response-building code". The narrow actor
  holds a bespoke (non-system) `Role` with exactly the pre-existing triple —
  every system role that can reach this route already holds the fourth code, so
  no system role can express this shape. A positive control in the same test
  (an otherwise identical actor whose only difference is holding
  `entry_exit_criteria.read` too) proves the `403` is caused by that one missing
  code and not by something else about the narrow grant.

Each test seeds its own rows and cleans up in a `finally` block; emails, org
slugs and names are unique per test.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase, TestCaseStatus
from app.models.auth import AuthIdentity, AuthProvider
from app.models.execution import TestExecution, TestExecutionResult
from app.models.planning import (
    EntryExitCriteria,
    EntryExitCriteriaType,
    Environment,
    TestCycle,
    TestPlan,
    TestPlanStatus,
)
from app.models.project import Project, Release
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"

# The pre-existing triple `GET /releases/{id}/test-cycles` was gated on before
# ADR-0032 (ADR-0019/NFR-26), and the fourth code ADR-0032 adds.
TRIPLE_PERMISSIONS = ["release.read", "test_cycle.read", "test_execution.read"]
FOURTH_PERMISSION = "entry_exit_criteria.read"


def _criteria_path() -> str:
    """`POST`/`GET` target — the generic factory's own collection route.

    `entry_exit_criteria` is the factory's one plural-path exception
    (`_PLURAL_PATH_EXCEPTIONS`): "criteria" is already plural, so the path is
    `/entry-exit-criteria`, not `/entry-exit-criterias`.
    """
    return f"{API_PREFIX}/entry-exit-criteria"


def _criteria_item_path(criteria_id) -> str:
    """`PATCH`/`DELETE` target."""
    return f"{API_PREFIX}/entry-exit-criteria/{criteria_id}"


def _release_test_cycles_path(release_id) -> str:
    """The audit query ADR-0032 nests `exit_criteria` onto."""
    return f"{API_PREFIX}/releases/{release_id}/test-cycles"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_planning_test_plans.py's and test_releases.py's helpers of the
# same names and shapes, with the EntryExitCriteria rows this story needs.


def _unique_email(tag: str) -> str:
    # `example.com` deliberately — never a reserved special-use TLD
    # (`.local`/`.test`/`.invalid`/`.example`), which `EmailStr` rejects at
    # login with a 422 that reads like a wrong password (backend/CLAUDE.md).
    return f"plan2-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"plan2-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"PLAN-2 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    # `User(...)` directly — never `Actor()` then `User(actor_id=...)`, which
    # breaks the joined-table mapper's identity tracking (backend/CLAUDE.md).
    user = User(name="PLAN-2 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"PLAN-2 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
    session.add(org)
    await session.flush()
    return org


async def _create_membership(
    session, user: User, org: Organization, status: OrgMembershipStatus
) -> OrgMembership:
    membership = OrgMembership(
        org_id=org.id,
        user_id=user.actor_id,
        status=status,
        joined_at=datetime.now(UTC) if status != OrgMembershipStatus.invited else None,
    )
    session.add(membership)
    await session.flush()
    return membership


async def _get_role_by_name(session, name: str) -> Role:
    """Look up one of RBAC-4's seeded system Roles (org_id IS NULL)."""
    result = await session.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    role = result.scalars().first()
    assert role is not None, f"expected the RBAC-4-seeded {name!r} system Role to already exist"
    return role


async def _get_permission_by_code(session, code: str) -> Permission:
    result = await session.execute(select(Permission).where(Permission.code == code))
    permission = result.scalars().first()
    assert permission is not None, f"expected catalog Permission {code!r} to already be seeded"
    return permission


async def _assign_role(session, *, actor_id, org: Organization, role: Role, project_id=None):
    row = RoleAssignment(actor_id=actor_id, org_id=org.id, project_id=project_id, role_id=role.id)
    session.add(row)
    await session.flush()
    return row


async def _create_org_admin(session, tag: str) -> tuple[User, Organization]:
    user = await _create_user(session, _unique_email(tag))
    org = await _create_org(session, tag)
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    org_admin_role = await _get_role_by_name(session, "org_admin")
    await _assign_role(session, actor_id=user.actor_id, org=org, role=org_admin_role)
    return user, org


async def _create_custom_role_member(
    session, tag: str, org: Organization, permission_codes: list[str]
) -> tuple[User, Role]:
    """Seed a User with an active membership and a bespoke org-scoped Role
    granting exactly `permission_codes`.

    TC-PLAN-013 needs an actor holding exactly the pre-existing triple and NOT
    `entry_exit_criteria.read` — a shape no system role can express, since
    `test_manager` (`entry_exit_criteria.*`), `org_admin` (superuser) and
    `auditor` (`.read` on every resource) all already hold the fourth code
    (ADR-0032). Same helper name/shape `test_releases.py` uses for TC-PROJ-015's
    exactly-2-of-3 sub-cases.
    """
    user = await _create_user(session, _unique_email(tag))
    await _create_membership(session, user, org, OrgMembershipStatus.active)

    role = Role(org_id=org.id, name=f"custom-{tag}-{uuid4().hex[:6]}", is_system_role=False)
    session.add(role)
    await session.flush()

    for code in permission_codes:
        permission = await _get_permission_by_code(session, code)
        session.add(RolePermission(role_id=role.id, permission_id=permission.id))
    await session.flush()

    await _assign_role(session, actor_id=user.actor_id, org=org, role=role)
    return user, role


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


def _auth_headers(actor_id) -> dict[str, str]:
    return {"Authorization": f"Bearer {_access_token_for(actor_id)}"}


async def _create_project(session, org: Organization, tag: str) -> Project:
    project = Project(org_id=org.id, name=_unique_name(tag))
    session.add(project)
    await session.flush()
    return project


async def _create_release(session, project: Project, tag: str) -> Release:
    release = Release(project_id=project.id, version_label=f"v-{tag}-{uuid4().hex[:6]}")
    session.add(release)
    await session.flush()
    return release


async def _create_test_plan(session, project: Project, actor_id, tag: str) -> TestPlan:
    plan = TestPlan(
        project_id=project.id,
        created_by_actor_id=actor_id,
        identifier=_unique_name(f"Plan {tag}"),
        scope=f"PLAN-2 seeded scope {tag}",
        status=TestPlanStatus.draft,
    )
    session.add(plan)
    await session.flush()
    return plan


async def _create_criteria(
    session, plan: TestPlan, criteria_type: EntryExitCriteriaType, condition_text: str
) -> EntryExitCriteria:
    row = EntryExitCriteria(
        test_plan_id=plan.id, type=criteria_type, condition_text=condition_text
    )
    session.add(row)
    await session.flush()
    return row


async def _create_environment(session, project: Project, tag: str) -> Environment:
    environment = Environment(project_id=project.id, name=_unique_name(f"Env {tag}"))
    session.add(environment)
    await session.flush()
    return environment


async def _create_test_level(session, tag: str) -> TestLevel:
    level = TestLevel(name=f"PLAN-2 Level {tag} {uuid4().hex[:8]}")
    session.add(level)
    await session.flush()
    return level


async def _create_test_type(session, tag: str) -> TestType:
    test_type = TestType(name=f"PLAN-2 Type {tag} {uuid4().hex[:8]}")
    session.add(test_type)
    await session.flush()
    return test_type


async def _create_test_case(
    session, actor_id, test_level: TestLevel, test_type: TestType, tag: str
) -> TestCase:
    test_case = TestCase(
        test_condition_id=None,
        test_level_id=test_level.id,
        test_type_id=test_type.id,
        created_by_actor_id=actor_id,
        title=_unique_name(f"TC {tag}"),
        status=TestCaseStatus.draft,
    )
    session.add(test_case)
    await session.flush()
    return test_case


async def _create_test_cycle(
    session, plan: TestPlan, release: Release, environment: Environment, tag: str
) -> TestCycle:
    cycle = TestCycle(
        test_plan_id=plan.id,
        release_id=release.id,
        environment_id=environment.id,
        name=_unique_name(f"Cycle {tag}"),
    )
    session.add(cycle)
    await session.flush()
    return cycle


async def _create_test_execution(
    session,
    cycle: TestCycle,
    test_case: TestCase,
    actor_id,
    result: TestExecutionResult = TestExecutionResult.passed,
) -> TestExecution:
    execution = TestExecution(
        test_cycle_id=cycle.id,
        test_case_id=test_case.id,
        executed_by_actor_id=actor_id,
        result=result,
        executed_at=datetime.now(UTC),
    )
    session.add(execution)
    await session.flush()
    return execution


# --- direct DB assertions (never inferred from a response body) ------------------------------


async def _criteria_rows_for_plan(test_plan_id) -> dict:
    """`{id: (type, condition_text)}` for one plan, read straight from the DB."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(EntryExitCriteria).where(EntryExitCriteria.test_plan_id == test_plan_id)
        )
        return {
            str(row.id): (
                row.type.value if hasattr(row.type, "value") else str(row.type),
                row.condition_text,
            )
            for row in result.scalars().all()
        }


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
    project_ids: list | None = None,
    release_ids: list | None = None,
    test_execution_ids: list | None = None,
    test_cycle_ids: list | None = None,
    test_case_ids: list | None = None,
    entry_exit_criteria_ids: list | None = None,
    test_plan_ids: list | None = None,
    environment_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Same shape as `test_releases.py`'s `_cleanup`, with `EntryExitCriteria`
    added: its rows go before the `TestPlan` they reference (the FK is
    `ON DELETE CASCADE`, but this suite never relies on cascade behavior to
    clean up — every child is deleted explicitly, so a test that leaves rows
    behind fails loudly here rather than silently depending on the DB).

    `entry_exit_criteria_ids` is belt-and-braces on top of a blanket
    delete-by-`test_plan_id`: a test that creates criteria rows over HTTP and
    then fails before recording their ids would otherwise orphan them.
    """
    emails = emails or []
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    role_ids = role_ids or []
    project_ids = project_ids or []
    release_ids = release_ids or []
    test_execution_ids = test_execution_ids or []
    test_cycle_ids = test_cycle_ids or []
    test_case_ids = test_case_ids or []
    entry_exit_criteria_ids = entry_exit_criteria_ids or []
    test_plan_ids = test_plan_ids or []
    environment_ids = environment_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        if test_execution_ids:
            await session.execute(
                delete(TestExecution).where(TestExecution.id.in_(test_execution_ids))
            )
        if test_cycle_ids:
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(test_cycle_ids)))
        if test_case_ids:
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if entry_exit_criteria_ids:
            await session.execute(
                delete(EntryExitCriteria).where(EntryExitCriteria.id.in_(entry_exit_criteria_ids))
            )
        if test_plan_ids:
            # Criteria created over HTTP whose ids a failing test never recorded.
            await session.execute(
                delete(EntryExitCriteria).where(EntryExitCriteria.test_plan_id.in_(test_plan_ids))
            )
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(test_plan_ids)))
        if environment_ids:
            await session.execute(delete(Environment).where(Environment.id.in_(environment_ids)))
        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))
        if release_ids:
            await session.execute(delete(Release).where(Release.id.in_(release_ids)))

        if user_ids:
            await session.execute(
                delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids))
            )
        if org_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id.in_(org_ids)))
        if role_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id.in_(role_ids)))
            await session.execute(delete(RolePermission).where(RolePermission.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        if user_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


# --- TC-PLAN-004: add, edit, delete entry/exit criteria ---------------------------------------


@pytest.mark.asyncio
async def test_add_edit_delete_entry_exit_criteria_round_trip() -> None:  # TC-PLAN-004
    """TC-PLAN-004 literally: "TestPlan exists" -> "POST one criteria row per
    type (entry/exit/suspension/resumption), then GET
    `/entry-exit-criteria?test_plan_id=` to confirm listed, then PATCH one row's
    `condition_text`, then DELETE another" -> "All 4 types listed against the
    plan after create; PATCH'd row reflects the edit on next GET; DELETE'd row
    absent on next GET".

    Written as the literal 4-step sequence, in order, on one plan — every one of
    the three "expected result" clauses is asserted against a **fresh `GET` of
    the list**, never against the write call's own response body:

    - a create-only assertion cannot catch the resolver-completeness class of
      bug (`backend/CLAUDE.md`, ADR-0029): the row inserts correctly and only
      the *subsequent read* exposes an unresolvable-tenant gap;
    - a `PATCH`-response-only assertion cannot catch a route that echoes the
      requested value back without persisting it;
    - a `DELETE`-status-only assertion cannot catch a `204` that deleted
      nothing.

    The PATCH step additionally re-asserts a **sibling** row unchanged, so a
    route missing its `WHERE id =` clause (updating every row sharing a
    `test_plan_id`) fails here rather than passing on the intended row alone —
    the same posture §24 established for `TestStep`'s independent-editability
    class.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    criteria_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "tc004")
            project = await _create_project(session, org, "tc004")
            plan = await _create_test_plan(session, project, user.actor_id, "tc004")
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            actor_id, plan_id = user.actor_id, plan.id

        headers = _auth_headers(actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            # --- step 1: POST one criteria row per type -------------------------------------
            created: dict[str, str] = {}  # type -> id
            for criteria_type in ("entry", "exit", "suspension", "resumption"):
                response = await client.post(
                    _criteria_path(),
                    json={
                        "test_plan_id": str(plan_id),
                        "type": criteria_type,
                        "condition_text": f"PLAN-2 {criteria_type} condition",
                    },
                    headers=headers,
                )
                assert response.status_code == 201, response.text
                body = response.json()
                assert body["type"] == criteria_type
                assert body["test_plan_id"] == str(plan_id)
                created[criteria_type] = body["id"]
                criteria_ids.append(body["id"])

            # --- step 2: GET /entry-exit-criteria?test_plan_id= to confirm listed -----------
            listed = await client.get(
                _criteria_path(), params={"test_plan_id": str(plan_id)}, headers=headers
            )
            assert listed.status_code == 200, listed.text
            listed_body = listed.json()
            items_by_id = {item["id"]: item for item in listed_body["items"]}

            # "All 4 types listed against the plan after create."
            assert listed_body["total"] == 4
            assert set(items_by_id) == set(created.values())
            assert {item["type"] for item in listed_body["items"]} == {
                "entry",
                "exit",
                "suspension",
                "resumption",
            }
            assert all(item["test_plan_id"] == str(plan_id) for item in listed_body["items"])

            # --- step 3: PATCH one row's condition_text -------------------------------------
            edited_id = created["exit"]
            untouched_id = created["entry"]
            new_text = "PLAN-2 edited exit condition — 100% of P1 test cases passed"
            patched = await client.patch(
                _criteria_item_path(edited_id),
                json={"condition_text": new_text},
                headers=headers,
            )
            assert patched.status_code == 200, patched.text

            after_patch = await client.get(
                _criteria_path(), params={"test_plan_id": str(plan_id)}, headers=headers
            )
            assert after_patch.status_code == 200, after_patch.text
            after_patch_by_id = {item["id"]: item for item in after_patch.json()["items"]}

            # "PATCH'd row reflects the edit on next GET."
            assert after_patch_by_id[edited_id]["condition_text"] == new_text
            # ...and its type is untouched by a body that never mentioned it.
            assert after_patch_by_id[edited_id]["type"] == "exit"
            # A sibling row is unaffected — no missing `WHERE id =`.
            assert after_patch_by_id[untouched_id]["condition_text"] == "PLAN-2 entry condition"

            # --- step 4: DELETE another -----------------------------------------------------
            deleted_id = created["suspension"]
            deleted = await client.delete(_criteria_item_path(deleted_id), headers=headers)
            assert deleted.status_code == 204, deleted.text

            after_delete = await client.get(
                _criteria_path(), params={"test_plan_id": str(plan_id)}, headers=headers
            )
            assert after_delete.status_code == 200, after_delete.text
            after_delete_body = after_delete.json()
            remaining_ids = {item["id"] for item in after_delete_body["items"]}

            # "DELETE'd row absent on next GET" — and only that row.
            assert deleted_id not in remaining_ids
            assert remaining_ids == {created["entry"], created["exit"], created["resumption"]}
            assert after_delete_body["total"] == 3

        # Persisted, not merely reflected by the list route: the same three
        # states re-read straight from the DB.
        db_rows = await _criteria_rows_for_plan(plan_id)
        assert set(db_rows) == {created["entry"], created["exit"], created["resumption"]}
        assert db_rows[edited_id] == ("exit", new_text)
        assert deleted_id not in db_rows
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            entry_exit_criteria_ids=criteria_ids,
        )


# --- TC-PLAN-005: exit criteria + execution progress on one view, type-filtered ----------------


@pytest.mark.asyncio
async def test_cycle_view_carries_executions_and_only_exit_criteria() -> None:  # TC-PLAN-005
    """TC-PLAN-005 literally: "TestPlan with both an `exit`-type row and a
    non-`exit`-type row; TestCycle running under it, with >=1 TestExecution" ->
    "GET `/releases/{id}/test-cycles`" -> "Response's matching `TestCycle` entry
    carries both its existing `executions` **and** a new `exit_criteria` array
    containing only the `exit`-type row — the non-`exit` row absent, not merely
    unasserted".

    The fixture is deliberately mixed-type (§28): the plan carries an `exit` row
    AND `entry`/`suspension`/`resumption` rows. Asserting only "the exit row is
    present" would pass identically against a route that filtered nothing at
    all, so each non-`exit` row's id is asserted **absent** from
    `exit_criteria` — that negative is the TC's own stated core claim.

    "Both ... and" is also literal: `executions` must be non-empty in the same
    response object, proving the new field was added alongside the existing one
    rather than replacing or shadowing it — AC2's "one view, no separate
    lookup" claim.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    test_execution_ids: list = []
    test_cycle_ids: list = []
    test_case_ids: list = []
    criteria_ids: list = []
    test_plan_ids: list = []
    environment_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "tc005")
            project = await _create_project(session, org, "tc005")
            release = await _create_release(session, project, "tc005")
            plan = await _create_test_plan(session, project, user.actor_id, "tc005")
            environment = await _create_environment(session, project, "tc005")
            level = await _create_test_level(session, "tc005")
            ttype = await _create_test_type(session, "tc005")
            case_a = await _create_test_case(session, user.actor_id, level, ttype, "tc005a")
            case_b = await _create_test_case(session, user.actor_id, level, ttype, "tc005b")

            # The engineered mix: one `exit` row plus one of every other type.
            exit_row = await _create_criteria(
                session, plan, EntryExitCriteriaType.exit, "All P1 test cases executed"
            )
            entry_row = await _create_criteria(
                session, plan, EntryExitCriteriaType.entry, "Build deployed to the test env"
            )
            suspension_row = await _create_criteria(
                session, plan, EntryExitCriteriaType.suspension, "Blocking defect open >2 days"
            )
            resumption_row = await _create_criteria(
                session, plan, EntryExitCriteriaType.resumption, "Blocking defect verified fixed"
            )

            cycle = await _create_test_cycle(session, plan, release, environment, "tc005")
            execution_a = await _create_test_execution(
                session, cycle, case_a, user.actor_id, TestExecutionResult.passed
            )
            execution_b = await _create_test_execution(
                session, cycle, case_b, user.actor_id, TestExecutionResult.fail
            )
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            release_ids.append(release.id)
            test_plan_ids.append(plan.id)
            environment_ids.append(environment.id)
            test_level_ids.append(level.id)
            test_type_ids.append(ttype.id)
            test_case_ids.extend([case_a.id, case_b.id])
            criteria_ids.extend(
                [exit_row.id, entry_row.id, suspension_row.id, resumption_row.id]
            )
            test_cycle_ids.append(cycle.id)
            test_execution_ids.extend([execution_a.id, execution_b.id])

            actor_id, release_id, cycle_id = user.actor_id, release.id, cycle.id
            exit_id = str(exit_row.id)
            non_exit_ids = {str(entry_row.id), str(suspension_row.id), str(resumption_row.id)}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.get(
                _release_test_cycles_path(release_id), headers=_auth_headers(actor_id)
            )

        assert response.status_code == 200, response.text
        body = response.json()
        by_id = {item["id"]: item for item in body}
        assert str(cycle_id) in by_id
        matching = by_id[str(cycle_id)]

        # "...carries both its existing `executions`..." — non-empty, unchanged.
        assert len(matching["executions"]) == 2
        assert {execution["result"] for execution in matching["executions"]} == {"pass", "fail"}

        # "...and a new `exit_criteria` array containing only the `exit`-type row"
        assert "exit_criteria" in matching
        returned_criteria_ids = [item["id"] for item in matching["exit_criteria"]]
        assert returned_criteria_ids == [exit_id]
        assert matching["exit_criteria"][0]["type"] == "exit"
        assert matching["exit_criteria"][0]["condition_text"] == "All P1 test cases executed"
        assert matching["exit_criteria"][0]["test_plan_id"] == str(matching["test_plan_id"])

        # "...the non-`exit` row absent, not merely unasserted" — the TC's own
        # core claim, asserted by id and by type, both directions.
        for absent_id in non_exit_ids:
            assert absent_id not in returned_criteria_ids, (
                f"non-exit criteria row {absent_id} leaked into exit_criteria — "
                "the type filter did not fire"
            )
        assert {item["type"] for item in matching["exit_criteria"]} == {"exit"}
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            release_ids=release_ids,
            test_execution_ids=test_execution_ids,
            test_cycle_ids=test_cycle_ids,
            test_case_ids=test_case_ids,
            entry_exit_criteria_ids=criteria_ids,
            test_plan_ids=test_plan_ids,
            environment_ids=environment_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-PLAN-012: empty state on the cycle view -----------------------------------------------


@pytest.mark.asyncio
async def test_cycle_view_exit_criteria_is_present_and_empty() -> None:  # TC-PLAN-012
    """TC-PLAN-012 literally: "TestCycle under a TestPlan with zero `exit`-type
    rows (plan may still have entry/suspension/resumption rows)" -> "GET
    `/releases/{id}/test-cycles`" -> "Matching cycle's `exit_criteria` is `[]`,
    never omitted or `null`".

    Two things the wording forces, both of which a naive `== []` alone would
    miss:

    - **The key must EXIST.** `"exit_criteria" in cycle` is asserted separately
      from the `== []` comparison, because an omitted key is exactly the failure
      mode "never omitted" names, and any read that tolerates a default would
      pass vacuously. `is not None` covers the `null` half of the same clause.
    - **The plan still carries the other three types.** The parenthetical is
      load-bearing: a plan with *no criteria at all* would return `[]` even from
      a route that ignored `type` entirely, so this fixture proves the empty
      result comes from type-filtering, not from emptiness.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    test_cycle_ids: list = []
    criteria_ids: list = []
    test_plan_ids: list = []
    environment_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "tc012")
            project = await _create_project(session, org, "tc012")
            release = await _create_release(session, project, "tc012")
            plan = await _create_test_plan(session, project, user.actor_id, "tc012")
            environment = await _create_environment(session, project, "tc012")

            # Zero `exit` rows, but NOT zero rows — one of each other type.
            entry_row = await _create_criteria(
                session, plan, EntryExitCriteriaType.entry, "Test env provisioned"
            )
            suspension_row = await _create_criteria(
                session, plan, EntryExitCriteriaType.suspension, "Environment unavailable"
            )
            resumption_row = await _create_criteria(
                session, plan, EntryExitCriteriaType.resumption, "Environment restored"
            )

            cycle = await _create_test_cycle(session, plan, release, environment, "tc012")
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            release_ids.append(release.id)
            test_plan_ids.append(plan.id)
            environment_ids.append(environment.id)
            criteria_ids.extend([entry_row.id, suspension_row.id, resumption_row.id])
            test_cycle_ids.append(cycle.id)

            actor_id, release_id, cycle_id = user.actor_id, release.id, cycle.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.get(
                _release_test_cycles_path(release_id), headers=_auth_headers(actor_id)
            )

        assert response.status_code == 200, response.text
        by_id = {item["id"]: item for item in response.json()}
        assert str(cycle_id) in by_id
        matching = by_id[str(cycle_id)]

        # "never omitted" — the key itself must be in the JSON object.
        assert "exit_criteria" in matching, (
            "exit_criteria key omitted from the cycle payload — TC-PLAN-012 requires "
            "it present-and-empty, not absent"
        )
        # "never ... `null`".
        assert matching["exit_criteria"] is not None
        # "...is `[]`".
        assert matching["exit_criteria"] == []
        # The empty state is not a broken-cycle state: executions is likewise
        # an explicit empty list on the same object.
        assert matching["executions"] == []
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            release_ids=release_ids,
            test_cycle_ids=test_cycle_ids,
            entry_exit_criteria_ids=criteria_ids,
            test_plan_ids=test_plan_ids,
            environment_ids=environment_ids,
        )


# --- TC-PLAN-013: the fourth permission is required independently ------------------------------


@pytest.mark.asyncio
async def test_cycle_view_requires_entry_exit_criteria_read_independently() -> None:  # TC-PLAN-013
    """TC-PLAN-013 literally: "Actor holds `release.read`+`test_cycle.read`+
    `test_execution.read` but not `entry_exit_criteria.read`" -> "GET
    `/releases/{id}/test-cycles`" -> "`403` — the pre-existing triple alone no
    longer suffices".

    The narrow actor gets a **bespoke, non-system** `Role` granting exactly the
    three codes: no seeded system role can express this shape, since
    `test_manager` (`entry_exit_criteria.*`), `org_admin` (superuser) and
    `auditor` (`.read` on all 29 resources) each already hold the fourth code
    (ADR-0032's "no RBAC bundle migration needed" finding).

    A **positive control** in the same test — a second actor in the same org,
    same three codes **plus** `entry_exit_criteria.read`, hitting the same
    release — is what makes the `403` mean what the TC says it means. Without
    it, the `403` is equally consistent with the route being broken for narrow
    grants generally; with it, the only difference between a `403` and a `200`
    is the one permission code this story added.

    The `403` body's `code` is asserted too (`permission_denied`, the route's
    own `_error` shape), same posture `test_releases.py`'s TC-PROJ-015 sub-cases
    already use for the pre-existing triple.
    """
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    project_ids: list = []
    release_ids: list = []
    test_cycle_ids: list = []
    criteria_ids: list = []
    test_plan_ids: list = []
    environment_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc013")
            project = await _create_project(session, org, "tc013")
            release = await _create_release(session, project, "tc013")
            plan = await _create_test_plan(session, project, admin.actor_id, "tc013")
            environment = await _create_environment(session, project, "tc013")
            exit_row = await _create_criteria(
                session, plan, EntryExitCriteriaType.exit, "Exit criteria for the gate test"
            )
            cycle = await _create_test_cycle(session, plan, release, environment, "tc013")

            # Exactly the pre-existing triple — the fourth code deliberately absent.
            narrow_user, narrow_role = await _create_custom_role_member(
                session, "tc013-narrow", org, list(TRIPLE_PERMISSIONS)
            )
            # Positive control: identical, plus the one code this story added.
            control_user, control_role = await _create_custom_role_member(
                session, "tc013-control", org, [*TRIPLE_PERMISSIONS, FOURTH_PERMISSION]
            )
            await session.commit()

            user_ids.extend([admin.actor_id, narrow_user.actor_id, control_user.actor_id])
            org_ids.append(org.id)
            role_ids.extend([narrow_role.id, control_role.id])
            project_ids.append(project.id)
            release_ids.append(release.id)
            test_plan_ids.append(plan.id)
            environment_ids.append(environment.id)
            criteria_ids.append(exit_row.id)
            test_cycle_ids.append(cycle.id)

            release_id, cycle_id = release.id, cycle.id
            narrow_id, control_id = narrow_user.actor_id, control_user.actor_id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            narrow_response = await client.get(
                _release_test_cycles_path(release_id), headers=_auth_headers(narrow_id)
            )
            control_response = await client.get(
                _release_test_cycles_path(release_id), headers=_auth_headers(control_id)
            )

        # "the pre-existing triple alone no longer suffices"
        assert narrow_response.status_code == 403, narrow_response.text
        assert narrow_response.json()["code"] == "permission_denied"

        # The control isolates the cause to the one missing code: same org, same
        # release, same three codes — plus `entry_exit_criteria.read` — is 200.
        assert control_response.status_code == 200, control_response.text
        control_by_id = {item["id"]: item for item in control_response.json()}
        assert str(cycle_id) in control_by_id
        assert [item["type"] for item in control_by_id[str(cycle_id)]["exit_criteria"]] == ["exit"]
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            role_ids=role_ids,
            project_ids=project_ids,
            release_ids=release_ids,
            test_cycle_ids=test_cycle_ids,
            entry_exit_criteria_ids=criteria_ids,
            test_plan_ids=test_plan_ids,
            environment_ids=environment_ids,
        )


# --- §28 multi-cycle-same-plan batching class --------------------------------------------------


@pytest.mark.asyncio
async def test_two_cycles_sharing_one_plan_each_carry_that_plans_exit_criteria() -> None:
    """§28's multi-cycle-same-plan batching class.

    Two `TestCycle`s under **one** `TestPlan` — a legal shape nothing prevents,
    and the exact reason ADR-0032 batches the criteria query by DISTINCT
    `test_plan_id` instead of issuing one per cycle. Both cycles must carry that
    plan's exit rows, identically and completely.

    A second plan in the same project, with its own exit row and its own cycle
    on the same release, is seeded alongside: without it, a route that ignored
    `test_plan_id` when grouping (attaching every fetched criteria row to every
    cycle) would still pass, since there would be nothing else to wrongly
    attach. The cross-plan row is therefore asserted **absent** from the shared
    plan's cycles, and vice versa.

    The query-count reduction itself is a code-review criterion (§28), not
    machine-asserted here — what this pins is that batching produces the same
    correct per-cycle result a naive per-cycle query would.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    test_cycle_ids: list = []
    criteria_ids: list = []
    test_plan_ids: list = []
    environment_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "batch")
            project = await _create_project(session, org, "batch")
            release = await _create_release(session, project, "batch")
            environment = await _create_environment(session, project, "batch")

            shared_plan = await _create_test_plan(session, project, user.actor_id, "shared")
            other_plan = await _create_test_plan(session, project, user.actor_id, "other")

            shared_exit_1 = await _create_criteria(
                session, shared_plan, EntryExitCriteriaType.exit, "Shared plan exit one"
            )
            shared_exit_2 = await _create_criteria(
                session, shared_plan, EntryExitCriteriaType.exit, "Shared plan exit two"
            )
            other_exit = await _create_criteria(
                session, other_plan, EntryExitCriteriaType.exit, "Other plan exit"
            )

            cycle_1 = await _create_test_cycle(session, shared_plan, release, environment, "b1")
            cycle_2 = await _create_test_cycle(session, shared_plan, release, environment, "b2")
            cycle_other = await _create_test_cycle(session, other_plan, release, environment, "b3")
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            release_ids.append(release.id)
            environment_ids.append(environment.id)
            test_plan_ids.extend([shared_plan.id, other_plan.id])
            criteria_ids.extend([shared_exit_1.id, shared_exit_2.id, other_exit.id])
            test_cycle_ids.extend([cycle_1.id, cycle_2.id, cycle_other.id])

            actor_id, release_id = user.actor_id, release.id
            shared_ids = {str(shared_exit_1.id), str(shared_exit_2.id)}
            other_id = str(other_exit.id)
            cycle_1_id, cycle_2_id, cycle_other_id = cycle_1.id, cycle_2.id, cycle_other.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.get(
                _release_test_cycles_path(release_id), headers=_auth_headers(actor_id)
            )

        assert response.status_code == 200, response.text
        by_id = {item["id"]: item for item in response.json()}
        assert set(by_id) == {str(cycle_1_id), str(cycle_2_id), str(cycle_other_id)}

        for cycle_id in (cycle_1_id, cycle_2_id):
            returned = {item["id"] for item in by_id[str(cycle_id)]["exit_criteria"]}
            assert returned == shared_ids
            assert other_id not in returned

        other_returned = {item["id"] for item in by_id[str(cycle_other_id)]["exit_criteria"]}
        assert other_returned == {other_id}
        assert not (other_returned & shared_ids)
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            release_ids=release_ids,
            test_cycle_ids=test_cycle_ids,
            entry_exit_criteria_ids=criteria_ids,
            test_plan_ids=test_plan_ids,
            environment_ids=environment_ids,
        )
