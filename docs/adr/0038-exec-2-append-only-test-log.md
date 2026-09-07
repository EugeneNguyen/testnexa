# ADR-0038: EXEC-2 append-only TestLog (write hook + two new bespoke routes)

**Status:** Accepted
**Date:** 2026-09-07
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0027](0027-generic-admin-crud-ui-and-backend-completion.md) (`TestLog` model + read-only generic factory routes, built ahead of this story), [ADR-0033](0033-plan3-test-cycle-creation-and-execution-scope-check.md) (`POST /test-cycles/{id}/executions`, this story's log-on-create hook point), [ADR-0034](0034-exec-1-test-execution-recording-dashboard.md) (`TestCycleDetail`, this story's log-timeline UI host screen), [FR-EXEC-2](../requirements/2026-09-03-project-scaffold-requirements.md#26-test-execution--defects--test-execution-defect-storiesmd), [Database Document §3.8](../database/2026-09-03-database-design.md), [API Document §4](../api/2026-09-03-api-design.md), [TC-EXEC-004/005/006](../test-cases/2026-09-03-test-cases.md)

## Context

`TestLog` the *table* has existed since ADR-0027: immutable by schema (no `updated_at`), a seeded `test_log.read` permission, and `list`/`get` routes via the generic factory — but **nothing had ever written a row to it**. `POST /test-cycles/{id}/executions` (ADR-0033) and the generic `PATCH /test-executions/{id}` both mutate `TestExecution` directly with no side effect; there is no comment concept anywhere in the schema; and no MCP tool touches `TestExecution` yet, so "when an agent takes an action" had nothing to trigger it. FR-EXEC-2's three AC1 triggers (status change, comment, agent action) and AC3 (ordered timeline read) were entirely unbuilt.

Six open questions were resolved with the user before implementation (plan-with-open-questions convention, root `CLAUDE.md`):

- **Q1 (mechanism):** a new generic `post_update_hook` field on `CrudEntityConfig` (`app/api/crud_factory.py`), set only by `_TEST_EXECUTION_CONFIG`, over a bespoke `PATCH` route replacing the generic one — extends the existing validation-only `update_guard` hook shape (ADR-0031) rather than teaching the factory anything `TestLog`-specific.
- **Q2 (initial recording):** the *create* route also logs (`from=None`), not just later corrections — an audit trail with a gap before its first entry is a weak audit trail.
- **Q3 (agent actions):** `event_type=agent_action` **overrides** what would otherwise be `status_change`/`comment`/`attachment` whenever the acting actor is an `AIAgent`, rather than being a 4th independently-triggered category — the real sub-kind is carried in `payload.kind`. Chosen because no MCP tool exists yet to trigger a genuinely distinct 4th category, and this makes AC1's literal "when an agent takes an action... a log row is appended" true today with zero new MCP surface.
- **Q4 (attachment):** no schema change. `POST /executions/{id}/comments` accepts optional `attachment_url`/`file_name`; supplying either flips `event_type` to `attachment`. Same "plain text/URL, no live integration needed for v1" posture EXEC-3's `Defect.external_ref` already established — no `Attachment` row, no file upload.
- **Q5 (UI):** an expandable "History" modal per execution row on the existing `TestCycleDetail` screen, not a new page — matches the sitemap's own "may land on `TestCycleDetail` itself" note.
- **Q6 (which `PATCH`s log):** only when `result` is actually present in the update **and** its value actually changed — an `actual_result`/`executed_at`-only edit logs nothing.

## Decision

### Backend

**`CrudEntityConfig.post_update_hook`** (`app/api/crud_factory.py`): an optional `Callable[[row, old_values, updates, actor, db], Awaitable[None]]`, invoked inside `update_item` after `setattr` but before `flush`/`commit` — same transaction, so anything the hook `db.add()`s lands atomically with the update it describes. `old_values` is captured (only for fields actually in the update dict) *before* mutation, so the hook can compare "from" and "to". Only `_TEST_EXECUTION_CONFIG` sets it; every other entity's `PATCH` path is byte-for-byte unchanged.

**`_test_execution_post_update_hook`** (`app/api/routes/execution.py`): no-ops unless `"result"` is in the update dict and its value differs from the row's prior value (Q6); otherwise appends a `status_change`/`agent_action` `TestLog` row via `build_status_change_log` — shared with the create route below so both write the identical payload shape (`{kind, from, to, actor_id, actor_type}`).

**`execution_authoring.py`'s create route** now appends the same `status_change` log (`from=None`) in the same transaction as the insert (Q2) — needs its own `flush` first to populate `TestExecution.id` (a Python-side `generate_uuid7` default, not populated until flush), then a second `flush`+`commit` covering both rows.

**`_event_type_for_actor`** (Q3): `TestLogEventType.agent_action if isinstance(actor, AIAgent) else human_event_type`. Applied uniformly by `build_status_change_log` (create/correction) and the new comment route.

**`POST /executions/{id}/comments`** (new bespoke route, `execution.py`): body `{text, attachment_url?, file_name?}` (`AddTestLogCommentRequest`). Gated `test_execution.update` — the same permission a `result` correction already requires, already seeded for `tester`/`ai_agent_scoped`/`test_manager`/`org_admin` (no RBAC migration). 404-vs-403 boundary via a new `_fetch_execution_gated` helper, reusing `execution.py`'s own `_resolve_test_execution_org_id` resolver. `event_type` is `comment` or `attachment` (Q4: presence of `attachment_url`/`file_name`), overridden to `agent_action` per Q3 if the caller is an `AIAgent`.

**`GET /executions/{id}/logs`** (new bespoke route, `execution.py`): the ordered-timeline read AC3 asks for and the API Document already reserved a row for — `TestLog` rows for the path execution, ordered `logged_at ASC, id ASC`, paginated (same `page`/`page_size` defaults as every other list route). Gated `test_execution.read`. Distinct from the generic factory's `GET /test-logs?test_execution_id=<uuid>` (same underlying rows, `test_log.read`-gated, no ordering guarantee) — this route is the purpose-built, ordering-guaranteed equivalent the API Document's §4 row already named.

**`_actor_membership_exists` promoted to `crud_factory.py`** (a genuine, independent bug found during implementation, not part of the original plan): `execution_authoring.py`'s create route had always used the plain `_org_membership_exists(db, org_id, actor.actor_id)` — correct for a `User` actor, but structurally blind to an `AIAgent` one (`OrgMembership.user_id` FKs `user.actor_id` only; an agent has no `user` row, per `backend/CLAUDE.md`'s existing note on this exact class of gap in `assets.py`). No MCP tool had ever exercised this route with a real `AIAgent` bearer before this story's own test suite did, so the gap was latent, not newly introduced. Both this route and EXEC-2's own two new bespoke routes (which take the same `User | AIAgent` actor type) now use `_actor_membership_exists`.

### A real structural consequence, not a bug: a `TestExecution` with any log entry can no longer be deleted

`TestLog.test_execution_id` is `ON DELETE RESTRICT` (Database Document §3.8, unchanged by this story). Since the create route now *always* appends a log row, and the generic `DELETE /test-executions/{id}` route still exists (ADR-0033 restricted `create` only, not `delete`), that route now answers `409 restrict_blocked` for every `TestExecution` with a real audit trail — which, after this story, is every one that was ever created or corrected through the app. This is the correct consequence of an append-only log for a compliance-grade tool (deleting the parent must not be a back door around "TestLog rows are immutable once written"), not a regression to work around. One existing test (`test_admin2_execution_trace.py::test_test_execution_full_crud_happy_path`) and one existing TC (TC-PLAN-017's own DELETE leg) asserted `204`/row-gone; both were updated to assert `409`/row-still-present, with an explicit comment recording why, rather than treated as broken.

### Frontend — `TestCycleDetail`, no new page (Q5)

A "History" button per execution-history row opens a `CModal` (`execution-history-modal`) showing the ordered timeline (`GET /executions/{id}/logs`, oldest first, one badge per `event_type` + a short human-readable summary line built from `payload`) and, below it, a comment/attachment form (`text`, optional `attachment_url`/`file_name`) submitting `POST /executions/{id}/comments`. On success the timeline **re-fetches** (never a local splice), same "always re-read the server" posture `TestCycleDetail`'s own dashboard/history already established (ADR-0034). On failure the modal stays open with the reason inline, same convention as the "Record Result" modal.

`lib/api/testLogs.ts` — two functions, `listTestExecutionLogs`/`addTestExecutionComment`, mirroring `testExecutions.ts`'s existing shape (bespoke wrapper per route, typed payload/response, `ApiError` on failure).

**No RBAC change.** Both new routes are gated on permission codes (`test_execution.update`/`.read`) every role that already reaches `TestCycleDetail`'s existing "Record Result" flow already holds.

## Consequences

**Positive:** FR-EXEC-2's three AC1 triggers and AC3's ordered-timeline read are all closed, with the immutability guarantee (AC2) already structurally true since ADR-0025/ADR-0027 and now genuinely exercised (a real log actually exists to be immutable). The `post_update_hook` mechanism is reusable by any future entity needing the same "append an audit row on a specific field's change" shape without teaching the generic factory anything entity-specific.

**Negative / accepted trade-offs:**

- **A `TestExecution` becomes effectively undeletable once it has a real history.** Accepted and documented above as the intended consequence of AC2, not a design flaw — but it is a genuine behavior change for the pre-existing generic `DELETE` route, flagged here rather than silently absorbed by the two test fixes it required.
- **`agent_action` overrides rather than supplements the other three event types (Q3).** A future MCP tool that touches `TestExecution` will need to decide whether this remains correct or whether `agent_action` should become a genuinely distinct category once there's a real action to name — revisit when MCP-2/3 adds one.
- **The comment/attachment endpoint stores no real file, only a URL/filename reference (Q4).** Same trade-off EXEC-3 already accepted for `Defect.external_ref`; real attachment upload for `TestExecution` evidence is a future story's scope, not silently decided here.

## Alternatives considered

- **A bespoke `PATCH /test-executions/{id}` replacing the generic route** (mirroring ADR-0033's create-route precedent), instead of a generic `post_update_hook`. Rejected: the factory already has a proven "one entity needs one extra thing on `PATCH`" hook shape (`update_guard`, ADR-0031) for validation; extending that shape for a side effect is the smaller, more honest diff than adding a second full route + restricting the generic one, and no other field on `TestExecution`'s `PATCH` needs bespoke handling.
- **`agent_action` as a true 4th, independently-triggered category** (Q3's rejected default). Deferred rather than built now — there is no current mechanism (no MCP tool, no scheduled job) that would ever produce an agent action distinct from a status change/comment/attachment, so building the trigger now would be speculative.
- **Extending `Attachment` with a nullable `test_execution_id`** for the attachment trigger (Q4's rejected default). Rejected for this pass: a real schema/migration/resolver change for a feature (execution-evidence file upload) no AC literally asks for yet; the plain-reference approach satisfies AC1's literal "attachment... TestLog row appended" without it.
