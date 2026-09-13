Bespoke workflow screens. Each screen lives in its own subfolder following the per-tier placement convention documented in `frontend/CLAUDE.md` (rows for `pages/<tier>/<X>.tsx` and `pages/<tier>/<X>.<Section>.test.tsx`):

- `pages/workflows/<Screen>/<Screen>.tsx` — page component
- `pages/workflows/<Screen>/<Screen>.test.tsx` — main test file (flat beside source, inside the subfolder)
- `pages/workflows/<Screen>/<Screen>.<Section>.test.tsx` — per-story multi-section test files (when a screen has several independently-rendered sections, e.g. `ProjectDetail.TestConditions.test.tsx`)
- `pages/workflows/<Screen>/index.ts` — barrel re-exporting the page component, so `App.tsx`'s `import X from "./pages/workflows/<X>"` resolves without touching the call site when a screen moves into its own subfolder.

Screens currently in this directory: `AcceptInvite`, `Dashboard`, `Login`, `OrgHome`, `OrgMembers`, `ProjectDetail`, `RootRedirect`, `Signup`, `TestCycleDetail`, `TestPlanDetail`. (`ProjectsPage` retired [ADR-0060](../../../../docs/adr/0060-projects-page-retired-generic-surface.md) — its route is now the generic admin surface, `container/entity-crud/`. `OrgPicker` retired [ADR-0063](../../../../docs/adr/0063-dash-3-dashboard-org-list-and-chooser.md) — `Dashboard` now owns org listing/picking/creating.)
