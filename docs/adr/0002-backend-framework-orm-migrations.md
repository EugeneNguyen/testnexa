# ADR-0002: Backend framework/ORM/migrations — FastAPI + PostgreSQL + SQLAlchemy 2.0 + Alembic

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md)

## Context

The backend must serve both a human-facing REST API and a first-party MCP server (per 06/26 discovery) concurrently, support 20+ interrelated entities with real foreign-key integrity (needed for RTM correctness), and model joined-table inheritance (`Actor` → `User`/`AIAgent`).

## Decision

FastAPI (async-native web framework) + PostgreSQL (relational DB) + SQLAlchemy 2.0 (ORM, typed declarative style) + Alembic (migrations).

## Consequences

**Positive:** async fits concurrent MCP-agent + human load without a second runtime; FastAPI's auto-generated OpenAPI schema keeps the [API Document](../api/2026-09-03-api-design.md) close to the implementation and reduces drift; SQLAlchemy 2.0's joined-table inheritance natively models `Actor`→`User`/`AIAgent`; Alembic gives reviewable, ordered schema history for a 28-table + seed-data schema.

**Negative / Trade-offs:** SQLAlchemy 2.0's typed declarative style has a steeper learning curve than 1.x `Query`-style code; joined-table inheritance adds a join on every `Actor`-resolving query (mitigated by one shared resolution helper rather than ad hoc joins per route, per the [Database Document](../database/2026-09-03-database-design.md)).

## Alternatives considered

- **Django + DRF** — rejected: sync-first, heavier batteries-included framework than needed, less natural fit for an MCP server sharing the same service layer.
- **Node/Express + Prisma** — rejected: Python chosen to align with the AI/MCP tooling ecosystem the product's roadmap (06/26) depends on.
- **NoSQL (e.g. MongoDB)** — rejected: the #1 validated pain this product addresses is requirements traceability, which needs real, DB-enforced foreign-key integrity across a 20+ entity graph, not document flexibility.
