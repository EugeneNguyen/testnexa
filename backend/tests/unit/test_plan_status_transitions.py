"""Unit tests for PLAN-1's `TestPlan.status` transition guard (ADR-0031).

No DB, no network, no live server — `app.core.plan_status` is a pure module by
design (see its own docstring), and `_test_plan_status_guard` is a plain
synchronous function over an ORM row and a dict, so both are exercisable here
rather than only through the integration suite.

Covers Test Design §27's "Status-transition-guard classes", which is explicit
about *how* these must be written, not just what they assert:

- The illegal pairs are tested "as independent negative cases (not inferred
  from one another)", because "a guard checking only 'is this one of the two
  known-good pairs' could still wrongly accept an untested illegal pair if the
  negative-space check is coded as an incomplete allow-list rather than an
  exhaustive legal-pairs table." `test_every_transition_pair_matches_the_adr_table`
  below therefore enumerates the **full 3x3 cross-product** of statuses and
  pins each cell against ADR-0031's table — an implementation that special-cased
  only the pairs someone remembered to write a test for cannot pass it.
- **Non-status-field independence:** a `PATCH` body with no `status` key is
  unaffected by the guard regardless of the plan's current status, "tested
  against a `superseded` (terminal-state) plan specifically, to prove the guard
  scopes to the `status` field alone, not the whole route."

The integration suite covers the same guard over real HTTP (status codes, error
bodies, persistence); these tests cover the decision table itself, where an
exhaustive sweep is cheap.
"""

import pytest

from app.api.routes.planning import _test_plan_status_guard
from app.core.plan_status import (
    INVALID_STATUS_TRANSITION_CODE,
    is_legal_status_transition,
)
from app.models.planning import TestPlanStatus

ALL_STATUSES = ("draft", "approved", "superseded")

# ADR-0031's table, transcribed as data. Exactly two cells are `True`; every
# other cell in the 3x3 cross-product is `False`, including all three
# same-state pairs (Test Design §5: idempotent re-approval is rejected, a new
# plan version is the correct path) and every transition out of the terminal
# `superseded` state.
LEGAL_PAIRS = {
    ("draft", "approved"),
    ("approved", "superseded"),
}


class _FakePlan:
    """Minimal stand-in for a `TestPlan` row — the guard only reads `.status`.

    Deliberately not a real `TestPlan` instance: constructing one would pull in
    SQLAlchemy's instrumentation and a DB-shaped set of required columns for a
    function that touches exactly one attribute. Both the enum-member and the
    plain-string forms of `status` are exercised below, which is the real
    type-hazard this guard has to survive.
    """

    def __init__(self, status: object) -> None:
        self.status = status


@pytest.mark.parametrize("current", ALL_STATUSES)
@pytest.mark.parametrize("requested", ALL_STATUSES)
def test_every_transition_pair_matches_the_adr_table(current: str, requested: str) -> None:
    """All 9 `(current, requested)` pairs, each pinned independently.

    The exhaustive sweep is the point (Test Design §27): it closes the
    incomplete-allow-list failure mode by leaving no pair untested, so a guard
    that happened to accept e.g. `superseded -> approved` cannot slip through on
    the grounds that nobody wrote that specific case.
    """
    expected = (current, requested) in LEGAL_PAIRS
    assert is_legal_status_transition(current, requested) is expected


def test_exactly_two_transitions_are_legal() -> None:
    """Guards the table's *size*, not just its contents.

    A change that widened the legal set (e.g. re-allowing idempotent
    re-approval) would still pass every individual pair assertion above if the
    parametrized expectations were edited to match — this asserts the count
    independently, so widening the rule requires deliberately changing this
    number and re-reading ADR-0031.
    """
    legal = [
        (current, requested)
        for current in ALL_STATUSES
        for requested in ALL_STATUSES
        if is_legal_status_transition(current, requested)
    ]
    assert sorted(legal) == [("approved", "superseded"), ("draft", "approved")]


@pytest.mark.parametrize("status", ALL_STATUSES)
def test_same_state_transition_is_always_rejected(status: str) -> None:
    """`X -> X` is illegal for every status (Test Design §5's explicit call).

    Covered by the cross-product above too; kept as its own named test because
    "idempotent re-approval is rejected" is a deliberate product decision that
    reads as a bug to anyone who assumes PATCH should be idempotent, and a
    failing test named for the rule is easier to interpret than one failing
    cell of a parametrized matrix.
    """
    assert is_legal_status_transition(status, status) is False


@pytest.mark.parametrize("requested", ALL_STATUSES)
def test_superseded_is_terminal(requested: str) -> None:
    """Nothing leaves `superseded` — ADR-0031's "terminal state" row."""
    assert is_legal_status_transition("superseded", requested) is False


def test_unrecognized_status_values_are_denied_not_raised() -> None:
    """An unknown status on either side denies rather than raising.

    The `TestPlanStatus` `Literal` in the request schema already `422`s an
    unknown *requested* value long before the guard runs, so reaching here with
    one means something upstream changed — and the safe posture for a legality
    check is to deny, not to raise a 500.
    """
    assert is_legal_status_transition("draft", "archived") is False
    assert is_legal_status_transition("archived", "approved") is False
    assert is_legal_status_transition("", "") is False


# --- the guard wrapper itself ----------------------------------------------------------------


def test_guard_returns_none_when_body_has_no_status_key() -> None:
    """A `PATCH` that never mentions `status` is untouched by the guard."""
    plan = _FakePlan(TestPlanStatus.draft)
    assert _test_plan_status_guard(plan, {"identifier": "TP-1", "scope": "x"}) is None


@pytest.mark.parametrize(
    "updates",
    [
        {"identifier": "TP-RENAMED"},
        {"scope": "new scope"},
        {"approach": "risk-based"},
        {"staffing_and_training": "2 testers"},
        {"schedule": "Q4"},
        {"identifier": "TP-X", "scope": "s", "approach": "a"},
    ],
)
def test_guard_ignores_non_status_fields_even_on_a_terminal_plan(updates: dict) -> None:
    """Test Design §27's "non-status-field independence", against `superseded`.

    The terminal state is chosen deliberately: it is the one status from which
    *no* transition is legal, so a guard that mistakenly scoped itself to the
    whole route (rejecting any `PATCH` of a superseded plan) would fail here
    while still passing every status-pair test above.
    """
    plan = _FakePlan(TestPlanStatus.superseded)
    assert _test_plan_status_guard(plan, updates) is None


def test_guard_returns_none_for_an_explicit_null_status() -> None:
    """`status: null` is not a transition request.

    The column is non-nullable and the factory's own `create` path already
    treats an explicit `null` `status` as equivalent to omitting it. Relabeling
    it as a `409` here would be wrong — it is malformed input, already handled
    by the factory's existing `IntegrityError` -> `422` branch.
    """
    plan = _FakePlan(TestPlanStatus.draft)
    assert _test_plan_status_guard(plan, {"status": None}) is None


@pytest.mark.parametrize(("current", "requested"), sorted(LEGAL_PAIRS))
def test_guard_allows_the_legal_transitions(current: str, requested: str) -> None:
    """A legal pair returns `None` — the factory proceeds with the update."""
    plan = _FakePlan(TestPlanStatus(current))
    assert _test_plan_status_guard(plan, {"status": requested}) is None


@pytest.mark.parametrize(
    ("current", "requested"),
    sorted(
        (c, r)
        for c in ALL_STATUSES
        for r in ALL_STATUSES
        if (c, r) not in LEGAL_PAIRS
    ),
)
def test_guard_rejects_every_illegal_transition_with_409(current: str, requested: str) -> None:
    """Each of the 7 illegal pairs returns a `409 invalid_status_transition`.

    Asserts the status code *and* the error `code` string, since the frontend's
    edit modal branches on that code specifically (UI Design Document §4) — a
    guard that rejected with a generic `422`/`409` body would break that
    surfacing while still "rejecting" the transition.
    """
    plan = _FakePlan(TestPlanStatus(current))
    response = _test_plan_status_guard(plan, {"status": requested})

    assert response is not None
    assert response.status_code == 409
    assert INVALID_STATUS_TRANSITION_CODE in response.body.decode()


def test_guard_normalizes_enum_and_string_status_forms() -> None:
    """The model/schema type-name collision cannot silently defeat the guard.

    `app.models.planning.TestPlanStatus` (a `str` enum, what the ORM hands
    back) and `app.schemas.planning.TestPlanStatus` (a `Literal`, what the
    request body carries) share a name but are different types. The guard
    normalizes both sides to their string value; this pins that, so a
    refactor comparing an enum member against an equal-looking `str` — which
    would make *every* transition look illegal, or every one legal — fails
    here rather than in production.
    """
    # Enum member on the row (the real ORM shape), plain string requested.
    assert _test_plan_status_guard(_FakePlan(TestPlanStatus.draft), {"status": "approved"}) is None
    # Plain string on the row (defensive: a detached//raw row), same result.
    assert _test_plan_status_guard(_FakePlan("draft"), {"status": "approved"}) is None
    # And the illegal direction rejects under both row forms.
    assert _test_plan_status_guard(_FakePlan(TestPlanStatus.draft), {"status": "superseded"}) is not None
    assert _test_plan_status_guard(_FakePlan("draft"), {"status": "superseded"}) is not None
