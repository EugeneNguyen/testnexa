# ADR-0001: Full 07 ERD scope over validated MVP

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [07 ERD](../product-discovery/07-erd-draft.md), [26 MVP](../product-discovery/26-mvp.md), [32 Final decision](../product-discovery/32-final-decision.md)

## Context

The product-discovery track produced a validated, narrower MVP scope (26-mvp.md: single-org, no RBAC, 5 entities) and a Go decision (32-final-decision.md) explicitly bounded to that MVP plus the still-unrun 27-experiment.md — not a full build. The 07 ERD itself is flagged as a "conceptual/structural hypothesis, not implementation-ready," produced ahead of the discovery sequence on direct request.

## Decision

Scaffold the full 07 ERD — all 28 entities (20 core + 8 extended), full RBAC, and real multi-tenancy — rather than the validated 5-entity/no-RBAC MVP subset. This is a deliberate, informed deviation from the discovery-stage recommendation, made and logged by the user, not an oversight.

## Consequences

**Positive:** demonstrates the full standards-compliant architecture (IEEE 829/ISO 29119-3 + ISTQB CTFL v4.0.1) in one pass; supports the regulated-buyer persona (Marcus) and the compliance/traceability value proposition from day one instead of retrofitting RBAC/multi-tenancy later, which 07 itself calls "one of the most expensive mistakes a self-hosted product can make."

**Negative / Trade-offs:** breaks from validated-learning discipline — RBAC, multi-tenancy, and 8 "extended" entities are built ahead of any interview evidence that they're needed (07's own open questions #4/#5 remain unresolved). Larger build surface increases time-to-first-deploy and test burden versus the 5-entity MVP. AI-agent/MCP-facing stories (Persona 3) have zero validated willingness-to-pay per the personas doc but are built anyway because the Actor model requires the structural capability either way.

## Alternatives considered

- **Build the validated 5-entity MVP first, layer RBAC/full ERD later** — rejected. This is the discovery-recommended path but was explicitly overridden by the user; logged here for traceability rather than silently followed or silently overridden.
