"""PLAN-1: `TestPlan.status` transition legality (ADR-0031).

Source: [ADR-0031](../../../docs/adr/0031-plan1-test-plan-membership-and-status-transition-routes.md)'s
own transition table, and [Test Design §5](../../../docs/test-design/2026-09-03-test-design.md)
(`draft -> approved -> superseded`, the only legal path).

Deliberately a **pure** module: no FastAPI, no SQLAlchemy, no DB session, no
imports from `app.models`/`app.api`. Two reasons, both load-bearing:

1. Test Design §27 requires the illegal pairs be tested "as independent
   negative cases (not inferred from one another)" — an exhaustive
   legal-pairs table is only cheap to exercise exhaustively if the thing
   under test is a plain function over two strings, not an HTTP route needing
   a live server, a seeded plan, and a token per case.
2. §27 also names the specific failure mode this shape defends against: "a
   guard checking only 'is this one of the two known-good pairs' could still
   wrongly accept an untested illegal pair if the negative-space check is
   coded as an incomplete **allow-list** rather than an exhaustive
   legal-pairs table." `_LEGAL_TRANSITIONS` below is that exhaustive table,
   and `is_legal_status_transition` is closed by default — anything not
   literally in the table is illegal, including every same-state pair and
   every transition out of the terminal `superseded` state.

The guard this module backs governs transition **legality** only, never
**authority**. Who may move a plan to `approved` (a human-only, RBAC-5 gate
on GOV-1's own dedicated `POST /test-plans/{id}/approve` route) is GOV-1's
scope and is deliberately not conflated into this check — see ADR-0031's
Consequences for the interim gap that leaves open, which is flagged and
accepted, not an oversight to fix here.
"""

# Every legal `(current, requested)` pair, exhaustively. ADR-0031's table:
#
#   | Current      | Requested    | Result                        |
#   |--------------|--------------|-------------------------------|
#   | draft        | approved     | Allowed                       |
#   | approved     | superseded   | Allowed                       |
#   | draft        | superseded   | 409 (must pass via approved)  |
#   | approved     | draft        | 409 (backward)                |
#   | superseded   | anything     | 409 (terminal state)          |
#   | X            | X            | 409 (idempotent re-write)     |
#
# Anything absent from this frozenset is illegal — the set is the whole
# specification, not a fast path in front of one.
_LEGAL_TRANSITIONS: frozenset[tuple[str, str]] = frozenset(
    {
        ("draft", "approved"),
        ("approved", "superseded"),
    }
)

INVALID_STATUS_TRANSITION_CODE = "invalid_status_transition"
INVALID_STATUS_TRANSITION_MESSAGE = (
    "This test plan status transition is not allowed."
)


def is_legal_status_transition(current: str, requested: str) -> bool:
    """True only for a `(current, requested)` pair in ADR-0031's legal table.

    Both arguments are the enum's *string values* (`"draft"`/`"approved"`/
    `"superseded"`), not `TestPlanStatus` members — callers normalize first
    (the ORM hands back an enum member, the request body a plain string), so
    this function never has to know which layer it was called from.

    Same-state pairs (`draft`->`draft`, `approved`->`approved`) are **False**:
    Test Design §5 defines idempotent re-approval as rejected, a new plan
    version being the correct path per GOV-1. Any transition out of
    `superseded` is False too — it is a terminal state.

    An unrecognized status string on either side is False rather than an
    error: the schema layer (`TestPlanStatus`, a `Literal`) already rejects
    an unknown *requested* value with its own `422` long before this runs, so
    reaching here with one means something upstream changed, and the safe
    posture for a legality check is to deny.
    """
    return (current, requested) in _LEGAL_TRANSITIONS


__all__ = [
    "INVALID_STATUS_TRANSITION_CODE",
    "INVALID_STATUS_TRANSITION_MESSAGE",
    "is_legal_status_transition",
]
