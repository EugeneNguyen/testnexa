# CLAUDE.md — backend

Backend-specific guidance. Read the repo-root `CLAUDE.md` first — this file only covers what's specific to `backend/`.

## Email validation rejects reserved/special-use TLDs

Pydantic's `EmailStr` (via `email-validator`) rejects domains under special-use/reserved TLDs like `.local` (mDNS, RFC 6762) with a `422`, not a clean "invalid email" message — the error text ("The part after the @-sign is a special-use or reserved name...") is easy to misread as an auth failure if you only see it surfaced through a frontend's generic "check your email and password" error. Hit this seeding a demo account with `@testnexa.local` — login 422'd every time, looked like a credentials bug, wasn't. **Never use `.local` (or other reserved TLDs) in seed/fixture/demo data** — `example.com`/`example.org`/`example.net` work fine and are the conventional choice.

## Dev backend container has no source volume mount

Unlike `frontend` (which bind-mounts `frontend/src` for hot reload), `backend`'s dev service builds the image once and does not mount source. After any backend code edit in a running stack (isolated test env or otherwise), you must `docker compose build backend` (or `up --build`) again — editing files on the host does nothing to a running container until rebuilt.

## RBAC bundle extensions always need a new data migration

Every time a bespoke route is gated on a permission code a system role's seeded bundle (`app/db/rbac_seed_catalog.py`) doesn't yet grant, that's a new idempotent Alembic data migration backfilling `role_permission` for already-seeded roles — editing `rbac_seed_catalog.py` alone only affects a fresh DB's initial seed, not one that already ran the seed migration. Three precedents now, same shape each time (existence-check-then-insert): `b7f3a1c9d2e4` (`test_manager`+`release.*`, ADR-0019), and the REQ-3 migration (`test_manager`+`test_condition.*`/`test_case.*`, ADR-0028). Check whether the persona/role your new route's permission targets already holds that code in the seeded bundle *before* considering the route done — a route that 403s for the very role its own story's persona is supposed to use it as is a common miss.

## Before restricting or adding a generic-CRUD `create`, audit for a matching bespoke route

`TestCondition` had a generic `POST /test-conditions` (full CRUD via the ADR-0022 factory) that silently never wrote its `RequirementTestConditionLink` row — the factory's `create_item` only ever inserts the one entity row, it has no concept of a second link-table insert. This went unnoticed until ADR-0028 built the bespoke atomic-create route and discovered the gap. **Whenever an entity's create is meant to also populate a dedicated link table (`app/models/trace.py`), it must never be reachable via the generic factory's plain `create`** — restrict `methods` to drop `"create"` and set `create_schema=None` (mirror `TestCase`'s/`Defect`'s existing exclusion in `app/api/routes/assets.py`/`execution.py`) the same commit the bespoke route is added, not as a follow-up. If you're adding a bespoke atomic-create route for an entity that currently has generic `create` enabled, that's the signal to restrict it now.
