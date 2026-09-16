# ADR-0080: Standalone admin list-page compound create, via the already-required scope selector

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Extends:** [ADR-0079](0079-child-compound-create-for-one-to-many-tabs.md) (compound create for one-to-many tabs) and, transitively, [ADR-0078](0078-compound-create-through-bespoke-routes.md). Nothing here changes what either ADR decided — `child_compound_creates`, its declarations, and `EntityRelationTab`'s own use of them all stand unchanged.

## Context

The CTO's follow-up, on the same admin surface ADR-0079 had just closed for
its relation-tab context: `http://.../admin/test-conditions` (the
**standalone** list page, not a tab on `Requirement`'s detail page) still had
no "New" button. Then, in the same message thread, six more standalone list
pages named at once: `entry-exit-criteria`, `test-cycles`, `test-executions`,
`test-logs`, `defects`, `risk-items`.

`EntityListPage.tsx`'s `canCreate` gate had never looked at
`child_compound_creates` at all — it only ever checked
`config.methods.includes("create")`. ADR-0079 wired the mechanism into
exactly one host component (`EntityRelationTab`); the standalone list page,
the *other* place a "New" button can live, was untouched.

A live audit of all seven named URLs found three different states, not one:

| Entity | Standalone list state | Cause |
|---|---|---|
| `entry-exit-criteria` | **Already fully working** — generic `create`, gated behind its own `scope_selector` (pick a `TestPlan` first) | No gap at all; verified live (`201`, then cleaned up) |
| `risk-items` | **Already fully working** — same shape, `scope_selector` offering `requirement_id`/`test_plan_id` | No gap; verified live the same way |
| `test-conditions`, `test-cycles`, `defects` | **No "New" at all** | `canCreate` never considered `child_compound_creates`, even though ADR-0079 had already declared all three |
| `test-executions` | **No "New" at all, correctly** | Still ADR-0079's own named-open gap (needs a picker for the *other* of its two real parents, a body field not a path one) — not this story's to close |
| `test-logs` | **No "New" at all, incorrectly** | ADR-0079 classified this an exception ("append-only, no route could exist") — wrong; see Amendment below |

## Decision

**A second UI host for the identical `child_compound_creates` declarations,
reusing state the standalone list page already has for an unrelated
reason.** Every entity that declares `child_compound_creates` also declares
a `scope_selector` for the *same* field — the generic `list` route itself
requires it, since these entities are always scoped (`?requirement_id=`,
`?test_plan_id=`, `?test_execution_id=`). By the time any row renders on the
standalone list page, `useEntityScope`'s `scope.field`/`scope.value` already
equal exactly what the declaration's `far_field` needs. This is the same "no
picker needed, the value is already known" reasoning ADR-0079 used for a
relation tab — here the known value comes from the page's own required scope
resolution instead of the tab's `relation.scopeField`.

```ts
const childCompoundCreate =
  !canCreate && scope.field
    ? config.childCompoundCreates?.find((action) => action.farField === scope.field)
    : undefined;
const canCreateViaCompound =
  Boolean(childCompoundCreate) && permissions.has(childCompoundCreate!.permission, projectId);
```

`createMutation`'s `mutationFn` branches exactly as `EntityRelationTab`'s
already does: `childCompoundCreate` present → `createViaCompoundRoute(action,
{[scope.field]: scope.value}, values)`; absent → the existing `createEntity`.
**Zero new backend surface** — no new field, no new declaration shape, no new
route. `entry-exit-criteria`/`risk-items` needed nothing (already closed by
existing machinery); `test-executions` stays open, named, not silently
passed over.

### Amendment to ADR-0079: `TestLog` was misclassified as an exception

ADR-0079's audit called `TestExecution` → "Test logs" an exception —
"append-only by schema, no route could exist." A real route already existed:
`POST /executions/{id}/comments` (EXEC-2), gated on `test_execution.update`,
writing exactly one `TestLog` row per call — structurally identical to the
other three closed directions (one bespoke route, parent = path placeholder
= this entity's own `scope_field`, one transaction). It was missed because
its name ("add a comment") doesn't read like a generic entity create the way
`POST /requirements/{id}/test-conditions` does.

Closing it needed one thing none of the original three did:
`_TEST_LOG_CONFIG` had **no writable schema at all**
(`create_schema=None`, `update_schema=NoSchema`), so `derive_entity_schema`
derived every field `readOnly: true` and the generic create form had
literally nothing to render. Fixed by setting
`create_schema=AddTestLogCommentRequest` **without** adding `"create"` to
`methods` — the generic factory only ever registers a create route when
*both* are true (`"create" in config.methods and config.create_schema is not
None`), so this supplies three real writable fields (`text` required,
`attachment_url`/`file_name` optional) for the compound-create form with
**zero change to `TestLog`'s actual REST surface** (`POST /test-logs` still
405s, exactly as before). An explicit `search_fields=()` override keeps
`?q=` a documented no-op on this entity, since ADR-0070's own default would
otherwise have picked up the two new plain-string fields as a side effect of
a change that was never about search.

`TestExecution` → "Test logs" moves from ADR-0079's "exception" to "closed".
Only `OrgMembership` (Invite+Accept, a materially different authoring flow)
remains a genuine exception.

## Consequences

- **Four standalone list pages gain "New": `test-conditions`, `test-cycles`,
  `defects`, `test-logs`.** The same four directions — plus their existing
  relation-tab siblings — share one declaration each; nothing about this
  story touches the tab context at all.
- **Two standalone list pages confirmed already correct, no code change:**
  `entry-exit-criteria`, `risk-items` — verified live via direct API calls
  (real `201`s against this project, cleaned up immediately after).
- **`test-executions`' standalone list stays open**, the identical reason
  ADR-0079 already named for its relation-tab siblings (`TestCase`/
  `TestCycle` → "Test executions") — a picker for the *other* real parent,
  filling a body field rather than a path one, a materially larger mechanism
  than this story's reuse of already-known scope state.
- **`TestLog`'s classification correction is retroactive to ADR-0079's own
  audit**, not a new decision about a new capability — the route predates
  both ADRs (EXEC-2). Handled as an `### Amendment` inside `test_adr79_
  child_compound_create.py`'s own module docstring and `CLASSIFICATION`
  table (pre-merge, same-branch correction, `docs/CLAUDE.md`'s own
  convention), not a silent rewrite.
- **Two pre-existing tests corrected in place, not deleted:** the
  `test-logs` `filterFields` literal in both `test_crud_factory.py` (unit)
  and `test_filter1_filter_fields.py` (integration) grew by two
  (`attachment_url`/`file_name`) — the same "second copy of the same claim"
  shape this repo's docs have hit before, both copies found and fixed
  together rather than one now and one left stale.

## Verification

Backend unit **898/898** (9 new — 6 net-new/rewritten in
`test_adr79_child_compound_create.py`'s own `TestLog` coverage, plus the
corrected `test_crud_factory.py` literal). `tsc --noEmit` clean. Vitest
**783/783** (3 new — `EntityListPage.childCompoundCreate.test.tsx`).
Backend integration, targeted re-run against the rebuilt isolated stack:
**116/116** (`test_filter1_filter_fields.py`, `test_search1_search_fields.py`,
`test_admin2_execution_trace.py`, `test_exec2_append_only_test_log.py`,
`test_mcp_entity_tools.py`, `test_adr53_entity_schema.py`).

Live, real HTTP proof against the isolated stack (a minted access token, no
credential write — `backend/CLAUDE.md`'s documented workaround for the
harness's own Secret-Store-Writes block): a full `Requirement` →
`TestCondition` → `TestCase` → `TestPlan`/`Release`/`Environment` →
`TestCycle` → `TestExecution` chain seeded, then `POST
/executions/{id}/comments` → `201`, then `GET /test-logs?test_execution_id=`
→ the new row, immediately listable — and `GET
/entities/test-logs/schema` serving the new `childCompoundCreates` entry and
the three new writable fields exactly as declared. `entry-exit-criteria`/
`risk-items` verified the same way (real `201`s against this project's real
`TestPlan`/`Requirement`). All probe rows cleaned up afterward.

**No live browser click-through this pass** — the isolated stack's only
known human login (`xuanbinh91@gmail.com`) has no recoverable password, and
minting a fresh one is exactly the credential-write class the harness's own
classifier blocks (`backend/CLAUDE.md`'s documented precedent). Stated
plainly rather than silently skipped: backend-route and frontend-component
proof stand in its place, consistent with `frontend/CLAUDE.md`'s own
"the wiring is exercised [in Vitest], the shape is pinned [in integration]"
split for exactly this situation.

## Alternatives considered

- **Build a dedicated parent-picker UI for the standalone list page.**
  Rejected — unnecessary: every declaring entity's list page already forces
  scope resolution before any row renders, so the value a picker would
  produce is already sitting in `useEntityScope`'s own state.
- **Fold this into ADR-0079 directly rather than a new ADR.** Rejected for
  the standalone-list-page mechanism itself (a new UI host, extends but
  doesn't correct ADR-0079) — but the `TestLog` reclassification specifically
  *is* folded back into ADR-0079's own test file as an in-place `###
  Amendment`, per `docs/CLAUDE.md`'s distinction between "a new decision"
  and "a correction to an existing one, still unmerged, same branch."
