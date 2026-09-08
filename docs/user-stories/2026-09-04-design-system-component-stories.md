# User Stories — Frontend Shared Component (Design System / CoreUI)

**Date:** 2026-09-04
**Feature area:** Frontend shared component layer, on top of CoreUI (ADR-0012)
**Context:** [Business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md), [Personas](../personas/2026-09-04-atomic-design-contributor-personas.md) (Persona 1, "The Agent" — validated), [Journeys](../user-journeys/2026-09-04-atomic-design-contributor-journeys.md) (Journey 1, steps 3-4)

**Scope note, carried from the business case's PIVOT finding:** this is the **only** validated opportunity from *that* discovery pass — one narrow, evidenced component extraction, not a full Atomic Design (atoms/molecules/organisms/templates) buildout. Full tiering stays explicitly out of scope until more screens show duplication beyond what's already evidenced. DS-1 below was the sole story from the original business-case pass, deliberately — inventing additional stories the evidence didn't support would have violated this process's own no-fabrication principle.

**DS-2 (added 2026-09-07) is a second, independent graduation into this same file — not a business-case discovery, a direct CTO/product request.** By the time it was written, a fresh audit found six independent table implementations in `frontend/src/` (`EntityTable`, and five bespoke `CTable` screens), no two alike, two of them with their own hand-rolled pagination and none with a page-size selector — real, evidenced duplication of the same shape DS-1's own criterion requires, just discovered by direct instruction rather than by the original interview pass. Same posture root `CLAUDE.md`'s "raw-HTML-instead-of-`@coreui/react`" precedent already established for a different component class: a second independent instance of the same pattern is evidence it generalizes, not a special case to special-case around.

**Not included here (belongs elsewhere, not as a user story):** the component-location naming convention (`components/shared/` vs `components/crud/` vs page-local) is an **ADR**, per CLAUDE.md's ADR-first rule for architecture choices — not a user story. That ADR is a prerequisite for DS-1 below and should be written before or alongside implementation, not as a separate backlog item competing for story-priority here.

---

## Story DS-1: Reusable form-field component

**As** The Agent (AI coding-agent contributor building CoreUI screens against this repo's stories — [Persona 1](../personas/2026-09-04-atomic-design-contributor-personas.md)),
**I want** a single reusable `FormField` component that composes CoreUI's `CFormLabel` + `CFormInput` + validation feedback,
**so that** I can compose a new form field by passing props instead of re-deriving the same 2-3 line label+input block from the nearest prior screen each time — the exact, evidenced friction point in this repo today ([interviews](../user-interviews/2026-09-04-atomic-design-contributor-interviews.md): `CFormLabel`+`CFormInput` hand-authored 7× across `Login.tsx` and `Signup.tsx` alone, zero shared component to reach for).

**Acceptance criteria:**

- Given a form needs a labeled text/email/password input bound to a React Hook Form field, when a contributor uses `FormField` (label, RHF register/control props, optional error message passthrough), then it renders CoreUI's `CFormLabel` + `CFormInput` with the same markup/accessibility attributes (`htmlFor`/`id` pairing) the hand-authored instances already produce today — no visual or behavioral regression versus the current per-screen implementations.
- Given a field has a validation error (Zod schema failure via RHF), when `FormField` renders, then it surfaces the error using CoreUI's `CFormFeedback`/invalid-state styling, consistent with existing RHF+Zod conventions (ADR-0009) — not a bespoke error-rendering pattern.
- Given `FormField` exists, when `Login.tsx`'s 2 hand-authored label+input instances and `Signup.tsx`'s 5 are migrated to use it, then all existing Vitest coverage for those screens and the existing Playwright login/signup E2E flows still pass unmodified in assertions (behavior-preserving refactor of the call sites, proving the component is a true drop-in — this is verification of DS-1's new component, not a separately-scoped refactor story).
- Given the component is added, when a contributor looks for where new shared components belong, then a short note (component's own file-level doc comment, or the ADR referenced above) states its intended location and reuse scope — so the next contributor building a new screen has something to find, closing the exact gap Journey 1 (steps 3-4) identified.
- Out of scope for this story (explicitly, per the business case's deferral): checkbox/select/radio field variants, a `molecules`/`organisms` directory structure, or any second component beyond `FormField` — none of these have duplication evidence behind them yet.

**Traceability:** this story is the sole implementation output of the [business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md)'s narrow recommendation. No FR/NFR in `docs/requirements/2026-09-03-project-scaffold-requirements.md` currently covers this — flag for whoever picks this up: add a requirements entry if/when this graduates from "internal contributor tooling" to something requirements-tracked, consistent with how other ADR-driven changes have propagated across docs in this repo's history.

---

## Story DS-2: Reusable Table container (pagination + page-size selector)

**As** any contributor (human or AI agent) building or maintaining a CoreUI screen that lists rows,
**I want** a single reusable `Table` container that composes a `CTable` with pagination controls and a page-size selector (10/25/50/100),
**so that** I don't hand-roll a fourth (or fifth, or sixth) divergent pagination implementation — the evidenced state of this repo as of 2026-09-07: six independent table-rendering locations (`EntityTable`, `OrgHome`'s Project table, `RoleAssignmentsPanel`, `OrgMembers`, `ProjectDetail`'s outer tables, `TestPlanDetail`), two of which hand-rolled their own `CPagination` block with a different hardcoded page size (25 and 10 respectively) and neither offering a page-size choice, and four of which paginate not at all — rendering an unbounded full list.

**Acceptance criteria:**

- Given a screen needs to render a list of rows with more than one page's worth of data, when a contributor uses the `Table` container (rows/columns or a header/row render-prop, `page`/`pageSize`/`total`, and either an `onPageChange`+`onPageSizeChange` pair for server-driven pagination or a full pre-filtered/sorted array for client-driven pagination), then it renders a `CTable` + `CPagination` + a page-size `CFormSelect` offering exactly `10`/`25`/`50`/`100` — one implementation, not a per-screen reimplementation.
- Given a user changes the page-size selector, when the new value is applied, then the view resets to page 1 (never a page number that could now be out of range for the new page size) — in both server and client pagination modes.
- Given `EntityTable.tsx` (the generic admin CRUD table, already has its own `CPagination` but no page-size selector) is migrated onto the container, then every existing Vitest/e2e assertion for the 24 generic-admin entity list screens still passes unmodified, and the previously-hardcoded 25-row page size becomes user-selectable.
- Given `OrgHome`'s Project table (labeled "Dashboard" per ADR-0039, shipped with its own bespoke client-side search/sort/pagination hours before this story) is migrated onto the container in client mode, then its existing search and column-sort behavior (ADR-0039's own ACs) are preserved byte-for-byte — only the pagination/page-size chrome moves onto the shared implementation, not the search/sort logic.
- Given `RoleAssignmentsPanel.tsx`, `OrgMembers.tsx`, `ProjectDetail.tsx`'s outer-level tables, and `TestPlanDetail.tsx`'s test-plan list currently render a full unpaginated array, when each is migrated onto the container in server mode, then each gains real pagination against its own backing list route (adding pagination to `GET /orgs/{org_id}/role-assignments`, which has none today, is in scope as part of this migration) — not a client-side slice of an already-fully-fetched list, since none of these four ever had a "fetch everything" design decided for them the way `OrgHome`'s did.
- Given the backend's generic pagination convention (NFR-6) currently clamps every `page_size` request to a 25-row ceiling regardless of what's requested, when this story ships, then the ceiling is raised to 100 (matching the selector's own top option) — a page-size selector offering 100 would otherwise silently do nothing.
- Out of scope for this story: search/sort/filter UI of any kind (the container renders pagination for rows the caller has already decided how to filter/sort — `OrgHome`'s own search/sort stays exactly where ADR-0039 put it); persisting the selected page size across navigation/reload (component state only, matches this repo's existing no-persistence convention for equivalent UI state); nested/child lists rendered inside an expanded table row (`frontend/CLAUDE.md`'s flat-`<ul>/<li>` ARIA rule is unchanged and unaffected — the container is for outermost, non-nested tables only).

**Traceability:** [ADR-0041](../adr/0041-ds-2-table-container-shared-pagination.md). FR-DS-2, NFR-6 (revised), NFR-51 — see Requirements Document.
