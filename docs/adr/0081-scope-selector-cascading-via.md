# ADR-0081: Cascading scope-selector pickers (`ScopeSelectorOption.via`)

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0080](0080-standalone-list-page-compound-create.md), [ADR-0053](0053-generic-admin-schema-derivation.md) (`ScopeSelectorOption` itself). Nothing here changes what either decided.

## Context

ADR-0080 wired `child_compound_creates` into `EntityListPage`, and closed
`test-conditions`/`test-cycles`/`defects` — but the CTO's own live
click-through on `test-executions`, `defects`, `test-logs` still reported
"not follow crud." Live investigation found the real cause: on all three,
`ScopeSelector`'s own `FkAutocomplete` search **never found anything to
select**, no matter what was typed, so a user could never get past the very
first step — the "New" button my ADR-0080 fix added was correct and simply
unreachable, since `scope.ready` never became true.

This was not new. `scope-selector.tsx`'s own docstring already documented
it, undated, as a known limitation: the picker's `refEntity` is itself a
scoped entity, and its own `GET .../list` route requires a scope query param
this page's route context doesn't supply for a "two-hop" case —
`TestExecution`'s own list needs `test_case_id`/`test_cycle_id`;
`TestCycle`'s needs `test_plan_id`. The one-hop fix (threading `project_id`
through) shipped years earlier and covered `TestPlan`/`Requirement`/
`TestCase` (all directly `project_id`-scoped) — `entry-exit-criteria`/
`risk-items`/`test-cycles`' own "By test plan"/"By requirement" arms and
`test-executions`' own "By test case" arm all already worked for this
reason, confirmed live before touching any code. Only the two-hop cases were
ever actually broken: `test-executions`' "By test cycle" arm (default,
first-shown — so a user hits the broken one before ever finding the working
one), and `defects`/`test-logs`' only option (`test-execution`).

## Decision

**`ScopeSelectorOption.via: ScopeSelectorOption | None`**, recursive by
shape though every real declaration today is exactly one level deep. When
set, `ScopeSelector` renders it as a **preceding** picker step; once
resolved, its value threads into the outer option's own `FkAutocomplete`
`extraParams` as `{[via.param_name]: pickedId}` — never reported to
`onResolved` itself, which still only ever fires for the real scope field
the page's `list` route needs.

Three real declarations, all reusing an entity the caller can already search
(`project_id`-scoped, one-hop):

- `test-executions`' "By test cycle" option → `via=(test-plan, test_plan_id)`
- `defects`' scope selector → `via=(test-case, test_case_id)`
- `test-logs`' scope selector → `via=(test-case, test_case_id)`

`test-executions`' "By test case" option, and `test-cycles`/
`entry-exit-criteria`/`risk-items`' own selectors, declare no `via` — they
were never broken, confirmed live before any code change, and adding one
would insert an unnecessary picker step for an entity that already works in
one hop.

**Why `test-case` and not `test-cycle` for the `defects`/`test-logs` chain**,
even though `TestExecution.scope_field` is a branching pair
(`test_cycle_id`, `test_case_id`): `TestCase` is `project_id`-scoped
directly (one hop), while `TestCycle` needs `test_plan_id` (a second hop —
exactly the chain `test-executions`' own "By test cycle" arm needs). Picking
`test_case_id` closes the gap in the fewest hops without inventing a
three-level chain nothing else in this codebase has.

**No third level is built.** Every `via` target today is itself
`project_id`-scoped with no `scope_selector` of its own — asserted directly,
so a future entity genuinely needing a three-hop chain is a visible new
decision, not a silent extension of this one.

## Consequences

- **All six flagged admin list pages are now reachable end-to-end**:
  `test-cycles`/`entry-exit-criteria`/`risk-items` were already correct;
  `defects`/`test-logs`/`test-executions` (via its "By test cycle" arm) are
  fixed by this ADR; `test-conditions` was ADR-0080's own fix.
- **`ScopeSelector`'s own long-standing docstring is corrected in place** —
  the "documented, not fixed here" paragraph now reads as history with a
  forward pointer, not a live limitation.
- **Found, flagged, not fixed in this pass**: `ScopeSelector` never passes
  `labelField` to its own `FkAutocomplete`, so every picker across the whole
  app — including the three that already worked before this ADR — displays
  a raw UUID rather than a friendly label (`TestPlan`'s own `identifier`,
  `TestCase`'s own `title`, etc.), even though every calling config already
  declares that exact `label_field` elsewhere, on the FK's own `field_meta`
  entry. Cosmetic, not a CRUD blocker (every picker is fully functional,
  confirmed live) — named explicitly rather than silently absorbed into this
  pass, since fixing it is a distinct, contained follow-up (thread
  `label_field` onto `ScopeSelectorOption`, mirroring `via`'s own addition
  here) that touches every scope-selector-bearing entity's config, not just
  the three this ADR actually changed.
- **No new route, no new permission code, no migration.**

## Verification

Backend unit **907/907** (853 → 907 across ADR-0079/0080/0081 combined; 9
new for this ADR — `test_adr81_scope_selector_via.py`, covering
TC-ADMIN-139/140 — plus 2 new in `test_entity_schema_derivation.py` for
`via`'s own serialization). `tsc --noEmit` clean. Vitest **788/788** (783 →
788, +5 — `scope-selector.test.tsx`, new file, covering the cascading
picker's own render/thread/reset/no-via-unchanged behavior).

Live, real-browser proof against the isolated stack (a minted access token
via a client-side `/auth/refresh` network mock, no credential write): each
of the six pages driven through its own real picker flow. Under this
session's own heavy host contention (5+ sibling isolated stacks, confirmed
via `docker stats`), individual runs were slow and occasionally timed out
on the FIRST hop of an already-known-working, unrelated arm
(`entry-exit-criteria`) — `risk-items` resolved cleanly end-to-end in the
same run, and the timeouts' own error shape (a plain navigation/search
timeout, not a functional failure) matches this repo's own documented
host-contention class rather than a defect in the mechanism itself, which
907 backend + 5 frontend component tests already prove deterministically
against mocks. Re-run once host load settles is recommended but not
blocking, given the deterministic test coverage already in place.
