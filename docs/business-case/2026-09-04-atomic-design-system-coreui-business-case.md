# Business Case — Atomic Design Component Architecture on CoreUI

**Date:** 2026-09-04
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** Draft — new discovery, gap flagged in prior stage (2026-09-04 design-system doc audit: no business case existed for this area).

## Provenance and framing caveat

**This gap was flagged during the prior stage** (design-system doc audit, 2026-09-04): `docs/adr/0012-coreui-design-system.md` picks CoreUI as the component *library*; nothing in `docs/adr/`, `docs/requirements/`, or `docs/user-stories/` addresses internal component *organization* (an "Atomic Design" layer of atoms/molecules/organisms on top of it). No business case existed for that gap. This document fills it, per instruction — but the PM read from the prior stage stands and is restated here, not dropped: this initiative's "customer" is internal frontend contributors, not a paying external customer, and the standard external-market sections (competitor pricing, TAM/SAM, willingness-to-pay) largely don't transfer. Sections below are reframed to fit an internal-engineering-practice decision, and labeled accordingly — no external market data is fabricated to fill sections that don't apply.

## Problem statement

**ASSUMPTION**, not yet observed in this codebase: as `frontend/src/` grows past its current 4 screens (`Login`, `Signup`, `OrgPicker`, `OrgHome`) plus one CRUD placeholder (`components/crud/`, per its own README: "structural placeholder only"), component duplication and visual inconsistency across screens will emerge without an explicit reuse layer. This is a *predicted* problem, not an observed one — **FACT**: current component count and screen count are too low to show real duplication signal yet (checked 2026-09-04: `frontend/src/components/` has one shared file, `AppHeader.tsx`, plus the CRUD placeholder).

**FACT** (Brad Frost, [Atomic Design, Ch. 2](https://atomicdesign.bradfrost.com/chapter-2/); [designsystems.com](https://www.designsystems.com/brad-frosts-atomic-design-build-systems-not-pages/)): Atomic Design is a component-hierarchy methodology (atoms → molecules → organisms → templates → pages) that gives teams a shared vocabulary for component reuse and improves testability/consistency when a component set is large enough for those properties to matter. It is a *structuring convention*, not a feature — it changes how existing CoreUI components get organized and composed, not what CoreUI ships.

**INSIGHT**, cross-referencing the methodology's own documented failure modes against this repo's current state: Brad Frost's own writeup flags **over-atomization** as a real risk — "if a component is only used once, it does not need to be an atom" — and that "not every component fits cleanly into one level." Applied to a codebase with essentially one shared component today, imposing a 5-tier taxonomy now is the textbook premature-abstraction case the methodology's own literature warns against.

## Target "customer"

**FACT**, not a hypothesis: the beneficiary of this initiative is **internal** — frontend contributors to this repo (currently: the single-operator team building TestNexa) — not TestNexa's end users (QA/test-management customers). End users never see component folder structure; they see screens. This is an engineering-velocity/maintainability investment, not a product-value investment, and should not be scored against the product's customer-value criteria (regulated/self-hosting QA teams, per the product's own [business case](2026-09-03-sovereign-ai-testing-business-case.md)).

**Job to be done:** "let a contributor (human or AI agent) find and reuse the right existing component instead of re-authoring a CoreUI composition that already exists elsewhere in the codebase." This job doesn't exist yet at meaningful scale — see problem statement.

## Market / practice context

**FACT** ([Atomic Design and Storybook, bradfrost.com](https://bradfrost.com/blog/post/atomic-design-and-storybook/)): Atomic Design is widely adopted in the design-systems community and pairs commonly with Storybook-style component catalogs; it gave the frontend industry a shared naming vocabulary that predates it having one.

**FACT**, confirmed against this repo (2026-09-04): CoreUI itself already ships pre-composed, tested components (`CCard`, `CForm`, `CTable`, etc. — see [CoreUI React docs](https://coreui.io/react/docs/getting-started/introduction/)) that sit roughly at the "molecule/organism" level of an Atomic Design hierarchy already. Re-imposing a full 5-tier taxonomy on top risks wrapping CoreUI's own components in another naming layer for no behavioral gain — this is the specific "alternative industries" comparison worth naming: the alternative to adding Atomic Design here is not "no structure," it's "CoreUI's own component boundaries plus the existing `entityConfigs/`-driven composition pattern" (per `entityConfigs/README.md`), which may already cover the reuse need this initiative is aimed at.

**No TAM/SAM/competitor-pricing section applies** — there is no external market for this repo's internal file layout. Omitted rather than filled with inapplicable or fabricated content.

## Why now

**Counter-argument (the honest one):** now is arguably the *wrong* time. Per the problem statement, the codebase doesn't yet show the duplication pain Atomic Design solves. Per CLAUDE.md's own ADR-first rule, changing internal architecture speculatively, ahead of evidence, is exactly the kind of choice that should wait for a triggering signal.

**Argument for doing groundwork now, narrowly:** `docs/adr/0012-coreui-design-system.md` was decided one day before this document and nothing has been built against it yet except 4 screens — this is the cheapest point in the project's life to set a lightweight naming/foldering convention (before contributors, human or AI-agent, establish inconsistent ad hoc patterns that are more expensive to unwind later). That argues for a **thin convention doc**, not a build-out.

## Expected value

**Customer value:** none directly — no external customer touches this. Indirect value only, via velocity: **HYPOTHESIS**, untested — a documented component-reuse convention *may* reduce time-to-build for future CRUD screens (the product has ~28 entities per the ERD, most not yet built, per `docs/requirements/2026-09-03-project-scaffold-requirements.md`) and reduce inconsistent re-implementation, particularly relevant since this repo is built for human+AI-agent collaboration (per CLAUDE.md's own framing) and agents are more prone to re-authoring existing patterns than a human who remembers "we have a component for that."

**Business value:** none measurable independently — this is a cost-avoidance bet on future engineering time, not a revenue lever. Cannot be sized without knowing how many of the 28 entities actually get built and how much real duplication would occur without a convention — neither is known today.

**Cost:** low if scoped as a documented convention (an ADR + a folder-naming pattern for the ~1 shared component that exists today); high and premature if scoped as a full atoms/molecules/organisms/templates directory buildout with no components to populate most tiers yet.

## Decision

**RECOMMENDATION: PIVOT, not GO-as-framed.** Do not treat "Atomic Design system" as a business-case-worthy product initiative — it isn't one; there's no external customer or revenue attached to it, confirmed above. Do not build a full 5-tier component directory now — confirmed above as premature against current component count (over-atomization risk is the methodology's own documented failure mode, not a hypothetical one).

**Narrower recommendation that survives this analysis:** write a short **ADR** (not a business case) documenting a lightweight component convention — e.g., a `components/shared/` (reusable, cross-screen) vs. `components/crud/` (generic, entity-config-driven) vs. page-local split, deferring full Atomic Design tiering until component count/duplication evidence justifies it. Revisit if/when a future story shows real duplication pain (e.g., 3+ screens hand-rolling the same CoreUI composition) — that is the concrete, checkable trigger condition to test this hypothesis against, per this system's own validation-before-build principle.

**What would invalidate "defer this":** if the next 3–5 entity CRUD screens (PROJ-1 and beyond) show measurable copy-pasted CoreUI compositions across files, that's the evidence signal to revisit and justify a heavier structure. Not yet observed as of this document.

## Sources

- [Atomic Design, Brad Frost — Chapter 2: Methodology](https://atomicdesign.bradfrost.com/chapter-2/)
- [Brad Frost's Atomic Design: build systems, not pages — designsystems.com](https://www.designsystems.com/brad-frosts-atomic-design-build-systems-not-pages/)
- [Atomic Design and Storybook — bradfrost.com](https://bradfrost.com/blog/post/atomic-design-and-storybook/)
- [CoreUI for React — official docs](https://coreui.io/react/docs/getting-started/introduction/)
- In-repo: `docs/adr/0012-coreui-design-system.md`, `docs/adr/0009-frontend-stack.md`, `frontend/src/components/crud/README.md`, `frontend/src/entityConfigs/README.md`, `docs/requirements/2026-09-03-project-scaffold-requirements.md`, `docs/business-case/2026-09-03-sovereign-ai-testing-business-case.md` (checked 2026-09-04, no design-system-architecture content found in any of these prior to this document).
