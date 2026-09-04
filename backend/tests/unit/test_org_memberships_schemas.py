"""Unit tests for RBAC-2 request/response schemas (`app/schemas/org_memberships.py`).

Pure Pydantic-model construction, no DB/network — mirrors the style of
`tests/unit/test_rbac1_schemas.py`.
"""

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.org_memberships import (
    AcceptInviteRequest,
    InviteMemberRequest,
    InviteMemberResponse,
    MemberListResponse,
    MemberSummary,
    PatchMembershipRequest,
)

# --- InviteMemberRequest -------------------------------------------------------------------


def test_invite_member_request_accepts_valid_email() -> None:
    request = InviteMemberRequest(email="new-member@example.com")
    assert request.email == "new-member@example.com"


def test_invite_member_request_rejects_malformed_email() -> None:
    with pytest.raises(ValidationError):
        InviteMemberRequest(email="not-an-email")


def test_invite_member_request_requires_email() -> None:
    with pytest.raises(ValidationError):
        InviteMemberRequest()


# --- MemberSummary --------------------------------------------------------------------------


def test_member_summary_accepts_each_status_value() -> None:
    for status in ("invited", "active", "suspended"):
        summary = MemberSummary(
            membership_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            email="member@example.com",
            status=status,
            joined_at=None,
        )
        assert summary.status == status


def test_member_summary_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        MemberSummary(
            membership_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            email="member@example.com",
            status="deleted",
            joined_at=None,
        )


def test_member_summary_joined_at_accepts_datetime_or_none() -> None:
    summary = MemberSummary(
        membership_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        email="member@example.com",
        status="active",
        joined_at=datetime.now(UTC),
    )
    assert summary.joined_at is not None


# --- MemberListResponse ----------------------------------------------------------------------


def test_member_list_response_wraps_items_with_pagination_fields() -> None:
    summary = MemberSummary(
        membership_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        email="member@example.com",
        status="active",
        joined_at=None,
    )
    response = MemberListResponse(items=[summary], total=1, page=1, page_size=25)
    assert response.items == [summary]
    assert response.total == 1


# --- InviteMemberResponse --------------------------------------------------------------------


def test_invite_member_response_new_email_has_non_null_invite_link() -> None:
    response = InviteMemberResponse(
        membership_id=uuid.uuid4(), status="invited", invite_link="https://example.com/invites/abc/accept"
    )
    assert response.invite_link is not None


def test_invite_member_response_existing_email_has_null_invite_link() -> None:
    response = InviteMemberResponse(membership_id=uuid.uuid4(), status="invited", invite_link=None)
    assert response.invite_link is None


def test_invite_member_response_rejects_non_invited_status() -> None:
    with pytest.raises(ValidationError):
        InviteMemberResponse(membership_id=uuid.uuid4(), status="active", invite_link=None)


# --- AcceptInviteRequest ---------------------------------------------------------------------


def test_accept_invite_request_requires_password() -> None:
    with pytest.raises(ValidationError):
        AcceptInviteRequest()


def test_accept_invite_request_accepts_password() -> None:
    request = AcceptInviteRequest(password="CorrectHorseBatteryStaple!1")
    assert request.password == "CorrectHorseBatteryStaple!1"


# --- PatchMembershipRequest ------------------------------------------------------------------


@pytest.mark.parametrize("status", ["invited", "active", "suspended"])
def test_patch_membership_request_accepts_each_schema_level_status(status: str) -> None:
    # Schema layer accepts all 3 OrgMembership.status values — the
    # "only active<->suspended is a legal transition through this route"
    # business rule is enforced in the route body, not here (see the
    # schema module's own docstring).
    request = PatchMembershipRequest(status=status)
    assert request.status == status


def test_patch_membership_request_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        PatchMembershipRequest(status="deleted")


def test_patch_membership_request_requires_status() -> None:
    with pytest.raises(ValidationError):
        PatchMembershipRequest()
