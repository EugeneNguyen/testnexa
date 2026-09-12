# ADR-0057: Generic admin CRUD pages relocated from `pages/admin/` to `container/`

## Status

Accepted

## Context

ADR-0025 introduced the generic admin CRUD surface as two route-level page
components, `EntityListPage`/`EntityFormPage`, living at
`frontend/src/pages/admin/`. ADR-0041 later introduced `container/` as a
directory for components sized by a different axis than
`components/<atomic-tier>/` — **state ownership**: a component that owns its
own state (`page`/`pageSize`, in `container/Table.tsx`'s case) and exposes
actions, consumed by many screens with no shared data shape.

On direct instruction, `EntityListPage`/`EntityFormPage` are relocated into
`container/` as well, as `container/entity-crud/EntityListPage/` and
`container/entity-crud/EntityFormPage/` (each its own per-screen subfolder
with an `index.ts` barrel, matching `pages/<tier>/<X>/<X>.tsx`'s existing
convention). This is a **pure location change** — no route, prop, or
behavioral change of any kind.

This doesn't fit `container/`'s state-ownership rationale as cleanly as
`Table.tsx` does: `EntityListPage`/`EntityFormPage` are each consumed from
exactly one place (`App.tsx`'s route table), not "many screens with no
shared data shape." They do still own real state (list query params,
mutation state, delete-confirm modal state) and, like `Table.tsx`, they are
deliberately outside the `components/<atomic-tier>/` composition-complexity
axis (they're routes, not composable pieces). Recorded here honestly rather
than stretched to match ADR-0041's original framing: `container/`'s
practical scope now reads as "components/pages whose defining trait is
owned state + actions, regardless of atomic tier or fan-out," a small
widening of ADR-0041's axis.

## Decision

- `frontend/src/pages/admin/EntityListPage.tsx` (+ its 3 test files) →
  `frontend/src/container/entity-crud/EntityListPage/EntityListPage.tsx`
  (+ tests, + `index.ts` barrel).
- `frontend/src/pages/admin/EntityFormPage.tsx` (+ its test file) →
  `frontend/src/container/entity-crud/EntityFormPage/EntityFormPage.tsx`
  (+ test, + `index.ts` barrel).
- `App.tsx` imports both from their new `container/entity-crud/...` barrel
  paths. Routes/paths/behavior unchanged.
- `pages/admin/registry.ts`, `useAdminRouteContext.ts`, `useEntitySchema.ts`,
  `useEntityScope.ts` **stay in `pages/admin/`** — they're consumed well
  beyond these two pages (`useEntitySchema` alone has 10+ other callers:
  `EntityTable`, `FkAutocomplete`, `TestCycleDetail`, `TestPlanDetail`,
  `lib/api/taxonomy.ts`), so moving them would widen this change's blast
  radius for no benefit tied to the actual ask.
- `container/<X>.tsx`'s existing flat, one-file test convention
  (`frontend/CLAUDE.md`'s placement table) is extended for this pair only:
  `container/entity-crud/<X>/<X>.tsx` + barrel, mirroring the `pages/<tier>/`
  per-screen-subfolder convention instead, since each of these two files
  already carried 3-4 separate per-story test files before this move.

## Consequences

- No behavior change; verified via `tsc --noEmit` (clean) and the full
  Vitest suite (506/507 passing — the 1 failure is a pre-existing,
  full-suite-only cross-test-pollution flake in
  `TestCycleDetail.ExecutionLog.test.tsx`, confirmed unrelated: passes alone
  on both `main` and this branch, and that file was never touched).
- `container/Table.tsx`'s own docstring (the canonical explanation of the
  `container/` vs `components/<tier>/` split) is updated to note this
  exception rather than silently going stale.
- Future generic-admin-CRUD page components (if any are ever added outside
  this pair) should default to `pages/admin/`, per ADR-0025 — this ADR
  documents a one-off relocation of the two existing ones, not a new
  standing rule that all admin pages live in `container/`.

## Alternatives considered

- **Extract only the reusable state/logic into a new `container/` component,
  leave the page shells in `pages/admin/`.** Rejected — explicit instruction
  was to relocate the files themselves, not to refactor the state-ownership
  boundary.
- **Leave as-is in `pages/admin/`.** Rejected per direct instruction.
