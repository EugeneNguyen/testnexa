# ADR-0009: Frontend stack — Vite + React Router + TanStack Query + RHF + Zod + Tailwind

**Date:** 2026-09-03
**Status:** Partially superseded — see note below
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [ADR-0012](0012-coreui-design-system.md) (styling-layer decision superseded)

> **2026-09-03, later same day:** the Tailwind CSS portion of this decision is superseded by [ADR-0012](0012-coreui-design-system.md) — CoreUI for React is now the project's design system. Everything else below (Vite, React Router, TanStack Query, React Hook Form + Zod) still stands.

## Context

The frontend is a CRUD-heavy admin/workflow tool over 28 entities, authenticated throughout, with no public/marketing-facing pages. Tailwind CSS is a fixed task requirement.

## Decision

Vite (build tool/dev server) + React Router (routing) + TanStack Query (server-state/cache) + React Hook Form + Zod (forms + schema validation) + Tailwind CSS (styling).

## Consequences

**Positive:** TanStack Query's cache/invalidation model removes most of the boilerplate that 28 entities' worth of hand-rolled `fetch`+`useState` CRUD screens would otherwise need; React Hook Form + Zod gives one validation story shared by generic (`entityConfigs/`) and bespoke forms alike; Vite's dev server is fast for iteration.

**Negative / Trade-offs:** five libraries to keep version-compatible across upgrades; no meta-framework means no SSR — accepted as irrelevant for an authenticated internal/self-hosted tool with no SEO or first-paint requirement.

## Alternatives considered

- **Next.js** — rejected: SSR/meta-framework overhead brings no benefit for a tool that's entirely behind auth.
- **Plain `fetch` + `useState`, no query library** — rejected: doesn't scale cleanly to 28 CRUD entities' worth of list/detail/cache-invalidation logic.
