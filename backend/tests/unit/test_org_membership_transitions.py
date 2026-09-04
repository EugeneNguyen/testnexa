"""Unit tests for the RBAC-2 `OrgMembership.status` transition-legality rules
(`app/api/routes/org_memberships.py`).

Pure logic, no DB/HTTP — mirrors this repo's own "plain branching logic is
unit-test territory" boundary (see `tests/unit/test_rbac.py`'s
`_actor_requires_active_membership_check` tests). Source: ADR-0017 Decision
+ Test Design §5 ("OrgMembership.status" state-transition table).
"""

import pytest

from app.api.routes.org_memberships import _is_legal_patch_transition, _is_revocable
from app.models.tenancy import OrgMembershipStatus

# --- _is_legal_patch_transition ---------------------------------------------------------------
#
# ADR-0017: the ONLY legal transition through `PATCH
# /orgs/{org_id}/members/{membership_id}` is `active <-> suspended`.
# `invited -> active` is reachable only through the two accept routes, never
# this one; nothing ever moves a membership backward into `invited`.


@pytest.mark.parametrize(
    ("current", "requested"),
    [
        (OrgMembershipStatus.active, OrgMembershipStatus.suspended),
        (OrgMembershipStatus.suspended, OrgMembershipStatus.active),
        (OrgMembershipStatus.active, OrgMembershipStatus.active),
        (OrgMembershipStatus.suspended, OrgMembershipStatus.suspended),
    ],
)
def test_legal_patch_transitions(current: OrgMembershipStatus, requested: OrgMembershipStatus) -> None:
    assert _is_legal_patch_transition(current, requested) is True


@pytest.mark.parametrize(
    ("current", "requested"),
    [
        (OrgMembershipStatus.invited, OrgMembershipStatus.active),  # TC-RBAC-034
        (OrgMembershipStatus.active, OrgMembershipStatus.invited),  # TC-RBAC-034
        (OrgMembershipStatus.suspended, OrgMembershipStatus.invited),
        (OrgMembershipStatus.invited, OrgMembershipStatus.suspended),
        (OrgMembershipStatus.invited, OrgMembershipStatus.invited),
    ],
)
def test_illegal_patch_transitions(current: OrgMembershipStatus, requested: OrgMembershipStatus) -> None:
    assert _is_legal_patch_transition(current, requested) is False


# --- _is_revocable -----------------------------------------------------------------------------
#
# ADR-0017: DELETE is scoped to status = invited only — revokes a
# not-yet-accepted invite; 422 against an active/suspended membership
# (TC-RBAC-032/033).


def test_invited_membership_is_revocable() -> None:
    assert _is_revocable(OrgMembershipStatus.invited) is True


@pytest.mark.parametrize("status", [OrgMembershipStatus.active, OrgMembershipStatus.suspended])
def test_active_or_suspended_membership_is_not_revocable(status: OrgMembershipStatus) -> None:
    assert _is_revocable(status) is False
