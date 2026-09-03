# ADR-0005: TraceabilityLink as dedicated join tables, not a generic polymorphic table

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [07 ERD open question #2](../product-discovery/07-erd-draft.md), [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md)

## Context

07's draft ERD modeled `TraceabilityLink` as one generic polymorphic table (`from_type`, `from_id`, `to_type`, `to_id`, `link_kind`) so any entity could link to any other. This is flexible but has no DB-level referential integrity — `from_id`/`to_id` can't be real foreign keys against a polymorphic type.

## Decision

Replace the single polymorphic table with four dedicated join tables, one per actually-needed relationship: `RequirementTestCaseLink`, `RequirementTestConditionLink`, `TestConditionTestCaseLink`, `TestCaseDefectLink`. Each has real FK columns to both sides, a surrogate `uuid` PK, and a unique constraint on the FK pair. The `link_kind` column is dropped — the relationship is already encoded by the table name.

## Consequences

**Positive:** the database enforces valid references at write time instead of the application layer trusting arbitrary `(type, id)` pairs; targeted queries (e.g. "test cases for this requirement") are simpler and faster than filtering a shared table by type.

**Negative / Trade-offs:** there's no single "give me every link touching entity X" query — the [Traceability Matrix view](../user-stories/2026-09-03-traceability-stories.md) (TRACE-1/2) must union across up to 4 tables instead of querying one. Adding a genuinely new link pair later (not in the current 4) requires a migration for a new table, not just a new `link_kind` value.

## Alternatives considered

- **Generic polymorphic table (07's original draft)** — rejected: weaker referential integrity, the exact trade-off 07 itself flagged as needing a spike before committing.
- **Single-table inheritance for links** — rejected: same integrity weakness as the polymorphic design, no meaningful benefit over dedicated tables for only 4 relationship types.
