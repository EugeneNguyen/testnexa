# UI Design Document — DS-3: Shared `InfoBox` component (AdminLTE Info Box)

**Date:** 2026-09-08
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0043](../adr/0043-ds-3-infobox-widget-consolidation.md), [ADR-0023](../adr/0023-frontend-shared-component-location.md) (location convention, `components/shared/` axis), [ADR-0042](../adr/0042-adminlte-design-system.md) (AdminLTE v4 — Info Box is one of its own documented widgets, https://adminlte.io/themes/v4/widgets/info-box.html), [DS-3 user story](../user-stories/2026-09-04-design-system-component-stories.md#story-ds-3-reusable-infobox-metric-tile)

## 1. Scope

One new component, `frontend/src/components/shared/info-box/InfoBox.tsx`, and two migrations onto it:

| # | Screen | File | Retired component | Usages |
|---|---|---|---|---|
| 1 | Org home (`/orgs/:orgId`) count widgets | `pages/workflows/OrgHome.tsx` | `WidgetStatsTile` (`components/shared/widget-stats-tile/`) | 2 — `ProjectCountWidget`, `ActiveMemberCountWidget` |
| 2 | `TestCycleDetail` execution dashboard | `pages/workflows/TestCycleDetail.tsx` | `StatTile` (local, unexported, `:278`) | 4 — Pass/Fail/Blocked/Skipped tiles |

Both retired components are deleted outright once their call sites migrate — component file, barrel export, and (for `WidgetStatsTile`) its own Vitest file for the first; the local function definition for the second. Neither has any caller left afterward.

## 2. Component shape

```
┌──────────────────────────────────────────┐
│  ┌────────┐  LABEL (uppercase, small)     │
│  │  icon  │  123  ← big number             │
│  └────────┘                                │
└──────────────────────────────────────────┘
   .info-box   .info-box-icon   .info-box-content
               (optional)       .info-box-text / .info-box-number
```

- **Root**: `div.info-box` — no grid-column wrapper of its own (matches `WidgetStatsTile`'s existing contract, not `StatTile`'s self-wrapping `col-6 col-md-3 mb-3`). Every call site supplies its own column div, same as `OrgHome.tsx`'s existing `col-sm-6` wrappers (`OrgHome.tsx:497-504`) and as `TestCycleDetail.tsx`'s 4 tiles will continue to (moved from inside `StatTile` to each call site).
- **Icon block** (`icon` prop, optional): `span.info-box-icon` + contextual color utility class (exact class TBD — see §4, must be confirmed against a live render before implementation, not invented) containing a Font Awesome `<i>`. Omitted entirely when `icon` is not supplied — no empty placeholder box.
- **Content block**: always present — `div.info-box-content` > `span.info-box-text` (the label) + `span.info-box-number` (the value).
- **`color` prop**: reuses the existing `CWidgetStatsColor` enum unchanged (`primary`/`secondary`/`success`/`danger`/`warning`/`info`/`light`/`dark`) — every color either retired component used is already a member (`OrgHome`: `primary`, `info`; `TestCycleDetail`: `success`, `danger`, `warning`, `secondary`).
- **`number` prop**: `ReactNode`, caller-formatted — carries `WidgetStatsTile`'s existing Loading…/Unable to load/count tri-state (`OrgHome`'s own `widgetValue()` helper, unchanged) and, independently, `StatTile`'s `null`→`"—"` sentinel (`TestCycleDetail`'s own render logic, unchanged). The component itself is agnostic to which convention a given caller uses.
- **`testId` prop**: forwarded to the root `.info-box` as `data-testid`, same convention every other shared component in this repo uses.

## 3. Per-screen migration notes

- **`OrgHome.tsx`**: `ProjectCountWidget` (`color="primary"`, `icon="fa-solid fa-folder"`, unchanged) and `ActiveMemberCountWidget` (`color="info"`, **`icon="fa-solid fa-users"` — new**, previously rendered no icon block at all). Both components' own `useQuery`/`widgetValue()` loading-error-count logic is untouched — only the rendered child component changes from `WidgetStatsTile` to `InfoBox`. `data-testid`s (`widget-project-count`, `widget-active-member-count`) unchanged, still on the root card element.
- **`TestCycleDetail.tsx`**: the 4 dashboard tiles (`counts.pass`/`.fail`/`.blocked`/`.skipped`, each independently `null`-safe rendering `"—"`) drop the local `StatTile` function and call `InfoBox` directly, each still wrapped in its own `div.col-6.col-md-3.mb-3` (moved out of the component, per §2). No `icon` prop supplied for any of the 4 — Info Box's icon block is optional in this component's own contract, even though the AdminLTE demo doesn't showcase omitting it. `data-testid`s (`dashboard-tile-{pass,fail,blocked,skipped}`, plus each tile's own `-count` suffix on the number element) unchanged.

## 4. Open item to resolve before implementation

The exact contextual-color utility class on `.info-box-icon` (e.g. `text-bg-{color}` vs `bg-{color} text-{contrast}`) is **not** determinable from AdminLTE's shipped SCSS/CSS alone — `_info-box.scss` (confirmed by direct read) bakes in no color of its own; the demo page supplies it via a utility class in markup. Per `frontend/CLAUDE.md`'s "dump the real DOM, don't invent a class name" rule: before writing `InfoBox.tsx`, confirm the exact class either via an RTL/Playwright DOM dump of a real AdminLTE v4 Info Box render, or by viewing the live https://adminlte.io/themes/v4/widgets/info-box.html demo's rendered `outerHTML` directly — not by guessing from Bootstrap 5.3's own `text-bg-*` convention, which AdminLTE does not uniformly follow elsewhere in this codebase (root `CLAUDE.md` already flags badges as a case where AdminLTE deliberately diverges from `text-bg-*`).

## 5. Out of scope (explicit)

Any AdminLTE small-box/large-box widget variant beyond Info Box; a progress-bar or trend-chart slot on the tile (Info Box's own markup supports an optional `.progress` element — not used by either migrated call site, not exposed as a prop by this story); giving `TestCycleDetail`'s 4 tiles an icon for visual parity with `OrgHome`'s widgets (no natural icon exists for a bare pass/fail/blocked/skipped count); any further atoms/molecules/organisms tiering (same posture DS-1's own scope note already established, [`docs/user-stories/2026-09-04-design-system-component-stories.md`](../user-stories/2026-09-04-design-system-component-stories.md)).
