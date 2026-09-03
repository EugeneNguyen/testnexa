"""Integration tests for `POST /api/v1/auth/signup` (RBAC-1, ADR-0016).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_auth_login.py` / `test_agents.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
to this module too.

Covers TC-RBAC-001, TC-RBAC-020, TC-RBAC-021 from
`docs/test-cases/2026-09-03-test-cases.md`.

NOT covered here — a standalone "org_slug collision -> 422" scenario via
`POST /auth/signup` itself: inspection of the implemented route's order of
operations (`app/api/routes/auth.py::signup`) shows this is structurally
unreachable through the public HTTP route, not merely hard to set up. The
bootstrap-closed `409 signup_closed` check (`SELECT EXISTS(SELECT 1 FROM
organization)`) fires unconditionally whenever *any* Organization row
already exists, regardless of the submitted `org_slug`'s value -- so once a
real slug-collision target exists (i.e. at least one committed Organization
row), every subsequent signup call 409s before ever reaching the
org-creation step that would raise the slug's `IntegrityError`. And while
zero Organization rows exist, there is by definition no pre-existing slug
for the very first org being created to collide with -- confirmed directly
by TC-RBAC-020 below, whose losing concurrent call also gets `409
signup_closed`, never `422`. TC-RBAC-003's slug-uniqueness `422` assertion
is the genuinely reachable scenario for that behavior and is tested against
`POST /orgs` instead, in `test_organizations.py` (an already-authenticated
actor creating a *further* org, where a real pre-existing slug from a
different, already-committed org can collide).

Each test seeds/cleans up its own rows directly via `AsyncSessionLocal` (the
test process shares `DATABASE_URL` with the live server under test),
mirroring `test_auth_login.py`'s `finally`-block discipline. TC-RBAC-001 and
TC-RBAC-020 additionally require a genuinely zero-`Organization` DB state
(their own documented precondition, and per this task's brief the isolated
env's DB clone starts with 0 Organization rows) -- rather than assuming that
silently, each guards with a live count check and `pytest.skip`s with a
clear reason if the target DB unexpectedly already has organizations (e.g. a
prior interrupted run left rows behind), instead of failing confusingly or
corrupting another test's precondition.
"""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, func, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
SIGNUP_PATH = "/api/v1/auth/signup"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers ---------------------------------------------------------------


def _unique_email(tag: str) -> str:
    return f"rbac1-signup-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"rbac1-{tag}-{uuid4().hex[:8]}"


async def _organization_count() -> int:
    async with AsyncSessionLocal() as session:
        result = await session.scalar(select(func.count()).select_from(Organization))
        return result or 0


async def _seed_bare_org(slug_prefix: str) -> Organization:
    """Seed a standalone `Organization` row (no membership/user) — used only
    to force TC-RBAC-021's precondition ("1 org already exists"); that
    scenario doesn't care who owns it.
    """
    async with AsyncSessionLocal() as session:
        org = Organization(name=f"RBAC-1 Bare Org {slug_prefix}", slug=_unique_slug(slug_prefix))
        session.add(org)
        await session.commit()
        await session.refresh(org)
        return org


async def _cleanup(*, emails: list[str] | None = None, org_ids: list | None = None) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Mirrors `test_auth_login.py`'s `_cleanup` helper: `refresh_token`/
    `org_membership`/`auth_identity`/`role_assignment` all carry FKs to
    `user.actor_id` (or `actor.id`) / `organization.id` that must be deleted
    before their parent rows.
    """
    emails = emails or []
    org_ids = org_ids or []
    async with AsyncSessionLocal() as session:
        user_ids: list = []
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids = [row[0] for row in result.all()]

        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


async def _org_ids_owned_by_emails(emails: list[str]) -> list:
    """Look up every Organization a since-created User (by email) ended up an
    active member of — used by `finally` blocks that don't already know the
    created org's id (e.g. after a failed assertion mid-test).
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Organization.id)
            .join(OrgMembership, OrgMembership.org_id == Organization.id)
            .join(User, User.actor_id == OrgMembership.user_id)
            .where(User.email.in_(emails))
        )
        return [row[0] for row in result.all()]


def _signup_payload(*, name: str, email: str, org_name: str, org_slug: str) -> dict:
    return {
        "name": name,
        "email": email,
        "password": DEFAULT_PASSWORD,
        "org_name": org_name,
        "org_slug": org_slug,
    }


# --- TC-RBAC-001: fresh instance, zero orgs -> signup bootstraps org + org_admin ------------


@pytest.mark.asyncio
async def test_first_signup_bootstraps_org_and_org_admin() -> None:  # TC-RBAC-001
    if await _organization_count() > 0:
        pytest.skip(
            "TC-RBAC-001 requires a genuinely zero-Organization DB state; the "
            "target DB already has >=1 organization row (leftover from a "
            "prior run?) — skipping rather than asserting a false precondition."
        )

    email = _unique_email("tc001")
    org_slug = _unique_slug("tc001")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                SIGNUP_PATH,
                json=_signup_payload(
                    name="TC-RBAC-001 Admin", email=email, org_name="TC-RBAC-001 Org", org_slug=org_slug
                ),
            )

        assert response.status_code == 201
        body = response.json()
        assert body["access_token"]
        assert body["org_context"] == "auto"
        assert len(body["orgs"]) == 1
        assert body["orgs"][0]["slug"] == org_slug
        org_id = body["orgs"][0]["id"]

        set_cookie = response.headers.get("set-cookie")
        assert set_cookie is not None
        assert "refresh_token=" in set_cookie
        assert "httponly" in set_cookie.lower()

        async with AsyncSessionLocal() as session:
            user_result = await session.execute(select(User).where(User.email == email))
            user = user_result.scalars().first()
            assert user is not None

            membership_result = await session.execute(
                select(OrgMembership).where(
                    OrgMembership.user_id == user.actor_id, OrgMembership.org_id == org_id
                )
            )
            membership = membership_result.scalars().first()
            assert membership is not None
            assert membership.status.value == "active"

            role_assignment_result = await session.execute(
                select(RoleAssignment)
                .join(Role, Role.id == RoleAssignment.role_id)
                .where(
                    RoleAssignment.actor_id == user.actor_id,
                    RoleAssignment.org_id == org_id,
                    RoleAssignment.project_id.is_(None),
                    Role.name == "org_admin",
                    Role.org_id.is_(None),
                )
            )
            assert role_assignment_result.scalars().first() is not None
    finally:
        org_ids = await _org_ids_owned_by_emails([email])
        await _cleanup(emails=[email], org_ids=org_ids)


# --- TC-RBAC-021: signup closes once >=1 org already exists ---------------------------------


@pytest.mark.asyncio
async def test_signup_closed_once_an_organization_already_exists() -> None:  # TC-RBAC-021
    org = await _seed_bare_org("tc021")
    email = _unique_email("tc021")
    org_slug = _unique_slug("tc021attempt")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                SIGNUP_PATH,
                json=_signup_payload(
                    name="Should Never Exist", email=email, org_name="Should Never Exist Org", org_slug=org_slug
                ),
            )

        assert response.status_code == 409
        body = response.json()
        assert body["code"] == "signup_closed"

        async with AsyncSessionLocal() as session:
            user_result = await session.execute(select(User).where(User.email == email))
            assert user_result.scalars().first() is None

            attempted_org_result = await session.execute(
                select(Organization).where(Organization.slug == org_slug)
            )
            assert attempted_org_result.scalars().first() is None
    finally:
        await _cleanup(emails=[email], org_ids=[org.id])


# --- TC-RBAC-020: concurrent first-signup race is serialized --------------------------------


@pytest.mark.asyncio
async def test_concurrent_first_signup_race_yields_exactly_one_organization() -> None:  # TC-RBAC-020
    if await _organization_count() > 0:
        pytest.skip(
            "TC-RBAC-020 requires a genuinely zero-Organization DB state; the "
            "target DB already has >=1 organization row — skipping rather "
            "than asserting a false precondition."
        )

    email_a = _unique_email("tc020a")
    email_b = _unique_email("tc020b")
    slug_a = _unique_slug("tc020a")
    slug_b = _unique_slug("tc020b")
    payload_a = _signup_payload(name="Racer A", email=email_a, org_name="Racer A Org", org_slug=slug_a)
    payload_b = _signup_payload(name="Racer B", email=email_b, org_name="Racer B Org", org_slug=slug_b)

    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response_a, response_b = await asyncio.gather(
                client.post(SIGNUP_PATH, json=payload_a),
                client.post(SIGNUP_PATH, json=payload_b),
            )

        statuses = {response_a.status_code, response_b.status_code}
        # `pg_advisory_xact_lock` fully serializes the two attempts (ADR-0016):
        # whichever call acquires it first observes zero orgs and succeeds
        # (201); by the time the second call acquires the lock, the first has
        # already committed its Organization row, so the second's own
        # exists-check now sees >=1 org and 409s (signup_closed) — never a
        # 422 slug collision (see this module's docstring), and never both
        # 201 or both 409.
        assert statuses == {201, 409}

        winner = response_a if response_a.status_code == 201 else response_b
        loser = response_b if response_a.status_code == 201 else response_a

        winner_body = winner.json()
        assert winner_body["org_context"] == "auto"
        assert len(winner_body["orgs"]) == 1
        winner_org_id = winner_body["orgs"][0]["id"]
        winner_slug = winner_body["orgs"][0]["slug"]
        assert winner_slug in (slug_a, slug_b)

        loser_body = loser.json()
        assert loser_body["code"] == "signup_closed"

        assert await _organization_count() == 1

        async with AsyncSessionLocal() as session:
            org_result = await session.execute(select(Organization))
            orgs = org_result.scalars().all()
            assert len(orgs) == 1
            assert str(orgs[0].id) == winner_org_id
            assert orgs[0].slug == winner_slug
    finally:
        org_ids = await _org_ids_owned_by_emails([email_a, email_b])
        await _cleanup(emails=[email_a, email_b], org_ids=org_ids)
