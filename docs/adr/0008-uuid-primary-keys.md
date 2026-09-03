# ADR-0008: All primary keys are UUIDs, no auto-increment

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [Pre-implementation plan](../superpowers/plans/2026-09-03-project-scaffold-plan.md), [Database Document](../database/2026-09-03-database-design.md)

## Context

The 07 ERD already specified `uuid id PK` on every entity. During plan review, the user explicitly confirmed this as a hard constraint: no serial/auto-increment integer primary keys anywhere in the schema, including the 4 `TraceabilityLink` join tables added in [ADR-0005](0005-traceability-link-dedicated-join-tables.md).

## Decision

Every table's primary key is a UUID generated at insert time, using **UUIDv7** (time-sortable) uniformly across all tables — chosen over UUIDv4 for its index-locality benefit on the high-write tables (`TestExecution`, `TestLog`), applied consistently rather than mixing versions per table. The 4 TraceabilityLink join tables get a surrogate `uuid` PK (not a composite PK of their two FK columns), matching every other table's shape.

## Consequences

**Positive:** IDs are non-guessable/non-enumerable (a defense-in-depth property alongside RBAC — an attacker can't iterate `id=1,2,3...` to probe cross-tenant existence); safe to generate client-side or across distributed services later without collision coordination; UUIDv7's time-ordering keeps B-tree index writes reasonably sequential, avoiding the worst-case index fragmentation of pure-random UUIDv4 on high-write tables.

**Negative / Trade-offs:** ~16 bytes per key vs. 4-8 for an integer — larger index footprint across a 28-table + join-table schema; UUIDv7 requires a library/DB function that supports it (PostgreSQL doesn't generate UUIDv7 natively pre-18 — application-layer generation, e.g. via a Python `uuid7` helper, is required).

## Alternatives considered

- **Auto-increment integer PK + separate public UUID column** — rejected per explicit user directive: a single UUID PK only, no incrementing `id` column at all, on any table.
- **UUIDv4 (random) everywhere** — rejected in favor of UUIDv7 for index locality on write-heavy tables; still satisfies the "not auto-increment" constraint either way.
