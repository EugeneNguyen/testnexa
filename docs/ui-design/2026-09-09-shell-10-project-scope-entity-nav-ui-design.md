# UI Design Document — SHELL-10: Project-scope entity nav (sidebar)

**Date:** 2026-09-09
**Story:** [SHELL-10](../user-stories/2026-09-04-admin-shell-sidebar-stories.md)
**ADR:** [ADR-0051](../adr/0051-shell-10-project-scope-entity-nav.md)

## 1. What changes visually

Only `AppSidebar`'s markup on project-scoped routes — `AppBreadcrumb` (SHELL-9) and the org-scoped sidebar (unchanged since SHELL-7/PROJ-4) are untouched.

**Before (SHELL-9's shape, this story replaces):**

```
┌─────────────────────┐
│ TestNexa             │
├─────────────────────┤
│ 🎚  Dashboard         │
│ 📁  Projects          │
│ 👥  Members           │
│ 🛡  Access Control  ▸ │
│ 🗂  Catalogs        ▸ │
│ 🏢  Organization    ▸ │
│    UI Elements      ▸ │
└─────────────────────┘
```

**After (SHELL-10):**

```
┌─────────────────────┐
│ TestNexa             │
├─────────────────────┤
│ ✏  Test Design      ▸ │
│ 📅  Test Planning    ▸ │
│ 🐛  Execution & Def…▸ │
│ ⚙  Setup            ▸ │
│ ℹ  Project Overview   │
│ ←  Back to Projects   │
└─────────────────────┘
```

Expanded (`Test Design`, on `sidebar-mini`'s existing `menu-open`/`nav-treeview` mechanism, unchanged from SHELL-7):

```
│ ✏  Test Design      ▾ │
│      Requirements      │
│      Test Conditions   │
│      Test Cases        │
│      Test Suites       │
```

Icon-per-group, no icon on entity children — same convention `ORG_ENTITY_GROUPS` already established (`frontend/CLAUDE.md`'s own icon-history note applies here too now: check `app-sidebar.tsx`'s literal arrays, this doc is a snapshot).

## 2. "Project Overview" — present/absent by route

`/projects/:projectId` itself: **absent** (it would be a dead self-link). Every nested route (`test-plans/:id`, `test-plans/:id/test-cycles/:id`, `admin/:entity[/:id/edit]`): **present**, linking to `/projects/:projectId`.

## 3. Loading / error states

Same posture ADR-0050 §4 already established, now applied to the entity groups too (ADR-0051 Decision §4): while `useResolvedOrgId()`'s fetch is pending or fails, the sidebar shows brand-only (its pre-existing empty-nav state) — no group content, no back links, until `orgId` resolves. This is a deliberate widening of the gate from "just `projectId`" (an earlier implementation draft) to "`projectId` AND `orgId`" — see ADR-0051 Consequences for why the narrower gate was wrong.

## 4. Alternatives considered

See ADR-0051's own Alternatives section (stacked org+project nav; linking to `ProjectDetail`'s bespoke sections instead of generic-admin; a flat ungrouped list) — not repeated here, the ADR is the record.

## 5. Open question (flagged, not silently decided)

**Should "Project Overview" get an icon too**, matching the flat-item convention `Dashboard`/`Members`/`Projects` established on the org side (each carries exactly one)? **Default (shipped): yes** (`fa-solid fa-circle-info`) — for consistency with that established rule rather than introducing a fourth icon-less flat item. "Back to Projects" also carries one (`fa-solid fa-arrow-left`), same reasoning.
