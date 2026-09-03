# ADR-0007: Real multi-org multi-tenancy (not collapsed to one row)

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [07 ERD open question #5](../product-discovery/07-erd-draft.md), [RBAC-1/RBAC-2 user stories](../user-stories/2026-09-03-rbac-tenancy-stories.md)

## Context

07 flags an unresolved question: do self-hosted buyers actually want multi-org support, or is single-org-per-deployment the expected model (as with most self-hosted competitors, per 01/04 research)? This was never validated against a regulated-buyer interview.

## Decision

Implement `Organization`/`OrgMembership` as real, functioning multi-org — a single deployment can serve more than one Organization, each fully isolated — rather than collapsing `Organization` to exactly one row. This follows directly from [ADR-0001](0001-full-erd-scope-over-validated-mvp.md)'s choice of the full ERD scope.

## Consequences

**Positive:** supports the consultancy/MSP pattern (one instance, multiple client orgs) and the "user belongs to more than one org" case (contract auditors) without a later migration; every table already carries a path to `org_id` via `Project.org_id`, so tenant isolation is a day-one schema property, not a retrofit.

**Negative / Trade-offs:** adds an org-picker UX step and org-scoping to every query path even for the common case of a single regulated enterprise standing up its own single-org instance — complexity that 07 itself calls "speculative" absent interview validation. This is accepted as a known, logged risk under ADR-0001's broader deviation, not re-litigated here.

## Alternatives considered

- **Single-org-per-deployment, `Organization` collapsed to one row** — rejected for this scaffold, consistent with the full-ERD decision in ADR-0001.
