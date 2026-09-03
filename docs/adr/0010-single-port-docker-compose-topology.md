# ADR-0010: Single-port Docker Compose topology, dev+prod profiles

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [Pre-implementation plan](../superpowers/plans/2026-09-03-project-scaffold-plan.md) (open question #6)

## Context

The product is positioned on self-hosting (business case, 03 #9) — the deployment story needs to be simple for an operator standing up their own instance, and the same stack needs to run identically for local dev and for Playwright E2E tests.

## Decision

One `docker-compose.yml` defining `postgres`, `backend`, `frontend`, `nginx`, and a `postgres-test` service, with `dev` and `prod` Compose profiles both defined in the same file (not two separate compose files). `nginx` is the single external port (`:8080`), routing `/api/*` to `backend` and `/*` to `frontend`. In the `dev` profile, `frontend` is the Vite dev server; in `prod`, it's a static build served by `nginx` directly.

## Consequences

**Positive:** one command (`docker compose up`) brings the full stack up identically for local dev and for the Playwright E2E suite against `localhost:8080`; a self-hosting operator opens exactly one port; profile-gating in a single file keeps `dev`/`prod` service definitions from silently drifting apart the way two separate files would.

**Negative / Trade-offs:** profile syntax adds some file complexity versus two plain compose files; both profiles must still be updated together by hand when a service changes — there's no automatic guarantee they stay in sync, only that they're easier to notice diverging when adjacent in one file.

## Alternatives considered

- **Separate `docker-compose.dev.yml` / `docker-compose.prod.yml`** — rejected: higher risk of the two drifting apart unnoticed since they're separate files reviewed independently.
