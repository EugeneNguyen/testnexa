# UI Design Document — SHELL-7: Sidebar-mini layout + org-scoped CRUD nav restructure

**Date:** 2026-09-08
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0046](../adr/0046-shell-7-sidebar-mini-org-crud-restructure.md), [SHELL-7 user story](../user-stories/2026-09-04-admin-shell-sidebar-stories.md#story-shell-7-mini-sidebar--org-scoped-crud-nav-restructure), [ADR-0042](../adr/0042-adminlte-design-system.md) (AdminLTE v4, `sidebar-mini`'s shipped CSS), [ADR-0043](../adr/0043-atomic-design-tiering-for-frontend-components.md) (`AppSidebar`/`AppShell` current locations)

## 1. Scope

Two changes to the existing shell, no new screens: (a) `AppShell` gains AdminLTE's `sidebar-mini` layout modifier; (b) `AppSidebar`'s org-scoped `Admin` group (8 entities, one flat list) becomes 3 named groups. Frontend-only, no backend/schema change (see ADR-0046).

## 2. Sidebar-mini: expanded vs. collapsed

Desktop, expanded (unchanged from today):

```
┌────────────────────────────┐
│ TestNexa                   │
├────────────────────────────┤
│ [🎯] Dashboard              │
│ [👥] Members                │
│ [🛡]  Access Control      ▸ │
│ [▤]  Catalogs            ▸ │
│ [🏢] Organization         ▸ │
│ [—]  UI Elements          ▸ │
└────────────────────────────┘
```

Desktop, collapsed (`sidebar-collapse sidebar-mini`, pointer not hovering — `4.6rem` rail, labels/group-arrows hidden, icon only):

```
┌───┐
│ TN│
├───┤
│🎯 │
│👥 │
│🛡 │
│▤ │
│🏢 │
│—  │
└───┘
```

Hovering the collapsed rail (still `sidebar-collapse`, AdminLTE's own `:hover` CSS rule) widens it to the full `--lte-sidebar-width` (250px) and reveals labels again — no JS, no click required, matches AdminLTE's own shipped stylesheet behavior.

> **Correction, added at implementation time (2026-09-08), matching [ADR-0046](../adr/0046-shell-7-sidebar-mini-org-crud-restructure.md)'s own correction note:** this section originally said the un-hovered rail is `3.1rem` and that hover widens it to "`4.6rem`+". Both figures were wrong. `3.1rem` comes from a `.compact-mode`-gated rule this app never activates; the applicable rule is a flat `4.6rem`, and hover goes to the full sidebar width. Corrected here from a live measurement (73.59px collapsed / 250px hovered at a 16px root font size), not from a second reading of the stylesheet. Toggling stays on the existing header hamburger (`AppShell`'s `toggleSidebar`) — `sidebar-mini` changes what "collapsed" *looks like*, not how collapse/expand is triggered.

**Group-toggle interaction while collapsed** — needs live verification against a real AdminLTE instance before implementation locks this in (ADR-0046's own flagged open point): AdminLTE's stock JS shows a group's children as a hover flyout when mini-collapsed; since that JS isn't vendored (ADR-0042), the existing click-based `menu-open` toggle may behave differently under `sidebar-mini` than under plain `sidebar-collapse`. Implementation must observe this live (per root `CLAUDE.md`'s "verify empirically" testing note) and document whatever the actual behavior turns out to be — this doc does not prescribe a specific flyout mechanism.

> **Observed, 2026-09-08 (real browser, isolated stack, real hover + real click at 1400x900) — this closes the open point above.** **There is no hover flyout.** AdminLTE's stock mini-mode flyout is JS-driven (`push-menu.ts`), which ADR-0042 does not vendor, and nothing in the shipped CSS closes a `menu-open` treeview when the rail is un-hovered. So the existing click-based toggle keeps working unchanged, and a group opened while hovering the rail **stays open when the pointer leaves**: its `.nav-treeview` remains `display: block` and renders *inline inside* the 4.6rem rail — each child laid out at ~57.6x40px, still hit-testable, and still navigating correctly (verified by clicking one and landing on `/orgs/:orgId/admin/roles`).
>
> The cosmetic consequence, accepted rather than worked around: while un-hovered those child rows are **visually blank**, because `.sidebar-mini.sidebar-collapse .sidebar-menu .nav-link p` collapses the label to `width: 0` (computed 8px — padding survives the zeroed content box) and the children deliberately carry no icon of their own (§3's icon-exclusivity rule, TC-SHELL-026). Hovering restores the full 250px width and every label. Giving children icons purely to fill the rail would contradict §3's own decision, so the behavior is recorded here and locked in by a regression test (`e2e/tests/shell7-sidebar-mini.spec.ts`) rather than changed. If it is ever judged a real usability problem, that is a new decision needing its own ADR — not a silent tweak.

## 3. Org-scoped CRUD nav restructure

Replaces the single `Admin` group with 3 groups, each collapsed by default (same `openGroups` `useState<Set<string>>` mechanism already in `AppSidebar.tsx` — no new state shape, just more group keys):

| Group | testid | Icon | Entities (`:entity` key → label) |
|---|---|---|---|
| Access Control | `sidebar-nav-group-access-control` | `fa-solid fa-user-shield` | `roles`→Roles, `permissions`→Permissions, `role-assignments`→Role assignments, `org-memberships`→Org memberships |
| Catalogs | `sidebar-nav-group-catalogs` | `fa-solid fa-layer-group` | `test-design-techniques`→Test design techniques, `test-levels`→Test levels, `test-types`→Test types |
| Organization | `sidebar-nav-group-organization` | `fa-solid fa-building` | `organizations`→Organizations |

Child item testids keep the existing `sidebar-nav-admin-<key>` convention (e.g. `sidebar-nav-admin-roles`) — only the **parent** group's testid/label/icon changes; children are reassigned to a new parent, not renamed themselves, minimizing churn to only what actually moved.

`Members` (existing flat item, `sidebar-nav-org-members`) gains an icon, `fa-solid fa-users` — no other change to that item.

Full org-scoped nav order, top to bottom: `Dashboard` → `Members` → `Access Control` → `Catalogs` → `Organization` → `UI Elements` (unchanged, ADR-0020).

## 4. Non-goals (explicit)

- `orgScopedEntities` registry (`frontend/src/pages/admin/registry.ts`), route paths, and permission gating are unchanged — this is a sidebar-presentation-only restructure.
- `UI Elements` group is not touched, reordered relative to itself, or folded into the new groups.
- No new sidebar search, no new collapse-all/expand-all control, no persistence of which groups are open across reload — same no-persistence convention `AppSidebar.tsx` already has today.
- Mobile off-canvas sidebar behavior (`sidebar-open` on `<body>`, `AppShell`'s existing mobile branch) is unaffected — `sidebar-mini`'s CSS only targets `sidebar-collapse` combinations, which the mobile branch doesn't set (mobile uses `sidebar-open`, a different class); implementation should confirm this live rather than assume it from the shipped CSS alone.
