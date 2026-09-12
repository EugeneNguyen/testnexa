"""Integration tests for ADR-0053's `GET /entities/{resource}/schema`
(`app/api/routes/entity_schema.py` + `app/api/entity_registry.py`).

Real HTTP against a live server (`TEST_API_BASE_URL`), seeding the one
fixture actor directly through `AsyncSessionLocal` — the same shape
`test_shell6_me_orgs.py`/`test_agents.py` already use. The package-level
`tests/integration/conftest.py` skip-guard applies here automatically.

Why a live-route suite rather than unit tests over `derive_entity_schema`:
the derivation is only half the contract. The other half is that every
`CrudEntityConfig` scattered across the 7 route-cluster modules is actually
*reachable* through the registry under the plural `:entity` slug the
frontend uses, behind the real auth dependency, with this repo's own
`{code,message,field_errors}` error envelope on the miss path. A direct
`derive_entity_schema(config)` call proves none of that.

The fixture actor is a bare `User` with no `OrgMembership` and no role
anywhere — deliberate: the route's own docstring says the only gate is
"must be a logged-in actor," and a membership-carrying fixture would make a
future accidental permission gate invisible here.

No `AuthIdentity` row is seeded because nothing in this file logs in (the
token is minted directly via `create_access_token`), and no `refresh_token`
row can exist for the same reason — so the cleanup order is the short one
(`user` -> `actor`), not `backend/CLAUDE.md`'s 6-row logged-in-account order.
"""

import os
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.api.crud_factory import _display_name, derive_entity_schema
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"

ENVELOPE_KEYS = {
    "resource",
    "label",
    "methods",
    "scopeField",
    "scopeSelector",
    "scopeResolution",
    "searchFields",
    "filterFields",
    "fields",
}


def _schema_path(resource: str) -> str:
    return f"{API_PREFIX}/entities/{resource}/schema"


@pytest_asyncio.fixture(scope="module")
async def access_token() -> str:
    """Seed one throwaway `User` and mint an access token for it.

    `User(...)` constructed directly — never `Actor()` then
    `User(actor_id=...)`, which breaks the joined-table-inheritance mapper
    (see `backend/CLAUDE.md`). The explicit `await session.commit()` is
    load-bearing: without it the whole block rolls back on scope exit and
    the route returns a 401 that reads exactly like a `JWT_SECRET` mismatch.
    """
    email = f"adr53-schema-{uuid4().hex[:8]}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="ADR-0053 Schema Probe", email=email, password_hash=hash_password("Unused-Never-Logs-In!1"))
        session.add(user)
        await session.flush()
        actor_id = user.actor_id
        await session.commit()

    yield create_access_token(str(actor_id))

    async with AsyncSessionLocal() as session:
        await session.execute(delete(User).where(User.actor_id == actor_id))
        await session.execute(delete(Actor).where(Actor.id == actor_id))
        await session.commit()


@pytest_asyncio.fixture(scope="module")
async def client(access_token: str) -> httpx.AsyncClient:
    async with httpx.AsyncClient(
        base_url=TEST_API_BASE_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20.0,
    ) as c:
        yield c


# --- envelope shape ------------------------------------------------------------------------


async def test_requirements_serves_the_full_envelope_shape(client: httpx.AsyncClient) -> None:
    """The nine top-level keys ADR-0053's response contract names, on the
    entity with the richest non-default `searchFields`/`filterFields`."""
    response = await client.get(_schema_path("requirements"))
    assert response.status_code == 200, response.text
    body = response.json()

    assert set(body) == ENVELOPE_KEYS

    # `resource` is the SINGULAR snake_case config name, not the plural
    # `:entity` slug the URL is keyed by — asserted explicitly because the
    # two differ and the frontend consumes the former.
    assert body["resource"] == "requirement"
    assert body["label"] == "Requirements"
    assert body["methods"] == ["create", "delete", "get", "list", "update"]
    assert body["scopeField"] == "project_id"
    assert body["scopeSelector"] is None
    assert body["scopeResolution"] is None
    assert body["searchFields"] == ["title", "description", "external_ref", "source"]
    assert body["filterFields"] == ["external_ref"]
    assert isinstance(body["fields"], list) and body["fields"]


async def test_requirements_project_id_is_a_fk_field(client: httpx.AsyncClient) -> None:
    """`project_id`'s bare `uuid.UUID` annotation is promoted to `type: "fk"`
    only by its `FieldMeta.ref_entity` entry — nothing about the Python type
    signals it, so this is the check that the hand-declared half of the
    hybrid derivation actually reaches the wire."""
    body = (await client.get(_schema_path("requirements"))).json()
    project_id = next(f for f in body["fields"] if f["name"] == "project_id")

    assert project_id == {
        "name": "project_id",
        "label": "Project",
        "type": "fk",
        "required": True,
        "showInTable": True,
        "sortable": True,
        "refEntity": "project",
        "labelField": "name",
    }


# --- branching scope (RiskItem) ------------------------------------------------------------


async def test_risk_items_scope_field_is_a_two_element_list(client: httpx.AsyncClient) -> None:
    """`RiskItem` is the one entity whose `scope_field` is a tuple — it must
    serialize as a JSON array, not a string, or the frontend's scope handling
    silently reads a single field name."""
    body = (await client.get(_schema_path("risk-items"))).json()

    assert body["scopeField"] == ["requirement_id", "test_plan_id"]


async def test_risk_items_scope_selector_is_an_array_of_two_options(client: httpx.AsyncClient) -> None:
    """The branching-scope picker: an ARRAY of options (contrast the singular
    object every other scope-selector entity serves, asserted below)."""
    body = (await client.get(_schema_path("risk-items"))).json()
    selector = body["scopeSelector"]

    assert isinstance(selector, list)
    assert selector == [
        {"refEntity": "requirement", "paramName": "requirement_id", "label": "By requirement"},
        {"refEntity": "test-plan", "paramName": "test_plan_id", "label": "By test plan"},
    ]


async def test_entry_exit_criteria_scope_selector_is_a_single_object(client: httpx.AsyncClient) -> None:
    """The non-branching shape, asserted alongside `risk-items` so the
    array-vs-object distinction is pinned from both sides. `label` is omitted
    (not `null`) when the option doesn't declare one."""
    body = (await client.get(_schema_path("entry-exit-criteria"))).json()

    assert body["scopeSelector"] == {"refEntity": "test-plan", "paramName": "test_plan_id"}


# --- Project: camelCase scopeResolution + full_methods --------------------------------------


async def test_projects_scope_resolution_is_camel_cased(client: httpx.AsyncClient) -> None:
    """`ScopeResolution`'s snake_case dataclass fields are re-keyed to
    camelCase on the wire (`from_route_param` -> `fromRouteParam`, ...) —
    the frontend reads the camelCase names verbatim."""
    body = (await client.get(_schema_path("projects"))).json()

    assert body["scopeResolution"] == {
        "fromRouteParam": "projectId",
        "viaEntity": "project",
        "viaField": "org_id",
    }
    assert body["scopeSelector"] is None


async def test_projects_methods_reflect_full_methods_not_the_factory_registered_two(
    client: httpx.AsyncClient,
) -> None:
    """`_PROJECT_FACTORY_CONFIG.methods` is only `{"list","delete"}` (all the
    generic factory itself registers); `get`/`update`/`create`
    ([ADR-0059](../../../docs/adr/0059-project-generic-admin-create.md) added
    `create` to `full_methods` — schema-metadata only, still not registered
    as a generic route) are bespoke routes at the same URL shape, declared
    via `full_methods`. The admin surface needs all five, so `methods` must
    serve the union — asserting the three bespoke verbs are present is the
    whole point of this test."""
    body = (await client.get(_schema_path("projects"))).json()

    assert body["methods"] == ["create", "delete", "get", "list", "update"]
    assert "get" in body["methods"] and "update" in body["methods"] and "create" in body["methods"]

    # Cross-check against the config itself so this can't pass by the route
    # accidentally serving `methods` while `full_methods` is ignored.
    assert sorted(ALL_ENTITY_CONFIGS["projects"].methods) == ["delete", "list"]


# --- enum badge colours ---------------------------------------------------------------------


async def test_test_plan_status_badge_colors_are_filtered_to_its_own_values(
    client: httpx.AsyncClient,
) -> None:
    """`ENUM_BADGE_COLORS` is a shared, value-keyed palette; the derived
    schema must filter it down to the field's OWN declared values so a field
    never advertises a colour for a value it cannot hold."""
    body = (await client.get(_schema_path("test-plans"))).json()
    status = next(f for f in body["fields"] if f["name"] == "status")

    assert status["type"] == "enum"
    assert status["values"] == ["draft", "approved", "superseded"]
    assert status["badgeColors"] == {"draft": "secondary", "approved": "success", "superseded": "secondary"}
    # No leakage from the shared palette's other keys (`critical`, `fail`, ...).
    assert set(status["badgeColors"]) == set(status["values"])


async def test_org_membership_status_badge_colors_are_filtered_to_its_own_values(
    client: httpx.AsyncClient,
) -> None:
    """A second entity's own `status` enum, drawing a disjoint slice of the
    same shared palette — proves the filtering is per-field, not a single
    global dict handed to everyone."""
    body = (await client.get(_schema_path("org-memberships"))).json()
    status = next(f for f in body["fields"] if f["name"] == "status")

    assert status["values"] == ["invited", "active", "suspended"]
    assert status["badgeColors"] == {"invited": "info", "active": "success", "suspended": "warning"}
    assert set(status["badgeColors"]) == set(status["values"])


async def test_entry_exit_criteria_type_enum_has_no_badge_colors_key_at_all(
    client: httpx.AsyncClient,
) -> None:
    """`entry`/`exit`/`suspension`/`resumption` carry no status semantic, so
    none is in the shared palette and the key must be OMITTED entirely (not
    `{}`, not `null`) — that absence is what keeps the frontend's plain-grey
    default in play."""
    body = (await client.get(_schema_path("entry-exit-criteria"))).json()
    type_field = next(f for f in body["fields"] if f["name"] == "type")

    assert type_field["type"] == "enum"
    assert type_field["values"] == ["entry", "exit", "suspension", "resumption"]
    assert "badgeColors" not in type_field


async def test_test_log_event_type_enum_has_no_badge_colors_key_at_all(
    client: httpx.AsyncClient,
) -> None:
    """The second colourless enum ADR-0053's own comment names, asserted so a
    future palette addition that accidentally swallows one of these values
    fails here rather than shipping a meaningless colour."""
    body = (await client.get(_schema_path("test-logs"))).json()
    event_type = next(f for f in body["fields"] if f["name"] == "event_type")

    assert event_type["type"] == "enum"
    assert event_type["values"] == ["status_change", "comment", "attachment", "agent_action"]
    assert "badgeColors" not in event_type


# --- readOnly -------------------------------------------------------------------------------


async def test_summary_only_field_is_read_only_and_writable_field_is_not(
    client: httpx.AsyncClient,
) -> None:
    """`created_by_actor_id` exists only in `TestPlanSummary` (never in the
    create/update schemas) -> `readOnly: true`. `identifier` is writable ->
    the key is ABSENT entirely, not `false` (the frontend's `FieldConfig`
    contract treats a missing `readOnly` as falsy)."""
    body = (await client.get(_schema_path("test-plans"))).json()
    fields = {f["name"]: f for f in body["fields"]}

    assert fields["created_by_actor_id"]["readOnly"] is True

    assert fields["identifier"].get("readOnly") in (None, False)
    assert "readOnly" not in fields["identifier"]


# --- misses ---------------------------------------------------------------------------------


async def test_releases_is_absent_from_the_registry_and_404s(client: httpx.AsyncClient) -> None:
    """`Release` has no `CrudEntityConfig` at all — its create/list are 100%
    bespoke (ADR-0027), so `entity_registry.py`'s own docstring declares it
    deliberately absent and its frontend `entityConfigs/release.ts` stays
    static. This is a real assertion of that decision, not an oversight: if
    a future change registers `Release`, this test fails loudly and the
    ADR's scope note has to be revisited rather than silently drifting.
    """
    response = await client.get(_schema_path("releases"))

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"
    assert "releases" in response.json()["message"]
    assert "releases" not in ALL_ENTITY_CONFIGS


async def test_unknown_resource_404s_with_this_repos_error_envelope(client: httpx.AsyncClient) -> None:
    """The miss path must use the app's own `{code,message,field_errors}`
    envelope (API Document §1), NOT FastAPI's default `{"detail": ...}` —
    a `detail`-shaped body here would also be the tell for the
    `TEST_API_BASE_URL` double-`/api`-prefix trap (`backend/CLAUDE.md`)."""
    response = await client.get(_schema_path("no-such-entity"))

    assert response.status_code == 404, response.text
    body = response.json()
    assert set(body) == {"code", "message", "field_errors"}
    assert body["code"] == "not_found"
    assert body["message"] == 'Unknown entity "no-such-entity".'
    assert body["field_errors"] is None
    assert "detail" not in body


async def test_unauthenticated_request_is_401() -> None:
    """No bearer token at all — the route's one and only gate."""
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=20.0) as anon:
        response = await anon.get(_schema_path("requirements"))

    assert response.status_code == 401, response.text
    assert response.json()["code"] in {"invalid_token", "not_authenticated", "unauthorized"}


async def test_unauthenticated_request_to_an_unknown_resource_is_also_401(
    client: httpx.AsyncClient,
) -> None:
    """Auth is evaluated before the registry lookup — an anonymous caller
    gets 401, never the 404 that would confirm which slugs exist."""
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=20.0) as anon:
        response = await anon.get(_schema_path("no-such-entity"))

    assert response.status_code == 401, response.text


# --- registry sweep -------------------------------------------------------------------------


@pytest.mark.parametrize("resource", sorted(ALL_ENTITY_CONFIGS))
async def test_every_registered_entity_serves_a_ported_schema(
    resource: str, client: httpx.AsyncClient
) -> None:
    """For EVERY key in `ALL_ENTITY_CONFIGS`: 200, the full envelope, a
    non-empty `fields` list, and an EXPLICITLY-SET `label`.

    The label check is the point of the sweep. `CrudEntityConfig.label`
    defaults to `None` and `derive_entity_schema` falls back to
    `_display_name(resource)` so a config can compile before its own
    ADR-0053 port lands — which means a future entity added to the registry
    without that port is invisible: it serves a plausible-looking singular
    label ("Test cycle") where the nav needs a real one ("Test cycles"),
    with no error anywhere. Asserting `config.label is not None` catches
    that; asserting the response echoes it catches the route ignoring it.
    """
    config = ALL_ENTITY_CONFIGS[resource]

    response = await client.get(_schema_path(resource))
    assert response.status_code == 200, response.text
    body = response.json()

    assert set(body) == ENVELOPE_KEYS
    assert body["resource"] == config.resource
    assert isinstance(body["fields"], list)
    assert body["fields"], f"{resource} derived an EMPTY fields list"

    assert config.label is not None, (
        f"{resource} is registered but has no explicit `label=` — it is falling back to "
        f'`_display_name()` ("{_display_name(config.resource)}"), i.e. it was added to the '
        "registry without an ADR-0053 port."
    )
    assert body["label"] == config.label

    # Every field carries the four always-present keys.
    for field_entry in body["fields"]:
        assert {"name", "label", "type", "required", "showInTable"} <= set(field_entry), field_entry
        assert field_entry["type"] in {"string", "enum", "date", "boolean", "fk"}
        if field_entry["type"] == "fk":
            assert field_entry["refEntity"], field_entry
        if field_entry["type"] == "enum":
            assert field_entry["values"], field_entry


@pytest.mark.parametrize("resource", sorted(ALL_ENTITY_CONFIGS))
async def test_live_route_matches_derive_entity_schema_for_every_entity(
    resource: str, client: httpx.AsyncClient
) -> None:
    """The route is a thin pass-through: whatever `derive_entity_schema`
    produces for a config is exactly what the wire carries, byte-for-byte
    after JSON round-tripping. Guards against a future route-level filter/
    rename landing without the derivation changing (or vice versa).
    """
    response = await client.get(_schema_path(resource))
    assert response.status_code == 200, response.text

    assert response.json() == derive_entity_schema(ALL_ENTITY_CONFIGS[resource])
