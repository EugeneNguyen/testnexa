# ADR-0050: SHELL-10 gives project-scoped routes their own entity-CRUD sidebar nav, distinct from the org nav

**Date:** 2026-09-09
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0049](0049-shell-9-project-scope-nav-context-resolution.md) (SHELL-9 — this ADR amends its Decision §2, which had project-scoped routes render the *org* nav verbatim; SHELL-9's own `useResolvedOrgId()` hook and breadcrumb work are untouched, reused as-is), [ADR-0046](0046-shell-7-sidebar-mini-org-crud-restructure.md) (SHELL-7 — `ORG_ENTITY_GROUPS`' icon-per-group/complete-partition discipline, mirrored here for the project side), [ADR-0027](0027-generic-admin-crud-ui-and-backend-completion.md) (entity registry — `projectScopedEntities`, reused verbatim, no route/schema change)

## Context

SHELL-9 (ADR-0049) gave project-scoped routes (`/projects/:projectId/...`) a working sidebar for the first time — but it did so by rendering the *exact same* org-scoped nav (Dashboard/Projects/Members/Access Control/Catalogs/Organization/UI Elements) that `/orgs/:orgId` renders, reusing PROJ-4's "Projects" item as the click-path back out.

Direct CTO instruction, after reviewing the live result: a project's own sidebar should not be an org-management menu with a link back out — it should surface the CRUD screens for the entities that actually belong to *this project* (Requirement, Test Case, Test Condition, Test Suite, Test Plan, Release, and the rest of `projectScopedEntities`), which today are only reachable at all via `/projects/:projectId/admin/:entity` — a route that has existed since ADR-0025/ADR-0027's registry shipped, but has never had a single sidebar link pointing at it. The "back to the org" affordance is still needed, just relocated to the bottom of the nav rather than being its main content.

No backend, schema, or RBAC change — every route this ADR wires up already exists.

## Decision

1. **Project-scoped routes stop rendering the org nav.** `useResolvedOrgId()` gains a `mode: "org" | "project"` field (`"project"` whenever the route carries `:projectId`, `"org"` otherwise, including `/orgs/pick`) — the explicit signal `AppSidebar` needed and didn't have before, since SHELL-9 deliberately made both route kinds resolve the same truthy `orgId`. `AppSidebar` branches `navGroups` on `mode`, not on `orgId` truthiness alone.
2. **A new `PROJECT_ENTITY_GROUPS` constant**, parallel in shape and discipline to SHELL-7's `ORG_ENTITY_GROUPS` — 4 named, individually-iconed groups over a 13-of-20 subset of `projectScopedEntities`:

   | Group | Icon | Entities |
   |---|---|---|
   | Test Design | `fa-solid fa-pen-ruler` | Requirement, Test Condition, Test Case, Test Suite |
   | Test Planning | `fa-solid fa-calendar-check` | Test Plan, Entry/Exit Criteria, Test Cycle, Release |
   | Execution & Defects | `fa-solid fa-bug` | Test Execution, Test Log, Defect |
   | Setup | `fa-solid fa-sliders` | Environment, Risk Item |

   The remaining 7 entities are named in a companion `PROJECT_EXCLUDED_ENTITY_KEYS` constant, declared explicitly (not left as "whatever isn't grouped") so a Vitest partition-completeness test can assert `groups + exclusions === registry` and a future new project-scoped entity forces a conscious placement decision rather than silently vanishing from the nav:
   - `test-steps`, `attachments`, and the 4 link tables (`requirement-test-case-links`, `requirement-test-condition-links`, `test-condition-test-case-links`, `test-case-defect-links`) — reached through their parent entity's own UI (a TestStep only exists inside a TestCase; a link row only inside the pair it links), so a top-level slot would be a second, worse path to something already reachable.
   - `projects` — has no meaning inside a single project's own nav; the bottom "back" links (Decision §3) cover leaving it.
3. **Two "back" links at the bottom of the project-mode nav**, below the 4 entity groups: **"Project Overview"** → `/projects/:projectId` (this project's own `ProjectDetail` root — omitted while already on that exact route, `end`-matched the same way every other flat nav item already is) and **"Back to Projects"** → `/orgs/:orgId/projects` (PROJ-4's existing item, repositioned from where SHELL-9 left it, not rebuilt).
4. **Loading/error/404 gating extends to `orgId`, not just `projectId`.** `projectId` is available synchronously from the route the instant it matches, before `useResolvedOrgId()`'s fetch resolves — but the entity groups' own links depend on the project genuinely existing and resolving to a real org, so `projectNavGroups` is gated on `mode === "project" && projectId && orgId`, not `projectId` alone. This preserves the exact "one fetch's worth of blank sidebar, no partial/flickering nav" trade-off ADR-0049 §4 already established for the org nav this story replaces — found and fixed during this story's own implementation, where an earlier draft gated on `projectId` alone and showed group labels before org-context resolution completed.
5. **Org-mode nav is otherwise completely unchanged** — this ADR only replaces what renders when `mode === "project"`; `/orgs/:orgId` and its own nav content are untouched.
6. **`sidebar-mini`/mobile mechanics unchanged** — same body-class toggle, same hover-expand (ADR-0046), no new state machine.

## Consequences

**Positive:** the sidebar's stated purpose — reachable CRUD for the entities you're actually working with — now holds true inside a project the same way it already did inside an org. The 20 project-scoped generic-admin routes (previously reachable only by guessing the URL) are 13 of them now one click away; the remaining 7 keep their existing reachability path (their parent entity's UI) rather than gaining a redundant one.

**Negative / accepted trade-offs:**

- **This is an amendment to ADR-0049's Decision §2, not a reversal of the whole ADR.** SHELL-9's own `useResolvedOrgId()` hook (aside from the new `mode` field), its breadcrumb work, and its own 6 TCs are entirely unaffected and still accurate — only the *sidebar content* SHELL-9 chose to render on project routes changes here. Per this repo's own "flag drift, don't silently absorb" convention, ADR-0049's own text is left as-written; this ADR is the record of what changed and why.
- **4 of SHELL-9's own Vitest tests (TC-SHELL-029/030/031, plus half of TC-SHELL-033's own setup) needed rewriting**, not just extending — their literal claim ("the org nav renders on project routes") is now false. Rewritten to assert the project-mode nav instead, in the same commit as the implementation (see Test Plan risk row).
- **A prior in-flight draft of this story's own implementation gated the entity groups on `projectId` alone**, letting group labels render before `orgId` (and therefore the "Back to Projects" link) resolved — an inconsistent-looking half-populated nav for the duration of one fetch. Found via the died-agent-recovery re-verification process this session, fixed to gate on `orgId` too (Decision §4) before this ADR's implementation was considered done.
- **`useAdminRouteContext`'s own separate org-resolution path (ADR-0027) is unaffected and still un-unified with `useResolvedOrgId()`'s** — the same deliberate non-unification ADR-0049's NFR-54 already accepted, now doing double duty: both the sidebar's org-context resolution *and* its entity-CRUD nav content route through `useResolvedOrgId()`/the registry, while the 20 project-admin pages' own permission-check plumbing keeps using `useAdminRouteContext` independently.

## Alternatives considered

- **Show both the org nav and the project entity nav together** (stacked, or as a mode toggle). Rejected — the whole point of a project-scoped screen is that you're working inside one project; org-wide admin actions (Roles, Members, other Projects) are one click away via "Back to Projects" if genuinely needed, and stacking both would roughly double the nav's height for content that's rarely needed simultaneously.
- **Link entity groups to `ProjectDetail`'s own bespoke sections** (its expand-in-place Requirements/Releases/Test Suites lists) instead of the generic-admin routes. Rejected — most of `PROJECT_ENTITY_GROUPS`' entities (Test Condition, Test Execution, Test Log, Defect, Environment, Risk Item) have no bespoke section on `ProjectDetail` at all, only a generic-admin one; linking some entities one way and others another would make the nav's own behavior inconsistent entity-to-entity. Uniform generic-admin routing, same posture SHELL-7 already took for the org side.
- **A single flat list of all 13 included entities, no grouping.** Rejected —13 ungrouped rows is a worse "find what I need" experience than SHELL-7's own 8-into-3 grouping already proved out for the org side; grouping by ISTQB-ish lifecycle stage (design → plan → execute → setup) gives each group real navigational meaning rather than being an arbitrary split.
