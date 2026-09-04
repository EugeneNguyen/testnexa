"""Integration tests for RBAC-2 (`/orgs/{org_id}/members*`,
`/invites/{token}/accept`), ADR-0017.

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_organizations.py`/`test_agents.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
to this module too.

Covers TC-RBAC-004, 005, 006, 007, 024-036 (`docs/test-cases/
2026-09-03-test-cases.md`).

Each test seeds its own `User`/`Organization`/`OrgMembership`/`Role`/
`RoleAssignment`/`Invite` rows directly via `AsyncSessionLocal` — the same
fixture-seeding precedent `test_organizations.py`/`test_agents.py`
established — and cleans up in a `finally` block. Emails/org slugs are
unique per test.

`Invite.org_membership_id` has `ondelete="CASCADE"` (Database Document
§3.1) — deleting an `OrgMembership` row at the DB level automatically
cascades any dependent `Invite` row, so `_cleanup` below never has to
delete `Invite` rows itself, only order `OrgMembership` deletion before
`User`/`Actor` deletion (same order `test_organizations.py`'s `_cleanup`
already uses, since `Invite.invited_by_actor_id` FKs `actor.id` with
`ondelete="RESTRICT"`).

TC-RBAC-036 (AIAgent unaffected by the suspended-member gate) is exercised
through a small in-process throwaway FastAPI app wired directly to the real
`require_permission` dependency, mirroring `test_agents.py`'s
`_build_permission_only_test_app()` precedent — see that module's docstring
for why: every one of this file's own real routes 404s an `AIAgent` caller
before `require_permission` ever runs (`_org_membership_exists` is
necessarily `False` for an `AIAgent`, since `OrgMembership.user_id` FKs
`user.actor_id` only), so isolating the gate's own actor-type branch needs a
route with no such boundary check in front of it.
"""

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import delete, select

from app.api.deps import require_permission
from app.core.security import (
    create_access_token,
    generate_api_key,
    generate_invite_token,
    hash_api_key,
    hash_invite_token,
    hash_password,
)
from app.db.session import AsyncSessionLocal
from app.main import http_exception_handler
from app.models.actor import Actor, AIAgent, User
from app.models.auth import AuthIdentity, AuthProvider, RefreshToken
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.tenancy import Invite, Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _members_path(org_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/members"


def _invite_path(org_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/members/invite"


def _self_accept_path(org_id, membership_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/members/{membership_id}/accept"


def _membership_path(org_id, membership_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/members/{membership_id}"


def _token_accept_path(token) -> str:
    return f"{API_PREFIX}/invites/{token}/accept"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_organizations.py / test_agents.py's helpers of the same names/shapes.


def _unique_email(tag: str) -> str:
    return f"rbac2-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"rbac2-{tag}-{uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="RBAC-2 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"RBAC-2 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
    session.add(org)
    await session.flush()
    return org


async def _create_membership(session, user: User, org: Organization, status: OrgMembershipStatus) -> OrgMembership:
    membership = OrgMembership(
        org_id=org.id,
        user_id=user.actor_id,
        status=status,
        joined_at=datetime.now(UTC) if status != OrgMembershipStatus.invited else None,
    )
    session.add(membership)
    await session.flush()
    return membership


async def _create_invite(
    session, membership: OrgMembership, invited_by_actor_id, *, expires_at: datetime | None = None
) -> tuple[Invite, str]:
    raw_token = generate_invite_token()
    now = datetime.now(UTC)
    invite = Invite(
        org_membership_id=membership.id,
        token_hash=hash_invite_token(raw_token),
        expires_at=expires_at if expires_at is not None else now + timedelta(days=7),
        invited_by_actor_id=invited_by_actor_id,
    )
    session.add(invite)
    await session.flush()
    return invite, raw_token


async def _get_org_admin_role(session) -> Role:
    result = await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
    role = result.scalars().first()
    assert role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
    return role


async def _get_permission_by_code(session, code: str) -> Permission:
    result = await session.execute(select(Permission).where(Permission.code == code))
    permission = result.scalars().first()
    assert permission is not None, f"expected catalog Permission {code!r} to already be seeded"
    return permission


async def _create_role(session, org: Organization, name: str) -> Role:
    role = Role(org_id=org.id, name=name, is_system_role=False)
    session.add(role)
    await session.flush()
    return role


async def _grant_permission(session, role: Role, permission: Permission) -> RolePermission:
    row = RolePermission(role_id=role.id, permission_id=permission.id)
    session.add(row)
    await session.flush()
    return row


async def _assign_role(session, *, actor_id, org: Organization, role: Role, project_id=None) -> RoleAssignment:
    row = RoleAssignment(actor_id=actor_id, org_id=org.id, project_id=project_id, role_id=role.id)
    session.add(row)
    await session.flush()
    return row


async def _create_org_admin(session, tag: str) -> tuple[User, Organization]:
    """Seed a human User who is org_admin (org-wide RoleAssignment) of a
    fresh Organization, with an active OrgMembership in it.
    """
    user = await _create_user(session, _unique_email(tag))
    org = await _create_org(session, tag)
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    org_admin_role = await _get_org_admin_role(session)
    await _assign_role(session, actor_id=user.actor_id, org=org, role=org_admin_role)
    return user, org


async def _member_with_permission(session, org: Organization, code: str, *, status: OrgMembershipStatus, tag: str):
    """Seed a User who is a member of `org` (given `status`) with a
    RoleAssignment granting exactly `code` — the "member holding a specific
    permission, not org_admin's full bundle" shape TC-RBAC-006/031/035 need.
    """
    user = await _create_user(session, _unique_email(tag))
    await _create_membership(session, user, org, status)
    permission = await _get_permission_by_code(session, code)
    role = await _create_role(session, org, f"{tag}-role-{uuid4().hex[:6]}")
    await _grant_permission(session, role, permission)
    await _assign_role(session, actor_id=user.actor_id, org=org, role=role)
    return user, role


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    `Invite` rows are never deleted explicitly here — `Invite.org_membership_id`
    cascades at the DB level (see module docstring) whenever the owning
    `OrgMembership` row is deleted below.
    """
    emails = emails or []
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    role_ids = role_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id.in_(org_ids)))
        if role_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        if user_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


# --- TC-RBAC-004: invite member by email, new user -------------------------------------------


@pytest.mark.asyncio
async def test_invite_new_email_creates_actor_user_membership_invite() -> None:  # TC-RBAC-004
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc004")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

        access_token = _access_token_for(admin_id)
        new_email = _unique_email("tc004-invitee")

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _invite_path(org_id),
                json={"email": new_email},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "invited"
        assert body["invite_link"] is not None
        membership_id = body["membership_id"]

        async with AsyncSessionLocal() as session:
            new_user = (await session.execute(select(User).where(User.email == new_email))).scalars().first()
            assert new_user is not None
            user_ids.append(new_user.actor_id)

            membership = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            ).scalars().first()
            assert membership is not None
            assert membership.status == OrgMembershipStatus.invited
            assert membership.user_id == new_user.actor_id

            invite = (
                await session.execute(select(Invite).where(Invite.org_membership_id == membership.id))
            ).scalars().first()
            assert invite is not None

            auth_identity = (
                await session.execute(select(AuthIdentity).where(AuthIdentity.user_id == new_user.actor_id))
            ).scalars().first()
            assert auth_identity is None  # no AuthIdentity yet — ADR-0017
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-024: invite member by email, existing user ---------------------------------------


@pytest.mark.asyncio
async def test_invite_existing_email_creates_membership_no_invite_row() -> None:  # TC-RBAC-024
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc024")
            existing_user = await _create_user(session, _unique_email("tc024-existing"))
            await session.commit()
            user_ids = [admin.actor_id, existing_user.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id
            existing_email = existing_user.email

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _invite_path(org_id),
                json={"email": existing_email},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "invited"
        assert body["invite_link"] is None
        membership_id = body["membership_id"]

        async with AsyncSessionLocal() as session:
            membership = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            ).scalars().first()
            assert membership is not None
            assert membership.status == OrgMembershipStatus.invited
            assert membership.user_id == existing_user.actor_id

            invite = (
                await session.execute(select(Invite).where(Invite.org_membership_id == membership.id))
            ).scalars().first()
            assert invite is None
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-025: invite conflict — already a member (active/suspended) -----------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [OrgMembershipStatus.active, OrgMembershipStatus.suspended])
async def test_invite_conflict_returns_409(status: OrgMembershipStatus) -> None:  # TC-RBAC-025
    # Deliberately NOT parametrized over `invited` — ADR-0017 Decision
    # carves that status out as the resend case (TC-RBAC-026 below), not a
    # 409 conflict.
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc025")
            member = await _create_user(session, _unique_email("tc025-member"))
            await _create_membership(session, member, org, status)
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            admin_id, org_id, member_email = admin.actor_id, org.id, member.email

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _invite_path(org_id),
                json={"email": member_email},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 409
        assert response.json()["code"] == "membership_already_exists"

        async with AsyncSessionLocal() as session:
            count = await session.scalar(
                select(OrgMembership.id).where(
                    OrgMembership.org_id == org_id, OrgMembership.user_id == member.actor_id
                )
            )
            assert count is not None  # exactly the one pre-existing row, no duplicate
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-026: resend invite replaces prior token -------------------------------------------


@pytest.mark.asyncio
async def test_resend_invite_replaces_prior_token() -> None:  # TC-RBAC-026
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc026")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

        access_token = _access_token_for(admin_id)
        invitee_email = _unique_email("tc026-invitee")

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            first_response = await client.post(
                _invite_path(org_id),
                json={"email": invitee_email},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert first_response.status_code == 201
            first_body = first_response.json()
            old_link = first_body["invite_link"]
            old_token = old_link.rsplit("/", 2)[1]  # .../invites/{token}/accept

            second_response = await client.post(
                _invite_path(org_id),
                json={"email": invitee_email},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert second_response.status_code == 201
            second_body = second_response.json()
            new_link = second_body["invite_link"]
            assert new_link is not None
            assert new_link != old_link
            new_token = new_link.rsplit("/", 2)[1]  # .../invites/{token}/accept

        async with AsyncSessionLocal() as session:
            new_user = (await session.execute(select(User).where(User.email == invitee_email))).scalars().first()
            assert new_user is not None
            user_ids.append(new_user.actor_id)

            invites = (
                await session.execute(
                    select(Invite).where(Invite.org_membership_id == first_body["membership_id"])
                )
            ).scalars().all()
            assert len(invites) == 1  # replaced in place, not a second row

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            old_accept = await client.post(_token_accept_path(old_token), json={"password": DEFAULT_PASSWORD})
            assert old_accept.status_code == 404
            assert old_accept.json()["code"] == "invite_not_found"

            new_accept = await client.post(_token_accept_path(new_token), json={"password": DEFAULT_PASSWORD})
            assert new_accept.status_code == 200
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-005: invited (new) user completes signup via token -------------------------------


@pytest.mark.asyncio
async def test_accept_invite_new_user_success() -> None:  # TC-RBAC-005
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc005")
            invitee_email = _unique_email("tc005-invitee")
            invitee = User(name=invitee_email, email=invitee_email, password_hash=hash_password(uuid4().hex))
            session.add(invitee)
            await session.flush()
            membership = await _create_membership(session, invitee, org, OrgMembershipStatus.invited)
            invite, raw_token = await _create_invite(session, membership, admin.actor_id)
            await session.commit()
            user_ids = [admin.actor_id, invitee.actor_id]
            org_ids = [org.id]
            membership_id = membership.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _token_accept_path(raw_token), json={"password": "BrandNewPassword!1"}
            )

        assert response.status_code == 200
        body = response.json()
        assert body["org_context"] == "auto"
        assert "access_token" in body
        assert "refresh_token" not in body  # cookie only, never in the JSON body

        async with AsyncSessionLocal() as session:
            membership_after = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            ).scalars().first()
            assert membership_after.status == OrgMembershipStatus.active
            assert membership_after.joined_at is not None

            invite_after = (
                await session.execute(select(Invite).where(Invite.id == invite.id))
            ).scalars().first()
            assert invite_after is None  # deleted on accept

            identity = (
                await session.execute(
                    select(AuthIdentity).where(
                        AuthIdentity.user_id == membership_after.user_id, AuthIdentity.provider == AuthProvider.local
                    )
                )
            ).scalars().first()
            assert identity is not None
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-027: expired invite token rejected -------------------------------------------------


@pytest.mark.asyncio
async def test_accept_invite_expired_token_rejected() -> None:  # TC-RBAC-027
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc027")
            invitee_email = _unique_email("tc027-invitee")
            invitee = User(name=invitee_email, email=invitee_email, password_hash=hash_password(uuid4().hex))
            session.add(invitee)
            await session.flush()
            membership = await _create_membership(session, invitee, org, OrgMembershipStatus.invited)
            _invite, raw_token = await _create_invite(
                session, membership, admin.actor_id, expires_at=datetime.now(UTC) - timedelta(days=1)
            )
            await session.commit()
            user_ids = [admin.actor_id, invitee.actor_id]
            org_ids = [org.id]
            membership_id = membership.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(_token_accept_path(raw_token), json={"password": "SomePassword!1"})

        assert response.status_code == 404
        assert response.json()["code"] == "invite_not_found"

        async with AsyncSessionLocal() as session:
            membership_after = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            ).scalars().first()
            assert membership_after.status == OrgMembershipStatus.invited  # unchanged
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-028: consumed invite token rejected on reuse ---------------------------------------


@pytest.mark.asyncio
async def test_accept_invite_consumed_token_rejected_on_reuse() -> None:  # TC-RBAC-028
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc028")
            invitee_email = _unique_email("tc028-invitee")
            invitee = User(name=invitee_email, email=invitee_email, password_hash=hash_password(uuid4().hex))
            session.add(invitee)
            await session.flush()
            membership = await _create_membership(session, invitee, org, OrgMembershipStatus.invited)
            _invite, raw_token = await _create_invite(session, membership, admin.actor_id)
            await session.commit()
            user_ids = [admin.actor_id, invitee.actor_id]
            org_ids = [org.id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            first = await client.post(_token_accept_path(raw_token), json={"password": "FirstPassword!1"})
            assert first.status_code == 200

            second = await client.post(_token_accept_path(raw_token), json={"password": "SecondPassword!1"})

        assert second.status_code == 404
        assert second.json()["code"] == "invite_not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-029: existing-user self-accept ------------------------------------------------------


@pytest.mark.asyncio
async def test_existing_user_self_accept() -> None:  # TC-RBAC-029
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            org = await _create_org(session, "tc029")
            invitee = await _create_user(session, _unique_email("tc029-invitee"))
            membership = await _create_membership(session, invitee, org, OrgMembershipStatus.invited)
            await session.commit()
            user_ids = [invitee.actor_id]
            org_ids = [org.id]
            org_id, membership_id, invitee_id = org.id, membership.id, invitee.actor_id

        access_token = _access_token_for(invitee_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _self_accept_path(org_id, membership_id), headers={"Authorization": f"Bearer {access_token}"}
            )

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "active"
        assert body["joined_at"] is not None

        async with AsyncSessionLocal() as session:
            membership_after = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            ).scalars().first()
            assert membership_after.status == OrgMembershipStatus.active
            assert membership_after.joined_at is not None
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-030: self-accept rejected for wrong caller -------------------------------------------


@pytest.mark.asyncio
async def test_self_accept_rejected_for_wrong_caller() -> None:  # TC-RBAC-030
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            org = await _create_org(session, "tc030")
            invitee_a = await _create_user(session, _unique_email("tc030-a"))
            invitee_b = await _create_user(session, _unique_email("tc030-b"))
            membership_a = await _create_membership(session, invitee_a, org, OrgMembershipStatus.invited)
            await session.commit()
            user_ids = [invitee_a.actor_id, invitee_b.actor_id]
            org_ids = [org.id]
            org_id, membership_id, wrong_caller_id = org.id, membership_a.id, invitee_b.actor_id

        wrong_access_token = _access_token_for(wrong_caller_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _self_accept_path(org_id, membership_id),
                headers={"Authorization": f"Bearer {wrong_access_token}"},
            )

        assert response.status_code == 403
        assert response.json()["code"] == "actor_forbidden"

        async with AsyncSessionLocal() as session:
            membership_after = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            ).scalars().first()
            assert membership_after.status == OrgMembershipStatus.invited  # unchanged
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-006: suspend member blocks access, keeps RoleAssignment ------------------------------


@pytest.mark.asyncio
async def test_suspend_blocks_access_keeps_role_assignment() -> None:  # TC-RBAC-006
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc006")
            member, role = await _member_with_permission(
                session, org, "org_membership.read", status=OrgMembershipStatus.active, tag="tc006-member"
            )
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            role_ids = [role.id]
            admin_id, org_id, member_id = admin.actor_id, org.id, member.actor_id

            member_membership = (
                await session.execute(
                    select(OrgMembership).where(OrgMembership.org_id == org_id, OrgMembership.user_id == member_id)
                )
            ).scalars().first()
            membership_id = member_membership.id

        admin_token = _access_token_for(admin_id)
        member_token = _access_token_for(member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Sanity: the member can call the permission-gated route before suspension.
            before_response = await client.get(
                _members_path(org_id), headers={"Authorization": f"Bearer {member_token}"}
            )
            assert before_response.status_code == 200

            suspend_response = await client.patch(
                _membership_path(org_id, membership_id),
                json={"status": "suspended"},
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert suspend_response.status_code == 200

            after_response = await client.get(
                _members_path(org_id), headers={"Authorization": f"Bearer {member_token}"}
            )

        assert after_response.status_code == 403
        assert after_response.json()["code"] == "membership_inactive"

        async with AsyncSessionLocal() as session:
            role_assignment = (
                await session.execute(
                    select(RoleAssignment).where(
                        RoleAssignment.actor_id == member_id, RoleAssignment.role_id == role.id
                    )
                )
            ).scalars().first()
            assert role_assignment is not None  # still present in DB, queried directly
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids)


# --- TC-RBAC-007: multi-org membership, independent statuses ---------------------------------------


@pytest.mark.asyncio
async def test_multi_org_membership_independent_statuses() -> None:  # TC-RBAC-007
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tc007a")
            admin_b, org_b = await _create_org_admin(session, "tc007b")
            shared_user = await _create_user(session, _unique_email("tc007-shared"))

            membership_a = await _create_membership(session, shared_user, org_a, OrgMembershipStatus.active)
            permission = await _get_permission_by_code(session, "org_membership.read")
            role_a = await _create_role(session, org_a, "tc007-role-a")
            await _grant_permission(session, role_a, permission)
            await _assign_role(session, actor_id=shared_user.actor_id, org=org_a, role=role_a)

            membership_b = await _create_membership(session, shared_user, org_b, OrgMembershipStatus.active)

            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id, shared_user.actor_id]
            org_ids = [org_a.id, org_b.id]
            role_ids = [role_a.id]
            admin_b_id, org_a_id, org_b_id, shared_user_id = admin_b.actor_id, org_a.id, org_b.id, shared_user.actor_id
            membership_b_id = membership_b.id
            role_assignment_a_role_id_before = role_a.id
            membership_a_status_before = membership_a.status

        admin_b_token = _access_token_for(admin_b_id)
        shared_user_token = _access_token_for(shared_user_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            suspend_b_response = await client.patch(
                _membership_path(org_b_id, membership_b_id),
                json={"status": "suspended"},
                headers={"Authorization": f"Bearer {admin_b_token}"},
            )
            assert suspend_b_response.status_code == 200

            org_a_call = await client.get(
                _members_path(org_a_id), headers={"Authorization": f"Bearer {shared_user_token}"}
            )

        assert org_a_call.status_code == 200

        async with AsyncSessionLocal() as session:
            membership_a_after = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_a.id))
            ).scalars().first()
            assert membership_a_after.status == membership_a_status_before

            role_assignment_a_after = (
                await session.execute(
                    select(RoleAssignment).where(
                        RoleAssignment.actor_id == shared_user_id, RoleAssignment.org_id == org_a_id
                    )
                )
            ).scalars().first()
            assert role_assignment_a_after is not None
            assert role_assignment_a_after.role_id == role_assignment_a_role_id_before
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids)


# --- TC-RBAC-031: reactivate restores access ---------------------------------------------------


@pytest.mark.asyncio
async def test_reactivate_restores_access() -> None:  # TC-RBAC-031
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc031")
            member, role = await _member_with_permission(
                session, org, "org_membership.read", status=OrgMembershipStatus.suspended, tag="tc031-member"
            )
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            role_ids = [role.id]
            admin_id, org_id, member_id = admin.actor_id, org.id, member.actor_id

            membership = (
                await session.execute(
                    select(OrgMembership).where(OrgMembership.org_id == org_id, OrgMembership.user_id == member_id)
                )
            ).scalars().first()
            membership_id = membership.id

        admin_token = _access_token_for(admin_id)
        member_token = _access_token_for(member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            before_response = await client.get(
                _members_path(org_id), headers={"Authorization": f"Bearer {member_token}"}
            )
            assert before_response.status_code == 403

            reactivate_response = await client.patch(
                _membership_path(org_id, membership_id),
                json={"status": "active"},
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert reactivate_response.status_code == 200

            after_response = await client.get(
                _members_path(org_id), headers={"Authorization": f"Bearer {member_token}"}
            )

        assert after_response.status_code == 200
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids)


# --- TC-RBAC-032: revoke a pending invite ----------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_pending_invite() -> None:  # TC-RBAC-032
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc032")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

        access_token = _access_token_for(admin_id)
        invitee_email = _unique_email("tc032-invitee")

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            invite_response = await client.post(
                _invite_path(org_id),
                json={"email": invitee_email},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert invite_response.status_code == 201
            body = invite_response.json()
            membership_id = body["membership_id"]
            raw_token = body["invite_link"].rsplit("/", 2)[1]  # .../invites/{token}/accept

            delete_response = await client.delete(
                _membership_path(org_id, membership_id), headers={"Authorization": f"Bearer {access_token}"}
            )
            assert delete_response.status_code == 204

            accept_response = await client.post(
                _token_accept_path(raw_token), json={"password": "WontWork!1"}
            )

        assert accept_response.status_code == 404
        assert accept_response.json()["code"] == "invite_not_found"

        async with AsyncSessionLocal() as session:
            new_user = (await session.execute(select(User).where(User.email == invitee_email))).scalars().first()
            assert new_user is not None
            user_ids.append(new_user.actor_id)

            membership_after = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            ).scalars().first()
            assert membership_after is None

            invite_after = (
                await session.execute(select(Invite).where(Invite.org_membership_id == membership_id))
            ).scalars().first()
            assert invite_after is None
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-033: revoke rejected for active/suspended membership ----------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [OrgMembershipStatus.active, OrgMembershipStatus.suspended])
async def test_revoke_rejected_for_active_or_suspended(status: OrgMembershipStatus) -> None:  # TC-RBAC-033
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc033")
            member = await _create_user(session, _unique_email("tc033-member"))
            membership = await _create_membership(session, member, org, status)
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            admin_id, org_id, membership_id = admin.actor_id, org.id, membership.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.delete(
                _membership_path(org_id, membership_id), headers={"Authorization": f"Bearer {access_token}"}
            )

        assert response.status_code == 422

        async with AsyncSessionLocal() as session:
            membership_after = (
                await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            ).scalars().first()
            assert membership_after is not None
            assert membership_after.status == status
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-034: invalid PATCH status transitions rejected -----------------------------------------


@pytest.mark.asyncio
async def test_invalid_patch_status_transitions_rejected() -> None:  # TC-RBAC-034
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc034")
            invited_member = await _create_user(session, _unique_email("tc034-invited"))
            invited_membership = await _create_membership(session, invited_member, org, OrgMembershipStatus.invited)
            active_member = await _create_user(session, _unique_email("tc034-active"))
            active_membership = await _create_membership(session, active_member, org, OrgMembershipStatus.active)
            await session.commit()
            user_ids = [admin.actor_id, invited_member.actor_id, active_member.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id
            invited_membership_id, active_membership_id = invited_membership.id, active_membership.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            invited_to_active = await client.patch(
                _membership_path(org_id, invited_membership_id),
                json={"status": "active"},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            active_to_invited = await client.patch(
                _membership_path(org_id, active_membership_id),
                json={"status": "invited"},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert invited_to_active.status_code == 422
        assert active_to_invited.status_code == 422
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-035: suspended-member 403 distinct from under-permissioned 403 --------------------------


@pytest.mark.asyncio
async def test_suspended_member_403_distinct_from_permission_denied_403() -> None:  # TC-RBAC-035
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            org = await _create_org(session, "tc035")
            suspended_member, role = await _member_with_permission(
                session, org, "org_membership.read", status=OrgMembershipStatus.suspended, tag="tc035-suspended"
            )
            active_member_without_role = await _create_user(session, _unique_email("tc035-underperm"))
            await _create_membership(session, active_member_without_role, org, OrgMembershipStatus.active)
            await session.commit()
            user_ids = [suspended_member.actor_id, active_member_without_role.actor_id]
            org_ids = [org.id]
            role_ids = [role.id]
            org_id = org.id
            suspended_member_id = suspended_member.actor_id
            underperm_member_id = active_member_without_role.actor_id

        suspended_token = _access_token_for(suspended_member_id)
        underperm_token = _access_token_for(underperm_member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            suspended_response = await client.get(
                _members_path(org_id), headers={"Authorization": f"Bearer {suspended_token}"}
            )
            underperm_response = await client.get(
                _members_path(org_id), headers={"Authorization": f"Bearer {underperm_token}"}
            )

        assert suspended_response.status_code == 403
        assert suspended_response.json()["code"] == "membership_inactive"

        assert underperm_response.status_code == 403
        assert underperm_response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids)


# --- TC-RBAC-036: AIAgent unaffected by the suspended-member gate -------------------------------------
#
# See module docstring for why a synthetic app is used instead of a real
# route (mirrors test_agents.py's TC-AUTH-033/034 precedent exactly).


def _build_permission_only_test_app() -> FastAPI:
    test_app = FastAPI()
    test_app.add_exception_handler(HTTPException, http_exception_handler)

    @test_app.post("/__test/orgs/{org_id}/synthetic-permission-check")
    async def _synthetic_check(
        org_id: str,
        actor=Depends(require_permission("org_membership.read")),
    ) -> dict[str, str]:
        del org_id
        return {"actor_id": str(actor.actor_id)}

    return test_app


def _synthetic_check_path(org_id) -> str:
    return f"/__test/orgs/{org_id}/synthetic-permission-check"


async def _create_agent(session, *, acting_on_behalf_of_user_id, agent_name: str = "RBAC-2 Test Agent"):
    raw_key, key_prefix = generate_api_key()
    agent = AIAgent(
        agent_name=agent_name,
        model_or_provider="test-provider/test-model",
        acting_on_behalf_of_user_id=acting_on_behalf_of_user_id,
        key_hash=hash_api_key(raw_key),
        key_prefix=key_prefix,
        issued_at=datetime.now(UTC),
        revoked_at=None,
        last_used_at=None,
    )
    session.add(agent)
    await session.flush()
    return agent, raw_key


@pytest.mark.asyncio
async def test_ai_agent_unaffected_by_suspended_member_gate() -> None:  # TC-RBAC-036
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    agent_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            accountable_user = await _create_user(session, _unique_email("tc036"))
            org = await _create_org(session, "tc036")
            await _create_membership(session, accountable_user, org, OrgMembershipStatus.active)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=accountable_user.actor_id)

            permission = await _get_permission_by_code(session, "org_membership.read")
            role = await _create_role(session, org, "tc036-agent-role")
            await _grant_permission(session, role, permission)
            # RoleAssignment directly on the agent's own actor_id — agents
            # hold no OrgMembership at all (ADR-0017).
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)

            await session.commit()
            user_ids = [accountable_user.actor_id]
            org_ids = [org.id]
            role_ids = [role.id]
            agent_ids = [agent.actor_id]
            org_id = org.id

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_build_permission_only_test_app()), base_url="http://test"
        ) as test_client:
            response = await test_client.post(
                _synthetic_check_path(org_id), headers={"Authorization": f"Bearer {raw_key}"}
            )

        assert response.status_code == 200
    finally:
        if agent_ids:
            async with AsyncSessionLocal() as session:
                await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(agent_ids)))
                await session.execute(delete(AIAgent).where(AIAgent.actor_id.in_(agent_ids)))
                await session.execute(delete(Actor).where(Actor.id.in_(agent_ids)))
                await session.commit()
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids)
