"""Unit tests for RBAC-1 request schemas — `SignupRequest.org_slug` /
`CreateOrgRequest.slug` (`^[a-z0-9-]+$`, RBAC-1 scope plan decision Q5).

Pure Pydantic-model construction, no DB/network — mirrors the style of
`tests/unit/test_security.py`.

`has_permission_in_any_org` (`app/core/rbac.py`) is deliberately NOT unit-
tested in this file: like `has_permission` before it (see `test_rbac.py`'s
module docstring — "`require_permission`/`has_permission`/`require_human_actor`
stay ... not covered here" at the time only `get_current_actor` had a DB-free
seam to fake), it opens its own live session via `AsyncSessionLocal()`
internally rather than accepting an injected `db: AsyncSession` the way
`get_current_actor` does, so there is no seam to swap in `test_rbac.py`'s
`_FakeSession` pattern without reimplementing real SQLAlchemy query
execution. This repo's own established boundary (`test_agents.py`'s
TC-AUTH-032/033/034, which exercise `has_permission`/`require_permission`
against a live Postgres via a throwaway ASGI app) already treats this exact
class of DB-touching RBAC join-chain logic as integration-test territory, not
unit-test territory. `has_permission_in_any_org`'s own coverage (including
TC-RBAC-023's project-scoped-grant exclusion) is in
`tests/integration/test_organizations.py` instead, via the real
`POST /orgs` route.
"""

import pytest
from pydantic import ValidationError

from app.schemas.auth import SignupRequest
from app.schemas.organizations import CreateOrgRequest

_VALID_SIGNUP_KWARGS = {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "password": "CorrectHorseBatteryStaple!1",
    "org_name": "Acme Corp",
}

_VALID_CREATE_ORG_KWARGS = {"name": "Acme Corp"}

_VALID_SLUGS = ["acme", "acme-corp", "acme123", "a1-b2-c3", "123", "a"]
_INVALID_SLUGS = [
    "Acme",  # uppercase
    "ACME-CORP",  # uppercase
    "acme corp",  # space
    "acme_corp",  # underscore
    "acme!",  # symbol
    "acme.corp",  # dot
    "acme/corp",  # slash
    "",  # empty — pattern requires at least one char
]


# --- SignupRequest.org_slug --------------------------------------------------------------


@pytest.mark.parametrize("slug", _VALID_SLUGS)
def test_signup_request_accepts_valid_org_slugs(slug: str) -> None:
    request = SignupRequest(**_VALID_SIGNUP_KWARGS, org_slug=slug)
    assert request.org_slug == slug


@pytest.mark.parametrize("slug", _INVALID_SLUGS)
def test_signup_request_rejects_invalid_org_slugs(slug: str) -> None:
    with pytest.raises(ValidationError):
        SignupRequest(**_VALID_SIGNUP_KWARGS, org_slug=slug)


def test_signup_request_rejects_malformed_email() -> None:
    with pytest.raises(ValidationError):
        SignupRequest(
            name="Ada Lovelace",
            email="not-an-email",
            password="CorrectHorseBatteryStaple!1",
            org_name="Acme Corp",
            org_slug="acme",
        )


def test_signup_request_requires_all_fields() -> None:
    with pytest.raises(ValidationError):
        SignupRequest(name="Ada Lovelace", email="ada@example.com")


# --- CreateOrgRequest.slug ----------------------------------------------------------------


@pytest.mark.parametrize("slug", _VALID_SLUGS)
def test_create_org_request_accepts_valid_slugs(slug: str) -> None:
    request = CreateOrgRequest(**_VALID_CREATE_ORG_KWARGS, slug=slug)
    assert request.slug == slug


@pytest.mark.parametrize("slug", _INVALID_SLUGS)
def test_create_org_request_rejects_invalid_slugs(slug: str) -> None:
    with pytest.raises(ValidationError):
        CreateOrgRequest(**_VALID_CREATE_ORG_KWARGS, slug=slug)


def test_create_org_request_requires_name_and_slug() -> None:
    with pytest.raises(ValidationError):
        CreateOrgRequest(slug="acme")
