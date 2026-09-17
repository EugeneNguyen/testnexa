# 0088. `Defect`/`TestExecution` pickers gain a server-computed `display_name` — never the raw id, never an ambiguous label

**Status:** Accepted
**Decider:** xuanbinh91@gmail.com (CTO)
**Date:** 2026-09-18
**Related:** [ADR-0087](0087-fk-select-for-bounded-catalogs.md) and its Amendment (the dropdown swap that put `Defect`/`TestExecution` pickers in front of real users for the first time as `FkSelect` — the class of picker this ADR fixes the label for)

## Context

The CTO reported dropdown pickers "select with id, don't select with name" — asked to fix it, with an explicit "I don't know how to define that in the backend or ERD, support me."

The root cause: `FkAutocomplete`/`FkSelect`'s shared `labelFor(row, labelField)` helper falls back to the row's raw `id` whenever the configured `label_field`'s value is `null`/`undefined`/`""`. Two of the ref entities ADR-0087 just put in front of a picker have exactly that gap:

- **`Defect`** — every `field_meta` pointing at `defect_id` (`trace.py`'s `_TEST_CASE_DEFECT_LINK_CONFIG`) used `label_field="external_ref"`. `external_ref` is genuinely optional (`CreateDefectForExecutionRequest`/`UpdateDefectRequest` both declare it `str | None = None`, no default) — a `Defect` raised with none set showed a raw UUID in the picker, literally reproducing the complaint.
- **`TestExecution`** — every `field_meta` pointing at `test_execution_id` used `label_field="result"`. `result` is never `null`, so this isn't the raw-id bug, but it is the same underlying complaint one step removed: `result` is a 4-value enum, so every failed execution of the same `TestCase` reads identically as `"fail"` in a picker with no way to tell them apart — trace.py's own pre-existing compound-create parent picker for `Defect` already worked around this for its one narrow case by using `executed_at` instead, precisely because "every option would read 'fail'."

Neither entity has an existing single column that is both always-present and genuinely distinguishing — `Defect` has no name field at all beyond the optional `external_ref`; `TestExecution` has no name field, period. This is exactly the "I don't know how to define that in the backend" gap: the fix isn't a frontend labelField swap, it's deciding what a computed, never-null label should say.

## Decision

Add a Pydantic `@computed_field` property `display_name` to both `DefectSummary` and `TestExecutionSummary` (`app/schemas/execution.py`) — computed server-side from columns that always exist, never the raw id:

- `DefectSummary.display_name`: `external_ref` when set (still the most recognizable label — a ticket number a human typed in), else `f"{severity.capitalize()} defect ({created_at:%Y-%m-%d})"`. Requires adding `created_at: datetime` as a real field on `DefectSummary` (the ORM column already existed; the schema had just never surfaced it) — the two bespoke `DefectSummary(...)` construction sites in `execution.py` (the atomic-create route and `list_defects_for_test_case`) now pass it through.
- `TestExecutionSummary.display_name`: `f"{result} — {executed_at:%Y-%m-%d %H:%M}"` — always present, always distinguishing between two executions with the same result.

Point every `field_meta` entry for `defect_id`/`test_execution_id` at `label_field="display_name"` instead of `"external_ref"`/`"result"` (`trace.py`'s `_TEST_CASE_DEFECT_LINK_CONFIG`; `execution.py`'s `_DEFECT_CONFIG` and `_TEST_LOG_CONFIG`).

A computed field is not a `model_fields` entry, so `crud_factory._to_summary`'s generic by-name `getattr(row, field_name)` loop (which only iterates `model_fields`) never tries to read `display_name` off the ORM row — it is computed automatically by Pydantic at serialization time, off the already-validated `external_ref`/`severity`/`created_at`/`result`/`executed_at` fields. No change needed to `_to_summary`, `derive_entity_schema`, or any frontend type — `labelFor()` already reads `row[labelField]` off the plain JSON response, and `display_name` is a real key in that JSON the instant the computed property exists.

## Consequences

- No more raw UUID in any picker pointing at `defect_id`. No more indistinguishable `"fail"`/`"fail"`/`"fail"` rows in any picker pointing at `test_execution_id`.
- `DefectSummary` gains one new always-present response field (`created_at`) plus the computed `display_name` — additive, not a breaking shape change; no existing frontend caller destructures a fixed field list that would choke on an extra key.
- Verified directly (server-side, since the live DB currently has zero `Defect`/`TestExecution` rows to click through in a browser): constructing `DefectSummary` with `external_ref=None` produces `"High defect (2026-09-18)"`, with `external_ref` set produces the ticket number verbatim; `TestExecutionSummary` produces `"fail — 2026-09-18 14:32"`. The served schema for `test-case-defect-links` now carries `"labelField": "display_name"` on `defect_id`.
- Backend unit 915/915 unchanged (nothing pinned the old field set). Frontend `tsc --noEmit` clean; Vitest 793/793 unchanged (the picker mechanism itself — `labelFor()` — was never entity-specific and needed no test change).
- The general lesson, worth restating since it's the reusable part: **before setting `FieldMeta.select`/pointing any picker's `label_field` at an existing column, check whether that column can be null (or non-unique) for the real rows it will show** — if the answer is yes and there's no better existing column, a server-computed `display_name` composed from columns that are always present is the fix, not a frontend fallback string (which has no access to the other columns needed to make a good one).

## Alternatives considered

- **Fix it in the frontend's `labelFor()` fallback** (e.g. show a shortened id, or "Untitled Defect", instead of the full UUID). Rejected — this treats the symptom (an ugly fallback string) without fixing the actual complaint (the label isn't a *name*); a frontend-only fix also has no access to `severity`/`created_at`/`result`/`executed_at` to compose anything better than a placeholder, since `labelFor()` only ever sees whichever single field `label_field` names.
- **Add a real, persisted `name`/`title` column to `Defect`/`TestExecution`.** Rejected as unnecessary schema growth — neither entity has ever needed a human-authored name for any other purpose (creation, filtering, the API contract), and a computed, derived label satisfies the picker's actual requirement (a stable, readable, never-null display string) without a migration or a new field for callers to keep populated.
