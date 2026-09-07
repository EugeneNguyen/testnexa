"""Unit tests for PLAN-3's two bespoke routes' decision logic (ADR-0033).

No DB, no network, no live server: the two route coroutines are called
directly with a stub `AsyncSession` and the module-level collaborators
(`_org_membership_exists`, `has_permission`, the three `chain_resolver`
expressions) monkeypatched. What this buys over the integration suite is
*isolation of the branch under test* — each test here holds every other input
fixed and varies exactly one thing, so a failure names the branch that broke
rather than "something in the create path".

Test Design §29 is explicit that the two cross-project checks
(`release_id`, `environment_id`) must be exercised **independently**, "since
the two are separate `if` branches in the route, not one shared comparison" —
a fix (or a regression) scoped to only one field must not be able to pass the
other's case. TC-PLAN-015 and TC-PLAN-016 are therefore two separate test
functions with two separate fixtures here, exactly as they are in the
integration suite; this file is the fast, isolated half of that pair, not a
substitute for it.

Also covered:

- the `404`-before-`422` ordering for a *cross-org* related row (NFR-1
  existence-hiding — a different org is `404`, only a same-org/different-project
  row is `422`);
- the scope-check query's shape (`_test_case_is_in_plan_scope`), asserted
  against the compiled SQL so the "reuses PLAN-1's own two-hop join" claim is
  pinned rather than trusted;
- the generic-factory restrictions TC-PLAN-017 depends on
  (`_TEST_EXECUTION_CONFIG`/`_TEST_CYCLE_CONFIG` register no `create`).
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.responses import JSONResponse

from app.api.routes import execution_authoring, test_cycle_creation
from app.api.routes.execution import _TEST_EXECUTION_CONFIG
from app.api.routes.planning import _TEST_CYCLE_CONFIG
from app.models.planning import Environment, TestCycle, TestPlan
from app.models.project import Release
from app.schemas.execution import CreateExecutionForCycleRequest
from app.schemas.planning import CreateTestCycleRequest

ORG_ID = UUID("00000000-0000-0000-0000-0000000000c0")
OTHER_ORG_ID = UUID("00000000-0000-0000-0000-0000000000c1")
PROJECT_A = UUID("00000000-0000-0000-0000-0000000000a0")
PROJECT_B = UUID("00000000-0000-0000-0000-0000000000b0")


class _StubSession:
    """Minimal `AsyncSession` stand-in.

    `get(Model, pk)` reads from a `{(Model, pk): row}` map — that is the only
    session API either route uses before the branch under test decides. `add`/
    `flush`/`commit`/`refresh` are recorded so a test can assert that a
    *rejected* request wrote nothing, which is the property that would break if
    a check were accidentally moved below the insert.
    """

    def __init__(self, rows: dict) -> None:
        self._rows = rows
        self.added: list = []
        self.flushed = False
        self.committed = False

    async def get(self, model, pk):
        return self._rows.get((model, pk))

    def add(self, row) -> None:
        self.added.append(row)

    async def flush(self) -> None:
        # A real flush runs the column's own `default=generate_uuid7`, so the
        # route can read `row.id` back for its response. Mirrored here (rather
        # than left `None`) because otherwise every *successful* path would
        # fail on response construction for a reason that has nothing to do
        # with the branch under test.
        self.flushed = True
        for row in self.added:
            if getattr(row, "id", None) is None:
                row.id = uuid4()

    async def commit(self) -> None:
        self.committed = True

    async def refresh(self, row) -> None:
        return None

    async def rollback(self) -> None:
        return None

    async def scalar(self, statement):
        raise AssertionError("no test in this file should reach a raw scalar() query")


def _actor() -> SimpleNamespace:
    return SimpleNamespace(actor_id=uuid4())


def _body(status_code_holder: JSONResponse) -> dict:
    """Decode a `JSONResponse`'s rendered body back to a dict."""
    import json

    return json.loads(status_code_holder.body)


# --- POST /test-plans/{id}/test-cycles ----------------------------------------------------------


def _patch_cycle_route(
    monkeypatch: pytest.MonkeyPatch,
    *,
    plan_org: UUID | None = ORG_ID,
    release_org: UUID | None = ORG_ID,
    environment_org: UUID | None = ORG_ID,
    is_member: bool = True,
    has_perm: bool = True,
) -> None:
    """Fix every collaborator except the branch a given test varies."""

    async def _resolve_plan(_db, _row):
        return plan_org

    async def _resolve_release(_db, _row):
        return release_org

    async def _resolve_environment(_db, _row):
        return environment_org

    async def _membership(_db, _org_id, _actor_id):
        return is_member

    async def _permission(_actor_id, _org_id, _code):
        return has_perm

    monkeypatch.setattr(test_cycle_creation, "_resolve_test_plan_org_id", _resolve_plan)
    monkeypatch.setattr(test_cycle_creation, "_resolve_release_org_id", _resolve_release)
    monkeypatch.setattr(test_cycle_creation, "_resolve_environment_org_id", _resolve_environment)
    monkeypatch.setattr(test_cycle_creation, "_org_membership_exists", _membership)
    monkeypatch.setattr(test_cycle_creation, "has_permission", _permission)


def _cycle_fixture(*, release_project: UUID, environment_project: UUID, plan_project: UUID = PROJECT_B):
    """Seed the three in-memory rows the route fetches, plus a matching body."""
    plan_id, release_id, environment_id = uuid4(), uuid4(), uuid4()
    plan = TestPlan(id=plan_id, project_id=plan_project)
    release = Release(id=release_id, project_id=release_project)
    environment = Environment(id=environment_id, project_id=environment_project)
    session = _StubSession(
        {
            (TestPlan, plan_id): plan,
            (Release, release_id): release,
            (Environment, environment_id): environment,
        }
    )
    payload = CreateTestCycleRequest(
        release_id=release_id,
        environment_id=environment_id,
        name="A cycle",
    )
    return session, plan_id, payload


@pytest.mark.asyncio
async def test_cycle_create_cross_project_release_is_422(monkeypatch: pytest.MonkeyPatch) -> None:
    """TC-PLAN-015, isolated: "Release in Project A; TestPlan in Project B (same
    org)" -> "`422 validation_error`, never `404` (caller already proved org
    membership)".

    The `environment_id` here is a **valid same-project** Environment, so the
    only thing that can produce a rejection is the release branch. That is the
    whole point of keeping this separate from TC-PLAN-016 below.
    """
    _patch_cycle_route(monkeypatch)
    session, plan_id, payload = _cycle_fixture(
        release_project=PROJECT_A,  # the one thing that differs
        environment_project=PROJECT_B,
    )

    response = await test_cycle_creation.create_test_cycle_for_plan(
        plan_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 422
    assert response.status_code != 404
    body = _body(response)
    assert body["code"] == "validation_error"
    assert "release" in body["message"].lower()
    # The rejection happened before any insert.
    assert session.added == []
    assert session.committed is False


@pytest.mark.asyncio
async def test_cycle_create_cross_project_environment_is_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """TC-PLAN-016, isolated: "Environment in Project A; TestPlan in Project B
    (same org)" -> "`422 validation_error`, never `404` — tested independently
    of TC-PLAN-015 (a fix scoped to only one of the two fields must not pass
    this case)".

    Mirror image of the test above: the `release_id` is a **valid same-project**
    Release, so only the environment branch can reject.
    """
    _patch_cycle_route(monkeypatch)
    session, plan_id, payload = _cycle_fixture(
        release_project=PROJECT_B,
        environment_project=PROJECT_A,  # the one thing that differs
    )

    response = await test_cycle_creation.create_test_cycle_for_plan(
        plan_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 422
    assert response.status_code != 404
    body = _body(response)
    assert body["code"] == "validation_error"
    assert "environment" in body["message"].lower()
    assert session.added == []
    assert session.committed is False


@pytest.mark.asyncio
async def test_cycle_create_same_project_release_and_environment_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The positive control for the two tests above.

    Without it, a route that rejected *everything* would pass both cross-project
    cases — the same "both directions in one fixture" reasoning Test Design §29
    applies to the execution scope check, applied here to the create path.
    """
    _patch_cycle_route(monkeypatch)
    session, plan_id, payload = _cycle_fixture(
        release_project=PROJECT_B,
        environment_project=PROJECT_B,
    )

    response = await test_cycle_creation.create_test_cycle_for_plan(
        plan_id, payload, actor=_actor(), db=session
    )

    assert not isinstance(response, JSONResponse), getattr(response, "body", response)
    assert response.name == "A cycle"
    assert len(session.added) == 1
    assert isinstance(session.added[0], TestCycle)
    assert session.committed is True


@pytest.mark.asyncio
async def test_cycle_create_cross_org_release_is_404_not_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """NFR-1 boundary, the distinction most likely to be miscoded: a release in
    a **different org** is `404` (indistinguishable from nonexistent), not the
    cross-project `422`.

    A `422` here would confirm the foreign row exists — an existence leak across
    an org boundary (ADR-0007). Note the release is also in a different
    *project*, so a route that checked project-match before org-match would
    still return `422` and fail this test, which is exactly what it is for.
    """
    _patch_cycle_route(monkeypatch, release_org=OTHER_ORG_ID)
    session, plan_id, payload = _cycle_fixture(
        release_project=PROJECT_A,
        environment_project=PROJECT_B,
    )

    response = await test_cycle_creation.create_test_cycle_for_plan(
        plan_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 404
    assert _body(response)["code"] == "not_found"


@pytest.mark.asyncio
async def test_cycle_create_cross_org_environment_is_404_not_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The environment-side mirror of the boundary above — again a separate
    branch over a separate row, so it needs its own case.
    """
    _patch_cycle_route(monkeypatch, environment_org=OTHER_ORG_ID)
    session, plan_id, payload = _cycle_fixture(
        release_project=PROJECT_B,
        environment_project=PROJECT_A,
    )

    response = await test_cycle_creation.create_test_cycle_for_plan(
        plan_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 404
    assert _body(response)["code"] == "not_found"


@pytest.mark.asyncio
async def test_cycle_create_without_membership_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """No `OrgMembership` in the plan's resolved org -> `404`, never `403`."""
    _patch_cycle_route(monkeypatch, is_member=False)
    session, plan_id, payload = _cycle_fixture(
        release_project=PROJECT_B, environment_project=PROJECT_B
    )

    response = await test_cycle_creation.create_test_cycle_for_plan(
        plan_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_cycle_create_without_permission_is_403(monkeypatch: pytest.MonkeyPatch) -> None:
    """Membership present, `test_cycle.create` missing -> `403`, and crucially
    **before** either related-row lookup, so a caller without permission cannot
    probe which release/environment ids exist.
    """
    _patch_cycle_route(monkeypatch, has_perm=False)
    session, plan_id, payload = _cycle_fixture(
        release_project=PROJECT_A, environment_project=PROJECT_A
    )

    response = await test_cycle_creation.create_test_cycle_for_plan(
        plan_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 403
    assert _body(response)["code"] == "permission_denied"


@pytest.mark.asyncio
async def test_cycle_create_missing_plan_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_cycle_route(monkeypatch)
    session = _StubSession({})
    payload = CreateTestCycleRequest(
        release_id=uuid4(), environment_id=uuid4(), name="A cycle"
    )

    response = await test_cycle_creation.create_test_cycle_for_plan(
        uuid4(), payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 404


# --- POST /test-cycles/{id}/executions -----------------------------------------------------------


def _patch_execution_route(
    monkeypatch: pytest.MonkeyPatch,
    *,
    cycle_org: UUID | None = ORG_ID,
    test_case_org: UUID | None = ORG_ID,
    in_scope: bool = True,
    is_member: bool = True,
    has_perm: bool = True,
) -> None:
    async def _resolve_cycle(_db, _row):
        return cycle_org

    async def _resolve_case(_db, _row):
        return test_case_org

    # EXEC-2: this route now uses `_actor_membership_exists(db, org_id,
    # actor)` (the whole `User | AIAgent` actor, not just its id) --
    # `backend/CLAUDE.md`'s standing rule for any route gated on org
    # membership that takes a `User | AIAgent` actor. Signature updated to
    # match; every caller in this file still only cares about `is_member`.
    async def _membership(_db, _org_id, _actor):
        return is_member

    async def _permission(_actor_id, _org_id, _code):
        return has_perm

    async def _scope(_db, _plan_id, _case_id):
        return in_scope

    monkeypatch.setattr(execution_authoring, "_resolve_test_cycle_org_id", _resolve_cycle)
    monkeypatch.setattr(execution_authoring, "resolve_test_case_org_id", _resolve_case)
    monkeypatch.setattr(execution_authoring, "_actor_membership_exists", _membership)
    monkeypatch.setattr(execution_authoring, "has_permission", _permission)
    monkeypatch.setattr(execution_authoring, "_test_case_is_in_plan_scope", _scope)


def _execution_fixture():
    from app.models.assets import TestCase

    cycle_id, case_id, plan_id = uuid4(), uuid4(), uuid4()
    cycle = TestCycle(id=cycle_id, test_plan_id=plan_id)
    test_case = TestCase(id=case_id)
    session = _StubSession({(TestCycle, cycle_id): cycle, (TestCase, case_id): test_case})
    payload = CreateExecutionForCycleRequest(
        test_case_id=case_id,
        result="pass",
        actual_result="ok",
        executed_at=datetime(2026, 9, 6, 10, 30, tzinfo=UTC),
    )
    return session, cycle_id, payload


@pytest.mark.asyncio
async def test_execution_out_of_scope_test_case_is_422_not_404(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """TC-PLAN-008's negative half, isolated: a `TestCase` that resolves to the
    caller's own org but is **not** covered by the cycle's plan -> `422
    validation_error`, never `404`.

    `404` would be wrong here for a specific, documented reason (ADR-0033's
    accepted trade-off): by this point the caller has proven org membership AND
    the `TestCase` has resolved to a real row in that same org, so there is no
    existence left to hide — this is FR-PLAN-3 AC3's own business-rule claim.
    """
    _patch_execution_route(monkeypatch, in_scope=False)
    session, cycle_id, payload = _execution_fixture()

    response = await execution_authoring.create_execution_for_cycle(
        cycle_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 422
    assert response.status_code != 404
    assert _body(response)["code"] == "validation_error"
    assert session.added == []
    assert session.committed is False


@pytest.mark.asyncio
async def test_execution_in_scope_test_case_is_201_and_stamps_the_caller(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """TC-PLAN-008's positive half, plus §29's `executed_by_actor_id` stamping
    class at the route layer: the persisted row's `executed_by_actor_id` is the
    authenticated actor's own id.

    Both directions live in this file for the same reason §29 requires them in
    one integration fixture — a scope check that always rejected would pass the
    negative test above on its own.
    """
    _patch_execution_route(monkeypatch, in_scope=True)
    session, cycle_id, payload = _execution_fixture()
    actor = _actor()

    response = await execution_authoring.create_execution_for_cycle(
        cycle_id, payload, actor=actor, db=session
    )

    assert not isinstance(response, JSONResponse), getattr(response, "body", response)
    # EXEC-2: the create route now also appends a `TestLog` row in the same
    # transaction (`build_status_change_log`) -- `session.added` holds both.
    assert len(session.added) == 2
    assert session.added[0].executed_by_actor_id == actor.actor_id
    log = session.added[1]
    assert log.event_type.value == "status_change"
    assert log.payload == {
        "kind": "status_change",
        "from": None,
        "to": "pass",
        "actor_id": str(actor.actor_id),
        "actor_type": "user",
    }
    assert response.executed_by_actor_id == actor.actor_id
    assert response.result == "pass"
    assert session.committed is True


@pytest.mark.asyncio
async def test_execution_cross_org_test_case_is_404_not_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """§29's "cross-org 404 boundary, `TestCase` side": a `test_case_id`
    resolving to a different org is `404`, not the in-scope `422` — and the
    check must fire *before* the scope query, which is why `in_scope` is left
    `True` here. A route that ran the scope check first would return `422` and
    leak that the foreign `TestCase` exists.
    """
    _patch_execution_route(monkeypatch, test_case_org=OTHER_ORG_ID, in_scope=True)
    session, cycle_id, payload = _execution_fixture()

    response = await execution_authoring.create_execution_for_cycle(
        cycle_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 404
    assert _body(response)["code"] == "not_found"


@pytest.mark.asyncio
async def test_execution_without_permission_is_403(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_execution_route(monkeypatch, has_perm=False)
    session, cycle_id, payload = _execution_fixture()

    response = await execution_authoring.create_execution_for_cycle(
        cycle_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 403
    assert _body(response)["code"] == "permission_denied"


@pytest.mark.asyncio
async def test_execution_cross_org_cycle_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_execution_route(monkeypatch, is_member=False)
    session, cycle_id, payload = _execution_fixture()

    response = await execution_authoring.create_execution_for_cycle(
        cycle_id, payload, actor=_actor(), db=session
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 404


# --- the scope-check query's own shape -----------------------------------------------------------


@pytest.mark.asyncio
async def test_scope_check_query_reuses_plan1s_two_hop_join() -> None:
    """ADR-0033's "reuses PLAN-1's coverage-query join verbatim — no new query
    shape invented" claim, pinned against the compiled SQL rather than trusted.

    The failure mode this guards against is subtle and would not show up as a
    crash: a scope check that joined only `TestSuiteTestCase` (forgetting the
    `TestPlanTestSuite` hop) would accept **any** `TestCase` that is in **any**
    suite anywhere, silently defeating FR-PLAN-3 AC3 while still returning
    plausible `201`/`422`s for a fixture where the two happen to coincide.
    """
    captured: list = []

    class _CapturingSession:
        async def scalar(self, statement):
            captured.append(statement)
            return True

    plan_id, case_id = uuid4(), uuid4()
    result = await execution_authoring._test_case_is_in_plan_scope(
        _CapturingSession(), plan_id, case_id
    )

    assert result is True
    assert len(captured) == 1
    sql = str(captured[0].compile(compile_kwargs={"literal_binds": True}))
    # Both hops of PLAN-1's join must be present...
    assert "test_suite_test_case" in sql
    assert "test_plan_test_suite" in sql
    assert "test_plan_test_suite.test_suite_id = test_suite_test_case.test_suite_id" in sql
    # ...and both filters, so the check is scoped to this plan AND this case.
    # `.hex` (not `str()`): SQLAlchemy's `Uuid` type renders a literal bind as
    # the unhyphenated 32-char form.
    assert plan_id.hex in sql
    assert case_id.hex in sql
    # `EXISTS`, not a full paginated list (ADR-0033).
    assert "EXISTS" in sql.upper()


@pytest.mark.asyncio
async def test_scope_check_coerces_a_falsy_result_to_false() -> None:
    """The return is `bool(...)`, so a driver returning `None`/`0` cannot leak
    through as a truthy "covered" answer.
    """

    class _FalsySession:
        async def scalar(self, _statement):
            return None

    assert (
        await execution_authoring._test_case_is_in_plan_scope(_FalsySession(), uuid4(), uuid4())
        is False
    )


# --- generic-factory restrictions (TC-PLAN-017's unit-level counterpart) --------------------------


def test_test_execution_config_registers_no_create() -> None:
    """TC-PLAN-017 at the config layer: `POST /test-executions` is gone.

    Asserted as a route-table/config inspection rather than only a runtime
    `405`, matching how §29 frames the read-only-entity class — and asserted
    alongside the *unaffected* half, so a future change that removed all four
    methods (rather than just `create`) is caught as a regression rather than
    read as "the restriction still holds."
    """
    assert "create" not in _TEST_EXECUTION_CONFIG.methods
    assert _TEST_EXECUTION_CONFIG.create_schema is None
    for still_registered in ("list", "get", "update", "delete"):
        assert still_registered in _TEST_EXECUTION_CONFIG.methods, still_registered


def test_test_cycle_config_still_registers_no_create() -> None:
    """`TestCycle`'s create stays bespoke-only (ADR-0033 / PLAN-3 UI Design
    Document's explicit non-goal) — the admin surface must not grow a generic
    create that would bypass the cross-project checks.
    """
    assert "create" not in _TEST_CYCLE_CONFIG.methods
    assert _TEST_CYCLE_CONFIG.create_schema is None
    for still_registered in ("list", "get", "update", "delete"):
        assert still_registered in _TEST_CYCLE_CONFIG.methods, still_registered
