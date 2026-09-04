# Business Case — CoreUI Admin Shell (Sidebar + Navbar Template) Adoption

**Date:** 2026-09-04
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** Draft — new discovery, gap flagged in prior stage (2026-09-04 CoreUI design-system doc audit: no business case, requirement, or ADR covers adopting CoreUI's sidebar+navbar admin-template shell — distinct question from the separate, already-PIVOT'd atomic-design-taxonomy business case dated the same day).

## Provenance and framing caveat

**This gap was flagged during the prior stage** (CoreUI design-system doc audit, 2026-09-04): [ADR-0012](../adr/0012-coreui-design-system.md) names "CoreUI's admin-template component set (sidebar/navbar layout, data tables, forms)" only as a *rationale line* for picking CoreUI over Tailwind — it never scopes or decides whether to actually adopt that shell. No requirement doc, ADR, or business case addresses it. This document is **not** a re-run of the 2026-09-04 Atomic Design business case (that one covers internal component *organization* and PIVOT'd to a narrow single story) — this is a different question: whether the authenticated app needs a persistent navigation *shell* (sidebar + navbar) at all, and whether adopting CoreUI's off-the-shelf template for it is the right move now.

## Problem statement

**FACT**, checked against `frontend/src/App.tsx` (2026-09-04): the authenticated app currently has 3 routes behind `ProtectedRoute` (`/orgs/pick`, `/orgs/:orgId`, `/orgs/:orgId/members`), each rendering standalone — no persistent navigation shell exists. The only shared chrome is `AppHeader.tsx`, a plain header with no nav links to other sections.

**FACT**, [`docs/requirements/2026-09-03-project-scaffold-requirements.md`](../requirements/2026-09-03-project-scaffold-requirements.md): the product is scoped to the full 28-entity ERD, and **FR-ADMIN-2** explicitly requires "generic list/create/edit/delete CRUD for every entity without a bespoke screen" for "all remaining entities" — i.e., the authenticated screen count is contractually going to grow substantially beyond today's 3 routes, not organically maybe-grow the way the atomic-design business case's component-count assumption was speculative.

**INSIGHT**, contrasting this with the atomic-design business case's finding: that document correctly PIVOT'd a taxonomy investment because current evidence (1 shared component, 4 screens) didn't yet show the pain the methodology solves. This case is different in kind — FR-ADMIN-2 is an *already-committed requirement*, not a maybe-future one, and it mechanically implies the entity-navigation problem (how does a user get from "org members" to "test plans" to "requirements" to any of ~25 more entity screens) will exist as soon as that requirement is built, not conditionally.

**ASSUMPTION**, not yet observed (FR-ADMIN-2 CRUD screens aren't built yet): without a persistent nav shell, each new entity screen will need its own ad hoc way of getting a user there and back — ADR-0012's own migration precedent (Login/OrgPicker/OrgHome, all standalone) suggests the default pattern in this codebase today is a standalone screen, not a shell-wrapped one.

## Target customer

**FACT**, distinguishing from the atomic-design case: the beneficiary here is the **end user** — the product's actual QA/compliance customer personas ([Priya, Marcus](../personas/2026-09-03-target-personas.md)), not internal frontend contributors. This is a genuine product-value question, not an engineering-velocity one.

**Job to be done:** "move between the org's projects, test assets, and admin screens (org members, and eventually the ~25 FR-ADMIN-2 entity screens) without losing my place or re-navigating from a picker every time" — a direct instance of persona 1/2's Job #1/#2 (ship with real coverage confidence) and Job #6 (low-effort status reporting), both of which require moving across multiple entity views in one working session, per [02-customer-jobs.md](../product-discovery/02-customer-jobs.md).

**Existing alternative today:** none in-product — a user currently has no way to reach org-members or (once built) any other entity screen except a URL typed by hand or a link the current screen happens to expose. This is the "do nothing" / manual-navigation alternative, and it gets materially worse, not stays flat, as FR-ADMIN-2 screens land.

## Market / practice context

**FACT**, [CoreUI React docs](https://coreui.io/react/docs/templates/free-templates/) and CoreUI's own free-template repos: CoreUI ships a ready-made `CSidebar`/`CSidebarNav`/`CHeader` admin-template layout as part of the open-source (non-PRO) package already adopted per ADR-0012 — no new dependency, no PRO upgrade required to get it.

**FACT**, category convention: every direct competitor named in the product's own [market map](../product-discovery/01-market-map.md) (Kiwi TCMS, Squash TM, TestRail, Qase, Xray, Zephyr) uses a persistent sidebar/left-nav pattern for exactly this reason — multi-entity admin tools with 10+ resource types converge on this shell almost universally; it is not a differentiated choice, it's a **table-stakes** one for this product category. There is no Blue Ocean angle to chase here — a missing persistent nav shell in a 28-entity CRUD admin tool is a usability gap versus every alternative the target customer already knows, not an opportunity for value innovation.

**FACT**, confirmed in this repo: CoreUI is already the accepted design system (ADR-0012); adopting its own bundled admin-shell template is the "already own the alternative" case, not a new tool evaluation — the negative case (build a bespoke nav shell instead) would mean hand-rolling something CoreUI ships for free, contradicting ADR-0012's own stated rationale ("CoreUI's admin-template component set... is a closer fit to this product's actual UI shape than hand-styling everything").

## Why now

1. **FR-ADMIN-2 is already a committed requirement**, not a hypothesis — the entity-screen-count growth this shell exists to solve is contractually scheduled, unlike the atomic-design case's speculative future.
2. **Cheapest point to adopt it is now, before more standalone screens exist to retrofit** — only 3 authenticated routes exist today; every additional screen built without the shell first is a screen that needs migrating later (the same "AUTH-1 Tailwind migration debt" pattern ADR-0012 itself flagged and had to pay down once already).
3. **Zero new cost of adoption** — CoreUI's sidebar template is already inside the open-source package this repo depends on (ADR-0012); this is a "use what we already have" decision, not a new build-or-buy evaluation.

## Expected value

**Customer value (HYPOTHESIS, testable):** persistent, familiar (category-standard) navigation reduces the "how do I get to X" friction directly relevant to Priya's and Marcus's Job #1/#2/#6, which all require moving across multiple entity views per working session. Testable at the next usability check-in: can a user reach any of the ~5 screens that exist post-FR-ADMIN-2's first increment in ≤2 clicks from anywhere, without a back-button or manual URL edit?

**Business value:** indirect — no separate revenue line, but a missing table-stakes nav pattern is a plausible **churn/adoption risk** once real pilot users (the still-unrun [27-experiment.md](../product-discovery/27-experiment.md) validation) hit more than a handful of screens; competitors already ship this, so its absence is a comparison-losing gap, not a neutral one.

**Cost:** low — CoreUI's sidebar/navbar components are already an installed dependency (ADR-0012); the work is composing existing `CSidebar`/`CSidebarNav`/`CHeader` components into one shared authenticated-app layout and wrapping the existing 3 routes (and future FR-ADMIN-2 routes) in it, not building or licensing anything new.

**What would invalidate this:** if the next validation checkpoint ([27-experiment.md](../product-discovery/27-experiment.md), still not run per the main business case) shows pilot users never exceed 2–3 screens in practice, the urgency argument (point 1 above) weakens — but the "already own it, zero incremental cost" argument (point 3) still holds regardless, so KILL is not indicated even in that scenario; at most, defer polish (e.g., collapsible/responsive sidebar behavior) rather than the base shell itself.

## Decision

**RECOMMENDATION: GO**, narrowly scoped to adopting CoreUI's existing sidebar+navbar admin-template shell as the layout wrapper for all authenticated routes, replacing the current standalone-per-screen pattern. This is unlike the atomic-design case (PIVOT) because: (a) the triggering requirement (FR-ADMIN-2) is already committed, not speculative; (b) the customer is the end user, not an internal contributor, making this a direct product-value item; (c) the component being adopted is table-stakes-for-category, not a novel taxonomy being imposed ahead of evidence; (d) it costs nothing incremental — the dependency is already in the stack.

**Scope boundary:** adopt CoreUI's shell (sidebar nav + top navbar + content area) and wrap the existing 3 authenticated routes in it now. Do not pre-build placeholder nav links for entities that don't have screens yet (FR-ADMIN-2 CRUD isn't built) — nav items get added as their screens ship, avoiding dead links.

## Sources

- In-repo: `docs/adr/0012-coreui-design-system.md`, `docs/requirements/2026-09-03-project-scaffold-requirements.md` (FR-ADMIN-2), `frontend/src/App.tsx`, `frontend/src/components/AppHeader.tsx`, `docs/personas/2026-09-03-target-personas.md`, `docs/product-discovery/01-market-map.md`, `docs/product-discovery/02-customer-jobs.md`, `docs/product-discovery/27-experiment.md`, `docs/business-case/2026-09-03-sovereign-ai-testing-business-case.md`.
- External: [CoreUI for React — free templates](https://coreui.io/react/docs/templates/free-templates/) (checked 2026-09-04).
- Contrast reference: [2026-09-04 Atomic Design business case](2026-09-04-atomic-design-system-coreui-business-case.md) — same-day sibling document, different question, opposite (PIVOT) conclusion; cited here to make clear this isn't a duplicate of that analysis.
